import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import { buildTypeFilter } from "./lib/filters.mjs";
import {
  fetchEntity,
  findEntityInSpace,
  gql,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import {
  deterministicEntityId,
  positionAfter,
  sortByPosition,
} from "./lib/ids.mjs";
import { buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

const MARKDOWN_CONTENT_PROPERTY_ID = "e3e363d1dd294ccb8e6ff3b76d99bc33";

const OVERVIEW_TEXT =
  "Disease Atlas currently starts with an Asthma wave 1 packet from Hetionet v1.0. Use these dashboard blocks to explore the disease, associated genes, treating drugs, drug classes, pathways, Gene Ontology annotations, source authorities, and imported relation evidence.";

const BLOCK_SPECS = [
  {
    key: "diseases",
    name: "Diseases",
    description: "Disease entities curated in Disease Atlas.",
    mode: "reuse-query",
  },
  {
    key: "genes",
    name: "Asthma genes",
    description: "Genes associated with Asthma in the wave 1 Hetionet packet.",
    mode: "query",
    typeName: "Gene",
  },
  {
    key: "drugs",
    name: "Asthma drugs",
    description: "Compounds imported as treating Asthma in wave 1.",
    mode: "query",
    typeName: "Drug",
  },
  {
    key: "drug-classes",
    name: "Asthma drug classes",
    description: "Drug classes connected to the Asthma treatment packet.",
    mode: "query",
    typeName: "Drug class",
  },
  {
    key: "pathways",
    name: "Asthma pathways",
    description: "Reactome pathways connected to Asthma-associated genes.",
    mode: "query",
    typeName: "Pathway",
  },
  {
    key: "go-annotations",
    name: "GO annotations",
    description:
      "Biological process, molecular function, and cellular component entities used in wave 1.",
    mode: "collection",
    collection: "goAnnotations",
  },
  {
    key: "sources",
    name: "Sources and datasets",
    description: "Datasets and source authorities used for the Asthma packet.",
    mode: "collection",
    collection: "sourcesAndDatasets",
  },
  {
    key: "evidence",
    name: "Asthma evidence relations",
    description:
      "Provenance-backed relation entities imported with Import batch = asthma-v1.",
    mode: "collection",
    collection: "evidenceRelations",
  },
];

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();

const sharedTypes = {
  Disease: mustGetNamedEntry(manifest.types, "Disease", "type"),
  Drug: mustGetNamedEntry(manifest.types, "Drug", "type"),
  "Drug class": mustGetNamedEntry(manifest.types, "Drug class", "type"),
  Gene: mustGetNamedEntry(manifest.types, "Gene", "type"),
  Pathway: mustGetNamedEntry(manifest.types, "Pathway", "type"),
  Dataset: mustGetNamedEntry(manifest.types, "Dataset", "type"),
  Source: mustGetNamedEntry(manifest.types, "Source", "type"),
};
const localSchema = buildLocalSchema(config.targetSpaceId, sharedTypes);

const currentEntities = await listSpaceEntities(config.targetSpaceId, 900);
const overviewEntity = await fetchEntity(config.targetSpaceEntityId);
const currentOverviewBlocks = (overviewEntity?.relations?.nodes ?? []).filter(
  (relation) => relation.type?.id === SystemIds.BLOCKS
);
const existingOverviewBlockIds = new Set(
  currentOverviewBlocks.map((relation) => relation.toEntity?.id).filter(Boolean)
);

const ops = [];
const touched = {
  overviewEntity: config.targetSpaceEntityId,
  textBlocksCreated: [],
  dataBlocksCreated: [],
  dataBlocksReused: [],
  blocksAttached: [],
  collectionItemCounts: {},
};

function getTypeId(typeName) {
  return sharedTypes[typeName]?.id ?? localSchema.typeIds[typeName];
}

function addOverviewBlockRelation({ blockId, name, position }) {
  if (existingOverviewBlockIds.has(blockId)) {
    return;
  }

  const { ops: relationOps } = Graph.createRelation({
    fromEntity: config.targetSpaceEntityId,
    toEntity: blockId,
    type: SystemIds.BLOCKS,
    position,
  });
  ops.push(...relationOps);
  existingOverviewBlockIds.add(blockId);
  touched.blocksAttached.push(name);
}

async function ensureOverviewTextBlock(position) {
  const id = deterministicEntityId(
    config.targetSpaceId,
    "Text block",
    "Overview guide"
  );
  const existing = await fetchEntity(id);

  if (!existing) {
    const { ops: createOps } = Graph.createEntity({
      id,
      types: [SystemIds.TEXT_BLOCK],
      values: [
        {
          property: MARKDOWN_CONTENT_PROPERTY_ID,
          type: "text",
          value: OVERVIEW_TEXT,
        },
      ],
    });
    ops.push(...createOps);
    touched.textBlocksCreated.push("Overview guide");
  } else {
    const { ops: updateOps } = Graph.updateEntity({
      id,
      values: [
        {
          property: MARKDOWN_CONTENT_PROPERTY_ID,
          type: "text",
          value: OVERVIEW_TEXT,
        },
      ],
    });
    ops.push(...updateOps);
  }

  addOverviewBlockRelation({
    blockId: id,
    name: "Overview guide",
    position,
  });
}

async function ensureQueryBlock({ name, description, typeName, position }) {
  const typeId = getTypeId(typeName);
  const existing = findEntityInSpace(currentEntities, {
    name,
    typeId: SystemIds.DATA_BLOCK,
  });
  const id =
    existing?.id ??
    deterministicEntityId(config.targetSpaceId, "Data block", name);

  if (!existing) {
    const { ops: createOps } = Graph.createEntity({
      id,
      name,
      description,
      types: [SystemIds.DATA_BLOCK],
      values: [
        {
          property: SystemIds.FILTER,
          type: "text",
          value: buildTypeFilter({
            spaceId: config.targetSpaceId,
            typeId,
          }),
        },
      ],
      relations: {
        [SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE]: {
          toEntity: SystemIds.QUERY_DATA_SOURCE,
        },
      },
    });
    ops.push(...createOps);
    touched.dataBlocksCreated.push(name);
  } else {
    const { ops: updateOps } = Graph.updateEntity({
      id,
      description,
      values: [
        {
          property: SystemIds.FILTER,
          type: "text",
          value: buildTypeFilter({
            spaceId: config.targetSpaceId,
            typeId,
          }),
        },
      ],
    });
    ops.push(...updateOps);
    touched.dataBlocksReused.push(name);
  }

  addOverviewBlockRelation({ blockId: id, name, position });
  return id;
}

async function ensureExistingBlockAttached({ name, position }) {
  const existing = findEntityInSpace(currentEntities, {
    name,
    typeId: SystemIds.DATA_BLOCK,
  });

  if (!existing) {
    throw new Error(`Expected existing data block "${name}" in target space.`);
  }

  touched.dataBlocksReused.push(name);
  addOverviewBlockRelation({
    blockId: existing.id,
    name,
    position,
  });

  return existing.id;
}

async function listEvidenceRelationIds() {
  const data = await gql(`{
    entities(spaceId: "${config.targetSpaceId}", first: 900) {
      id
      name
      values(first: 40) {
        nodes {
          property { id name }
          text
        }
      }
    }
  }`);

  return (data.entities ?? [])
    .filter((entity) =>
      entity.values?.nodes?.some(
        (value) =>
          value.property?.id === localSchema.propertyIds["Import batch"] &&
          value.text === "asthma-v1"
      )
    )
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entity) => entity.id);
}

function listEntitiesByTypes(typeIds) {
  return currentEntities
    .filter((entity) => typeIds.some((typeId) => entity.typeIds?.includes(typeId)))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entity) => entity.id);
}

async function collectionItems(collection) {
  if (collection === "goAnnotations") {
    return listEntitiesByTypes([
      localSchema.typeIds["Biological Process"],
      localSchema.typeIds["Molecular Function"],
      localSchema.typeIds["Cellular Component"],
    ]);
  }

  if (collection === "sourcesAndDatasets") {
    return listEntitiesByTypes([
      sharedTypes.Dataset.id,
      sharedTypes.Source.id,
    ]);
  }

  if (collection === "evidenceRelations") {
    return listEvidenceRelationIds();
  }

  throw new Error(`Unknown collection "${collection}".`);
}

async function ensureCollectionBlock({
  name,
  description,
  collection,
  position,
}) {
  const itemIds = await collectionItems(collection);
  const existing = findEntityInSpace(currentEntities, {
    name,
    typeId: SystemIds.DATA_BLOCK,
  });
  const id =
    existing?.id ??
    deterministicEntityId(config.targetSpaceId, "Data block", name);

  touched.collectionItemCounts[name] = itemIds.length;

  if (!existing) {
    const { ops: createOps } = Graph.createEntity({
      id,
      name,
      description,
      types: [SystemIds.DATA_BLOCK],
      relations: {
        [SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE]: {
          toEntity: SystemIds.COLLECTION_DATA_SOURCE,
        },
        [SystemIds.COLLECTION_ITEM_RELATION_TYPE]: itemIds.map((itemId) => ({
          toEntity: itemId,
        })),
      },
    });
    ops.push(...createOps);
    touched.dataBlocksCreated.push(name);
  } else {
    const detail = await fetchEntity(existing.id);
    const existingTargets = new Set(
      (detail?.relations?.nodes ?? [])
        .filter(
          (relation) =>
            relation.type?.id === SystemIds.COLLECTION_ITEM_RELATION_TYPE
        )
        .map((relation) => relation.toEntity?.id)
        .filter(Boolean)
    );
    const hasCollectionSource = (detail?.relations?.nodes ?? []).some(
      (relation) =>
        relation.type?.id === SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE &&
        relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE
    );

    const { ops: updateOps } = Graph.updateEntity({
      id: existing.id,
      description,
    });
    ops.push(...updateOps);

    if (!hasCollectionSource) {
      const { ops: sourceOps } = Graph.createRelation({
        fromEntity: existing.id,
        toEntity: SystemIds.COLLECTION_DATA_SOURCE,
        type: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
      });
      ops.push(...sourceOps);
    }

    for (const itemId of itemIds) {
      if (existingTargets.has(itemId)) {
        continue;
      }

      const { ops: itemOps } = Graph.createRelation({
        fromEntity: existing.id,
        toEntity: itemId,
        type: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
      });
      ops.push(...itemOps);
    }

    touched.dataBlocksReused.push(name);
  }

  addOverviewBlockRelation({ blockId: id, name, position });
  return id;
}

let lastPosition =
  sortByPosition(currentOverviewBlocks).at(-1)?.position ?? null;

lastPosition = positionAfter(lastPosition);
await ensureOverviewTextBlock(lastPosition);

for (const spec of BLOCK_SPECS) {
  lastPosition = positionAfter(lastPosition);

  if (spec.mode === "reuse-query") {
    await ensureExistingBlockAttached({
      name: spec.name,
      position: lastPosition,
    });
    continue;
  }

  if (spec.mode === "query") {
    await ensureQueryBlock({
      name: spec.name,
      description: spec.description,
      typeName: spec.typeName,
      position: lastPosition,
    });
    continue;
  }

  if (spec.mode === "collection") {
    await ensureCollectionBlock({
      name: spec.name,
      description: spec.description,
      collection: spec.collection,
      position: lastPosition,
    });
    continue;
  }

  throw new Error(`Unhandled block mode "${spec.mode}".`);
}

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - overview dashboard",
  ops,
  touched,
});

console.log(JSON.stringify(result, null, 2));
