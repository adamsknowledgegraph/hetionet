import { DataBlock, Graph, SystemIds, TextBlock } from "@geoprotocol/geo-sdk";

import { opIdToHex } from "./ids.mjs";

export function createTextBlockOps({ fromId, text, position }) {
  return TextBlock.make({
    fromId,
    text,
    position,
  });
}

export function createQueryBlockOps({ fromId, name, filter, position }) {
  const blockOps = DataBlock.make({
    fromId,
    sourceType: "QUERY",
    position,
    name,
  });

  const blockId = opIdToHex(
    blockOps.find(
      (op) =>
        op.type === "updateEntity" &&
        Array.isArray(op.set) &&
        op.set.some(
          (entry) => opIdToHex(entry.property) === SystemIds.NAME_PROPERTY
        )
    )?.id
  );

  if (!blockId) {
    throw new Error(`Failed to derive block id for "${name}".`);
  }

  const { ops: filterOps } = Graph.updateEntity({
    id: blockId,
    values: [
      {
        property: SystemIds.FILTER,
        type: "text",
        value: filter,
      },
    ],
  });

  return {
    blockId,
    ops: [...blockOps, ...filterOps],
  };
}

