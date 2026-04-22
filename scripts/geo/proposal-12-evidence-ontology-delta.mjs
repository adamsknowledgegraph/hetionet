import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  findEntityInSpace,
  findPreferredEntity,
  listSpaceEntities,
} from "./lib/graphql.mjs";
import { buildEvidenceSchema } from "./lib/local-schema.mjs";
import {
  ensureBlockRelation,
  ensureTextBlock,
} from "./lib/proposal-utils.mjs";
import { finalizeProposal, summarizeOps } from "./lib/publish.mjs";

const PROPOSAL_NAME = "Disease Atlas - Evidence ontology delta v2";
const ONTOLOGY_NOTE = [
  "Disease Atlas now separates canonical biomedical facts from evidence-only Hetionet claims.",
  "",
  "The local evidence ontology adds relation vocabulary for MEDLINE cooccurrence, STARGEO expression, disease similarity, and palliative indication edges. Shared Health and Root concepts remain the default for entity types, source links, papers, datasets, and reusable clinical vocabulary.",
].join("\n");

const config = loadGeoEnv({ requirePrivateKey: false });
const currentEntities = await listSpaceEntities(config.targetSpaceId, 1000);
const ops = [];
const touched = {
  reusedSharedTypes: {},
  createdProperties: [],
  skippedExistingProperties: [],
  addedTextBlocks: [],
};

async function mustFindType(name, preferredSpaceId) {
  const entity = await findPreferredEntity({
    typeId: SystemIds.SCHEMA_TYPE,
    name,
    preferredSpaceIds: [preferredSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID],
  });

  if (!entity) {
    throw new Error(`Missing expected shared type "${name}".`);
  }

  touched.reusedSharedTypes[name] = `${entity.id} (${entity.spaceIds?.join(",")})`;
  return entity;
}

function findLocalProperty(name) {
  return findEntityInSpace(currentEntities, {
    name,
    typeId: SystemIds.PROPERTY,
  });
}

function rememberProperty(propertyDefinition) {
  currentEntities.push({
    id: propertyDefinition.id,
    name: propertyDefinition.name,
    typeIds: [SystemIds.PROPERTY],
    spaceIds: [config.targetSpaceId],
  });
}

const sharedTypes = {
  Disease: await mustFindType("Disease", HEALTH_SPACE_ID),
  Symptom: await mustFindType("Symptom", HEALTH_SPACE_ID),
  "Anatomical structure": await mustFindType(
    "Anatomical structure",
    HEALTH_SPACE_ID
  ),
  Gene: await mustFindType("Gene", HEALTH_SPACE_ID),
};
const evidenceSchema = buildEvidenceSchema(config.targetSpaceId, sharedTypes);

for (const propertyDefinition of evidenceSchema.valueProperties) {
  if (findLocalProperty(propertyDefinition.name)) {
    touched.skippedExistingProperties.push(propertyDefinition.name);
    continue;
  }

  const { ops: propertyOps } = Graph.createProperty(propertyDefinition);
  ops.push(...propertyOps);
  touched.createdProperties.push(propertyDefinition.name);
  rememberProperty(propertyDefinition);
}

for (const propertyDefinition of evidenceSchema.relationProperties) {
  if (findLocalProperty(propertyDefinition.name)) {
    touched.skippedExistingProperties.push(propertyDefinition.name);
    continue;
  }

  const { ops: propertyOps } = Graph.createProperty({
    ...propertyDefinition,
    dataType: "RELATION",
  });
  ops.push(...propertyOps);
  touched.createdProperties.push(propertyDefinition.name);
  rememberProperty(propertyDefinition);
}

const ontologyPage = currentEntities.find(
  (entity) =>
    entity.name === "Ontology" && entity.typeIds?.includes(SystemIds.PAGE_TYPE)
);
if (!ontologyPage) {
  throw new Error("Missing Ontology page.");
}

const textBlockId = await ensureTextBlock({
  ops,
  config,
  key: "evidence-ontology-note",
  text: ONTOLOGY_NOTE,
});
const addedText = await ensureBlockRelation({
  ops,
  config,
  fromId: ontologyPage.id,
  blockId: textBlockId,
  sourceKey: "evidence-ontology-note",
});
if (addedText) {
  touched.addedTextBlocks.push("Evidence ontology note");
}

const result = await finalizeProposal({
  config,
  proposalName: PROPOSAL_NAME,
  ops,
  touched: {
    ...touched,
    opTypes: summarizeOps(ops),
  },
});

console.log(JSON.stringify(result, null, 2));
