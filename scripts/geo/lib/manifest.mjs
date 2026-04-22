import path from "node:path";
import { promises as fs } from "node:fs";

import { REPO_ROOT } from "./env.mjs";

export const DATA_DIR = path.join(REPO_ROOT, "data", "geo");
export const LIVE_MANIFEST_PATH = path.join(DATA_DIR, "live-manifest.json");
export const ASTHMA_PACKET_PATH = path.join(DATA_DIR, "asthma-packet.json");

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readJsonFile(filePath, { allowMissing = false } = {}) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeJsonFile(filePath, data) {
  await ensureDataDir();
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function loadLiveManifest({ allowMissing = false } = {}) {
  const manifest = await readJsonFile(LIVE_MANIFEST_PATH, { allowMissing });

  if (!manifest && !allowMissing) {
    throw new Error(
      `Missing live manifest at ${LIVE_MANIFEST_PATH}. Run the discovery script first.`
    );
  }

  return manifest;
}

export async function loadAsthmaPacket() {
  return readJsonFile(ASTHMA_PACKET_PATH);
}

export function mustGetNamedEntry(record, name, kind) {
  const entry = record?.[name] ?? null;

  if (!entry) {
    throw new Error(`Missing ${kind} "${name}" in the live manifest.`);
  }

  return entry;
}

