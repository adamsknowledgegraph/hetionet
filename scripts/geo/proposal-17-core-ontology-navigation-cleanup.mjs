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

const PROPOSAL_NAME = "Disease Atlas - Core ontology and navigation cleanup";
const NAV_VERSION = "core-ontology-nav-v1";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const ops = [];
const columnSpecsByBlockId = new Map();
const touched = {
  renamedProperties: [],
  renamedRelationEntities: [],
  removedRelationValueTypeConstraints: [],
  createdPages: [],
  updatedPages: [],
  textBlocks: [],
  collectionBlocks: {},
  syncedPages: [],
  configuredColumns: {},
  tabsReset: [],
  diseaseProfiles: {},
};

async function listEntitiesByType(typeId, first = 1000) {
  const entities = [];
  const pageSize = 1000;

  for (let offset = 0; offset < first; offset += pageSize) {
    const data = await gql(`{
      entities(
        spaceId: "${config.targetSpaceId}",
        typeId: "${typeId}",
        first: ${pageSize},
        offset: ${offset}
      ) {
        id
        name
        description
        spaceIds
        typeIds
      }
    }`);

    const page = data.entities ?? [];
    entities.push(...page);
    if (page.length < pageSize) break;
  }

  return entities;
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

async function maybeFindProperty(name, preferredSpaceIds = [HEALTH_SPACE_ID, ROOT_SPACE_ID]) {
  return findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds: [...preferredSpaceIds, config.targetSpaceId],
  });
}

async function fetchRelationsByType(typeId) {
  const relations = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const data = await gql(`{
      relations(
        first: ${pageSize},
        offset: ${offset},
        filter: {
          spaceId: { is: "${config.targetSpaceId}" },
          typeId: { is: "${typeId}" }
        }
      ) {
        id
        entityId
        fromEntity { id name }
        toEntity { id name }
        entity { id name }
      }
    }`);

    const page = data.relations ?? [];
    relations.push(...page);
    if (page.length < pageSize) break;
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

  const relations = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const data = await gql(`{
      relations(
        first: ${pageSize},
        offset: ${offset},
        filter: { ${filters.join(", ")} }
      ) {
        id
        entityId
        type { id name }
        fromEntity { id name spaceIds typeIds }
        toEntity { id name spaceIds typeIds }
        entity { id name spaceIds typeIds }
      }
    }`);

    const page = data.relations ?? [];
    relations.push(...page);
    if (page.length < pageSize) break;
  }

  return relations;
}

async function fetchRelationValueTypeConstraints(propertyId) {
  const constraints = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const data = await gql(`{
      relations(
        first: ${pageSize},
        offset: ${offset},
        filter: {
          spaceId: { is: "${config.targetSpaceId}" },
          fromEntityId: { is: "${propertyId}" },
          typeId: { is: "${SystemIds.RELATION_VALUE_RELATIONSHIP_TYPE}" }
        }
      ) {
        id
        toEntity { id name }
      }
    }`);

    const page = data.relations ?? [];
    constraints.push(...page);
    if (page.length < pageSize) break;
  }

  return constraints;
}

async function collectionRelations(blockId, toEntitySelection = "id name spaceIds typeIds") {
  const relations = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const data = await gql(`{
      relations(
        first: ${pageSize},
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
    if (page.length < pageSize) break;
  }

  return relations;
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
  "Version ID": await mustFindProperty("Version ID", [ROOT_SPACE_ID]),
  "DrugBank ID": await mustFindProperty("DrugBank ID", [HEALTH_SPACE_ID]),
  Inchikey: await mustFindProperty("Inchikey", [HEALTH_SPACE_ID]),
  "Related drugs": await mustFindProperty("Related drugs", [HEALTH_SPACE_ID]),
  "Related pathways": await mustFindProperty("Related pathways", [HEALTH_SPACE_ID]),
};

const optionalSharedProperties = {
  Symptoms: await maybeFindProperty("Symptoms", [HEALTH_SPACE_ID]),
  "Side effects": await maybeFindProperty("Side effects", [HEALTH_SPACE_ID]),
  "Evidence level": await maybeFindProperty("Evidence level", [HEALTH_SPACE_ID]),
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
  ...(await listEntitiesByType(SystemIds.PROPERTY)),
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

async function ensureNamedTextBlock(key, text) {
  const id = await ensureTextBlock({ ops, config, key, text });
  touched.textBlocks.push(key);
  return id;
}

function addEntity(itemMap, entity) {
  if (!entity?.id) return;
  itemMap.set(entity.id, entity.name ?? entity.id);
}

function addRelationEntity(itemMap, relation) {
  if (!relation?.entityId) return;
  itemMap.set(relation.entityId, relation.entity?.name ?? relation.entityId);
}

function registerColumns(blockName, blockId, columnIds) {
  if (!blockId) return;
  columnSpecsByBlockId.set(blockId, { blockName, columnIds });
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

async function applyPropertyCleanup(property) {
  const { ops: propertyOps } = Graph.updateEntity({
    id: property.id,
    name: property.name,
    description: property.description,
  });
  ops.push(...propertyOps);
  touched.renamedProperties.push({
    id: property.id,
    from: property.oldName,
    to: property.name,
  });

  const constraints = await fetchRelationValueTypeConstraints(property.id);
  for (const constraint of constraints) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: constraint.id });
    ops.push(...deleteOps);
    touched.removedRelationValueTypeConstraints.push({
      propertyId: property.id,
      propertyName: property.name,
      relationId: constraint.id,
      constrainedTo: constraint.toEntity?.name ?? constraint.toEntity?.id ?? null,
    });
  }

  const relations = await fetchRelationsByType(property.id);
  for (const relation of relations) {
    if (!relation.entityId) continue;

    const fromName = relation.fromEntity?.name ?? relation.fromEntity?.id ?? "Unknown";
    const toName = relation.toEntity?.name ?? relation.toEntity?.id ?? "Unknown";
    const nextName = `${fromName} - ${property.name} - ${toName}`;

    if (relation.entity?.name === nextName) continue;

    const { ops: renameOps } = Graph.updateEntity({
      id: relation.entityId,
      name: nextName,
    });
    ops.push(...renameOps);
    touched.renamedRelationEntities.push({
      id: relation.entityId,
      from: relation.entity?.name ?? null,
      to: nextName,
    });
  }
}

const reusableRelationProperties = [
  {
    id: localSchema.propertyIds["Associated genes"],
    oldName: "Associated genes",
    name: "Associated with",
    description:
      "General association relation between biomedical entities. Disease Atlas uses this for disease-gene association evidence, but it is reusable for other entity pairs when the evidence supports a non-directional association.",
  },
  {
    id: localSchema.propertyIds["Includes drug"],
    oldName: "Includes drug",
    name: "Includes",
    description:
      "General membership or containment relation. Disease Atlas uses this for drug-class membership, but it is reusable wherever one entity includes another.",
  },
  {
    id: evidenceSchema.propertyIds["Presents symptom evidence"],
    oldName: "Presents symptom evidence",
    name: "Presents with",
    description:
      "Presentation relation linking an entity to an observed sign, symptom, phenotype, or clinical presentation. Evidence strength and provenance belong on the relation entity.",
  },
  {
    id: evidenceSchema.propertyIds["Localizes to anatomy evidence"],
    oldName: "Localizes to anatomy evidence",
    name: "Localizes to",
    description:
      "Localization relation linking an entity to an anatomical, cellular, tissue, organ, or spatial context. Evidence strength and provenance belong on the relation entity.",
  },
  {
    id: evidenceSchema.propertyIds["Resembles disease evidence"],
    oldName: "Resembles disease evidence",
    name: "Resembles",
    description:
      "Similarity relation between entities. Disease Atlas currently uses this for disease-disease similarity evidence, but the predicate is intentionally reusable.",
  },
  {
    id: evidenceSchema.propertyIds["Palliates disease"],
    oldName: "Palliates disease",
    name: "Palliates",
    description:
      "Palliative relation where an intervention helps relieve, manage, or reduce an entity without necessarily treating its underlying cause.",
  },
];

for (const property of reusableRelationProperties) {
  await applyPropertyCleanup(property);
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
    description: "Drug and drug-class browser for treatment and palliative evidence.",
  }),
  Mechanisms: await ensurePage({
    name: "Mechanisms",
    description: "Mechanism browser for genes, pathways, GO terms, anatomy, and expression evidence.",
  }),
  Evidence: await ensurePage({
    name: "Evidence",
    description: "Relation-level evidence and provenance browser.",
  }),
  Sources: await ensurePage({
    name: "Sources",
    description: "Source, dataset, paper, and provenance inventory.",
  }),
  Papers: await ensurePage({
    name: "Papers",
    description: "Papers connected to Disease Atlas datasets and evidence sources.",
  }),
  Ontology: await ensurePage({
    name: "Ontology",
    description: "Builder-facing types, relation vocabulary, and useful evidence/source fields.",
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
};

const coreRelationVocabulary = new Map(
  [
    [localSchema.propertyIds["Associated genes"], "Associated with"],
    [sharedProperties.Treats.id, "Treats"],
    [sharedProperties["Related drugs"].id, "Related drugs"],
    [evidenceSchema.propertyIds["Palliates disease"], "Palliates"],
    [evidenceSchema.propertyIds["Presents symptom evidence"], "Presents with"],
    [optionalSharedProperties.Symptoms?.id, "Symptoms"],
    [evidenceSchema.propertyIds["Localizes to anatomy evidence"], "Localizes to"],
    [evidenceSchema.propertyIds["Resembles disease evidence"], "Resembles"],
    [evidenceSchema.propertyIds.Upregulates, "Upregulates"],
    [evidenceSchema.propertyIds.Downregulates, "Downregulates"],
    [sharedProperties["Related pathways"].id, "Related pathways"],
    [localSchema.propertyIds["Participates in pathway"], "Participates in pathway"],
    [
      localSchema.propertyIds["Participates in biological process"],
      "Participates in biological process",
    ],
    [localSchema.propertyIds["Has molecular function"], "Has molecular function"],
    [localSchema.propertyIds["Located in cellular component"], "Located in cellular component"],
    [localSchema.propertyIds["Includes drug"], "Includes"],
    [optionalSharedProperties["Side effects"]?.id, "Side effects"],
    [optionalSharedProperties["Evidence level"]?.id, "Evidence level"],
    [sharedProperties.Sources.id, "Sources"],
  ].filter(([id]) => Boolean(id))
);

const evidenceAndSourceFields = new Map([
  [evidenceSchema.propertyIds["Evidence category"], "Evidence category"],
  [evidenceSchema.propertyIds["Log2 fold change"], "Log2 fold change"],
  [localProperties.License, "License"],
  [sharedProperties.Website.id, "Website"],
  [sharedProperties.DOI.id, "DOI"],
  [sharedProperties.Pmid.id, "Pmid"],
  [sharedProperties["Publish date"].id, "Publish date"],
  [sharedProperties["Source database identifier"].id, "Source database identifier"],
  [sharedProperties["Version ID"].id, "Version ID"],
  [sharedProperties["DrugBank ID"].id, "DrugBank ID"],
  [sharedProperties.Inchikey.id, "Inchikey"],
  [localProperties["Disease Ontology ID"], "Disease Ontology ID"],
  [localProperties["Entrez Gene ID"], "Entrez Gene ID"],
  [localSchema.propertyIds["GO ID"], "GO ID"],
  [sharedProperties.Sources.id, "Sources"],
]);

const ontologyBlocks = {
  "Core relation vocabulary": await makeCollectionBlock({
    names: ["Core relation vocabulary"],
    finalName: "Core relation vocabulary",
    description:
      "Reusable relation properties that form the public Disease Atlas graph vocabulary.",
    itemMap: coreRelationVocabulary,
  }),
  "Evidence and source fields": await makeCollectionBlock({
    names: ["Evidence and source fields", "Useful evidence fields"],
    finalName: "Evidence and source fields",
    description:
      "Useful identifier, evidence, and source fields shown to builders. Importer-internal fields are intentionally omitted from this public ontology view.",
    itemMap: evidenceAndSourceFields,
  }),
};

const conciseEvidenceColumns = [
  evidenceSchema.propertyIds["Evidence category"],
  evidenceSchema.propertyIds["Log2 fold change"],
  sharedProperties.Sources.id,
  localProperties.License,
];

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
  ["Evidence relations", globalBlocks["Evidence relations"], conciseEvidenceColumns],
  [
    "Datasets",
    globalBlocks.Datasets,
    [
      sharedProperties.Website.id,
      sharedProperties.DOI.id,
      sharedProperties["Version ID"].id,
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
  [
    "Core relation vocabulary",
    ontologyBlocks["Core relation vocabulary"],
    [sharedProperties.Sources.id],
  ],
  [
    "Evidence and source fields",
    ontologyBlocks["Evidence and source fields"],
    [sharedProperties.Sources.id],
  ],
]) {
  registerColumns(blockName, blockId, columns);
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
      "This profile is organized disease-first. Start with associated genes and treating drugs, then inspect mechanisms, presentations, anatomy/localization, expression changes, and the evidence claims behind each row.",
      "",
      "Open rows in Evidence claims for provenance. The public view keeps builder-useful fields visible, especially Evidence category, Log2 fold change, Sources, external identifiers, and license/reuse terms.",
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
      name: `Profile - ${disease.name}: presentations`,
      description: `Evidence-only presentation terms linked to ${disease.name}.`,
      columns: [
        sharedProperties["Source database identifier"].id,
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "anatomy",
      name: `Profile - ${disease.name}: localization`,
      description: `Evidence-only anatomy/localization terms linked to ${disease.name}.`,
      columns: [
        sharedProperties["Source database identifier"].id,
        sharedProperties.Website.id,
        sharedProperties.Sources.id,
        localProperties.License,
      ],
    },
    {
      key: "similar",
      name: `Profile - ${disease.name}: similar entities`,
      description: `Similarity evidence linked to ${disease.name}.`,
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
      columns: conciseEvidenceColumns,
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
      registerColumns(spec.name, blockId, spec.columns);
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

const overviewGuide = await ensureNamedTextBlock(
  "Navigation guide:Overview",
  [
    "## Disease Atlas browse map",
    "",
    "Disease Atlas is organized around reusable biomedical claims: disease -> genes -> treatments and mechanisms -> evidence -> sources. Start with Diseases for a curated profile, or use Genes, Treatments, Mechanisms, Evidence, and Sources when you want a specific angle.",
    "",
    "Importer-only trace fields are preserved on claim entities when needed, but the public ontology foregrounds reusable relation verbs, useful identifiers, source links, evidence category, expression effect sizes, and license/reuse terms.",
  ].join("\n")
);

const diseasesGuide = await ensureNamedTextBlock(
  "Navigation guide:Diseases",
  "Open a disease row to browse its focused profile. Disease Atlas keeps the curated disease index separate from similar-disease evidence so users can distinguish curated packets from cooccurrence-derived leads."
);

const genesGuide = await ensureNamedTextBlock(
  "Navigation guide:Genes",
  "Use this page for gene-first exploration. Open a gene to inspect backlinks to diseases, pathways, GO annotations, expression evidence, and source-backed claim entities."
);

const treatmentsGuide = await ensureNamedTextBlock(
  "Navigation guide:Treatments",
  "Treating drugs are curated indication relations. Palliative drugs are separate because they mean symptom relief or management rather than disease modification. Drug classes use the reusable Includes relation."
);

const mechanismsGuide = await ensureNamedTextBlock(
  "Navigation guide:Mechanisms",
  "Mechanisms groups the biological context around diseases: genes, pathways, GO annotations, localization/anatomy evidence, and expression changes. Use disease profiles for filtered disease-first views."
);

const evidenceGuide = await ensureNamedTextBlock(
  "Navigation guide:Evidence",
  "Evidence is the claim ledger. Open a claim to inspect its relation, source links, evidence category, any quantitative value such as Log2 fold change, and reuse/license context. Cooccurrence and expression imports should be read as evidence, not clinical ground truth."
);

const sourcesGuide = await ensureNamedTextBlock(
  "Navigation guide:Sources",
  "Sources, datasets, and papers are first-class entities. Rows should carry external links, DOI/PMID where available, identifiers, versions, license terms, and backlinks from claims or imported entities."
);

const papersGuide = await ensureNamedTextBlock(
  "Navigation guide:Papers",
  "Papers document Hetionet and selected upstream source methods. Use Sources for database/ontology provenance and Evidence for claim-level traceability."
);

const ontologyGuide = await ensureNamedTextBlock(
  "Navigation guide:Ontology",
  [
    "## Builder-facing ontology",
    "",
    "Disease Atlas reuses Root and Health ontology first. Local ontology is kept intentionally small: GO-style mechanism types, reusable relation verbs, and practical source/evidence fields needed to build disease dashboards or downstream graph views.",
    "",
    "Importer internals such as raw Hetionet edge IDs, metaedge codes, unbiased flags, and import batches are not treated as public core ontology. They can remain on existing claim entities for auditability, but they are hidden from this curated builder view.",
  ].join("\n")
);

const aboutGuide = await ensureNamedTextBlock(
  "Navigation guide:About",
  [
    "Disease Atlas is a disease-centered biomedical knowledge graph built on Geo. The goal is a reusable repertoire where people can move from a disease to genes, therapies, pathways, presentations, evidence, and the source material behind each claim.",
    "",
    "The space is not meant to be an import log. It preserves provenance, but prioritizes clean public predicates, source-backed claims, external identifiers, and navigable collection views that a dashboard can query directly from Geo.",
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
  blockIds: [
    ontologyGuide,
    globalBlocks.Types,
    ontologyBlocks["Core relation vocabulary"],
    ontologyBlocks["Evidence and source fields"],
  ],
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

const result = await finalizeProposal({
  config,
  proposalName: PROPOSAL_NAME,
  ops,
  touched: {
    ...touched,
    relationEntityRenameCount: touched.renamedRelationEntities.length,
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
