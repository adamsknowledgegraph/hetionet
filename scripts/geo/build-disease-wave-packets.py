from __future__ import annotations

import bz2
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_JSON = ROOT / "data/source/hetionet-v1.0.json.bz2"
STARTER_JSON = ROOT / "data/derived/starter_diseases.json"
OUTPUT_JSON = ROOT / "data/geo/disease-wave2-packets.json"

DISEASE_DISPLAY_NAMES = {
    "psoriasis": "Psoriasis",
    "rheumatoid arthritis": "Rheumatoid arthritis",
}

PUBLISH_DISEASES = ["psoriasis", "rheumatoid arthritis"]

ANNOTATION_ALLOWLISTS = {
    "psoriasis": {
        "Pathway": [
            "Immune System",
            "Adaptive Immune System",
            "IL23-mediated signaling events",
            "Cytokine Signaling in Immune system",
        ],
        "Biological Process": [
            "response to cytokine",
            "regulation of defense response",
            "regulation of immune response",
        ],
        "Molecular Function": [
            "cytokine receptor binding",
            "cytokine activity",
        ],
        "Cellular Component": [
            "cell surface",
        ],
    },
    "rheumatoid arthritis": {
        "Pathway": [
            "Immune System",
            "Adaptive Immune System",
            "Innate Immune System",
            "Cytokine Signaling in Immune system",
        ],
        "Biological Process": [
            "response to cytokine",
            "regulation of immune response",
        ],
        "Molecular Function": [
            "cytokine receptor binding",
            "cytokine activity",
        ],
        "Cellular Component": [
            "cell surface",
        ],
    },
}

DRUG_CLASS_ALLOWLISTS = {
    "psoriasis": {
        "Folic Acid Metabolism Inhibitors",
        "Corticosteroid Hormone Receptor Agonists",
        "Psoralens",
        "Vitamin D",
    },
    "rheumatoid arthritis": {
        "Folic Acid Metabolism Inhibitors",
        "Corticosteroid Hormone Receptor Agonists",
    },
}

KIND_TO_ENTITY_BUCKET = {
    "Pathway": "pathways",
    "Biological Process": "biologicalProcesses",
    "Molecular Function": "molecularFunctions",
    "Cellular Component": "cellularComponents",
}

KIND_TO_RELATION_BUCKET = {
    "Pathway": "participatesInPathway",
    "Biological Process": "participatesInBiologicalProcess",
    "Molecular Function": "hasMolecularFunction",
    "Cellular Component": "locatedInCellularComponent",
}

KIND_TO_METAEDGE = {
    "Pathway": "GpPW",
    "Biological Process": "GpBP",
    "Molecular Function": "GpMF",
    "Cellular Component": "GpCC",
}

KIND_TO_PRIMARY_SOURCE = {
    "Pathway": "Reactome",
    "Biological Process": "NCBI gene2go",
    "Molecular Function": "NCBI gene2go",
    "Cellular Component": "NCBI gene2go",
}


def load_json(path: Path) -> dict:
    with path.open() as handle:
        return json.load(handle)


def load_hetionet() -> dict:
    with bz2.open(SOURCE_JSON, "rt") as handle:
        return json.load(handle)


def node_key(node: dict) -> tuple[str, str]:
    return (node["kind"], str(node["identifier"]))


def clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def build_indexes(data: dict) -> dict:
    node_lookup = {}
    name_lookup = defaultdict(list)
    for node in data["nodes"]:
        key = node_key(node)
        node_lookup[key] = node
        name_lookup[(node["kind"], node["name"])].append(key)

    disease_edges = defaultdict(lambda: defaultdict(list))
    gene_annotations = defaultdict(list)
    class_memberships = defaultdict(list)

    for edge in data["edges"]:
        source_key = (edge["source_id"][0], str(edge["source_id"][1]))
        target_key = (edge["target_id"][0], str(edge["target_id"][1]))

        if source_key[0] == "Disease":
            disease_name = node_lookup[source_key]["name"]
            disease_edges[disease_name][edge["kind"]].append(
                {"target": target_key, "data": edge.get("data", {})}
            )

        if source_key[0] == "Compound" and target_key[0] == "Disease":
            disease_name = node_lookup[target_key]["name"]
            disease_edges[disease_name][f"compound_{edge['kind']}"].append(
                {"compound": source_key, "data": edge.get("data", {})}
            )

        if (
            source_key[0] == "Gene"
            and edge["kind"] == "participates"
            and target_key[0] in KIND_TO_ENTITY_BUCKET
        ):
            gene_annotations[source_key].append(
                {
                    "target": target_key,
                    "data": edge.get("data", {}),
                }
            )

        if (
            source_key[0] == "Pharmacologic Class"
            and edge["kind"] == "includes"
            and target_key[0] == "Compound"
        ):
            class_memberships[target_key].append(
                {"class": source_key, "data": edge.get("data", {})}
            )

    return {
        "node_lookup": node_lookup,
        "name_lookup": name_lookup,
        "disease_edges": disease_edges,
        "gene_annotations": gene_annotations,
        "class_memberships": class_memberships,
    }


def only_first(keys: list[tuple[str, str]], kind: str, name: str) -> tuple[str, str]:
    if not keys:
        raise KeyError(f"Missing Hetionet node {kind}:{name}")
    return keys[0]


def key_by_name(indexes: dict, kind: str, name: str) -> tuple[str, str]:
    return only_first(indexes["name_lookup"].get((kind, name), []), kind, name)


def node_by_name(indexes: dict, kind: str, name: str) -> dict:
    return indexes["node_lookup"][key_by_name(indexes, kind, name)]


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


def gene_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["entrezGeneId"] = str(node["identifier"])
    return entity


def drug_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    data = node.get("data", {})
    entity.update(
        {
            "drugBankId": str(node["identifier"]),
            "inchikey": clean_text(data.get("inchikey")),
            "inchi": clean_text(data.get("inchi")),
        }
    )
    return entity


def drug_class_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity.update(
        {
            "sourceDatabaseIdentifier": str(node["identifier"]),
            "classType": clean_text(node.get("data", {}).get("class_type")),
            "description": "Pharmacologic class imported from Hetionet v1.0.",
        }
    )
    return entity


def pathway_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["sourceDatabaseIdentifier"] = str(node["identifier"])
    entity["description"] = "Pathway imported from Hetionet v1.0."
    return entity


def go_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["goId"] = str(node["identifier"])
    entity["description"] = f"Gene Ontology term imported from Hetionet v1.0 ({node['kind']})."
    return entity


def edge_unbiased(data: dict) -> bool:
    return bool(data.get("unbiased", False))


def build_packet(starter: dict, indexes: dict) -> dict:
    disease_name = starter["name"]
    disease_display = DISEASE_DISPLAY_NAMES[disease_name]
    disease_edges = indexes["disease_edges"][disease_name]
    node_lookup = indexes["node_lookup"]

    selected_gene_names = [gene["name"] for gene in starter["selected_genes"]]
    selected_gene_keys = {
        name: key_by_name(indexes, "Gene", name) for name in selected_gene_names
    }

    treat_compounds = [
        compound
        for compound in starter["selected_compounds"]
        if "treats" in compound.get("support", [])
    ]
    selected_drug_names = [compound["name"] for compound in treat_compounds]
    selected_drug_keys = {
        name: key_by_name(indexes, "Compound", name) for name in selected_drug_names
    }

    relations = {
        "associatedGenes": [],
        "treats": [],
        "includesDrug": [],
        "participatesInPathway": [],
        "participatesInBiologicalProcess": [],
        "hasMolecularFunction": [],
        "locatedInCellularComponent": [],
    }

    associated_edge_by_gene = {}
    for edge in disease_edges.get("associates", []):
        target = edge["target"]
        if target[0] == "Gene":
            associated_edge_by_gene[node_lookup[target]["name"]] = edge

    for gene_name in selected_gene_names:
        edge = associated_edge_by_gene.get(gene_name)
        if not edge:
            continue
        relations["associatedGenes"].append(
            {
                "from": disease_display,
                "to": gene_name,
                "metaedge": "DaG",
                "primarySource": "DISEASES",
                "unbiased": edge_unbiased(edge["data"]),
            }
        )

    treat_edge_by_drug = {}
    for edge in disease_edges.get("compound_treats", []):
        compound = edge["compound"]
        treat_edge_by_drug[node_lookup[compound]["name"]] = edge

    for drug_name in selected_drug_names:
        edge = treat_edge_by_drug.get(drug_name)
        if not edge:
            continue
        relations["treats"].append(
            {
                "from": drug_name,
                "to": disease_display,
                "metaedge": "CtD",
                "primarySource": "PharmacotherapyDB",
                "unbiased": edge_unbiased(edge["data"]),
            }
        )

    included_class_names = set()
    class_allowlist = DRUG_CLASS_ALLOWLISTS[disease_name]
    for drug_name, drug_key in selected_drug_keys.items():
        for membership in indexes["class_memberships"].get(drug_key, []):
            class_node = node_lookup[membership["class"]]
            if class_node["name"] not in class_allowlist:
                continue
            included_class_names.add(class_node["name"])
            relations["includesDrug"].append(
                {
                    "from": class_node["name"],
                    "to": drug_name,
                    "metaedge": "PCiC",
                    "primarySource": "DrugCentral",
                    "unbiased": edge_unbiased(membership["data"]),
                }
            )

    annotation_names_by_kind = ANNOTATION_ALLOWLISTS[disease_name]
    annotation_keys_by_kind = {
        kind: {
            name: key_by_name(indexes, kind, name)
            for name in annotation_names
        }
        for kind, annotation_names in annotation_names_by_kind.items()
    }

    allowed_annotation_keys = {
        key
        for kind_entries in annotation_keys_by_kind.values()
        for key in kind_entries.values()
    }

    for gene_name, gene_key in selected_gene_keys.items():
        for annotation in indexes["gene_annotations"].get(gene_key, []):
            target = annotation["target"]
            if target not in allowed_annotation_keys:
                continue
            target_node = node_lookup[target]
            target_kind = target_node["kind"]
            relations[KIND_TO_RELATION_BUCKET[target_kind]].append(
                {
                    "from": gene_name,
                    "to": target_node["name"],
                    "metaedge": KIND_TO_METAEDGE[target_kind],
                    "primarySource": KIND_TO_PRIMARY_SOURCE[target_kind],
                    "unbiased": edge_unbiased(annotation["data"]),
                }
            )

    entities = {
        "genes": [gene_entity(node_lookup[key]) for key in selected_gene_keys.values()],
        "drugs": [drug_entity(node_lookup[key]) for key in selected_drug_keys.values()],
        "drugClasses": [
            drug_class_entity(node_by_name(indexes, "Pharmacologic Class", name))
            for name in sorted(included_class_names)
        ],
        "pathways": [
            pathway_entity(node_lookup[key])
            for key in annotation_keys_by_kind["Pathway"].values()
        ],
        "biologicalProcesses": [
            go_entity(node_lookup[key])
            for key in annotation_keys_by_kind["Biological Process"].values()
        ],
        "molecularFunctions": [
            go_entity(node_lookup[key])
            for key in annotation_keys_by_kind["Molecular Function"].values()
        ],
        "cellularComponents": [
            go_entity(node_lookup[key])
            for key in annotation_keys_by_kind["Cellular Component"].values()
        ],
    }

    disease_node = node_by_name(indexes, "Disease", disease_name)
    return {
        "importBatch": f"{disease_name.replace(' ', '-')}-v1",
        "datasetName": "Hetionet v1.0",
        "disease": {
            "name": disease_display,
            "hetionetName": disease_name,
            "reuseEntityId": starter["geo_reuse_entity_id"],
            "diseaseOntologyId": starter["disease_ontology_id"],
            "source": disease_node.get("data", {}).get("source", "Disease Ontology"),
            "license": disease_node.get("data", {}).get("license"),
            "website": disease_node.get("data", {}).get("url"),
            "sources": ["Disease Ontology", "DISEASES", "Hetionet v1.0"],
        },
        "sources": [],
        "entities": entities,
        "relations": relations,
        "heldForReview": starter["wave_1_policy"]["hold_for_review"],
    }


def main() -> None:
    starter_data = load_json(STARTER_JSON)
    hetionet = load_hetionet()
    indexes = build_indexes(hetionet)

    by_name = {
        disease["name"]: disease for disease in starter_data["starter_diseases"]
    }
    packets = [build_packet(by_name[name], indexes) for name in PUBLISH_DISEASES]

    OUTPUT_JSON.write_text(json.dumps({"packets": packets}, indent=2) + "\n")
    for packet in packets:
        relation_counts = {
            key: len(value) for key, value in packet["relations"].items()
        }
        print(packet["disease"]["name"], relation_counts)
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
