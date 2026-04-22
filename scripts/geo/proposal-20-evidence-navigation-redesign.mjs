import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  fetchEntity,
  findPreferredEntity,
  gql,
} from "./lib/graphql.mjs";
import {
  deterministicEntityId,
  deterministicPropertyId,
  deterministicRelationId,
  positionAfter,
  sortByPosition,
} from "./lib/ids.mjs";
import { buildEvidenceSchema } from "./lib/local-schema.mjs";
import {
  MARKDOWN_CONTENT_PROPERTY_ID,
  addSimpleRelation,
  ensureTextBlock,
} from "./lib/proposal-utils.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const PROPOSAL_NAME = "Disease Atlas - evidence navigation redesign";
const NAV_VERSION = "evidence-nav-v2";
const EVIDENCE_BLOCK_ID = "47fb6dd61feb518dde55ad2a4414120b";

const config = loadGeoEnv({ requirePrivateKey: false });
const ops = [];
const columnSpecsByBlockId = new Map();
const touched = {
  textBlocks: [],
  collectionBlocks: {},
  syncedPages: [],
  configuredColumns: {},
};

async function mustFindEntity({ name, typeId, preferredSpaceIds }) {
  const entity = await findPreferredEntity({
    typeId,
    name,
    preferredSpaceIds: [...preferredSpaceIds, config.targetSpaceId],
  });
  if (!entity) throw new Error(`Missing expected entity "${name}".`);
  return entity;
}

async function findExactEntity({ name, typeId, spaceId = config.targetSpaceId }) {
  const escapedName = JSON.stringify(name);
  const data = await gql(`{
    entities(
      spaceId: "${spaceId}",
      typeId: "${typeId}",
      filter: { name: { includesInsensitive: ${escapedName} } },
      first: 300
    ) {
      id
      name
      description
      spaceIds
      typeIds
    }
  }`);
  return (data.entities ?? []).find((entity) => entity.name === name) ?? null;
}

async function mustFindLocal(name, typeId) {
  const entity = await findExactEntity({ name, typeId });
  if (!entity) throw new Error(`Missing local entity "${name}".`);
  return entity;
}

const sharedTypes = {
  Page: await mustFindEntity({
    typeId: SystemIds.SCHEMA_TYPE,
    name: "Page",
    preferredSpaceIds: [ROOT_SPACE_ID],
  }),
  Pathway: await mustFindEntity({
    typeId: SystemIds.SCHEMA_TYPE,
    name: "Pathway",
    preferredSpaceIds: [HEALTH_SPACE_ID],
  }),
};

const sharedProperties = {
  Sources: await mustFindEntity({
    typeId: SystemIds.PROPERTY,
    name: "Sources",
    preferredSpaceIds: [ROOT_SPACE_ID],
  }),
  Website: await mustFindEntity({
    typeId: SystemIds.PROPERTY,
    name: "Website",
    preferredSpaceIds: [ROOT_SPACE_ID],
  }),
  Tabs: await mustFindEntity({
    typeId: SystemIds.PROPERTY,
    name: "Tabs",
    preferredSpaceIds: [ROOT_SPACE_ID],
  }),
};

const evidenceSchema = buildEvidenceSchema(config.targetSpaceId, sharedTypes);
const localProperties = {
  License: deterministicPropertyId(config.targetSpaceId, "License"),
};

function rawValue(value) {
  return (
    value.text ??
    value.boolean ??
    value.integer ??
    value.float ??
    value.date ??
    value.datetime ??
    ""
  );
}

function valueByName(entity, propertyName) {
  const value = (entity.values?.nodes ?? []).find(
    (entry) => entry.property?.name === propertyName
  );
  return value ? rawValue(value) : null;
}

async function evidenceItems() {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const data = await gql(`{
      relations(
        first: 1000,
        offset: ${offset},
        filter: {
          fromEntityId: { is: "${EVIDENCE_BLOCK_ID}" },
          typeId: { is: "${SystemIds.COLLECTION_ITEM_RELATION_TYPE}" }
        }
      ) {
        toEntity {
          id
          name
          values(first: 100) {
            nodes {
              property { id name }
              text
              boolean
              float
              integer
              date
              datetime
            }
          }
        }
      }
    }`);
    const page = data.relations ?? [];
    items.push(...page.map((relation) => relation.toEntity));
    if (page.length < 1000) break;
  }
  return items;
}

function addToMap(map, entity) {
  if (!entity?.id) return;
  map.set(entity.id, entity.name ?? entity.id);
}

const groups = {
  diseaseGene: new Map(),
  treatment: new Map(),
  expression: new Map(),
  presentations: new Map(),
  localization: new Map(),
  similarity: new Map(),
  pathways: new Map(),
  go: new Map(),
};

for (const entity of await evidenceItems()) {
  const category = valueByName(entity, "Evidence category");
  const metaedge = valueByName(entity, "Hetionet metaedge");

  if (category === "curated disease-gene association") {
    addToMap(groups.diseaseGene, entity);
  } else if (
    category === "curated treatment indication" ||
    category === "curated palliative indication" ||
    category === "pharmacologic class membership"
  ) {
    addToMap(groups.treatment, entity);
  } else if (category === "disease-gene expression") {
    addToMap(groups.expression, entity);
  } else if (category === "MEDLINE cooccurrence" && metaedge === "DpS") {
    addToMap(groups.presentations, entity);
  } else if (category === "MEDLINE cooccurrence" && metaedge === "DlA") {
    addToMap(groups.localization, entity);
  } else if (category === "disease similarity evidence" || metaedge === "DrD") {
    addToMap(groups.similarity, entity);
  } else if (category === "pathway annotation") {
    addToMap(groups.pathways, entity);
  } else if (category === "gene ontology annotation") {
    addToMap(groups.go, entity);
  }
}

async function ensureNamedTextBlock(key, text) {
  const id = await ensureTextBlock({ ops, config, key, text });
  touched.textBlocks.push(key);
  return id;
}

function existingTargets(entity, typeId) {
  return new Set(
    (entity?.relations?.nodes ?? [])
      .filter((relation) => relation.type?.id === typeId)
      .map((relation) => relation.toEntity?.id)
      .filter(Boolean)
  );
}

async function ensureCollectionBlockExact({ names, finalName, description, itemMap }) {
  const existing =
    (
      await Promise.all(
        names.map((name) => findExactEntity({ name, typeId: SystemIds.DATA_BLOCK }))
      )
    ).find(Boolean) ?? null;

  const id = existing?.id ?? deterministicEntityId(config.targetSpaceId, "Data block", finalName);
  const detail = existing ? await fetchEntity(existing.id) : null;
  const dataSourceRelations = (detail?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE
  );
  const collectionItemRelations = (detail?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.COLLECTION_ITEM_RELATION_TYPE
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
  }

  for (const relation of dataSourceRelations) {
    if (relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE) continue;
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  if (!dataSourceRelations.some((relation) => relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE)) {
    addSimpleRelation({
      ops,
      fromEntity: id,
      toEntity: SystemIds.COLLECTION_DATA_SOURCE,
      type: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
      spaceId: config.targetSpaceId,
      sourceKey: `${NAV_VERSION}:${finalName}:collection-source`,
    });
  }

  const desiredTargets = new Set(itemMap.keys());
  for (const relation of collectionItemRelations) {
    if (desiredTargets.has(relation.toEntity?.id)) continue;
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  const currentTargets = existingTargets(detail, SystemIds.COLLECTION_ITEM_RELATION_TYPE);
  let added = 0;
  for (const [itemId, itemName] of itemMap.entries()) {
    if (currentTargets.has(itemId)) continue;
    addSimpleRelation({
      ops,
      fromEntity: id,
      toEntity: itemId,
      type: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
      spaceId: config.targetSpaceId,
      sourceKey: `${NAV_VERSION}:${finalName}:item:${itemName}`,
    });
    added += 1;
  }

  touched.collectionBlocks[finalName] = {
    id,
    itemCount: itemMap.size,
    added,
  };
  return id;
}

function registerColumns(blockName, blockId, columnIds) {
  if (!blockId) return;
  columnSpecsByBlockId.set(blockId, { blockName, columnIds: columnIds.filter(Boolean) });
}

function addPlacementColumnOps({ placementEntityId, label, blockId }) {
  const spec = columnSpecsByBlockId.get(blockId);
  if (!spec) return;

  const { blockName, columnIds } = spec;
  addSimpleRelation({
    ops,
    fromEntity: placementEntityId,
    toEntity: SystemIds.TABLE_VIEW,
    type: SystemIds.VIEW_PROPERTY,
    spaceId: config.targetSpaceId,
    sourceKey: `${NAV_VERSION}:${label}:${blockName}:table-view`,
  });

  let lastPosition = null;
  let columnIndex = 0;
  for (const columnId of columnIds) {
    lastPosition = positionAfter(lastPosition);
    addSimpleRelation({
      ops,
      fromEntity: placementEntityId,
      toEntity: columnId,
      type: SystemIds.SHOWN_COLUMNS,
      spaceId: config.targetSpaceId,
      sourceKey: `${NAV_VERSION}:${label}:${blockName}:column:${columnIndex}`,
      position: lastPosition,
    });
    columnIndex += 1;
  }
  touched.configuredColumns[`${label}:${blockName}`] = columnIds.length;
}

async function syncBlocks({ fromId, label, blockIds }) {
  const entity = await fetchEntity(fromId);
  const currentBlocks = sortByPosition(
    (entity?.relations?.nodes ?? []).filter(
      (relation) => relation.type?.id === SystemIds.BLOCKS
    )
  );

  for (const relation of currentBlocks) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  let lastPosition = null;
  let index = 0;
  for (const blockId of blockIds.filter(Boolean)) {
    lastPosition = positionAfter(lastPosition);
    const relationEntityId = deterministicEntityId(
      config.targetSpaceId,
      "Block placement",
      `${NAV_VERSION}:${label}:${index}:${blockId}`
    );
    const { ops: relationOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId,
        typeId: SystemIds.BLOCKS,
        toId: blockId,
        spaceId: config.targetSpaceId,
        sourceKey: `${NAV_VERSION}:${label}:${index}`,
      }),
      entityId: relationEntityId,
      fromEntity: fromId,
      toEntity: blockId,
      type: SystemIds.BLOCKS,
      position: lastPosition,
    });
    ops.push(...relationOps);
    addPlacementColumnOps({ placementEntityId: relationEntityId, label, blockId });
    index += 1;
  }

  touched.syncedPages.push(label);
}

const pages = {
  Diseases: await mustFindLocal("Diseases", sharedTypes.Page.id),
  Genes: await mustFindLocal("Genes", sharedTypes.Page.id),
  Treatments: await mustFindLocal("Treatments", sharedTypes.Page.id),
  Mechanisms: await mustFindLocal("Mechanisms", sharedTypes.Page.id),
  Evidence: await mustFindLocal("Evidence", sharedTypes.Page.id),
  Sources: await mustFindLocal("Sources", sharedTypes.Page.id),
  Papers: await mustFindLocal("Papers", sharedTypes.Page.id),
  Ontology: await mustFindLocal("Ontology", sharedTypes.Page.id),
  About: await mustFindLocal("About", sharedTypes.Page.id),
};

const globalBlocks = {
  Diseases: (await mustFindLocal("Diseases", SystemIds.DATA_BLOCK)).id,
  Genes: (await mustFindLocal("Genes", SystemIds.DATA_BLOCK)).id,
  "Treating drugs": (await mustFindLocal("Treating drugs", SystemIds.DATA_BLOCK)).id,
  "Sources and datasets": (await mustFindLocal("Sources and datasets", SystemIds.DATA_BLOCK)).id,
  Papers: (await mustFindLocal("Papers", SystemIds.DATA_BLOCK)).id,
};

const evidenceColumns = [
  evidenceSchema.propertyIds["Evidence category"],
  evidenceSchema.propertyIds["Log2 fold change"],
  sharedProperties.Sources.id,
  localProperties.License,
];

const evidenceBlocks = {
  diseaseGene: await ensureCollectionBlockExact({
    names: ["Evidence - disease gene associations"],
    finalName: "Evidence - disease gene associations",
    description:
      "Curated disease-gene association claims. Open rows to inspect relation-level sources.",
    itemMap: groups.diseaseGene,
  }),
  treatment: await ensureCollectionBlockExact({
    names: ["Evidence - treatments and drug classes"],
    finalName: "Evidence - treatments and drug classes",
    description:
      "Treatment, palliative-treatment, and drug-class evidence claims.",
    itemMap: groups.treatment,
  }),
  expression: await ensureCollectionBlockExact({
    names: ["Evidence - expression changes"],
    finalName: "Evidence - expression changes",
    description:
      "Disease-gene upregulation and downregulation evidence with available log2 fold-change values.",
    itemMap: groups.expression,
  }),
  presentations: await ensureCollectionBlockExact({
    names: ["Evidence - presentation signals"],
    finalName: "Evidence - presentation signals",
    description:
      "MEDLINE cooccurrence presentation/symptom signals. These are evidence leads, not clinical assertions.",
    itemMap: groups.presentations,
  }),
  localization: await ensureCollectionBlockExact({
    names: ["Evidence - anatomy and localization signals"],
    finalName: "Evidence - anatomy and localization signals",
    description:
      "MEDLINE cooccurrence anatomy/localization signals. These are evidence leads, not canonical anatomy assertions.",
    itemMap: groups.localization,
  }),
  similarity: await ensureCollectionBlockExact({
    names: ["Evidence - disease similarity signals"],
    finalName: "Evidence - disease similarity signals",
    description:
      "Disease similarity evidence claims imported as exploratory signals.",
    itemMap: groups.similarity,
  }),
  pathways: await ensureCollectionBlockExact({
    names: ["Evidence - pathway annotations"],
    finalName: "Evidence - pathway annotations",
    description:
      "Gene-pathway annotation claims supporting disease mechanism context.",
    itemMap: groups.pathways,
  }),
  go: await ensureCollectionBlockExact({
    names: ["Evidence - Gene Ontology annotations"],
    finalName: "Evidence - Gene Ontology annotations",
    description:
      "Gene Ontology biological process, molecular function, and cellular component claims.",
    itemMap: groups.go,
  }),
};

for (const [name, id] of Object.entries(evidenceBlocks)) {
  registerColumns(name, id, evidenceColumns);
}
registerColumns("Treating drugs", globalBlocks["Treating drugs"], [
  await mustFindEntity({
    typeId: SystemIds.PROPERTY,
    name: "DrugBank ID",
    preferredSpaceIds: [HEALTH_SPACE_ID],
  }).then((entity) => entity.id),
  sharedProperties.Website.id,
  sharedProperties.Sources.id,
  localProperties.License,
]);

const overviewGuide = await ensureNamedTextBlock(
  "Navigation guide:Overview evidence redesign",
  [
    "Disease Atlas is organized for browsing, not auditing. Start with diseases, genes, treatments, and sources here, then use the Evidence tab for grouped claim tables.",
    "",
    "The raw all-claims ledger still exists as the backing Evidence relations collection, but it is intentionally not the first view because it mixes many evidence types.",
  ].join("\n")
);

const evidenceGuide = await ensureNamedTextBlock(
  "Navigation guide:Evidence grouped",
  [
    "## Evidence, grouped by question",
    "",
    `This page splits ${Object.values(groups).reduce((sum, map) => sum + map.size, 0)} evidence claims into smaller tables. Use the first two tables for high-signal curated claims, expression for quantitative disease-gene signals, and the MEDLINE tables as exploratory cooccurrence evidence rather than clinical truth.`,
    "",
    "| Section | What it answers |",
    "| --- | --- |",
    `| Disease-gene associations (${groups.diseaseGene.size}) | Which genes are curated as disease-associated? |`,
    `| Treatments and drug classes (${groups.treatment.size}) | Which drugs treat or palliate disease, and which classes include them? |`,
    `| Expression changes (${groups.expression.size}) | Which genes are up/downregulated in disease evidence? |`,
    `| Presentation signals (${groups.presentations.size}) | Which symptoms/presentations cooccur with diseases in MEDLINE-derived evidence? |`,
    `| Anatomy/localization signals (${groups.localization.size}) | Which anatomical contexts cooccur with diseases? |`,
    `| Disease similarity signals (${groups.similarity.size}) | Which diseases are similarity leads? |`,
    `| Pathway annotations (${groups.pathways.size}) | Which pathway claims support mechanism context? |`,
    `| Gene Ontology annotations (${groups.go.size}) | Which GO biological process/function/component claims support mechanism context? |`,
  ].join("\n")
);

await syncBlocks({
  fromId: config.targetSpaceEntityId,
  label: "Overview",
  blockIds: [
    overviewGuide,
    globalBlocks.Diseases,
    globalBlocks.Genes,
    globalBlocks["Treating drugs"],
    globalBlocks["Sources and datasets"],
    globalBlocks.Papers,
  ],
});

await syncBlocks({
  fromId: pages.Evidence.id,
  label: "Evidence",
  blockIds: [
    evidenceGuide,
    evidenceBlocks.diseaseGene,
    evidenceBlocks.treatment,
    evidenceBlocks.expression,
    evidenceBlocks.presentations,
    evidenceBlocks.localization,
    evidenceBlocks.similarity,
    evidenceBlocks.pathways,
    evidenceBlocks.go,
  ],
});

const result = await finalizeProposal({
  config,
  proposalName: PROPOSAL_NAME,
  ops,
  touched: {
    ...touched,
    groupCounts: Object.fromEntries(
      Object.entries(groups).map(([name, map]) => [name, map.size])
    ),
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
