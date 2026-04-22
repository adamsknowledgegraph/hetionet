import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import { gql } from "./lib/graphql.mjs";
import { buildEvidenceSchema } from "./lib/local-schema.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const PROPOSAL_NAME = "Disease Atlas - regulation ontology cleanup";

const sharedTypes = {
  Disease: { id: "aa949a7e4e615830b37b793fac1257e5" },
  Gene: { id: "93a0c3dc71314daf862e66c3af8b4fe4" },
  Symptom: { id: "b57c864fa7f9f581c0017a8cd83b21a8" },
  "Anatomical structure": { id: "cf59ea3ca51645978867c19a6d583e56" },
};

const config = loadGeoEnv({ requirePrivateKey: false });
const evidenceSchema = buildEvidenceSchema(config.targetSpaceId, sharedTypes);

const regulationProperties = [
  {
    id: evidenceSchema.propertyIds.Upregulates,
    oldName: "Disease upregulates gene",
    name: "Upregulates",
    description:
      "Evidence-only regulation relation indicating the source entity is associated with increased activity or expression of the target entity. The current STARGEO imports target genes, but the predicate is intentionally reusable across entity types.",
  },
  {
    id: evidenceSchema.propertyIds.Downregulates,
    oldName: "Disease downregulates gene",
    name: "Downregulates",
    description:
      "Evidence-only regulation relation indicating the source entity is associated with decreased activity or expression of the target entity. The current STARGEO imports target genes, but the predicate is intentionally reusable across entity types.",
  },
];

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

const ops = [];
const touched = {
  renamedProperties: [],
  renamedRelationEntities: [],
  removedRelationValueTypeConstraints: [],
  skippedRelationEntities: [],
};

for (const property of regulationProperties) {
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

  const relationValueTypeConstraints = await fetchRelationValueTypeConstraints(
    property.id
  );
  for (const constraint of relationValueTypeConstraints) {
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
    if (!relation.entityId) {
      touched.skippedRelationEntities.push({
        relationId: relation.id,
        reason: "missing relation entity",
      });
      continue;
    }

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
