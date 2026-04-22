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
  gql,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import {
  deterministicEntityId,
  deterministicPropertyId,
  deterministicRelationEntityId,
  deterministicRelationId,
  positionAfter,
  relationEntityName,
  sortByPosition,
} from "./lib/ids.mjs";
import { buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const MARKDOWN_CONTENT_PROPERTY_ID = "e3e363d1dd294ccb8e6ff3b76d99bc33";
const ASTHMA_ENTITY_ID = "c1d11a58e7f548fca52da2f8f0642a06";

const PROPOSAL_NAME = "Disease Atlas - Psoriasis and rheumatoid arthritis wave";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const wave = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../data/geo/disease-wave2-packets.json", import.meta.url)),
    "utf8"
  )
);
const asthmaPacket = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../data/geo/asthma-packet.json", import.meta.url)),
    "utf8"
  )
);
const enrichment = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../data/geo/asthma-enrichment.json", import.meta.url)),
    "utf8"
  )
);

const currentEntities = await listSpaceEntities(config.targetSpaceId, 1000);
const pageType = mustGetNamedEntry(manifest.types, "Page", "type");
const paperType = mustGetNamedEntry(manifest.types, "Paper", "type");
const datasetType = mustGetNamedEntry(manifest.types, "Dataset", "type");
const sourceType = mustGetNamedEntry(manifest.types, "Source", "type");
const drugType = mustGetNamedEntry(manifest.types, "Drug", "type");
const drugClassType = mustGetNamedEntry(manifest.types, "Drug class", "type");
const geneType = mustGetNamedEntry(manifest.types, "Gene", "type");
const pathwayType = mustGetNamedEntry(manifest.types, "Pathway", "type");
const diseaseType = mustGetNamedEntry(manifest.types, "Disease", "type");
const sharedSourcesProperty = mustGetNamedEntry(
  manifest.properties,
  "Sources",
  "property"
);
const sharedTreatsProperty = mustGetNamedEntry(
  manifest.properties,
  "Treats",
  "property"
);

const sharedProperties = {
  Website: await mustFindPreferredProperty("Website", [ROOT_SPACE_ID]),
  DOI: await mustFindPreferredProperty("DOI", [ROOT_SPACE_ID]),
  Pmid: await mustFindPreferredProperty("Pmid", [HEALTH_SPACE_ID, ROOT_SPACE_ID]),
  "Publish date": await mustFindPreferredProperty("Publish date", [ROOT_SPACE_ID]),
  Abstract: await mustFindPreferredProperty("Abstract", [ROOT_SPACE_ID]),
  "Source database identifier": await mustFindPreferredProperty(
    "Source database identifier",
    [ROOT_SPACE_ID]
  ),
  "Version ID": await mustFindPreferredProperty("Version ID", [ROOT_SPACE_ID]),
  "DrugBank ID": await mustFindPreferredProperty("DrugBank ID", [HEALTH_SPACE_ID]),
  Inchikey: await mustFindPreferredProperty("Inchikey", [HEALTH_SPACE_ID]),
  "Related drugs": await mustFindPreferredProperty("Related drugs", [
    HEALTH_SPACE_ID,
  ]),
  "Related pathways": await mustFindPreferredProperty("Related pathways", [
    HEALTH_SPACE_ID,
  ]),
};

const localSchema = buildLocalSchema(config.targetSpaceId, {
  Gene: geneType,
  Pathway: pathwayType,
  Drug: drugType,
});

const localValueProperties = [
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

const ops = [];
const touched = {
  checkedSharedOntology: Object.fromEntries(
    Object.entries(sharedProperties).map(([name, property]) => [
      name,
      `${property.id} (${property.spaceIds?.join(",") ?? "unknown"})`,
    ])
  ),
  packets: wave.packets.map((packet) => packet.disease.name),
  createdLocalProperties: [],
  createdEntities: [],
  reusedEntities: [],
  updatedMetadata: [],
  relationCounts: {},
  collectionBlocks: {},
  tabsReset: [],
};

const resolvedEntities = new Map();
const evidenceRelationEntityIds = new Set();
const collectionItems = {
  diseases: new Map([[ASTHMA_ENTITY_ID, "Asthma"]]),
  genes: new Map(),
  drugs: new Map(),
  drugClasses: new Map(),
  pathways: new Map(),
  goTerms: new Map(),
};

async function mustFindPreferredProperty(name, preferredSpaceIds) {
  const property = await findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds: [...preferredSpaceIds, config.targetSpaceId],
  });

  if (!property) {
    throw new Error(`Missing expected shared property "${name}".`);
  }

  return property;
}

function ownerSpaceId(entity, preferredSpaceIds = [HEALTH_SPACE_ID, ROOT_SPACE_ID]) {
  const spaceIds = entity?.ownerSpaceIds ?? entity?.spaceIds ?? [];
  for (const preferredSpaceId of preferredSpaceIds) {
    if (spaceIds.includes(preferredSpaceId)) {
      return preferredSpaceId;
    }
  }
  if (spaceIds.includes(config.targetSpaceId)) {
    return config.targetSpaceId;
  }
  return spaceIds[0] ?? config.targetSpaceId;
}

function typeIdFor(typeName) {
  if (typeName === "Disease") return diseaseType.id;
  if (typeName === "Gene") return geneType.id;
  if (typeName === "Drug") return drugType.id;
  if (typeName === "Drug class") return drugClassType.id;
  if (typeName === "Pathway") return pathwayType.id;
  if (typeName === "Dataset") return datasetType.id;
  if (typeName === "Source") return sourceType.id;
  if (typeName === "Paper") return paperType.id;
  return localSchema.typeIds[typeName];
}

function collectionFor(typeName) {
  if (typeName === "Disease") return collectionItems.diseases;
  if (typeName === "Gene") return collectionItems.genes;
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
  return null;
}

function valueText(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value);
}

function textValue(property, value) {
  const text = valueText(value);
  if (text === null) return null;
  return { property, type: "text", value: text };
}

function datetimeValue(property, value) {
  const text = valueText(value);
  if (text === null) return null;
  return { property, type: "datetime", value: text };
}

function compactValues(values) {
  return values.filter(Boolean);
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((entry) => {
    const key = `${entry.property}:${entry.type}:${entry.value}`;
    if (seen.has(key) || entry.value === null || entry.value === undefined) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function existingValueSet(entity) {
  return new Set(
    (entity?.values?.nodes ?? []).map((value) => {
      const raw =
        value.text ?? value.boolean ?? value.integer ?? value.float ?? value.date ?? "";
      return `${value.property?.id}:${String(raw)}`;
    })
  );
}

function findLocalEntity(name, typeId) {
  return findEntityInSpace(currentEntities, { name, typeId });
}

function localPropertyId(name) {
  return localValueProperties.find((property) => property.name === name)?.id;
}

async function updateMissingValues(entityId, values, label) {
  const entity = await fetchEntity(entityId);
  const existing = existingValueSet(entity);
  const missing = uniqueValues(values).filter(
    (value) => !existing.has(`${value.property}:${String(value.value)}`)
  );

  if (missing.length === 0) {
    return false;
  }

  const { ops: updateOps } = Graph.updateEntity({
    id: entityId,
    values: missing,
  });
  ops.push(...updateOps);
  touched.updatedMetadata.push(label);
  return true;
}

async function ensureLocalProperties() {
  for (const propertyDefinition of localValueProperties) {
    const existing = findLocalEntity(propertyDefinition.name, SystemIds.PROPERTY);

    if (existing) {
      propertyDefinition.id = existing.id;
      continue;
    }

    const { ops: propertyOps } = Graph.createProperty(propertyDefinition);
    ops.push(...propertyOps);
    touched.createdLocalProperties.push(propertyDefinition.name);
    currentEntities.push({
      id: propertyDefinition.id,
      name: propertyDefinition.name,
      typeIds: [SystemIds.PROPERTY],
      spaceIds: [config.targetSpaceId],
    });
  }
}

async function ensureTypedEntity({
  name,
  typeId,
  typeName,
  description,
  values = [],
}) {
  const existing = findLocalEntity(name, typeId);

  if (existing) {
    await updateMissingValues(existing.id, values, `metadata:${typeName}:${name}`);
    if (description) {
      const { ops: updateOps } = Graph.updateEntity({
        id: existing.id,
        description,
      });
      ops.push(...updateOps);
    }
    return {
      ...existing,
      ownerSpaceId: config.targetSpaceId,
    };
  }

  const id = deterministicEntityId(config.targetSpaceId, typeName, name);
  const { ops: createOps } = Graph.createEntity({
    id,
    name,
    description,
    types: [typeId],
    values: uniqueValues(values),
  });
  ops.push(...createOps);

  const entity = {
    id,
    name,
    description,
    typeIds: [typeId],
    spaceIds: [config.targetSpaceId],
    ownerSpaceId: config.targetSpaceId,
  };
  currentEntities.push(entity);
  touched.createdEntities.push(`${typeName}:${name}`);
  return entity;
}

async function resolveEntity({ name, typeName, values = [], description = null, reuseEntityId = null }) {
  const cacheKey = `${typeName}:${name}`;
  if (resolvedEntities.has(cacheKey)) {
    const cached = resolvedEntities.get(cacheKey);
    const collection = collectionFor(typeName);
    collection?.set(cached.id, cached.name);
    return cached;
  }

  const typeId = typeIdFor(typeName);
  const local = findLocalEntity(name, typeId);
  if (local) {
    await updateMissingValues(local.id, values, `metadata:${typeName}:${name}`);
    const resolved = { ...local, ownerSpaceId: config.targetSpaceId };
    resolvedEntities.set(cacheKey, resolved);
    collectionFor(typeName)?.set(resolved.id, resolved.name);
    return resolved;
  }

  if (reuseEntityId) {
    const entity = await fetchEntity(reuseEntityId);
    if (!entity) {
      throw new Error(`Expected reusable ${typeName} ${name} at ${reuseEntityId}.`);
    }
    await updateMissingValues(entity.id, values, `metadata:${typeName}:${name}`);
    const resolved = {
      ...entity,
      ownerSpaceId: ownerSpaceId(entity, [HEALTH_SPACE_ID, ROOT_SPACE_ID]),
    };
    resolvedEntities.set(cacheKey, resolved);
    collectionFor(typeName)?.set(resolved.id, resolved.name ?? name);
    touched.reusedEntities.push(`${typeName}:${name}`);
    return resolved;
  }

  if (typeName !== "Dataset" && typeName !== "Source") {
    const reused = await findPreferredEntity({
      typeId,
      name,
      preferredSpaceIds: [config.targetSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
    });

    if (reused) {
      await updateMissingValues(reused.id, values, `metadata:${typeName}:${name}`);
      const resolved = {
        ...reused,
        ownerSpaceId: ownerSpaceId(reused, [
          config.targetSpaceId,
          HEALTH_SPACE_ID,
          ROOT_SPACE_ID,
        ]),
      };
      resolvedEntities.set(cacheKey, resolved);
      collectionFor(typeName)?.set(resolved.id, resolved.name);
      touched.reusedEntities.push(`${typeName}:${name}`);
      return resolved;
    }
  }

  const created = await ensureTypedEntity({
    name,
    typeId,
    typeName,
    description,
    values,
  });
  resolvedEntities.set(cacheKey, created);
  collectionFor(typeName)?.set(created.id, created.name);
  return created;
}

async function findRelationInTarget({ fromId, typeId, toId }) {
  const data = await gql(`{
    relations(
      first: 1,
      filter: {
        spaceId: { is: "${config.targetSpaceId}" },
        fromEntityId: { is: "${fromId}" },
        typeId: { is: "${typeId}" },
        toEntityId: { is: "${toId}" }
      }
    ) {
      id
      entityId
    }
  }`);

  return (data.relations ?? [])[0] ?? null;
}

async function ensureRelation({
  fromEntity,
  typeId,
  propertyName,
  toEntity,
  sourceKey,
  entityValues = [],
  entitySourceIds = [],
  includeInEvidence = false,
}) {
  const existing = await findRelationInTarget({
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
  });

  if (existing?.entityId) {
    if (includeInEvidence) {
      evidenceRelationEntityIds.add(existing.entityId);
    }
    return { created: false, entityId: existing.entityId };
  }

  const relationId = deterministicRelationId({
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
    spaceId: config.targetSpaceId,
    sourceKey,
  });
  const relationEntityId = deterministicRelationEntityId({
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
    spaceId: config.targetSpaceId,
    sourceKey,
  });

  const entityRelations =
    entitySourceIds.length > 0
      ? {
          [sharedSourcesProperty.id]: entitySourceIds.map((sourceId) => ({
            toEntity: sourceId,
          })),
        }
      : undefined;

  const { ops: relationOps } = Graph.createRelation({
    id: relationId,
    entityId: relationEntityId,
    entityName: relationEntityName(fromEntity.name, propertyName, toEntity.name),
    fromEntity: fromEntity.id,
    toEntity: toEntity.id,
    fromSpace:
      fromEntity.ownerSpaceId && fromEntity.ownerSpaceId !== config.targetSpaceId
        ? fromEntity.ownerSpaceId
        : undefined,
    toSpace:
      toEntity.ownerSpaceId && toEntity.ownerSpaceId !== config.targetSpaceId
        ? toEntity.ownerSpaceId
        : undefined,
    type: typeId,
    entityValues: uniqueValues(entityValues),
    entityRelations,
  });
  ops.push(...relationOps);
  if (includeInEvidence) {
    evidenceRelationEntityIds.add(relationEntityId);
  }
  return { created: true, entityId: relationEntityId };
}

async function ensureEntitySources(entity, sourceNames, sourceMap, sourceKey) {
  for (const sourceName of sourceNames) {
    const source = sourceMap.get(sourceName);
    if (!source) {
      throw new Error(`Missing source entity "${sourceName}" while linking ${entity.name}.`);
    }

    await ensureRelation({
      fromEntity: entity,
      typeId: sharedSourcesProperty.id,
      propertyName: "Sources",
      toEntity: source,
      sourceKey: `${sourceKey}:${source.name}`,
    });
  }
}

function sourceValues(sourceDefinition, localProperties) {
  return compactValues([
    textValue(sharedProperties.Website.id, sourceDefinition.website),
    textValue(
      sharedProperties["Source database identifier"].id,
      sourceDefinition.sourceDatabaseIdentifier
    ),
    textValue(sharedProperties["Version ID"].id, sourceDefinition.version),
    textValue(sharedProperties.DOI.id, sourceDefinition.doi),
    textValue(localProperties.License, sourceDefinition.license),
  ]);
}

function paperValues(paper) {
  return compactValues([
    textValue(sharedProperties.DOI.id, paper.doi),
    textValue(sharedProperties.Pmid.id, paper.pmid),
    datetimeValue(sharedProperties["Publish date"].id, paper.publishDate),
    textValue(sharedProperties.Website.id, paper.website),
    textValue(sharedProperties.Abstract.id, paper.description),
  ]);
}

async function ensureSourceMap(localProperties) {
  const sourceMap = new Map();

  for (const sourceDefinition of enrichment.sources) {
    const typeName = sourceDefinition.type;
    const entity = await resolveEntity({
      name: sourceDefinition.name,
      typeName,
      description: sourceDefinition.description,
      values: sourceValues(sourceDefinition, localProperties),
    });
    sourceMap.set(sourceDefinition.name, entity);
  }

  for (const paper of enrichment.papers) {
    const entity = await resolveEntity({
      name: paper.name,
      typeName: "Paper",
      description: paper.description,
      values: paperValues(paper),
    });
    sourceMap.set(paper.name, entity);
  }

  for (const sourceDefinition of enrichment.sources) {
    const entity = sourceMap.get(sourceDefinition.name);
    await ensureEntitySources(
      entity,
      sourceDefinition.sources ?? [],
      sourceMap,
      `source-provenance:${sourceDefinition.name}`
    );
  }

  for (const paper of enrichment.papers) {
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

function geneValues(gene, localProperties) {
  return compactValues([
    textValue(localProperties["Entrez Gene ID"], gene.entrezGeneId ?? gene.externalId),
    textValue(sharedProperties["Source database identifier"].id, gene.entrezGeneId ?? gene.externalId),
    textValue(sharedProperties.Website.id, gene.website),
    textValue(localProperties.License, gene.license),
  ]);
}

function drugValues(drug, localProperties) {
  return compactValues([
    textValue(sharedProperties["DrugBank ID"].id, drug.drugBankId ?? drug.externalId),
    textValue(sharedProperties.Inchikey.id, drug.inchikey),
    textValue(localProperties.InChI, drug.inchi),
    textValue(sharedProperties.Website.id, drug.website),
    textValue(localProperties.License, drug.license),
  ]);
}

function drugClassValues(drugClass, localProperties) {
  return compactValues([
    textValue(
      sharedProperties["Source database identifier"].id,
      drugClass.sourceDatabaseIdentifier ?? drugClass.externalId
    ),
    textValue(localProperties["Class type"], drugClass.classType),
    textValue(sharedProperties.Website.id, drugClass.website),
    textValue(localProperties.License, drugClass.license),
  ]);
}

function pathwayValues(pathway, localProperties) {
  return compactValues([
    textValue(
      sharedProperties["Source database identifier"].id,
      pathway.sourceDatabaseIdentifier ?? pathway.externalId
    ),
    textValue(sharedProperties.Website.id, pathway.website),
    textValue(localProperties.License, pathway.license),
  ]);
}

function goValues(goTerm, localProperties) {
  return compactValues([
    textValue(localSchema.propertyIds["GO ID"], goTerm.goId ?? goTerm.externalId),
    textValue(sharedProperties.Website.id, goTerm.website),
    textValue(localProperties.License, goTerm.license),
  ]);
}

async function resolvePacketEntities(packet, localProperties) {
  const disease = await resolveEntity({
    name: packet.disease.name,
    typeName: "Disease",
    reuseEntityId: packet.disease.reuseEntityId,
    values: compactValues([
      textValue(localProperties["Disease Ontology ID"], packet.disease.diseaseOntologyId),
      textValue(sharedProperties["Source database identifier"].id, packet.disease.diseaseOntologyId),
      textValue(sharedProperties.Website.id, packet.disease.website),
      textValue(localProperties.License, packet.disease.license),
    ]),
  });

  const entities = {
    disease,
    genes: new Map(),
    drugs: new Map(),
    drugClasses: new Map(),
    pathways: new Map(),
    biologicalProcesses: new Map(),
    molecularFunctions: new Map(),
    cellularComponents: new Map(),
  };

  for (const gene of packet.entities.genes) {
    const entity = await resolveEntity({
      name: gene.name,
      typeName: "Gene",
      description: gene.description,
      values: geneValues(gene, localProperties),
    });
    entities.genes.set(gene.name, entity);
  }

  for (const drug of packet.entities.drugs) {
    const entity = await resolveEntity({
      name: drug.name,
      typeName: "Drug",
      description: drug.description,
      values: drugValues(drug, localProperties),
    });
    entities.drugs.set(drug.name, entity);
  }

  for (const drugClass of packet.entities.drugClasses) {
    const entity = await resolveEntity({
      name: drugClass.name,
      typeName: "Drug class",
      description: drugClass.description,
      values: drugClassValues(drugClass, localProperties),
    });
    entities.drugClasses.set(drugClass.name, entity);
  }

  for (const pathway of packet.entities.pathways) {
    const entity = await resolveEntity({
      name: pathway.name,
      typeName: "Pathway",
      description: pathway.description,
      values: pathwayValues(pathway, localProperties),
    });
    entities.pathways.set(pathway.name, entity);
  }

  for (const process of packet.entities.biologicalProcesses) {
    const entity = await resolveEntity({
      name: process.name,
      typeName: "Biological Process",
      description: process.description,
      values: goValues(process, localProperties),
    });
    entities.biologicalProcesses.set(process.name, entity);
  }

  for (const fn of packet.entities.molecularFunctions) {
    const entity = await resolveEntity({
      name: fn.name,
      typeName: "Molecular Function",
      description: fn.description,
      values: goValues(fn, localProperties),
    });
    entities.molecularFunctions.set(fn.name, entity);
  }

  for (const component of packet.entities.cellularComponents) {
    const entity = await resolveEntity({
      name: component.name,
      typeName: "Cellular Component",
      description: component.description,
      values: goValues(component, localProperties),
    });
    entities.cellularComponents.set(component.name, entity);
  }

  return entities;
}

function relationValues(packet, relation) {
  return compactValues([
    textValue(localSchema.propertyIds["Hetionet metaedge"], relation.metaedge),
    {
      property: localSchema.propertyIds.Unbiased,
      type: "boolean",
      value: Boolean(relation.unbiased),
    },
    textValue(localSchema.propertyIds["Import batch"], packet.importBatch),
  ]);
}

async function createPacketRelations(packet, entities, sourceMap) {
  const primarySourceIds = (relation) => [
    sourceMap.get(relation.primarySource)?.id,
    sourceMap.get("Hetionet v1.0")?.id,
  ].filter(Boolean);

  const relationCount = {};

  async function addRelation(bucket, relation, fromEntity, typeId, propertyName, toEntity) {
    const result = await ensureRelation({
      fromEntity,
      typeId,
      propertyName,
      toEntity,
      sourceKey: `${packet.importBatch}:${relation.primarySource}:${relation.metaedge}`,
      entityValues: relationValues(packet, relation),
      entitySourceIds: primarySourceIds(relation),
      includeInEvidence: true,
    });
    relationCount[bucket] = (relationCount[bucket] ?? 0) + Number(result.created);
  }

  for (const relation of packet.relations.associatedGenes) {
    await addRelation(
      "associatedGenes",
      relation,
      entities.disease,
      localSchema.propertyIds["Associated genes"],
      "Associated genes",
      entities.genes.get(relation.to)
    );
  }

  for (const relation of packet.relations.treats) {
    await addRelation(
      "treats",
      relation,
      entities.drugs.get(relation.from),
      sharedTreatsProperty.id,
      "Treats",
      entities.disease
    );

    await addRelation(
      "relatedDrugs",
      relation,
      entities.disease,
      sharedProperties["Related drugs"].id,
      "Related drugs",
      entities.drugs.get(relation.from)
    );
  }

  for (const relation of packet.relations.includesDrug) {
    await addRelation(
      "includesDrug",
      relation,
      entities.drugClasses.get(relation.from),
      localSchema.propertyIds["Includes drug"],
      "Includes drug",
      entities.drugs.get(relation.to)
    );
  }

  for (const relation of packet.relations.participatesInPathway) {
    await addRelation(
      "participatesInPathway",
      relation,
      entities.genes.get(relation.from),
      localSchema.propertyIds["Participates in pathway"],
      "Participates in pathway",
      entities.pathways.get(relation.to)
    );
  }

  const diseasePathwayRelations = new Set();
  for (const relation of packet.relations.participatesInPathway) {
    if (diseasePathwayRelations.has(relation.to)) continue;
    diseasePathwayRelations.add(relation.to);
    await addRelation(
      "relatedPathways",
      relation,
      entities.disease,
      sharedProperties["Related pathways"].id,
      "Related pathways",
      entities.pathways.get(relation.to)
    );
  }

  for (const relation of packet.relations.participatesInBiologicalProcess) {
    await addRelation(
      "participatesInBiologicalProcess",
      relation,
      entities.genes.get(relation.from),
      localSchema.propertyIds["Participates in biological process"],
      "Participates in biological process",
      entities.biologicalProcesses.get(relation.to)
    );
  }

  for (const relation of packet.relations.hasMolecularFunction) {
    await addRelation(
      "hasMolecularFunction",
      relation,
      entities.genes.get(relation.from),
      localSchema.propertyIds["Has molecular function"],
      "Has molecular function",
      entities.molecularFunctions.get(relation.to)
    );
  }

  for (const relation of packet.relations.locatedInCellularComponent) {
    await addRelation(
      "locatedInCellularComponent",
      relation,
      entities.genes.get(relation.from),
      localSchema.propertyIds["Located in cellular component"],
      "Located in cellular component",
      entities.cellularComponents.get(relation.to)
    );
  }

  touched.relationCounts[packet.disease.name] = relationCount;
}

async function relationTargets(entity, typeId) {
  return new Set(
    (entity?.relations?.nodes ?? [])
      .filter((relation) => relation.type?.id === typeId)
      .map((relation) => relation.toEntity?.id)
      .filter(Boolean)
  );
}

async function ensureCollectionBlock({
  existingNames,
  finalName,
  description,
  itemMap,
}) {
  const existing =
    existingNames
      .map((name) => findLocalEntity(name, SystemIds.DATA_BLOCK))
      .find(Boolean) ?? null;

  const id =
    existing?.id ??
    deterministicEntityId(config.targetSpaceId, "Data block", finalName);
  const detail = existing ? await fetchEntity(existing.id) : null;
  const dataSourceRelations = (detail?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE
  );
  const currentTargets = await relationTargets(
    detail,
    SystemIds.COLLECTION_ITEM_RELATION_TYPE
  );

  if (existing) {
    const { ops: updateOps } = Graph.updateEntity({
      id,
      name: finalName,
      description,
    });
    ops.push(...updateOps);
  } else {
    const { ops: createOps } = Graph.createEntity({
      id,
      name: finalName,
      description,
      types: [SystemIds.DATA_BLOCK],
    });
    ops.push(...createOps);
    currentEntities.push({
      id,
      name: finalName,
      typeIds: [SystemIds.DATA_BLOCK],
      spaceIds: [config.targetSpaceId],
    });
  }

  for (const relation of dataSourceRelations) {
    if (relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE) continue;
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  const hasCollectionSource = dataSourceRelations.some(
    (relation) => relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE
  );

  if (!hasCollectionSource) {
    const { ops: sourceOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: id,
        typeId: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
        toId: SystemIds.COLLECTION_DATA_SOURCE,
        spaceId: config.targetSpaceId,
        sourceKey: `${finalName}:collection-source`,
      }),
      fromEntity: id,
      toEntity: SystemIds.COLLECTION_DATA_SOURCE,
      type: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
    });
    ops.push(...sourceOps);
  }

  let added = 0;
  for (const [itemId, itemName] of itemMap.entries()) {
    if (currentTargets.has(itemId)) continue;
    const { ops: itemOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: id,
        typeId: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
        toId: itemId,
        spaceId: config.targetSpaceId,
        sourceKey: `${finalName}:item:${itemName}`,
      }),
      fromEntity: id,
      toEntity: itemId,
      type: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
    });
    ops.push(...itemOps);
    added += 1;
  }

  touched.collectionBlocks[finalName] = {
    id,
    totalItems: itemMap.size,
    addedItems: added,
  };

  return id;
}

async function configureBlockColumns(blockId, blockName, columnIds) {
  const data = await gql(`{
    relations(
      first: 50,
      filter: {
        typeId: { is: "${SystemIds.BLOCKS}" },
        toEntityId: { is: "${blockId}" }
      }
    ) {
      id
      entityId
      fromEntity { id name }
      entity {
        id
        relations(first: 100) {
          nodes {
            type { id name }
            toEntity { id name }
          }
        }
      }
    }
  }`);

  for (const placement of data.relations ?? []) {
    const placementRelations = placement.entity?.relations?.nodes ?? [];
    const hasTableView = placementRelations.some(
      (relation) =>
        relation.type?.id === SystemIds.VIEW_PROPERTY &&
        relation.toEntity?.id === SystemIds.TABLE_VIEW
    );

    if (!hasTableView) {
      const { ops: viewOps } = Graph.createRelation({
        id: deterministicRelationId({
          fromId: placement.entityId,
          typeId: SystemIds.VIEW_PROPERTY,
          toId: SystemIds.TABLE_VIEW,
          spaceId: config.targetSpaceId,
          sourceKey: `${blockName}:table-view`,
        }),
        fromEntity: placement.entityId,
        toEntity: SystemIds.TABLE_VIEW,
        type: SystemIds.VIEW_PROPERTY,
      });
      ops.push(...viewOps);
    }

    let lastPosition = null;
    for (const columnId of columnIds.filter(Boolean)) {
      const hasColumn = placementRelations.some(
        (relation) =>
          relation.type?.id === SystemIds.SHOWN_COLUMNS &&
          relation.toEntity?.id === columnId
      );
      if (hasColumn) continue;

      lastPosition = positionAfter(lastPosition);
      const { ops: columnOps } = Graph.createRelation({
        id: deterministicRelationId({
          fromId: placement.entityId,
          typeId: SystemIds.SHOWN_COLUMNS,
          toId: columnId,
          spaceId: config.targetSpaceId,
          sourceKey: `${blockName}:shown-column:${columnId}`,
        }),
        fromEntity: placement.entityId,
        toEntity: columnId,
        type: SystemIds.SHOWN_COLUMNS,
        position: lastPosition,
      });
      ops.push(...columnOps);
    }
  }
}

async function ensureTextBlock({ key, text }) {
  const id = deterministicEntityId(config.targetSpaceId, "Text block", key);
  const existing = await fetchEntity(id);

  if (existing) {
    const { ops: updateOps } = Graph.updateEntity({
      id,
      values: [
        {
          property: MARKDOWN_CONTENT_PROPERTY_ID,
          type: "text",
          value: text,
        },
      ],
    });
    ops.push(...updateOps);
    return id;
  }

  const { ops: createOps } = Graph.createEntity({
    id,
    types: [SystemIds.TEXT_BLOCK],
    values: [
      {
        property: MARKDOWN_CONTENT_PROPERTY_ID,
        type: "text",
        value: text,
      },
    ],
  });
  ops.push(...createOps);
  return id;
}

async function ensureBlockRelation(fromId, blockId, sourceKey) {
  const fromEntity = await fetchEntity(fromId);
  const currentBlockRelations = (fromEntity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.BLOCKS
  );

  if (currentBlockRelations.some((relation) => relation.toEntity?.id === blockId)) {
    return;
  }

  const lastPosition = sortByPosition(currentBlockRelations).at(-1)?.position ?? null;
  const { ops: blockOps } = Graph.createRelation({
    id: deterministicRelationId({
      fromId,
      typeId: SystemIds.BLOCKS,
      toId: blockId,
      spaceId: config.targetSpaceId,
      sourceKey,
    }),
    fromEntity: fromId,
    toEntity: blockId,
    type: SystemIds.BLOCKS,
    position: positionAfter(lastPosition),
  });
  ops.push(...blockOps);
}

async function resetTabs(tabTargets) {
  const spaceEntity = await fetchEntity(config.targetSpaceEntityId);
  const currentTabs = (spaceEntity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === manifest.properties.Tabs.id
  );

  for (const relation of currentTabs) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  let lastPosition = null;
  for (const tab of tabTargets) {
    lastPosition = positionAfter(lastPosition);
    const { ops: tabOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: config.targetSpaceEntityId,
        typeId: manifest.properties.Tabs.id,
        toId: tab.id,
        spaceId: config.targetSpaceId,
        sourceKey: `tab:${tab.name}:immune-wave`,
      }),
      fromEntity: config.targetSpaceEntityId,
      toEntity: tab.id,
      type: manifest.properties.Tabs.id,
      position: lastPosition,
    });
    ops.push(...tabOps);
    touched.tabsReset.push(tab.name);
  }
}

await ensureLocalProperties();

const localProperties = {
  "Disease Ontology ID": localPropertyId("Disease Ontology ID"),
  "Entrez Gene ID": localPropertyId("Entrez Gene ID"),
  License: localPropertyId("License"),
  InChI: localPropertyId("InChI"),
  "Class type": localPropertyId("Class type"),
};

const sourceMap = await ensureSourceMap(localProperties);

await resolvePacketEntities(asthmaPacket, localProperties);

for (const packet of wave.packets) {
  const entities = await resolvePacketEntities(packet, localProperties);

  await ensureEntitySources(
    entities.disease,
    packet.disease.sources ?? ["Disease Ontology", "DISEASES", "Hetionet v1.0"],
    sourceMap,
    `disease:${packet.disease.name}`
  );

  for (const entity of entities.genes.values()) {
    await ensureEntitySources(
      entity,
      ["Entrez Gene", "DISEASES", "Hetionet v1.0"],
      sourceMap,
      `gene:${packet.importBatch}:${entity.name}`
    );
  }

  for (const entity of entities.drugs.values()) {
    await ensureEntitySources(
      entity,
      ["DrugBank", "PharmacotherapyDB", "Hetionet v1.0"],
      sourceMap,
      `drug:${packet.importBatch}:${entity.name}`
    );
  }

  for (const entity of entities.drugClasses.values()) {
    await ensureEntitySources(
      entity,
      ["DrugCentral", "Hetionet v1.0"],
      sourceMap,
      `drug-class:${packet.importBatch}:${entity.name}`
    );
  }

  for (const entity of entities.pathways.values()) {
    await ensureEntitySources(
      entity,
      ["Reactome", "Hetionet v1.0"],
      sourceMap,
      `pathway:${packet.importBatch}:${entity.name}`
    );
  }

  for (const entity of [
    ...entities.biologicalProcesses.values(),
    ...entities.molecularFunctions.values(),
    ...entities.cellularComponents.values(),
  ]) {
    await ensureEntitySources(
      entity,
      ["Gene Ontology", "NCBI gene2go", "Hetionet v1.0"],
      sourceMap,
      `go:${packet.importBatch}:${entity.name}`
    );
  }

  await createPacketRelations(packet, entities, sourceMap);
}

const diseaseBlockId = await ensureCollectionBlock({
  existingNames: ["Diseases"],
  finalName: "Diseases",
  description:
    "Curated disease packets published in Disease Atlas, starting with immune and inflammatory diseases.",
  itemMap: collectionItems.diseases,
});
const geneBlockId = await ensureCollectionBlock({
  existingNames: ["Genes", "Asthma genes"],
  finalName: "Genes",
  description: "Genes associated with the curated Disease Atlas disease packets.",
  itemMap: collectionItems.genes,
});
const drugBlockId = await ensureCollectionBlock({
  existingNames: ["Treating drugs", "Asthma drugs"],
  finalName: "Treating drugs",
  description: "Drugs imported as treating curated Disease Atlas diseases.",
  itemMap: collectionItems.drugs,
});
const drugClassBlockId = await ensureCollectionBlock({
  existingNames: ["Drug classes", "Asthma drug classes"],
  finalName: "Drug classes",
  description: "Pharmacologic classes connected to curated Disease Atlas treatments.",
  itemMap: collectionItems.drugClasses,
});
const pathwayBlockId = await ensureCollectionBlock({
  existingNames: ["Pathways", "Asthma pathways"],
  finalName: "Pathways",
  description: "Reactome pathway context connected to curated disease genes.",
  itemMap: collectionItems.pathways,
});
const goBlockId = await ensureCollectionBlock({
  existingNames: ["GO annotations"],
  finalName: "GO annotations",
  description:
    "Gene Ontology biological process, molecular function, and cellular component terms used in curated packets.",
  itemMap: collectionItems.goTerms,
});

const evidenceItemMap = new Map(
  [...evidenceRelationEntityIds].map((id) => [id, id])
);
const evidenceBlockId = await ensureCollectionBlock({
  existingNames: ["Evidence relations", "Asthma evidence relations"],
  finalName: "Evidence relations",
  description:
    "Provenance-backed imported relation entities for the curated Disease Atlas packets.",
  itemMap: evidenceItemMap,
});

const overviewText = [
  "Disease Atlas now starts with three curated Hetionet-derived immune and inflammatory disease packets: Asthma, Psoriasis, and Rheumatoid arthritis.",
  "",
  "Use the disease tabs for disease-first exploration, then Treatments, Mechanisms, Evidence, Sources, and Papers to inspect the graph by relation type and provenance. MEDLINE cooccurrence symptoms, anatomy, resemblance, and differential-expression edges remain held back for review.",
].join("\n");

const overviewBlockId = await ensureTextBlock({
  key: "Overview guide",
  text: overviewText,
});

const pages = {
  Diseases: findLocalEntity("Diseases", pageType.id),
  Mechanisms: findLocalEntity("Mechanisms", pageType.id),
  Treatments: findLocalEntity("Treatments", pageType.id),
  Evidence: findLocalEntity("Evidence", pageType.id),
  Sources: findLocalEntity("Sources", pageType.id),
  Papers: findLocalEntity("Papers", pageType.id),
  Ontology: findLocalEntity("Ontology", pageType.id),
  About: findLocalEntity("About", pageType.id),
};

await ensureBlockRelation(config.targetSpaceEntityId, overviewBlockId, "overview-guide-wave2");
await ensureBlockRelation(config.targetSpaceEntityId, diseaseBlockId, "overview-diseases-wave2");
await ensureBlockRelation(config.targetSpaceEntityId, geneBlockId, "overview-genes-wave2");
await ensureBlockRelation(config.targetSpaceEntityId, drugBlockId, "overview-drugs-wave2");
await ensureBlockRelation(config.targetSpaceEntityId, pathwayBlockId, "overview-pathways-wave2");

await ensureBlockRelation(pages.Diseases.id, diseaseBlockId, "diseases-table-wave2");
await ensureBlockRelation(pages.Mechanisms.id, geneBlockId, "mechanisms-genes-wave2");
await ensureBlockRelation(pages.Mechanisms.id, pathwayBlockId, "mechanisms-pathways-wave2");
await ensureBlockRelation(pages.Mechanisms.id, goBlockId, "mechanisms-go-wave2");
await ensureBlockRelation(pages.Treatments.id, drugBlockId, "treatments-drugs-wave2");
await ensureBlockRelation(pages.Treatments.id, drugClassBlockId, "treatments-drug-classes-wave2");
await ensureBlockRelation(pages.Evidence.id, evidenceBlockId, "evidence-relations-wave2");

const blockColumns = {
  Diseases: {
    id: diseaseBlockId,
    columns: [
      localProperties["Disease Ontology ID"],
      sharedProperties.Website.id,
      sharedSourcesProperty.id,
      localProperties.License,
    ],
  },
  Genes: {
    id: geneBlockId,
    columns: [
      localProperties["Entrez Gene ID"],
      sharedProperties.Website.id,
      sharedSourcesProperty.id,
      localProperties.License,
    ],
  },
  "Treating drugs": {
    id: drugBlockId,
    columns: [
      sharedProperties["DrugBank ID"].id,
      sharedProperties.Inchikey.id,
      sharedProperties.Website.id,
      sharedSourcesProperty.id,
      localProperties.License,
    ],
  },
  "Drug classes": {
    id: drugClassBlockId,
    columns: [
      sharedProperties["Source database identifier"].id,
      localProperties["Class type"],
      sharedProperties.Website.id,
      sharedSourcesProperty.id,
      localProperties.License,
    ],
  },
  Pathways: {
    id: pathwayBlockId,
    columns: [
      sharedProperties["Source database identifier"].id,
      sharedSourcesProperty.id,
      localProperties.License,
    ],
  },
  "GO annotations": {
    id: goBlockId,
    columns: [
      localSchema.propertyIds["GO ID"],
      sharedProperties.Website.id,
      sharedSourcesProperty.id,
      localProperties.License,
    ],
  },
  "Evidence relations": {
    id: evidenceBlockId,
    columns: [
      localSchema.propertyIds["Hetionet metaedge"],
      localSchema.propertyIds.Unbiased,
      sharedSourcesProperty.id,
      localSchema.propertyIds["Import batch"],
    ],
  },
};

for (const [blockName, spec] of Object.entries(blockColumns)) {
  await configureBlockColumns(spec.id, blockName, spec.columns);
}

const psoriasis = await resolveEntity({
  name: "Psoriasis",
  typeName: "Disease",
  reuseEntityId: "1bd0dae46c25444d8d923e67dd421645",
});
const rheumatoidArthritis = await resolveEntity({
  name: "Rheumatoid arthritis",
  typeName: "Disease",
  reuseEntityId: "a9fbd2d46b235e259d2f671bd8c20a62",
});

await resetTabs([
  { name: "Diseases", id: pages.Diseases.id },
  { name: "Asthma", id: ASTHMA_ENTITY_ID },
  { name: "Psoriasis", id: psoriasis.id },
  { name: "Rheumatoid arthritis", id: rheumatoidArthritis.id },
  { name: "Treatments", id: pages.Treatments.id },
  { name: "Mechanisms", id: pages.Mechanisms.id },
  { name: "Evidence", id: pages.Evidence.id },
  { name: "Sources", id: pages.Sources.id },
  { name: "Papers", id: pages.Papers.id },
  { name: "Ontology", id: pages.Ontology.id },
  { name: "About", id: pages.About.id },
]);

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
        skipped: "Disease Atlas wave is already published.",
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
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
