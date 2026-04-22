import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(THIS_DIR, "../../..");
export const ENV_PATH = path.join(REPO_ROOT, ".env");

dotenv.config({ path: ENV_PATH, quiet: true });

const REQUIRED_TARGET_VARS = [
  "GEO_TARGET_SPACE_ID",
  "GEO_TARGET_SPACE_ADDRESS",
  "GEO_TARGET_SPACE_NAME",
  "GEO_TARGET_SPACE_ENTITY_ID",
];

export function normalizePrivateKey(value) {
  if (!value) {
    return null;
  }

  return value.startsWith("0x") ? value : `0x${value}`;
}

function getMissingVars(keys) {
  return keys.filter((key) => !process.env[key]);
}

export function loadGeoEnv({
  requirePrivateKey = false,
  requireTargetSpace = true,
} = {}) {
  const dryRun = process.env.DRY_RUN === "1";
  const missingVars = requireTargetSpace ? getMissingVars(REQUIRED_TARGET_VARS) : [];

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required Geo environment variables: ${missingVars.join(", ")}.`
    );
  }

  const privateKey = normalizePrivateKey(process.env.GEO_PRIVATE_KEY);

  if ((requirePrivateKey || !dryRun) && !privateKey) {
    throw new Error(
      "Missing GEO_PRIVATE_KEY. Copy .env.example to .env and fill it first."
    );
  }

  return {
    dryRun,
    network: process.env.GEO_NETWORK || "TESTNET",
    privateKey,
    personalSpaceId: process.env.GEO_PERSONAL_SPACE_ID || null,
    targetSpaceId: process.env.GEO_TARGET_SPACE_ID || null,
    targetSpaceAddress: process.env.GEO_TARGET_SPACE_ADDRESS || null,
    targetSpaceName: process.env.GEO_TARGET_SPACE_NAME || null,
    targetSpaceEntityId: process.env.GEO_TARGET_SPACE_ENTITY_ID || null,
    targetPageTypeId: process.env.GEO_TARGET_PAGE_TYPE_ID || null,
  };
}

export function bytes16Hex(id) {
  return `0x${id}`;
}
