import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import { buildTypeFilter } from "./lib/filters.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  fetchEntity,
  findEntityInSpace,
  findPreferredEntity,
  gql,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import {
  deterministicEntityId,
  deterministicPropertyId,
  deterministicRelationEntityId,
  deterministicRelationId,
  positionAfter,
  relationEntityName,
  sortByPosition,
} from "./lib/ids.mjs";
import { buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

const MARKDOWN_CONTENT_PROPERTY_ID = "e3e363d1dd294ccb8e6ff3b76d99bc33";
const ASTHMA_ENTITY_ID = "c1d11a58e7f548fca52da2f8f0642a06";
const PAPERS_PAGE_ID = "4a5d0a501fad46bda99019e4c0f65c69";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();
const enrichment = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../data/geo/asthma-enrichment.json", import.meta.url)),
    "utf8"
  )
);

const currentEntities = await listSpaceEntities(config.targetSpaceId, 1000);
const pageType = mustGetNamedEntry(manifest.types, "Page", "type");
const paperType = mustGetNamedEntry(manifest.types, "Paper", "type");
const datasetType = mustGetNamedEntry(manifest.types, "Dataset", "type");
const sourceType = mustGetNamedEntry(manifest.types, "Source", "type");
const drugType = mustGetNamedEntry(manifest.types, "Drug", "type");
const drugClassType = mustGetNamedEntry(manifest.types, "Drug class", "type");
const geneType = mustGetNamedEntry(manifest.types, "Gene", "type");
const pathwayType = mustGetNamedEntry(manifest.types, "Pathway", "type");
const diseaseType = mustGetNamedEntry(manifest.types, "Disease", "type");
const sharedSourcesProperty = mustGetNamedEntry(
  manifest.properties,
  "Sources",
  "property"
);

const sharedProperties = {
  Website: await mustFindPreferredProperty("Website", [ROOT_SPACE_ID]),
  DOI: await mustFindPreferredProperty("DOI", [ROOT_SPACE_ID]),
  Pmid: await mustFindPreferredProperty("Pmid", [HEALTH_SPACE_ID, ROOT_SPACE_ID]),
  "Publish date": await mustFindPreferredProperty("Publish date", [ROOT_SPACE_ID]),
  Abstract: await mustFindPreferredProperty("Abstract", [ROOT_SPACE_ID]),
  "Source database identifier": await mustFindPreferredProperty(
    "Source database identifier",
    [ROOT_SPACE_ID]
  ),
  "Version ID": await mustFindPreferredProperty("Version ID", [ROOT_SPACE_ID]),
  "DrugBank ID": await mustFindPreferredProperty("DrugBank ID", [HEALTH_SPACE_ID]),
  Inchikey: await mustFindPreferredProperty("Inchikey", [HEALTH_SPACE_ID]),
  "Related drugs": await mustFindPreferredProperty("Related drugs", [
    HEALTH_SPACE_ID,
  ]),
  "Related pathways": await mustFindPreferredProperty("Related pathways", [
    HEALTH_SPACE_ID,
  ]),
};

const localSchema = buildLocalSchema(config.targetSpaceId, {
  Gene: geneType,
  Pathway: pathwayType,
  Drug: drugType,
});

const localValueProperties = [
  {
    name: "Disease Ontology ID",
    description: "Stable Disease Ontology identifier, for example DOID:2841.",
  },
  {
    name: "Entrez Gene ID",
    description: "NCBI Entrez Gene identifier used by Hetionet gene nodes.",
  },
  {
    name: "License",
    description: "License or reuse terms recorded from the source metadata.",
  },
  {
    name: "InChI",
    description: "IUPAC International Chemical Identifier for a compound.",
  },
  {
    name: "Class type",
    description: "Classification subtype for an imported pharmacologic class.",
  },
].map((property) => ({
  id: deterministicPropertyId(config.targetSpaceId, property.name),
  dataType: "TEXT",
  ...property,
}));

const ops = [];
const touched = {
  checkedSharedOntology: Object.fromEntries(
    Object.entries(sharedProperties).map(([name, property]) => [
      name,
      `${property.id} (${property.spaceIds?.join(",") ?? "unknown"})`,
    ])
  ),
  createdLocalProperties: [],
  createdSources: [],
  updatedSourceEntities: [],
  createdPapers: [],
  updatedEntityMetadata: {
    disease: [],
    genes: [],
    drugs: [],
    drugClasses: [],
    pathways: [],
    goTerms: [],
  },
  addedHealthRelations: {
    relatedDrugs: [],
    relatedPathways: [],
  },
  updatedBlocks: [],
  configuredBlockColumns: [],
  tabsReset: [],
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

function valueText(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value);
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((entry) => {
    const key = `${entry.property}:${entry.type}:${entry.value}`;
    if (seen.has(key) || entry.value === null || entry.value === undefined) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function existingValueSet(entity) {
  return new Set(
    (entity?.values?.nodes ?? []).map((value) => {
      const raw =
        value.text ?? value.boolean ?? value.integer ?? value.float ?? value.date ?? "";
      return `${value.property?.id}:${String(raw)}`;
    })
  );
}

async function updateMissingValues(entityId, values, label) {
  const entity = await fetchEntity(entityId);
  const existing = existingValueSet(entity);
  const missing = uniqueValues(values).filter(
    (value) => !existing.has(`${value.property}:${String(value.value)}`)
  );

  if (missing.length === 0) {
    return false;
  }

  const { ops: updateOps } = Graph.updateEntity({
    id: entityId,
    values: missing,
  });
  ops.push(...updateOps);
  touched.updatedBlocks.push(label);
  return true;
}

async function ensureLocalProperties() {
  for (const propertyDefinition of localValueProperties) {
    const existing = findEntityInSpace(currentEntities, {
      name: propertyDefinition.name,
      typeId: SystemIds.PROPERTY,
    });

    if (existing) {
      propertyDefinition.id = existing.id;
      continue;
    }

    const { ops: propertyOps } = Graph.createProperty(propertyDefinition);
    ops.push(...propertyOps);
    touched.createdLocalProperties.push(propertyDefinition.name);
    currentEntities.push({
      id: propertyDefinition.id,
      name: propertyDefinition.name,
      typeIds: [SystemIds.PROPERTY],
      spaceIds: [config.targetSpaceId],
    });
  }
}

function localPropertyId(name) {
  return localValueProperties.find((property) => property.name === name)?.id;
}

function typeIdForSourceType(typeName) {
  if (typeName === "Dataset") {
    return datasetType.id;
  }
  if (typeName === "Source") {
    return sourceType.id;
  }
  throw new Error(`Unsupported source type ${typeName}`);
}

function findLocalEntity(name, typeId) {
  return findEntityInSpace(currentEntities, { name, typeId });
}

async function ensureTypedEntity({ name, typeId, typeName, description, values = [] }) {
  const existing = findLocalEntity(name, typeId);

  if (existing) {
    await updateMissingValues(existing.id, values, `metadata:${name}`);
    if (description) {
      const { ops: updateOps } = Graph.updateEntity({
        id: existing.id,
        description,
      });
      ops.push(...updateOps);
    }
    return existing;
  }

  const id = deterministicEntityId(config.targetSpaceId, typeName, name);
  const { ops: createOps } = Graph.createEntity({
    id,
    name,
    description,
    types: [typeId],
    values: uniqueValues(values),
  });
  ops.push(...createOps);

  const entity = {
    id,
    name,
    description,
    typeIds: [typeId],
    spaceIds: [config.targetSpaceId],
  };
  currentEntities.push(entity);
  return entity;
}

async function resolveContentEntity(name, typeId, typeName) {
  const existing = findLocalEntity(name, typeId);
  if (existing) {
    return existing;
  }

  const reused = await findPreferredEntity({
    typeId,
    name,
    preferredSpaceIds: [HEALTH_SPACE_ID, ROOT_SPACE_ID, config.targetSpaceId],
  });

  if (reused) {
    return reused;
  }

  throw new Error(`Could not resolve ${typeName} "${name}" in target, Health, or Root.`);
}

async function relationExistsInTarget({ fromId, typeId, toId }) {
  const data = await gql(`{
    relations(
      first: 1,
      filter: {
        spaceId: { is: "${config.targetSpaceId}" },
        fromEntityId: { is: "${fromId}" },
        typeId: { is: "${typeId}" },
        toEntityId: { is: "${toId}" }
      }
    ) {
      id
    }
  }`);

  return (data.relations ?? []).length > 0;
}

async function ensureRelation({
  fromId,
  fromName,
  typeId,
  propertyName,
  toId,
  toName,
  sourceKey,
  entityValues = [],
  entitySourceIds = [],
}) {
  if (await relationExistsInTarget({ fromId, typeId, toId })) {
    return false;
  }

  const relationId = deterministicRelationId({
    fromId,
    typeId,
    toId,
    spaceId: config.targetSpaceId,
    sourceKey,
  });
  const relationEntityId = deterministicRelationEntityId({
    fromId,
    typeId,
    toId,
    spaceId: config.targetSpaceId,
    sourceKey,
  });

  const entityRelations =
    entitySourceIds.length > 0
      ? {
          [sharedSourcesProperty.id]: entitySourceIds.map((sourceId) => ({
            toEntity: sourceId,
          })),
        }
      : undefined;

  const { ops: relationOps } = Graph.createRelation({
    id: relationId,
    entityId: relationEntityId,
    entityName: relationEntityName(fromName, propertyName, toName),
    fromEntity: fromId,
    toEntity: toId,
    type: typeId,
    entityValues: uniqueValues(entityValues),
    entityRelations,
  });
  ops.push(...relationOps);
  return true;
}

async function ensureEntitySources(entity, sourceNames, sourceMap, sourceKey) {
  for (const sourceName of sourceNames) {
    const source = sourceMap.get(sourceName);
    if (!source) {
      throw new Error(`Missing source entity "${sourceName}" while linking ${entity.name}.`);
    }

    await ensureRelation({
      fromId: entity.id,
      fromName: entity.name,
      typeId: sharedSourcesProperty.id,
      propertyName: "Sources",
      toId: source.id,
      toName: source.name,
      sourceKey: `${sourceKey}:${source.name}`,
    });
  }
}

async function configureBlockColumns(blockId, blockName, columnIds) {
  const data = await gql(`{
    relations(
      first: 50,
      filter: {
        typeId: { is: "${SystemIds.BLOCKS}" },
        toEntityId: { is: "${blockId}" }
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
    const hasTableView = placementRelations.some(
      (relation) =>
        relation.type?.id === SystemIds.VIEW_PROPERTY &&
        relation.toEntity?.id === SystemIds.TABLE_VIEW
    );

    if (!hasTableView) {
      const { ops: viewOps } = Graph.createRelation({
        id: deterministicRelationId({
          fromId: placement.entityId,
          typeId: SystemIds.VIEW_PROPERTY,
          toId: SystemIds.TABLE_VIEW,
          spaceId: config.targetSpaceId,
          sourceKey: "table-view",
        }),
        fromEntity: placement.entityId,
        toEntity: SystemIds.TABLE_VIEW,
        type: SystemIds.VIEW_PROPERTY,
      });
      ops.push(...viewOps);
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
          sourceKey: `shown-column:${blockName}:${columnId}`,
        }),
        fromEntity: placement.entityId,
        toEntity: columnId,
        type: SystemIds.SHOWN_COLUMNS,
        position: lastPosition,
      });
      ops.push(...columnOps);
    }
  }

  touched.configuredBlockColumns.push(blockName);
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
  return id;
}

async function ensureBlockRelation(fromId, blockId, sourceKey) {
  const fromEntity = await fetchEntity(fromId);
  const currentBlockRelations = (fromEntity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.BLOCKS
  );

  if (
    currentBlockRelations.some((relation) => relation.toEntity?.id === blockId)
  ) {
    return;
  }

  const lastPosition = sortByPosition(currentBlockRelations).at(-1)?.position ?? null;
  const { ops: blockOps } = Graph.createRelation({
    id: deterministicRelationId({
      fromId,
      typeId: SystemIds.BLOCKS,
      toId: blockId,
      spaceId: config.targetSpaceId,
      sourceKey,
    }),
    fromEntity: fromId,
    toEntity: blockId,
    type: SystemIds.BLOCKS,
    position: positionAfter(lastPosition),
  });
  ops.push(...blockOps);
}

async function resetTabs(tabTargets) {
  const spaceEntity = await fetchEntity(config.targetSpaceEntityId);
  const currentTabs = (spaceEntity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === manifest.properties.Tabs.id
  );

  for (const relation of currentTabs) {
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  let lastPosition = null;
  for (const tab of tabTargets) {
    lastPosition = positionAfter(lastPosition);
    const { ops: tabOps } = Graph.createRelation({
      id: deterministicRelationId({
        fromId: config.targetSpaceEntityId,
        typeId: manifest.properties.Tabs.id,
        toId: tab.id,
        spaceId: config.targetSpaceId,
        sourceKey: `tab:${tab.name}:v2`,
      }),
      fromEntity: config.targetSpaceEntityId,
      toEntity: tab.id,
      type: manifest.properties.Tabs.id,
      position: lastPosition,
    });
    ops.push(...tabOps);
    touched.tabsReset.push(tab.name);
  }
}

function textValue(property, value) {
  const text = valueText(value);
  if (text === null) {
    return null;
  }
  return { property, type: "text", value: text };
}

function datetimeValue(property, value) {
  const text = valueText(value);
  if (text === null) {
    return null;
  }
  return { property, type: "datetime", value: text };
}

function compactValues(values) {
  return values.filter(Boolean);
}

function blockByName(name) {
  return findEntityInSpace(currentEntities, {
    name,
    typeId: SystemIds.DATA_BLOCK,
  });
}

await ensureLocalProperties();

const localProperties = {
  "Disease Ontology ID": localPropertyId("Disease Ontology ID"),
  "Entrez Gene ID": localPropertyId("Entrez Gene ID"),
  License: localPropertyId("License"),
  InChI: localPropertyId("InChI"),
  "Class type": localPropertyId("Class type"),
};

const sourceMap = new Map();
for (const sourceDefinition of enrichment.sources) {
  const typeId = typeIdForSourceType(sourceDefinition.type);
  const entity = await ensureTypedEntity({
    name: sourceDefinition.name,
    typeId,
    typeName: sourceDefinition.type,
    description: sourceDefinition.description,
    values: compactValues([
      textValue(sharedProperties.Website.id, sourceDefinition.website),
      textValue(
        sharedProperties["Source database identifier"].id,
        sourceDefinition.sourceDatabaseIdentifier
      ),
      textValue(sharedProperties["Version ID"].id, sourceDefinition.version),
      textValue(sharedProperties.DOI.id, sourceDefinition.doi),
      textValue(localProperties.License, sourceDefinition.license),
    ]),
  });
  sourceMap.set(sourceDefinition.name, entity);
  if (entity.spaceIds?.includes(config.targetSpaceId)) {
    touched.updatedSourceEntities.push(sourceDefinition.name);
  } else {
    touched.createdSources.push(sourceDefinition.name);
  }
}

for (const paper of enrichment.papers) {
  const paperEntity = await ensureTypedEntity({
    name: paper.name,
    typeId: paperType.id,
    typeName: "Paper",
    description: paper.description,
    values: compactValues([
      textValue(sharedProperties.DOI.id, paper.doi),
      textValue(sharedProperties.Pmid.id, paper.pmid),
      datetimeValue(sharedProperties["Publish date"].id, paper.publishDate),
      textValue(sharedProperties.Website.id, paper.website),
      textValue(sharedProperties.Abstract.id, paper.description),
    ]),
  });

  touched.createdPapers.push(paper.name);
  sourceMap.set(paper.name, paperEntity);
}

for (const sourceDefinition of enrichment.sources) {
  const entity = sourceMap.get(sourceDefinition.name);
  await ensureEntitySources(
    entity,
    sourceDefinition.sources ?? [],
    sourceMap,
    `source-provenance:${sourceDefinition.name}`
  );
}

for (const paper of enrichment.papers) {
  const paperEntity = sourceMap.get(paper.name);
  await ensureEntitySources(
    paperEntity,
    paper.sources ?? [],
    sourceMap,
    `paper-provenance:${paper.name}`
  );
}

const disease = await resolveContentEntity(
  enrichment.disease.name,
  diseaseType.id,
  "Disease"
);
await updateMissingValues(
  disease.id,
  compactValues([
    textValue(localProperties["Disease Ontology ID"], enrichment.disease.diseaseOntologyId),
    textValue(sharedProperties["Source database identifier"].id, enrichment.disease.diseaseOntologyId),
    textValue(sharedProperties.Website.id, enrichment.disease.website),
    textValue(localProperties.License, enrichment.disease.license),
  ]),
  "disease:Asthma"
);
await ensureEntitySources(
  disease,
  enrichment.disease.sources,
  sourceMap,
  "disease:Asthma"
);
touched.updatedEntityMetadata.disease.push("Asthma");

for (const gene of enrichment.genes) {
  const entity = await resolveContentEntity(gene.name, geneType.id, "Gene");
  await updateMissingValues(
    entity.id,
    compactValues([
      textValue(localProperties["Entrez Gene ID"], gene.entrezGeneId),
      textValue(sharedProperties["Source database identifier"].id, gene.entrezGeneId),
      textValue(sharedProperties.Website.id, gene.website),
      textValue(localProperties.License, gene.license),
    ]),
    `gene:${gene.name}`
  );
  await ensureEntitySources(entity, ["Entrez Gene", "DISEASES", "Hetionet v1.0"], sourceMap, `gene:${gene.name}`);
  touched.updatedEntityMetadata.genes.push(gene.name);
}

for (const drug of enrichment.drugs) {
  const entity = await resolveContentEntity(drug.name, drugType.id, "Drug");
  await updateMissingValues(
    entity.id,
    compactValues([
      textValue(sharedProperties["DrugBank ID"].id, drug.drugBankId),
      textValue(sharedProperties.Inchikey.id, drug.inchikey),
      textValue(localProperties.InChI, drug.inchi),
      textValue(sharedProperties.Website.id, drug.website),
      textValue(localProperties.License, drug.license),
    ]),
    `drug:${drug.name}`
  );
  await ensureEntitySources(entity, ["DrugBank", "PharmacotherapyDB", "Hetionet v1.0"], sourceMap, `drug:${drug.name}`);
  touched.updatedEntityMetadata.drugs.push(drug.name);

  const added = await ensureRelation({
    fromId: ASTHMA_ENTITY_ID,
    fromName: "Asthma",
    typeId: sharedProperties["Related drugs"].id,
    propertyName: "Related drugs",
    toId: entity.id,
    toName: drug.name,
    sourceKey: `health-related-drug:${drug.name}`,
    entityValues: compactValues([
      textValue(localSchema.propertyIds["Hetionet metaedge"], "CtD"),
      { property: localSchema.propertyIds.Unbiased, type: "boolean", value: true },
      textValue(localSchema.propertyIds["Import batch"], enrichment.importBatch),
    ]),
    entitySourceIds: [
      sourceMap.get("PharmacotherapyDB").id,
      sourceMap.get("Hetionet v1.0").id,
    ],
  });

  if (added) {
    touched.addedHealthRelations.relatedDrugs.push(drug.name);
  }
}

for (const drugClass of enrichment.drugClasses) {
  const entity = await resolveContentEntity(
    drugClass.name,
    drugClassType.id,
    "Drug class"
  );
  await updateMissingValues(
    entity.id,
    compactValues([
      textValue(sharedProperties["Source database identifier"].id, drugClass.sourceDatabaseIdentifier),
      textValue(localProperties["Class type"], drugClass.classType),
      textValue(sharedProperties.Website.id, drugClass.website),
      textValue(localProperties.License, drugClass.license),
    ]),
    `drug-class:${drugClass.name}`
  );
  await ensureEntitySources(entity, ["DrugCentral", "Hetionet v1.0"], sourceMap, `drug-class:${drugClass.name}`);
  touched.updatedEntityMetadata.drugClasses.push(drugClass.name);
}

for (const pathway of enrichment.pathways) {
  const entity = await resolveContentEntity(pathway.name, pathwayType.id, "Pathway");
  await updateMissingValues(
    entity.id,
    compactValues([
      textValue(sharedProperties["Source database identifier"].id, pathway.sourceDatabaseIdentifier),
      textValue(localProperties.License, pathway.license),
    ]),
    `pathway:${pathway.name}`
  );
  await ensureEntitySources(entity, ["Reactome", "Hetionet v1.0"], sourceMap, `pathway:${pathway.name}`);
  touched.updatedEntityMetadata.pathways.push(pathway.name);

  const added = await ensureRelation({
    fromId: ASTHMA_ENTITY_ID,
    fromName: "Asthma",
    typeId: sharedProperties["Related pathways"].id,
    propertyName: "Related pathways",
    toId: entity.id,
    toName: pathway.name,
    sourceKey: `health-related-pathway:${pathway.name}`,
    entityValues: compactValues([
      textValue(localSchema.propertyIds["Hetionet metaedge"], "GpPW"),
      { property: localSchema.propertyIds.Unbiased, type: "boolean", value: true },
      textValue(localSchema.propertyIds["Import batch"], enrichment.importBatch),
    ]),
    entitySourceIds: [
      sourceMap.get("Reactome").id,
      sourceMap.get("Hetionet v1.0").id,
    ],
  });

  if (added) {
    touched.addedHealthRelations.relatedPathways.push(pathway.name);
  }
}

for (const goTerm of enrichment.goTerms) {
  const entity =
    findLocalEntity(goTerm.name, localSchema.typeIds["Biological Process"]) ??
    findLocalEntity(goTerm.name, localSchema.typeIds["Molecular Function"]) ??
    findLocalEntity(goTerm.name, localSchema.typeIds["Cellular Component"]);

  if (!entity) {
    throw new Error(`Missing GO-style entity "${goTerm.name}".`);
  }

  await updateMissingValues(
    entity.id,
    compactValues([
      textValue(localSchema.propertyIds["GO ID"], goTerm.goId),
      textValue(sharedProperties.Website.id, goTerm.website),
      textValue(localProperties.License, goTerm.license),
    ]),
    `go:${goTerm.name}`
  );
  await ensureEntitySources(entity, ["Gene Ontology", "NCBI gene2go", "Hetionet v1.0"], sourceMap, `go:${goTerm.name}`);
  touched.updatedEntityMetadata.goTerms.push(goTerm.name);
}

const paperBlock =
  blockByName("Papers") ??
  blockByName("Recent papers") ??
  findLocalEntity("Recent papers", SystemIds.DATA_BLOCK);

if (!paperBlock) {
  throw new Error("Missing Papers / Recent papers data block.");
}

const { ops: paperBlockOps } = Graph.updateEntity({
  id: paperBlock.id,
  name: "Papers",
  description: "Citable papers and releases behind the Disease Atlas import.",
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
ops.push(...paperBlockOps);
touched.updatedBlocks.push("Papers block filter");

const papersGuideText = [
  "### Disease Atlas evidence links",
  "",
  "| Resource | Link | What it contributes |",
  "| --- | --- | --- |",
  "| Hetionet v1.0 | https://github.com/hetio/hetionet | Integrated graph and import dataset |",
  "| Hetionet / Rephetio paper | https://elifesciences.org/articles/26726 | Main paper describing the graph and drug-repurposing model |",
  "| Disease Ontology | https://disease-ontology.org/ | Asthma disease identifier DOID:2841 |",
  "| DISEASES | https://diseases.jensenlab.org/ | Disease-gene associations |",
  "| PharmacotherapyDB | https://github.com/dhimmel/indications | Curated drug indications |",
  "| DrugBank | https://go.drugbank.com/ | DrugBank compound IDs and chemistry metadata |",
  "| DrugCentral | https://drugcentral.org/ | Pharmacologic class annotations |",
  "| Gene Ontology | http://geneontology.org/ | GO process, function, and component terms |",
  "| Reactome | https://reactome.org/ | Pathway annotations via Pathway Commons |",
].join("\n");

const papersGuideBlock = await ensureTextBlock({
  key: "Evidence source links",
  text: papersGuideText,
});

await ensureBlockRelation(PAPERS_PAGE_ID, papersGuideBlock, "papers-source-links");
await ensureBlockRelation(PAPERS_PAGE_ID, paperBlock.id, "papers-data-block");
await ensureBlockRelation(config.targetSpaceEntityId, paperBlock.id, "overview-papers-block");
const sourcesPageId =
  findLocalEntity("Sources", pageType.id)?.id ??
  manifest.targetSnapshot.pages.Sources?.id;
const evidencePageId =
  findLocalEntity("Evidence", pageType.id)?.id ??
  manifest.targetSnapshot.pages.Evidence?.id ??
  "93365b6311449ae8b43801010c8c7c24";

if (!sourcesPageId) {
  throw new Error("Missing Sources page.");
}

await ensureBlockRelation(sourcesPageId, paperBlock.id, "sources-papers-block");
await ensureBlockRelation(sourcesPageId, papersGuideBlock, "sources-source-links");
await ensureBlockRelation(evidencePageId, paperBlock.id, "evidence-papers-block");

const blockColumns = {
  Diseases: [
    localProperties["Disease Ontology ID"],
    sharedProperties.Website.id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  "Asthma genes": [
    localProperties["Entrez Gene ID"],
    sharedProperties.Website.id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  "Asthma drugs": [
    sharedProperties["DrugBank ID"].id,
    sharedProperties.Inchikey.id,
    sharedProperties.Website.id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  "Asthma drug classes": [
    sharedProperties["Source database identifier"].id,
    localProperties["Class type"],
    sharedProperties.Website.id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  "Asthma pathways": [
    sharedProperties["Source database identifier"].id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  "GO annotations": [
    localSchema.propertyIds["GO ID"],
    sharedProperties.Website.id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  Datasets: [
    sharedProperties.Website.id,
    sharedProperties.DOI.id,
    sharedProperties["Version ID"].id,
    sharedProperties["Source database identifier"].id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  Sources: [
    sharedProperties.Website.id,
    sharedProperties["Source database identifier"].id,
    sharedSourcesProperty.id,
    localProperties.License,
  ],
  "Asthma evidence relations": [
    localSchema.propertyIds["Hetionet metaedge"],
    localSchema.propertyIds.Unbiased,
    sharedSourcesProperty.id,
    localSchema.propertyIds["Import batch"],
  ],
  Papers: [
    sharedProperties.DOI.id,
    sharedProperties.Pmid.id,
    sharedProperties["Publish date"].id,
    sharedProperties.Website.id,
    sharedSourcesProperty.id,
  ],
};

for (const [blockName, columns] of Object.entries(blockColumns)) {
  const block =
    blockName === "Papers"
      ? { id: paperBlock.id, name: "Papers" }
      : blockByName(blockName);

  if (!block) {
    throw new Error(`Missing data block "${blockName}".`);
  }

  await configureBlockColumns(block.id, blockName, columns);
}

const pages = {
  Diseases: findLocalEntity("Diseases", pageType.id),
  Mechanisms: findLocalEntity("Mechanisms", pageType.id),
  Treatments: findLocalEntity("Treatments", pageType.id),
  Evidence: findLocalEntity("Evidence", pageType.id),
  Sources: findLocalEntity("Sources", pageType.id),
  Papers: findLocalEntity("Papers", pageType.id) ?? { id: PAPERS_PAGE_ID, name: "Papers" },
  Ontology: findLocalEntity("Ontology", pageType.id),
  About: findLocalEntity("About", pageType.id),
};

await resetTabs([
  { name: "Diseases", id: pages.Diseases.id },
  { name: "Asthma", id: ASTHMA_ENTITY_ID },
  { name: "Treatments", id: pages.Treatments.id },
  { name: "Mechanisms", id: pages.Mechanisms.id },
  { name: "Evidence", id: pages.Evidence.id },
  { name: "Sources", id: pages.Sources.id },
  { name: "Papers", id: pages.Papers.id },
  { name: "Ontology", id: pages.Ontology.id },
  { name: "About", id: pages.About.id },
]);

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - provenance and table repair",
  ops,
  touched,
});

console.log(JSON.stringify(result, null, 2));
