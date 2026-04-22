from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASTHMA_PACKET_JSON = ROOT / "data/geo/asthma-packet.json"
ASTHMA_ENRICHMENT_JSON = ROOT / "data/geo/asthma-enrichment.json"
WAVE2_PACKET_JSON = ROOT / "data/geo/disease-wave2-packets.json"
THREE_DISEASE_EVIDENCE_JSON = ROOT / "data/geo/three-disease-evidence.json"
WAVE3_PACKET_JSON = ROOT / "data/geo/disease-wave3-packets.json"
OUTPUT_JSON = ROOT / "site/data/atlas-dashboard.json"

GEO_SPACE_URL = "https://www.geobrowser.io/space/141d3ace705feabc04d50c78bbf7226e"
DISEASE_ORDER = [
    "Asthma",
    "Psoriasis",
    "Rheumatoid arthritis",
    "Breast cancer",
    "Hypertension",
    "Type 2 diabetes mellitus",
    "Alzheimer's disease",
    "Crohn's disease",
]

PUBLIC_SOURCE_NAMES = {
    "Hetionet v1.0": "Integrated source graph",
}

SOURCE_FALLBACKS = {
    "Disease Ontology": {
        "website": "https://disease-ontology.org/",
        "description": "Disease names and Disease Ontology identifiers.",
    },
    "DISEASES": {
        "website": "https://diseases.jensenlab.org/",
        "description": "Disease-gene association evidence.",
    },
    "DisGeNET": {
        "website": "https://www.disgenet.org/",
        "description": "Human gene-disease association evidence.",
    },
    "DOAF": {
        "website": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3519466/",
        "description": "Disease Ontology Annotation Framework disease-gene source.",
    },
    "DrugBank": {
        "website": "https://go.drugbank.com/",
        "description": "Drug identifiers, chemistry, and drug metadata.",
    },
    "DrugCentral": {
        "website": "https://drugcentral.org/",
        "description": "Drug class and pharmacology source.",
    },
    "Entrez Gene": {
        "website": "https://www.ncbi.nlm.nih.gov/gene/",
        "description": "NCBI gene identifiers and names.",
    },
    "Gene Ontology": {
        "website": "https://geneontology.org/",
        "description": "Biological process, molecular function, and cellular component terms.",
    },
    "GWAS Catalog": {
        "website": "https://www.ebi.ac.uk/gwas/",
        "description": "Genome-wide association evidence.",
    },
    "MEDLINE cooccurrence": {
        "website": "https://pubmed.ncbi.nlm.nih.gov/",
        "description": "Literature cooccurrence signals used as evidence, not clinical assertions.",
    },
    "MeSH": {
        "website": "https://www.ncbi.nlm.nih.gov/mesh/",
        "description": "Medical Subject Headings vocabulary.",
    },
    "NCBI gene2go": {
        "website": "https://www.ncbi.nlm.nih.gov/gene/",
        "description": "Gene-to-Gene Ontology annotations.",
    },
    "Pathway Commons": {
        "website": "https://www.pathwaycommons.org/",
        "description": "Integrated pathway source.",
    },
    "Pathway Interaction Database": {
        "website": "https://wiki.nci.nih.gov/display/pid/PID+Wiki",
        "description": "Pathway interaction source.",
    },
    "PharmacotherapyDB": {
        "website": "https://github.com/dhimmel/indications",
        "description": "Curated drug indication evidence.",
    },
    "Reactome": {
        "website": "https://reactome.org/",
        "description": "Curated biological pathways.",
    },
    "STARGEO": {
        "website": "https://stargeo.org/",
        "description": "Disease-gene expression evidence.",
    },
    "Uberon": {
        "website": "https://uberon.github.io/",
        "description": "Cross-species anatomy ontology.",
    },
    "WikiPathways": {
        "website": "https://www.wikipathways.org/",
        "description": "Community-curated pathway source.",
    },
    "Integrated source graph": {
        "website": "https://github.com/hetio/hetionet",
        "description": "Integrated biomedical graph used to align source datasets into one reusable model.",
    },
}

ENTITY_BUCKETS = {
    "genes": ("gene", "Genes"),
    "expressionGenes": ("gene", "Expression genes"),
    "drugs": ("drug", "Treating drugs"),
    "palliativeDrugs": ("drug", "Palliative drugs"),
    "drugClasses": ("drug-class", "Drug classes"),
    "pathways": ("pathway", "Pathways"),
    "biologicalProcesses": ("go-term", "Biological process"),
    "molecularFunctions": ("go-term", "Molecular function"),
    "cellularComponents": ("go-term", "Cellular component"),
    "symptoms": ("symptom", "Presentation signals"),
    "anatomy": ("anatomy", "Anatomy signals"),
    "similarDiseases": ("disease", "Similar diseases"),
}

GO_BUCKETS = {"biologicalProcesses", "molecularFunctions", "cellularComponents"}

RELATION_SPECS = {
    "associatedGenes": {
        "label": "Associated with",
        "sourceKind": "disease",
        "targetKind": "gene",
        "group": "Disease gene associations",
        "category": "curated disease-gene association",
    },
    "treats": {
        "label": "Treats",
        "sourceKind": "drug",
        "targetKind": "disease",
        "group": "Treatments",
        "category": "curated treatment indication",
    },
    "palliates": {
        "label": "Palliates",
        "sourceKind": "drug",
        "targetKind": "disease",
        "group": "Treatments",
        "category": "curated palliative indication",
    },
    "includesDrug": {
        "label": "Includes",
        "sourceKind": "drug-class",
        "targetKind": "drug",
        "group": "Drug classes",
        "category": "pharmacologic class membership",
    },
    "participatesInPathway": {
        "label": "Participates in pathway",
        "sourceKind": "gene",
        "targetKind": "pathway",
        "group": "Pathway annotations",
        "category": "pathway annotation",
    },
    "participatesInBiologicalProcess": {
        "label": "Participates in biological process",
        "sourceKind": "gene",
        "targetKind": "go-term",
        "group": "Gene Ontology annotations",
        "category": "gene ontology annotation",
    },
    "hasMolecularFunction": {
        "label": "Has molecular function",
        "sourceKind": "gene",
        "targetKind": "go-term",
        "group": "Gene Ontology annotations",
        "category": "gene ontology annotation",
    },
    "locatedInCellularComponent": {
        "label": "Located in cellular component",
        "sourceKind": "gene",
        "targetKind": "go-term",
        "group": "Gene Ontology annotations",
        "category": "gene ontology annotation",
    },
    "symptomEvidence": {
        "label": "Presents with",
        "sourceKind": "disease",
        "targetKind": "symptom",
        "group": "Presentation signals",
        "category": "literature cooccurrence signal",
    },
    "anatomyEvidence": {
        "label": "Localizes to",
        "sourceKind": "disease",
        "targetKind": "anatomy",
        "group": "Anatomy signals",
        "category": "literature cooccurrence signal",
    },
    "diseaseSimilarityEvidence": {
        "label": "Resembles",
        "sourceKind": "disease",
        "targetKind": "disease",
        "group": "Disease similarity",
        "category": "literature similarity signal",
    },
    "upregulatedGenes": {
        "label": "Upregulates",
        "sourceKind": "disease",
        "targetKind": "gene",
        "group": "Expression changes",
        "category": "disease-gene expression",
    },
    "downregulatedGenes": {
        "label": "Downregulates",
        "sourceKind": "disease",
        "targetKind": "gene",
        "group": "Expression changes",
        "category": "disease-gene expression",
    },
}


def load_json(path: Path) -> dict:
    with path.open() as handle:
        return json.load(handle)


def slug(value: str) -> str:
    clean = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return clean or "unknown"


def public_source_name(name: str | None) -> str | None:
    if not name:
        return None
    return PUBLIC_SOURCE_NAMES.get(name, name)


def public_text(value: str | None) -> str | None:
    if not value:
        return value
    return (
        value.replace("Hetionet v1.0", "the integrated source graph")
        .replace("Hetionet", "the integrated source graph")
        .replace("hetionet", "integrated-source-graph")
    )


def node_id(kind: str, name: str) -> str:
    return f"{kind}:{slug(name)}"


def source_id(name: str) -> str:
    return f"source:{slug(name)}"


def paper_id(name: str) -> str:
    return f"paper:{slug(name)}"


def entity_identifiers(entity: dict) -> dict:
    return {
        "externalId": entity.get("externalId"),
        "entrezGeneId": entity.get("entrezGeneId"),
        "drugBankId": entity.get("drugBankId"),
        "diseaseOntologyId": entity.get("diseaseOntologyId"),
        "goId": entity.get("goId") or entity.get("externalId")
        if str(entity.get("externalId", "")).startswith("GO:")
        else entity.get("goId"),
        "sourceDatabaseIdentifier": entity.get("sourceDatabaseIdentifier"),
        "inchikey": entity.get("inchikey"),
    }


def clean_identifiers(identifiers: dict) -> dict:
    return {key: str(value) for key, value in identifiers.items() if value}


def source_names_from_record(record: dict) -> list[str]:
    names = []
    if record.get("sourceNames"):
        names.extend(record["sourceNames"])
    if record.get("sourceFamily"):
        names.extend(
            part.strip()
            for part in str(record["sourceFamily"]).split(";")
            if part.strip()
        )
    if record.get("primarySource"):
        names.append(record["primarySource"])
    if record.get("source"):
        names.append(record["source"])
    if record.get("sources"):
        names.extend(record["sources"])

    seen = set()
    public_names = []
    for name in names:
        public = public_source_name(name)
        if public and public not in seen:
            seen.add(public)
            public_names.append(public)
    return public_names


def merge_source(sources: dict, record: dict | str) -> str | None:
    if isinstance(record, str):
        name = public_source_name(record)
        record = {"name": name}
    else:
        name = public_source_name(record.get("name"))

    if not name:
        return None

    sid = source_id(name)
    fallback = SOURCE_FALLBACKS.get(name, {})
    existing = sources.setdefault(
        sid,
        {
            "id": sid,
            "name": name,
            "type": record.get("type") or fallback.get("type") or "Source",
            "description": public_text(record.get("description"))
            or fallback.get("description"),
            "website": record.get("website") or fallback.get("website"),
            "sourceDatabaseIdentifier": public_text(record.get("sourceDatabaseIdentifier")),
            "version": record.get("version"),
            "doi": record.get("doi"),
            "license": public_text(record.get("license")),
            "sources": [],
            "claimCount": 0,
        },
    )

    for key in [
        "type",
        "description",
        "website",
        "sourceDatabaseIdentifier",
        "version",
        "doi",
        "license",
    ]:
        value = record.get(key)
        if key in {"description", "license", "sourceDatabaseIdentifier"}:
            value = public_text(value)
        if value and not existing.get(key):
            existing[key] = value

    for source_name in source_names_from_record(record):
        if source_name != name and source_name not in existing["sources"]:
            existing["sources"].append(source_name)
    return sid


def merge_paper(papers: dict, record: dict) -> str | None:
    name = record.get("name")
    if not name:
        return None
    pid = paper_id(name)
    existing = papers.setdefault(
        pid,
        {
            "id": pid,
            "name": name,
            "type": "Paper",
            "description": public_text(record.get("description")),
            "website": record.get("website"),
            "doi": record.get("doi"),
            "pmid": record.get("pmid"),
            "publishDate": record.get("publishDate"),
            "sources": [],
            "claimCount": 0,
        },
    )
    for key in ["description", "website", "doi", "pmid", "publishDate"]:
        value = record.get(key)
        if key == "description":
            value = public_text(value)
        if value and not existing.get(key):
            existing[key] = value
    for source_name in source_names_from_record(record):
        if source_name not in existing["sources"]:
            existing["sources"].append(source_name)
    return pid


def build_enrichment_index() -> dict[str, dict]:
    if not ASTHMA_ENRICHMENT_JSON.exists():
        return {}

    data = load_json(ASTHMA_ENRICHMENT_JSON)
    index = {}
    bucket_map = {
        "genes": "genes",
        "drugs": "drugs",
        "drugClasses": "drugClasses",
        "pathways": "pathways",
        "goTerms": "goTerms",
    }
    for bucket in bucket_map:
        for entity in data.get(bucket, []):
            index[entity["name"]] = entity
    if data.get("disease"):
        index[data["disease"]["name"]] = data["disease"]
    return index


def add_node(
    nodes: dict,
    kind: str,
    name: str,
    disease_name: str,
    sources: dict,
    group: str | None = None,
    entity: dict | None = None,
) -> str:
    entity = entity or {}
    nid = node_id(kind, name)
    source_names = source_names_from_record(entity)
    if entity.get("source"):
        source_names.append(public_source_name(entity.get("source")))
    source_names = [name for name in dict.fromkeys(source_names) if name]

    existing = nodes.setdefault(
        nid,
        {
            "id": nid,
            "name": name,
            "kind": kind,
            "groups": [],
            "appearsIn": [],
            "sources": [],
            "sourceIds": [],
            "identifiers": {},
            "description": None,
            "website": None,
            "license": None,
        },
    )

    if disease_name and disease_name not in existing["appearsIn"]:
        existing["appearsIn"].append(disease_name)
    if group and group not in existing["groups"]:
        existing["groups"].append(group)

    for source_name in source_names:
        sid = merge_source(sources, source_name)
        if source_name not in existing["sources"]:
            existing["sources"].append(source_name)
        if sid and sid not in existing["sourceIds"]:
            existing["sourceIds"].append(sid)

    identifiers = clean_identifiers(entity_identifiers(entity))
    for key, value in identifiers.items():
        existing["identifiers"].setdefault(key, value)

    for key in ["description", "website", "license"]:
        value = entity.get(key)
        if key in {"description", "license"}:
            value = public_text(value)
        if value and not existing.get(key):
            existing[key] = value

    return nid


def collect_top_level_sources_and_papers(
    sources: dict, papers: dict, *records: dict
) -> None:
    for data in records:
        for source in data.get("sources", []):
            merge_source(sources, source)
        for paper in data.get("papers", []):
            merge_paper(papers, paper)


def get_packets(*records: dict) -> list[dict]:
    packets = []
    for data in records:
        if data.get("packets"):
            packets.extend(data["packets"])
        elif data.get("disease") and data.get("relations"):
            packets.append(data)
    return packets


def merge_entity_with_enrichment(entity: dict, enrichment_index: dict) -> dict:
    enrichment = enrichment_index.get(entity.get("name"), {})
    return {**enrichment, **entity}


def edge_key(
    disease_name: str,
    relation_kind: str,
    source_name: str,
    target_name: str,
    relation: dict,
) -> str:
    if relation.get("hetionetEdgeId"):
        return relation["hetionetEdgeId"]
    return "|".join(
        [
            disease_name,
            relation_kind,
            source_name,
            target_name,
            relation.get("metaedge") or "",
        ]
    )


def add_edge(
    edges: dict,
    relation_kind: str,
    relation: dict,
    disease_name: str,
    nodes: dict,
    sources: dict,
    disease_stats: dict,
) -> None:
    spec = RELATION_SPECS[relation_kind]
    source_name = relation["from"]
    target_name = relation["to"]
    source_id_value = add_node(
        nodes,
        spec["sourceKind"],
        source_name,
        disease_name,
        sources,
    )
    target_id_value = add_node(
        nodes,
        spec["targetKind"],
        target_name,
        disease_name,
        sources,
    )

    source_names = source_names_from_record(relation)
    if not source_names and relation.get("primarySource"):
        source_names = [public_source_name(relation["primarySource"])]
    source_ids = [merge_source(sources, name) for name in source_names]
    source_ids = [sid for sid in source_ids if sid]
    for sid in source_ids:
        sources[sid]["claimCount"] += 1

    eid = f"edge:{slug(edge_key(disease_name, relation_kind, source_name, target_name, relation))}"
    if eid in edges:
        existing = edges[eid]
        for name in source_names:
            if name not in existing["sourceNames"]:
                existing["sourceNames"].append(name)
        for sid in source_ids:
            if sid not in existing["sourceIds"]:
                existing["sourceIds"].append(sid)
        return

    edge_record = {
        "id": eid,
        "disease": disease_name,
        "type": relation_kind,
        "label": relation.get("propertyName") or spec["label"],
        "source": source_id_value,
        "target": target_id_value,
        "sourceName": source_name,
        "targetName": target_name,
        "evidenceGroup": spec["group"],
        "evidenceCategory": relation.get("evidenceCategory") or spec["category"],
        "metaedge": relation.get("metaedge"),
        "sourceFamily": public_text(relation.get("sourceFamily")),
        "primarySource": public_source_name(relation.get("primarySource")),
        "sourceNames": source_names,
        "sourceIds": source_ids,
        "unbiased": bool(relation.get("unbiased", False)),
        "license": public_text(relation.get("license")),
        "rawEdgeId": public_text(relation.get("hetionetEdgeId")),
        "log2FoldChange": relation.get("log2FoldChange"),
        "evidenceStatus": "source-backed claim",
    }
    edges[eid] = edge_record
    disease_stats[disease_name]["relations"][relation_kind] += 1
    disease_stats[disease_name]["groups"][spec["group"]] += 1
    for source_name in source_names:
        disease_stats[disease_name]["sources"].add(source_name)


def process_packet(
    packet: dict,
    nodes: dict,
    edges: dict,
    sources: dict,
    disease_stats: dict,
    enrichment_index: dict,
) -> None:
    disease = merge_entity_with_enrichment(packet["disease"], enrichment_index)
    disease_name = disease["name"]
    disease_stats[disease_name]["disease"].update(disease)
    add_node(
        nodes,
        "disease",
        disease_name,
        disease_name,
        sources,
        group="Disease",
        entity=disease,
    )

    for source_name in source_names_from_record(disease):
        disease_stats[disease_name]["sources"].add(source_name)

    for bucket, entities in packet.get("entities", {}).items():
        if bucket not in ENTITY_BUCKETS:
            continue
        kind, group = ENTITY_BUCKETS[bucket]
        for entity in entities:
            enriched = merge_entity_with_enrichment(entity, enrichment_index)
            if bucket in GO_BUCKETS and not enriched.get("source"):
                enriched["source"] = "Gene Ontology"
            add_node(
                nodes,
                kind,
                enriched["name"],
                disease_name,
                sources,
                group=group,
                entity=enriched,
            )

    for relation_kind, relations in packet.get("relations", {}).items():
        if relation_kind not in RELATION_SPECS:
            continue
        for relation in relations:
            add_edge(
                edges,
                relation_kind,
                relation,
                disease_name,
                nodes,
                sources,
                disease_stats,
            )


def disease_node_counts(disease_name: str, nodes: dict, edges: dict) -> dict:
    ids = set()
    for edge in edges.values():
        if edge["disease"] == disease_name:
            ids.add(edge["source"])
            ids.add(edge["target"])
    counts = Counter(nodes[nid]["kind"] for nid in ids if nid in nodes)
    return dict(sorted(counts.items()))


def connected_names(disease_name: str, nodes: dict, edges: dict, kind: str, types: set[str]):
    names = []
    seen = set()
    for edge in edges.values():
        if edge["disease"] != disease_name or edge["type"] not in types:
            continue
        for side in ["source", "target"]:
            item = nodes.get(edge[side])
            if item and item["kind"] == kind and item["name"] not in seen:
                seen.add(item["name"])
                names.append(
                    {
                        "name": item["name"],
                        "support": [edge["label"]],
                        "sources": edge["sourceNames"],
                    }
                )
    return sorted(names, key=lambda item: item["name"])


def disease_output(disease_name: str, nodes: dict, edges: dict, stats: dict) -> dict:
    disease = stats["disease"]
    relation_counts = dict(sorted(stats["relations"].items()))
    group_counts = dict(sorted(stats["groups"].items()))
    doi = disease.get("diseaseOntologyId") or disease.get("externalId")
    reuse_id = disease.get("reuseEntityId")
    return {
        "name": disease_name,
        "slug": slug(disease_name),
        "diseaseOntologyId": doi,
        "geoEntityId": reuse_id,
        "geoUrl": f"{GEO_SPACE_URL}/{reuse_id}" if reuse_id else GEO_SPACE_URL,
        "source": public_source_name(disease.get("source")) or "Disease Ontology",
        "license": public_text(disease.get("license")),
        "status": {
            "label": "Published in Geo",
            "tone": "live",
            "description": "A source-backed Disease Atlas packet with browsable claims, identifiers, and evidence links.",
        },
        "relationCounts": relation_counts,
        "canonicalRelationCounts": relation_counts,
        "evidenceGroupCounts": group_counts,
        "nodeCounts": disease_node_counts(disease_name, nodes, edges),
        "selectedGenes": connected_names(
            disease_name,
            nodes,
            edges,
            "gene",
            {"associatedGenes", "upregulatedGenes", "downregulatedGenes"},
        ),
        "selectedCompounds": connected_names(
            disease_name,
            nodes,
            edges,
            "drug",
            {"treats", "palliates"},
        ),
        "topAnnotations": [],
        "heldForReview": [],
        "sources": sorted(stats["sources"]),
    }


def build_quests(diseases: list[dict], nodes: dict) -> list[dict]:
    shared_genes = [
        node
        for node in nodes.values()
        if node["kind"] == "gene" and len(node["appearsIn"]) >= 3
    ]
    shared_drugs = [
        node
        for node in nodes.values()
        if node["kind"] == "drug" and len(node["appearsIn"]) >= 2
    ]
    return [
        {
            "id": "tour-tnf",
            "title": "Trace TNF",
            "prompt": "Find a gene that appears across immune, inflammatory, and metabolic disease packets.",
            "action": {"type": "search", "value": "TNF"},
            "reward": f"{len(shared_genes)} genes appear in at least three disease packets.",
        },
        {
            "id": "tour-treatment",
            "title": "Inspect a treatment",
            "prompt": "Open Methotrexate, then follow its treatment and class evidence.",
            "action": {"type": "search", "value": "Methotrexate"},
            "reward": f"{len(shared_drugs)} drugs currently connect to more than one disease packet.",
        },
        {
            "id": "tour-expression",
            "title": "Switch on expression",
            "prompt": "Use Evidence to view upregulated and downregulated gene claims for one disease.",
            "action": {"type": "mode", "value": "evidence"},
            "reward": "Expression claims carry numeric log2 fold-change values where available.",
        },
        {
            "id": "tour-source",
            "title": "Verify a claim",
            "prompt": "Open Sources to jump from claims to source datasets, papers, and identifiers.",
            "action": {"type": "mode", "value": "sources"},
            "reward": "The graph is organized so claims stay traceable back to source material.",
        },
    ]


def validate(output: dict) -> None:
    diseases = output["diseases"]
    nodes = {node["id"] for node in output["nodes"]}
    if len(diseases) != len(DISEASE_ORDER):
        raise ValueError(f"Expected {len(DISEASE_ORDER)} diseases, got {len(diseases)}")
    for edge in output["edges"]:
        if edge["source"] not in nodes:
            raise ValueError(f"Missing edge source {edge['source']} for {edge['id']}")
        if edge["target"] not in nodes:
            raise ValueError(f"Missing edge target {edge['target']} for {edge['id']}")
        if not edge["sourceNames"]:
            raise ValueError(f"Edge {edge['id']} has no source names")


def main() -> None:
    asthma_packet = load_json(ASTHMA_PACKET_JSON)
    asthma_enrichment = load_json(ASTHMA_ENRICHMENT_JSON)
    wave2_packets = load_json(WAVE2_PACKET_JSON)
    evidence_packets = load_json(THREE_DISEASE_EVIDENCE_JSON)
    wave3_packets = load_json(WAVE3_PACKET_JSON)

    sources = {}
    papers = {}
    nodes = {}
    edges = {}
    disease_stats = defaultdict(
        lambda: {
            "disease": {},
            "relations": Counter(),
            "groups": Counter(),
            "sources": set(),
        }
    )
    enrichment_index = build_enrichment_index()

    collect_top_level_sources_and_papers(
        sources,
        papers,
        asthma_packet,
        asthma_enrichment,
        evidence_packets,
        wave2_packets,
        wave3_packets,
    )

    for packet in get_packets(asthma_packet, wave2_packets, evidence_packets, wave3_packets):
        process_packet(packet, nodes, edges, sources, disease_stats, enrichment_index)

    disease_outputs = [
        disease_output(name, nodes, edges, disease_stats[name])
        for name in DISEASE_ORDER
    ]

    for paper in papers.values():
        for source_name in paper.get("sources", []):
            sid = merge_source(sources, source_name)
            if sid:
                sources[sid]["claimCount"] += 0

    node_outputs = sorted(nodes.values(), key=lambda node: (node["kind"], node["name"]))
    edge_outputs = sorted(edges.values(), key=lambda edge: (edge["disease"], edge["type"], edge["sourceName"], edge["targetName"]))
    source_outputs = sorted(sources.values(), key=lambda source: (source.get("type") or "", source["name"]))
    paper_outputs = sorted(papers.values(), key=lambda paper: paper["name"])
    evidence_groups = Counter(edge["evidenceGroup"] for edge in edge_outputs)

    output = {
        "meta": {
            "title": "Disease Atlas Explorer",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "geoSpaceUrl": GEO_SPACE_URL,
            "sourceFiles": [
                str(ASTHMA_PACKET_JSON.relative_to(ROOT)),
                str(ASTHMA_ENRICHMENT_JSON.relative_to(ROOT)),
                str(WAVE2_PACKET_JSON.relative_to(ROOT)),
                str(THREE_DISEASE_EVIDENCE_JSON.relative_to(ROOT)),
                str(WAVE3_PACKET_JSON.relative_to(ROOT)),
            ],
            "summary": {
                "diseaseCount": len(disease_outputs),
                "nodeCount": len(node_outputs),
                "claimCount": len(edge_outputs),
                "sourceCount": len(source_outputs),
                "paperCount": len(paper_outputs),
                "evidenceGroups": dict(sorted(evidence_groups.items())),
            },
            "disclaimer": "Exploratory data visualization only; not medical advice.",
        },
        "diseases": disease_outputs,
        "nodes": node_outputs,
        "edges": edge_outputs,
        "sources": source_outputs,
        "papers": paper_outputs,
        "quests": build_quests(disease_outputs, nodes),
    }

    validate(output)
    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_JSON.write_text(json.dumps(output, indent=2, ensure_ascii=True) + "\n")
    print(
        f"Wrote {OUTPUT_JSON.relative_to(ROOT)} "
        f"({len(disease_outputs)} diseases, {len(node_outputs)} nodes, "
        f"{len(edge_outputs)} claims, {len(source_outputs)} sources, {len(paper_outputs)} papers)"
    )


if __name__ == "__main__":
    main()
