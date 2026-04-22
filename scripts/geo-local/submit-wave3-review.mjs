import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_INPUT_PATH = fileURLToPath(
  new URL("../../data/geo-local/wave3-review-mutations.json", import.meta.url)
);

const inputPath = process.env.GEO_LOCAL_WAVE3_INPUT ?? DEFAULT_INPUT_PATH;
const ingestUrl = process.env.GEO_LOCAL_INGEST_URL ?? "http://localhost:3001";
const apiUrl = process.env.GEO_LOCAL_API_URL ?? "http://localhost:3002/api";
const spaceId = process.env.GEO_LOCAL_SPACE_ID ?? "141d3ace705feabc04d50c78bbf7226e";
const chunkSize = Number(process.env.GEO_LOCAL_CHUNK_SIZE ?? 400);
const timeoutMs = Number(process.env.GEO_LOCAL_APPLY_TIMEOUT_MS ?? 120000);
const pollMs = Number(process.env.GEO_LOCAL_POLL_MS ?? 1000);
const dryRun = process.env.DRY_RUN === "1";

function chunkMutations(mutations) {
  if (!Number.isFinite(chunkSize) || chunkSize <= 0 || mutations.length <= chunkSize) {
    return [mutations];
  }

  const chunks = [];
  for (let index = 0; index < mutations.length; index += chunkSize) {
    chunks.push(mutations.slice(index, index + chunkSize));
  }
  return chunks;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-space-id": spaceId,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `POST ${url} failed with ${response.status}: ${payload.error ?? response.statusText}`
    );
  }
  return payload;
}

async function waitForEdit(editId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${apiUrl}/edits/${editId}`);
    if (response.ok) {
      const edit = await response.json();
      if (edit.status === "applied") return edit;
      if (edit.status === "failed") {
        throw new Error(`Edit ${editId} failed: ${edit.errorMsg ?? "unknown error"}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(
    `Timed out waiting for edit ${editId}. Is the geo-local indexer running?`
  );
}

const payload = JSON.parse(await readFile(inputPath, "utf8"));
const chunks = chunkMutations(payload.mutations);

const summary = {
  inputPath,
  payloadName: payload.name,
  targetSpaceId: spaceId,
  mutationCount: payload.mutations.length,
  chunkCount: chunks.length,
  chunkSize,
  dryRun,
  payloadSummary: payload.summary,
};

if (dryRun) {
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
  process.exit(0);
}

const edits = [];
for (const [index, mutations] of chunks.entries()) {
  const name = `${payload.name} (${index + 1}/${chunks.length})`;
  const edit = await postJson(`${ingestUrl}/edits/build`, {
    name,
    mutations,
  });
  const applied = await waitForEdit(edit.id);
  edits.push({
    id: edit.id,
    name,
    mutationCount: mutations.length,
    opCount: edit.opCount,
    status: applied.status,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        chunk: index + 1,
        chunkCount: chunks.length,
        editId: edit.id,
        mutationCount: mutations.length,
        opCount: edit.opCount,
        status: applied.status,
      },
      null,
      2
    )
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      ...summary,
      edits,
      explorerUrl: "http://localhost:3003",
      apiExamples: {
        breastCancer:
          "http://localhost:3002/api/search?q=Breast%20cancer&limit=10",
        tnf: "http://localhost:3002/api/search?q=TNF&limit=10",
        evidence:
          "http://localhost:3002/api/entities?type=4b6d9fc1fbfe474c861c83398e1b50d9&limit=20",
      },
    },
    null,
    2
  )
);
