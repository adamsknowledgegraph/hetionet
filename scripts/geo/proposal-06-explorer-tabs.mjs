import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import { buildTypeFilter } from "./lib/filters.mjs";
import { fetchEntity, findEntityInSpace, listSpaceEntities } from "./lib/graphql.mjs";
import {
  deterministicEntityId,
  positionAfter,
  sortByPosition,
} from "./lib/ids.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

const MARKDOWN_CONTENT_PROPERTY_ID = "e3e363d1dd294ccb8e6ff3b76d99bc33";
const ASTHMA_ENTITY_ID = "c1d11a58e7f548fca52da2f8f0642a06";

const PAGE_DESCRIPTIONS = {
  Mechanisms:
    "Genes, pathways, and Gene Ontology annotations connected to the current Disease Atlas packet.",
  Treatments:
    "Treating drugs and drug classes connected to the current Disease Atlas packet.",
  Evidence:
    "Imported relation evidence and provenance for the current Disease Atlas packet.",
};

const TEXT_BLOCKS = {
  overview:
    "Disease Atlas is organized disease-first. Start with the Asthma tab for the curated wave 1 packet, then use Mechanisms, Treatments, Evidence, Sources, and Ontology to inspect the graph from different angles.",
  asthma:
    "Asthma is the first Disease Atlas packet. This page pulls the key wave 1 views together: associated genes, treating drugs, drug classes, pathways, GO annotations, evidence relations, datasets, and source authorities.",
  Mechanisms:
    "Mechanisms collects the biology-facing parts of the Asthma packet: associated genes, Reactome pathways, and GO-style biological process, molecular function, and cellular component annotations.",
  Treatments:
    "Treatments collects the pharmacology-facing parts of the Asthma packet: treating compounds and drug classes imported from the curated Hetionet slice.",
  Evidence:
    "Evidence lists the provenance-backed relation entities imported in wave 1. Each relation entity carries Import batch = asthma-v1, Hetionet metaedge, Unbiased, and Sources links.",
};

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();

const pageType = mustGetNamedEntry(manifest.types, "Page", "type");
const datasetType = mustGetNamedEntry(manifest.types, "Dataset", "type");
const sourceType = mustGetNamedEntry(manifest.types, "Source", "type");

const currentEntities = await listSpaceEntities(config.targetSpaceId, 1000);
const ops = [];
const touched = {
  tabsRemoved: [],
  tabsAdded: [],
  pagesCreated: [],
  pagesUpdated: [],
  textBlocksCreated: [],
  textBlocksUpdated: [],
  blockLayoutsUpdated: [],
  dataBlocksUpdated: [],
};

function existingPage(name) {
  return findEntityInSpace(currentEntities, {
    name,
    typeId: pageType.id,
  });
}

function existingBlock(name) {
  const block = findEntityInSpace(currentEntities, {
    name,
    typeId: SystemIds.DATA_BLOCK,
  });

  if (!block) {
    throw new Error(`Missing expected data block "${name}".`);
  }

  return block;
}

async function ensurePage(name) {
  const existing = existingPage(name);
  const id =
    existing?.id ?? deterministicEntityId(config.targetSpaceId, "Page", name);
  const description = PAGE_DESCRIPTIONS[name];

  if (existing) {
    const { ops: updateOps } = Graph.updateEntity({
      id,
      description,
    });
    ops.push(...updateOps);
    touched.pagesUpdated.push(name);
    return id;
  }

  const { ops: createOps } = Graph.createEntity({
    id,
    name,
    description,
    types: [pageType.id],
  });
  ops.push(...createOps);
  touched.pagesCreated.push(name);
  currentEntities.push({
    id,
    name,
    typeIds: [pageType.id],
    spaceIds: [config.targetSpaceId],
  });

  return id;
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
    touched.textBlocksUpdated.push(key);
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
  touched.textBlocksCreated.push(key);
  return id;
}

async function resetBlockLayout({ entityId, label, blockIds }) {
  const entity = await fetchEntity(entityId);
  const currentBlocks = (entity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.BLOCKS
  );

  for (const relation of currentBlocks) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  let lastPosition = null;
  for (const blockId of blockIds) {
    lastPosition = positionAfter(lastPosition);
    const { ops: relationOps } = Graph.createRelation({
      fromEntity: entityId,
      toEntity: blockId,
      type: SystemIds.BLOCKS,
      position: lastPosition,
    });
    ops.push(...relationOps);
  }

  touched.blockLayoutsUpdated.push(label);
}

async function resetTabs(tabTargets) {
  const spaceEntity = await fetchEntity(config.targetSpaceEntityId);
  const currentTabs = sortByPosition(
    (spaceEntity?.relations?.nodes ?? []).filter(
      (relation) => relation.type?.id === manifest.properties.Tabs.id
    )
  );

  for (const relation of currentTabs) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
    touched.tabsRemoved.push(relation.toEntity?.name ?? relation.toEntity?.id);
  }

  let lastPosition = null;
  for (const tab of tabTargets) {
    lastPosition = positionAfter(lastPosition);
    const { ops: tabOps } = Graph.createRelation({
      fromEntity: config.targetSpaceEntityId,
      toEntity: tab.id,
      type: manifest.properties.Tabs.id,
      position: lastPosition,
    });
    ops.push(...tabOps);
    touched.tabsAdded.push(tab.name);
  }
}

function updateQueryBlockFilter({ blockName, typeId, description }) {
  const block = existingBlock(blockName);
  const { ops: updateOps } = Graph.updateEntity({
    id: block.id,
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
  touched.dataBlocksUpdated.push(blockName);
  return block.id;
}

const pages = {
  Diseases: existingPage("Diseases")?.id,
  Sources: existingPage("Sources")?.id,
  Ontology: existingPage("Ontology")?.id,
  About: existingPage("About")?.id,
  Mechanisms: await ensurePage("Mechanisms"),
  Treatments: await ensurePage("Treatments"),
  Evidence: await ensurePage("Evidence"),
};

for (const [name, id] of Object.entries(pages)) {
  if (!id) {
    throw new Error(`Missing required page "${name}".`);
  }
}

const blocks = {
  overviewText: await ensureTextBlock({
    key: "Overview guide",
    text: TEXT_BLOCKS.overview,
  }),
  asthmaText: await ensureTextBlock({
    key: "Asthma explorer guide",
    text: TEXT_BLOCKS.asthma,
  }),
  mechanismsText: await ensureTextBlock({
    key: "Mechanisms guide",
    text: TEXT_BLOCKS.Mechanisms,
  }),
  treatmentsText: await ensureTextBlock({
    key: "Treatments guide",
    text: TEXT_BLOCKS.Treatments,
  }),
  evidenceText: await ensureTextBlock({
    key: "Evidence guide",
    text: TEXT_BLOCKS.Evidence,
  }),
  diseases: existingBlock("Diseases").id,
  genes: existingBlock("Asthma genes").id,
  drugs: existingBlock("Asthma drugs").id,
  drugClasses: existingBlock("Asthma drug classes").id,
  pathways: existingBlock("Asthma pathways").id,
  goAnnotations: existingBlock("GO annotations").id,
  evidenceRelations: existingBlock("Asthma evidence relations").id,
  datasets: updateQueryBlockFilter({
    blockName: "Datasets",
    typeId: datasetType.id,
    description: "Dataset entities used in Disease Atlas.",
  }),
  sources: updateQueryBlockFilter({
    blockName: "Sources",
    typeId: sourceType.id,
    description: "Source authority entities used in Disease Atlas.",
  }),
};

await resetBlockLayout({
  entityId: config.targetSpaceEntityId,
  label: "Overview",
  blockIds: [
    blocks.overviewText,
    blocks.diseases,
    blocks.genes,
    blocks.drugs,
    blocks.drugClasses,
    blocks.pathways,
    blocks.goAnnotations,
    blocks.datasets,
    blocks.sources,
    blocks.evidenceRelations,
  ],
});

await resetBlockLayout({
  entityId: ASTHMA_ENTITY_ID,
  label: "Asthma entity",
  blockIds: [
    blocks.asthmaText,
    blocks.genes,
    blocks.drugs,
    blocks.drugClasses,
    blocks.pathways,
    blocks.goAnnotations,
    blocks.datasets,
    blocks.sources,
    blocks.evidenceRelations,
  ],
});

await resetBlockLayout({
  entityId: pages.Mechanisms,
  label: "Mechanisms",
  blockIds: [blocks.mechanismsText, blocks.genes, blocks.pathways, blocks.goAnnotations],
});

await resetBlockLayout({
  entityId: pages.Treatments,
  label: "Treatments",
  blockIds: [blocks.treatmentsText, blocks.drugs, blocks.drugClasses],
});

await resetBlockLayout({
  entityId: pages.Evidence,
  label: "Evidence",
  blockIds: [
    blocks.evidenceText,
    blocks.evidenceRelations,
    blocks.datasets,
    blocks.sources,
  ],
});

await resetTabs([
  { name: "Asthma", id: ASTHMA_ENTITY_ID },
  { name: "Mechanisms", id: pages.Mechanisms },
  { name: "Treatments", id: pages.Treatments },
  { name: "Evidence", id: pages.Evidence },
  { name: "Diseases", id: pages.Diseases },
  { name: "Sources", id: pages.Sources },
  { name: "Ontology", id: pages.Ontology },
  { name: "About", id: pages.About },
]);

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - explorer tabs",
  ops,
  touched,
});

console.log(JSON.stringify(result, null, 2));
