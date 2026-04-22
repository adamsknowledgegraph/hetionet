import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import { fetchEntity, gql } from "./lib/graphql.mjs";
import { deterministicRelationId, positionAfter } from "./lib/ids.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const DISEASES_BLOCK_ID = "38e2ba4d41dd48a0bf7d160091bd2f1d";
const ASTHMA_ENTITY_ID = "c1d11a58e7f548fca52da2f8f0642a06";

const PROPOSAL_NAME = "Disease Atlas - Diseases table collection fix";

const config = loadGeoEnv({ requirePrivateKey: false });

const ops = [];
const touched = {
  block: {
    id: DISEASES_BLOCK_ID,
    name: "Diseases",
  },
  collectionItems: [],
  deletedDataSourceRelations: [],
  addedDataSourceRelations: [],
  placementsConfigured: [],
};

function relationTargets(entity, typeId) {
  return new Set(
    (entity?.relations?.nodes ?? [])
      .filter((relation) => relation.type?.id === typeId)
      .map((relation) => relation.toEntity?.id)
      .filter(Boolean)
  );
}

function addMissingRelation({ fromEntity, toEntity, type, sourceKey }) {
  const { ops: relationOps } = Graph.createRelation({
    id: deterministicRelationId({
      fromId: fromEntity,
      typeId: type,
      toId: toEntity,
      spaceId: config.targetSpaceId,
      sourceKey,
    }),
    fromEntity,
    toEntity,
    type,
  });
  ops.push(...relationOps);
}

async function configureTablePlacements(columnIds) {
  const data = await gql(`{
    relations(
      first: 50,
      filter: {
        typeId: { is: "${SystemIds.BLOCKS}" },
        toEntityId: { is: "${DISEASES_BLOCK_ID}" }
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
    let changed = false;

    const hasTableView = placementRelations.some(
      (relation) =>
        relation.type?.id === SystemIds.VIEW_PROPERTY &&
        relation.toEntity?.id === SystemIds.TABLE_VIEW
    );

    if (!hasTableView) {
      addMissingRelation({
        fromEntity: placement.entityId,
        toEntity: SystemIds.TABLE_VIEW,
        type: SystemIds.VIEW_PROPERTY,
        sourceKey: "diseases-table-view",
      });
      changed = true;
    }

    let lastPosition = null;
    for (const columnId of columnIds) {
      const hasColumn = placementRelations.some(
        (relation) =>
          relation.type?.id === SystemIds.SHOWN_COLUMNS &&
          relation.toEntity?.id === columnId
      );

      if (hasColumn) {
        continue;
      }

      lastPosition = positionAfter(lastPosition);
      const { ops: columnOps } = Graph.createRelation({
        id: deterministicRelationId({
          fromId: placement.entityId,
          typeId: SystemIds.SHOWN_COLUMNS,
          toId: columnId,
          spaceId: config.targetSpaceId,
          sourceKey: `diseases-shown-column:${columnId}`,
        }),
        fromEntity: placement.entityId,
        toEntity: columnId,
        type: SystemIds.SHOWN_COLUMNS,
        position: lastPosition,
      });
      ops.push(...columnOps);
      changed = true;
    }

    if (changed) {
      touched.placementsConfigured.push(
        placement.fromEntity?.name ?? placement.entityId
      );
    }
  }
}

async function findPropertyByName(name) {
  const escapedName = JSON.stringify(name);
  const data = await gql(`{
    entities(
      typeId: "${SystemIds.PROPERTY}",
      filter: { name: { includesInsensitive: ${escapedName} } },
      first: 50
    ) {
      id
      name
      spaceIds
    }
  }`);

  return (data.entities ?? []).find(
    (entity) =>
      entity.name === name &&
      (entity.spaceIds?.includes(config.targetSpaceId) ||
        entity.spaceIds?.includes("a19c345ab9866679b001d7d2138d88a1") ||
        entity.spaceIds?.includes("52c7ae149838b6d47ce0f3b2a5974546"))
  );
}

const diseasesBlock = await fetchEntity(DISEASES_BLOCK_ID);
if (!diseasesBlock) {
  throw new Error(`Diseases data block ${DISEASES_BLOCK_ID} was not found.`);
}

const asthmaEntity = await fetchEntity(ASTHMA_ENTITY_ID);
if (!asthmaEntity) {
  throw new Error(`Asthma entity ${ASTHMA_ENTITY_ID} was not found.`);
}

const dataSourceRelations = (diseasesBlock.relations?.nodes ?? []).filter(
  (relation) => relation.type?.id === SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE
);
const collectionItemTargets = relationTargets(
  diseasesBlock,
  SystemIds.COLLECTION_ITEM_RELATION_TYPE
);

const { ops: updateBlockOps } = Graph.updateEntity({
  id: DISEASES_BLOCK_ID,
  name: "Diseases",
  description:
    "Curated disease packets published in Disease Atlas. Wave 1 starts with Asthma.",
});
ops.push(...updateBlockOps);

for (const relation of dataSourceRelations) {
  if (relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE) {
    continue;
  }

  const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
  ops.push(...deleteOps);
  touched.deletedDataSourceRelations.push({
    id: relation.id,
    previousTarget: relation.toEntity?.name ?? relation.toEntity?.id,
  });
}

const hasCollectionDataSource = dataSourceRelations.some(
  (relation) => relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE
);

if (!hasCollectionDataSource) {
  addMissingRelation({
    fromEntity: DISEASES_BLOCK_ID,
    toEntity: SystemIds.COLLECTION_DATA_SOURCE,
    type: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
    sourceKey: "diseases-collection-data-source",
  });
  touched.addedDataSourceRelations.push("Collection data source");
}

if (!collectionItemTargets.has(ASTHMA_ENTITY_ID)) {
  addMissingRelation({
    fromEntity: DISEASES_BLOCK_ID,
    toEntity: ASTHMA_ENTITY_ID,
    type: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
    sourceKey: "diseases-collection-item:asthma",
  });
  touched.collectionItems.push({
    id: ASTHMA_ENTITY_ID,
    name: asthmaEntity.name,
  });
}

const diseaseColumnNames = [
  "Website",
  "Disease Ontology ID",
  "Sources",
  "License",
];
const diseaseColumns = [];
for (const name of diseaseColumnNames) {
  const property = await findPropertyByName(name);
  if (property) {
    diseaseColumns.push(property.id);
  }
}

await configureTablePlacements(diseaseColumns);

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
        skipped: "Diseases block is already configured as an Asthma collection.",
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
