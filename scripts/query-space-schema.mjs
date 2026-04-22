import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { SystemIds } from "@geoprotocol/geo-sdk";

dotenv.config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith("--")) continue;
  const [key, inlineValue] = arg.slice(2).split("=", 2);
  const value =
    inlineValue ?? (process.argv[index + 1]?.startsWith("--") ? "" : process.argv[++index]);
  args.set(key, value);
}

const targetSpaceId = args.get("space-id") || process.env.GEO_TARGET_SPACE_ID;
const configuredName = args.get("space-name") || process.env.GEO_TARGET_SPACE_NAME || null;

if (!targetSpaceId) {
  console.error(
    "Missing target space. Set GEO_TARGET_SPACE_ID or pass --space-id <id>."
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gql(query) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://testnet-api.geobrowser.io/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    const payload = await response.json();

    if (!payload.errors?.length) {
      return payload.data;
    }

    const message = payload.errors.map((error) => error.message).join("; ");
    const shouldRetry =
      attempt < maxAttempts && /unexpected error|timeout|temporar/i.test(message);

    if (!shouldRetry) {
      throw new Error(message);
    }

    await sleep(250 * attempt);
  }
}

async function listEntitiesByType(typeId, first = 1000) {
  const data = await gql(`{
    entities(spaceId: "${targetSpaceId}", typeId: "${typeId}", first: ${first}) {
      id
      name
      typeIds
    }
  }`);

  return data.entities ?? [];
}

async function listSpaceEntities(first = 1000) {
  const entities = [];

  for (const offset of [0, 1000]) {
    const data = await gql(`{
      entities(spaceId: "${targetSpaceId}", first: ${first}, offset: ${offset}) {
        id
        name
        typeIds
      }
    }`);
    const page = data.entities ?? [];
    entities.push(...page);

    if (page.length < first) {
      break;
    }
  }

  return entities;
}

function normalizeRows(rows) {
  return rows
    .map((entity) => ({
      id: entity.id,
      name: entity.name ?? "(unnamed)",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

const spaceData = await gql(`{
  space(id: "${targetSpaceId}") {
    id
    address
  }
}`);

const [entities, types, properties, pages, dataBlocks] = await Promise.all([
  listSpaceEntities(),
  listEntitiesByType(SystemIds.SCHEMA_TYPE),
  listEntitiesByType(SystemIds.PROPERTY),
  listEntitiesByType(SystemIds.PAGE_TYPE),
  listEntitiesByType(SystemIds.DATA_BLOCK),
]);

const summary = {
  space: {
    id: spaceData.space?.id ?? targetSpaceId,
    address: spaceData.space?.address ?? null,
    configuredName,
  },
  totals: {
    entities: entities.length,
    types: types.length,
    properties: properties.length,
    pages: pages.length,
    dataBlocks: dataBlocks.length,
  },
  types: normalizeRows(types),
  properties: normalizeRows(properties),
  pages: normalizeRows(pages),
  dataBlocks: normalizeRows(dataBlocks),
};

console.log(JSON.stringify(summary, null, 2));
