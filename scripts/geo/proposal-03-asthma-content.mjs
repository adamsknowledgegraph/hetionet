import { Graph } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  findEntityInSpace,
  findPreferredEntity,
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import {
  deterministicEntityId,
  deterministicRelationEntityId,
  deterministicRelationId,
  relationEntityName,
} from "./lib/ids.mjs";
import { buildLocalSchema } from "./lib/local-schema.mjs";
import {
  loadAsthmaPacket,
  loadLiveManifest,
  mustGetNamedEntry,
} from "./lib/manifest.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

function ensureSentence(value) {
  if (!value) {
    return null;
  }

  return value.endsWith(".") ? value : `${value}.`;
}

function preferredOwnerSpaceId(entity, preferredSpaceIds = []) {
  const ownerSpaceIds = entity.ownerSpaceIds ?? entity.spaceIds ?? [];

  for (const preferredSpaceId of preferredSpaceIds) {
    if (ownerSpaceIds.includes(preferredSpaceId)) {
      return preferredSpaceId;
    }
  }

  return ownerSpaceIds[0] ?? null;
}

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const packet = await loadAsthmaPacket();
const typeType = mustGetNamedEntry(manifest.types, "Type", "type");
const propertyType = mustGetNamedEntry(manifest.types, "Property", "type");

const sharedTypes = {
  Disease: mustGetNamedEntry(manifest.types, "Disease", "type"),
  Drug: mustGetNamedEntry(manifest.types, "Drug", "type"),
  "Drug class": mustGetNamedEntry(manifest.types, "Drug class", "type"),
  Gene: mustGetNamedEntry(manifest.types, "Gene", "type"),
  Pathway: mustGetNamedEntry(manifest.types, "Pathway", "type"),
  Dataset: mustGetNamedEntry(manifest.types, "Dataset", "type"),
  Source: mustGetNamedEntry(manifest.types, "Source", "type"),
};

const sharedProperties = {
  Treats: mustGetNamedEntry(manifest.properties, "Treats", "property"),
  Sources: mustGetNamedEntry(manifest.properties, "Sources", "property"),
};

const localSchema = buildLocalSchema(config.targetSpaceId, sharedTypes);
const currentEntities = await listSpaceEntities(config.targetSpaceId, 800);

const schemaDependencies = [
  ...localSchema.types.map((entry) => ({ name: entry.name, typeId: typeType.id })),
  ...localSchema.valueProperties.map((entry) => ({
    name: entry.name,
    typeId: propertyType.id,
  })),
  ...localSchema.relationProperties.map((entry) => ({
    name: entry.name,
    typeId: propertyType.id,
  })),
];

const missingLocalSchema = schemaDependencies
  .filter(({ name, typeId }) => !findEntityInSpace(currentEntities, { name, typeId }))
  .map(({ name }) => name);

if (!config.dryRun && missingLocalSchema.length > 0) {
  throw new Error(
    `Proposal 2 must be executed before publishing Asthma content. Missing schema: ${missingLocalSchema.join(", ")}.`
  );
}

const ops = [];
const touched = {
  sourceEntitiesCreated: [],
  contentEntitiesCreated: [],
  reusedEntities: [],
  relationCounts: {
    associatedGenes: packet.relations.associatedGenes.length,
    treats: packet.relations.treats.length,
    includesDrug: packet.relations.includesDrug.length,
    participatesInPathway: packet.relations.participatesInPathway.length,
    participatesInBiologicalProcess:
      packet.relations.participatesInBiologicalProcess.length,
    hasMolecularFunction: packet.relations.hasMolecularFunction.length,
    locatedInCellularComponent:
      packet.relations.locatedInCellularComponent.length,
  },
  missingLocalSchema,
};

const sourceDefinitionsByName = Object.fromEntries(
  packet.sources.map((source) => [source.name, source])
);
const resolvedEntities = new Map();

async function resolveEntity({
  name,
  typeName,
  description = null,
  values = [],
  externalKey = null,
  preferredSpaceIds = [HEALTH_SPACE_ID, ROOT_SPACE_ID],
}) {
  const cacheKey = `${typeName}:${name}`;

  if (resolvedEntities.has(cacheKey)) {
    return resolvedEntities.get(cacheKey);
  }

  const typeId = sharedTypes[typeName]?.id ?? localSchema.typeIds[typeName];
  const localEntity = findEntityInSpace(currentEntities, { name, typeId });

  if (localEntity) {
    const resolved = {
      id: localEntity.id,
      name,
      ownerSpaceId: config.targetSpaceId,
      source: "target-space",
    };
    resolvedEntities.set(cacheKey, resolved);
    return resolved;
  }

  if (externalKey && manifest.reusableEntities?.[externalKey]) {
    const reused = manifest.reusableEntities[externalKey];
    const resolved = {
      id: reused.id,
      name: reused.name,
      ownerSpaceId: preferredOwnerSpaceId(reused, preferredSpaceIds),
      source: "manifest-reuse",
    };
    touched.reusedEntities.push(`${typeName}:${name}`);
    resolvedEntities.set(cacheKey, resolved);
    return resolved;
  }

  if (typeName !== "Dataset" && typeName !== "Source") {
    const liveExact = await findPreferredEntity({
      typeId,
      name,
      preferredSpaceIds,
    });

    if (liveExact) {
      const resolved = {
        id: liveExact.id,
        name: liveExact.name,
        ownerSpaceId: preferredOwnerSpaceId(liveExact, preferredSpaceIds),
        source: "live-reuse",
      };
      touched.reusedEntities.push(`${typeName}:${name}`);
      resolvedEntities.set(cacheKey, resolved);
      return resolved;
    }
  }

  const entityId = deterministicEntityId(config.targetSpaceId, typeName, name);
  const { ops: entityOps } = Graph.createEntity({
    id: entityId,
    name,
    description: ensureSentence(description),
    types: [typeId],
    values,
  });
  ops.push(...entityOps);
  currentEntities.push({
    id: entityId,
    name,
    typeIds: [typeId],
    spaceIds: [config.targetSpaceId],
  });

  const resolved = {
    id: entityId,
    name,
    ownerSpaceId: config.targetSpaceId,
    source: "created",
  };

  if (typeName === "Dataset" || typeName === "Source") {
    touched.sourceEntitiesCreated.push(name);
  } else {
    touched.contentEntitiesCreated.push(`${typeName}:${name}`);
  }

  resolvedEntities.set(cacheKey, resolved);
  return resolved;
}

const datasetEntity = await resolveEntity({
  name: packet.datasetName,
  typeName: "Dataset",
  description: sourceDefinitionsByName[packet.datasetName].description,
});

for (const sourceDefinition of packet.sources.filter(
  (source) => source.type === "Source"
)) {
  await resolveEntity({
    name: sourceDefinition.name,
    typeName: "Source",
    description: sourceDefinition.description,
  });
}

await resolveEntity({
  name: packet.disease.name,
  typeName: "Disease",
  externalKey: `Disease:${packet.disease.name}`,
  preferredSpaceIds: [HEALTH_SPACE_ID, config.targetSpaceId],
});

for (const gene of packet.entities.genes) {
  await resolveEntity({
    name: gene.name,
    typeName: "Gene",
    description: gene.description,
    externalKey: `Gene:${gene.name}`,
  });
}

for (const drug of packet.entities.drugs) {
  await resolveEntity({
    name: drug.name,
    typeName: "Drug",
    externalKey: `Drug:${drug.name}`,
  });
}

for (const drugClass of packet.entities.drugClasses) {
  await resolveEntity({
    name: drugClass.name,
    typeName: "Drug class",
    description: drugClass.description,
    externalKey: `Drug class:${drugClass.name}`,
  });
}

for (const pathway of packet.entities.pathways) {
  await resolveEntity({
    name: pathway.name,
    typeName: "Pathway",
    description: pathway.description,
    externalKey: `Pathway:${pathway.name}`,
  });
}

for (const process of packet.entities.biologicalProcesses) {
  await resolveEntity({
    name: process.name,
    typeName: "Biological Process",
    description: process.description,
    values: [
      {
        property: localSchema.propertyIds["GO ID"],
        type: "text",
        value: process.goId,
      },
    ],
    preferredSpaceIds: [config.targetSpaceId],
  });
}

for (const fn of packet.entities.molecularFunctions) {
  await resolveEntity({
    name: fn.name,
    typeName: "Molecular Function",
    description: fn.description,
    values: [
      {
        property: localSchema.propertyIds["GO ID"],
        type: "text",
        value: fn.goId,
      },
    ],
    preferredSpaceIds: [config.targetSpaceId],
  });
}

for (const component of packet.entities.cellularComponents) {
  await resolveEntity({
    name: component.name,
    typeName: "Cellular Component",
    description: component.description,
    values: [
      {
        property: localSchema.propertyIds["GO ID"],
        type: "text",
        value: component.goId,
      },
    ],
    preferredSpaceIds: [config.targetSpaceId],
  });
}

async function createProvenancedRelation({
  fromTypeName,
  fromName,
  toTypeName,
  toName,
  propertyId,
  propertyName,
  primarySourceName,
  metaedge,
  unbiased,
}) {
  const fromEntity = await resolveEntity({
    name: fromName,
    typeName: fromTypeName,
    externalKey:
      fromTypeName === "Disease" ||
      fromTypeName === "Gene" ||
      fromTypeName === "Drug" ||
      fromTypeName === "Drug class" ||
      fromTypeName === "Pathway"
        ? `${fromTypeName}:${fromName}`
        : null,
  });
  const toEntity = await resolveEntity({
    name: toName,
    typeName: toTypeName,
    externalKey:
      toTypeName === "Disease" ||
      toTypeName === "Gene" ||
      toTypeName === "Drug" ||
      toTypeName === "Drug class" ||
      toTypeName === "Pathway"
        ? `${toTypeName}:${toName}`
        : null,
  });
  const primarySourceEntity = await resolveEntity({
    name: primarySourceName,
    typeName: "Source",
    description: sourceDefinitionsByName[primarySourceName]?.description,
    preferredSpaceIds: [config.targetSpaceId],
  });

  const relationSourceKey = primarySourceName;
  const relationEntityId = deterministicRelationEntityId({
    fromId: fromEntity.id,
    typeId: propertyId,
    toId: toEntity.id,
    spaceId: config.targetSpaceId,
    sourceKey: relationSourceKey,
  });
  const relationId = deterministicRelationId({
    fromId: fromEntity.id,
    typeId: propertyId,
    toId: toEntity.id,
    spaceId: config.targetSpaceId,
    sourceKey: relationSourceKey,
  });

  const { ops: relationOps } = Graph.createRelation({
    id: relationId,
    entityId: relationEntityId,
    entityName: relationEntityName(fromEntity.name, propertyName, toEntity.name),
    fromEntity: fromEntity.id,
    toEntity: toEntity.id,
    fromSpace:
      fromEntity.ownerSpaceId &&
      fromEntity.ownerSpaceId !== config.targetSpaceId
        ? fromEntity.ownerSpaceId
        : undefined,
    toSpace:
      toEntity.ownerSpaceId && toEntity.ownerSpaceId !== config.targetSpaceId
        ? toEntity.ownerSpaceId
        : undefined,
    type: propertyId,
    entityValues: [
      {
        property: localSchema.propertyIds["Hetionet metaedge"],
        type: "text",
        value: metaedge,
      },
      {
        property: localSchema.propertyIds.Unbiased,
        type: "boolean",
        value: unbiased,
      },
      {
        property: localSchema.propertyIds["Import batch"],
        type: "text",
        value: packet.importBatch,
      },
    ],
    entityRelations: {
      [sharedProperties.Sources.id]: [
        {
          toEntity: primarySourceEntity.id,
        },
        {
          toEntity: datasetEntity.id,
        },
      ],
    },
  });

  ops.push(...relationOps);
}

for (const relation of packet.relations.associatedGenes) {
  await createProvenancedRelation({
    fromTypeName: "Disease",
    fromName: relation.from,
    toTypeName: "Gene",
    toName: relation.to,
    propertyId: localSchema.propertyIds["Associated genes"],
    propertyName: "Associated genes",
    primarySourceName: relation.primarySource,
    metaedge: relation.metaedge,
    unbiased: relation.unbiased,
  });
}

for (const relation of packet.relations.treats) {
  await createProvenancedRelation({
    fromTypeName: "Drug",
    fromName: relation.from,
    toTypeName: "Disease",
    toName: relation.to,
    propertyId: sharedProperties.Treats.id,
    propertyName: "Treats",
    primarySourceName: relation.primarySource,
    metaedge: relation.metaedge,
    unbiased: relation.unbiased,
  });
}

for (const relation of packet.relations.includesDrug) {
  await createProvenancedRelation({
    fromTypeName: "Drug class",
    fromName: relation.from,
    toTypeName: "Drug",
    toName: relation.to,
    propertyId: localSchema.propertyIds["Includes drug"],
    propertyName: "Includes drug",
    primarySourceName: relation.primarySource,
    metaedge: relation.metaedge,
    unbiased: relation.unbiased,
  });
}

for (const relation of packet.relations.participatesInPathway) {
  await createProvenancedRelation({
    fromTypeName: "Gene",
    fromName: relation.from,
    toTypeName: "Pathway",
    toName: relation.to,
    propertyId: localSchema.propertyIds["Participates in pathway"],
    propertyName: "Participates in pathway",
    primarySourceName: relation.primarySource,
    metaedge: relation.metaedge,
    unbiased: relation.unbiased,
  });
}

for (const relation of packet.relations.participatesInBiologicalProcess) {
  await createProvenancedRelation({
    fromTypeName: "Gene",
    fromName: relation.from,
    toTypeName: "Biological Process",
    toName: relation.to,
    propertyId: localSchema.propertyIds["Participates in biological process"],
    propertyName: "Participates in biological process",
    primarySourceName: relation.primarySource,
    metaedge: relation.metaedge,
    unbiased: relation.unbiased,
  });
}

for (const relation of packet.relations.hasMolecularFunction) {
  await createProvenancedRelation({
    fromTypeName: "Gene",
    fromName: relation.from,
    toTypeName: "Molecular Function",
    toName: relation.to,
    propertyId: localSchema.propertyIds["Has molecular function"],
    propertyName: "Has molecular function",
    primarySourceName: relation.primarySource,
    metaedge: relation.metaedge,
    unbiased: relation.unbiased,
  });
}

for (const relation of packet.relations.locatedInCellularComponent) {
  await createProvenancedRelation({
    fromTypeName: "Gene",
    fromName: relation.from,
    toTypeName: "Cellular Component",
    toName: relation.to,
    propertyId: localSchema.propertyIds["Located in cellular component"],
    propertyName: "Located in cellular component",
    primarySourceName: relation.primarySource,
    metaedge: relation.metaedge,
    unbiased: relation.unbiased,
  });
}

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - Asthma content",
  ops,
  touched,
});

console.log(JSON.stringify(result, null, 2));
