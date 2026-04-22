import { createHash } from "node:crypto";

import { Position } from "@geoprotocol/geo-sdk";

function normalizePart(part) {
  if (part === undefined || part === null) {
    return "";
  }

  if (typeof part === "string") {
    return part.trim();
  }

  return String(part);
}

export function deterministicId(...parts) {
  const digest = createHash("sha256")
    .update(parts.map(normalizePart).join("|"))
    .digest("hex");

  return digest.slice(0, 32);
}

export function deterministicTypeId(spaceId, name) {
  return deterministicId("type", spaceId, name);
}

export function deterministicPropertyId(spaceId, name) {
  return deterministicId("property", spaceId, name);
}

export function deterministicEntityId(spaceId, typeName, name) {
  return deterministicId("entity", spaceId, typeName, name);
}

export function deterministicRelationEntityId({
  fromId,
  typeId,
  toId,
  spaceId,
  sourceKey,
}) {
  return deterministicId(fromId, typeId, toId, spaceId, sourceKey);
}

export function deterministicRelationId({
  fromId,
  typeId,
  toId,
  spaceId,
  sourceKey,
}) {
  return deterministicId("relation", fromId, typeId, toId, spaceId, sourceKey);
}

export function relationEntityName(fromName, propertyName, toName) {
  return `${fromName} - ${propertyName} - ${toName}`;
}

export function opIdToHex(id) {
  if (!id || typeof id !== "object") {
    return null;
  }

  const bytes = Object.values(id);

  if (bytes.length !== 16) {
    return null;
  }

  return bytes
    .map((value) => Number(value).toString(16).padStart(2, "0"))
    .join("");
}

export function sortByPosition(items) {
  return [...items].sort((left, right) =>
    Position.compare(left.position ?? null, right.position ?? null)
  );
}

export function positionBefore(firstPosition) {
  return Position.generateBetween(null, firstPosition ?? null);
}

export function positionAfter(lastPosition) {
  return Position.generateBetween(lastPosition ?? null, null);
}

