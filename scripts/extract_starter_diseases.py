from __future__ import annotations

import bz2
import json
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_JSON = ROOT / "data/source/hetionet-v1.0.json.bz2"
OUTPUT_JSON = ROOT / "data/derived/starter_diseases.json"

SPACE_ID = "141d3ace705feabc04d50c78bbf7226e"

STARTERS = [
    {
        "name": "asthma",
        "doid": "DOID:2841",
        "geo_entity_id": "c1d11a58e7f548fca52da2f8f0642a06",
        "selected_genes": [
            "IL4",
            "IL5",
            "IL13",
            "IL33",
            "TSLP",
            "TNF",
            "ADRB2",
            "PDE4A",
            "STAT6",
            "GATA3",
            "FCER1A",
            "HLA-G",
            "ALOX5",
            "LTC4S",
        ],
        "selected_compounds": [
            "Montelukast",
            "Beclomethasone",
            "Prednisone",
            "Prednisolone",
            "Ciclesonide",
            "Arformoterol",
            "Salmeterol",
            "Hydrocortisone",
            "Nedocromil",
            "Epinephrine",
            "Pseudoephedrine",
        ],
    },
    {
        "name": "psoriasis",
        "doid": "DOID:8893",
        "geo_entity_id": "1bd0dae46c25444d8d923e67dd421645",
        "selected_genes": [
            "TNF",
            "IL17A",
            "IL23A",
            "IL23R",
            "IL12B",
            "IL36RN",
            "IFIH1",
            "IFNLR1",
            "STAT3",
            "CARD14",
            "TRAF3IP2",
            "TYK2",
            "DDX58",
        ],
        "selected_compounds": [
            "Methotrexate",
            "Cyclosporine",
            "Clobetasol propionate",
            "Triamcinolone",
            "Betamethasone",
            "Fluocinolone Acetonide",
            "Methoxsalen",
            "Mycophenolate mofetil",
            "Cholecalciferol",
            "Salicylic acid",
        ],
    },
    {
        "name": "rheumatoid arthritis",
        "doid": "DOID:7148",
        "geo_entity_id": "a9fbd2d46b235e259d2f671bd8c20a62",
        "selected_genes": [
            "TNF",
            "IL6",
            "IL1B",
            "IL15",
            "IFNG",
            "PTPRC",
            "BLK",
            "DPP4",
            "MIF",
            "CD2",
            "IL4",
            "AIRE",
            "PTPN22",
            "CTLA4",
            "HLA-DRB1",
        ],
        "selected_compounds": [
            "Methotrexate",
            "Leflunomide",
            "Cyclosporine",
            "Dexamethasone",
            "Hydrocortisone",
            "Methylprednisolone",
            "Triamcinolone",
            "Auranofin",
            "Piroxicam",
            "Diclofenac",
            "Acetylsalicylic acid",
            "Nabumetone",
        ],
    },
]

DERIVED_KINDS = [
    "Pathway",
    "Biological Process",
    "Molecular Function",
    "Cellular Component",
]


def load_hetionet() -> dict:
    with bz2.open(SOURCE_JSON, "rt") as handle:
        return json.load(handle)


def build_indexes(data: dict) -> dict:
    node_lookup = {}
    disease_nodes = {}

    for node in data["nodes"]:
        key = (node["kind"], str(node["identifier"]))
        node_lookup[key] = node
        if node["kind"] == "Disease":
            disease_nodes[node["name"]] = key

    direct_relations = defaultdict(lambda: defaultdict(list))
    gene_annotations = defaultdict(lambda: defaultdict(set))
    class_for_compound = defaultdict(set)

    for edge in data["edges"]:
        source_key = (edge["source_id"][0], str(edge["source_id"][1]))
        target_key = (edge["target_id"][0], str(edge["target_id"][1]))

        if source_key[0] == "Disease":
            disease_name = node_lookup[source_key]["name"]
            direct_relations[disease_name][edge["kind"]].append(
                {
                    "target": target_key,
                    "data": edge["data"],
                }
            )

        if target_key[0] == "Disease" and source_key[0] == "Compound":
            disease_name = node_lookup[target_key]["name"]
            direct_relations[disease_name][f"compound_{edge['kind']}"].append(
                {
                    "compound": source_key,
                    "data": edge["data"],
                }
            )

        if (
            source_key[0] == "Gene"
            and edge["kind"] == "participates"
            and target_key[0] in DERIVED_KINDS
        ):
            gene_annotations[source_key][target_key[0]].add(target_key)

        if (
            source_key[0] == "Pharmacologic Class"
            and edge["kind"] == "includes"
            and target_key[0] == "Compound"
        ):
            class_for_compound[target_key].add(source_key)

    return {
        "node_lookup": node_lookup,
        "disease_nodes": disease_nodes,
        "direct_relations": direct_relations,
        "gene_annotations": gene_annotations,
        "class_for_compound": class_for_compound,
    }


def summarize_selected_genes(starter: dict, indexes: dict) -> list[dict]:
    disease_name = starter["name"]
    node_lookup = indexes["node_lookup"]
    direct = indexes["direct_relations"][disease_name]
    support = defaultdict(set)

    for edge_kind, tag in [
        ("associates", "associated"),
        ("upregulates", "upregulated"),
        ("downregulates", "downregulated"),
    ]:
        for relation in direct.get(edge_kind, []):
            gene_key = relation["target"]
            if gene_key[0] == "Gene":
                support[node_lookup[gene_key]["name"]].add(tag)

    selected = []
    for gene_name in starter["selected_genes"]:
        selected.append(
            {
                "name": gene_name,
                "support": sorted(support.get(gene_name, [])),
            }
        )
    return selected


def summarize_selected_compounds(starter: dict, indexes: dict) -> list[dict]:
    disease_name = starter["name"]
    node_lookup = indexes["node_lookup"]
    direct = indexes["direct_relations"][disease_name]
    class_for_compound = indexes["class_for_compound"]
    support = defaultdict(set)
    compound_keys = {}

    for edge_kind, tag in [
        ("compound_treats", "treats"),
        ("compound_palliates", "palliates"),
    ]:
        for relation in direct.get(edge_kind, []):
            compound_key = relation["compound"]
            compound_name = node_lookup[compound_key]["name"]
            support[compound_name].add(tag)
            compound_keys[compound_name] = compound_key

    selected = []
    for compound_name in starter["selected_compounds"]:
        compound_key = compound_keys.get(compound_name)
        classes = []
        if compound_key:
            classes = sorted(
                node_lookup[class_key]["name"]
                for class_key in class_for_compound.get(compound_key, set())
            )
        selected.append(
            {
                "name": compound_name,
                "support": sorted(support.get(compound_name, [])),
                "pharmacologic_classes": classes,
            }
        )
    return selected


def summarize_top_annotations(starter: dict, indexes: dict) -> dict:
    disease_name = starter["name"]
    node_lookup = indexes["node_lookup"]
    direct = indexes["direct_relations"][disease_name]
    gene_annotations = indexes["gene_annotations"]
    associated_gene_keys = [
        relation["target"]
        for relation in direct.get("associates", [])
        if relation["target"][0] == "Gene"
    ]

    summaries = {}
    for target_kind in DERIVED_KINDS:
        counts = Counter()
        for gene_key in associated_gene_keys:
            for target_key in gene_annotations[gene_key][target_kind]:
                counts[target_key] += 1
        entries = []
        for target_key, count in counts.most_common(8):
            entries.append(
                {
                    "name": node_lookup[target_key]["name"],
                    "identifier": str(node_lookup[target_key]["identifier"]),
                    "supporting_associated_genes": count,
                }
            )
        summaries[target_kind] = entries
    return summaries


def summarize_relation_counts(starter: dict, indexes: dict) -> dict:
    disease_name = starter["name"]
    direct = indexes["direct_relations"][disease_name]
    return {
        "associated_genes": len(direct.get("associates", [])),
        "upregulated_genes": len(direct.get("upregulates", [])),
        "downregulated_genes": len(direct.get("downregulates", [])),
        "treating_compounds": len(direct.get("compound_treats", [])),
        "palliative_compounds": len(direct.get("compound_palliates", [])),
        "symptoms_from_medline_cooccurrence": len(direct.get("presents", [])),
        "anatomy_from_medline_cooccurrence": len(direct.get("localizes", [])),
        "similar_diseases_from_medline_cooccurrence": len(direct.get("resembles", [])),
    }


def build_output(data: dict, indexes: dict) -> dict:
    node_lookup = indexes["node_lookup"]
    output = {
        "space_id": SPACE_ID,
        "source_dataset": {
            "name": "Hetionet v1.0",
            "source_file": str(SOURCE_JSON.relative_to(ROOT)),
        },
        "starter_diseases": [],
    }

    for starter in STARTERS:
        disease_key = indexes["disease_nodes"][starter["name"]]
        disease_node = node_lookup[disease_key]
        output["starter_diseases"].append(
            {
                "name": disease_node["name"],
                "disease_ontology_id": starter["doid"],
                "geo_reuse_entity_id": starter["geo_entity_id"],
                "source": disease_node["data"].get("source"),
                "license": disease_node["data"].get("license"),
                "relation_counts": summarize_relation_counts(starter, indexes),
                "selected_genes": summarize_selected_genes(starter, indexes),
                "selected_compounds": summarize_selected_compounds(starter, indexes),
                "top_annotations": summarize_top_annotations(starter, indexes),
                "wave_1_policy": {
                    "publish_now": [
                        "disease identifiers",
                        "associated genes",
                        "treating compounds",
                        "palliative compounds",
                        "pharmacologic classes",
                        "gene pathway and GO context",
                    ],
                    "hold_for_review": [
                        "disease symptom edges from MEDLINE cooccurrence",
                        "disease anatomy edges from MEDLINE cooccurrence",
                        "disease resemblance edges from MEDLINE cooccurrence",
                        "differential expression edges until import metadata is finalized",
                    ],
                },
            }
        )

    return output


def main() -> None:
    data = load_hetionet()
    indexes = build_indexes(data)
    output = build_output(data, indexes)
    OUTPUT_JSON.write_text(json.dumps(output, indent=2, ensure_ascii=True) + "\n")
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
