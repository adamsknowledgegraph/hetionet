import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import {
  deterministicEntityId,
  deterministicRelationEntityId,
  deterministicRelationId,
  positionAfter,
  relationEntityName,
  sortByPosition,
} from "./ids.mjs";
import { fetchEntity, gql } from "./graphql.mjs";

export const MARKDOWN_CONTENT_PROPERTY_ID = "e3e363d1dd294ccb8e6ff3b76d99bc33";

export function valueText(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return String(value);
}

export function textValue(property, value) {
  const text = valueText(value);
  if (text === null) return null;
  return { property, type: "text", value: text };
}

export function booleanValue(property, value) {
  return { property, type: "boolean", value: Boolean(value) };
}

export function floatValue(property, value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return { property, type: "float", value: Number(value) };
}

export function datetimeValue(property, value) {
  const text = valueText(value);
  if (text === null) return null;
  return { property, type: "datetime", value: text };
}

export function compactValues(values) {
  return values.filter(Boolean);
}

export function uniqueValues(values) {
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

export function existingValueSet(entity) {
  return new Set(
    (entity?.values?.nodes ?? []).map((value) => {
      const raw =
        value.text ??
        value.boolean ??
        value.integer ??
        value.float ??
        value.date ??
        value.datetime ??
        "";
      return `${value.property?.id}:${String(raw)}`;
    })
  );
}

export async function updateMissingValues({ ops, entityId, values }) {
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
  return true;
}

export function ownerSpaceId(entity, preferredSpaceIds, fallbackSpaceId) {
  const spaceIds = entity?.ownerSpaceIds ?? entity?.spaceIds ?? [];
  for (const preferredSpaceId of preferredSpaceIds) {
    if (spaceIds.includes(preferredSpaceId)) {
      return preferredSpaceId;
    }
  }
  return spaceIds[0] ?? fallbackSpaceId;
}

export async function relationExists({ spaceId, fromId, typeId, toId }) {
  const data = await gql(`{
    relations(
      first: 1,
      filter: {
        spaceId: { is: "${spaceId}" },
        fromEntityId: { is: "${fromId}" },
        typeId: { is: "${typeId}" },
        toEntityId: { is: "${toId}" }
      }
    ) {
      id
      entityId
    }
  }`);

  return (data.relations ?? [])[0] ?? null;
}

export async function relationTargets(entity, typeId) {
  return new Set(
    (entity?.relations?.nodes ?? [])
      .filter((relation) => relation.type?.id === typeId)
      .map((relation) => relation.toEntity?.id)
      .filter(Boolean)
  );
}

export function addSimpleRelation({ ops, fromEntity, toEntity, type, spaceId, sourceKey, position }) {
  const { ops: relationOps } = Graph.createRelation({
    id: deterministicRelationId({
      fromId: fromEntity,
      typeId: type,
      toId: toEntity,
      spaceId,
      sourceKey,
    }),
    fromEntity,
    toEntity,
    type,
    position,
  });
  ops.push(...relationOps);
}

export async function ensureCollectionBlock({
  ops,
  config,
  currentEntities,
  blockNames,
  finalName,
  description,
  itemMap,
}) {
  const existing =
    blockNames
      .map((name) =>
        currentEntities.find(
          (entity) =>
            entity.name === name && entity.typeIds?.includes(SystemIds.DATA_BLOCK)
        )
      )
      .find(Boolean) ?? null;

  const id = existing?.id ?? deterministicEntityId(config.targetSpaceId, "Data block", finalName);
  const detail = existing ? await fetchEntity(existing.id) : null;
  const dataSourceRelations = (detail?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE
  );
  const currentTargets = await relationTargets(detail, SystemIds.COLLECTION_ITEM_RELATION_TYPE);

  if (existing) {
    const { ops: updateOps } = Graph.updateEntity({
      id,
      name: finalName,
      description,
    });
    ops.push(...updateOps);
  } else {
    const { ops: createOps } = Graph.createEntity({
      id,
      name: finalName,
      description,
      types: [SystemIds.DATA_BLOCK],
    });
    ops.push(...createOps);
    currentEntities.push({
      id,
      name: finalName,
      typeIds: [SystemIds.DATA_BLOCK],
      spaceIds: [config.targetSpaceId],
    });
  }

  for (const relation of dataSourceRelations) {
    if (relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE) continue;
    const { ops: deleteOps } = Graph.deleteRelation({ id: relation.id });
    ops.push(...deleteOps);
  }

  const hasCollectionSource = dataSourceRelations.some(
    (relation) => relation.toEntity?.id === SystemIds.COLLECTION_DATA_SOURCE
  );
  if (!hasCollectionSource) {
    addSimpleRelation({
      ops,
      fromEntity: id,
      toEntity: SystemIds.COLLECTION_DATA_SOURCE,
      type: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
      spaceId: config.targetSpaceId,
      sourceKey: `${finalName}:collection-source`,
    });
  }

  let added = 0;
  for (const [itemId, itemName] of itemMap.entries()) {
    if (currentTargets.has(itemId)) continue;
    addSimpleRelation({
      ops,
      fromEntity: id,
      toEntity: itemId,
      type: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
      spaceId: config.targetSpaceId,
      sourceKey: `${finalName}:item:${itemName}`,
    });
    added += 1;
  }

  return { id, name: finalName, itemCount: itemMap.size, added };
}

export async function configureBlockColumns({ ops, config, blockId, blockName, columnIds }) {
  const data = await gql(`{
    relations(
      first: 80,
      filter: {
        typeId: { is: "${SystemIds.BLOCKS}" },
        toEntityId: { is: "${blockId}" }
      }
    ) {
      entityId
      fromEntity { id name }
      entity {
        relations(first: 120) {
          nodes {
            type { id name }
            toEntity { id name }
          }
        }
      }
    }
  }`);

  const touched = [];
  for (const placement of data.relations ?? []) {
    const placementRelations = placement.entity?.relations?.nodes ?? [];
    let changed = false;
    const hasTableView = placementRelations.some(
      (relation) =>
        relation.type?.id === SystemIds.VIEW_PROPERTY &&
        relation.toEntity?.id === SystemIds.TABLE_VIEW
    );

    if (!hasTableView) {
      addSimpleRelation({
        ops,
        fromEntity: placement.entityId,
        toEntity: SystemIds.TABLE_VIEW,
        type: SystemIds.VIEW_PROPERTY,
        spaceId: config.targetSpaceId,
        sourceKey: `${blockName}:table-view`,
      });
      changed = true;
    }

    let lastPosition = null;
    for (const columnId of columnIds) {
      const hasColumn = placementRelations.some(
        (relation) =>
          relation.type?.id === SystemIds.SHOWN_COLUMNS &&
          relation.toEntity?.id === columnId
      );
      if (hasColumn) continue;

      lastPosition = positionAfter(lastPosition);
      addSimpleRelation({
        ops,
        fromEntity: placement.entityId,
        toEntity: columnId,
        type: SystemIds.SHOWN_COLUMNS,
        spaceId: config.targetSpaceId,
        sourceKey: `${blockName}:shown-column:${columnId}`,
        position: lastPosition,
      });
      changed = true;
    }

    if (changed) {
      touched.push(placement.fromEntity?.name ?? placement.entityId);
    }
  }

  return touched;
}

export async function ensureTextBlock({ ops, config, key, text }) {
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

export async function ensureBlockRelation({ ops, config, fromId, blockId, sourceKey }) {
  const fromEntity = await fetchEntity(fromId);
  const currentBlockRelations = (fromEntity?.relations?.nodes ?? []).filter(
    (relation) => relation.type?.id === SystemIds.BLOCKS
  );

  if (currentBlockRelations.some((relation) => relation.toEntity?.id === blockId)) {
    return false;
  }

  const lastPosition = sortByPosition(currentBlockRelations).at(-1)?.position ?? null;
  addSimpleRelation({
    ops,
    fromEntity: fromId,
    toEntity: blockId,
    type: SystemIds.BLOCKS,
    spaceId: config.targetSpaceId,
    sourceKey,
    position: positionAfter(lastPosition),
  });
  return true;
}

export async function createProvenanceRelation({
  ops,
  config,
  fromEntity,
  typeId,
  propertyName,
  toEntity,
  sourceKey,
  entityValues = [],
  entitySourceIds = [],
  sharedSourcesPropertyId,
}) {
  const existing = await relationExists({
    spaceId: config.targetSpaceId,
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
  });

  if (existing?.entityId) {
    return { created: false, entityId: existing.entityId };
  }

  const relationId = deterministicRelationId({
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
    spaceId: config.targetSpaceId,
    sourceKey,
  });
  const relationEntityId = deterministicRelationEntityId({
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
    spaceId: config.targetSpaceId,
    sourceKey,
  });

  const entityRelations =
    entitySourceIds.length > 0 && sharedSourcesPropertyId
      ? {
          [sharedSourcesPropertyId]: entitySourceIds.map((sourceId) => ({
            toEntity: sourceId,
          })),
        }
      : undefined;

  const { ops: relationOps } = Graph.createRelation({
    id: relationId,
    entityId: relationEntityId,
    entityName: relationEntityName(fromEntity.name, propertyName, toEntity.name),
    fromEntity: fromEntity.id,
    toEntity: toEntity.id,
    fromSpace:
      fromEntity.ownerSpaceId && fromEntity.ownerSpaceId !== config.targetSpaceId
        ? fromEntity.ownerSpaceId
        : undefined,
    toSpace:
      toEntity.ownerSpaceId && toEntity.ownerSpaceId !== config.targetSpaceId
        ? toEntity.ownerSpaceId
        : undefined,
    type: typeId,
    entityValues: uniqueValues(entityValues),
    entityRelations,
  });
  ops.push(...relationOps);
  return { created: true, entityId: relationEntityId };
}
