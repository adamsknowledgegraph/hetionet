import { SystemIds } from "@geoprotocol/geo-sdk";

import { loadGeoEnv } from "./lib/env.mjs";
import {
  HEALTH_SPACE_ID,
  ROOT_SPACE_ID,
  findPreferredEntity,
} from "./lib/graphql.mjs";

const config = loadGeoEnv({ requirePrivateKey: false });

const EXPECTED_SHARED_TYPES = [
  "Disease",
  "Drug",
  "Drug class",
  "Gene",
  "Pathway",
  "Dataset",
  "Source",
  "Paper",
];

const EXPECTED_LOCAL_TYPES = [
  "Biological Process",
  "Molecular Function",
  "Cellular Component",
];

const EXPECTED_SHARED_PROPERTIES = [
  "Treats",
  "Sources",
  "Website",
  "DOI",
  "Pmid",
  "Publish date",
  "Abstract",
  "Source database identifier",
  "Version ID",
  "DrugBank ID",
  "Inchikey",
  "Related drugs",
  "Related pathways",
  "SMILES",
  "KEGG ID",
];

const EXPECTED_LOCAL_PROPERTIES = [
  "Associated with",
  "Participates in pathway",
  "Participates in biological process",
  "Has molecular function",
  "Located in cellular component",
  "GO ID",
  "Hetionet metaedge",
  "Unbiased",
  "Import batch",
  "Disease Ontology ID",
  "Entrez Gene ID",
  "License",
  "InChI",
  "Class type",
  "Includes",
  "Presents with",
  "Localizes to",
  "Resembles",
  "Palliates",
  "Upregulates",
  "Downregulates",
];

const SEMANTIC_REVIEW = [
  {
    localName: "Includes",
    nearestSharedName: "Related drugs",
    recommendation:
      "Use Health's Related drugs for disease-drug browseability; use Includes for drug-class membership or other reusable containment/membership relations.",
  },
];

async function lookup({ name, kind, preferredSpaceIds }) {
  const typeId = kind === "type" ? SystemIds.SCHEMA_TYPE : SystemIds.PROPERTY;
  const entity = await findPreferredEntity({
    typeId,
    name,
    preferredSpaceIds,
  });

  return {
    name,
    id: entity?.id ?? null,
    spaceIds: entity?.spaceIds ?? [],
    owner:
      entity?.spaceIds?.includes(HEALTH_SPACE_ID)
        ? "Health"
        : entity?.spaceIds?.includes(ROOT_SPACE_ID)
          ? "Root"
          : entity?.spaceIds?.includes(config.targetSpaceId)
            ? "Disease Atlas"
            : entity
              ? "Other"
              : "Missing",
  };
}

async function lookupMany(names, kind, preferredSpaceIds) {
  const rows = [];
  for (const name of names) {
    rows.push(await lookup({ name, kind, preferredSpaceIds }));
  }
  return rows;
}

const sharedPreferredSpaces = [HEALTH_SPACE_ID, ROOT_SPACE_ID, config.targetSpaceId];
const localPreferredSpaces = [config.targetSpaceId, HEALTH_SPACE_ID, ROOT_SPACE_ID];

const summary = {
  ok: true,
  targetSpaceId: config.targetSpaceId,
  targetSpaceName: config.targetSpaceName,
  checks: {
    sharedTypes: await lookupMany(
      EXPECTED_SHARED_TYPES,
      "type",
      sharedPreferredSpaces
    ),
    localTypes: await lookupMany(
      EXPECTED_LOCAL_TYPES,
      "type",
      localPreferredSpaces
    ),
    sharedProperties: await lookupMany(
      EXPECTED_SHARED_PROPERTIES,
      "property",
      sharedPreferredSpaces
    ),
    localProperties: await lookupMany(
      EXPECTED_LOCAL_PROPERTIES,
      "property",
      localPreferredSpaces
    ),
  },
  semanticReview: SEMANTIC_REVIEW,
};

const missingShared = [
  ...summary.checks.sharedTypes,
  ...summary.checks.sharedProperties,
].filter((entry) => !entry.id || entry.owner === "Disease Atlas");

const missingLocal = [
  ...summary.checks.localTypes,
  ...summary.checks.localProperties,
].filter((entry) => !entry.id || entry.owner !== "Disease Atlas");

summary.ok = missingShared.length === 0 && missingLocal.length === 0;
summary.findings = {
  missingOrLocalSharedTerms: missingShared,
  missingLocalTerms: missingLocal,
};

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exit(1);
}
