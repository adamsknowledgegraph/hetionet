import { createTextBlockOps } from "./lib/blocks.mjs";
import { loadGeoEnv } from "./lib/env.mjs";
import { fetchEntity } from "./lib/graphql.mjs";
import { positionAfter, sortByPosition } from "./lib/ids.mjs";
import { loadLiveManifest } from "./lib/manifest.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();

const diseasesPageId =
  manifest.targetSnapshot.pages.Diseases?.id ??
  "c22f9892e9ca96fbcaf612d66d888a11";
const sourcesPageId =
  manifest.targetSnapshot.pages.Sources?.id ??
  "ff3a215bc94c43005ef2471548bf5eda";

const asthmaUrl =
  "https://www.geobrowser.io/space/141d3ace705feabc04d50c78bbf7226e/c1d11a58e7f548fca52da2f8f0642a06";
const il4Url =
  "https://www.geobrowser.io/space/141d3ace705feabc04d50c78bbf7226e/c99d5e7005b5df780a36b30193a30165";
const montelukastUrl =
  "https://www.geobrowser.io/space/141d3ace705feabc04d50c78bbf7226e/e2d52d2b1f1b41a7b6ba23d8c0a46cb9";
const sourcesUrl =
  "https://www.geobrowser.io/space/141d3ace705feabc04d50c78bbf7226e/ff3a215bc94c43005ef2471548bf5eda";

const DISEASES_VISIBILITY_TEXT =
  `Asthma wave 1 is live. This first Disease Atlas packet imports curated Hetionet v1.0 relationships for Asthma: 12 associated genes, 8 treating drugs, 3 drug classes, 3 pathways, 2 biological processes, 2 molecular functions, 1 cellular component, and 8 dataset/source entities. Open Asthma: ${asthmaUrl}`;

const DISEASES_READING_TEXT =
  `How to read the graph: Asthma has Associated genes relations to IL4, IL5, IL13, IL33, TSLP, TNF, ADRB2, PDE4A, STAT6, GATA3, ALOX5, and LTC4S. Treating drugs appear as backlinks because the graph direction is Drug Treats Asthma. Gene pages, for example IL4, show pathway and Gene Ontology annotations. IL4: ${il4Url} Montelukast: ${montelukastUrl}`;

const SOURCES_VISIBILITY_TEXT =
  `Wave 1 provenance is recorded on every imported relation entity with Import batch = asthma-v1, Hetionet metaedge, Unbiased, and Sources links. Sources include Hetionet v1.0, Disease Ontology, DISEASES, PharmacotherapyDB, DrugCentral, Gene Ontology, NCBI gene2go, and Reactome. Sources page: ${sourcesUrl}`;

async function appendTextBlocks({ pageId, texts }) {
  const page = await fetchEntity(pageId);
  const currentBlocks = (page?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.name === "Blocks"
  );
  let lastPosition = sortByPosition(currentBlocks).at(-1)?.position ?? null;
  const ops = [];

  for (const text of texts) {
    lastPosition = positionAfter(lastPosition);
    ops.push(
      ...createTextBlockOps({
        fromId: pageId,
        text,
        position: lastPosition,
      })
    );
  }

  return ops;
}

const ops = [
  ...(await appendTextBlocks({
    pageId: diseasesPageId,
    texts: [DISEASES_VISIBILITY_TEXT, DISEASES_READING_TEXT],
  })),
  ...(await appendTextBlocks({
    pageId: sourcesPageId,
    texts: [SOURCES_VISIBILITY_TEXT],
  })),
];

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - Asthma visibility",
  ops,
  touched: {
    pagesUpdated: ["Diseases", "Sources"],
    blocksCreated: [
      "Asthma wave 1 explainer",
      "Asthma graph reading guide",
      "Asthma provenance explainer",
    ],
    entitiesCreated: [],
    relationsChanged: [],
  },
});

console.log(JSON.stringify(result, null, 2));
