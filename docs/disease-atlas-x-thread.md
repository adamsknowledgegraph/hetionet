# Disease Atlas X Thread

1/9
I am building a Disease Atlas on Geo: a browsable biomedical knowledge graph where diseases connect to genes, treatments, pathways, symptoms, anatomy signals, expression changes, sources, and papers.

The goal is simple: make biomedical claims easier to inspect, reuse, and verify.

2/9
The first atlas release covers 8 disease packets:

Asthma, Psoriasis, Rheumatoid arthritis, Breast cancer, Hypertension, Type 2 diabetes mellitus, Alzheimer's disease, and Crohn's disease.

Each disease has a structured graph rather than a flat table.

3/9
Current scale:

8 diseases
942 graph objects
1,713 source-backed claims
23 source/dataset records
3 papers

This is intentionally curated, not a giant unreviewed dump.

4/9
The graph includes:

404 genes
97 drugs
30 drug classes
32 pathways
61 Gene Ontology terms
138 presentation/symptom signals
147 anatomy/localization signals

So you can move from disease to mechanism to evidence.

5/9
Every claim is modeled as an edge in the graph.

Examples:

Asthma associated with IL4
Methotrexate treats Psoriasis
Crohn's disease upregulates CXCL11
BRCA1 participates in a pathway

The relation is the important thing, not just text on a page.

6/9
The sources are part of the graph too.

Examples include Disease Ontology, DISEASES, DisGeNET, DrugBank, DrugCentral, Entrez Gene, Gene Ontology, NCBI gene2go, PharmacotherapyDB, Reactome, STARGEO, Uberon, WikiPathways, MEDLINE/PubMed-derived signals, and key papers.

7/9
I am separating "stronger curated assertions" from "evidence signals."

For example, treatment indications and disease-gene associations are displayed differently from literature cooccurrence signals like symptoms, anatomy, and disease similarity.

That matters because not all edges mean the same thing.

8/9
I also made a small explorer UI for it:

Pick a disease
Browse the graph
Filter by genes, drugs, pathways, symptoms, anatomy, or GO terms
Click a claim
Jump to sources and papers

This is meant to be useful for builders, not just pretty.

9/9
Where I want this to go:

Click a gene and see connected diseases.
Click a disease and see mechanisms, treatments, and evidence.
Click a claim and trace it back to source data or papers.

A reusable, verifiable disease repertoire on top of Geo.

