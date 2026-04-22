import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import { gql } from "./lib/graphql.mjs";
import { deterministicPropertyId } from "./lib/ids.mjs";
import { buildEvidenceSchema, buildLocalSchema } from "./lib/local-schema.mjs";
import { compactValues, textValue, uniqueValues } from "./lib/proposal-utils.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const PROPOSAL_NAME = "Disease Atlas - residual evidence category repair";
const EVIDENCE_BLOCK_ID = "47fb6dd61feb518dde55ad2a4414120b";

const config = loadGeoEnv({ requirePrivateKey: false });
const sharedTypes = { Pathway: { id: "4dc67296e849f4108914da6c662a5d12" } };
const evidenceSchema = buildEvidenceSchema(config.targetSpaceId, sharedTypes);
const localSchema = buildLocalSchema(config.targetSpaceId, sharedTypes);
const licenseProperty = deterministicPropertyId(config.targetSpaceId, "License");
const ops = [];
const touched = {
  repaired: [],
  skipped: [],
};

function rawValue(value) {
  return (
    value.text ??
    value.boolean ??
    value.integer ??
    value.float ??
    value.date ??
    value.datetime ??
    ""
  );
}

function valueByName(entity, propertyName) {
  const value = (entity.values?.nodes ?? []).find(
    (entry) => entry.property?.name === propertyName
  );
  return value ? rawValue(value) : null;
}

function hasValue(entity, propertyName) {
  const value = valueByName(entity, propertyName);
  return value !== null && value !== undefined && value !== "";
}

function inferEvidence(entity) {
  const metaedge = valueByName(entity, "Hetionet metaedge");
  const name = entity.name ?? "";

  if (metaedge === "CtD" || name.includes(" - Treats - ") || name.includes(" - Related drugs - ")) {
    return {
      category: "curated treatment indication",
      sourceFamily: "PharmacotherapyDB",
      license: "CC0 1.0",
    };
  }

  if (metaedge === "PCiC" || name.includes(" - Includes - ")) {
    return {
      category: "pharmacologic class membership",
      sourceFamily: "DrugCentral",
      license: "CC BY 4.0",
    };
  }

  if (metaedge === "GpPW" || name.includes(" - Participates in pathway - ") || name.includes(" - Related pathways - ")) {
    return {
      category: "pathway annotation",
      sourceFamily: "Reactome",
      license: "CC BY 4.0",
    };
  }

  if (["GpBP", "GpMF", "GpCC"].includes(metaedge)) {
    return {
      category: "gene ontology annotation",
      sourceFamily: "NCBI gene2go",
      license: "CC BY 4.0",
    };
  }

  return null;
}

function updateMissingValues(entity, values) {
  const existing = new Set(
    (entity.values?.nodes ?? []).map(
      (value) => `${value.property?.id}:${String(rawValue(value))}`
    )
  );
  const missing = uniqueValues(values).filter(
    (value) => !existing.has(`${value.property}:${String(value.value)}`)
  );
  if (missing.length === 0) return false;
  const { ops: updateOps } = Graph.updateEntity({ id: entity.id, values: missing });
  ops.push(...updateOps);
  return true;
}

async function evidenceItems() {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const data = await gql(`{
      relations(
        first: 1000,
        offset: ${offset},
        filter: {
          fromEntityId: { is: "${EVIDENCE_BLOCK_ID}" },
          typeId: { is: "${SystemIds.COLLECTION_ITEM_RELATION_TYPE}" }
        }
      ) {
        toEntity {
          id
          name
          values(first: 100) {
            nodes {
              property { id name }
              text
              boolean
              float
              integer
              date
              datetime
            }
          }
        }
      }
    }`);
    const page = data.relations ?? [];
    items.push(...page.map((relation) => relation.toEntity));
    if (page.length < 1000) break;
  }
  return items;
}

for (const entity of await evidenceItems()) {
  if (hasValue(entity, "Evidence category")) continue;
  const inferred = inferEvidence(entity);
  if (!inferred) {
    touched.skipped.push({ id: entity.id, name: entity.name });
    continue;
  }

  const values = compactValues([
    textValue(evidenceSchema.propertyIds["Evidence category"], inferred.category),
    textValue(evidenceSchema.propertyIds["Source family"], inferred.sourceFamily),
    textValue(licenseProperty, inferred.license),
    textValue(localSchema.propertyIds["Import batch"], valueByName(entity, "Import batch")),
    textValue(localSchema.propertyIds["Hetionet metaedge"], valueByName(entity, "Hetionet metaedge")),
  ]);
  const changed = updateMissingValues(entity, values);
  if (changed) {
    touched.repaired.push({
      id: entity.id,
      name: entity.name,
      evidenceCategory: inferred.category,
      sourceFamily: inferred.sourceFamily,
    });
  }
}

const result = await finalizeProposal({
  config,
  proposalName: PROPOSAL_NAME,
  ops,
  touched: {
    repairedCount: touched.repaired.length,
    skippedCount: touched.skipped.length,
    repairedSample: touched.repaired.slice(0, 20),
    skippedSample: touched.skipped.slice(0, 20),
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
