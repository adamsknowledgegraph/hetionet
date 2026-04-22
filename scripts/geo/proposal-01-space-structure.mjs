import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { createQueryBlockOps, createTextBlockOps } from "./lib/blocks.mjs";
import { loadGeoEnv } from "./lib/env.mjs";
import { buildTypeFilter } from "./lib/filters.mjs";
import { fetchEntity, findEntityInSpace, listSpaceEntities } from "./lib/graphql.mjs";
import { positionAfter, sortByPosition, deterministicEntityId } from "./lib/ids.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

const SPACE_DESCRIPTION =
  "A disease-centered knowledge graph linking conditions to genes, pathways, anatomy, symptoms, and therapies, starting with curated Hetionet-derived relationships.";

const ABOUT_MISSION_TEXT =
  "Disease Atlas organizes curated disease mechanisms in Geo, linking diseases to genes, pathways, cellular functions, and therapies in a disease-first knowledge graph.";

const ABOUT_PROVENANCE_TEXT =
  "Wave 1 reuses shared Root and Health entities whenever they already exist and adds curated Hetionet-derived relations with explicit provenance. Noisy MEDLINE cooccurrence edges are intentionally excluded from the canonical graph.";

const PAPERS_DESCRIPTION =
  "Collected papers relevant to diseases, mechanisms, and therapies in Disease Atlas.";

const DISEASES_DESCRIPTION =
  "Disease entities curated and connected inside Disease Atlas.";

const DISEASES_INTRO =
  "Browse the diseases currently curated in Disease Atlas, starting with focused Hetionet-derived mechanism packets.";

const SOURCES_DESCRIPTION =
  "Datasets and source authorities used to curate Disease Atlas.";

const SOURCES_INTRO =
  "This page tracks the datasets and source authorities reused in Disease Atlas imports.";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();

const pageType = mustGetNamedEntry(manifest.types, "Page", "type");
const paperType = mustGetNamedEntry(manifest.types, "Paper", "type");
const diseaseType = mustGetNamedEntry(manifest.types, "Disease", "type");
const datasetType = mustGetNamedEntry(manifest.types, "Dataset", "type");
const sourceType = mustGetNamedEntry(manifest.types, "Source", "type");

const currentEntities = await listSpaceEntities(config.targetSpaceId);
const currentTargetPage = await fetchEntity(config.targetSpaceEntityId);
const aboutPageId = manifest.targetSnapshot.pages.About.id;
const papersPageId = manifest.targetSnapshot.pages.Papers.id;
const currentAboutPage = await fetchEntity(aboutPageId);
const currentPapersPage = await fetchEntity(papersPageId);

const ops = [];
const touched = {
  pagesUpdated: ["Disease Atlas", "About", "Papers"],
  pagesCreated: [],
  tabsRemoved: [],
  tabsAdded: [],
  blocksCreated: [],
  blocksUpdated: ["Recent papers"],
};

const { ops: spacePageOps } = Graph.updateEntity({
  id: config.targetSpaceEntityId,
  name: "Disease Atlas",
  description: SPACE_DESCRIPTION,
});
ops.push(...spacePageOps);

const currentTabRelations = (currentTargetPage?.relations?.nodes ?? []).filter(
  (relation) => relation.type?.id === manifest.properties.Tabs.id
);
const unwantedTabNames = new Set(["News", "People", "Courses", "Schools"]);

for (const relation of currentTabRelations) {
  if (!unwantedTabNames.has(relation.toEntity?.name)) {
    continue;
  }

  const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
  ops.push(...deleteOps);
  touched.tabsRemoved.push(relation.toEntity.name);
}

if (!currentPapersPage?.typeIds?.includes(pageType.id)) {
  const { ops: typeOps } = Graph.createRelation({
    fromEntity: papersPageId,
    toEntity: pageType.id,
    type: SystemIds.TYPES_PROPERTY,
  });
  ops.push(...typeOps);
}

const { ops: papersUpdateOps } = Graph.updateEntity({
  id: papersPageId,
  description: PAPERS_DESCRIPTION,
});
ops.push(...papersUpdateOps);

const goalsRelation = (currentAboutPage?.relations?.nodes ?? []).find(
  (relation) =>
    relation.type?.name === "Blocks" && relation.toEntity?.name === "Goals"
);

if (goalsRelation) {
  const { ops: deleteGoalsOps } = Graph.deleteRelation({ id: goalsRelation.id });
  ops.push(...deleteGoalsOps);
}

const remainingAboutBlocks = (currentAboutPage?.relations?.nodes ?? []).filter(
  (relation) =>
    relation.type?.name === "Blocks" && relation.id !== goalsRelation?.id
);
const lastAboutPosition = sortByPosition(remainingAboutBlocks).at(-1)?.position ?? null;
const aboutMissionPosition = positionAfter(lastAboutPosition);
const aboutProvenancePosition = positionAfter(aboutMissionPosition);

ops.push(
  ...createTextBlockOps({
    fromId: aboutPageId,
    text: ABOUT_MISSION_TEXT,
    position: aboutMissionPosition,
  })
);
ops.push(
  ...createTextBlockOps({
    fromId: aboutPageId,
    text: ABOUT_PROVENANCE_TEXT,
    position: aboutProvenancePosition,
  })
);

const diseasesPageExisting = findEntityInSpace(currentEntities, {
  name: "Diseases",
  typeId: pageType.id,
});
const sourcesPageExisting = findEntityInSpace(currentEntities, {
  name: "Sources",
  typeId: pageType.id,
});

const diseasesPageId =
  diseasesPageExisting?.id ??
  deterministicEntityId(config.targetSpaceId, "Page", "Diseases");
const sourcesPageId =
  sourcesPageExisting?.id ??
  deterministicEntityId(config.targetSpaceId, "Page", "Sources");

if (!diseasesPageExisting) {
  const { ops: diseasesPageOps } = Graph.createEntity({
    id: diseasesPageId,
    name: "Diseases",
    description: DISEASES_DESCRIPTION,
    types: [pageType.id],
  });
  ops.push(...diseasesPageOps);
  touched.pagesCreated.push("Diseases");
}

if (!sourcesPageExisting) {
  const { ops: sourcesPageOps } = Graph.createEntity({
    id: sourcesPageId,
    name: "Sources",
    description: SOURCES_DESCRIPTION,
    types: [pageType.id],
  });
  ops.push(...sourcesPageOps);
  touched.pagesCreated.push("Sources");
}

const currentTabNames = new Set(
  currentTabRelations.map((relation) => relation.toEntity?.name)
);
const keptTabs = sortByPosition(
  currentTabRelations.filter((relation) =>
    ["About", "Ontology", "Papers"].includes(relation.toEntity?.name)
  )
);
let lastTabPosition = keptTabs.at(-1)?.position ?? null;

if (!currentTabNames.has("Diseases")) {
  const diseasesTabPosition = positionAfter(lastTabPosition);
  const { ops: diseasesTabOps } = Graph.createRelation({
    fromEntity: config.targetSpaceEntityId,
    toEntity: diseasesPageId,
    type: manifest.properties.Tabs.id,
    position: diseasesTabPosition,
  });
  ops.push(...diseasesTabOps);
  touched.tabsAdded.push("Diseases");
  lastTabPosition = diseasesTabPosition;
}

if (!currentTabNames.has("Sources")) {
  const sourcesTabPosition = positionAfter(lastTabPosition);
  const { ops: sourcesTabOps } = Graph.createRelation({
    fromEntity: config.targetSpaceEntityId,
    toEntity: sourcesPageId,
    type: manifest.properties.Tabs.id,
    position: sourcesTabPosition,
  });
  ops.push(...sourcesTabOps);
  touched.tabsAdded.push("Sources");
}

if (!diseasesPageExisting) {
  const diseasesIntroPosition = positionAfter(null);
  ops.push(
    ...createTextBlockOps({
      fromId: diseasesPageId,
      text: DISEASES_INTRO,
      position: diseasesIntroPosition,
    })
  );
  touched.blocksCreated.push("Diseases intro");

  const diseasesBlock = createQueryBlockOps({
    fromId: diseasesPageId,
    name: "Diseases",
    filter: buildTypeFilter({
      spaceId: config.targetSpaceId,
      typeId: diseaseType.id,
    }),
    position: positionAfter(diseasesIntroPosition),
  });
  ops.push(...diseasesBlock.ops);
  touched.blocksCreated.push("Diseases query");
}

if (!sourcesPageExisting) {
  const sourcesIntroPosition = positionAfter(null);
  ops.push(
    ...createTextBlockOps({
      fromId: sourcesPageId,
      text: SOURCES_INTRO,
      position: sourcesIntroPosition,
    })
  );
  touched.blocksCreated.push("Sources intro");

  const datasetsBlock = createQueryBlockOps({
    fromId: sourcesPageId,
    name: "Datasets",
    filter: buildTypeFilter({
      spaceId: config.targetSpaceId,
      typeId: datasetType.id,
    }),
    position: positionAfter(sourcesIntroPosition),
  });
  ops.push(...datasetsBlock.ops);
  touched.blocksCreated.push("Datasets query");

  const sourcesBlockPosition = positionAfter(positionAfter(sourcesIntroPosition));
  const sourcesBlock = createQueryBlockOps({
    fromId: sourcesPageId,
    name: "Sources",
    filter: buildTypeFilter({
      spaceId: config.targetSpaceId,
      typeId: sourceType.id,
    }),
    position: sourcesBlockPosition,
  });
  ops.push(...sourcesBlock.ops);
  touched.blocksCreated.push("Sources query");
}

const { ops: recentPapersFilterOps } = Graph.updateEntity({
  id: manifest.targetSnapshot.blocks["Recent papers"].id,
  values: [
    {
      property: SystemIds.FILTER,
      type: "text",
      value: buildTypeFilter({
        spaceId: config.targetSpaceId,
        typeId: paperType.id,
      }),
    },
  ],
});
ops.push(...recentPapersFilterOps);

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - space structure",
  ops,
  touched,
});

console.log(JSON.stringify(result, null, 2));
