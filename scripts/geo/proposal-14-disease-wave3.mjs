import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  fetchEntity,
  findEntityInSpace,
  findPreferredEntity,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import {
  deterministicEntityId,
  deterministicPropertyId,
  deterministicRelationId,
  positionAfter,
} from "./lib/ids.mjs";
import { buildEvidenceSchema, buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";
import {
  booleanValue,
  compactValues,
  configureBlockColumns,
  createProvenanceRelation,
  datetimeValue,
  ensureBlockRelation,
  ensureCollectionBlock,
  ensureTextBlock,
  floatValue,
  ownerSpaceId,
  textValue,
  uniqueValues,
  updateMissingValues,
} from "./lib/proposal-utils.mjs";

const PROPOSAL_NAME = "Disease Atlas - Wave 3 cross-therapeutic diseases";

const SOURCE_ALIASES = {
  "Reactome via Pathway Commons": "Reactome",
  "PID via Pathway Commons": "Pathway Interaction Database",
  "FDA via DrugCentral": "DrugCentral",
};

const PATHWAY_SOURCES = new Set([
  "Reactome",
  "Pathway Interaction Database",
  "WikiPathways",
]);

const HETIONET_PAPER =
  "Systematic integration of biomedical knowledge prioritizes drugs for repurposing";
const DOAF_PAPER = "A Framework for Annotating Human Genome in Disease Context";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const wave = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../data/geo/disease-wave3-packets.json", import.meta.url)),
    "utf8"
  )
);

const currentEntities = await listSpaceEntities(config.targetSpaceId, 5000);
const ops = [];
const touched = {
  checkedSharedOntology: {},
  packets: wave.packets.map((packet) => packet.disease.name),
  createdLocalTypes: [],
  createdLocalProperties: [],
  createdEntities: [],
  reusedEntities: [],
  updatedMetadata: [],
  entitySourceLinks: {},
  relationCounts: {},
  collectionBlocks: {},
  attachedBlocks: [],
  configuredColumns: {},
  tabsReset: [],
};

async function mustFindType(name, preferredSpaceId) {
  const entity = await findPreferredEntity({
    typeId: SystemIds.SCHEMA_TYPE,
    name,
    preferredSpaceIds: [preferredSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
  });

  if (!entity) {
    throw new Error(`Missing expected shared type "${name}".`);
  }

  touched.checkedSharedOntology[`type:${name}`] =
    `${entity.id} (${entity.spaceIds?.join(",") ?? "unknown"})`;
  return entity;
}

async function mustFindProperty(name, preferredSpaceIds = [ROOT_SPACE_ID, HEALTH_SPACE_ID]) {
  const entity = await findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds: [...preferredSpaceIds, config.targetSpaceId],
  });

  if (!entity) {
    throw new Error(`Missing expected shared property "${name}".`);
  }

  touched.checkedSharedOntology[`property:${name}`] =
    `${entity.id} (${entity.spaceIds?.join(",") ?? "unknown"})`;
  return entity;
}

const sharedTypes = {
  Page: mustGetNamedEntry(manifest.types, "Page", "type"),
  Disease: mustGetNamedEntry(manifest.types, "Disease", "type"),
  Drug: mustGetNamedEntry(manifest.types, "Drug", "type"),
  "Drug class": mustGetNamedEntry(manifest.types, "Drug class", "type"),
  Gene: mustGetNamedEntry(manifest.types, "Gene", "type"),
  Pathway: mustGetNamedEntry(manifest.types, "Pathway", "type"),
  Dataset: mustGetNamedEntry(manifest.types, "Dataset", "type"),
  Source: mustGetNamedEntry(manifest.types, "Source", "type"),
  Paper: mustGetNamedEntry(manifest.types, "Paper", "type"),
  Symptom: await mustFindType("Symptom", HEALTH_SPACE_ID),
  "Anatomical structure": await mustFindType("Anatomical structure", HEALTH_SPACE_ID),
};

const sharedProperties = {
  Sources: mustGetNamedEntry(manifest.properties, "Sources", "property"),
  Treats: mustGetNamedEntry(manifest.properties, "Treats", "property"),
  Website: await mustFindProperty("Website", [ROOT_SPACE_ID]),
  DOI: await mustFindProperty("DOI", [ROOT_SPACE_ID]),
  Pmid: await mustFindProperty("Pmid", [HEALTH_SPACE_ID, ROOT_SPACE_ID]),
  "Publish date": await mustFindProperty("Publish date", [ROOT_SPACE_ID]),
  Abstract: await mustFindProperty("Abstract", [ROOT_SPACE_ID]),
  "Source database identifier": await mustFindProperty(
    "Source database identifier",
    [ROOT_SPACE_ID]
  ),
  "Version ID": await mustFindProperty("Version ID", [ROOT_SPACE_ID]),
  "DrugBank ID": await mustFindProperty("DrugBank ID", [HEALTH_SPACE_ID]),
  Inchikey: await mustFindProperty("Inchikey", [HEALTH_SPACE_ID]),
  "Related drugs": await mustFindProperty("Related drugs", [HEALTH_SPACE_ID]),
  "Related pathways": await mustFindProperty("Related pathways", [HEALTH_SPACE_ID]),
};

const localSchema = buildLocalSchema(config.targetSpaceId, {
  Gene: sharedTypes.Gene,
  Pathway: sharedTypes.Pathway,
  Drug: sharedTypes.Drug,
});
const evidenceSchema = buildEvidenceSchema(config.targetSpaceId, sharedTypes);

const supportingLocalProperties = [
  {
    name: "Disease Ontology ID",
    description: "Stable Disease Ontology identifier, for example DOID:2841.",
  },
  {
    name: "Entrez Gene ID",
    description: "NCBI Entrez Gene identifier used by Hetionet gene nodes.",
  },
  {
    name: "License",
    description: "License or reuse terms recorded from the source metadata.",
  },
  {
    name: "InChI",
    description: "IUPAC International Chemical Identifier for a compound.",
  },
  {
    name: "Class type",
    description: "Classification subtype for an imported pharmacologic class.",
  },
].map((property) => ({
  id: deterministicPropertyId(config.targetSpaceId, property.name),
  dataType: "TEXT",
  ...property,
}));

const allRequiredValueProperties = [
  ...supportingLocalProperties,
  ...localSchema.valueProperties,
  ...evidenceSchema.valueProperties,
];
const allRequiredRelationProperties = [
  ...localSchema.relationProperties,
  ...evidenceSchema.relationProperties,
];

const resolvedEntities = new Map();

const collectionItems = {
  diseases: new Map(),
  genes: new Map(),
  drugs: new Map(),
  drugClasses: new Map(),
  pathways: new Map(),
  goTerms: new Map(),
  symptoms: new Map(),
  anatomy: new Map(),
  similarDiseases: new Map(),
  palliativeDrugs: new Map(),
  expressionGenes: new Map(),
  datasets: new Map(),
  sources: new Map(),
  papers: new Map(),
  sourcesAndDatasets: new Map(),
  evidenceRelations: new Map(),
};

function findLocalEntity(name, typeId) {
  return findEntityInSpace(currentEntities, { name, typeId });
}

function rememberEntity(entity) {
  currentEntities.push({
    id: entity.id,
    name: entity.name,
    description: entity.description,
    typeIds: entity.typeIds,
    spaceIds: entity.spaceIds,
  });
}

function localValuePropertyId(name) {
  const property = allRequiredValueProperties.find((entry) => entry.name === name);
  if (!property) {
    throw new Error(`Missing local value property ${name}.`);
  }
  return property.id;
}

function relationPropertyId(name) {
  const property = allRequiredRelationProperties.find((entry) => entry.name === name);
  if (!property) {
    throw new Error(`Missing relation property ${name}.`);
  }
  return property.id;
}

function typeIdFor(typeName) {
  if (typeName in sharedTypes) return sharedTypes[typeName].id;
  if (typeName in localSchema.typeIds) return localSchema.typeIds[typeName];
  throw new Error(`Unsupported type ${typeName}`);
}

function collectionFor(typeName, { evidenceRole = null } = {}) {
  if (typeName === "Disease" && evidenceRole !== "similarDisease") {
    return collectionItems.diseases;
  }
  if (typeName === "Gene" && evidenceRole !== "expressionGene") {
    return collectionItems.genes;
  }
  if (typeName === "Drug" && evidenceRole === "palliativeDrug") {
    return collectionItems.palliativeDrugs;
  }
  if (typeName === "Drug") return collectionItems.drugs;
  if (typeName === "Drug class") return collectionItems.drugClasses;
  if (typeName === "Pathway") return collectionItems.pathways;
  if (
    typeName === "Biological Process" ||
    typeName === "Molecular Function" ||
    typeName === "Cellular Component"
  ) {
    return collectionItems.goTerms;
  }
  if (typeName === "Symptom") return collectionItems.symptoms;
  if (typeName === "Anatomical structure") return collectionItems.anatomy;
  if (typeName === "Dataset") return collectionItems.datasets;
  if (typeName === "Source") return collectionItems.sources;
  if (typeName === "Paper") return collectionItems.papers;
  return null;
}

function normalizeSourceName(name) {
  if (!name) return null;
  return SOURCE_ALIASES[name] ?? name;
}

function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  for (const rawName of names) {
    const name = normalizeSourceName(rawName);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

async function ensureLocalSchema() {
  for (const typeDefinition of localSchema.types) {
    const existing = findLocalEntity(typeDefinition.name, SystemIds.SCHEMA_TYPE);
    if (existing) {
      localSchema.typeIds[typeDefinition.name] = existing.id;
      typeDefinition.id = existing.id;
      continue;
    }

    const { ops: typeOps } = Graph.createType(typeDefinition);
    ops.push(...typeOps);
    touched.createdLocalTypes.push(typeDefinition.name);
    rememberEntity({
      id: typeDefinition.id,
      name: typeDefinition.name,
      typeIds: [SystemIds.SCHEMA_TYPE],
      spaceIds: [config.targetSpaceId],
    });
  }

  for (const propertyDefinition of allRequiredValueProperties) {
    const existing = findLocalEntity(propertyDefinition.name, SystemIds.PROPERTY);
    if (existing) {
      propertyDefinition.id = existing.id;
      if (localSchema.propertyIds[propertyDefinition.name]) {
        localSchema.propertyIds[propertyDefinition.name] = existing.id;
      }
      if (evidenceSchema.propertyIds[propertyDefinition.name]) {
        evidenceSchema.propertyIds[propertyDefinition.name] = existing.id;
      }
      continue;
    }

    const { ops: propertyOps } = Graph.createProperty(propertyDefinition);
    ops.push(...propertyOps);
    touched.createdLocalProperties.push(propertyDefinition.name);
    rememberEntity({
      id: propertyDefinition.id,
      name: propertyDefinition.name,
      typeIds: [SystemIds.PROPERTY],
      spaceIds: [config.targetSpaceId],
    });
  }

  for (const propertyDefinition of allRequiredRelationProperties) {
    const existing = findLocalEntity(propertyDefinition.name, SystemIds.PROPERTY);
    if (existing) {
      propertyDefinition.id = existing.id;
      if (localSchema.propertyIds[propertyDefinition.name]) {
        localSchema.propertyIds[propertyDefinition.name] = existing.id;
      }
      if (evidenceSchema.propertyIds[propertyDefinition.name]) {
        evidenceSchema.propertyIds[propertyDefinition.name] = existing.id;
      }
      continue;
    }

    const { ops: propertyOps } = Graph.createProperty({
      ...propertyDefinition,
      dataType: "RELATION",
    });
    ops.push(...propertyOps);
    touched.createdLocalProperties.push(propertyDefinition.name);
    rememberEntity({
      id: propertyDefinition.id,
      name: propertyDefinition.name,
      typeIds: [SystemIds.PROPERTY],
      spaceIds: [config.targetSpaceId],
    });
  }
}

function entityValues(entity, typeName) {
  if (typeName === "Disease") {
    return compactValues([
      textValue(localValuePropertyId("Disease Ontology ID"), entity.diseaseOntologyId ?? entity.externalId),
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.diseaseOntologyId ?? entity.externalId
      ),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Gene") {
    return compactValues([
      textValue(localValuePropertyId("Entrez Gene ID"), entity.entrezGeneId ?? entity.externalId),
      textValue(sharedProperties["Source database identifier"].id, entity.entrezGeneId ?? entity.externalId),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Drug") {
    return compactValues([
      textValue(sharedProperties["DrugBank ID"].id, entity.drugBankId ?? entity.externalId),
      textValue(sharedProperties.Inchikey.id, entity.inchikey),
      textValue(localValuePropertyId("InChI"), entity.inchi),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Drug class") {
    return compactValues([
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.sourceDatabaseIdentifier ?? entity.externalId
      ),
      textValue(localValuePropertyId("Class type"), entity.classType),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Pathway") {
    return compactValues([
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.sourceDatabaseIdentifier ?? entity.externalId
      ),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (
    typeName === "Biological Process" ||
    typeName === "Molecular Function" ||
    typeName === "Cellular Component"
  ) {
    return compactValues([
      textValue(localSchema.propertyIds["GO ID"], entity.goId ?? entity.externalId),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Symptom" || typeName === "Anatomical structure") {
    return compactValues([
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.sourceDatabaseIdentifier ?? entity.externalId
      ),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Dataset" || typeName === "Source") {
    return compactValues([
      textValue(sharedProperties.Website.id, entity.website),
      textValue(sharedProperties["Source database identifier"].id, entity.sourceDatabaseIdentifier),
      textValue(sharedProperties["Version ID"].id, entity.version),
      textValue(sharedProperties.DOI.id, entity.doi),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Paper") {
    return compactValues([
      textValue(sharedProperties.DOI.id, entity.doi),
      textValue(sharedProperties.Pmid.id, entity.pmid),
      datetimeValue(sharedProperties["Publish date"].id, entity.publishDate),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(sharedProperties.Abstract.id, entity.description),
    ]);
  }

  return [];
}

async function updateLocalMetadata(entity, values, label) {
  const changed = await updateMissingValues({
    ops,
    entityId: entity.id,
    values,
  });
  if (changed) {
    touched.updatedMetadata.push(label);
  }
}

async function ensureTypedEntity({
  data,
  typeName,
  reuseEntityId = null,
  evidenceRole = null,
}) {
  const cacheKey = `${typeName}:${data.name}:${reuseEntityId ?? ""}`;
  if (resolvedEntities.has(cacheKey)) {
    const cached = resolvedEntities.get(cacheKey);
    collectionFor(typeName, { evidenceRole })?.set(cached.id, cached.name ?? data.name);
    if (evidenceRole === "similarDisease") {
      collectionItems.similarDiseases.set(cached.id, cached.name ?? data.name);
    }
    if (evidenceRole === "expressionGene") {
      collectionItems.expressionGenes.set(cached.id, cached.name ?? data.name);
      collectionItems.genes.set(cached.id, cached.name ?? data.name);
    }
    return cached;
  }

  const typeId = typeIdFor(typeName);
  const values = entityValues(data, typeName);

  if (reuseEntityId) {
    const entity = await fetchEntity(reuseEntityId);
    if (!entity) {
      throw new Error(`Expected reusable entity ${data.name} at ${reuseEntityId}.`);
    }
    const resolved = {
      ...entity,
      name: entity.name ?? data.name,
      ownerSpaceId: ownerSpaceId(
        entity,
        [config.targetSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
        config.targetSpaceId
      ),
    };
    resolvedEntities.set(cacheKey, resolved);
    collectionFor(typeName, { evidenceRole })?.set(resolved.id, resolved.name);
    if (evidenceRole === "similarDisease") {
      collectionItems.similarDiseases.set(resolved.id, resolved.name);
    }
    touched.reusedEntities.push(`${typeName}:${data.name}`);
    return resolved;
  }

  const local = findLocalEntity(data.name, typeId);
  if (local) {
    await updateLocalMetadata(local, values, `${typeName}:${data.name}`);
    const resolved = { ...local, ownerSpaceId: config.targetSpaceId };
    resolvedEntities.set(cacheKey, resolved);
    collectionFor(typeName, { evidenceRole })?.set(resolved.id, resolved.name);
    if (evidenceRole === "similarDisease") {
      collectionItems.similarDiseases.set(resolved.id, resolved.name);
    }
    if (evidenceRole === "expressionGene") {
      collectionItems.expressionGenes.set(resolved.id, resolved.name);
      collectionItems.genes.set(resolved.id, resolved.name);
    }
    return resolved;
  }

  if (!["Dataset", "Source", "Paper"].includes(typeName)) {
    const reused = await findPreferredEntity({
      typeId,
      name: data.name,
      preferredSpaceIds: [config.targetSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
    });

    if (reused) {
      const resolved = {
        ...reused,
        ownerSpaceId: ownerSpaceId(
          reused,
          [config.targetSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
          config.targetSpaceId
        ),
      };
      resolvedEntities.set(cacheKey, resolved);
      collectionFor(typeName, { evidenceRole })?.set(resolved.id, resolved.name);
      if (evidenceRole === "similarDisease") {
        collectionItems.similarDiseases.set(resolved.id, resolved.name);
      }
      if (evidenceRole === "expressionGene") {
        collectionItems.expressionGenes.set(resolved.id, resolved.name);
        collectionItems.genes.set(resolved.id, resolved.name);
      }
      touched.reusedEntities.push(`${typeName}:${data.name}`);
      return resolved;
    }
  }

  const id = deterministicEntityId(config.targetSpaceId, typeName, data.name);
  const { ops: createOps } = Graph.createEntity({
    id,
    name: data.name,
    description: data.description,
    types: [typeId],
    values: uniqueValues(values),
  });
  ops.push(...createOps);
  const entity = {
    id,
    name: data.name,
    description: data.description,
    typeIds: [typeId],
    spaceIds: [config.targetSpaceId],
    ownerSpaceId: config.targetSpaceId,
  };
  rememberEntity(entity);
  resolvedEntities.set(cacheKey, entity);
  collectionFor(typeName, { evidenceRole })?.set(entity.id, entity.name);
  if (evidenceRole === "similarDisease") {
    collectionItems.similarDiseases.set(entity.id, entity.name);
  }
  if (evidenceRole === "expressionGene") {
    collectionItems.expressionGenes.set(entity.id, entity.name);
    collectionItems.genes.set(entity.id, entity.name);
  }
  touched.createdEntities.push(`${typeName}:${data.name}`);
  return entity;
}

async function seedCollectionFromBlock(collectionKey, blockName) {
  const block = findLocalEntity(blockName, SystemIds.DATA_BLOCK);
  if (!block) return;

  const detail = await fetchEntity(block.id);
  for (const relation of detail?.relations?.nodes ?? []) {
    if (
      relation.type?.id === SystemIds.COLLECTION_ITEM_RELATION_TYPE &&
      relation.toEntity?.id
    ) {
      collectionItems[collectionKey].set(
        relation.toEntity.id,
        relation.toEntity.name ?? relation.toEntity.id
      );
    }
  }
}

async function seedCollections() {
  await seedCollectionFromBlock("diseases", "Diseases");
  await seedCollectionFromBlock("genes", "Genes");
  await seedCollectionFromBlock("drugs", "Treating drugs");
  await seedCollectionFromBlock("drugClasses", "Drug classes");
  await seedCollectionFromBlock("pathways", "Pathways");
  await seedCollectionFromBlock("goTerms", "GO annotations");
  await seedCollectionFromBlock("symptoms", "Symptoms");
  await seedCollectionFromBlock("anatomy", "Anatomy evidence");
  await seedCollectionFromBlock("similarDiseases", "Similar diseases");
  await seedCollectionFromBlock("palliativeDrugs", "Palliative drugs");
  await seedCollectionFromBlock("expressionGenes", "Expression genes");
  await seedCollectionFromBlock("datasets", "Datasets");
  await seedCollectionFromBlock("sources", "Sources");
  await seedCollectionFromBlock("papers", "Papers");
  await seedCollectionFromBlock("sourcesAndDatasets", "Sources and datasets");
  await seedCollectionFromBlock("evidenceRelations", "Evidence relations");
}

async function ensureEntitySources(entity, sourceNames, sourceMap, sourceKey) {
  const linked = [];
  for (const sourceName of uniqueNames(sourceNames)) {
    const source = sourceMap.get(sourceName);
    if (!source) {
      throw new Error(`Missing source entity "${sourceName}" while linking ${entity.name}.`);
    }

    const result = await createProvenanceRelation({
      ops,
      config,
      fromEntity: entity,
      typeId: sharedProperties.Sources.id,
      propertyName: "Sources",
      toEntity: source,
      sourceKey: `${sourceKey}:${source.name}`,
      sharedSourcesPropertyId: sharedProperties.Sources.id,
    });
    if (result.created) linked.push(source.name);
  }

  if (linked.length > 0) {
    touched.entitySourceLinks[entity.name ?? entity.id] = linked;
  }
}

function sourceNamesForEntity(entity, typeName) {
  const names = [entity.source, ...(entity.sources ?? [])];

  if (typeName === "Disease") names.push("Disease Ontology");
  if (typeName === "Gene") names.push("Entrez Gene");
  if (typeName === "Drug") names.push("DrugBank");
  if (typeName === "Drug class") names.push("DrugCentral");
  if (typeName === "Pathway") {
    names.push(entity.source);
    if (PATHWAY_SOURCES.has(normalizeSourceName(entity.source))) {
      names.push("Pathway Commons");
    }
  }
  if (
    typeName === "Biological Process" ||
    typeName === "Molecular Function" ||
    typeName === "Cellular Component"
  ) {
    names.push("Gene Ontology", "NCBI gene2go");
  }
  if (typeName === "Symptom") names.push("MeSH", "MEDLINE cooccurrence");
  if (typeName === "Anatomical structure") names.push("Uberon", "MEDLINE cooccurrence");
  if (!["Dataset", "Source", "Paper"].includes(typeName)) names.push("Hetionet v1.0");

  return uniqueNames(names);
}

async function ensureSourceMap() {
  const sourceMap = new Map();

  for (const definition of wave.sources) {
    const entity = await ensureTypedEntity({
      data: definition,
      typeName: definition.type,
    });
    sourceMap.set(definition.name, entity);
    if (definition.type === "Dataset") {
      collectionItems.sourcesAndDatasets.set(entity.id, entity.name);
    } else {
      collectionItems.sourcesAndDatasets.set(entity.id, entity.name);
    }
  }

  for (const paper of wave.papers) {
    const entity = await ensureTypedEntity({
      data: paper,
      typeName: "Paper",
    });
    sourceMap.set(paper.name, entity);
  }

  for (const definition of wave.sources) {
    const entity = sourceMap.get(definition.name);
    await ensureEntitySources(
      entity,
      definition.sources ?? [],
      sourceMap,
      `source-provenance:${definition.name}`
    );
  }

  for (const paper of wave.papers) {
    const entity = sourceMap.get(paper.name);
    await ensureEntitySources(
      entity,
      paper.sources ?? [],
      sourceMap,
      `paper-provenance:${paper.name}`
    );
  }

  return sourceMap;
}

function relationValues(packet, relation) {
  return compactValues([
    textValue(localSchema.propertyIds["Hetionet metaedge"], relation.metaedge),
    booleanValue(localSchema.propertyIds.Unbiased, relation.unbiased),
    textValue(localSchema.propertyIds["Import batch"], packet.importBatch),
    textValue(evidenceSchema.propertyIds["Hetionet edge ID"], relation.hetionetEdgeId),
    textValue(evidenceSchema.propertyIds["Evidence category"], relation.evidenceCategory),
    textValue(evidenceSchema.propertyIds["Source family"], relation.sourceFamily),
    textValue(localValuePropertyId("License"), relation.license),
    floatValue(evidenceSchema.propertyIds["Log2 fold change"], relation.log2FoldChange),
  ]);
}

function sourceNamesForRelation(relation) {
  const names = [
    ...(relation.sourceNames ?? []),
    relation.primarySource,
    "Hetionet v1.0",
    HETIONET_PAPER,
  ];
  if ((relation.sourceNames ?? []).includes("DOAF")) {
    names.push(DOAF_PAPER);
  }
  return uniqueNames(names);
}

function stableRelationSourceKeyName(propertyName) {
  if (propertyName === "Associated with") return "Associated genes";
  if (propertyName === "Includes") return "Includes drug";
  if (propertyName === "Presents with") return "Presents symptom evidence";
  if (propertyName === "Localizes to") return "Localizes to anatomy evidence";
  if (propertyName === "Resembles") return "Resembles disease evidence";
  if (propertyName === "Palliates") return "Palliates disease";
  if (propertyName === "Upregulates") return "Disease upregulates gene";
  if (propertyName === "Downregulates") return "Disease downregulates gene";
  return propertyName;
}

async function resolvePacket(packet, sourceMap) {
  const disease = await ensureTypedEntity({
    data: packet.disease,
    typeName: "Disease",
    reuseEntityId: packet.disease.reuseEntityId,
  });
  await ensureEntitySources(
    disease,
    sourceNamesForEntity(packet.disease, "Disease"),
    sourceMap,
    `disease:${packet.importBatch}:${packet.disease.name}`
  );

  const entities = {
    disease,
    genes: new Map(),
    drugs: new Map(),
    drugClasses: new Map(),
    pathways: new Map(),
    biologicalProcesses: new Map(),
    molecularFunctions: new Map(),
    cellularComponents: new Map(),
    symptoms: new Map(),
    anatomy: new Map(),
    similarDiseases: new Map(),
    palliativeDrugs: new Map(),
    expressionGenes: new Map(),
  };

  async function resolveMany(bucket, typeName, targetMap, evidenceRole = null) {
    for (const data of packet.entities[bucket] ?? []) {
      const entity = await ensureTypedEntity({ data, typeName, evidenceRole });
      targetMap.set(data.name, entity);
      await ensureEntitySources(
        entity,
        sourceNamesForEntity(data, typeName),
        sourceMap,
        `${typeName}:${packet.importBatch}:${data.name}`
      );
    }
  }

  await resolveMany("genes", "Gene", entities.genes);
  await resolveMany("drugs", "Drug", entities.drugs);
  await resolveMany("drugClasses", "Drug class", entities.drugClasses);
  await resolveMany("pathways", "Pathway", entities.pathways);
  await resolveMany("biologicalProcesses", "Biological Process", entities.biologicalProcesses);
  await resolveMany("molecularFunctions", "Molecular Function", entities.molecularFunctions);
  await resolveMany("cellularComponents", "Cellular Component", entities.cellularComponents);
  await resolveMany("symptoms", "Symptom", entities.symptoms);
  await resolveMany("anatomy", "Anatomical structure", entities.anatomy);
  await resolveMany("similarDiseases", "Disease", entities.similarDiseases, "similarDisease");
  await resolveMany("palliativeDrugs", "Drug", entities.palliativeDrugs, "palliativeDrug");
  await resolveMany("expressionGenes", "Gene", entities.expressionGenes, "expressionGene");

  return entities;
}

async function createPacketRelations(packet, entities, sourceMap) {
  const relationCount = {};

  async function addClaim(
    bucket,
    relation,
    fromEntity,
    typeId,
    propertyName,
    toEntity,
    { includeEvidence = true } = {}
  ) {
    if (!fromEntity || !toEntity) {
      throw new Error(`Missing endpoint for ${bucket}: ${relation.from} -> ${relation.to}`);
    }

    const entitySourceIds = sourceNamesForRelation(relation)
      .map((sourceName) => sourceMap.get(sourceName)?.id)
      .filter(Boolean);

    const result = await createProvenanceRelation({
      ops,
      config,
      fromEntity,
      typeId,
      propertyName,
      toEntity,
      sourceKey: `${packet.importBatch}:${relation.hetionetEdgeId}:${stableRelationSourceKeyName(propertyName)}`,
      entityValues: relationValues(packet, relation),
      entitySourceIds,
      sharedSourcesPropertyId: sharedProperties.Sources.id,
    });

    if (includeEvidence) {
      collectionItems.evidenceRelations.set(
        result.entityId,
        `${fromEntity.name} - ${propertyName} - ${toEntity.name}`
      );
    }
    relationCount[bucket] = (relationCount[bucket] ?? 0) + Number(result.created);
  }

  for (const relation of packet.relations.associatedGenes) {
    await addClaim(
      "associatedGenes",
      relation,
      entities.disease,
      relationPropertyId("Associated with"),
      "Associated with",
      entities.genes.get(relation.to)
    );
  }

  for (const relation of packet.relations.treats) {
    await addClaim(
      "treats",
      relation,
      entities.drugs.get(relation.from),
      sharedProperties.Treats.id,
      "Treats",
      entities.disease
    );
    await addClaim(
      "relatedDrugs",
      relation,
      entities.disease,
      sharedProperties["Related drugs"].id,
      "Related drugs",
      entities.drugs.get(relation.from),
      { includeEvidence: false }
    );
  }

  for (const relation of packet.relations.includesDrug) {
    await addClaim(
      "includesDrug",
      relation,
      entities.drugClasses.get(relation.from),
      relationPropertyId("Includes"),
      "Includes",
      entities.drugs.get(relation.to)
    );
  }

  for (const relation of packet.relations.participatesInPathway) {
    await addClaim(
      "participatesInPathway",
      relation,
      entities.genes.get(relation.from),
      relationPropertyId("Participates in pathway"),
      "Participates in pathway",
      entities.pathways.get(relation.to)
    );
  }

  const diseasePathways = new Set();
  for (const relation of packet.relations.participatesInPathway) {
    if (diseasePathways.has(relation.to)) continue;
    diseasePathways.add(relation.to);
    await addClaim(
      "relatedPathways",
      relation,
      entities.disease,
      sharedProperties["Related pathways"].id,
      "Related pathways",
      entities.pathways.get(relation.to),
      { includeEvidence: false }
    );
  }

  for (const relation of packet.relations.participatesInBiologicalProcess) {
    await addClaim(
      "participatesInBiologicalProcess",
      relation,
      entities.genes.get(relation.from),
      relationPropertyId("Participates in biological process"),
      "Participates in biological process",
      entities.biologicalProcesses.get(relation.to)
    );
  }

  for (const relation of packet.relations.hasMolecularFunction) {
    await addClaim(
      "hasMolecularFunction",
      relation,
      entities.genes.get(relation.from),
      relationPropertyId("Has molecular function"),
      "Has molecular function",
      entities.molecularFunctions.get(relation.to)
    );
  }

  for (const relation of packet.relations.locatedInCellularComponent) {
    await addClaim(
      "locatedInCellularComponent",
      relation,
      entities.genes.get(relation.from),
      relationPropertyId("Located in cellular component"),
      "Located in cellular component",
      entities.cellularComponents.get(relation.to)
    );
  }

  for (const relation of packet.relations.symptomEvidence) {
    await addClaim(
      "symptomEvidence",
      relation,
      entities.disease,
      relationPropertyId("Presents with"),
      "Presents with",
      entities.symptoms.get(relation.to)
    );
  }

  for (const relation of packet.relations.anatomyEvidence) {
    await addClaim(
      "anatomyEvidence",
      relation,
      entities.disease,
      relationPropertyId("Localizes to"),
      "Localizes to",
      entities.anatomy.get(relation.to)
    );
  }

  for (const relation of packet.relations.diseaseSimilarityEvidence) {
    await addClaim(
      "diseaseSimilarityEvidence",
      relation,
      entities.disease,
      relationPropertyId("Resembles"),
      "Resembles",
      entities.similarDiseases.get(relation.to)
    );
  }

  for (const relation of packet.relations.palliates) {
    await addClaim(
      "palliates",
      relation,
      entities.palliativeDrugs.get(relation.from),
      relationPropertyId("Palliates"),
      "Palliates",
      entities.disease
    );
  }

  for (const relation of packet.relations.upregulatedGenes) {
    await addClaim(
      "upregulatedGenes",
      relation,
      entities.disease,
      relationPropertyId("Upregulates"),
      "Upregulates",
      entities.expressionGenes.get(relation.to)
    );
  }

  for (const relation of packet.relations.downregulatedGenes) {
    await addClaim(
      "downregulatedGenes",
      relation,
      entities.disease,
      relationPropertyId("Downregulates"),
      "Downregulates",
      entities.expressionGenes.get(relation.to)
    );
  }

  touched.relationCounts[packet.disease.name] = relationCount;
}

function mustFindPage(name) {
  const page = findLocalEntity(name, sharedTypes.Page.id);
  if (!page) {
    throw new Error(`Missing expected page "${name}".`);
  }
  return page;
}

async function publishCollections() {
  const blockConfigs = [
    {
      key: "diseases",
      names: ["Diseases"],
      finalName: "Diseases",
      description:
        "Curated disease packets published in Disease Atlas. Similar diseases are kept in a separate evidence table.",
      attachTo: ["Diseases"],
    },
    {
      key: "genes",
      names: ["Genes", "Asthma genes"],
      finalName: "Genes",
      description:
        "Genes associated with or differentially expressed in curated Disease Atlas disease packets.",
      attachTo: ["Mechanisms"],
    },
    {
      key: "drugs",
      names: ["Treating drugs", "Asthma drugs"],
      finalName: "Treating drugs",
      description: "Drugs imported as treating curated Disease Atlas diseases.",
      attachTo: ["Treatments"],
    },
    {
      key: "drugClasses",
      names: ["Drug classes", "Asthma drug classes"],
      finalName: "Drug classes",
      description: "Pharmacologic classes connected to curated Disease Atlas treatments.",
      attachTo: ["Treatments"],
    },
    {
      key: "pathways",
      names: ["Pathways", "Asthma pathways"],
      finalName: "Pathways",
      description: "Reactome, PID, and WikiPathways pathway context connected to curated disease genes.",
      attachTo: ["Mechanisms"],
    },
    {
      key: "goTerms",
      names: ["GO annotations"],
      finalName: "GO annotations",
      description:
        "Gene Ontology biological process, molecular function, and cellular component terms used in curated packets.",
      attachTo: ["Mechanisms"],
    },
    {
      key: "symptoms",
      names: ["Symptoms"],
      finalName: "Symptoms",
      description:
        "Evidence-only symptom terms linked to Disease Atlas diseases by Hetionet MEDLINE cooccurrence.",
      attachTo: ["Evidence"],
    },
    {
      key: "anatomy",
      names: ["Anatomy evidence"],
      finalName: "Anatomy evidence",
      description:
        "Evidence-only anatomical structures linked to Disease Atlas diseases by Hetionet MEDLINE cooccurrence.",
      attachTo: ["Mechanisms", "Evidence"],
    },
    {
      key: "similarDiseases",
      names: ["Similar diseases"],
      finalName: "Similar diseases",
      description:
        "Disease-similarity evidence imported from Hetionet MEDLINE cooccurrence.",
      attachTo: ["Evidence"],
    },
    {
      key: "palliativeDrugs",
      names: ["Palliative drugs"],
      finalName: "Palliative drugs",
      description:
        "Compounds imported from Hetionet PharmacotherapyDB palliates-disease relations.",
      attachTo: ["Treatments"],
    },
    {
      key: "expressionGenes",
      names: ["Expression genes"],
      finalName: "Expression genes",
      description:
        "Top STARGEO upregulated and downregulated genes for current Disease Atlas diseases.",
      attachTo: ["Mechanisms", "Evidence"],
    },
    {
      key: "evidenceRelations",
      names: ["Evidence relations", "Asthma evidence relations"],
      finalName: "Evidence relations",
      description:
        "Provenance-backed imported relation entities for curated Disease Atlas packets.",
      attachTo: ["Evidence"],
    },
    {
      key: "datasets",
      names: ["Datasets"],
      finalName: "Datasets",
      description: "Dataset entities used as Disease Atlas import sources.",
      attachTo: ["Sources"],
    },
    {
      key: "sources",
      names: ["Sources"],
      finalName: "Sources",
      description: "Primary database, ontology, vocabulary, and evidence sources used by Disease Atlas.",
      attachTo: ["Sources"],
    },
    {
      key: "sourcesAndDatasets",
      names: ["Sources and datasets"],
      finalName: "Sources and datasets",
      description: "Combined source and dataset inventory for provenance review.",
      attachTo: ["Sources"],
    },
    {
      key: "papers",
      names: ["Papers"],
      finalName: "Papers",
      description: "Papers connected to Hetionet, Disease Atlas import sources, and source methods.",
      attachTo: ["Papers"],
    },
  ];

  const blockIds = {};
  for (const blockConfig of blockConfigs) {
    const block = await ensureCollectionBlock({
      ops,
      config,
      currentEntities,
      blockNames: blockConfig.names,
      finalName: blockConfig.finalName,
      description: blockConfig.description,
      itemMap: collectionItems[blockConfig.key],
    });
    blockIds[blockConfig.finalName] = block.id;
    touched.collectionBlocks[blockConfig.finalName] = block;

    for (const pageName of blockConfig.attachTo) {
      const page = mustFindPage(pageName);
      const added = await ensureBlockRelation({
        ops,
        config,
        fromId: page.id,
        blockId: block.id,
        sourceKey: `${pageName}:${blockConfig.finalName}:wave3-block`,
      });
      if (added) touched.attachedBlocks.push(`${pageName}:${blockConfig.finalName}`);
    }
  }

  return blockIds;
}

async function configureColumns(blockIds) {
  const blockColumns = {
    Diseases: [
      localValuePropertyId("Disease Ontology ID"),
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    Genes: [
      localValuePropertyId("Entrez Gene ID"),
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "Treating drugs": [
      sharedProperties["DrugBank ID"].id,
      sharedProperties.Inchikey.id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "Drug classes": [
      sharedProperties["Source database identifier"].id,
      localValuePropertyId("Class type"),
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    Pathways: [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "GO annotations": [
      localSchema.propertyIds["GO ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    Symptoms: [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "Anatomy evidence": [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "Similar diseases": [
      localValuePropertyId("Disease Ontology ID"),
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "Palliative drugs": [
      sharedProperties["DrugBank ID"].id,
      sharedProperties.Inchikey.id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "Expression genes": [
      localValuePropertyId("Entrez Gene ID"),
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localValuePropertyId("License"),
    ],
    "Evidence relations": [
      localSchema.propertyIds["Hetionet metaedge"],
      evidenceSchema.propertyIds["Evidence category"],
      evidenceSchema.propertyIds["Source family"],
      evidenceSchema.propertyIds["Log2 fold change"],
      sharedProperties.Sources.id,
      localSchema.propertyIds["Import batch"],
      evidenceSchema.propertyIds["Hetionet edge ID"],
    ],
    Datasets: [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties["Version ID"].id,
      sharedProperties["Source database identifier"].id,
      localValuePropertyId("License"),
      sharedProperties.Sources.id,
    ],
    Sources: [
      sharedProperties.Website.id,
      sharedProperties["Source database identifier"].id,
      sharedProperties.DOI.id,
      localValuePropertyId("License"),
      sharedProperties.Sources.id,
    ],
    "Sources and datasets": [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties["Source database identifier"].id,
      localValuePropertyId("License"),
      sharedProperties.Sources.id,
    ],
    Papers: [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties.Pmid.id,
      sharedProperties["Publish date"].id,
      sharedProperties.Sources.id,
    ],
  };

  for (const [blockName, columnIds] of Object.entries(blockColumns)) {
    if (!blockIds[blockName]) continue;
    const placements = await configureBlockColumns({
      ops,
      config,
      blockId: blockIds[blockName],
      blockName,
      columnIds,
    });
    if (placements.length > 0) {
      touched.configuredColumns[blockName] = placements;
    }
  }
}

async function updateOverviewGuide() {
  const overviewText = [
    "Disease Atlas now contains eight focused Hetionet-derived disease packets: Asthma, Psoriasis, Rheumatoid arthritis, Breast cancer, Hypertension, Type 2 diabetes mellitus, Alzheimer's disease, and Crohn's disease.",
    "",
    "Use Diseases as the disease-first index, then Treatments, Mechanisms, Evidence, Sources, and Papers to inspect the same graph from different angles. Disease-symptom, disease-anatomy, disease-similarity, and expression rows are evidence-only imports and should be read as traceable source evidence rather than canonical clinical assertions.",
    "",
    "Every imported claim is represented as a relation entity with source links, Hetionet metaedge, import batch, source family, raw Hetionet edge ID, and available numeric values such as STARGEO log2 fold change.",
  ].join("\n");

  const overviewBlockId = await ensureTextBlock({
    ops,
    config,
    key: "Overview guide",
    text: overviewText,
  });

  const added = await ensureBlockRelation({
    ops,
    config,
    fromId: config.targetSpaceEntityId,
    blockId: overviewBlockId,
    sourceKey: "overview-guide-wave3",
  });
  if (added) touched.attachedBlocks.push("Overview:Overview guide");
}

async function resetTabs() {
  const tabProperty = manifest.properties.Tabs;
  if (!tabProperty?.id) return;

  const targetTabs = [
    mustFindPage("Diseases"),
    mustFindPage("Treatments"),
    mustFindPage("Mechanisms"),
    mustFindPage("Evidence"),
    mustFindPage("Sources"),
    mustFindPage("Papers"),
    mustFindPage("Ontology"),
    mustFindPage("About"),
  ];

  const spaceEntity = await fetchEntity(config.targetSpaceEntityId);
  const currentTabs = (spaceEntity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === tabProperty.id
  );

  for (const relation of currentTabs) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  let index = 0;
  let lastPosition = null;
  for (const tab of targetTabs) {
    lastPosition = positionAfter(lastPosition);
    const { ops: relationOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: config.targetSpaceEntityId,
        typeId: tabProperty.id,
        toId: tab.id,
        spaceId: config.targetSpaceId,
        sourceKey: `wave3:${index}:${tab.name}`,
      }),
      fromEntity: config.targetSpaceEntityId,
      toEntity: tab.id,
      type: tabProperty.id,
      position: lastPosition,
    });
    ops.push(...relationOps);
    touched.tabsReset.push(tab.name);
    index += 1;
  }
}

await ensureLocalSchema();
await seedCollections();
const sourceMap = await ensureSourceMap();

for (const packet of wave.packets) {
  const entities = await resolvePacket(packet, sourceMap);
  await createPacketRelations(packet, entities, sourceMap);
}

const blockIds = await publishCollections();
await configureColumns(blockIds);
await updateOverviewGuide();
await resetTabs();

if (ops.length === 0) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: config.dryRun,
        proposalName: PROPOSAL_NAME,
        targetSpaceId: config.targetSpaceId,
        targetSpaceName: config.targetSpaceName,
        opCount: 0,
        opTypes: {},
        touched,
        skipped: "Disease Atlas Wave 3 is already published.",
      },
      null,
      2
    )
  );
  process.exit(0);
}

const result = await finalizeProposal({
  config,
  proposalName: PROPOSAL_NAME,
  ops,
  touched: {
    ...touched,
    expectedInputRelationCounts: Object.fromEntries(
      wave.packets.map((packet) => [packet.disease.name, packet.relationCounts])
    ),
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
