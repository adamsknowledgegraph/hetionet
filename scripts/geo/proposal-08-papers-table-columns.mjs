import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  findPreferredEntity,
  gql,
} from "./lib/graphql.mjs";
import { deterministicRelationId, positionAfter } from "./lib/ids.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

const PAPER_BLOCK_ID = "7d4ce0f6519b4d82be08df016adf9218";

const config = loadGeoEnv({ requirePrivateKey: false });

const sharedProperties = {
  DOI: await mustFindPreferredProperty("DOI", [ROOT_SPACE_ID]),
  Pmid: await mustFindPreferredProperty("Pmid", [HEALTH_SPACE_ID, ROOT_SPACE_ID]),
  "Publish date": await mustFindPreferredProperty("Publish date", [ROOT_SPACE_ID]),
  Website: await mustFindPreferredProperty("Website", [ROOT_SPACE_ID]),
  Sources: await mustFindPreferredProperty("Sources", [ROOT_SPACE_ID]),
};

const columns = [
  sharedProperties.DOI.id,
  sharedProperties.Pmid.id,
  sharedProperties["Publish date"].id,
  sharedProperties.Website.id,
  sharedProperties.Sources.id,
];

const ops = [];
const touched = {
  block: "Papers",
  placementsConfigured: [],
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

const data = await gql(`{
  relations(
    first: 50,
    filter: {
      typeId: { is: "${SystemIds.BLOCKS}" },
      toEntityId: { is: "${PAPER_BLOCK_ID}" }
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
  const missingColumns = columns.filter(
    (columnId) =>
      !placementRelations.some(
        (relation) =>
          relation.type?.id === SystemIds.SHOWN_COLUMNS &&
          relation.toEntity?.id === columnId
      )
  );
  const missingTableView = !placementRelations.some(
    (relation) =>
      relation.type?.id === SystemIds.VIEW_PROPERTY &&
      relation.toEntity?.id === SystemIds.TABLE_VIEW
  );

  if (!missingTableView && missingColumns.length === 0) {
    continue;
  }

  if (missingTableView) {
    const { ops: viewOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: placement.entityId,
        typeId: SystemIds.VIEW_PROPERTY,
        toId: SystemIds.TABLE_VIEW,
        spaceId: config.targetSpaceId,
        sourceKey: "papers-table-view",
      }),
      fromEntity: placement.entityId,
      toEntity: SystemIds.TABLE_VIEW,
      type: SystemIds.VIEW_PROPERTY,
    });
    ops.push(...viewOps);
  }

  let lastPosition = null;
  for (const columnId of missingColumns) {
    lastPosition = positionAfter(lastPosition);
    const { ops: columnOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: placement.entityId,
        typeId: SystemIds.SHOWN_COLUMNS,
        toId: columnId,
        spaceId: config.targetSpaceId,
        sourceKey: `papers-shown-column:${columnId}`,
      }),
      fromEntity: placement.entityId,
      toEntity: columnId,
      type: SystemIds.SHOWN_COLUMNS,
      position: lastPosition,
    });
    ops.push(...columnOps);
  }

  touched.placementsConfigured.push(placement.fromEntity?.name ?? placement.entityId);
}

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - Papers table columns",
  ops,
  touched,
});

console.log(JSON.stringify(result, null, 2));
