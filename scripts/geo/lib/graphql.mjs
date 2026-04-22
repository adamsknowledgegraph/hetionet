import { SystemIds } from "@geoprotocol/geo-sdk";

export const GEO_GRAPHQL_API = "https://testnet-api.geobrowser.io/graphql";

export const ROOT_SPACE_ID = "a19c345ab9866679b001d7d2138d88a1";
export const HEALTH_SPACE_ID = "52c7ae149838b6d47ce0f3b2a5974546";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function gql(query) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(GEO_GRAPHQL_API, {
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

export async function fetchSpace(spaceId) {
  const data = await gql(`{
    space(id: "${spaceId}") {
      id
      address
    }
  }`);

  return data.space ?? null;
}

export async function listSpaceEntities(spaceId, first = 1000, options = {}) {
  const pageSize = Math.min(first, 1000);
  const entities = [];
  const typeClause = options.typeId ? `, typeId: "${options.typeId}"` : "";

  for (let offset = 0; offset < first; offset += pageSize) {
    const data = await gql(`{
      entities(spaceId: "${spaceId}", first: ${pageSize}, offset: ${offset}${typeClause}) {
        id
        name
        description
        spaceIds
        typeIds
      }
    }`);

    const page = data.entities ?? [];
    entities.push(...page);

    if (page.length < pageSize || entities.length >= first) {
      break;
    }
  }

  return entities.slice(0, first);
}

export async function fetchEntity(entityId) {
  const data = await gql(`{
    entity(id: "${entityId}") {
      id
      name
      description
      spaceIds
      typeIds
      types {
        id
        name
      }
      values(first: 200) {
        nodes {
          property {
            id
            name
          }
          text
          date
          datetime
          boolean
          integer
          float
        }
      }
      relations(first: 1000) {
        nodes {
          id
          entityId
          position
          type {
            id
            name
          }
          toEntity {
            id
            name
            spaceIds
            typeIds
          }
        }
      }
    }
  }`);

  return data.entity ?? null;
}

export async function searchExactEntitiesByName({
  typeId,
  name,
  first = 25,
}) {
  const escapedName = JSON.stringify(name);
  const data = await gql(`{
    entities(
      typeId: "${typeId}",
      filter: { name: { includesInsensitive: ${escapedName} } },
      first: ${first}
    ) {
      id
      name
      description
      spaceIds
      typeIds
    }
  }`);

  return (data.entities ?? []).filter(
    (entity) => entity.name?.toLowerCase() === name.toLowerCase()
  );
}

export async function findPreferredEntity({
  typeId,
  name,
  preferredSpaceIds = [],
}) {
  const matches = await searchExactEntitiesByName({ typeId, name });

  if (matches.length === 0) {
    return null;
  }

  const ranked = [...matches].sort((left, right) => {
    const leftRank = preferredSpaceIds.findIndex((spaceId) =>
      left.spaceIds?.includes(spaceId)
    );
    const rightRank = preferredSpaceIds.findIndex((spaceId) =>
      right.spaceIds?.includes(spaceId)
    );

    const leftScore = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
    const rightScore = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.id.localeCompare(right.id);
  });

  return ranked[0] ?? null;
}

export async function lookupTypeByName(name) {
  return findPreferredEntity({
    typeId: SystemIds.SCHEMA_TYPE,
    name,
    preferredSpaceIds: [HEALTH_SPACE_ID, ROOT_SPACE_ID],
  });
}

export async function lookupPropertyByName(name) {
  return findPreferredEntity({
    typeId: SystemIds.PROPERTY,
    name,
    preferredSpaceIds: [HEALTH_SPACE_ID, ROOT_SPACE_ID],
  });
}

export function findEntityInSpace(entities, { name, typeId }) {
  return (
    entities.find(
      (entity) =>
        entity.name === name &&
        (!typeId || entity.typeIds?.includes(typeId))
    ) ?? null
  );
}
