import { SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  fetchEntity,
  fetchSpace,
  findPreferredEntity,
  lookupPropertyByName,
  lookupTypeByName,
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
} from "./lib/graphql.mjs";
import {
  LIVE_MANIFEST_PATH,
  loadAsthmaPacket,
  writeJsonFile,
} from "./lib/manifest.mjs";
import { deriveCallerContext } from "./lib/publish.mjs";

function toNamedRecord(entries) {
  return Object.fromEntries(
    entries
      .filter(Boolean)
      .map((entry) => [
        entry.name,
        {
          id: entry.id,
          ownerSpaceIds: entry.spaceIds ?? [],
        },
      ])
  );
}

function findValueText(entity, propertyName) {
  return (
    entity?.values?.nodes?.find((value) => value.property?.name === propertyName)
      ?.text ?? null
  );
}

async function snapshotPage(entityId) {
  const entity = await fetchEntity(entityId);
  const pageTypeRelation =
    entity?.relations?.nodes?.find((relation) => relation.type?.name === "Page type") ??
    null;
  const blockRelations = (entity?.relations?.nodes ?? [])
    .filter((relation) => relation.type?.name === "Blocks")
    .map((relation) => ({
      name: relation.toEntity?.name ?? relation.toEntity?.id,
      blockId: relation.toEntity?.id,
      relationId: relation.id,
      position: relation.position ?? null,
    }));

  return {
    id: entity?.id ?? entityId,
    pageTypeEntityId: pageTypeRelation?.toEntity?.id ?? null,
    blockRelations,
  };
}

async function snapshotBlock(blockId) {
  const block = await fetchEntity(blockId);

  return {
    id: block?.id ?? blockId,
    filter: findValueText(block, "Filter"),
  };
}

function buildReuseCandidates(packet) {
  return [
    { typeName: "Disease", name: packet.disease.name },
    ...packet.entities.genes.map((entity) => ({
      typeName: "Gene",
      name: entity.name,
    })),
    ...packet.entities.drugs.map((entity) => ({
      typeName: "Drug",
      name: entity.name,
    })),
    ...packet.entities.drugClasses.map((entity) => ({
      typeName: "Drug class",
      name: entity.name,
    })),
    ...packet.entities.pathways.map((entity) => ({
      typeName: "Pathway",
      name: entity.name,
    })),
  ];
}

const config = loadGeoEnv({ requirePrivateKey: true });
const caller = await deriveCallerContext(config.privateKey);

console.log(
  JSON.stringify(
    {
      ok: true,
      smartAccountAddress: caller.smartAccountAddress,
      derivedPersonalSpaceId: caller.callerSpaceId,
      envPersonalSpaceId: config.personalSpaceId,
      targetSpaceId: config.targetSpaceId,
      targetSpaceAddress: config.targetSpaceAddress,
    },
    null,
    2
  )
);

if (
  config.personalSpaceId &&
  config.personalSpaceId !== caller.callerSpaceId
) {
  throw new Error(
    "GEO_PERSONAL_SPACE_ID does not match the derived personal space ID."
  );
}

const space = await fetchSpace(config.targetSpaceId);

if (!space) {
  throw new Error(`Could not find target space ${config.targetSpaceId}.`);
}

if (
  config.targetSpaceAddress &&
  space.address?.toLowerCase() !== config.targetSpaceAddress.toLowerCase()
) {
  throw new Error(
    `Target space address mismatch. Expected ${config.targetSpaceAddress}, got ${space.address}.`
  );
}

const targetSpaceEntity = await fetchEntity(config.targetSpaceEntityId);

if (!targetSpaceEntity) {
  throw new Error(
    `Could not find target space entity ${config.targetSpaceEntityId}.`
  );
}

const sharedTypeNames = [
  "Page",
  "Type",
  "Property",
  "Paper",
  "Dataset",
  "Source",
  "Disease",
  "Drug",
  "Drug class",
  "Gene",
  "Pathway",
];

const sharedPropertyNames = [
  "Tabs",
  "Blocks",
  "Types",
  "Page type",
  "Filter",
  "Treats",
  "Sources",
  "Data type",
  "Name",
];

const typeEntries = await Promise.all(
  sharedTypeNames.map((name) => lookupTypeByName(name))
);
const propertyEntries = await Promise.all(
  sharedPropertyNames.map((name) => lookupPropertyByName(name))
);

const tabRelations = (targetSpaceEntity.relations?.nodes ?? [])
  .filter((relation) => relation.type?.name === "Tabs")
  .map((relation) => ({
    name: relation.toEntity?.name ?? relation.toEntity?.id,
    entityId: relation.toEntity?.id,
    relationId: relation.id,
    position: relation.position ?? null,
    isPage: relation.toEntity?.typeIds?.includes(SystemIds.PAGE_TYPE) ?? false,
  }));

const pages = {};

for (const tab of tabRelations) {
  pages[tab.name] = await snapshotPage(tab.entityId);
}

const blocks = {};

for (const page of Object.values(pages)) {
  for (const blockRelation of page.blockRelations ?? []) {
    blocks[blockRelation.name] = await snapshotBlock(blockRelation.blockId);
  }
}

const packet = await loadAsthmaPacket();
const reusableEntities = {};
const unresolvedEntities = [];

for (const candidate of buildReuseCandidates(packet)) {
  const typeEntry = typeEntries.find((entry) => entry?.name === candidate.typeName);

  if (!typeEntry) {
    unresolvedEntities.push(candidate);
    continue;
  }

  const entity = await findPreferredEntity({
    typeId: typeEntry.id,
    name: candidate.name,
    preferredSpaceIds: [HEALTH_SPACE_ID, ROOT_SPACE_ID, config.targetSpaceId],
  });

  if (!entity) {
    unresolvedEntities.push(candidate);
    continue;
  }

  reusableEntities[`${candidate.typeName}:${candidate.name}`] = {
    id: entity.id,
    name: entity.name,
    type: candidate.typeName,
    ownerSpaceIds: entity.spaceIds ?? [],
  };
}

const manifest = {
  meta: {
    generatedAt: new Date().toISOString(),
    network: config.network,
    source: "scripts/geo/discover-space.mjs",
  },
  caller: {
    smartAccountAddress: caller.smartAccountAddress,
    derivedPersonalSpaceId: caller.callerSpaceId,
    envPersonalSpaceId: config.personalSpaceId,
  },
  spaces: {
    root: {
      id: ROOT_SPACE_ID,
      name: "Root",
    },
    health: {
      id: HEALTH_SPACE_ID,
      name: "Health",
    },
    target: {
      id: config.targetSpaceId,
      address: space.address,
      entityId: config.targetSpaceEntityId,
      name: config.targetSpaceName,
      currentName: targetSpaceEntity.name ?? null,
    },
  },
  types: toNamedRecord(typeEntries),
  properties: toNamedRecord(propertyEntries),
  targetSnapshot: {
    spacePage: {
      id: targetSpaceEntity.id,
      name: targetSpaceEntity.name ?? null,
      description: targetSpaceEntity.description ?? null,
      tabs: tabRelations,
    },
    pages,
    blocks,
  },
  reusableEntities,
  unresolvedEntities,
};

await writeJsonFile(LIVE_MANIFEST_PATH, manifest);

console.log(
  JSON.stringify(
    {
      ok: true,
      manifestPath: LIVE_MANIFEST_PATH,
      targetSpaceId: config.targetSpaceId,
      tabCount: tabRelations.length,
      pageCount: Object.keys(pages).length,
      blockCount: Object.keys(blocks).length,
      resolvedReuseCount: Object.keys(reusableEntities).length,
      unresolvedReuseCount: unresolvedEntities.length,
    },
    null,
    2
  )
);

