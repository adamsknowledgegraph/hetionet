const DATA_URL = "data/atlas-dashboard.json";
const URL_PARAMS = new URLSearchParams(window.location.search);

if (URL_PARAMS.get("view") === "explorer") {
  document.body.classList.add("capture-explorer");
}

const KIND_COLOR = {
  disease: "#eed07b",
  gene: "#00ffd1",
  drug: "#ff3d7f",
  "drug-class": "#ff8abd",
  pathway: "#b9ff4a",
  "go-term": "#7b5cff",
  symptom: "#ff8abd",
  anatomy: "#ff9f1c",
};

const RELATION_COLOR = {
  associatedGenes: "#00ffd1",
  treats: "#ff3d7f",
  palliates: "#fff36d",
  includesDrug: "#ff8abd",
  participatesInPathway: "#b9ff4a",
  participatesInBiologicalProcess: "#7b5cff",
  hasMolecularFunction: "#33a3ff",
  locatedInCellularComponent: "#ffffff",
  symptomEvidence: "#ff8abd",
  anatomyEvidence: "#ff9f1c",
  diseaseSimilarityEvidence: "#fff36d",
  upregulatedGenes: "#b9ff4a",
  downregulatedGenes: "#ff3d7f",
};

const KIND_LABEL = {
  disease: "Disease",
  gene: "Gene",
  drug: "Drug",
  "drug-class": "Drug class",
  pathway: "Pathway",
  "go-term": "GO term",
  symptom: "Symptom",
  anatomy: "Anatomy",
};

const CLAIM_HELP = {
  associatedGenes: {
    plainLabel: "disease-gene association",
    sentence: (item) => `${item.sourceName} is associated with gene ${item.targetName}`,
    explanation: (item) => `This means a source reports a disease-gene association for ${item.targetName} in ${item.sourceName}. It is a pointer to inspect biology and evidence, not by itself proof of causality.`,
  },
  treats: {
    plainLabel: "treatment indication",
    sentence: (item) => `${item.sourceName} is recorded as treating ${item.targetName}`,
    explanation: () => "This means a curated treatment-indication source links the drug to the disease. It is not dosing, guideline, safety, or prescribing advice.",
  },
  palliates: {
    plainLabel: "palliative/supportive indication",
    sentence: (item) => `${item.sourceName} is recorded as palliating ${item.targetName}`,
    explanation: () => "This means a source links the drug to symptom relief or supportive use for the disease. It should be read separately from a direct treatment claim.",
  },
  includesDrug: {
    plainLabel: "drug class membership",
    sentence: (item) => `${item.sourceName} includes ${item.targetName}`,
    explanation: () => "This means the drug belongs to a pharmacologic class. It helps group treatments by mechanism or class, but is not a disease claim on its own.",
  },
  participatesInPathway: {
    plainLabel: "gene-pathway annotation",
    sentence: (item) => `${item.sourceName} participates in pathway ${item.targetName}`,
    explanation: () => "This means the gene is annotated to a pathway. In the atlas, it helps explain what biology a disease-associated gene may connect to.",
  },
  participatesInBiologicalProcess: {
    plainLabel: "gene-function annotation",
    sentence: (item) => `${item.sourceName} participates in biological process ${item.targetName}`,
    explanation: () => "This means the gene is annotated to a Gene Ontology biological process. It provides functional context for disease-associated genes.",
  },
  hasMolecularFunction: {
    plainLabel: "gene-function annotation",
    sentence: (item) => `${item.sourceName} has molecular function ${item.targetName}`,
    explanation: () => "This means the gene product is annotated with a molecular function. It is functional context, not a disease-specific claim by itself.",
  },
  locatedInCellularComponent: {
    plainLabel: "gene-location annotation",
    sentence: (item) => `${item.sourceName} is located in cellular component ${item.targetName}`,
    explanation: () => "This means the gene product is annotated to a cellular component. It describes where the gene product is found or acts in cell biology.",
  },
  symptomEvidence: {
    plainLabel: "presentation signal",
    sentence: (item) => `${item.sourceName} is linked to symptom/presentation ${item.targetName}`,
    explanation: () => "This is a literature co-occurrence signal: the disease and symptom/presentation term appear together in source material. Read it as a clue for exploration, not as a canonical clinical symptom list.",
  },
  anatomyEvidence: {
    plainLabel: "anatomy signal",
    sentence: (item) => `${item.sourceName} is linked to anatomy term ${item.targetName}`,
    explanation: () => "This is what the imported relation calls 'localizes to'. In plain English: the disease and anatomy term co-occur in biomedical source material. It is a localization/anatomy signal to inspect, not proof that the disease literally occurs only there.",
  },
  diseaseSimilarityEvidence: {
    plainLabel: "disease similarity signal",
    sentence: (item) => `${item.sourceName} has a similarity signal with ${item.targetName}`,
    explanation: () => "This means two diseases are linked by a source-derived similarity signal. It can be useful for exploration, but should not be read as saying the diseases are biologically equivalent.",
  },
  upregulatedGenes: {
    plainLabel: "expression increase",
    sentence: (item) => `${item.sourceName} upregulates gene ${item.targetName}`,
    explanation: (item) => `This means the gene is reported as more highly expressed in a disease expression dataset. The log2 fold-change value is ${formatLog2(item)} when available.`,
  },
  downregulatedGenes: {
    plainLabel: "expression decrease",
    sentence: (item) => `${item.sourceName} downregulates gene ${item.targetName}`,
    explanation: (item) => `This means the gene is reported as less highly expressed in a disease expression dataset. The log2 fold-change value is ${formatLog2(item)} when available.`,
  },
};

const QUALITY_HELP = {
  treats: {
    label: "Curated indication",
    tone: "strong",
    explanation: "This is one of the strongest claim types in this atlas: a curated treatment-indication relationship. Still not prescribing advice.",
  },
  associatedGenes: {
    label: "Database association",
    tone: "moderate",
    explanation: "This is a disease-gene association from a structured source. Useful for target triage, but not proof that the gene causes the disease.",
  },
  palliates: {
    label: "Supportive signal",
    tone: "moderate",
    explanation: "This points to supportive or palliative use. It should be separated from a direct treatment indication.",
  },
  upregulatedGenes: {
    label: "Expression signal",
    tone: "numeric",
    explanation: "This is differential-expression evidence with a numeric log2 fold-change where available. It is useful for prioritization, not causal proof.",
  },
  downregulatedGenes: {
    label: "Expression signal",
    tone: "numeric",
    explanation: "This is differential-expression evidence with a numeric log2 fold-change where available. It is useful for prioritization, not causal proof.",
  },
  symptomEvidence: {
    label: "Exploratory signal",
    tone: "exploratory",
    explanation: "This is a literature/source cooccurrence signal. Treat it as a clue to inspect, not a canonical medical fact.",
  },
  anatomyEvidence: {
    label: "Exploratory signal",
    tone: "exploratory",
    explanation: "This is a literature/source cooccurrence signal. Treat it as a clue to inspect, not a literal anatomy assertion.",
  },
  diseaseSimilarityEvidence: {
    label: "Exploratory signal",
    tone: "exploratory",
    explanation: "This is a source-derived similarity signal between diseases. Useful for hypothesis generation, not equivalence.",
  },
};

const ANNOTATION_TYPES = new Set([
  "includesDrug",
  "participatesInPathway",
  "participatesInBiologicalProcess",
  "hasMolecularFunction",
  "locatedInCellularComponent",
]);

const canvas = document.querySelector("#graph-canvas");
const ctx = canvas.getContext("2d");

const els = {
  diseaseSelect: document.querySelector("#disease-select"),
  modeButtons: [...document.querySelectorAll(".mode-button")],
  searchInput: document.querySelector("#search-input"),
  openGeoItem: document.querySelector("#open-geo-item"),
  openGeoSpace: document.querySelector("#open-geo-space"),
  motionToggle: document.querySelector("#motion-toggle"),
  metricStack: document.querySelector("#metric-stack"),
  questZone: document.querySelector("#quest-zone"),
  legendStrip: document.querySelector("#legend-strip"),
  briefBoard: document.querySelector("#brief-board"),
  exploreBrowser: document.querySelector("#explore-browser"),
  panels: [...document.querySelectorAll(".mode-panel")],
  compareBoard: document.querySelector("#compare-board"),
  evidenceToolbar: document.querySelector("#evidence-toolbar"),
  evidenceList: document.querySelector("#evidence-list"),
  sourceBoard: document.querySelector("#source-board"),
  inspectorContent: document.querySelector("#inspector-content"),
  statusPill: document.querySelector("#status-pill"),
  resetFocus: document.querySelector("#reset-focus"),
};

const state = {
  data: null,
  disease: "Asthma",
  mode: "brief",
  search: "",
  selectedNodeId: null,
  selectedEdgeId: null,
  evidenceFilter: "all",
  kindFilter: "all",
  motion: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  graphNodes: [],
  graphEdges: [],
  layout: new Map(),
  pointerNodeId: null,
  animationId: null,
  pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLog2(item) {
  return item.log2FoldChange !== null && item.log2FoldChange !== undefined
    ? Number(item.log2FoldChange).toFixed(4)
    : "not available";
}

function claimHelp(item) {
  return CLAIM_HELP[item.type] || {
    plainLabel: item.evidenceCategory || "source-backed claim",
    sentence: (claim) => `${claim.sourceName} ${claim.label.toLowerCase()} ${claim.targetName}`,
    explanation: () => "This is a source-backed relationship in the Disease Atlas graph.",
  };
}

function claimSentence(item) {
  return claimHelp(item).sentence(item);
}

function claimExplanation(item) {
  return claimHelp(item).explanation(item);
}

function claimPlainLabel(item) {
  return claimHelp(item).plainLabel;
}

function modeLabel(mode) {
  return mode === "brief" ? "Insights" : `${mode[0].toUpperCase()}${mode.slice(1)}`;
}

function evidenceQuality(item) {
  if (QUALITY_HELP[item.type]) {
    return QUALITY_HELP[item.type];
  }
  if (ANNOTATION_TYPES.has(item.type)) {
    return {
      label: "Annotation context",
      tone: "context",
      explanation: "This is ontology or database context connected to a gene, drug, pathway, or GO term. It helps explain biology, but is not a disease claim by itself.",
    };
  }
  return {
    label: "Source-backed claim",
    tone: "context",
    explanation: "This claim has source provenance in the graph, but does not yet have a more specific quality label.",
  };
}

function qualityChip(item) {
  const quality = evidenceQuality(item);
  return `<span class="quality-chip" data-quality="${escapeHtml(quality.tone)}">${escapeHtml(quality.label)}</span>`;
}

function byId(items) {
  return new Map(items.map((item) => [item.id, item]));
}

function diseaseByName(name) {
  return state.data.diseases.find((disease) => disease.name === name);
}

function geoSpaceUrl() {
  return state.data?.meta?.geoSpaceUrl || "https://www.geobrowser.io/space/141d3ace705feabc04d50c78bbf7226e";
}

function geoUrlForDiseaseName(name) {
  return diseaseByName(name)?.geoUrl || geoSpaceUrl();
}

function renderTopbarGeoLinks() {
  if (els.openGeoItem) {
    els.openGeoItem.href = geoUrlForDiseaseName(state.disease);
    els.openGeoItem.textContent = `Open ${state.disease} in Geo`;
    els.openGeoItem.setAttribute("aria-label", `Open ${state.disease} packet in Geo`);
    els.openGeoItem.title = `Open ${state.disease} packet in Geo`;
  }
  if (els.openGeoSpace) {
    els.openGeoSpace.href = geoSpaceUrl();
  }
}

function uniqueLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    const key = `${link.label}|${link.href}`;
    if (!link.href || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function renderLinkList(links, className = "link-list") {
  if (!links.length) {
    return "";
  }
  return `<div class="${className}">${links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}</div>`;
}

function geoLinksForItem(item) {
  const links = [];
  if (item.kind === "disease") {
    links.push({
      label: `Open ${item.name} in Geo`,
      href: geoUrlForDiseaseName(item.name),
    });
  } else {
    for (const diseaseName of (item.appearsIn || []).slice(0, 6)) {
      links.push({
        label: `${diseaseName} packet in Geo`,
        href: geoUrlForDiseaseName(diseaseName),
      });
    }
  }
  links.push({
    label: "Open Geo Space",
    href: geoSpaceUrl(),
  });
  return uniqueLinks(links);
}

function geoLinksForEdge(item) {
  return uniqueLinks([
    {
      label: `Open ${item.disease} packet in Geo`,
      href: geoUrlForDiseaseName(item.disease),
    },
    {
      label: "Open Geo Space",
      href: geoSpaceUrl(),
    },
  ]);
}

function node(id) {
  return state.nodeMap.get(id);
}

function edge(id) {
  return state.edgeMap.get(id);
}

function diseaseNodeId(name) {
  return `disease:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function nodeMatchesSearch(item) {
  if (!state.search) {
    return false;
  }
  const haystack = [
    item.name,
    item.kind,
    ...(item.groups || []),
    ...(item.sources || []),
    ...(item.appearsIn || []),
    ...Object.values(item.identifiers || {}),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(state.search.toLowerCase());
}

function edgeMatchesSearch(item) {
  if (!state.search) {
    return false;
  }
  return [
    item.sourceName,
    item.targetName,
    item.type,
    item.label,
    item.metaedge,
    item.primarySource,
    item.evidenceGroup,
    item.evidenceCategory,
    item.sourceFamily,
    ...(item.sourceNames || []),
    item.disease,
  ]
    .join(" ")
    .toLowerCase()
    .includes(state.search.toLowerCase());
}

function getDiseaseEdges(diseaseName = state.disease) {
  return state.data.edges.filter((item) => item.disease === diseaseName);
}

function getDiseaseNodes(diseaseName = state.disease) {
  const ids = new Set([diseaseNodeId(diseaseName)]);
  for (const item of getDiseaseEdges(diseaseName)) {
    ids.add(item.source);
    ids.add(item.target);
  }
  return [...ids].map((id) => node(id)).filter(Boolean);
}

function getFilteredDiseaseEdges(diseaseName = state.disease) {
  const edges = getDiseaseEdges(diseaseName);
  if (state.kindFilter === "all") {
    return edges;
  }
  return edges.filter((item) => {
    const source = node(item.source);
    const target = node(item.target);
    return source?.kind === state.kindFilter || target?.kind === state.kindFilter;
  });
}

function getFilteredDiseaseNodes(diseaseName = state.disease) {
  if (state.kindFilter === "all") {
    return getDiseaseNodes(diseaseName);
  }
  const ids = new Set([diseaseNodeId(diseaseName)]);
  for (const item of getFilteredDiseaseEdges(diseaseName)) {
    ids.add(item.source);
    ids.add(item.target);
  }
  for (const item of getDiseaseNodes(diseaseName)) {
    if (item.kind === state.kindFilter) {
      ids.add(item.id);
    }
  }
  return [...ids].map((id) => node(id)).filter(Boolean);
}

function setKindFilter(kind) {
  state.kindFilter = kind;
  state.selectedEdgeId = null;
  if (state.search) {
    state.search = "";
    els.searchInput.value = "";
  }
  const first = getDiseaseNodes().find((item) => item.kind === kind);
  state.selectedNodeId = kind === "all" ? diseaseNodeId(state.disease) : first?.id || diseaseNodeId(state.disease);
  renderMode();
  renderInspector();
  rebuildCanvasGraph();
}

function evidenceGroupsForDisease(diseaseName = state.disease) {
  return [...new Set(getDiseaseEdges(diseaseName).map((item) => item.evidenceGroup || item.type))].sort();
}

function evidenceQualityCounts(diseaseName = state.disease) {
  return getDiseaseEdges(diseaseName).reduce((counts, item) => {
    const quality = evidenceQuality(item);
    counts[quality.tone] = (counts[quality.tone] || 0) + 1;
    return counts;
  }, {});
}

function evidenceGroupLabel(group) {
  return group || "Evidence";
}

function setMode(mode) {
  state.mode = mode;
  if (["evidence", "sources"].includes(mode)) {
    state.selectedEdgeId = null;
    state.selectedNodeId = diseaseNodeId(state.disease);
  }
  canvas.dataset.mode = mode;
  els.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  els.panels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === mode);
  });
  renderMode();
  renderInspector();
  rebuildCanvasGraph();
}

function setDisease(name) {
  state.disease = name;
  if (els.diseaseSelect.value !== name) {
    els.diseaseSelect.value = name;
  }
  state.selectedEdgeId = null;
  state.selectedNodeId = diseaseNodeId(name);
  state.evidenceFilter = "all";
  state.kindFilter = "all";
  renderAll();
  rebuildCanvasGraph();
}

function setSearch(value) {
  state.search = value.trim();
  if (state.search) {
    const match = state.data.nodes.find(nodeMatchesSearch);
    if (match) {
      state.selectedNodeId = match.id;
      state.selectedEdgeId = null;
    }
  }
  renderInspector();
  renderMode();
  rebuildCanvasGraph();
}

function renderMotionControl() {
  const label = els.motionToggle.querySelector("[data-motion-label]");
  if (label) {
    label.textContent = state.motion ? "Motion on" : "Motion paused";
  }
  els.motionToggle.setAttribute("aria-pressed", String(state.motion));
}

function resizeCanvas() {
  state.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.width = Math.floor(width * state.pixelRatio);
  canvas.height = Math.floor(height * state.pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);
  rebuildCanvasGraph();
}

function placeCluster(nodes, anchor, radiusX, radiusY, startAngle, endAngle) {
  const placed = [];
  if (!nodes.length) {
    return placed;
  }

  const span = endAngle - startAngle;
  nodes.forEach((item, index) => {
    const fraction = nodes.length === 1 ? 0.5 : index / (nodes.length - 1);
    const angle = (startAngle + span * fraction) * (Math.PI / 180);
    placed.push({
      id: item.id,
      x: anchor.x + Math.cos(angle) * radiusX,
      y: anchor.y + Math.sin(angle) * radiusY,
      radius: item.kind === "disease" ? 30 : 15,
    });
  });
  return placed;
}

function layoutExplore(nodes) {
  const { width, height } = canvasSize();
  const center = { x: width * 0.5, y: height * 0.52 };
  const maxR = Math.max(120, Math.min(width, height) * 0.24);
  const byKind = {
    disease: nodes.filter((item) => item.kind === "disease"),
    gene: nodes.filter((item) => item.kind === "gene"),
    drug: nodes.filter((item) => item.kind === "drug"),
    "drug-class": nodes.filter((item) => item.kind === "drug-class"),
    pathway: nodes.filter((item) => item.kind === "pathway"),
    "go-term": nodes.filter((item) => item.kind === "go-term"),
    symptom: nodes.filter((item) => item.kind === "symptom"),
    anatomy: nodes.filter((item) => item.kind === "anatomy"),
  };

  return [
    ...byKind.disease.map((item) => ({
      id: item.id,
      x: center.x,
      y: center.y,
      radius: 32,
    })),
    ...placeCluster(byKind.gene, center, maxR * 1.12, maxR * 0.92, 145, 255),
    ...placeCluster(byKind.drug, center, maxR * 1.18, maxR * 0.92, -58, 58),
    ...placeCluster(byKind["drug-class"], center, maxR * 1.55, maxR * 0.7, -34, 34),
    ...placeCluster(byKind.pathway, center, maxR * 0.95, maxR * 1.05, 222, 318),
    ...placeCluster(byKind["go-term"], center, maxR * 0.96, maxR * 1.18, 48, 132),
    ...placeCluster(byKind.symptom, center, maxR * 1.55, maxR * 1.12, 128, 212),
    ...placeCluster(byKind.anatomy, center, maxR * 1.55, maxR * 1.12, -32, -112),
  ];
}

function layoutCompare() {
  const { width, height } = canvasSize();
  const columns = Math.min(4, state.data.diseases.length);
  const rows = Math.ceil(state.data.diseases.length / columns);
  const lanes = state.data.diseases.map((disease, index) => ({
    disease,
    x: width * (((index % columns) + 1) / (columns + 1)),
    y: height * ((Math.floor(index / columns) + 1) / (rows + 1)),
  }));
  const placed = [];

  for (const lane of lanes) {
    const nodes = getDiseaseNodes(lane.disease.name);
    placed.push({
      id: diseaseNodeId(lane.disease.name),
      x: lane.x,
      y: lane.y,
      radius: 28,
    });
    placed.push(
      ...placeCluster(
        nodes.filter((item) => item.kind === "gene").slice(0, 8),
        lane,
        90,
        150,
        200,
        340
      )
    );
    placed.push(
      ...placeCluster(
        nodes.filter((item) => item.kind === "drug").slice(0, 7),
        lane,
        105,
        138,
        20,
        160
      )
    );
  }

  return placed;
}

function rebuildCanvasGraph() {
  if (!state.data) {
    return;
  }
  if (["brief", "compare", "evidence", "sources"].includes(state.mode)) {
    state.graphNodes = [];
    state.graphEdges = [];
    state.layout = new Map();
  } else {
    state.graphNodes = getFilteredDiseaseNodes();
    state.graphEdges = getFilteredDiseaseEdges();
    state.layout = new Map(layoutExplore(state.graphNodes).map((item) => [item.id, item]));
  }
  drawFrame(performance.now());
}

function drawEdge(item, time, index) {
  const source = state.layout.get(item.source);
  const target = state.layout.get(item.target);
  if (!source || !target) {
    return;
  }

  const selected = state.selectedEdgeId === item.id
    || state.selectedNodeId === item.source
    || state.selectedNodeId === item.target;
  const searched = edgeMatchesSearch(item);
  const color = RELATION_COLOR[item.type] || "#ffffff";
  const alpha = selected || searched ? 0.82 : 0.18;
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;
  const bend = Math.min(90, Math.hypot(target.x - source.x, target.y - source.y) * 0.18);
  const ctrlX = midX + (target.y - source.y > 0 ? bend : -bend);
  const ctrlY = midY - (target.x - source.x > 0 ? bend : -bend);

  ctx.save();
  ctx.strokeStyle = hexToRgba(color, alpha);
  ctx.lineWidth = selected || searched ? 2.2 : 1.1;
  ctx.beginPath();
  ctx.moveTo(source.x, source.y);
  ctx.quadraticCurveTo(ctrlX, ctrlY, target.x, target.y);
  ctx.stroke();

  if (state.motion) {
    const t = ((time / 1300 + index * 0.071) % 1);
    const dot = quadPoint(source, { x: ctrlX, y: ctrlY }, target, t);
    ctx.fillStyle = hexToRgba(color, selected || searched ? 0.95 : 0.42);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, selected || searched ? 3.5 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawNode(item, time) {
  const layout = state.layout.get(item.id);
  if (!layout) {
    return;
  }
  const selected = state.selectedNodeId === item.id;
  const hovered = state.pointerNodeId === item.id;
  const searched = nodeMatchesSearch(item);
  const color = KIND_COLOR[item.kind] || "#ffffff";
  const pulse = state.motion ? Math.sin(time / 280 + layout.x * 0.01) * 1.8 : 0;
  const radius = layout.radius + (selected || hovered || searched ? 5 : 0) + pulse;

  ctx.save();
  ctx.shadowBlur = selected || hovered || searched ? 28 : 12;
  ctx.shadowColor = color;
  ctx.fillStyle = hexToRgba(color, item.kind === "disease" ? 0.95 : 0.78);
  ctx.strokeStyle = hexToRgba("#ffffff", selected || searched ? 0.85 : 0.22);
  ctx.lineWidth = selected || searched ? 2.5 : 1;
  ctx.beginPath();
  ctx.arc(layout.x, layout.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (item.kind === "disease") {
    ctx.fillStyle = "rgba(5, 6, 10, 0.86)";
    ctx.beginPath();
    ctx.arc(layout.x, layout.y, Math.max(9, radius * 0.45), 0, Math.PI * 2);
    ctx.fill();
  }

  if (selected || hovered || searched || item.kind === "disease") {
    drawLabel(item.name, layout.x, layout.y + radius + 18, color);
  }
  ctx.restore();
}

function drawLabel(text, x, y, color) {
  const safe = text.length > 26 ? `${text.slice(0, 24)}...` : text;
  ctx.font = "600 12px Avenir Next, Helvetica Neue, sans-serif";
  const metrics = ctx.measureText(safe);
  const width = metrics.width + 14;
  ctx.fillStyle = "rgba(5, 6, 10, 0.78)";
  ctx.strokeStyle = hexToRgba(color, 0.42);
  roundedRect(x - width / 2, y - 12, width, 23, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#eef8ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(safe, x, y);
}

function roundedRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function drawFrame(time) {
  const { width, height } = canvasSize();
  ctx.clearRect(0, 0, width, height);
  drawStarfield(state.mode === "compare" ? 0 : time, state.mode === "compare" ? 0.14 : 0.55);
  state.graphEdges.forEach((item, index) => drawEdge(item, time, index));
  state.graphNodes.forEach((item) => drawNode(item, time));
}

function drawStarfield(time, alpha = 0.55) {
  const { width, height } = canvasSize();
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < 80; i += 1) {
    const x = (i * 137.5) % width;
    const y = (i * 71.3) % height;
    const twinkle = state.motion && state.mode !== "compare" ? 0.4 + Math.sin(time / 700 + i) * 0.22 : 0.42;
    ctx.fillStyle = `rgba(238, 248, 255, ${twinkle})`;
    ctx.fillRect(x, y, 1.3, 1.3);
  }
  ctx.restore();
}

function canvasSize() {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

function animate(time) {
  drawFrame(time);
  if (state.motion) {
    state.animationId = requestAnimationFrame(animate);
  }
}

function startAnimation() {
  if (state.animationId) {
    cancelAnimationFrame(state.animationId);
  }
  if (state.motion) {
    state.animationId = requestAnimationFrame(animate);
  } else {
    drawFrame(performance.now());
  }
}

function quadPoint(source, ctrl, target, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * source.x + 2 * inv * t * ctrl.x + t * t * target.x,
    y: inv * inv * source.y + 2 * inv * t * ctrl.y + t * t * target.y,
  };
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderMetrics() {
  const disease = diseaseByName(state.disease);
  const canonical = disease.canonicalRelationCounts;
  const groups = disease.evidenceGroupCounts || {};
  const nodeCounts = disease.nodeCounts || {};
  const claimTotal = Object.values(canonical).reduce((sum, count) => sum + Number(count || 0), 0);
  els.statusPill.textContent = disease.status.label;
  els.statusPill.dataset.tone = disease.status.tone;

  els.metricStack.innerHTML = `
    <div class="disease-card">
      <span class="status-pill" data-tone="${escapeHtml(disease.status.tone)}">${escapeHtml(disease.status.label)}</span>
      <h1>${escapeHtml(disease.name)}</h1>
      <p>${escapeHtml(disease.status.description)}</p>
      <p class="plain-note">A claim is one source-backed graph link, for example “drug treats disease” or “disease is linked to an anatomy signal.” Some claims are curated facts; others are evidence signals to inspect.</p>
      <div class="chip-row">
        ${disease.diseaseOntologyId ? `<span class="mini-pill">${escapeHtml(disease.diseaseOntologyId)}</span>` : ""}
        <a class="mini-pill" href="${escapeHtml(disease.geoUrl)}" target="_blank" rel="noreferrer">Open in Geo</a>
      </div>
      ${renderLinkList(uniqueLinks([
        { label: `Open ${disease.name} in Geo`, href: disease.geoUrl },
        { label: "Open Geo Space", href: geoSpaceUrl() },
      ]), "link-list geo-link-list")}
    </div>
    <div class="metric-grid">
      ${metric("Claims", claimTotal)}
      ${metric("Genes", nodeCounts.gene || 0)}
      ${metric("Treatments", groups.Treatments || 0)}
      ${metric("Sources", disease.sources?.length || 0)}
    </div>
  `;
}

function metric(label, value) {
  return `<div class="metric"><strong>${Number(value).toLocaleString()}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderLegend() {
  const kinds = ["disease", "gene", "drug", "drug-class", "pathway", "go-term", "symptom", "anatomy"];
  els.legendStrip.innerHTML = [
    `<button class="kind-chip ${state.kindFilter === "all" ? "is-active" : ""}" type="button" data-kind-filter="all">All</button>`,
    ...kinds
      .map((kind) => `<button class="kind-chip ${state.kindFilter === kind ? "is-active" : ""}" type="button" data-kind="${kind}" data-kind-filter="${kind}">${KIND_LABEL[kind]}</button>`),
  ]
    .join("");

  els.legendStrip.querySelectorAll("[data-kind-filter]").forEach((button) => {
    button.addEventListener("click", () => setKindFilter(button.dataset.kindFilter));
  });
}

function renderExploreBrowser() {
  const nodes = getDiseaseNodes().filter((item) => {
    if (item.kind === "disease") {
      return state.kindFilter === "all" || state.kindFilter === "disease";
    }
    return state.kindFilter === "all" || item.kind === state.kindFilter;
  });
  const visible = nodes
    .filter((item) => !state.search || nodeMatchesSearch(item))
    .sort((left, right) => {
      const kindOrder = ["disease", "gene", "drug", "drug-class", "pathway", "go-term", "symptom", "anatomy"];
      return kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind)
        || left.name.localeCompare(right.name);
    });
  const title = state.kindFilter === "all"
    ? `${state.disease} graph objects`
    : state.kindFilter === "disease"
      ? `${state.disease} disease links`
      : `${state.disease} ${KIND_LABEL[state.kindFilter].toLowerCase()}s`;

  els.exploreBrowser.innerHTML = `
    ${state.kindFilter === "disease" ? `
      <div class="plain-explainer">
        <strong>What “Disease” shows</strong>
        <span>This includes the selected disease itself plus other disease entities connected by similarity evidence. If you want genes, drugs, symptoms, or anatomy, use those chips instead.</span>
      </div>
    ` : ""}
    <div class="section-label">
      <span>${escapeHtml(title)}</span>
      <span>${visible.length}</span>
    </div>
    <div class="node-card-grid">
      ${visible.length ? visible.map((item) => nodeCard(item)).join("") : `
        <div class="empty-panel">
          <p class="empty-state">No nodes match the current search or filter.</p>
          <button class="filter-chip" type="button" data-clear-explore>Clear search and filters</button>
        </div>
      `}
    </div>
  `;

  els.exploreBrowser.querySelectorAll("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNodeId = button.dataset.nodeId;
      state.selectedEdgeId = null;
      renderInspector();
      rebuildCanvasGraph();
    });
  });
  els.exploreBrowser.querySelector("[data-clear-explore]")?.addEventListener("click", () => {
    state.search = "";
    state.kindFilter = "all";
    els.searchInput.value = "";
    state.selectedEdgeId = null;
    state.selectedNodeId = diseaseNodeId(state.disease);
    renderAll();
    rebuildCanvasGraph();
  });
}

function nodeCard(item) {
  const context = nodeContext(item);
  return `
    <button class="node-card ${state.selectedNodeId === item.id ? "is-active" : ""}" type="button" data-node-id="${escapeHtml(item.id)}">
      <span class="node-card-top">
        <span class="kind-chip" data-kind="${escapeHtml(item.kind)}">${escapeHtml(KIND_LABEL[item.kind] || item.kind)}</span>
        <span class="mini-pill">${context.edgeCount} edges</span>
      </span>
      <strong>${escapeHtml(item.name)}</strong>
      <span>${escapeHtml(context.summary)}</span>
      ${context.highlights.length ? `<span class="context-line">${escapeHtml(context.highlights.join(" | "))}</span>` : ""}
    </button>
  `;
}

function nodeContext(item) {
  const relatedScope = state.mode === "compare" && item.kind === "gene"
    ? state.data.edges
    : getDiseaseEdges();
  const related = relatedScope.filter(
    (rel) => rel.source === item.id || rel.target === item.id
  );
  const disease = diseaseByName(state.disease);
  const geneSupport = disease.selectedGenes.find((gene) => gene.name === item.name)?.support || [];
  const compoundSupport = disease.selectedCompounds.find((compound) => compound.name === item.name)?.support || [];
  const mechanisms = related
    .filter((rel) => rel.source === item.id && rel.type.startsWith("participates"))
    .map((rel) => rel.targetName);
  const sources = [...new Set(related.map((rel) => rel.primarySource).filter(Boolean))];
  const summary = nodeSummary(item, geneSupport, compoundSupport, mechanisms);
  const highlights = [
    geneSupport.length ? `support: ${geneSupport.join(", ")}` : null,
    compoundSupport.length ? `support: ${compoundSupport.join(", ")}` : null,
    mechanisms.length ? `mechanisms: ${mechanisms.slice(0, 2).join(", ")}` : null,
    sources.length ? `sources: ${sources.slice(0, 2).join(", ")}` : null,
  ].filter(Boolean);

  return {
    edgeCount: related.length,
    related,
    summary,
    highlights,
    mechanisms,
    sources,
    geneSupport,
    compoundSupport,
  };
}

function nodeSummary(item, geneSupport, compoundSupport, mechanisms) {
  if (item.description) {
    return item.description;
  }
  if (item.kind === "gene") {
    if (state.mode === "compare" && item.appearsIn.length > 1) {
      return `${item.name} is a shared gene bridge across ${item.appearsIn.length} disease packets: ${item.appearsIn.join(", ")}. Use the edge list to inspect whether each link is a direct disease-gene association, expression signal, or annotation context.`;
    }
    const support = geneSupport.length ? geneSupport.join(" and ") : "selected";
    const mechanismText = mechanisms.length
      ? ` It connects to ${mechanisms.slice(0, 2).join(", ")} in this disease slice.`
      : "";
    return `${item.name} is a ${support} ${state.disease} gene in this Disease Atlas packet.${mechanismText}`;
  }
  if (item.kind === "drug") {
    const support = compoundSupport.length ? compoundSupport.join(" and ") : "selected";
    return `${item.name} is a ${support} compound in this ${state.disease} view.`;
  }
  if (item.kind === "drug-class") {
    return `${item.name} groups treatments that appear in the ${state.disease} packet.`;
  }
  if (item.kind === "pathway" || item.kind === "go-term") {
    return `${item.name} is connected through selected disease-associated genes.`;
  }
  if (item.kind === "disease") {
    if (item.name === state.disease) {
      return `${item.name} is the selected disease packet. The surrounding edges are source-backed links to genes, drugs, pathways, evidence signals, and sources.`;
    }
    return `${item.name} is another disease entity connected to ${state.disease}, usually through a disease-similarity evidence signal.`;
  }
  if (item.kind === "symptom") {
    return `${item.name} appears as a literature-backed presentation signal for ${state.disease}.`;
  }
  if (item.kind === "anatomy") {
    return `${item.name} appears as a literature-backed anatomy/localization signal for ${state.disease}.`;
  }
  return `${item.name} appears in ${item.appearsIn.join(", ")}.`;
}

function renderQuests() {
  els.questZone.innerHTML = `
    <div class="section-label"><span>Research tasks</span><span>${state.data.quests.length}</span></div>
    ${state.data.quests
      .map(
        (quest) => `
          <button class="quest-card" type="button" data-quest="${escapeHtml(quest.id)}">
            <strong>${escapeHtml(quest.title)}</strong>
            <span>${escapeHtml(quest.prompt)}</span>
          </button>
        `
      )
      .join("")}
  `;

  els.questZone.querySelectorAll(".quest-card").forEach((button) => {
    button.addEventListener("click", () => runQuest(button.dataset.quest));
  });
}

function topEdgesByType(types, limit = 8) {
  const wanted = Array.isArray(types) ? types : [types];
  return getDiseaseEdges()
    .filter((item) => wanted.includes(item.type))
    .sort((left, right) => {
      const leftScore = relationPriority(left.type) * 1000 + Math.abs(Number(left.log2FoldChange || 0));
      const rightScore = relationPriority(right.type) * 1000 + Math.abs(Number(right.log2FoldChange || 0));
      return rightScore - leftScore || displayNameForEdge(left).localeCompare(displayNameForEdge(right));
    })
    .slice(0, limit);
}

function relationPriority(type) {
  return {
    treats: 6,
    associatedGenes: 5,
    palliates: 4,
    upregulatedGenes: 3,
    downregulatedGenes: 3,
    participatesInPathway: 2,
    participatesInBiologicalProcess: 1,
    hasMolecularFunction: 1,
    locatedInCellularComponent: 1,
  }[type] || 0;
}

function displayNameForEdge(item) {
  return item.targetName === state.disease ? item.sourceName : item.targetName;
}

function uniqueTargets(edges) {
  const seen = new Set();
  return edges.filter((item) => {
    const key = `${item.sourceName}|${item.targetName}|${item.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function edgeNodeId(item, kind) {
  if (node(item.source)?.kind === kind) {
    return item.source;
  }
  if (node(item.target)?.kind === kind) {
    return item.target;
  }
  return null;
}

function sharedNodeStatsForDisease(kind, relationTypes, diseaseName = state.disease) {
  const ids = new Set(
    getDiseaseEdges(diseaseName)
      .filter((item) => relationTypes.includes(item.type))
      .map((item) => edgeNodeId(item, kind))
      .filter(Boolean)
  );

  return [...ids]
    .map((id) => {
      const item = node(id);
      const edges = state.data.edges.filter((edge) => relationTypes.includes(edge.type) && edgeNodeId(edge, kind) === id);
      const diseaseNames = [...new Set(edges.map((edge) => edge.disease))].sort();
      const direct = edges.filter((edge) => edge.type === "associatedGenes" || edge.type === "treats").length;
      const expression = edges.filter((edge) => edge.type === "upregulatedGenes" || edge.type === "downregulatedGenes").length;
      return {
        item,
        edges,
        diseaseNames,
        diseaseCount: diseaseNames.length,
        claimCount: edges.length,
        direct,
        expression,
      };
    })
    .filter((entry) => entry.item && entry.diseaseCount > 1)
    .sort((left, right) => right.diseaseCount - left.diseaseCount
      || right.direct - left.direct
      || right.expression - left.expression
      || right.claimCount - left.claimCount
      || left.item.name.localeCompare(right.item.name));
}

function topMechanismStats(diseaseName = state.disease) {
  const counts = new Map();
  for (const item of getDiseaseEdges(diseaseName)) {
    if (!["participatesInPathway", "participatesInBiologicalProcess", "hasMolecularFunction"].includes(item.type)) {
      continue;
    }
    const target = node(item.target);
    if (!target) {
      continue;
    }
    const current = counts.get(target.id) || {
      item: target,
      claimCount: 0,
      genes: new Set(),
      sources: new Set(),
    };
    current.claimCount += 1;
    if (node(item.source)?.kind === "gene") {
      current.genes.add(item.sourceName);
    }
    for (const source of item.sourceNames || []) {
      current.sources.add(source);
    }
    counts.set(target.id, current);
  }

  return [...counts.values()]
    .sort((left, right) => right.claimCount - left.claimCount
      || right.genes.size - left.genes.size
      || left.item.name.localeCompare(right.item.name));
}

function diseaseInsightCards(disease) {
  const sharedGenes = sharedNodeStatsForDisease("gene", ["associatedGenes", "upregulatedGenes", "downregulatedGenes"], disease.name);
  const sharedDrugs = sharedNodeStatsForDisease("drug", ["treats", "palliates"], disease.name);
  const mechanisms = topMechanismStats(disease.name);
  const qualityCounts = evidenceQualityCounts(disease.name);
  const exploratory = qualityCounts.exploratory || 0;
  const stronger = (qualityCounts.strong || 0) + (qualityCounts.moderate || 0) + (qualityCounts.context || 0);
  const cards = [];

  if (sharedGenes[0]) {
    cards.push({
      kicker: "Shared biology",
      title: sharedGenes[0].item.name,
      body: `${sharedGenes[0].diseaseCount} disease packets share this gene through ${sharedGenes[0].claimCount} evidence rows.`,
      meta: [`${sharedGenes[0].direct} direct`, `${sharedGenes[0].expression} expression`],
      nodeId: sharedGenes[0].item.id,
    });
  }

  if (sharedDrugs[0]) {
    cards.push({
      kicker: "Repurposing clue",
      title: sharedDrugs[0].item.name,
      body: `${sharedDrugs[0].diseaseCount} disease packets include this treatment/supportive compound.`,
      meta: [`${sharedDrugs[0].claimCount} claims`, "drug overlap"],
      nodeId: sharedDrugs[0].item.id,
    });
  }

  if (mechanisms[0]) {
    cards.push({
      kicker: "Mechanism anchor",
      title: mechanisms[0].item.name,
      body: `${mechanisms[0].genes.size} genes in this disease packet connect to this pathway/function context.`,
      meta: [`${mechanisms[0].claimCount} annotations`, `${mechanisms[0].sources.size} sources`],
      nodeId: mechanisms[0].item.id,
    });
  }

  cards.push({
    kicker: "Evidence quality",
    title: exploratory > stronger ? "Mostly exploratory" : "Mixed evidence",
    body: `${stronger} curated/annotation rows and ${exploratory} exploratory signals. Use Evidence before treating a signal as a fact.`,
    meta: [`${qualityCounts.strong || 0} curated`, `${qualityCounts.exploratory || 0} exploratory`],
    mode: "evidence",
  });

  return cards;
}

function renderInsightCard(card) {
  return `
    <button class="insight-card" type="button"
      ${card.nodeId ? `data-insight-node-id="${escapeHtml(card.nodeId)}"` : ""}
      ${card.mode ? `data-insight-mode="${escapeHtml(card.mode)}"` : ""}>
      <span class="mini-pill">${escapeHtml(card.kicker)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <span>${escapeHtml(card.body)}</span>
      <span class="chip-row">
        ${card.meta.map((item) => `<span class="source-chip">${escapeHtml(item)}</span>`).join("")}
      </span>
    </button>
  `;
}

function renderBrief() {
  const disease = diseaseByName(state.disease);
  const genes = uniqueTargets([
    ...topEdgesByType("associatedGenes", 5),
    ...topEdgesByType(["upregulatedGenes", "downregulatedGenes"], 5),
  ]).slice(0, 8);
  const treatments = uniqueTargets(topEdgesByType(["treats", "palliates"], 8));
  const pathways = uniqueTargets(topEdgesByType("participatesInPathway", 6));
  const symptoms = uniqueTargets(topEdgesByType("symptomEvidence", 6));
  const anatomy = uniqueTargets(topEdgesByType("anatomyEvidence", 6));
  const insightCards = diseaseInsightCards(disease);
  const curatedCount = (disease.evidenceGroupCounts["Disease gene associations"] || 0)
    + (disease.evidenceGroupCounts.Treatments || 0)
    + (disease.evidenceGroupCounts["Pathway annotations"] || 0)
    + (disease.evidenceGroupCounts["Gene Ontology annotations"] || 0);
  const signalCount = (disease.evidenceGroupCounts["Anatomy signals"] || 0)
    + (disease.evidenceGroupCounts["Presentation signals"] || 0)
    + (disease.evidenceGroupCounts["Disease similarity"] || 0)
    + (disease.evidenceGroupCounts["Expression changes"] || 0);

  els.briefBoard.innerHTML = `
    <section class="brief-hero">
      <div>
        <span class="section-label"><span>Triage brief</span><span>${Number(Object.values(disease.evidenceGroupCounts).reduce((sum, value) => sum + value, 0)).toLocaleString()} claims</span></span>
        <h2>${escapeHtml(state.disease)}</h2>
        <p>A practical workup for researchers and builders: inspect candidate genes, treatment links, mechanism context, and exploratory signals without losing the source trail.</p>
      </div>
      <div class="brief-scorecard">
        ${metric("Curated / annotation claims", curatedCount)}
        ${metric("Exploratory signals", signalCount)}
      </div>
    </section>
    <section class="insight-grid">
      ${insightCards.map(renderInsightCard).join("")}
    </section>
    <section class="brief-grid">
      ${briefSection("Genes to inspect", "Disease-gene associations and expression signals that are worth opening first.", genes, "target")}
      ${briefSection("Treatments", "Treating and palliative compounds linked to this disease packet.", treatments, "source")}
      ${briefSection("Mechanism context", "Pathways and annotations connected through selected genes.", pathways, "target")}
      ${briefSection("Signals, not facts", "Presentation and anatomy cooccurrence signals. Useful for exploration, not clinical assertions.", [...symptoms, ...anatomy].slice(0, 8), "target")}
    </section>
    <section class="brief-next">
      <strong>Useful workflow</strong>
      <span>Use this as a first-pass evidence brief: start with a gene or treatment, open it in the inspector, then use Evidence to audit the source rows. Use Compare to find genes shared across diseases.</span>
    </section>
  `;

  els.briefBoard.querySelectorAll("[data-brief-node-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNodeId = button.dataset.briefNodeId;
      state.selectedEdgeId = null;
      renderInspector();
    });
  });
  els.briefBoard.querySelectorAll("[data-insight-node-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedNodeId = button.dataset.insightNodeId;
      state.selectedEdgeId = null;
      renderInspector();
    });
  });
  els.briefBoard.querySelectorAll("[data-insight-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.insightMode));
  });
}

function briefSection(title, description, edges, side) {
  return `
    <article class="brief-section">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      <div class="brief-list">
        ${edges.length ? edges.map((item) => briefItem(item, side)).join("") : `<span class="empty-state">No rows in this packet.</span>`}
      </div>
    </article>
  `;
}

function briefItem(item, side) {
  const id = side === "source" ? item.source : item.target;
  const name = side === "source" ? item.sourceName : item.targetName;
  return `
    <button class="brief-item" type="button" data-brief-node-id="${escapeHtml(id)}">
      <span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(claimPlainLabel(item))}</small>
      </span>
      <span class="chip-row">
        ${qualityChip(item)}
        ${item.log2FoldChange !== null && item.log2FoldChange !== undefined ? `<span class="source-chip">log2 ${Number(item.log2FoldChange).toFixed(3)}</span>` : ""}
        ${sourceChips(item.sourceNames, false)}
      </span>
    </button>
  `;
}

function runQuest(id) {
  const quest = state.data.quests.find((item) => item.id === id);
  if (!quest) {
    return;
  }
  if (quest.action.type === "mode") {
    setMode(quest.action.value);
  }
  if (quest.action.type === "search") {
    els.searchInput.value = quest.action.value;
    setSearch(quest.action.value);
  }
  if (quest.action.type === "path") {
    setMode("explore");
    setDisease(quest.action.value[0]);
    els.searchInput.value = quest.action.value[1];
    setSearch(quest.action.value[1]);
  }
}

function renderCompare() {
  const sharedById = new Set(
    state.data.nodes
      .filter((item) => item.appearsIn.length > 1 && item.kind !== "disease")
      .map((item) => item.id)
  );
  const geneBridges = sharedGeneBridges();

  els.compareBoard.innerHTML = `
    <article class="shared-gene-panel">
      <div class="section-label"><span>Shared gene bridges</span><span>${geneBridges.length}</span></div>
      <h2>Genes that connect multiple disease packets</h2>
      <p>These are the clearest cross-disease entry points. “Direct” means disease-gene association evidence; “expression” means differential-expression evidence in disease data.</p>
      <div class="shared-gene-grid">
        ${geneBridges.slice(0, 10).map(sharedGeneCard).join("")}
      </div>
    </article>
    ${state.data.diseases
    .map((disease) => {
      const nodes = getDiseaseNodes(disease.name);
      const genes = nodes.filter((item) => item.kind === "gene").slice(0, 8);
      const drugs = nodes.filter((item) => item.kind === "drug").slice(0, 8);
      const pathways = nodes
        .filter((item) => item.kind === "pathway" || item.kind === "go-term")
        .slice(0, 8);
      return `
        <article class="compare-lane">
          <span class="status-pill" data-tone="${escapeHtml(disease.status.tone)}">${escapeHtml(disease.status.label)}</span>
          <h2>${escapeHtml(disease.name)}</h2>
          <div class="lane-grid">
            ${laneCluster("Genes", genes, sharedById)}
            ${laneCluster("Treatments", drugs, sharedById)}
            ${laneCluster("Mechanisms", pathways, sharedById)}
          </div>
        </article>
      `;
    })
    .join("")}
  `;

  els.compareBoard.querySelectorAll("[data-node-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedNodeId = row.dataset.nodeId;
      state.selectedEdgeId = null;
      renderInspector();
      rebuildCanvasGraph();
    });
  });
  els.compareBoard.querySelectorAll("[data-shared-gene-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedNodeId = row.dataset.sharedGeneId;
      state.selectedEdgeId = null;
      renderInspector();
      rebuildCanvasGraph();
    });
  });
}

function sharedGeneBridges() {
  return state.data.nodes
    .filter((item) => item.kind === "gene")
    .map((gene) => {
      const edges = state.data.edges.filter((edge) => edge.source === gene.id || edge.target === gene.id);
      const diseaseNames = [...new Set(edges.map((edge) => edge.disease))].sort();
      const direct = edges.filter((edge) => edge.type === "associatedGenes").length;
      const expression = edges.filter((edge) => edge.type === "upregulatedGenes" || edge.type === "downregulatedGenes").length;
      return {
        gene,
        diseaseNames,
        diseaseCount: diseaseNames.length,
        claimCount: edges.length,
        direct,
        expression,
      };
    })
    .filter((item) => item.diseaseCount > 1)
    .sort((left, right) => right.diseaseCount - left.diseaseCount
      || right.direct - left.direct
      || right.expression - left.expression
      || right.claimCount - left.claimCount
      || left.gene.name.localeCompare(right.gene.name));
}

function sharedGeneCard(item) {
  return `
    <button class="shared-gene-card" type="button" data-shared-gene-id="${escapeHtml(item.gene.id)}">
      <span class="shared-gene-name">${escapeHtml(item.gene.name)}</span>
      <span class="chip-row">
        <span class="source-chip">${item.diseaseCount} diseases</span>
        <span class="source-chip">${item.direct} direct</span>
        <span class="source-chip">${item.expression} expression</span>
      </span>
      <span class="shared-gene-diseases">${escapeHtml(item.diseaseNames.join(" · "))}</span>
    </button>
  `;
}

function laneCluster(label, nodes, sharedById) {
  return `
    <div class="lane-cluster">
      <h3>${escapeHtml(label)}</h3>
      ${nodes
        .map((item) => {
          const shared = sharedById.has(item.id);
          return `
            <button class="node-row" type="button" data-node-id="${escapeHtml(item.id)}" data-shared="${shared}">
              <span>${escapeHtml(item.name)}</span>
              <small>${shared ? "shared" : KIND_LABEL[item.kind]}</small>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderEvidence() {
  const groups = evidenceGroupsForDisease();
  const allEdges = getDiseaseEdges();
  const chips = [
    `<button class="filter-chip ${state.evidenceFilter === "all" ? "is-active" : ""}" type="button" data-filter="all">All</button>`,
    ...groups.map(
      (group) => `<button class="filter-chip ${state.evidenceFilter === group ? "is-active" : ""}" type="button" data-filter="${escapeHtml(group)}">${escapeHtml(evidenceGroupLabel(group))}</button>`
    ),
  ];
  els.evidenceToolbar.innerHTML = `
    <div class="panel-intro compact-intro">
      <span class="section-label"><span>Evidence for ${escapeHtml(state.disease)}</span><span>${allEdges.length}</span></span>
      <p>Each row is a source-backed graph claim. Curated facts, database annotations, expression changes, and cooccurrence signals are deliberately kept as different evidence families.</p>
    </div>
    <div class="filter-row">${chips.join("")}</div>
  `;
  els.evidenceToolbar.querySelectorAll(".filter-chip").forEach((button) => {
    button.addEventListener("click", () => {
      state.evidenceFilter = button.dataset.filter;
      renderEvidence();
      rebuildCanvasGraph();
    });
  });

  const edges = getDiseaseEdges().filter((item) => {
    const byType = state.evidenceFilter === "all" || (item.evidenceGroup || item.type) === state.evidenceFilter;
    const bySearch = state.evidenceFilter !== "all" || !state.search || edgeMatchesSearch(item);
    return byType && bySearch;
  });

  els.evidenceList.innerHTML = edges.length
    ? edges
      .map(
        (item) => `
          <button class="edge-row" type="button" data-edge-id="${escapeHtml(item.id)}">
            <span class="edge-main">
              <strong>${escapeHtml(claimSentence(item))}</strong>
              <span class="mini-pill">${escapeHtml(claimPlainLabel(item))}</span>
            </span>
            <span class="chip-row">
              ${qualityChip(item)}
              <span class="source-chip">${escapeHtml(item.evidenceGroup || item.type)}</span>
              ${sourceChips(item.sourceNames, false)}
              ${item.log2FoldChange !== null && item.log2FoldChange !== undefined ? `<span class="source-chip">log2 ${Number(item.log2FoldChange).toFixed(3)}</span>` : ""}
            </span>
            <span class="claim-explainer">${escapeHtml(claimExplanation(item))}</span>
          </button>
        `
      )
      .join("")
    : `<p class="empty-state">No evidence rows match the current filter.</p>`;

  els.evidenceList.querySelectorAll("[data-edge-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedEdgeId = button.dataset.edgeId;
      const item = edge(state.selectedEdgeId);
      state.selectedNodeId = item?.source || null;
      renderInspector();
      rebuildCanvasGraph();
    });
  });
}

function renderHeldReview() {
  const disease = diseaseByName(state.disease);
  els.evidenceList.innerHTML = disease.heldForReview
    .map(
      (layer) => `
        <article class="review-row">
          <span class="edge-main">
            <strong>${escapeHtml(layer.label)}</strong>
            <span class="mini-pill">${Number(layer.count).toLocaleString()}</span>
          </span>
          <p>${escapeHtml(layer.reason)}</p>
        </article>
      `
    )
    .join("");
}

function sourceRecord(nameOrId) {
  if (!nameOrId) {
    return null;
  }
  return state.sourceMap.get(nameOrId)
    || state.data.sources.find((source) => source.name === nameOrId)
    || null;
}

function sourceChips(names = [], linked = true) {
  const unique = [...new Set(names.filter(Boolean))];
  return unique.length
    ? unique.map((name) => {
      const source = sourceRecord(name);
      if (linked && source?.website) {
        return `<a class="source-chip" href="${escapeHtml(source.website)}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>`;
      }
      return `<span class="source-chip">${escapeHtml(name)}</span>`;
    }).join("")
    : `<span class="source-chip">Source pending</span>`;
}

function renderSources() {
  const sourceClaimCounts = new Map();
  for (const item of state.data.edges) {
    for (const sid of item.sourceIds || []) {
      sourceClaimCounts.set(sid, (sourceClaimCounts.get(sid) || 0) + 1);
    }
  }

  const sources = state.data.sources
    .filter((source) => !state.search || [
      source.name,
      source.type,
      source.description,
      source.sourceDatabaseIdentifier,
      source.doi,
      source.license,
    ].join(" ").toLowerCase().includes(state.search.toLowerCase()))
    .sort((left, right) => (sourceClaimCounts.get(right.id) || 0) - (sourceClaimCounts.get(left.id) || 0)
      || left.name.localeCompare(right.name));

  els.sourceBoard.innerHTML = `
    <div class="source-hero panel-intro">
      <span class="section-label"><span>Source-backed graph</span><span>${Number(state.data.meta.summary.claimCount).toLocaleString()} claims</span></span>
      <h2>${Number(state.data.meta.summary.diseaseCount).toLocaleString()} diseases, ${Number(state.data.meta.summary.nodeCount).toLocaleString()} graph objects, ${Number(state.data.meta.summary.sourceCount).toLocaleString()} sources</h2>
      <p>Use this panel to jump from a claim back to the source dataset, paper, ontology, or external identifier that supports it.</p>
    </div>
    <div class="source-grid">
      ${sources.map((source) => sourceCard(source, sourceClaimCounts.get(source.id) || source.claimCount || 0)).join("")}
    </div>
    <div class="paper-strip">
      <div class="section-label"><span>Papers</span><span>${state.data.papers.length}</span></div>
      ${state.data.papers.map((paper) => paperCard(paper)).join("")}
    </div>
  `;
}

function sourceCard(source, claimCount) {
  const links = [
    source.website ? { label: "Open source", href: source.website } : null,
    source.doi ? { label: "DOI", href: `https://doi.org/${source.doi}` } : null,
  ].filter(Boolean);
  return `
    <article class="source-card">
      <div class="source-card-main">
        <h3>${escapeHtml(source.name)}</h3>
        <p>${escapeHtml(source.description || "Source metadata for Disease Atlas claims.")}</p>
      </div>
      <span class="chip-row source-meta-row">
        <span class="mini-pill">${escapeHtml(source.type || "Source")}</span>
        <span class="mini-pill">${Number(claimCount).toLocaleString()} claims</span>
        ${source.sourceDatabaseIdentifier ? `<span class="source-chip">${escapeHtml(source.sourceDatabaseIdentifier)}</span>` : ""}
        ${source.license ? `<span class="source-chip">${escapeHtml(source.license)}</span>` : ""}
      </span>
      ${links.length ? `<div class="link-list">${links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}</div>` : ""}
    </article>
  `;
}

function paperCard(paper) {
  const links = [
    paper.website ? { label: "Read paper", href: paper.website } : null,
    paper.doi ? { label: "DOI", href: `https://doi.org/${paper.doi}` } : null,
    paper.pmid ? { label: "PubMed", href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(paper.pmid)}/` } : null,
  ].filter(Boolean);
  return `
    <article class="paper-card">
      <h3>${escapeHtml(paper.name)}</h3>
      <p>${escapeHtml(paper.description || "")}</p>
      <div class="chip-row">
        ${paper.publishDate ? `<span class="mini-pill">${escapeHtml(paper.publishDate.slice(0, 10))}</span>` : ""}
        ${paper.sources?.length ? sourceChips(paper.sources) : ""}
      </div>
      ${links.length ? `<div class="link-list">${links.map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}</div>` : ""}
    </article>
  `;
}

function renderInspector() {
  if (state.selectedEdgeId) {
    const item = edge(state.selectedEdgeId);
    if (item) {
      const quality = evidenceQuality(item);
      const geoLinks = geoLinksForEdge(item);
      els.inspectorContent.innerHTML = `
        <div class="detail-stack">
          <span class="kind-chip" data-kind="${escapeHtml(node(item.source)?.kind || "disease")}">${escapeHtml(claimPlainLabel(item))}</span>
          <h2>${escapeHtml(claimSentence(item))}</h2>
          <p>${escapeHtml(claimExplanation(item))}</p>
          <div class="chip-row">
            ${qualityChip(item)}
            <span class="source-chip">${escapeHtml(item.evidenceGroup || "Evidence")}</span>
            ${item.log2FoldChange !== null && item.log2FoldChange !== undefined ? `<span class="source-chip">log2 fold-change ${Number(item.log2FoldChange).toFixed(4)}</span>` : ""}
            ${item.license ? `<span class="source-chip">${escapeHtml(item.license)}</span>` : ""}
          </div>
        </div>
        <div class="plain-explainer">
          <strong>${escapeHtml(quality.label)}</strong>
          <span>${escapeHtml(quality.explanation)} This is an edge in the graph: source object -> relationship -> target object.</span>
        </div>
        <div class="detail-stack">
          <div class="section-label"><span>Continue in Geo</span><span>${geoLinks.length}</span></div>
          ${renderLinkList(geoLinks, "link-list geo-link-list")}
        </div>
        <div class="detail-stack">
          <div class="section-label"><span>Sources</span><span>${item.sourceNames?.length || 0}</span></div>
          <div class="chip-row">${sourceChips(item.sourceNames)}</div>
        </div>
      `;
      return;
    }
  }

  const selectedDefaultDisease = !state.selectedEdgeId && state.selectedNodeId === diseaseNodeId(state.disease);
  if (["brief", "evidence", "sources"].includes(state.mode) && selectedDefaultDisease) {
    const disease = diseaseByName(state.disease);
    const edges = getDiseaseEdges();
    const groups = evidenceGroupsForDisease();
    const qualityCounts = evidenceQualityCounts();
    const guideTitle = state.mode === "brief"
      ? "Use Insights as a disease workup"
      : state.mode === "evidence"
        ? "Inspect claims in the center panel"
        : "Inspect provenance in the center panel";
    const guideText = state.mode === "brief"
      ? "The center panel is built for a researcher or builder doing first-pass triage: click a gene, treatment, or signal to inspect identifiers, source links, and connected evidence."
      : state.mode === "evidence"
        ? "Use the filters to separate curated treatment claims, database annotations, expression changes, and exploratory cooccurrence signals. Click any evidence row to see its sources here."
        : "Use the source list to open datasets, ontologies, papers, and external identifiers. Source records tell you where claims and annotations come from.";
    const modeGeoLinks = uniqueLinks([
      { label: `Open ${state.disease} in Geo`, href: geoUrlForDiseaseName(state.disease) },
      { label: "Open Geo Space", href: geoSpaceUrl() },
    ]);
    els.inspectorContent.innerHTML = `
      <div class="detail-stack mode-guide">
        <span class="kind-chip" data-kind="disease">${escapeHtml(`${modeLabel(state.mode)} mode`)}</span>
        <h2>${escapeHtml(guideTitle)}</h2>
        <p>${escapeHtml(guideText)}</p>
      </div>
      <div class="metric-grid compact-metrics">
        ${metric("Disease claims", edges.length)}
        ${metric("Evidence families", groups.length)}
        ${metric("Curated / context", (qualityCounts.strong || 0) + (qualityCounts.moderate || 0) + (qualityCounts.context || 0))}
        ${metric("Exploratory", qualityCounts.exploratory || 0)}
      </div>
      <div class="plain-explainer">
        <strong>Why this matters</strong>
        <span>The atlas is useful only if claims remain traceable. The center panel is the audit trail; this drawer shows detail once you select a row.</span>
      </div>
      <div class="detail-stack">
        <div class="section-label"><span>Continue in Geo</span><span>${modeGeoLinks.length}</span></div>
        ${renderLinkList(modeGeoLinks, "link-list geo-link-list")}
      </div>
    `;
    return;
  }

  const item = node(state.selectedNodeId) || node(diseaseNodeId(state.disease));
  if (!item) {
    els.inspectorContent.innerHTML = `<p class="empty-state">Select a node to inspect it.</p>`;
    return;
  }

  const relatedScope = state.mode === "compare" && item.kind === "gene"
    ? state.data.edges
    : getDiseaseEdges();
  const related = relatedScope.filter(
    (edge) => edge.source === item.id || edge.target === item.id
  );
  const context = nodeContext(item);
  const identifiers = Object.entries(item.identifiers || {});
  const links = nodeLinks(item);
  const geoLinks = geoLinksForItem(item);
  const contextLabel = state.mode === "compare" && item.kind === "gene"
    ? "Cross-disease context"
    : `${state.disease} context`;
  els.inspectorContent.innerHTML = `
    <div class="detail-stack">
      <span class="kind-chip" data-kind="${escapeHtml(item.kind)}">${escapeHtml(KIND_LABEL[item.kind] || item.kind)}</span>
      <h2>${escapeHtml(item.name)}</h2>
      <p>${escapeHtml(context.summary)}</p>
      <div class="chip-row">
        ${item.appearsIn.map((name) => `<span class="source-chip">${escapeHtml(name)}</span>`).join("")}
      </div>
    </div>
    ${context.highlights.length ? `
      <div class="detail-stack">
        <div class="section-label"><span>${escapeHtml(contextLabel)}</span><span>${context.edgeCount}</span></div>
        <div class="chip-row">
          ${context.highlights.map((text) => `<span class="source-chip">${escapeHtml(text)}</span>`).join("")}
        </div>
      </div>
    ` : ""}
    ${identifiers.length ? `
      <div class="detail-stack">
        <div class="section-label"><span>Identifiers</span><span>${identifiers.length}</span></div>
        <div class="chip-row">
          ${identifiers.map(([key, value]) => `<span class="mini-pill">${escapeHtml(key)}: ${escapeHtml(value)}</span>`).join("")}
        </div>
      </div>
    ` : ""}
    ${renderLinkList(geoLinks, "link-list geo-link-list")}
    ${renderLinkList(links)}
    ${item.sources?.length ? `
      <div class="detail-stack">
        <div class="section-label"><span>Sources</span><span>${item.sources.length}</span></div>
        <div class="chip-row">${sourceChips(item.sources)}</div>
      </div>
    ` : ""}
    <div class="detail-stack edge-stack">
      <div class="section-label"><span>Edges</span><span>${related.length}</span></div>
      <div class="inspector-edge-list">
        ${related.map((rel) => `
          <button class="node-row" type="button" data-edge-id="${escapeHtml(rel.id)}">
            <span>${escapeHtml(claimSentence(rel))}</span>
            <small>${escapeHtml(claimPlainLabel(rel))}</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  els.inspectorContent.querySelectorAll("[data-edge-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedEdgeId = button.dataset.edgeId;
      renderInspector();
      rebuildCanvasGraph();
    });
  });
}

function nodeLinks(item) {
  const links = [];
  if (item.website) {
    links.push({ label: "Source page", href: item.website });
  }
  const ids = item.identifiers || {};
  const geneId = ids.entrezGeneId || (item.kind === "gene" ? ids.externalId : null);
  if (geneId && /^\d+$/.test(String(geneId))) {
    links.push({
      label: "NCBI Gene",
      href: `https://www.ncbi.nlm.nih.gov/gene/${encodeURIComponent(geneId)}`,
    });
  }
  if (ids.drugBankId) {
    links.push({
      label: "DrugBank",
      href: `https://go.drugbank.com/drugs/${encodeURIComponent(ids.drugBankId)}`,
    });
  }
  if (ids.goId) {
    links.push({
      label: "Gene Ontology",
      href: `https://amigo.geneontology.org/amigo/term/${encodeURIComponent(ids.goId)}`,
    });
  }
  if (ids.diseaseOntologyId || (item.kind === "disease" && ids.externalId?.startsWith("DOID:"))) {
    const doid = ids.diseaseOntologyId || ids.externalId;
    links.push({
      label: "Disease Ontology",
      href: `http://purl.obolibrary.org/obo/${encodeURIComponent(doid.replace(":", "_"))}`,
    });
  }
  const sourceId = ids.sourceDatabaseIdentifier || ids.externalId;
  if (item.kind === "symptom" && sourceId) {
    links.push({
      label: "MeSH",
      href: `https://meshb.nlm.nih.gov/record/ui?ui=${encodeURIComponent(String(sourceId).replace("MESH:", ""))}`,
    });
  }
  if (item.kind === "anatomy" && String(sourceId || "").startsWith("UBERON:")) {
    links.push({
      label: "Uberon",
      href: `http://purl.obolibrary.org/obo/${encodeURIComponent(String(sourceId).replace(":", "_"))}`,
    });
  }
  return links;
}

function renderMode() {
  if (state.mode === "brief") {
    renderBrief();
  }
  if (state.mode === "explore") {
    renderExploreBrowser();
  }
  if (state.mode === "compare") {
    renderCompare();
  }
  if (state.mode === "evidence") {
    renderEvidence();
  }
  if (state.mode === "sources") {
    renderSources();
  }
  renderLegend();
}

function renderAll() {
  renderTopbarGeoLinks();
  renderMetrics();
  renderQuests();
  renderMode();
  renderInspector();
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function nearestNode(pos) {
  let closest = null;
  let closestDistance = Infinity;
  for (const item of state.graphNodes) {
    const layout = state.layout.get(item.id);
    if (!layout) {
      continue;
    }
    const distance = Math.hypot(pos.x - layout.x, pos.y - layout.y);
    if (distance < layout.radius + 12 && distance < closestDistance) {
      closest = item.id;
      closestDistance = distance;
    }
  }
  return closest;
}

function bindEvents() {
  els.diseaseSelect.addEventListener("change", () => setDisease(els.diseaseSelect.value));
  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  els.searchInput.addEventListener("input", () => setSearch(els.searchInput.value));
  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      els.searchInput.value = "";
      setSearch("");
    }
  });
  els.motionToggle.addEventListener("click", () => {
    state.motion = !state.motion;
    renderMotionControl();
    startAnimation();
  });
  els.resetFocus.addEventListener("click", () => {
    state.selectedEdgeId = null;
    state.selectedNodeId = diseaseNodeId(state.disease);
    state.search = "";
    els.searchInput.value = "";
    renderAll();
    rebuildCanvasGraph();
  });

  canvas.addEventListener("pointermove", (event) => {
    const hovered = nearestNode(pointerPosition(event));
    if (hovered !== state.pointerNodeId) {
      state.pointerNodeId = hovered;
      canvas.style.cursor = hovered ? "pointer" : "default";
      if (!state.motion) {
        drawFrame(performance.now());
      }
    }
  });
  canvas.addEventListener("click", (event) => {
    const clicked = nearestNode(pointerPosition(event));
    if (clicked) {
      state.selectedNodeId = clicked;
      state.selectedEdgeId = null;
      renderInspector();
      rebuildCanvasGraph();
    }
  });
  window.addEventListener("resize", resizeCanvas);
}

async function init() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Could not load ${DATA_URL}`);
  }
  state.data = await response.json();
  state.nodeMap = byId(state.data.nodes);
  state.edgeMap = byId(state.data.edges);
  state.sourceMap = byId(state.data.sources || []);
  state.disease = state.data.diseases[0].name;
  state.selectedNodeId = diseaseNodeId(state.disease);
  canvas.dataset.mode = state.mode;

  els.diseaseSelect.innerHTML = state.data.diseases
    .map((disease) => `<option value="${escapeHtml(disease.name)}">${escapeHtml(disease.name)}</option>`)
    .join("");
  els.diseaseSelect.value = state.disease;
  renderMotionControl();

  bindEvents();
  renderAll();
  resizeCanvas();
  const requestedMode = URL_PARAMS.get("mode") === "insights" ? "brief" : URL_PARAMS.get("mode");
  if (["brief", "explore", "compare", "evidence", "sources"].includes(requestedMode)) {
    setMode(requestedMode);
  }
  startAnimation();
}

init().catch((error) => {
  console.error(error);
  els.inspectorContent.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
