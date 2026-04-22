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
} from "./lib/ids.mjs";
import { buildEvidenceSchema, buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";
import {
  booleanValue,
  compactValues,
  createProvenanceRelation,
  ensureBlockRelation,
  ensureCollectionBlock,
  floatValue,
  ownerSpaceId,
  textValue,
  uniqueValues,
  updateMissingValues,
} from "./lib/proposal-utils.mjs";

const PROPOSAL_NAME = "Disease Atlas - Three disease evidence enrichment";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const evidenceInput = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../data/geo/three-disease-evidence.json", import.meta.url)),
    "utf8"
  )
);
const enrichment = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../data/geo/asthma-enrichment.json", import.meta.url)),
    "utf8"
  )
);

const currentEntities = await listSpaceEntities(config.targetSpaceId, 2000);
const ops = [];
const touched = {
  checkedSharedOntology: {},
  createdLocalProperties: [],
  createdEntities: [],
  reusedEntities: [],
  updatedMetadata: [],
  sources: [],
  relationCounts: {},
  collectionBlocks: {},
  attachedBlocks: [],
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

  touched.checkedSharedOntology[`type:${name}`] = `${entity.id} (${entity.spaceIds?.join(",")})`;
  return entity;
}

async function mustFindProperty(name, preferredSpaceIds = [ROOT_SPACE_ID, HEALTH_SPACE_ID]) {
  const entity = await findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds: [...preferredSpaceIds, config.targetSpaceId],
  });

  if (!entity) {
    throw new Error(`Missing expected property "${name}".`);
  }

  touched.checkedSharedOntology[`property:${name}`] = `${entity.id} (${entity.spaceIds?.join(",")})`;
  return entity;
}

const sharedTypes = {
  Disease: mustGetNamedEntry(manifest.types, "Disease", "type"),
  Drug: mustGetNamedEntry(manifest.types, "Drug", "type"),
  Gene: mustGetNamedEntry(manifest.types, "Gene", "type"),
  Pathway: mustGetNamedEntry(manifest.types, "Pathway", "type"),
  Dataset: mustGetNamedEntry(manifest.types, "Dataset", "type"),
  Source: mustGetNamedEntry(manifest.types, "Source", "type"),
  Symptom: await mustFindType("Symptom", HEALTH_SPACE_ID),
  "Anatomical structure": await mustFindType(
    "Anatomical structure",
    HEALTH_SPACE_ID
  ),
};

const sharedProperties = {
  Sources: mustGetNamedEntry(manifest.properties, "Sources", "property"),
  Website: await mustFindProperty("Website", [ROOT_SPACE_ID]),
  "Source database identifier": await mustFindProperty(
    "Source database identifier",
    [ROOT_SPACE_ID]
  ),
  "Version ID": await mustFindProperty("Version ID", [ROOT_SPACE_ID]),
  DOI: await mustFindProperty("DOI", [ROOT_SPACE_ID]),
  "DrugBank ID": await mustFindProperty("DrugBank ID", [HEALTH_SPACE_ID]),
  Inchikey: await mustFindProperty("Inchikey", [HEALTH_SPACE_ID]),
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
].map((property) => ({
  id: deterministicPropertyId(config.targetSpaceId, property.name),
  dataType: "TEXT",
  ...property,
}));

const allRequiredValueProperties = [
  ...supportingLocalProperties,
  ...evidenceSchema.valueProperties,
];
const allRequiredRelationProperties = evidenceSchema.relationProperties;

function findLocalEntity(name, typeId) {
  return findEntityInSpace(currentEntities, { name, typeId });
}

function typeIdFor(typeName) {
  if (typeName === "Disease") return sharedTypes.Disease.id;
  if (typeName === "Drug") return sharedTypes.Drug.id;
  if (typeName === "Gene") return sharedTypes.Gene.id;
  if (typeName === "Symptom") return sharedTypes.Symptom.id;
  if (typeName === "Anatomical structure") {
    return sharedTypes["Anatomical structure"].id;
  }
  if (typeName === "Dataset") return sharedTypes.Dataset.id;
  if (typeName === "Source") return sharedTypes.Source.id;
  throw new Error(`Unsupported type ${typeName}`);
}

function localValuePropertyId(name) {
  const property = allRequiredValueProperties.find((entry) => entry.name === name);
  if (property) return property.id;
  if (name === "GO ID") return localSchema.propertyIds["GO ID"];
  throw new Error(`Missing local value property ${name}.`);
}

function relationPropertyId(name) {
  const property = allRequiredRelationProperties.find((entry) => entry.name === name);
  if (!property) {
    throw new Error(`Missing evidence relation property ${name}.`);
  }
  return property.id;
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

async function ensureLocalProperties() {
  for (const propertyDefinition of allRequiredValueProperties) {
    const existing = findLocalEntity(propertyDefinition.name, SystemIds.PROPERTY);
    if (existing) continue;

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
    if (existing) continue;

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

  return [];
}

async function ensureTypedEntity({ data, typeName, reuseEntityId = null }) {
  const typeId = typeIdFor(typeName);
  const values = entityValues(data, typeName);

  if (reuseEntityId) {
    const entity = await fetchEntity(reuseEntityId);
    if (!entity) {
      throw new Error(`Expected reusable entity ${data.name} at ${reuseEntityId}.`);
    }
    const changed = await updateMissingValues({
      ops,
      entityId: entity.id,
      values,
    });
    if (changed) touched.updatedMetadata.push(`${typeName}:${data.name}`);
    touched.reusedEntities.push(`${typeName}:${data.name}`);
    return {
      ...entity,
      ownerSpaceId: ownerSpaceId(entity, [HEALTH_SPACE_ID, ROOT_SPACE_ID], config.targetSpaceId),
      name: entity.name ?? data.name,
    };
  }

  const local = findLocalEntity(data.name, typeId);
  if (local) {
    const changed = await updateMissingValues({
      ops,
      entityId: local.id,
      values,
    });
    if (changed) touched.updatedMetadata.push(`${typeName}:${data.name}`);
    return {
      ...local,
      ownerSpaceId: config.targetSpaceId,
    };
  }

  if (typeName !== "Dataset" && typeName !== "Source") {
    const reused = await findPreferredEntity({
      typeId,
      name: data.name,
      preferredSpaceIds: [config.targetSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
    });

    if (reused) {
      const changed = await updateMissingValues({
        ops,
        entityId: reused.id,
        values,
      });
      if (changed) touched.updatedMetadata.push(`${typeName}:${data.name}`);
      touched.reusedEntities.push(`${typeName}:${data.name}`);
      return {
        ...reused,
        ownerSpaceId: ownerSpaceId(
          reused,
          [config.targetSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
          config.targetSpaceId
        ),
      };
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
  touched.createdEntities.push(`${typeName}:${data.name}`);
  return entity;
}

async function ensureSourceMap() {
  const sourceMap = new Map();
  const sourceDefinitions = [...enrichment.sources, ...evidenceInput.sources];

  for (const definition of sourceDefinitions) {
    const entity = await ensureTypedEntity({
      data: definition,
      typeName: definition.type,
    });
    sourceMap.set(definition.name, entity);
    touched.sources.push(definition.name);
  }

  for (const definition of sourceDefinitions) {
    const sourceEntity = sourceMap.get(definition.name);
    for (const sourceName of definition.sources ?? []) {
      const target = sourceMap.get(sourceName);
      if (!target) continue;
      await createProvenanceRelation({
        ops,
        config,
        fromEntity: sourceEntity,
        typeId: sharedProperties.Sources.id,
        propertyName: "Sources",
        toEntity: target,
        sourceKey: `source-provenance:${definition.name}:${sourceName}`,
        sharedSourcesPropertyId: sharedProperties.Sources.id,
      });
    }
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

async function resolvePacket(packet, collections) {
  const disease = await ensureTypedEntity({
    data: packet.disease,
    typeName: "Disease",
    reuseEntityId: packet.disease.reuseEntityId,
  });

  const resolved = {
    disease,
    symptoms: new Map(),
    anatomy: new Map(),
    similarDiseases: new Map(),
    palliativeDrugs: new Map(),
    expressionGenes: new Map(),
  };

  for (const symptom of packet.entities.symptoms) {
    const entity = await ensureTypedEntity({ data: symptom, typeName: "Symptom" });
    resolved.symptoms.set(symptom.name, entity);
    collections.symptoms.set(entity.id, entity.name);
  }

  for (const anatomy of packet.entities.anatomy) {
    const entity = await ensureTypedEntity({
      data: anatomy,
      typeName: "Anatomical structure",
    });
    resolved.anatomy.set(anatomy.name, entity);
    collections.anatomy.set(entity.id, entity.name);
  }

  for (const diseaseData of packet.entities.similarDiseases) {
    const entity = await ensureTypedEntity({
      data: diseaseData,
      typeName: "Disease",
      reuseEntityId: diseaseData.reuseEntityId,
    });
    resolved.similarDiseases.set(diseaseData.name, entity);
    collections.similarDiseases.set(entity.id, entity.name);
  }

  for (const drug of packet.entities.palliativeDrugs) {
    const entity = await ensureTypedEntity({ data: drug, typeName: "Drug" });
    resolved.palliativeDrugs.set(drug.name, entity);
    collections.palliativeDrugs.set(entity.id, entity.name);
  }

  for (const gene of packet.entities.expressionGenes) {
    const entity = await ensureTypedEntity({ data: gene, typeName: "Gene" });
    resolved.expressionGenes.set(gene.name, entity);
    collections.expressionGenes.set(entity.id, entity.name);
    collections.genes.set(entity.id, entity.name);
  }

  return resolved;
}

async function createPacketRelations(packet, entities, sourceMap, collections) {
  const created = {};
  async function addEvidence(bucket, relation, fromEntity, typeId, propertyName, toEntity) {
    if (!fromEntity || !toEntity) {
      throw new Error(`Missing endpoint for ${bucket}: ${relation.from} -> ${relation.to}`);
    }
    const sourceIds = [
      sourceMap.get(relation.primarySource)?.id,
      sourceMap.get("Hetionet v1.0")?.id,
    ].filter(Boolean);
    const result = await createProvenanceRelation({
      ops,
      config,
      fromEntity,
      typeId,
      propertyName,
      toEntity,
      sourceKey: `${packet.importBatch}:${relation.hetionetEdgeId}`,
      entityValues: relationValues(packet, relation),
      entitySourceIds: sourceIds,
      sharedSourcesPropertyId: sharedProperties.Sources.id,
    });
    collections.evidenceRelations.set(result.entityId, `${relation.from} - ${propertyName} - ${relation.to}`);
    created[bucket] = (created[bucket] ?? 0) + Number(result.created);
  }

  for (const relation of packet.relations.symptomEvidence) {
    await addEvidence(
      "symptomEvidence",
      relation,
      entities.disease,
      relationPropertyId("Presents with"),
      "Presents with",
      entities.symptoms.get(relation.to)
    );
  }

  for (const relation of packet.relations.anatomyEvidence) {
    await addEvidence(
      "anatomyEvidence",
      relation,
      entities.disease,
      relationPropertyId("Localizes to"),
      "Localizes to",
      entities.anatomy.get(relation.to)
    );
  }

  for (const relation of packet.relations.diseaseSimilarityEvidence) {
    await addEvidence(
      "diseaseSimilarityEvidence",
      relation,
      entities.disease,
      relationPropertyId("Resembles"),
      "Resembles",
      entities.similarDiseases.get(relation.to)
    );
  }

  for (const relation of packet.relations.palliates) {
    await addEvidence(
      "palliates",
      relation,
      entities.palliativeDrugs.get(relation.from),
      relationPropertyId("Palliates"),
      "Palliates",
      entities.disease
    );
  }

  for (const relation of packet.relations.upregulatedGenes) {
    await addEvidence(
      "upregulatedGenes",
      relation,
      entities.disease,
      relationPropertyId("Upregulates"),
      "Upregulates",
      entities.expressionGenes.get(relation.to)
    );
  }

  for (const relation of packet.relations.downregulatedGenes) {
    await addEvidence(
      "downregulatedGenes",
      relation,
      entities.disease,
      relationPropertyId("Downregulates"),
      "Downregulates",
      entities.expressionGenes.get(relation.to)
    );
  }

  touched.relationCounts[packet.disease.name] = created;
}

function existingCollectionItems(blockName) {
  const block = currentEntities.find(
    (entity) =>
      entity.name === blockName && entity.typeIds?.includes(SystemIds.DATA_BLOCK)
  );
  return block ? block.id : null;
}

async function buildCollections() {
  const collections = {
    symptoms: new Map(),
    anatomy: new Map(),
    similarDiseases: new Map(),
    palliativeDrugs: new Map(),
    expressionGenes: new Map(),
    genes: new Map(),
    evidenceRelations: new Map(),
  };

  const genesBlock = existingCollectionItems("Genes");
  if (genesBlock) {
    const detail = await fetchEntity(genesBlock);
    for (const relation of detail.relations?.nodes ?? []) {
      if (relation.type?.id === SystemIds.COLLECTION_ITEM_RELATION_TYPE && relation.toEntity?.id) {
        collections.genes.set(relation.toEntity.id, relation.toEntity.name);
      }
    }
  }

  const evidenceBlock = existingCollectionItems("Evidence relations");
  if (evidenceBlock) {
    const detail = await fetchEntity(evidenceBlock);
    for (const relation of detail.relations?.nodes ?? []) {
      if (relation.type?.id === SystemIds.COLLECTION_ITEM_RELATION_TYPE && relation.toEntity?.id) {
        collections.evidenceRelations.set(relation.toEntity.id, relation.toEntity.name);
      }
    }
  }

  return collections;
}

async function publishCollections(collections) {
  const blockConfigs = [
    {
      names: ["Properties"],
      finalName: "Properties",
      description: "Local Disease Atlas properties, including the evidence-only ontology delta.",
      items: new Map(
        currentEntities
          .filter((entity) => entity.typeIds?.includes(SystemIds.PROPERTY))
          .map((entity) => [entity.id, entity.name])
      ),
      attachTo: [],
    },
    {
      names: ["Symptoms"],
      finalName: "Symptoms",
      description:
        "Evidence-only symptom terms linked to Disease Atlas diseases by Hetionet MEDLINE cooccurrence.",
      items: collections.symptoms,
      attachTo: ["Evidence"],
    },
    {
      names: ["Anatomy evidence"],
      finalName: "Anatomy evidence",
      description:
        "Evidence-only anatomical structures linked to Disease Atlas diseases by Hetionet MEDLINE cooccurrence.",
      items: collections.anatomy,
      attachTo: ["Evidence", "Mechanisms"],
    },
    {
      names: ["Similar diseases"],
      finalName: "Similar diseases",
      description:
        "Disease-similarity evidence imported from Hetionet MEDLINE cooccurrence.",
      items: collections.similarDiseases,
      attachTo: ["Evidence"],
    },
    {
      names: ["Palliative drugs"],
      finalName: "Palliative drugs",
      description:
        "Compounds imported from Hetionet PharmacotherapyDB palliates-disease relations.",
      items: collections.palliativeDrugs,
      attachTo: ["Treatments"],
    },
    {
      names: ["Expression genes"],
      finalName: "Expression genes",
      description:
        "Top STARGEO upregulated and downregulated genes for current Disease Atlas diseases.",
      items: collections.expressionGenes,
      attachTo: ["Mechanisms", "Evidence"],
    },
    {
      names: ["Genes"],
      finalName: "Genes",
      description:
        "Genes associated with or differentially expressed in curated Disease Atlas disease packets.",
      items: collections.genes,
      attachTo: [],
    },
    {
      names: ["Evidence relations"],
      finalName: "Evidence relations",
      description:
        "Provenance-backed imported relation entities for curated Disease Atlas packets.",
      items: collections.evidenceRelations,
      attachTo: [],
    },
  ];

  for (const blockConfig of blockConfigs) {
    const block = await ensureCollectionBlock({
      ops,
      config,
      currentEntities,
      blockNames: blockConfig.names,
      finalName: blockConfig.finalName,
      description: blockConfig.description,
      itemMap: blockConfig.items,
    });
    touched.collectionBlocks[block.finalName ?? blockConfig.finalName] = block;

    for (const pageName of blockConfig.attachTo) {
      const page = currentEntities.find(
        (entity) =>
          entity.name === pageName && entity.typeIds?.includes(SystemIds.PAGE_TYPE)
      );
      if (!page) continue;
      const added = await ensureBlockRelation({
        ops,
        config,
        fromId: page.id,
        blockId: block.id,
        sourceKey: `${pageName}:${blockConfig.finalName}:block`,
      });
      if (added) {
        touched.attachedBlocks.push(`${pageName}:${blockConfig.finalName}`);
      }
    }
  }
}

await ensureLocalProperties();
const sourceMap = await ensureSourceMap();
const collections = await buildCollections();

for (const packet of evidenceInput.packets) {
  const entities = await resolvePacket(packet, collections);
  await createPacketRelations(packet, entities, sourceMap, collections);
}

await publishCollections(collections);

const result = await finalizeProposal({
  config,
  proposalName: PROPOSAL_NAME,
  ops,
  touched: {
    ...touched,
    expectedInputRelationCounts: Object.fromEntries(
      evidenceInput.packets.map((packet) => [packet.disease.name, packet.relationCounts])
    ),
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
