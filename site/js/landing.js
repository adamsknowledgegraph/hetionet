const DATA_URL = "data/atlas-dashboard.json";

const NUMBER_WORDS = {
  1: "One",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
  7: "Seven",
  8: "Eight",
  9: "Nine",
  10: "Ten",
  11: "Eleven",
  12: "Twelve",
  13: "Thirteen",
  14: "Fourteen",
  15: "Fifteen",
  16: "Sixteen",
  17: "Seventeen",
  18: "Eighteen",
  19: "Nineteen",
  20: "Twenty",
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function setStat(name, value) {
  document.querySelectorAll(`[data-atlas-stat="${name}"]`).forEach((node) => {
    node.textContent = formatNumber(value);
  });
}

function kindCount(nodes, kind) {
  return nodes.filter((node) => node.kind === kind).length;
}

function renderCoverageTable(diseases) {
  const table = document.querySelector("#coverage-table");
  if (!table) return;
  const header = table.querySelector("[role='row']");
  table.innerHTML = "";
  table.append(header);
  for (const disease of diseases) {
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    row.innerHTML = `
      <span>${disease.name}</span>
      <span>${formatNumber(Object.values(disease.evidenceGroupCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0))}</span>
      <span>${formatNumber(disease.nodeCounts?.gene || 0)}</span>
      <span>${formatNumber(disease.nodeCounts?.drug || 0)}</span>
      <span>${formatNumber(disease.relationCounts?.symptomEvidence || 0)}</span>
    `;
    table.append(row);
  }
}

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) return;
  const data = await response.json();
  const nodes = data.nodes || [];
  const summary = data.meta?.summary || {};
  setStat("diseaseCount", summary.diseaseCount);
  setStat("nodeCount", summary.nodeCount);
  setStat("claimCount", summary.claimCount);
  setStat("sourceCount", summary.sourceCount);
  setStat("paperCount", summary.paperCount);
  setStat("geneCount", kindCount(nodes, "gene"));
  setStat("drugCount", kindCount(nodes, "drug"));
  setStat("drugClassCount", kindCount(nodes, "drug-class"));
  setStat("pathwayCount", kindCount(nodes, "pathway"));
  setStat("symptomCount", kindCount(nodes, "symptom"));
  setStat("anatomyCount", kindCount(nodes, "anatomy"));
  document.querySelectorAll("[data-atlas-stat='diseaseCountText']").forEach((node) => {
    node.textContent = NUMBER_WORDS[summary.diseaseCount] || formatNumber(summary.diseaseCount);
  });
  renderCoverageTable(data.diseases || []);
}

init().catch(() => {});
