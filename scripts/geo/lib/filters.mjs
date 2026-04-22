import { SystemIds } from "@geoprotocol/geo-sdk";

export function buildTypeFilter({ spaceId, typeId, extraFilter = {} }) {
  return JSON.stringify({
    spaceId: {
      in: [spaceId],
    },
    filter: {
      [SystemIds.TYPES_PROPERTY]: {
        is: typeId,
      },
      ...extraFilter,
    },
  });
}

