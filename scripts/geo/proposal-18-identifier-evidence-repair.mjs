import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  findPreferredEntity,
  gql,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import { deterministicPropertyId, deterministicRelationId } from "./lib/ids.mjs";
import { buildEvidenceSchema, buildLocalSchema } from "./lib/local-schema.mjs";
import {
  booleanValue,
  compactValues,
  floatValue,
  textValue,
  uniqueValues,
} from "./lib/proposal-utils.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const PROPOSAL_NAME = "Disease Atlas - identifier and evidence source repair";

const config = loadGeoEnv({ requirePrivateKey: false });
const ops = [];
const touched = {
  entityValueRepairs: {},
  evidenceValueRepairs: 0,
  evidenceSourceRelationRepairs: 0,
  sourceRelationRepairs: 0,
  missingMetadata: [],
};
const pendingValueKeysByEntity = new Map();

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
  );
}

const asthmaPacket = readJson("../../data/geo/asthma-packet.json");
const asthmaEnrichment = readJson("../../data/geo/asthma-enrichment.json");
const wave2 = readJson("../../data/geo/disease-wave2-packets.json");
const wave3 = readJson("../../data/geo/disease-wave3-packets.json");
const threeDiseaseEvidence = readJson("../../data/geo/three-disease-evidence.json");

const packets = [
  asthmaPacket,
  ...(wave2.packets ?? []),
  ...(wave3.packets ?? []),
  ...(threeDiseaseEvidence.packets ?? []),
];

const SOURCE_LICENSE = {
  DISEASES: "CC BY 4.0",
  "DISEASES; DOAF; DisGeNET": "Source-specific",
  "DISEASES; DOAF; DisGeNET; GWAS Catalog": "Source-specific",
  "DISEASES; DOAF; GWAS Catalog": "Source-specific",
  "DISEASES; DisGeNET": "Source-specific",
  "DISEASES; DisGeNET; GWAS Catalog": "Source-specific",
  "DISEASES; GWAS Catalog": "Source-specific",
  "DOAF; DisGeNET": "Source-specific",
  "DOAF; DisGeNET; GWAS Catalog": "Source-specific",
  "DOAF; GWAS Catalog": "Source-specific",
  DisGeNET: "ODbL 1.0",
  "DisGeNET; GWAS Catalog": "Source-specific",
  "DrugCentral": "CC BY 4.0",
  "GWAS Catalog": "CC BY 4.0",
  "MEDLINE cooccurrence": "CC0 1.0",
  "NCBI gene2go": "CC BY 4.0",
  "Pathway Interaction Database": "CC BY 4.0",
  "PharmacotherapyDB": "CC0 1.0",
  Reactome: "CC BY 4.0",
  STARGEO: "CC0 1.0",
  WikiPathways: "CC BY 4.0",
};

const RELATION_SPECS = {
  associatedGenes: {
    propertyName: "Associated with",
    evidenceCategory: "curated disease-gene association",
    sourceFamily: "DISEASES",
    edgeVerb: "associates",
    fromKind: "Disease",
    toKind: "Gene",
  },
  treats: {
    propertyName: "Treats",
    evidenceCategory: "curated treatment indication",
    sourceFamily: "PharmacotherapyDB",
    edgeVerb: "treats",
    fromKind: "Compound",
    toKind: "Disease",
  },
  includesDrug: {
    propertyName: "Includes",
    evidenceCategory: "pharmacologic class membership",
    sourceFamily: "DrugCentral",
    edgeVerb: "includes",
    fromKind: "Pharmacologic Class",
    toKind: "Compound",
  },
  participatesInPathway: {
    propertyName: "Participates in pathway",
    evidenceCategory: "pathway annotation",
    sourceFamily: "Reactome",
    edgeVerb: "participates",
    fromKind: "Gene",
    toKind: "Pathway",
  },
  participatesInBiologicalProcess: {
    propertyName: "Participates in biological process",
    evidenceCategory: "gene ontology annotation",
    sourceFamily: "NCBI gene2go",
    edgeVerb: "participates",
    fromKind: "Gene",
    toKind: "Biological Process",
  },
  hasMolecularFunction: {
    propertyName: "Has molecular function",
    evidenceCategory: "gene ontology annotation",
    sourceFamily: "NCBI gene2go",
    edgeVerb: "participates",
    fromKind: "Gene",
    toKind: "Molecular Function",
  },
  locatedInCellularComponent: {
    propertyName: "Located in cellular component",
    evidenceCategory: "gene ontology annotation",
    sourceFamily: "NCBI gene2go",
    edgeVerb: "participates",
    fromKind: "Gene",
    toKind: "Cellular Component",
  },
  symptomEvidence: {
    propertyName: "Presents with",
    evidenceCategory: "MEDLINE cooccurrence",
    sourceFamily: "MEDLINE cooccurrence",
    edgeVerb: "presents",
    fromKind: "Disease",
    toKind: "Symptom",
  },
  anatomyEvidence: {
    propertyName: "Localizes to",
    evidenceCategory: "MEDLINE cooccurrence",
    sourceFamily: "MEDLINE cooccurrence",
    edgeVerb: "localizes",
    fromKind: "Disease",
    toKind: "Anatomy",
  },
  diseaseSimilarityEvidence: {
    propertyName: "Resembles",
    evidenceCategory: "disease similarity evidence",
    sourceFamily: "Dice similarity of ECFPs",
    edgeVerb: "resembles",
    fromKind: "Disease",
    toKind: "Disease",
  },
  palliates: {
    propertyName: "Palliates",
    evidenceCategory: "curated palliative indication",
    sourceFamily: "PharmacotherapyDB",
    edgeVerb: "palliates",
    fromKind: "Compound",
    toKind: "Disease",
  },
  upregulatedGenes: {
    propertyName: "Upregulates",
    evidenceCategory: "disease-gene expression",
    sourceFamily: "STARGEO",
    edgeVerb: "upregulates",
    fromKind: "Disease",
    toKind: "Gene",
  },
  downregulatedGenes: {
    propertyName: "Downregulates",
    evidenceCategory: "disease-gene expression",
    sourceFamily: "STARGEO",
    edgeVerb: "downregulates",
    fromKind: "Disease",
    toKind: "Gene",
  },
};

function setPreferred(map, key, value) {
  if (!key || !value) return;
  const current = map.get(key);
  map.set(key, { ...current, ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== "")) });
}

function addSources(existingSources, extraSources) {
  return [...new Set([...(existingSources ?? []), ...(extraSources ?? [])].filter(Boolean))];
}

const metadata = {
  diseases: new Map(),
  genes: new Map(),
  drugs: new Map(),
  drugClasses: new Map(),
  pathways: new Map(),
  goTerms: new Map(),
  symptoms: new Map(),
  anatomy: new Map(),
};

function indexDisease(disease) {
  if (!disease?.name) return;
  setPreferred(metadata.diseases, disease.name, {
    externalId: disease.diseaseOntologyId ?? disease.externalId,
    diseaseOntologyId: disease.diseaseOntologyId ?? disease.externalId,
    website: disease.website ?? (disease.diseaseOntologyId ? `http://purl.obolibrary.org/obo/${disease.diseaseOntologyId.replace(":", "_")}` : null),
    license: disease.license,
    sources: addSources(disease.sources, [disease.source, "Disease Ontology", "Hetionet v1.0"]),
  });
}

function indexEntity(map, entity, extra = {}) {
  if (!entity?.name) return;
  setPreferred(map, entity.name, {
    ...entity,
    externalId: entity.externalId ?? entity.diseaseOntologyId ?? entity.entrezGeneId ?? entity.drugBankId ?? entity.goId ?? entity.sourceDatabaseIdentifier,
    sources: addSources(entity.sources, [entity.source, extra.source, "Hetionet v1.0"]),
    ...extra,
  });
}

for (const packet of packets) {
  indexDisease(packet.disease);
  const entities = packet.entities ?? {};
  for (const entity of entities.genes ?? []) indexEntity(metadata.genes, entity, { source: "Entrez Gene" });
  for (const entity of entities.expressionGenes ?? []) indexEntity(metadata.genes, entity, { source: "Entrez Gene" });
  for (const entity of entities.drugs ?? []) indexEntity(metadata.drugs, entity, { source: "DrugBank" });
  for (const entity of entities.palliativeDrugs ?? []) indexEntity(metadata.drugs, entity, { source: "DrugBank" });
  for (const entity of entities.drugClasses ?? []) indexEntity(metadata.drugClasses, entity, { source: "DrugCentral" });
  for (const entity of entities.pathways ?? []) indexEntity(metadata.pathways, entity, { source: entity.source ?? "Reactome" });
  for (const entity of entities.biologicalProcesses ?? []) indexEntity(metadata.goTerms, entity, { goKind: "Biological Process", source: "Gene Ontology" });
  for (const entity of entities.molecularFunctions ?? []) indexEntity(metadata.goTerms, entity, { goKind: "Molecular Function", source: "Gene Ontology" });
  for (const entity of entities.cellularComponents ?? []) indexEntity(metadata.goTerms, entity, { goKind: "Cellular Component", source: "Gene Ontology" });
  for (const entity of entities.symptoms ?? []) indexEntity(metadata.symptoms, entity, { source: "MeSH" });
  for (const entity of entities.anatomy ?? []) indexEntity(metadata.anatomy, entity, { source: "Uberon" });
  for (const entity of entities.similarDiseases ?? []) indexDisease(entity);
}

for (const entity of asthmaEnrichment.genes ?? []) indexEntity(metadata.genes, entity, { source: "Entrez Gene" });
for (const entity of asthmaEnrichment.drugs ?? []) indexEntity(metadata.drugs, entity, { source: "DrugBank" });
for (const entity of asthmaEnrichment.drugClasses ?? []) indexEntity(metadata.drugClasses, entity, { source: "DrugCentral" });
for (const entity of asthmaEnrichment.pathways ?? []) indexEntity(metadata.pathways, entity, { source: "Reactome" });
for (const entity of [
  ...(asthmaEnrichment.biologicalProcesses ?? []),
  ...(asthmaEnrichment.molecularFunctions ?? []),
  ...(asthmaEnrichment.cellularComponents ?? []),
]) {
  indexEntity(metadata.goTerms, entity, { source: "Gene Ontology" });
}

async function mustFindProperty(name, preferredSpaceIds) {
  const entity = await findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds,
  });
  if (!entity) throw new Error(`Could not find property "${name}".`);
  return entity;
}

const sharedProperties = {
  Sources: await mustFindProperty("Sources", [ROOT_SPACE_ID]),
  Website: await mustFindProperty("Website", [ROOT_SPACE_ID]),
  "Source database identifier": await mustFindProperty("Source database identifier", [ROOT_SPACE_ID]),
  "DrugBank ID": await mustFindProperty("DrugBank ID", [HEALTH_SPACE_ID]),
  Inchikey: await mustFindProperty("Inchikey", [HEALTH_SPACE_ID]),
};

const sharedTypes = {
  Pathway: { id: (await findPreferredEntity({ typeId: SystemIds.SCHEMA_TYPE, name: "Pathway", preferredSpaceIds: [HEALTH_SPACE_ID] })).id },
};

const localSchema = buildLocalSchema(config.targetSpaceId, sharedTypes);
const evidenceSchema = buildEvidenceSchema(config.targetSpaceId, sharedTypes);
const localProperties = {
  "Disease Ontology ID": deterministicPropertyId(config.targetSpaceId, "Disease Ontology ID"),
  "Entrez Gene ID": deterministicPropertyId(config.targetSpaceId, "Entrez Gene ID"),
  License: deterministicPropertyId(config.targetSpaceId, "License"),
  InChI: deterministicPropertyId(config.targetSpaceId, "InChI"),
  "Class type": deterministicPropertyId(config.targetSpaceId, "Class type"),
};

const currentEntities = await listSpaceEntities(config.targetSpaceId, 2000);

async function findBlock(name) {
  const escapedName = JSON.stringify(name);
  const data = await gql(`{
    entities(
      spaceId: "${config.targetSpaceId}",
      typeId: "${SystemIds.DATA_BLOCK}",
      filter: { name: { includesInsensitive: ${escapedName} } },
      first: 300
    ) {
      id
      name
      typeIds
    }
  }`);

  return (data.entities ?? []).find((entity) => entity.name === name) ?? null;
}

async function collectionItems(blockName) {
  const block = await findBlock(blockName);
  if (!block) throw new Error(`Missing collection block "${blockName}".`);
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const data = await gql(`{
      relations(
        first: 1000,
        offset: ${offset},
        filter: {
          fromEntityId: { is: "${block.id}" },
          typeId: { is: "${SystemIds.COLLECTION_ITEM_RELATION_TYPE}" }
        }
      ) {
        toEntity {
          id
          name
          values(first: 100) {
            nodes {
              property { id name }
              text
              boolean
              float
              integer
              date
              datetime
            }
          }
          relations(first: 120) {
            nodes {
              id
              type { id name }
              toEntity { id name }
            }
          }
        }
      }
    }`);
    const page = data.relations ?? [];
    items.push(...page.map((relation) => relation.toEntity));
    if (page.length < 1000) break;
  }
  return items;
}

const sourceEntities = new Map(
  currentEntities
    .filter((entity) => ["Source", "Dataset", "Paper"].some((name) => entity.name && entity.typeIds))
    .map((entity) => [entity.name, entity])
);
for (const entity of currentEntities) {
  sourceEntities.set(entity.name, entity);
}

async function ensureSources(entity, sourceNames, sourceKeyPrefix) {
  const existingTargets = new Set(
    (entity.relations?.nodes ?? [])
      .filter((relation) => relation.type?.id === sharedProperties.Sources.id)
      .map((relation) => relation.toEntity?.id)
      .filter(Boolean)
  );

  let added = 0;
  for (const sourceName of sourceNames.filter(Boolean)) {
    const sourceEntity = sourceEntities.get(sourceName);
    if (!sourceEntity || existingTargets.has(sourceEntity.id)) continue;
    const { ops: relationOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: entity.id,
        typeId: sharedProperties.Sources.id,
        toId: sourceEntity.id,
        spaceId: config.targetSpaceId,
        sourceKey: `${sourceKeyPrefix}:source:${sourceName}`,
      }),
      fromEntity: entity.id,
      toEntity: sourceEntity.id,
      type: sharedProperties.Sources.id,
    });
    ops.push(...relationOps);
    existingTargets.add(sourceEntity.id);
    added += 1;
  }
  return added;
}

function rawValue(value) {
  return (
    value.text ??
    value.boolean ??
    value.integer ??
    value.float ??
    value.date ??
    value.datetime ??
    ""
  );
}

function existingValueKeys(entity) {
  const keys = new Set(
    (entity.values?.nodes ?? []).map(
      (value) => `${value.property?.id}:${String(rawValue(value))}`
    )
  );
  for (const key of pendingValueKeysByEntity.get(entity.id) ?? []) {
    keys.add(key);
  }
  return keys;
}

function updateLoadedEntityMissingValues({ entity, values }) {
  const existing = existingValueKeys(entity);
  const missing = uniqueValues(values).filter(
    (value) => !existing.has(`${value.property}:${String(value.value)}`)
  );

  if (missing.length === 0) {
    return false;
  }

  const { ops: updateOps } = Graph.updateEntity({
    id: entity.id,
    values: missing,
  });
  ops.push(...updateOps);

  const pending = pendingValueKeysByEntity.get(entity.id) ?? new Set();
  for (const value of missing) {
    pending.add(`${value.property}:${String(value.value)}`);
  }
  pendingValueKeysByEntity.set(entity.id, pending);

  return true;
}

async function repairCollection({ blockName, map, valuesFor }) {
  const items = await collectionItems(blockName);
  let updated = 0;
  let sourced = 0;
  for (const item of items) {
    const data = map.get(item.name);
    if (!data) {
      touched.missingMetadata.push({ blockName, name: item.name });
      continue;
    }
    const values = compactValues(valuesFor(data));
    const before = ops.length;
    updateLoadedEntityMissingValues({ entity: item, values });
    if (ops.length > before) updated += 1;
    sourced += await ensureSources(item, data.sources ?? [], `${blockName}:${item.name}`);
  }
  touched.entityValueRepairs[blockName] = { itemCount: items.length, updated, sourced };
}

function valuesForDisease(data) {
  return [
    textValue(localProperties["Disease Ontology ID"], data.diseaseOntologyId ?? data.externalId),
    textValue(sharedProperties.Website.id, data.website),
    textValue(localProperties.License, data.license),
  ];
}

function valuesForGene(data) {
  return [
    textValue(localProperties["Entrez Gene ID"], data.entrezGeneId ?? data.externalId),
    textValue(sharedProperties.Website.id, data.website),
    textValue(localProperties.License, data.license),
  ];
}

function valuesForDrug(data) {
  return [
    textValue(sharedProperties["DrugBank ID"].id, data.drugBankId ?? data.externalId),
    textValue(sharedProperties.Inchikey.id, data.inchikey),
    textValue(localProperties.InChI, data.inchi),
    textValue(sharedProperties.Website.id, data.website),
    textValue(localProperties.License, data.license),
  ];
}

function valuesForDrugClass(data) {
  return [
    textValue(sharedProperties["Source database identifier"].id, data.sourceDatabaseIdentifier ?? data.externalId),
    textValue(localProperties["Class type"], data.classType),
    textValue(sharedProperties.Website.id, data.website),
    textValue(localProperties.License, data.license),
  ];
}

function valuesForSourceIdentifier(data) {
  return [
    textValue(sharedProperties["Source database identifier"].id, data.sourceDatabaseIdentifier ?? data.externalId),
    textValue(sharedProperties.Website.id, data.website),
    textValue(localProperties.License, data.license),
  ];
}

function valuesForGoTerm(data) {
  return [
    textValue(localSchema.propertyIds["GO ID"], data.goId ?? data.externalId),
    textValue(sharedProperties.Website.id, data.website),
    textValue(localProperties.License, data.license),
  ];
}

function entityExternalId(name, kind) {
  if (kind === "Disease") return metadata.diseases.get(name)?.diseaseOntologyId ?? metadata.diseases.get(name)?.externalId;
  if (kind === "Gene") return metadata.genes.get(name)?.entrezGeneId ?? metadata.genes.get(name)?.externalId;
  if (kind === "Compound") return metadata.drugs.get(name)?.drugBankId ?? metadata.drugs.get(name)?.externalId;
  if (kind === "Pharmacologic Class") return metadata.drugClasses.get(name)?.sourceDatabaseIdentifier ?? metadata.drugClasses.get(name)?.externalId;
  if (kind === "Pathway") return metadata.pathways.get(name)?.sourceDatabaseIdentifier ?? metadata.pathways.get(name)?.externalId;
  if (["Biological Process", "Molecular Function", "Cellular Component"].includes(kind)) return metadata.goTerms.get(name)?.goId ?? metadata.goTerms.get(name)?.externalId;
  if (kind === "Symptom") return metadata.symptoms.get(name)?.sourceDatabaseIdentifier ?? metadata.symptoms.get(name)?.externalId;
  if (kind === "Anatomy") return metadata.anatomy.get(name)?.sourceDatabaseIdentifier ?? metadata.anatomy.get(name)?.externalId;
  return null;
}

function hetionetNodeKey(name, kind) {
  const id = entityExternalId(name, kind);
  if (!id) return null;
  return `${kind}:${id}`;
}

function buildHetionetEdgeId(relation, spec) {
  const from = hetionetNodeKey(relation.from, spec.fromKind);
  const to = hetionetNodeKey(relation.to, spec.toKind);
  if (!from || !to) return relation.hetionetEdgeId ?? null;
  return `hetionet-v1.0:${from}|${spec.edgeVerb}|${to}`;
}

function evidenceSourceNames(relation, spec) {
  const raw = relation.sourceFamily ?? relation.primarySource ?? relation.source ?? spec.sourceFamily;
  const pieces = String(raw)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  return addSources(pieces, ["Hetionet v1.0"]);
}

function relationValues(relation, spec, packet) {
  const sourceFamily = relation.sourceFamily ?? relation.primarySource ?? relation.source ?? spec.sourceFamily;
  return compactValues([
    textValue(evidenceSchema.propertyIds["Evidence category"], relation.evidenceCategory ?? spec.evidenceCategory),
    textValue(evidenceSchema.propertyIds["Source family"], sourceFamily),
    textValue(evidenceSchema.propertyIds["Hetionet edge ID"], relation.hetionetEdgeId ?? buildHetionetEdgeId(relation, spec)),
    textValue(localSchema.propertyIds["Hetionet metaedge"], relation.metaedge),
    relation.unbiased === undefined
      ? null
      : booleanValue(localSchema.propertyIds.Unbiased, relation.unbiased),
    textValue(localSchema.propertyIds["Import batch"], packet.importBatch),
    textValue(localProperties.License, relation.license ?? SOURCE_LICENSE[sourceFamily]),
    floatValue(evidenceSchema.propertyIds["Log2 fold change"], relation.log2FoldChange ?? relation.log2_fold_change),
  ]);
}

function relationName(relation, spec) {
  return `${relation.from} - ${spec.propertyName} - ${relation.to}`;
}

async function repairEvidenceRelations() {
  const items = await collectionItems("Evidence relations");
  const byName = new Map(items.map((item) => [item.name, item]));
  let updated = 0;
  let sourced = 0;

  for (const packet of packets) {
    for (const [bucket, relations] of Object.entries(packet.relations ?? {})) {
      const spec = RELATION_SPECS[bucket];
      if (!spec) continue;
      for (const relation of relations ?? []) {
        const item = byName.get(relationName(relation, spec));
        if (!item) continue;
        const before = ops.length;
        updateLoadedEntityMissingValues({
          entity: item,
          values: relationValues(relation, spec, packet),
        });
        if (ops.length > before) updated += 1;
        sourced += await ensureSources(
          item,
          evidenceSourceNames(relation, spec),
          `evidence:${item.name}`
        );
      }
    }
  }

  touched.evidenceValueRepairs = updated;
  touched.evidenceSourceRelationRepairs = sourced;
}

await repairCollection({
  blockName: "Diseases",
  map: metadata.diseases,
  valuesFor: valuesForDisease,
});
await repairCollection({
  blockName: "Similar diseases",
  map: metadata.diseases,
  valuesFor: valuesForDisease,
});
await repairCollection({
  blockName: "Genes",
  map: metadata.genes,
  valuesFor: valuesForGene,
});
await repairCollection({
  blockName: "Expression genes",
  map: metadata.genes,
  valuesFor: valuesForGene,
});
await repairCollection({
  blockName: "Treating drugs",
  map: metadata.drugs,
  valuesFor: valuesForDrug,
});
await repairCollection({
  blockName: "Palliative drugs",
  map: metadata.drugs,
  valuesFor: valuesForDrug,
});
await repairCollection({
  blockName: "Drug classes",
  map: metadata.drugClasses,
  valuesFor: valuesForDrugClass,
});
await repairCollection({
  blockName: "Pathways",
  map: metadata.pathways,
  valuesFor: valuesForSourceIdentifier,
});
await repairCollection({
  blockName: "GO annotations",
  map: metadata.goTerms,
  valuesFor: valuesForGoTerm,
});
await repairCollection({
  blockName: "Symptoms",
  map: metadata.symptoms,
  valuesFor: valuesForSourceIdentifier,
});
await repairCollection({
  blockName: "Anatomy evidence",
  map: metadata.anatomy,
  valuesFor: valuesForSourceIdentifier,
});
await repairEvidenceRelations();

const result = await finalizeProposal({
  config,
  proposalName: PROPOSAL_NAME,
  ops,
  touched: {
    ...touched,
    missingMetadataSample: touched.missingMetadata.slice(0, 30),
    missingMetadataCount: touched.missingMetadata.length,
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
