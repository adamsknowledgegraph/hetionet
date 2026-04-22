import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  fetchEntity,
  findEntityInSpace,
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
import { buildEvidenceSchema, buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";
import {
  ensureCollectionBlock,
  ensureTextBlock,
} from "./lib/proposal-utils.mjs";

const PROPOSAL_NAME = "Disease Atlas - Navigation and browse polish";
const NAV_VERSION = "nav-polish-v2";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const ops = [];
const columnSpecsByBlockId = new Map();
const touched = {
  createdPages: [],
  updatedPages: [],
  textBlocks: [],
  syncedPages: [],
  updatedGlobalBlocks: [],
  diseaseProfiles: {},
  collectionBlocks: {},
  configuredColumns: {},
  tabsReset: [],
};

async function listEntitiesByType(typeId, first = 1000) {
  const data = await gql(`{
    entities(spaceId: "${config.targetSpaceId}", typeId: "${typeId}", first: ${first}) {
      id
      name
      description
      spaceIds
      typeIds
    }
  }`);

  return data.entities ?? [];
}

async function mustFindProperty(name, preferredSpaceIds = [ROOT_SPACE_ID, HEALTH_SPACE_ID]) {
  const entity = await findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds: [...preferredSpaceIds, config.targetSpaceId],
  });

  if (!entity) {
    throw new Error(`Missing expected shared property "${name}".`);
  }

  return entity;
}

const sharedTypes = {
  Page: mustGetNamedEntry(manifest.types, "Page", "type"),
  Disease: mustGetNamedEntry(manifest.types, "Disease", "type"),
  Drug: mustGetNamedEntry(manifest.types, "Drug", "type"),
  "Drug class": mustGetNamedEntry(manifest.types, "Drug class", "type"),
  Gene: mustGetNamedEntry(manifest.types, "Gene", "type"),
  Pathway: mustGetNamedEntry(manifest.types, "Pathway", "type"),
  Dataset: mustGetNamedEntry(manifest.types, "Dataset", "type"),
  Source: mustGetNamedEntry(manifest.types, "Source", "type"),
  Paper: mustGetNamedEntry(manifest.types, "Paper", "type"),
  Symptom: await findPreferredEntity({
    typeId: SystemIds.SCHEMA_TYPE,
    name: "Symptom",
    preferredSpaceIds: [HEALTH_SPACE_ID],
  }),
  "Anatomical structure": await findPreferredEntity({
    typeId: SystemIds.SCHEMA_TYPE,
    name: "Anatomical structure",
    preferredSpaceIds: [HEALTH_SPACE_ID],
  }),
};

const sharedProperties = {
  Sources: mustGetNamedEntry(manifest.properties, "Sources", "property"),
  Tabs: mustGetNamedEntry(manifest.properties, "Tabs", "property"),
  Treats: mustGetNamedEntry(manifest.properties, "Treats", "property"),
  Website: await mustFindProperty("Website", [ROOT_SPACE_ID]),
  DOI: await mustFindProperty("DOI", [ROOT_SPACE_ID]),
  Pmid: await mustFindProperty("Pmid", [HEALTH_SPACE_ID, ROOT_SPACE_ID]),
  "Publish date": await mustFindProperty("Publish date", [ROOT_SPACE_ID]),
  "Source database identifier": await mustFindProperty(
    "Source database identifier",
    [ROOT_SPACE_ID]
  ),
  "DrugBank ID": await mustFindProperty("DrugBank ID", [HEALTH_SPACE_ID]),
  Inchikey: await mustFindProperty("Inchikey", [HEALTH_SPACE_ID]),
  "Related pathways": await mustFindProperty("Related pathways", [HEALTH_SPACE_ID]),
};

const localSchema = buildLocalSchema(config.targetSpaceId, {
  Gene: sharedTypes.Gene,
  Pathway: sharedTypes.Pathway,
  Drug: sharedTypes.Drug,
});
const evidenceSchema = buildEvidenceSchema(config.targetSpaceId, sharedTypes);

const localProperties = {
  "Disease Ontology ID": deterministicPropertyId(config.targetSpaceId, "Disease Ontology ID"),
  "Entrez Gene ID": deterministicPropertyId(config.targetSpaceId, "Entrez Gene ID"),
  License: deterministicPropertyId(config.targetSpaceId, "License"),
  InChI: deterministicPropertyId(config.targetSpaceId, "InChI"),
  "Class type": deterministicPropertyId(config.targetSpaceId, "Class type"),
};

const currentEntities = [
  ...(await listEntitiesByType(sharedTypes.Page.id)),
  ...(await listEntitiesByType(SystemIds.DATA_BLOCK)),
  ...(await listEntitiesByType(SystemIds.TEXT_BLOCK)),
];

function findLocalEntity(name, typeId) {
  return findEntityInSpace(currentEntities, { name, typeId });
}

function rememberEntity(entity) {
  currentEntities.push({
    id: entity.id,
    name: entity.name,
    description: entity.description,
    spaceIds: entity.spaceIds,
    typeIds: entity.typeIds,
  });
}

async function ensurePage({ name, description }) {
  const existing = findLocalEntity(name, sharedTypes.Page.id);
  if (existing) {
    if (description && existing.description !== description) {
      const { ops: updateOps } = Graph.updateEntity({
        id: existing.id,
        description,
      });
      ops.push(...updateOps);
      touched.updatedPages.push(name);
    }
    return existing;
  }

  const id = deterministicEntityId(config.targetSpaceId, "Page", name);
  const { ops: createOps } = Graph.createEntity({
    id,
    name,
    description,
    types: [sharedTypes.Page.id],
  });
  ops.push(...createOps);

  const entity = {
    id,
    name,
    description,
    spaceIds: [config.targetSpaceId],
    typeIds: [sharedTypes.Page.id],
  };
  rememberEntity(entity);
  touched.createdPages.push(name);
  return entity;
}

async function collectionRelations(blockId, toEntitySelection = "id name spaceIds typeIds") {
  const relations = [];
  for (const offset of [0, 1000]) {
    const data = await gql(`{
      relations(
        first: 1000,
        offset: ${offset},
        filter: {
          spaceId: { is: "${config.targetSpaceId}" },
          fromEntityId: { is: "${blockId}" },
          typeId: { is: "${SystemIds.COLLECTION_ITEM_RELATION_TYPE}" }
        }
      ) {
        toEntity { ${toEntitySelection} }
      }
    }`);
    const page = data.relations ?? [];
    relations.push(...page);
    if (page.length < 1000) break;
  }
  return relations;
}

async function fetchRelations({ fromId = null, toId = null, typeId }) {
  const filters = [
    `spaceId: { is: "${config.targetSpaceId}" }`,
    `typeId: { is: "${typeId}" }`,
  ];
  if (fromId) filters.push(`fromEntityId: { is: "${fromId}" }`);
  if (toId) filters.push(`toEntityId: { is: "${toId}" }`);

  const data = await gql(`{
    relations(first: 1000, filter: { ${filters.join(", ")} }) {
      id
      entityId
      type { id name }
      fromEntity { id name spaceIds typeIds }
      toEntity { id name spaceIds typeIds }
      entity { id name spaceIds typeIds }
    }
  }`);

  return data.relations ?? [];
}

function addEntity(itemMap, entity) {
  if (!entity?.id) return;
  itemMap.set(entity.id, entity.name ?? entity.id);
}

function addRelationEntity(itemMap, relation) {
  if (!relation?.entityId) return;
  itemMap.set(relation.entityId, relation.entity?.name ?? relation.entityId);
}

async function diseasesFromCollection() {
  const diseaseBlock = findLocalEntity("Diseases", SystemIds.DATA_BLOCK);
  if (!diseaseBlock) {
    throw new Error("Missing Diseases collection block.");
  }

  return (await collectionRelations(diseaseBlock.id))
    .map((relation) => relation.toEntity)
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function ensureNamedTextBlock(key, text) {
  const id = await ensureTextBlock({ ops, config, key, text });
  touched.textBlocks.push(key);
  return id;
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

function addPlacementColumnOps({ placementEntityId, label, blockId }) {
  const spec = columnSpecsByBlockId.get(blockId);
  if (!spec) return;

  const { blockName, columnIds } = spec;
  const { ops: viewOps } = Graph.createRelation({
    id: deterministicRelationId({
      fromId: placementEntityId,
      typeId: SystemIds.VIEW_PROPERTY,
      toId: SystemIds.TABLE_VIEW,
      spaceId: config.targetSpaceId,
      sourceKey: `${NAV_VERSION}:${label}:${blockName}:table-view`,
    }),
    fromEntity: placementEntityId,
    toEntity: SystemIds.TABLE_VIEW,
    type: SystemIds.VIEW_PROPERTY,
  });
  ops.push(...viewOps);

  let lastPosition = null;
  let columnIndex = 0;
  for (const columnId of columnIds.filter(Boolean)) {
    lastPosition = positionAfter(lastPosition);
    const { ops: columnOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: placementEntityId,
        typeId: SystemIds.SHOWN_COLUMNS,
        toId: columnId,
        spaceId: config.targetSpaceId,
        sourceKey: `${NAV_VERSION}:${label}:${blockName}:column:${columnIndex}`,
      }),
      fromEntity: placementEntityId,
      toEntity: columnId,
      type: SystemIds.SHOWN_COLUMNS,
      position: lastPosition,
    });
    ops.push(...columnOps);
    columnIndex += 1;
  }

  touched.configuredColumns[`${label}:${blockName}`] = columnIds.length;
}

async function resetTabs(tabEntities) {
  const spaceEntity = await fetchEntity(config.targetSpaceEntityId);
  const currentTabs = (spaceEntity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === sharedProperties.Tabs.id
  );

  for (const relation of currentTabs) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  let lastPosition = null;
  let index = 0;
  for (const tab of tabEntities) {
    lastPosition = positionAfter(lastPosition);
    const { ops: relationOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: config.targetSpaceEntityId,
        typeId: sharedProperties.Tabs.id,
        toId: tab.id,
        spaceId: config.targetSpaceId,
        sourceKey: `${NAV_VERSION}:tab:${index}:${tab.name}`,
      }),
      fromEntity: config.targetSpaceEntityId,
      toEntity: tab.id,
      type: sharedProperties.Tabs.id,
      position: lastPosition,
    });
    ops.push(...relationOps);
    touched.tabsReset.push(tab.name);
    index += 1;
  }
}

async function blockByName(name, aliases = []) {
  const block =
    [name, ...aliases]
      .map((candidate) => findLocalEntity(candidate, SystemIds.DATA_BLOCK))
      .find(Boolean) ?? null;
  if (!block) {
    throw new Error(`Missing expected data block "${name}".`);
  }
  return block.id;
}

function restoreGlobalBlock({ id, name, description }) {
  const existing = currentEntities.find((entity) => entity.id === id);
  if (existing?.name === name && existing?.description === description) return;

  const { ops: updateOps } = Graph.updateEntity({ id, name, description });
  ops.push(...updateOps);
  if (existing) {
    existing.name = name;
    existing.description = description;
  }
  touched.updatedGlobalBlocks.push(name);
}

async function makeCollectionBlock({ names, finalName, description, itemMap }) {
  if (itemMap.size === 0) return null;

  const block = await ensureCollectionBlock({
    ops,
    config,
    currentEntities,
    blockNames: names,
    finalName,
    description,
    itemMap,
  });
  touched.collectionBlocks[finalName] = block;
  return block.id;
}

function registerColumns(blockName, blockId, columnIds) {
  if (!blockId) return;
  columnSpecsByBlockId.set(blockId, { blockName, columnIds });
}

async function configureColumns(blockName, blockId, columnIds) {
  registerColumns(blockName, blockId, columnIds);
}

async function buildDiseaseProfile(disease) {
  const relationGroups = {
    genes: await fetchRelations({
      fromId: disease.id,
      typeId: localSchema.propertyIds["Associated genes"],
    }),
    treatments: await fetchRelations({
      toId: disease.id,
      typeId: sharedProperties.Treats.id,
    }),
    palliative: await fetchRelations({
      toId: disease.id,
      typeId: evidenceSchema.propertyIds["Palliates disease"],
    }),
    pathways: await fetchRelations({
      fromId: disease.id,
      typeId: sharedProperties["Related pathways"].id,
    }),
    symptoms: await fetchRelations({
      fromId: disease.id,
      typeId: evidenceSchema.propertyIds["Presents symptom evidence"],
    }),
    anatomy: await fetchRelations({
      fromId: disease.id,
      typeId: evidenceSchema.propertyIds["Localizes to anatomy evidence"],
    }),
    similar: await fetchRelations({
      fromId: disease.id,
      typeId: evidenceSchema.propertyIds["Resembles disease evidence"],
    }),
    upregulated: await fetchRelations({
      fromId: disease.id,
      typeId: evidenceSchema.propertyIds.Upregulates,
    }),
    downregulated: await fetchRelations({
      fromId: disease.id,
      typeId: evidenceSchema.propertyIds.Downregulates,
    }),
  };

  const collections = {
    genes: new Map(),
    treatments: new Map(),
    palliative: new Map(),
    pathways: new Map(),
    symptoms: new Map(),
    anatomy: new Map(),
    similar: new Map(),
    expression: new Map(),
    evidence: new Map(),
  };

  for (const relation of relationGroups.genes) {
    addEntity(collections.genes, relation.toEntity);
    addRelationEntity(collections.evidence, relation);
  }
  for (const relation of relationGroups.treatments) {
    addEntity(collections.treatments, relation.fromEntity);
    addRelationEntity(collections.evidence, relation);
  }
  for (const relation of relationGroups.palliative) {
    addEntity(collections.palliative, relation.fromEntity);
    addRelationEntity(collections.evidence, relation);
  }
  for (const relation of relationGroups.pathways) {
    addEntity(collections.pathways, relation.toEntity);
    addRelationEntity(collections.evidence, relation);
  }
  for (const relation of relationGroups.symptoms) {
    addEntity(collections.symptoms, relation.toEntity);
    addRelationEntity(collections.evidence, relation);
  }
  for (const relation of relationGroups.anatomy) {
    addEntity(collections.anatomy, relation.toEntity);
    addRelationEntity(collections.evidence, relation);
  }
  for (const relation of relationGroups.similar) {
    addEntity(collections.similar, relation.toEntity);
    addRelationEntity(collections.evidence, relation);
  }
  for (const relation of [
    ...relationGroups.upregulated,
    ...relationGroups.downregulated,
  ]) {
    addEntity(collections.expression, relation.toEntity);
    addRelationEntity(collections.evidence, relation);
  }

  const guideBlock = await ensureNamedTextBlock(
    `Disease profile guide:${disease.name}`,
    [
      `## ${disease.name}`,
      "",
      "This profile is organized disease-first. Start with associated genes and treating drugs, then inspect pathway context, symptom/anatomy cooccurrence evidence, expression evidence, and the underlying claim entities.",
      "",
      "Symptoms, anatomy, similarity, and expression rows are evidence-only imports. Open any claim in Evidence claims to inspect sources, Hetionet metaedge, import batch, raw edge ID, and source family.",
    ].join("\n")
  );

  const blockSpecs = [
    {
      key: "genes",
      name: `Profile - ${disease.name}: genes`,
      description: `Genes associated with ${disease.name} in Disease Atlas.`,
      columns: [
        localProperties["Entrez Gene ID"],
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "treatments",
      name: `Profile - ${disease.name}: treatments`,
      description: `Treating drugs for ${disease.name} imported from curated indication evidence.`,
      columns: [
        sharedProperties["DrugBank ID"].id,
        sharedProperties.Inchikey.id,
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "palliative",
      name: `Profile - ${disease.name}: palliative drugs`,
      description: `Palliative drug evidence for ${disease.name}.`,
      columns: [
        sharedProperties["DrugBank ID"].id,
        sharedProperties.Inchikey.id,
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "pathways",
      name: `Profile - ${disease.name}: pathways`,
      description: `Pathway context linked to ${disease.name} through associated genes.`,
      columns: [
        sharedProperties["Source database identifier"].id,
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "symptoms",
      name: `Profile - ${disease.name}: symptom evidence`,
      description: `Evidence-only symptom cooccurrence terms linked to ${disease.name}.`,
      columns: [
        sharedProperties["Source database identifier"].id,
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "anatomy",
      name: `Profile - ${disease.name}: anatomy evidence`,
      description: `Evidence-only anatomy cooccurrence terms linked to ${disease.name}.`,
      columns: [
        sharedProperties["Source database identifier"].id,
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "similar",
      name: `Profile - ${disease.name}: similar disease evidence`,
      description: `Disease-similarity evidence linked to ${disease.name}.`,
      columns: [
        localProperties["Disease Ontology ID"],
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "expression",
      name: `Profile - ${disease.name}: expression genes`,
      description: `STARGEO upregulated and downregulated gene evidence for ${disease.name}.`,
      columns: [
        localProperties["Entrez Gene ID"],
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "evidence",
      name: `Profile - ${disease.name}: evidence claims`,
      description: `Relation-level provenance claims directly connected to ${disease.name}.`,
      columns: [
        localSchema.propertyIds["Hetionet metaedge"],
        evidenceSchema.propertyIds["Evidence category"],
        evidenceSchema.propertyIds["Source family"],
        evidenceSchema.propertyIds["Log2 fold change"],
        sharedProperties.Sources.id,
        localSchema.propertyIds["Import batch"],
        evidenceSchema.propertyIds["Hetionet edge ID"],
      ],
    },
  ];

  const profileBlockIds = [guideBlock];
  for (const spec of blockSpecs) {
    const blockId = await makeCollectionBlock({
      names: [spec.name],
      finalName: spec.name,
      description: spec.description,
      itemMap: collections[spec.key],
    });
    if (blockId) {
      profileBlockIds.push(blockId);
      columnSpecsByBlockId.set(blockId, {
        blockName: spec.name,
        columnIds: spec.columns,
      });
    }
  }

  await syncBlocks({
    fromId: disease.id,
    label: `disease:${disease.name}`,
    blockIds: profileBlockIds,
  });

  touched.diseaseProfiles[disease.name] = Object.fromEntries(
    Object.entries(collections).map(([name, map]) => [name, map.size])
  );
}

const pages = {
  Diseases: await ensurePage({
    name: "Diseases",
    description: "Disease-first index of curated Disease Atlas packets.",
  }),
  Genes: await ensurePage({
    name: "Genes",
    description: "Gene-first browser for associated and differentially expressed genes.",
  }),
  Treatments: await ensurePage({
    name: "Treatments",
    description: "Drug and drug-class browser for curated and palliative treatment evidence.",
  }),
  Mechanisms: await ensurePage({
    name: "Mechanisms",
    description: "Mechanism browser for genes, pathways, GO annotations, anatomy, and expression evidence.",
  }),
  Evidence: await ensurePage({
    name: "Evidence",
    description: "Relation-level evidence and provenance browser.",
  }),
  Sources: await ensurePage({
    name: "Sources",
    description: "Source, dataset, and provenance inventory.",
  }),
  Papers: await ensurePage({
    name: "Papers",
    description: "Papers connected to Disease Atlas datasets and evidence sources.",
  }),
  Ontology: await ensurePage({
    name: "Ontology",
    description: "Types and properties used by Disease Atlas.",
  }),
  About: await ensurePage({
    name: "About",
    description: "Mission, scope, provenance policy, and usage notes for Disease Atlas.",
  }),
};

const globalBlocks = {
  Diseases: await blockByName("Diseases"),
  Genes: await blockByName("Genes", ["Asthma genes"]),
  "Treating drugs": await blockByName("Treating drugs"),
  "Drug classes": await blockByName("Drug classes"),
  Pathways: await blockByName("Pathways", ["Asthma pathways"]),
  "GO annotations": await blockByName("GO annotations"),
  Symptoms: await blockByName("Symptoms"),
  "Anatomy evidence": await blockByName("Anatomy evidence"),
  "Similar diseases": await blockByName("Similar diseases"),
  "Palliative drugs": await blockByName("Palliative drugs"),
  "Expression genes": await blockByName("Expression genes"),
  "Evidence relations": await blockByName("Evidence relations"),
  Datasets: await blockByName("Datasets"),
  Sources: await blockByName("Sources"),
  "Sources and datasets": await blockByName("Sources and datasets"),
  Papers: await blockByName("Papers"),
  Types: await blockByName("Types"),
  Properties: await blockByName("Properties"),
};

restoreGlobalBlock({
  id: globalBlocks.Genes,
  name: "Genes",
  description:
    "Genes associated with or differentially expressed in curated Disease Atlas disease packets.",
});
restoreGlobalBlock({
  id: globalBlocks.Pathways,
  name: "Pathways",
  description:
    "Reactome, PID, and WikiPathways pathway context connected to curated disease genes.",
});

for (const [blockName, blockId, columns] of [
  [
    "Diseases",
    globalBlocks.Diseases,
    [
      localProperties["Disease Ontology ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Genes",
    globalBlocks.Genes,
    [
      localProperties["Entrez Gene ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Treating drugs",
    globalBlocks["Treating drugs"],
    [
      sharedProperties["DrugBank ID"].id,
      sharedProperties.Inchikey.id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Drug classes",
    globalBlocks["Drug classes"],
    [
      sharedProperties["Source database identifier"].id,
      localProperties["Class type"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Pathways",
    globalBlocks.Pathways,
    [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "GO annotations",
    globalBlocks["GO annotations"],
    [
      localSchema.propertyIds["GO ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Symptoms",
    globalBlocks.Symptoms,
    [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Anatomy evidence",
    globalBlocks["Anatomy evidence"],
    [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Similar diseases",
    globalBlocks["Similar diseases"],
    [
      localProperties["Disease Ontology ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Palliative drugs",
    globalBlocks["Palliative drugs"],
    [
      sharedProperties["DrugBank ID"].id,
      sharedProperties.Inchikey.id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Expression genes",
    globalBlocks["Expression genes"],
    [
      localProperties["Entrez Gene ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Evidence relations",
    globalBlocks["Evidence relations"],
    [
      localSchema.propertyIds["Hetionet metaedge"],
      evidenceSchema.propertyIds["Evidence category"],
      evidenceSchema.propertyIds["Source family"],
      evidenceSchema.propertyIds["Log2 fold change"],
      sharedProperties.Sources.id,
      localSchema.propertyIds["Import batch"],
      evidenceSchema.propertyIds["Hetionet edge ID"],
    ],
  ],
  [
    "Datasets",
    globalBlocks.Datasets,
    [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties["Source database identifier"].id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Sources",
    globalBlocks.Sources,
    [
      sharedProperties.Website.id,
      sharedProperties["Source database identifier"].id,
      sharedProperties.DOI.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  ],
  [
    "Papers",
    globalBlocks.Papers,
    [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties.Pmid.id,
      sharedProperties["Publish date"].id,
      sharedProperties.Sources.id,
    ],
  ],
]) {
  registerColumns(blockName, blockId, columns);
}

const overviewGuide = await ensureNamedTextBlock(
  "Navigation guide:Overview",
  [
    "## Disease Atlas browse map",
    "",
    "Start with Diseases if you want a disease profile. Open a disease row to see a disease-specific page with genes, treatments, pathways, symptoms, anatomy evidence, expression genes, and claim-level provenance.",
    "",
    "Use Genes when you want to move gene-first across diseases. Use Evidence when you want the audit trail: every imported claim has sources, Hetionet metaedge, source family, import batch, and raw Hetionet edge ID.",
  ].join("\n")
);

const diseasesGuide = await ensureNamedTextBlock(
  "Navigation guide:Diseases",
  "Open a disease row to browse its focused profile. The disease table is intentionally small and curated; related/similar diseases are kept as evidence rows, not promoted into the curated disease index."
);

const genesGuide = await ensureNamedTextBlock(
  "Navigation guide:Genes",
  "Use this page for gene-first exploration. Genes includes curated disease associations and expression genes; open a gene to inspect backlinks to diseases, pathways, GO annotations, and source-backed evidence claims."
);

const treatmentsGuide = await ensureNamedTextBlock(
  "Navigation guide:Treatments",
  "Treating drugs are curated indication relations. Palliative drugs are kept separate because their Hetionet meaning is different from Treats. Drug classes preserve DrugCentral/NDF-RT class membership."
);

const mechanismsGuide = await ensureNamedTextBlock(
  "Navigation guide:Mechanisms",
  "Mechanisms groups the biological context around diseases: genes, pathways, GO annotations, anatomy evidence, and expression changes. Use disease profiles for a filtered disease-first view."
);

const evidenceGuide = await ensureNamedTextBlock(
  "Navigation guide:Evidence",
  "Evidence relations are the claim ledger. Cooccurrence, similarity, and expression rows are evidence-only imports. Open any row to trace sources, import batch, metaedge, raw edge ID, and quantitative values."
);

const sourcesGuide = await ensureNamedTextBlock(
  "Navigation guide:Sources",
  "Sources and datasets are first-class entities. Dataset/source/paper rows carry external links, DOI/PMID where available, and backlinks from the claims or entities they support."
);

const papersGuide = await ensureNamedTextBlock(
  "Navigation guide:Papers",
  "Papers document Hetionet and selected upstream source methods. Use Sources for database/ontology provenance and Evidence for claim-level traceability."
);

const ontologyGuide = await ensureNamedTextBlock(
  "Navigation guide:Ontology",
  "Disease Atlas reuses Health and Root ontology wherever possible. Local ontology is limited to GO-style mechanism concepts and evidence/provenance properties needed for Hetionet-derived curation."
);

const aboutGuide = await ensureNamedTextBlock(
  "Navigation guide:About",
  [
    "Disease Atlas is a disease-centered biomedical knowledge graph built on Geo. It starts from curated Hetionet-derived packets and keeps noisy/cooccurrence data labeled as evidence rather than clinical fact.",
    "",
    "The browsing goal is simple: disease -> genes -> mechanisms/treatments -> evidence -> sources. Geo remains the source of truth, and dashboard views should query these entities and relation claims rather than maintaining a separate biomedical database.",
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
    globalBlocks["Evidence relations"],
    globalBlocks["Sources and datasets"],
  ],
});

await syncBlocks({
  fromId: pages.Diseases.id,
  label: "Diseases",
  blockIds: [
    diseasesGuide,
    globalBlocks.Diseases,
    globalBlocks["Similar diseases"],
    globalBlocks.Symptoms,
    globalBlocks["Anatomy evidence"],
  ],
});

await syncBlocks({
  fromId: pages.Genes.id,
  label: "Genes",
  blockIds: [
    genesGuide,
    globalBlocks.Genes,
    globalBlocks["Expression genes"],
    globalBlocks.Pathways,
    globalBlocks["GO annotations"],
  ],
});

await syncBlocks({
  fromId: pages.Treatments.id,
  label: "Treatments",
  blockIds: [
    treatmentsGuide,
    globalBlocks["Treating drugs"],
    globalBlocks["Drug classes"],
    globalBlocks["Palliative drugs"],
  ],
});

await syncBlocks({
  fromId: pages.Mechanisms.id,
  label: "Mechanisms",
  blockIds: [
    mechanismsGuide,
    globalBlocks.Genes,
    globalBlocks.Pathways,
    globalBlocks["GO annotations"],
    globalBlocks["Expression genes"],
    globalBlocks["Anatomy evidence"],
  ],
});

await syncBlocks({
  fromId: pages.Evidence.id,
  label: "Evidence",
  blockIds: [
    evidenceGuide,
    globalBlocks["Evidence relations"],
    globalBlocks.Symptoms,
    globalBlocks["Anatomy evidence"],
    globalBlocks["Similar diseases"],
    globalBlocks["Expression genes"],
  ],
});

await syncBlocks({
  fromId: pages.Sources.id,
  label: "Sources",
  blockIds: [
    sourcesGuide,
    globalBlocks.Datasets,
    globalBlocks.Sources,
    globalBlocks["Sources and datasets"],
    globalBlocks.Papers,
  ],
});

await syncBlocks({
  fromId: pages.Papers.id,
  label: "Papers",
  blockIds: [papersGuide, globalBlocks.Papers],
});

await syncBlocks({
  fromId: pages.Ontology.id,
  label: "Ontology",
  blockIds: [ontologyGuide, globalBlocks.Types, globalBlocks.Properties],
});

await syncBlocks({
  fromId: pages.About.id,
  label: "About",
  blockIds: [aboutGuide],
});

const diseases = await diseasesFromCollection();
for (const disease of diseases) {
  await buildDiseaseProfile(disease);
}

const globalColumnSpecs = {
  Diseases: {
    id: globalBlocks.Diseases,
    columns: [
      localProperties["Disease Ontology ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  Genes: {
    id: globalBlocks.Genes,
    columns: [
      localProperties["Entrez Gene ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "Treating drugs": {
    id: globalBlocks["Treating drugs"],
    columns: [
      sharedProperties["DrugBank ID"].id,
      sharedProperties.Inchikey.id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "Drug classes": {
    id: globalBlocks["Drug classes"],
    columns: [
      sharedProperties["Source database identifier"].id,
      localProperties["Class type"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  Pathways: {
    id: globalBlocks.Pathways,
    columns: [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "GO annotations": {
    id: globalBlocks["GO annotations"],
    columns: [
      localSchema.propertyIds["GO ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  Symptoms: {
    id: globalBlocks.Symptoms,
    columns: [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "Anatomy evidence": {
    id: globalBlocks["Anatomy evidence"],
    columns: [
      sharedProperties["Source database identifier"].id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "Similar diseases": {
    id: globalBlocks["Similar diseases"],
    columns: [
      localProperties["Disease Ontology ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "Palliative drugs": {
    id: globalBlocks["Palliative drugs"],
    columns: [
      sharedProperties["DrugBank ID"].id,
      sharedProperties.Inchikey.id,
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "Expression genes": {
    id: globalBlocks["Expression genes"],
    columns: [
      localProperties["Entrez Gene ID"],
      sharedProperties.Website.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  "Evidence relations": {
    id: globalBlocks["Evidence relations"],
    columns: [
      localSchema.propertyIds["Hetionet metaedge"],
      evidenceSchema.propertyIds["Evidence category"],
      evidenceSchema.propertyIds["Source family"],
      evidenceSchema.propertyIds["Log2 fold change"],
      sharedProperties.Sources.id,
      localSchema.propertyIds["Import batch"],
      evidenceSchema.propertyIds["Hetionet edge ID"],
    ],
  },
  Datasets: {
    id: globalBlocks.Datasets,
    columns: [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties["Source database identifier"].id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  Sources: {
    id: globalBlocks.Sources,
    columns: [
      sharedProperties.Website.id,
      sharedProperties["Source database identifier"].id,
      sharedProperties.DOI.id,
      sharedProperties.Sources.id,
      localProperties.License,
    ],
  },
  Papers: {
    id: globalBlocks.Papers,
    columns: [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties.Pmid.id,
      sharedProperties["Publish date"].id,
      sharedProperties.Sources.id,
    ],
  },
};

for (const [blockName, spec] of Object.entries(globalColumnSpecs)) {
  await configureColumns(blockName, spec.id, spec.columns);
}

await resetTabs([
  pages.Diseases,
  pages.Genes,
  pages.Treatments,
  pages.Mechanisms,
  pages.Evidence,
  pages.Sources,
  pages.Papers,
  pages.Ontology,
  pages.About,
]);

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
        skipped: "Disease Atlas navigation is already polished.",
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
