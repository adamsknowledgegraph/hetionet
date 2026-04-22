import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  fetchEntity,
  findPreferredEntity,
  gql,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import {
  configureBlockColumns,
  ensureBlockRelation,
  ensureCollectionBlock,
  ensureTextBlock,
} from "./lib/proposal-utils.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const PROPOSAL_NAME = "Disease Atlas - Structure and provenance repair";

const OBSOLETE_BLOCK_NAMES = [
  "Goals",
  "Latest news",
  "Top courses",
  "Top researchers",
  "Top schools",
];

const PROVENANCE_GUIDE = [
  "Disease Atlas treats imported Hetionet claims as traceable evidence, not anonymous facts.",
  "",
  "Every imported relationship is represented as a relation entity with a Hetionet metaedge, import batch, source family, raw edge ID when available, and Sources links back to the relevant dataset/source/paper entities.",
  "",
  "Cooccurrence-derived symptoms, anatomy, and disease similarity are intentionally labeled as evidence-only so they remain useful for exploration without overstating clinical certainty.",
].join("\n");

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const currentEntities = await listSpaceEntities(config.targetSpaceId, 1000);

const datasetType = mustGetNamedEntry(manifest.types, "Dataset", "type");
const sourceType = mustGetNamedEntry(manifest.types, "Source", "type");
const paperType = mustGetNamedEntry(manifest.types, "Paper", "type");

const ops = [];
const touched = {
  collectionBlocks: {},
  removedObsoleteBlockPlacements: [],
  configuredColumns: {},
  attachedBlocks: [],
  addedTextBlocks: [],
  checkedSharedProperties: {},
};

function localEntitiesByType(typeId) {
  return currentEntities
    .filter((entity) => entity.typeIds?.includes(typeId))
    .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));
}

function itemMapFromEntities(entities) {
  return new Map(
    entities
      .filter((entity) => entity.name)
      .map((entity) => [entity.id, entity.name])
  );
}

async function mustFindProperty(name, preferredSpaceIds = [ROOT_SPACE_ID, HEALTH_SPACE_ID]) {
  const property = await findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds: [...preferredSpaceIds, config.targetSpaceId],
  });

  if (!property) {
    throw new Error(`Missing expected property "${name}".`);
  }

  touched.checkedSharedProperties[name] = `${property.id} (${property.spaceIds?.join(",")})`;
  return property;
}

async function removeObsoleteBlockPlacements() {
  const obsoleteIds = new Map(
    currentEntities
      .filter(
        (entity) =>
          entity.typeIds?.includes(SystemIds.DATA_BLOCK) &&
          OBSOLETE_BLOCK_NAMES.includes(entity.name)
      )
      .map((entity) => [entity.id, entity.name])
  );

  for (const [blockId, blockName] of obsoleteIds.entries()) {
    const data = await gql(`{
      relations(
        first: 100,
        filter: {
          spaceId: { is: "${config.targetSpaceId}" },
          typeId: { is: "${SystemIds.BLOCKS}" },
          toEntityId: { is: "${blockId}" }
        }
      ) {
        id
        fromEntity { id name }
      }
    }`);

    for (const relation of data.relations ?? []) {
      const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
      ops.push(...deleteOps);
      touched.removedObsoleteBlockPlacements.push({
        block: blockName,
        from: relation.fromEntity?.name ?? relation.fromEntity?.id,
      });
    }
  }
}

async function configureColumns(blockId, blockName, columnNames) {
  const columnIds = [];
  for (const name of columnNames) {
    const property = await mustFindProperty(name);
    columnIds.push(property.id);
  }

  const placements = await configureBlockColumns({
    ops,
    config,
    blockId,
    blockName,
    columnIds,
  });

  touched.configuredColumns[blockName] = {
    columns: columnNames,
    placements,
  };
}

async function addProvenanceGuide() {
  const evidencePage = currentEntities.find(
    (entity) =>
      entity.name === "Evidence" && entity.typeIds?.includes(SystemIds.PAGE_TYPE)
  );

  if (!evidencePage) {
    throw new Error("Missing Evidence page.");
  }

  const textBlockId = await ensureTextBlock({
    ops,
    config,
    key: "evidence-provenance-guide",
    text: PROVENANCE_GUIDE,
  });
  const added = await ensureBlockRelation({
    ops,
    config,
    fromId: evidencePage.id,
    blockId: textBlockId,
    sourceKey: "evidence-provenance-guide",
  });

  if (added) {
    touched.addedTextBlocks.push("Evidence provenance guide");
  }
}

async function attachBlockToPage(blockId, blockName, pageName) {
  const page = currentEntities.find(
    (entity) =>
      entity.name === pageName && entity.typeIds?.includes(SystemIds.PAGE_TYPE)
  );

  if (!page) {
    throw new Error(`Missing page "${pageName}" while attaching ${blockName}.`);
  }

  const added = await ensureBlockRelation({
    ops,
    config,
    fromId: page.id,
    blockId,
    sourceKey: `${pageName}:${blockName}:block`,
  });

  if (added) {
    touched.attachedBlocks.push(`${pageName}:${blockName}`);
  }
}

const collectionConfigs = [
  {
    names: ["Datasets"],
    finalName: "Datasets",
    description: "Dataset entities used by Disease Atlas imports.",
    items: itemMapFromEntities(localEntitiesByType(datasetType.id)),
    columns: ["Website", "DOI", "Version ID", "Source database identifier", "License", "Sources"],
  },
  {
    names: ["Sources"],
    finalName: "Sources",
    description: "Source authority entities used to verify Disease Atlas claims.",
    items: itemMapFromEntities(localEntitiesByType(sourceType.id)),
    columns: ["Website", "Source database identifier", "License", "Sources"],
  },
  {
    names: ["Papers"],
    finalName: "Papers",
    description: "Citable papers and releases behind Disease Atlas imports.",
    items: itemMapFromEntities(localEntitiesByType(paperType.id)),
    columns: ["Website", "DOI", "Pmid", "Publish date", "Sources"],
  },
  {
    names: ["Types"],
    finalName: "Types",
    description: "Local Disease Atlas ontology types.",
    items: itemMapFromEntities(localEntitiesByType(SystemIds.SCHEMA_TYPE)),
    columns: ["Description"],
  },
  {
    names: ["Properties"],
    finalName: "Properties",
    description: "Local Disease Atlas properties.",
    items: itemMapFromEntities(localEntitiesByType(SystemIds.PROPERTY)),
    columns: ["Description"],
  },
  {
    names: ["Sources and datasets"],
    finalName: "Sources and datasets",
    description: "Datasets and source authorities used by Disease Atlas.",
    items: itemMapFromEntities([
      ...localEntitiesByType(datasetType.id),
      ...localEntitiesByType(sourceType.id),
    ]),
    columns: ["Website", "DOI", "Source database identifier", "License", "Sources"],
  },
];

await removeObsoleteBlockPlacements();

for (const blockConfig of collectionConfigs) {
  const block = await ensureCollectionBlock({
    ops,
    config,
    currentEntities,
    blockNames: blockConfig.names,
    finalName: blockConfig.finalName,
    description: blockConfig.description,
    itemMap: blockConfig.items,
  });
  touched.collectionBlocks[blockConfig.finalName] = block;
  await configureColumns(block.id, blockConfig.finalName, blockConfig.columns);

  if (blockConfig.finalName === "Datasets") {
    await attachBlockToPage(block.id, blockConfig.finalName, "Sources");
  }
  if (blockConfig.finalName === "Sources") {
    await attachBlockToPage(block.id, blockConfig.finalName, "Sources");
  }
  if (blockConfig.finalName === "Sources and datasets") {
    await attachBlockToPage(block.id, blockConfig.finalName, "Sources");
  }
  if (blockConfig.finalName === "Papers") {
    await attachBlockToPage(block.id, blockConfig.finalName, "Papers");
  }
}

await addProvenanceGuide();

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
