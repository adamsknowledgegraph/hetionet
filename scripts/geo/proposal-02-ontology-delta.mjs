import { Graph, SystemIds } from "@geoprotocol/geo-sdk";

import { createQueryBlockOps, createTextBlockOps } from "./lib/blocks.mjs";
import { loadGeoEnv } from "./lib/env.mjs";
import { buildTypeFilter } from "./lib/filters.mjs";
import { fetchEntity, findEntityInSpace, listSpaceEntities } from "./lib/graphql.mjs";
import { positionAfter, positionBefore, sortByPosition } from "./lib/ids.mjs";
import { buildLocalSchema } from "./lib/local-schema.mjs";
import { loadLiveManifest, mustGetNamedEntry } from "./lib/manifest.mjs";
import { finalizeProposal } from "./lib/publish.mjs";

const ONTOLOGY_INTRO =
  "This local ontology delta is intentionally narrow and limited to GO-style concepts plus the relation vocabulary required for curated Hetionet-derived disease mechanism publishing.";

const config = loadGeoEnv({ requirePrivateKey: false });
const manifest = await loadLiveManifest();

const sharedTypes = {
  Gene: mustGetNamedEntry(manifest.types, "Gene", "type"),
  Pathway: mustGetNamedEntry(manifest.types, "Pathway", "type"),
  Drug: mustGetNamedEntry(manifest.types, "Drug", "type"),
  Property: mustGetNamedEntry(manifest.types, "Property", "type"),
};

const localSchema = buildLocalSchema(config.targetSpaceId, sharedTypes);
const currentEntities = await listSpaceEntities(config.targetSpaceId);
const ontologyPageId = manifest.targetSnapshot.pages.Ontology.id;
const ontologyPage = await fetchEntity(ontologyPageId);

const ops = [];
const touched = {
  createdTypes: [],
  createdProperties: [],
  blocksCreated: [],
  notes: [
    "Added a local Includes drug relation so pharmacologic class membership can be represented faithfully in the Asthma packet.",
  ],
};

for (const typeDefinition of localSchema.types) {
  const existing = findEntityInSpace(currentEntities, {
    name: typeDefinition.name,
    typeId: SystemIds.SCHEMA_TYPE,
  });

  if (existing) {
    continue;
  }

  const { ops: typeOps } = Graph.createType(typeDefinition);
  ops.push(...typeOps);
  touched.createdTypes.push(typeDefinition.name);
}

for (const propertyDefinition of localSchema.valueProperties) {
  const existing = findEntityInSpace(currentEntities, {
    name: propertyDefinition.name,
    typeId: SystemIds.PROPERTY,
  });

  if (existing) {
    continue;
  }

  const { ops: propertyOps } = Graph.createProperty(propertyDefinition);
  ops.push(...propertyOps);
  touched.createdProperties.push(propertyDefinition.name);
}

for (const propertyDefinition of localSchema.relationProperties) {
  const existing = findEntityInSpace(currentEntities, {
    name: propertyDefinition.name,
    typeId: SystemIds.PROPERTY,
  });

  if (existing) {
    continue;
  }

  const { ops: propertyOps } = Graph.createProperty({
    ...propertyDefinition,
    dataType: "RELATION",
  });
  ops.push(...propertyOps);
  touched.createdProperties.push(propertyDefinition.name);
}

const ontologyBlockRelations = (ontologyPage?.relations?.nodes ?? []).filter(
  (relation) => relation.type?.name === "Blocks"
);
const sortedOntologyBlocks = sortByPosition(ontologyBlockRelations);
const firstOntologyBlockPosition = sortedOntologyBlocks.at(0)?.position ?? null;
const lastOntologyBlockPosition = sortedOntologyBlocks.at(-1)?.position ?? null;

ops.push(
  ...createTextBlockOps({
    fromId: ontologyPageId,
    text: ONTOLOGY_INTRO,
    position: positionBefore(firstOntologyBlockPosition),
  })
);

const propertiesBlockExisting = findEntityInSpace(currentEntities, {
  name: "Properties",
  typeId: SystemIds.DATA_BLOCK,
});

if (!propertiesBlockExisting) {
  const propertiesBlock = createQueryBlockOps({
    fromId: ontologyPageId,
    name: "Properties",
    filter: buildTypeFilter({
      spaceId: config.targetSpaceId,
      typeId: sharedTypes.Property.id,
    }),
    position: positionAfter(lastOntologyBlockPosition),
  });

  ops.push(...propertiesBlock.ops);
  touched.blocksCreated.push("Properties");
}

const result = await finalizeProposal({
  config,
  proposalName: "Disease Atlas - ontology delta",
  ops,
  touched,
});

console.log(JSON.stringify(result, null, 2));

