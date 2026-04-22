from __future__ import annotations

import bz2
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_JSON = ROOT / "data/source/hetionet-v1.0.json.bz2"
STARTER_JSON = ROOT / "data/derived/starter_diseases.json"
OUTPUT_JSON = ROOT / "data/geo/three-disease-evidence.json"

DISEASE_DISPLAY_NAMES = {
    "asthma": "Asthma",
    "psoriasis": "Psoriasis",
    "rheumatoid arthritis": "Rheumatoid arthritis",
}

DISEASE_ENTITY_IDS = {
    "asthma": "c1d11a58e7f548fca52da2f8f0642a06",
    "psoriasis": "1bd0dae46c25444d8d923e67dd421645",
    "rheumatoid arthritis": "a9fbd2d46b235e259d2f671bd8c20a62",
}

SOURCE_DEFINITIONS = [
    {
        "name": "MEDLINE cooccurrence",
        "type": "Source",
        "description": "Literature cooccurrence evidence source used by Hetionet for disease-symptom, disease-anatomy, and disease-similarity edges. These edges are imported as evidence-only, not canonical clinical assertions.",
        "website": "https://pubmed.ncbi.nlm.nih.gov/",
        "sourceDatabaseIdentifier": "MEDLINE cooccurrence",
        "license": "CC0 1.0 in Hetionet v1.0 edge metadata.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "STARGEO",
        "type": "Source",
        "description": "Gene expression source used by Hetionet for disease-gene upregulation and downregulation edges.",
        "website": "https://stargeo.org/",
        "sourceDatabaseIdentifier": "STARGEO",
        "license": "CC0 1.0 in Hetionet v1.0 edge metadata.",
        "sources": ["Hetionet v1.0"],
    },
]


def load_json(path: Path) -> dict:
    with path.open() as handle:
        return json.load(handle)


def load_hetionet() -> dict:
    with bz2.open(SOURCE_JSON, "rt") as handle:
        return json.load(handle)


def clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def node_key_from_node(node: dict) -> tuple[str, str]:
    return (node["kind"], str(node["identifier"]))


def node_key_from_edge_part(value: list) -> tuple[str, str]:
    return (value[0], str(value[1]))


def edge_source_family(data: dict) -> str:
    if data.get("source"):
        return str(data["source"])
    if data.get("sources"):
        return "; ".join(str(source) for source in data["sources"])
    return "Hetionet v1.0"


def edge_id(source_key: tuple[str, str], kind: str, target_key: tuple[str, str]) -> str:
    return f"hetionet-v1.0:{source_key[0]}:{source_key[1]}|{kind}|{target_key[0]}:{target_key[1]}"


def common_node_fields(node: dict) -> dict:
    data = node.get("data", {})
    return {
        "name": node["name"],
        "externalId": clean_text(node.get("identifier")),
        "description": clean_text(data.get("description")),
        "source": clean_text(data.get("source")),
        "license": clean_text(data.get("license")),
        "website": clean_text(data.get("url")),
    }


def disease_entity(node: dict, reuse_entity_id: str | None = None) -> dict:
    entity = common_node_fields(node)
    entity["name"] = DISEASE_DISPLAY_NAMES.get(node["name"], node["name"])
    entity["diseaseOntologyId"] = str(node["identifier"])
    if reuse_entity_id:
        entity["reuseEntityId"] = reuse_entity_id
    return entity


def gene_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["name"] = node["name"]
    entity["entrezGeneId"] = str(node["identifier"])
    return entity


def drug_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    data = node.get("data", {})
    entity["drugBankId"] = str(node["identifier"])
    entity["inchikey"] = clean_text(data.get("inchikey"))
    entity["inchi"] = clean_text(data.get("inchi"))
    return entity


def symptom_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["sourceDatabaseIdentifier"] = str(node["identifier"])
    entity["description"] = entity["description"] or "Symptom term imported from Hetionet v1.0 evidence."
    return entity


def anatomy_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["sourceDatabaseIdentifier"] = str(node["identifier"])
    entity["description"] = entity["description"] or "Anatomical structure imported from Hetionet v1.0 evidence."
    return entity


def edge_relation(
    *,
    disease_name: str,
    from_name: str,
    to_name: str,
    metaedge: str,
    property_name: str,
    primary_source: str,
    evidence_category: str,
    source_key: tuple[str, str],
    target_key: tuple[str, str],
    edge_kind: str,
    data: dict,
    log2_fold_change: float | None = None,
) -> dict:
    relation = {
        "disease": disease_name,
        "from": from_name,
        "to": to_name,
        "metaedge": metaedge,
        "propertyName": property_name,
        "primarySource": primary_source,
        "sourceFamily": edge_source_family(data),
        "evidenceCategory": evidence_category,
        "hetionetEdgeId": edge_id(source_key, edge_kind, target_key),
        "unbiased": bool(data.get("unbiased", False)),
        "license": clean_text(data.get("license")),
    }

    if log2_fold_change is not None:
        relation["log2FoldChange"] = float(log2_fold_change)

    return relation


def build_indexes(data: dict) -> dict:
    node_lookup = {node_key_from_node(node): node for node in data["nodes"]}
    name_lookup = defaultdict(list)
    for node in data["nodes"]:
        name_lookup[(node["kind"], node["name"])].append(node_key_from_node(node))
    return {"node_lookup": node_lookup, "name_lookup": name_lookup}


def select_expression_edges(edges: list[dict], limit: int = 25) -> list[dict]:
    return sorted(
        edges,
        key=lambda edge: abs(float(edge["data"].get("log2_fold_change", 0))),
        reverse=True,
    )[:limit]


def upsert_named(collection: dict[str, dict], entity: dict) -> None:
    collection[entity["name"]] = entity


def build_packet(starter: dict, hetionet: dict, indexes: dict) -> dict:
    disease_name = starter["name"]
    display_name = DISEASE_DISPLAY_NAMES[disease_name]
    disease_key = ("Disease", starter["disease_ontology_id"])
    node_lookup = indexes["node_lookup"]
    disease_node = node_lookup[disease_key]

    entities = {
        "symptoms": {},
        "anatomy": {},
        "similarDiseases": {},
        "palliativeDrugs": {},
        "expressionGenes": {},
    }
    relations = {
        "symptomEvidence": [],
        "anatomyEvidence": [],
        "diseaseSimilarityEvidence": [],
        "palliates": [],
        "upregulatedGenes": [],
        "downregulatedGenes": [],
    }

    expression_edges = {"upregulates": [], "downregulates": []}

    for edge in hetionet["edges"]:
        source_key = node_key_from_edge_part(edge["source_id"])
        target_key = node_key_from_edge_part(edge["target_id"])
        edge_kind = edge["kind"]
        edge_data = edge.get("data", {})

        if source_key == disease_key and edge_kind == "presents" and target_key[0] == "Symptom":
            symptom_node = node_lookup[target_key]
            upsert_named(entities["symptoms"], symptom_entity(symptom_node))
            relations["symptomEvidence"].append(
                edge_relation(
                    disease_name=display_name,
                    from_name=display_name,
                    to_name=symptom_node["name"],
                    metaedge="DpS",
                    property_name="Presents with",
                    primary_source="MEDLINE cooccurrence",
                    evidence_category="MEDLINE cooccurrence",
                    source_key=source_key,
                    target_key=target_key,
                    edge_kind=edge_kind,
                    data=edge_data,
                )
            )

        if source_key == disease_key and edge_kind == "localizes" and target_key[0] == "Anatomy":
            anatomy_node = node_lookup[target_key]
            upsert_named(entities["anatomy"], anatomy_entity(anatomy_node))
            relations["anatomyEvidence"].append(
                edge_relation(
                    disease_name=display_name,
                    from_name=display_name,
                    to_name=anatomy_node["name"],
                    metaedge="DlA",
                    property_name="Localizes to",
                    primary_source="MEDLINE cooccurrence",
                    evidence_category="MEDLINE cooccurrence",
                    source_key=source_key,
                    target_key=target_key,
                    edge_kind=edge_kind,
                    data=edge_data,
                )
            )

        if edge_kind == "resembles" and source_key[0] == "Disease" and target_key[0] == "Disease":
            if source_key == disease_key:
                other_key = target_key
            elif target_key == disease_key:
                other_key = source_key
            else:
                other_key = None

            if other_key:
                other_node = node_lookup[other_key]
                upsert_named(entities["similarDiseases"], disease_entity(other_node))
                relations["diseaseSimilarityEvidence"].append(
                    edge_relation(
                        disease_name=display_name,
                        from_name=display_name,
                        to_name=DISEASE_DISPLAY_NAMES.get(other_node["name"], other_node["name"]),
                        metaedge="DrD",
                        property_name="Resembles",
                        primary_source="MEDLINE cooccurrence",
                        evidence_category="MEDLINE cooccurrence",
                        source_key=disease_key,
                        target_key=other_key,
                        edge_kind=edge_kind,
                        data=edge_data,
                    )
                )

        if target_key == disease_key and source_key[0] == "Compound" and edge_kind == "palliates":
            compound_node = node_lookup[source_key]
            upsert_named(entities["palliativeDrugs"], drug_entity(compound_node))
            relations["palliates"].append(
                edge_relation(
                    disease_name=display_name,
                    from_name=compound_node["name"],
                    to_name=display_name,
                    metaedge="CpD",
                    property_name="Palliates",
                    primary_source="PharmacotherapyDB",
                    evidence_category="curated palliative indication",
                    source_key=source_key,
                    target_key=target_key,
                    edge_kind=edge_kind,
                    data=edge_data,
                )
            )

        if (
            source_key == disease_key
            and target_key[0] == "Gene"
            and edge_kind in expression_edges
            and edge_data.get("log2_fold_change") is not None
        ):
            expression_edges[edge_kind].append(
                {
                    "source_key": source_key,
                    "target_key": target_key,
                    "kind": edge_kind,
                    "data": edge_data,
                }
            )

    for edge in select_expression_edges(expression_edges["upregulates"]):
        gene_node = node_lookup[edge["target_key"]]
        upsert_named(entities["expressionGenes"], gene_entity(gene_node))
        relations["upregulatedGenes"].append(
            edge_relation(
                disease_name=display_name,
                from_name=display_name,
                to_name=gene_node["name"],
                metaedge="DuG",
                property_name="Upregulates",
                primary_source="STARGEO",
                evidence_category="disease-gene expression",
                source_key=edge["source_key"],
                target_key=edge["target_key"],
                edge_kind=edge["kind"],
                data=edge["data"],
                log2_fold_change=edge["data"].get("log2_fold_change"),
            )
        )

    for edge in select_expression_edges(expression_edges["downregulates"]):
        gene_node = node_lookup[edge["target_key"]]
        upsert_named(entities["expressionGenes"], gene_entity(gene_node))
        relations["downregulatedGenes"].append(
            edge_relation(
                disease_name=display_name,
                from_name=display_name,
                to_name=gene_node["name"],
                metaedge="DdG",
                property_name="Downregulates",
                primary_source="STARGEO",
                evidence_category="disease-gene expression",
                source_key=edge["source_key"],
                target_key=edge["target_key"],
                edge_kind=edge["kind"],
                data=edge["data"],
                log2_fold_change=edge["data"].get("log2_fold_change"),
            )
        )

    return {
        "importBatch": f"{disease_name.replace(' ', '-')}-evidence-v1",
        "datasetName": "Hetionet v1.0",
        "disease": {
            **disease_entity(disease_node, DISEASE_ENTITY_IDS[disease_name]),
            "name": display_name,
            "sources": ["Disease Ontology", "Hetionet v1.0"],
        },
        "entities": {key: list(value.values()) for key, value in entities.items()},
        "relations": relations,
        "relationCounts": {key: len(value) for key, value in relations.items()},
    }


def main() -> None:
    starter_data = load_json(STARTER_JSON)
    hetionet = load_hetionet()
    indexes = build_indexes(hetionet)
    by_name = {
        disease["name"]: disease for disease in starter_data["starter_diseases"]
    }

    packets = [
        build_packet(by_name[name], hetionet, indexes)
        for name in DISEASE_DISPLAY_NAMES
    ]

    output = {
        "importName": "three-disease-evidence-v1",
        "sourceDataset": "Hetionet v1.0",
        "sources": SOURCE_DEFINITIONS,
        "packets": packets,
    }

    OUTPUT_JSON.write_text(json.dumps(output, indent=2) + "\n")
    for packet in packets:
        print(packet["disease"]["name"], packet["relationCounts"])
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
