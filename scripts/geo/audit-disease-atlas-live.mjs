import { SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  findPreferredEntity,
  gql,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import { buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();

const requiredSharedTypes = [
  ["Disease", HEALTH_SPACE_ID],
  ["Symptom", HEALTH_SPACE_ID],
  ["Anatomical structure", HEALTH_SPACE_ID],
  ["Side effect", HEALTH_SPACE_ID],
  ["Drug", HEALTH_SPACE_ID],
  ["Drug class", HEALTH_SPACE_ID],
  ["Gene", HEALTH_SPACE_ID],
  ["Pathway", HEALTH_SPACE_ID],
  ["Dataset", ROOT_SPACE_ID],
  ["Source", ROOT_SPACE_ID],
  ["Paper", ROOT_SPACE_ID],
];

const requiredSharedProperties = [
  ["Treats", HEALTH_SPACE_ID],
  ["Related drugs", HEALTH_SPACE_ID],
  ["Related pathways", HEALTH_SPACE_ID],
  ["Symptoms", HEALTH_SPACE_ID],
  ["Side effects", HEALTH_SPACE_ID],
  ["Evidence level", HEALTH_SPACE_ID],
  ["Sources", ROOT_SPACE_ID],
  ["Website", ROOT_SPACE_ID],
  ["DOI", ROOT_SPACE_ID],
  ["Pmid", HEALTH_SPACE_ID],
  ["Publish date", ROOT_SPACE_ID],
  ["Source database identifier", ROOT_SPACE_ID],
];

const requiredBlocks = [
  "Diseases",
  "Genes",
  "Treating drugs",
  "Drug classes",
  "Pathways",
  "GO annotations",
  "Evidence relations",
  "Datasets",
  "Sources",
  "Papers",
  "Sources and datasets",
  "Types",
  "Properties",
];

const sourceLikeNames = [
  "Hetionet v1.0",
  "Disease Ontology",
  "DISEASES",
  "DisGeNET",
  "GWAS Catalog",
  "DOAF",
  "DrugBank",
  "DrugCentral",
  "Entrez Gene",
  "Gene Ontology",
  "NCBI gene2go",
  "PharmacotherapyDB",
  "Reactome",
  "Pathway Commons",
  "Pathway Interaction Database",
  "WikiPathways",
  "MEDLINE cooccurrence",
  "MeSH",
  "Uberon",
  "STARGEO",
];

function includesSpace(entity, spaceId) {
  return entity?.spaceIds?.includes(spaceId) ?? false;
}

async function resolveShared(entries, typeId) {
  const results = [];
  for (const [name, preferredSpaceId] of entries) {
    const entity = await findPreferredEntity({
      typeId,
      name,
      preferredSpaceIds: [preferredSpaceId, ROOT_SPACE_ID, HEALTH_SPACE_ID],
    });

    results.push({
      name,
      id: entity?.id ?? null,
      spaceIds: entity?.spaceIds ?? [],
      reusedFromExpectedSpace: includesSpace(entity, preferredSpaceId),
    });
  }
  return results;
}

async function fetchCollectionRelations(blockId, toEntitySelection = "id name") {
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
        toEntity {
          ${toEntitySelection}
        }
      }
    }`);

    const page = data.relations ?? [];
    relations.push(...page);
    if (page.length < 1000) break;
  }

  return relations;
}

async function fetchBlockDataSources(blockId) {
  const data = await gql(`{
    relations(
      first: 100,
      filter: {
        spaceId: { is: "${config.targetSpaceId}" },
        fromEntityId: { is: "${blockId}" },
        typeId: { is: "${SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE}" }
      }
    ) {
      toEntity { id name }
    }
  }`);

  return (data.relations ?? []).map(
    (relation) => relation.toEntity?.name ?? relation.toEntity?.id
  );
}

async function fetchBlocks() {
  const data = await gql(`{
    entities(spaceId: "${config.targetSpaceId}", typeId: "${SystemIds.DATA_BLOCK}", first: 1000) {
      id
      name
      relationsList(first: 1000) {
        typeId
        typeEntity { name }
        toEntity { id name }
      }
      valuesList(first: 20) {
        propertyId
        propertyEntity { name }
        text
      }
    }
  }`);

  return Promise.all((data.entities ?? []).map(async (block) => {
    const dataSources = await fetchBlockDataSources(block.id);
    const collectionItems = await fetchCollectionRelations(block.id);

    return {
      id: block.id,
      name: block.name ?? "(unnamed)",
      dataSources,
      collectionItemCount: collectionItems.length,
      collectionItemSample: collectionItems
        .slice(0, 10)
        .map((relation) => relation.toEntity?.name ?? relation.toEntity?.id),
      hasFilterValue: block.valuesList.some(
        (value) => value.propertyId === SystemIds.FILTER && value.text
      ),
    };
  }));
}

async function fetchTypedEntities(typeIds) {
  const entities = [];
  for (const typeId of typeIds) {
    const data = await gql(`{
      entities(spaceId: "${config.targetSpaceId}", typeId: "${typeId}", first: 1000) {
        id
        name
        typeIds
        valuesList(first: 60) {
          propertyEntity { name }
          text
          date
          datetime
          boolean
          integer
          float
        }
        backlinksList(first: 20) {
          typeEntity { name }
          fromEntity { id name }
        }
      }
    }`);
    entities.push(...(data.entities ?? []));
  }
  return entities;
}

async function fetchTypedEntityCount(typeId) {
  const data = await gql(`{
    entities(spaceId: "${config.targetSpaceId}", typeId: "${typeId}", first: 1000) {
      id
    }
  }`);

  return (data.entities ?? []).length;
}

async function fetchEvidenceAudit(evidenceBlock) {
  if (!evidenceBlock) {
    return {
      count: 0,
      missingSources: [],
      missingRequiredValues: [],
      byBatch: {},
      byMetaedge: {},
    };
  }

  const requiredValueNames = [
    "Hetionet metaedge",
    "Import batch",
    "Unbiased",
  ];
  const evidenceEntities = (await fetchCollectionRelations(
    evidenceBlock.id,
    `
      id
      name
      valuesList(first: 40) {
        propertyEntity { name }
        text
        boolean
        float
      }
      relationsList(first: 30) {
        typeEntity { name }
        toEntity { id name }
      }
    `
  ))
    .map((relation) => relation.toEntity)
    .filter(Boolean);

  const byBatch = {};
  const byMetaedge = {};
  const missingSources = [];
  const missingRequiredValues = [];

  for (const entity of evidenceEntities) {
    const values = new Map(
      entity.valuesList.map((value) => [
        value.propertyEntity?.name,
        value.text ?? value.boolean ?? value.float,
      ])
    );

    const batch = values.get("Import batch") ?? "missing";
    const metaedge = values.get("Hetionet metaedge") ?? "missing";
    byBatch[batch] = (byBatch[batch] ?? 0) + 1;
    byMetaedge[metaedge] = (byMetaedge[metaedge] ?? 0) + 1;

    const hasSource = entity.relationsList.some(
      (relation) => relation.typeEntity?.name === "Sources"
    );
    if (!hasSource) {
      missingSources.push(entity.name ?? entity.id);
    }

    const missingValues = requiredValueNames.filter((name) => !values.has(name));
    if (missingValues.length > 0) {
      missingRequiredValues.push({
        id: entity.id,
        name: entity.name,
        missing: missingValues,
      });
    }
  }

  return {
    count: evidenceEntities.length,
    byBatch,
    byMetaedge,
    missingSources,
    missingRequiredValues,
  };
}

function summarizeSourceLike(entity) {
  const values = Object.fromEntries(
    entity.valuesList.map((value) => [
      value.propertyEntity?.name,
      value.text ?? value.date ?? value.datetime ?? value.boolean ?? value.integer ?? value.float,
    ])
  );

  return {
    id: entity.id,
    name: entity.name,
    website: values.Website ?? null,
    doi: values.DOI ?? null,
    pmid: values.Pmid ?? null,
    sourceDatabaseIdentifier: values["Source database identifier"] ?? null,
    hasExternalLink: Boolean(values.Website || values.DOI || values.Pmid),
    backlinkCountSampled: entity.backlinksList.length,
  };
}

const targetEntities = await listSpaceEntities(config.targetSpaceId, 2000);
const diseaseType = mustGetNamedEntry(manifest.types, "Disease", "type");
const drugType = mustGetNamedEntry(manifest.types, "Drug", "type");
const geneType = mustGetNamedEntry(manifest.types, "Gene", "type");
const pathwayType = mustGetNamedEntry(manifest.types, "Pathway", "type");
const datasetType = mustGetNamedEntry(manifest.types, "Dataset", "type");
const sourceType = mustGetNamedEntry(manifest.types, "Source", "type");
const paperType = mustGetNamedEntry(manifest.types, "Paper", "type");
const localSchema = buildLocalSchema(config.targetSpaceId, {
  Gene: geneType,
  Pathway: pathwayType,
  Drug: drugType,
});

const blocks = await fetchBlocks();
const blockByName = new Map(blocks.map((block) => [block.name, block]));
const sourceLikeEntities = await fetchTypedEntities([
  datasetType.id,
  sourceType.id,
  paperType.id,
]);

const typeCountSpecs = [
    ["Disease", diseaseType.id],
    ["Drug", drugType.id],
    ["Gene", geneType.id],
    ["Pathway", pathwayType.id],
    ["Dataset", datasetType.id],
    ["Source", sourceType.id],
    ["Paper", paperType.id],
    ["Biological Process", localSchema.typeIds["Biological Process"]],
    ["Molecular Function", localSchema.typeIds["Molecular Function"]],
    ["Cellular Component", localSchema.typeIds["Cellular Component"]],
  ];
const typeCounts = Object.fromEntries(
  await Promise.all(
    typeCountSpecs.map(async ([name, typeId]) => [
      name,
      await fetchTypedEntityCount(typeId),
    ])
  )
);

const sharedTypes = await resolveShared(requiredSharedTypes, SystemIds.SCHEMA_TYPE);
const sharedProperties = await resolveShared(requiredSharedProperties, SystemIds.PROPERTY);
const evidenceAudit = await fetchEvidenceAudit(blockByName.get("Evidence relations"));
const requiredBlockSummaries = requiredBlocks.map((name) => ({
  name,
  exists: blockByName.has(name),
  collectionItemCount: blockByName.get(name)?.collectionItemCount ?? 0,
  dataSources: blockByName.get(name)?.dataSources ?? [],
  hasFilterValue: blockByName.get(name)?.hasFilterValue ?? false,
}));

const sourceSummaries = sourceLikeEntities
  .filter((entity) => sourceLikeNames.includes(entity.name))
  .map(summarizeSourceLike)
  .sort((left, right) => left.name.localeCompare(right.name));

const findings = [];
for (const block of requiredBlockSummaries) {
  if (!block.exists) {
    findings.push(`Missing expected block "${block.name}".`);
  } else if (
    ["Datasets", "Sources", "Papers", "Types", "Properties"].includes(block.name) &&
    block.collectionItemCount === 0
  ) {
    findings.push(`Block "${block.name}" has no explicit collection items.`);
  }
}

if (evidenceAudit.missingSources.length > 0) {
  findings.push(`${evidenceAudit.missingSources.length} evidence entities lack Sources.`);
}

if (evidenceAudit.missingRequiredValues.length > 0) {
  findings.push(
    `${evidenceAudit.missingRequiredValues.length} evidence entities lack required provenance values.`
  );
}

for (const source of sourceSummaries) {
  if (!source.hasExternalLink) {
    findings.push(`Source-like entity "${source.name}" has no Website, DOI, or PMID.`);
  }
}

const result = {
  ok: findings.length === 0,
  targetSpaceId: config.targetSpaceId,
  targetSpaceName: config.targetSpaceName,
  counts: {
    entities: targetEntities.length,
    entityCountIsCappedAt2000: targetEntities.length === 2000,
    byType: typeCounts,
  },
  ontologyReuse: {
    sharedTypes,
    sharedProperties,
  },
  blocks: requiredBlockSummaries,
  evidence: evidenceAudit,
  sources: sourceSummaries,
  dashboardReadiness: {
    tnFGeneShouldResolveByBacklinks: true,
    geoSourceOfTruth: true,
    evidenceEntitiesHaveRelationLevelProvenance:
      evidenceAudit.missingSources.length === 0 &&
      evidenceAudit.missingRequiredValues.length === 0,
  },
  findings,
};

console.log(JSON.stringify(result, null, 2));
