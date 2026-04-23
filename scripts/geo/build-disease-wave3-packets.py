from __future__ import annotations

import bz2
import json
import os
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE_JSON = ROOT / "data/source/hetionet-v1.0.json.bz2"
WAVE_NAME = os.environ.get("DISEASE_WAVE", "wave3")
OUTPUT_JSON = ROOT / f"data/geo/disease-{WAVE_NAME}-packets.json"

WAVE_DISEASES = {
    "wave3": [
        "breast cancer",
        "hypertension",
        "type 2 diabetes mellitus",
        "Alzheimer's disease",
        "Crohn's disease",
    ],
    "wave4": [
        "chronic obstructive pulmonary disease",
        "atopic dermatitis",
        "ulcerative colitis",
        "multiple sclerosis",
        "systemic lupus erythematosus",
        "coronary artery disease",
        "obesity",
        "lung cancer",
    ],
}

if WAVE_NAME not in WAVE_DISEASES:
    raise ValueError(f"Unsupported DISEASE_WAVE={WAVE_NAME!r}; expected one of {sorted(WAVE_DISEASES)}")

PUBLISH_DISEASES = WAVE_DISEASES[WAVE_NAME]

DISEASE_DISPLAY_NAMES = {
    "breast cancer": "Breast cancer",
    "hypertension": "Hypertension",
    "type 2 diabetes mellitus": "Type 2 diabetes mellitus",
    "Alzheimer's disease": "Alzheimer's disease",
    "Crohn's disease": "Crohn's disease",
    "chronic obstructive pulmonary disease": "Chronic obstructive pulmonary disease",
    "atopic dermatitis": "Atopic dermatitis",
    "ulcerative colitis": "Ulcerative colitis",
    "multiple sclerosis": "Multiple sclerosis",
    "systemic lupus erythematosus": "Systemic lupus erythematosus",
    "coronary artery disease": "Coronary artery disease",
    "obesity": "Obesity",
    "lung cancer": "Lung cancer",
}

DISEASE_ENTITY_IDS = {
    "breast cancer": "9c639f44dcaa51d4adf89b10f5b01cba",
    "hypertension": "1c49782113294982b11cc92b5ec34ce3",
    "type 2 diabetes mellitus": "ed25d0161a8d403f8b30fcd7b7bb75b1",
    "Alzheimer's disease": "27d0bfd2964d41e78a0d52e546660ac0",
    "Crohn's disease": "819f06ea07de436490e4667569536772",
}

GENE_PRIORITIES = {
    "breast cancer": [
        "BRCA1",
        "BRCA2",
        "ERBB2",
        "ESR1",
        "PGR",
        "TP53",
        "PTEN",
        "PIK3CA",
        "ATM",
        "CHEK2",
        "PALB2",
        "CDH1",
        "AKT1",
        "EGFR",
        "KRAS",
    ],
    "hypertension": [
        "ACE",
        "AGT",
        "AGTR1",
        "NOS3",
        "REN",
        "ADRB1",
        "ADD1",
        "CYP11B2",
        "NPPA",
        "NPPB",
        "EDN1",
        "MTHFR",
        "SCNN1B",
        "KCNJ5",
        "WNK1",
    ],
    "type 2 diabetes mellitus": [
        "TCF7L2",
        "PPARG",
        "KCNJ11",
        "SLC30A8",
        "IRS1",
        "GCK",
        "HNF1A",
        "HNF4A",
        "FTO",
        "CAPN10",
        "WFS1",
        "ABCC8",
        "IGF2BP2",
        "CDKAL1",
        "KCNQ1",
    ],
    "Alzheimer's disease": [
        "APOE",
        "APP",
        "PSEN1",
        "PSEN2",
        "TREM2",
        "MAPT",
        "CLU",
        "PICALM",
        "BIN1",
        "ABCA7",
        "SORL1",
        "CR1",
        "CD33",
        "MS4A6A",
        "BACE1",
    ],
    "Crohn's disease": [
        "NOD2",
        "IL23R",
        "ATG16L1",
        "IRGM",
        "LRRK2",
        "CARD9",
        "JAK2",
        "STAT3",
        "TNFSF15",
        "CXCL8",
        "IL10",
        "CCR6",
        "MST1",
        "PTPN2",
        "FUT2",
    ],
    "chronic obstructive pulmonary disease": [
        "STAT4",
        "NOS2",
        "GC",
        "SCGB1A1",
        "CRP",
        "HDAC2",
        "ANXA11",
        "GSTM1",
        "MMP1",
        "GSTT1",
        "TP53",
        "LEP",
        "MPO",
        "IL6",
        "SERPINB1",
    ],
    "atopic dermatitis": [
        "KIF3A",
        "CD4",
        "RNASE3",
        "CCL27",
        "ZNF365",
        "IL1B",
        "NFKBIA",
        "IL2",
        "FLG",
        "CCL18",
        "IL18R1",
        "MS4A2",
        "CCR5",
        "CCL17",
        "IL31",
    ],
    "ulcerative colitis": [
        "CXCR2",
        "KIF21B",
        "IL10",
        "IL15",
        "ORMDL3",
        "ITGAL",
        "MPO",
        "IRF5",
        "GHRL",
        "RELA",
        "FCGR2A",
        "TLR4",
        "MIF",
        "PTGS1",
        "ECM1",
    ],
    "multiple sclerosis": [
        "CD40",
        "CD40LG",
        "TLR4",
        "TNF",
        "PLP1",
        "CXCL10",
        "HLA-G",
        "TNFAIP3",
        "ITGA4",
        "SPP1",
        "TYK2",
        "IL1B",
        "IL6",
        "HLA-DRB1",
        "IFNB1",
    ],
    "systemic lupus erythematosus": [
        "TRIM21",
        "LYN",
        "IL1RN",
        "SH2B3",
        "NCF2",
        "IRF5",
        "IFNA1",
        "PPARG",
        "TNF",
        "IL6",
        "PTPN22",
        "FCGR3B",
        "TYK2",
        "BANK1",
        "HLA-DQA1",
    ],
    "coronary artery disease": [
        "AGT",
        "CKB",
        "PON2",
        "ESR2",
        "PRKCE",
        "MMP2",
        "SIRT1",
        "LCAT",
        "AGTR1",
        "APOC3",
        "IL18",
        "HMGB1",
        "HMGCR",
        "MMP1",
        "ATP2B1",
    ],
    "obesity": [
        "PCK1",
        "DEFB1",
        "CPB2",
        "ENPP2",
        "NOS1",
        "MTCH2",
        "CRHBP",
        "F2",
        "GNB3",
        "FOXO1",
        "HTR1B",
        "CIDEA",
        "SLC6A14",
        "IFNG",
        "LEP",
    ],
    "lung cancer": [
        "QPCT",
        "DAPK1",
        "PYCARD",
        "SATB2",
        "CYP2A6",
        "TF",
        "TOP1",
        "CSF3",
        "MMP2",
        "VEGFA",
        "GSTA1",
        "CDKN1A",
        "ALB",
        "CYP1A1",
        "SFN",
    ],
}

DRUG_PRIORITIES = {
    "breast cancer": [
        "Tamoxifen",
        "Anastrozole",
        "Letrozole",
        "Exemestane",
        "Doxorubicin",
        "Paclitaxel",
        "Docetaxel",
        "Capecitabine",
        "Methotrexate",
        "Cyclophosphamide",
    ],
    "hypertension": [
        "Lisinopril",
        "Amlodipine",
        "Losartan",
        "Hydrochlorothiazide",
        "Metoprolol",
        "Enalapril",
        "Valsartan",
        "Captopril",
        "Hydralazine",
        "Indapamide",
    ],
    "type 2 diabetes mellitus": [
        "Metformin",
        "Glipizide",
        "Glyburide",
        "Sitagliptin",
        "Pioglitazone",
        "Rosiglitazone",
        "Acarbose",
        "Miglitol",
        "Glimepiride",
        "Linagliptin",
    ],
    "Alzheimer's disease": [
        "Donepezil",
        "Rivastigmine",
        "Galantamine",
        "Memantine",
    ],
    "Crohn's disease": [
        "Mesalazine",
        "Sulfasalazine",
        "Balsalazide",
        "Prednisone",
        "Azathioprine",
        "Mercaptopurine",
    ],
    "chronic obstructive pulmonary disease": [
        "Prednisolone",
        "Arformoterol",
        "Roflumilast",
        "Tiotropium",
        "Prednisone",
        "Salbutamol",
        "Formoterol",
        "Aminophylline",
        "Montelukast",
    ],
    "atopic dermatitis": [
        "Fluocinolone Acetonide",
        "Loratadine",
        "Fluocinonide",
        "Prednisone",
        "Tacrolimus",
        "Mometasone",
        "Desonide",
        "Triamcinolone",
        "Hydrocortisone",
        "Diphenhydramine",
    ],
    "ulcerative colitis": [
        "Triamcinolone",
        "Mesalazine",
        "Azathioprine",
        "Sulfasalazine",
        "Cholecalciferol",
        "Prednisone",
        "Budesonide",
        "Olsalazine",
        "Balsalazide",
        "Prednisolone",
    ],
    "multiple sclerosis": [
        "Methotrexate",
        "Mitoxantrone",
        "Fingolimod",
        "Betamethasone",
        "Azathioprine",
        "Prednisone",
        "Cladribine",
        "Triamcinolone",
        "Methylprednisolone",
        "Prednisolone",
    ],
    "systemic lupus erythematosus": [
        "Methotrexate",
        "Cyclosporine",
        "Dapsone",
        "Dexamethasone",
        "Triamcinolone",
        "Mycophenolate mofetil",
        "Prednisone",
        "Azathioprine",
        "Hydrocortisone",
        "Leflunomide",
    ],
    "coronary artery disease": [
        "Valsartan",
        "Rosuvastatin",
        "Simvastatin",
        "Tirofiban",
        "Ticagrelor",
        "Pitavastatin",
        "Losartan",
        "Telmisartan",
        "Niacin",
        "Eplerenone",
    ],
    "obesity": [
        "Phentermine",
        "Cimetidine",
        "Diethylpropion",
        "Bupropion",
        "Sibutramine",
        "Benzphetamine",
        "Orlistat",
        "Methamphetamine",
        "Phenylpropanolamine",
        "Phendimetrazine",
    ],
    "lung cancer": [
        "Erlotinib",
        "Methotrexate",
        "Pemetrexed",
        "Irinotecan",
        "Doxorubicin",
        "Gemcitabine",
        "Cisplatin",
        "Etoposide",
        "Paclitaxel",
        "Crizotinib",
    ],
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

ANNOTATION_LIMITS = {
    "Pathway": 8,
    "Biological Process": 5,
    "Molecular Function": 4,
    "Cellular Component": 3,
}

MAX_SYMPTOMS = 20
MAX_ANATOMY = 20
MAX_SIMILAR_DISEASES = 5
MAX_PALLIATIVE_DRUGS = 8
MAX_EXPRESSION_PER_DIRECTION = 25


SOURCE_DEFINITIONS = [
    {
        "name": "Hetionet v1.0",
        "type": "Dataset",
        "description": "Integrated biomedical knowledge graph used as the Disease Atlas import source.",
        "website": "https://github.com/hetio/hetionet",
        "sourceDatabaseIdentifier": "hetionet-v1.0.0",
        "version": "v1.0.0",
        "doi": "10.5281/zenodo.268568",
        "license": "Mixed source licenses; see node and edge provenance.",
        "sources": [
            "Systematic integration of biomedical knowledge prioritizes drugs for repurposing"
        ],
    },
    {
        "name": "Disease Ontology",
        "type": "Source",
        "description": "Ontology source for disease labels and identifiers integrated into Hetionet.",
        "website": "https://disease-ontology.org/",
        "sourceDatabaseIdentifier": "DOID",
        "license": "CC BY 3.0",
        "sources": [
            "Systematic integration of biomedical knowledge prioritizes drugs for repurposing"
        ],
    },
    {
        "name": "DISEASES",
        "type": "Source",
        "description": "Disease-gene association source integrated by Hetionet.",
        "website": "https://diseases.jensenlab.org/",
        "sourceDatabaseIdentifier": "DISEASES / processed Hetionet source DOI 10.5281/zenodo.48427",
        "license": "Source-specific; see DISEASES terms and Hetionet processing notes.",
        "sources": [
            "Systematic integration of biomedical knowledge prioritizes drugs for repurposing"
        ],
    },
    {
        "name": "DisGeNET",
        "type": "Source",
        "description": "Gene-disease association source integrated by Hetionet.",
        "website": "https://www.disgenet.org/",
        "sourceDatabaseIdentifier": "DisGeNET",
        "license": "ODbL 1.0 in relevant Hetionet edge metadata; source-specific terms apply.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "GWAS Catalog",
        "type": "Source",
        "description": "Genome-wide association study catalog source integrated by Hetionet.",
        "website": "https://www.ebi.ac.uk/gwas/",
        "sourceDatabaseIdentifier": "GWAS Catalog",
        "license": "CC BY 4.0 in relevant Hetionet edge metadata; source-specific terms apply.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "DOAF",
        "type": "Source",
        "description": "Disease Ontology Annotation Framework source for disease-gene annotations.",
        "website": "https://biolink.github.io/information-resource-registry/resources/doaf/",
        "sourceDatabaseIdentifier": "Disease Ontology Annotation Framework (DOAF)",
        "doi": "10.1371/journal.pone.0049686",
        "license": "CC BY 3.0 for the referenced DOAF paper; source-specific terms apply.",
        "sources": ["A Framework for Annotating Human Genome in Disease Context"],
    },
    {
        "name": "PharmacotherapyDB",
        "type": "Source",
        "description": "Curated indication source used by Hetionet for compound-disease treatment relations.",
        "website": "https://github.com/dhimmel/indications",
        "sourceDatabaseIdentifier": "PharmacotherapyDB / DOI 10.5281/zenodo.47664",
        "license": "CC0 1.0 / source-specific; see repository metadata.",
        "sources": [
            "Systematic integration of biomedical knowledge prioritizes drugs for repurposing"
        ],
    },
    {
        "name": "DrugBank",
        "type": "Source",
        "description": "Drug identifier and chemistry source used by Hetionet compound nodes.",
        "website": "https://go.drugbank.com/",
        "sourceDatabaseIdentifier": "DrugBank",
        "license": "CC BY-NC 4.0 in Hetionet v1.0 node metadata.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "DrugCentral",
        "type": "Source",
        "description": "Drug classification source used by Hetionet for pharmacologic class membership.",
        "website": "https://drugcentral.org/",
        "sourceDatabaseIdentifier": "DrugCentral / NDF-RT pharmacologic classes",
        "license": "CC BY 4.0 in Hetionet v1.0 node metadata.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "Entrez Gene",
        "type": "Source",
        "description": "NCBI Gene source for gene identifiers and descriptions in Hetionet gene nodes.",
        "website": "https://www.ncbi.nlm.nih.gov/gene/",
        "sourceDatabaseIdentifier": "NCBI Gene",
        "license": "CC0 1.0 in Hetionet v1.0 node metadata.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "Gene Ontology",
        "type": "Source",
        "description": "Controlled vocabulary for biological process, molecular function, and cellular component concepts.",
        "website": "http://geneontology.org/",
        "sourceDatabaseIdentifier": "GO",
        "license": "CC BY 4.0 in Hetionet v1.0 node metadata.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "NCBI gene2go",
        "type": "Source",
        "description": "Gene-to-Gene-Ontology annotation source used by Hetionet for GO participation edges.",
        "website": "https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene2go.gz",
        "sourceDatabaseIdentifier": "NCBI gene2go",
        "license": "NCBI / source-specific.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "Reactome",
        "type": "Source",
        "description": "Curated pathway source used by Hetionet for pathway participation edges.",
        "website": "https://reactome.org/",
        "sourceDatabaseIdentifier": "Reactome via Pathway Commons",
        "license": "CC BY 4.0 in Hetionet v1.0 node metadata.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "Pathway Commons",
        "type": "Source",
        "description": "Pathway data integration resource used by Hetionet for pathway sources such as Reactome, PID, and WikiPathways.",
        "website": "https://www.pathwaycommons.org/",
        "sourceDatabaseIdentifier": "Pathway Commons",
        "license": "Source-specific; Pathway Commons integrates multiple pathway resources.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "Pathway Interaction Database",
        "type": "Source",
        "description": "NCI/Nature Pathway Interaction Database pathway source integrated through Pathway Commons in Hetionet.",
        "website": "https://www.pathwaycommons.org/",
        "sourceDatabaseIdentifier": "PID via Pathway Commons",
        "license": "Source-specific; preserved from Hetionet pathway provenance.",
        "sources": ["Pathway Commons", "Hetionet v1.0"],
    },
    {
        "name": "WikiPathways",
        "type": "Source",
        "description": "Community-curated pathway database used by Hetionet via Pathway Commons.",
        "website": "https://www.wikipathways.org/",
        "sourceDatabaseIdentifier": "WikiPathways",
        "license": "CC0 / source-specific; see WikiPathways reuse terms.",
        "sources": ["Pathway Commons", "Hetionet v1.0"],
    },
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
        "name": "MeSH",
        "type": "Source",
        "description": "NLM Medical Subject Headings vocabulary used by Hetionet symptom nodes.",
        "website": "https://meshb.nlm.nih.gov/",
        "sourceDatabaseIdentifier": "MeSH",
        "license": "Source-specific; Hetionet symptom node metadata records CC0 1.0.",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "Uberon",
        "type": "Source",
        "description": "Cross-species anatomy ontology used by Hetionet anatomical structure nodes.",
        "website": "https://obophenotype.github.io/uberon/",
        "sourceDatabaseIdentifier": "Uberon",
        "license": "CC BY 3.0 in Hetionet anatomy node metadata.",
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

PAPER_DEFINITIONS = [
    {
        "name": "Systematic integration of biomedical knowledge prioritizes drugs for repurposing",
        "description": "Main Project Rephetio paper describing Hetionet v1.0, its source integration, and drug repurposing model.",
        "doi": "10.7554/eLife.26726",
        "pmid": "28936969",
        "publishDate": "2017-10-13T00:00:00.000Z",
        "website": "https://elifesciences.org/articles/26726",
        "sources": ["Hetionet v1.0"],
    },
    {
        "name": "Heterogeneous Network Edge Prediction: A Data Integration Approach to Prioritize Disease-Associated Genes",
        "description": "Foundational hetnet edge-prediction paper for prioritizing disease-associated genes using heterogeneous biomedical networks.",
        "doi": "10.1371/journal.pcbi.1004259",
        "pmid": "26158728",
        "publishDate": "2015-07-09T00:00:00.000Z",
        "website": "https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1004259",
        "sources": ["DISEASES", "Disease Ontology"],
    },
    {
        "name": "A Framework for Annotating Human Genome in Disease Context",
        "description": "Paper describing the Disease Ontology Annotation Framework (DOAF), one of the disease-gene association sources integrated by Hetionet.",
        "doi": "10.1371/journal.pone.0049686",
        "pmid": "23251346",
        "website": "https://pmc.ncbi.nlm.nih.gov/articles/PMC3519466/",
        "sources": ["DOAF"],
    },
]

SOURCE_ALIASES = {
    "Reactome via Pathway Commons": "Reactome",
    "PID via Pathway Commons": "Pathway Interaction Database",
}


def load_hetionet() -> dict:
    with bz2.open(SOURCE_JSON, "rt") as handle:
        return json.load(handle)


def node_key(node: dict) -> tuple[str, str]:
    return (node["kind"], str(node["identifier"]))


def edge_key(value: list) -> tuple[str, str]:
    return (value[0], str(value[1]))


def clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def unique(items: list[str]) -> list[str]:
    seen = set()
    result = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


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
        source_key = edge_key(edge["source_id"])
        target_key = edge_key(edge["target_id"])

        if source_key[0] == "Disease":
            disease_name = node_lookup[source_key]["name"]
            disease_edges[disease_name][edge["kind"]].append(
                {
                    "source": source_key,
                    "target": target_key,
                    "kind": edge["kind"],
                    "data": edge.get("data", {}),
                }
            )

        if source_key[0] == "Compound" and target_key[0] == "Disease":
            disease_name = node_lookup[target_key]["name"]
            disease_edges[disease_name][f"compound_{edge['kind']}"].append(
                {
                    "source": source_key,
                    "target": target_key,
                    "kind": edge["kind"],
                    "data": edge.get("data", {}),
                }
            )

        if (
            source_key[0] == "Gene"
            and edge["kind"] == "participates"
            and target_key[0] in KIND_TO_ENTITY_BUCKET
        ):
            gene_annotations[source_key].append(
                {
                    "source": source_key,
                    "target": target_key,
                    "kind": edge["kind"],
                    "data": edge.get("data", {}),
                }
            )

        if (
            source_key[0] == "Pharmacologic Class"
            and edge["kind"] == "includes"
            and target_key[0] == "Compound"
        ):
            class_memberships[target_key].append(
                {
                    "source": source_key,
                    "target": target_key,
                    "kind": edge["kind"],
                    "data": edge.get("data", {}),
                }
            )

    return {
        "node_lookup": node_lookup,
        "name_lookup": name_lookup,
        "disease_edges": disease_edges,
        "gene_annotations": gene_annotations,
        "class_memberships": class_memberships,
    }


def key_by_name(indexes: dict, kind: str, name: str) -> tuple[str, str]:
    keys = indexes["name_lookup"].get((kind, name), [])
    if not keys:
        raise KeyError(f"Missing Hetionet node {kind}:{name}")
    return keys[0]


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


def disease_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    raw_name = node["name"]
    entity["name"] = DISEASE_DISPLAY_NAMES.get(raw_name, raw_name)
    entity["diseaseOntologyId"] = str(node["identifier"])
    if raw_name in DISEASE_ENTITY_IDS:
        entity["reuseEntityId"] = DISEASE_ENTITY_IDS[raw_name]
    return entity


def gene_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["entrezGeneId"] = str(node["identifier"])
    return entity


def drug_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    data = node.get("data", {})
    entity["drugBankId"] = str(node["identifier"])
    entity["inchikey"] = clean_text(data.get("inchikey"))
    entity["inchi"] = clean_text(data.get("inchi"))
    return entity


def drug_class_entity(node: dict) -> dict:
    entity = common_node_fields(node)
    entity["sourceDatabaseIdentifier"] = str(node["identifier"])
    entity["classType"] = clean_text(node.get("data", {}).get("class_type"))
    entity["description"] = "Pharmacologic class imported from Hetionet v1.0."
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


def source_names(data: dict) -> list[str]:
    names = []
    if data.get("source"):
        names.append(SOURCE_ALIASES.get(str(data["source"]), str(data["source"])))
    for source in data.get("sources", []) or []:
        names.append(SOURCE_ALIASES.get(str(source), str(source)))
    return unique(names or ["Hetionet v1.0"])


def primary_source(names: list[str], fallback: str) -> str:
    for candidate in [
        fallback,
        "DISEASES",
        "GWAS Catalog",
        "DisGeNET",
        "DOAF",
        "PharmacotherapyDB",
        "DrugCentral",
        "Reactome",
        "NCBI gene2go",
        "STARGEO",
        "MEDLINE cooccurrence",
    ]:
        if candidate in names:
            return candidate
    return names[0] if names else fallback


def raw_edge_id(source: tuple[str, str], kind: str, target: tuple[str, str]) -> str:
    return f"hetionet-v1.0:{source[0]}:{source[1]}|{kind}|{target[0]}:{target[1]}"


def slugify(value: str) -> str:
    return (
        value.lower()
        .replace("'", "")
        .replace("/", "-")
        .replace(" ", "-")
    )


def edge_relation(
    *,
    from_name: str,
    to_name: str,
    metaedge: str,
    property_name: str,
    fallback_source: str,
    evidence_category: str,
    edge: dict,
    log2_fold_change: float | None = None,
) -> dict:
    data = edge.get("data", {})
    names = source_names(data)
    relation = {
        "from": from_name,
        "to": to_name,
        "metaedge": metaedge,
        "propertyName": property_name,
        "primarySource": primary_source(names, fallback_source),
        "sourceNames": names,
        "sourceFamily": "; ".join(names),
        "evidenceCategory": evidence_category,
        "hetionetEdgeId": raw_edge_id(edge["source"], edge["kind"], edge["target"]),
        "unbiased": bool(data.get("unbiased", False)),
        "license": clean_text(data.get("license")),
    }
    if log2_fold_change is not None:
        relation["log2FoldChange"] = float(log2_fold_change)
    return relation


def edge_score(edge: dict) -> tuple[int, int, int]:
    names = set(source_names(edge.get("data", {})))
    return (
        int(bool(edge.get("data", {}).get("unbiased"))) * 10
        + int("GWAS Catalog" in names) * 5
        + int("DISEASES" in names) * 4
        + int("DisGeNET" in names) * 3
        + int("DOAF" in names) * 2
        + len(names),
        len(names),
        int(bool(edge.get("data", {}).get("license"))),
    )


def select_associated_genes(disease_name: str, edges: list[dict], indexes: dict) -> list[dict]:
    node_lookup = indexes["node_lookup"]
    by_name = {
        node_lookup[edge["target"]]["name"]: edge
        for edge in edges
        if edge["target"][0] == "Gene"
    }
    selected = []
    for name in GENE_PRIORITIES[disease_name]:
        edge = by_name.get(name)
        if edge:
            selected.append(edge)

    used = {edge["target"] for edge in selected}
    ranked = sorted(
        [edge for edge in edges if edge["target"][0] == "Gene" and edge["target"] not in used],
        key=lambda edge: edge_score(edge),
        reverse=True,
    )
    selected.extend(ranked[: max(0, 15 - len(selected))])
    return selected[:15]


def select_treating_drugs(disease_name: str, edges: list[dict], indexes: dict) -> list[dict]:
    node_lookup = indexes["node_lookup"]
    by_name = {node_lookup[edge["source"]]["name"]: edge for edge in edges}
    selected = []
    for name in DRUG_PRIORITIES[disease_name]:
        edge = by_name.get(name)
        if edge:
            selected.append(edge)
    used = {edge["source"] for edge in selected}
    selected.extend([edge for edge in edges if edge["source"] not in used][: max(0, 10 - len(selected))])
    return selected[:10]


def select_expression_edges(edges: list[dict], limit: int = MAX_EXPRESSION_PER_DIRECTION) -> list[dict]:
    return sorted(
        [edge for edge in edges if edge.get("data", {}).get("log2_fold_change") is not None],
        key=lambda edge: abs(float(edge["data"].get("log2_fold_change", 0))),
        reverse=True,
    )[:limit]


def upsert_named(collection: dict[str, dict], entity: dict) -> None:
    collection[entity["name"]] = entity


def select_annotations(gene_keys: list[tuple[str, str]], indexes: dict) -> dict[str, set[tuple[str, str]]]:
    counts_by_kind = {kind: Counter() for kind in KIND_TO_ENTITY_BUCKET}
    for gene_key in gene_keys:
        for annotation in indexes["gene_annotations"].get(gene_key, []):
            target = annotation["target"]
            if target[0] in counts_by_kind:
                counts_by_kind[target[0]][target] += 1

    selected = {}
    for kind, counter in counts_by_kind.items():
        selected[kind] = {
            target
            for target, _count in counter.most_common(ANNOTATION_LIMITS[kind])
        }
    return selected


def build_packet(disease_name: str, indexes: dict) -> dict:
    node_lookup = indexes["node_lookup"]
    disease_key = key_by_name(indexes, "Disease", disease_name)
    disease_node = node_lookup[disease_key]
    display_name = DISEASE_DISPLAY_NAMES[disease_name]
    disease_edges = indexes["disease_edges"][disease_name]

    entities = {
        "genes": {},
        "drugs": {},
        "drugClasses": {},
        "pathways": {},
        "biologicalProcesses": {},
        "molecularFunctions": {},
        "cellularComponents": {},
        "symptoms": {},
        "anatomy": {},
        "similarDiseases": {},
        "palliativeDrugs": {},
        "expressionGenes": {},
    }
    relations = {
        "associatedGenes": [],
        "treats": [],
        "includesDrug": [],
        "participatesInPathway": [],
        "participatesInBiologicalProcess": [],
        "hasMolecularFunction": [],
        "locatedInCellularComponent": [],
        "symptomEvidence": [],
        "anatomyEvidence": [],
        "diseaseSimilarityEvidence": [],
        "palliates": [],
        "upregulatedGenes": [],
        "downregulatedGenes": [],
    }

    associated_edges = select_associated_genes(
        disease_name,
        disease_edges.get("associates", []),
        indexes,
    )
    associated_gene_keys = []
    for edge in associated_edges:
        gene_node = node_lookup[edge["target"]]
        associated_gene_keys.append(edge["target"])
        upsert_named(entities["genes"], gene_entity(gene_node))
        relations["associatedGenes"].append(
            edge_relation(
                from_name=display_name,
                to_name=gene_node["name"],
                metaedge="DaG",
                property_name="Associated with",
                fallback_source="DISEASES",
                evidence_category="curated disease-gene association",
                edge=edge,
            )
        )

    treating_edges = select_treating_drugs(
        disease_name,
        disease_edges.get("compound_treats", []),
        indexes,
    )
    selected_drug_keys = []
    for edge in treating_edges:
        drug_node = node_lookup[edge["source"]]
        selected_drug_keys.append(edge["source"])
        upsert_named(entities["drugs"], drug_entity(drug_node))
        relations["treats"].append(
            edge_relation(
                from_name=drug_node["name"],
                to_name=display_name,
                metaedge="CtD",
                property_name="Treats",
                fallback_source="PharmacotherapyDB",
                evidence_category="curated treatment indication",
                edge=edge,
            )
        )

    class_counts = Counter()
    for drug_key in selected_drug_keys:
        for membership in indexes["class_memberships"].get(drug_key, []):
            class_counts[membership["source"]] += 1
    selected_classes = {key for key, _ in class_counts.most_common(8)}
    for drug_key in selected_drug_keys:
        drug_name = node_lookup[drug_key]["name"]
        for membership in indexes["class_memberships"].get(drug_key, []):
            if membership["source"] not in selected_classes:
                continue
            class_node = node_lookup[membership["source"]]
            upsert_named(entities["drugClasses"], drug_class_entity(class_node))
            relations["includesDrug"].append(
                edge_relation(
                    from_name=class_node["name"],
                    to_name=drug_name,
                    metaedge="PCiC",
                    property_name="Includes",
                    fallback_source="DrugCentral",
                    evidence_category="pharmacologic class membership",
                    edge=membership,
                )
            )

    selected_annotations = select_annotations(associated_gene_keys, indexes)
    for gene_key in associated_gene_keys:
        gene_name = node_lookup[gene_key]["name"]
        for annotation in indexes["gene_annotations"].get(gene_key, []):
            target = annotation["target"]
            target_kind = target[0]
            if target not in selected_annotations.get(target_kind, set()):
                continue
            target_node = node_lookup[target]
            upsert_named(entities[KIND_TO_ENTITY_BUCKET[target_kind]], (
                pathway_entity(target_node) if target_kind == "Pathway" else go_entity(target_node)
            ))
            relations[KIND_TO_RELATION_BUCKET[target_kind]].append(
                edge_relation(
                    from_name=gene_name,
                    to_name=target_node["name"],
                    metaedge=KIND_TO_METAEDGE[target_kind],
                    property_name={
                        "Pathway": "Participates in pathway",
                        "Biological Process": "Participates in biological process",
                        "Molecular Function": "Has molecular function",
                        "Cellular Component": "Located in cellular component",
                    }[target_kind],
                    fallback_source=KIND_TO_PRIMARY_SOURCE[target_kind],
                    evidence_category="pathway annotation" if target_kind == "Pathway" else "gene ontology annotation",
                    edge=annotation,
                )
            )

    for edge in disease_edges.get("presents", [])[:MAX_SYMPTOMS]:
        if edge["target"][0] != "Symptom":
            continue
        symptom_node = node_lookup[edge["target"]]
        upsert_named(entities["symptoms"], symptom_entity(symptom_node))
        relations["symptomEvidence"].append(
            edge_relation(
                from_name=display_name,
                to_name=symptom_node["name"],
                metaedge="DpS",
                property_name="Presents with",
                fallback_source="MEDLINE cooccurrence",
                evidence_category="MEDLINE cooccurrence",
                edge=edge,
            )
        )

    for edge in disease_edges.get("localizes", [])[:MAX_ANATOMY]:
        if edge["target"][0] != "Anatomy":
            continue
        anatomy_node = node_lookup[edge["target"]]
        upsert_named(entities["anatomy"], anatomy_entity(anatomy_node))
        relations["anatomyEvidence"].append(
            edge_relation(
                from_name=display_name,
                to_name=anatomy_node["name"],
                metaedge="DlA",
                property_name="Localizes to",
                fallback_source="MEDLINE cooccurrence",
                evidence_category="MEDLINE cooccurrence",
                edge=edge,
            )
        )

    similar_edges = []
    for edge in disease_edges.get("resembles", []):
        if edge["source"] == disease_key:
            other_key = edge["target"]
        elif edge["target"] == disease_key:
            other_key = edge["source"]
        else:
            continue
        if other_key[0] == "Disease":
            similar_edges.append((edge, other_key))

    for edge, other_key in similar_edges[:MAX_SIMILAR_DISEASES]:
        other_node = node_lookup[other_key]
        other_entity = disease_entity(other_node)
        upsert_named(entities["similarDiseases"], other_entity)
        relations["diseaseSimilarityEvidence"].append(
            edge_relation(
                from_name=display_name,
                to_name=other_entity["name"],
                metaedge="DrD",
                property_name="Resembles",
                fallback_source="MEDLINE cooccurrence",
                evidence_category="MEDLINE cooccurrence",
                edge={
                    **edge,
                    "source": disease_key,
                    "target": other_key,
                },
            )
        )

    for edge in disease_edges.get("compound_palliates", [])[:MAX_PALLIATIVE_DRUGS]:
        drug_node = node_lookup[edge["source"]]
        upsert_named(entities["palliativeDrugs"], drug_entity(drug_node))
        relations["palliates"].append(
            edge_relation(
                from_name=drug_node["name"],
                to_name=display_name,
                metaedge="CpD",
                property_name="Palliates",
                fallback_source="PharmacotherapyDB",
                evidence_category="curated palliative indication",
                edge=edge,
            )
        )

    for edge_kind, bucket, metaedge, property_name in [
        ("upregulates", "upregulatedGenes", "DuG", "Upregulates"),
        ("downregulates", "downregulatedGenes", "DdG", "Downregulates"),
    ]:
        for edge in select_expression_edges(disease_edges.get(edge_kind, [])):
            gene_node = node_lookup[edge["target"]]
            upsert_named(entities["expressionGenes"], gene_entity(gene_node))
            relations[bucket].append(
                edge_relation(
                    from_name=display_name,
                    to_name=gene_node["name"],
                    metaedge=metaedge,
                    property_name=property_name,
                    fallback_source="STARGEO",
                    evidence_category="disease-gene expression",
                    edge=edge,
                    log2_fold_change=edge["data"].get("log2_fold_change"),
                )
            )

    return {
        "importBatch": f"{slugify(disease_name)}-{WAVE_NAME}-v1",
        "datasetName": "Hetionet v1.0",
        "disease": {
            **disease_entity(disease_node),
            "sources": ["Disease Ontology", "Hetionet v1.0"],
        },
        "entities": {key: list(value.values()) for key, value in entities.items()},
        "relations": relations,
        "relationCounts": {key: len(value) for key, value in relations.items()},
    }


def main() -> None:
    hetionet = load_hetionet()
    indexes = build_indexes(hetionet)
    packets = [build_packet(name, indexes) for name in PUBLISH_DISEASES]
    output = {
        "importName": f"disease-{WAVE_NAME}-v1",
        "sourceDataset": "Hetionet v1.0",
        "sources": SOURCE_DEFINITIONS,
        "papers": PAPER_DEFINITIONS,
        "packets": packets,
    }
    OUTPUT_JSON.write_text(json.dumps(output, indent=2) + "\n")
    for packet in packets:
        print(packet["disease"]["name"], packet["relationCounts"])
    print(f"Wrote {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
