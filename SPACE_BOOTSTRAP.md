# Disease Atlas Bootstrap

This workspace bootstraps the Geo space at `141d3ace705feabc04d50c78bbf7226e`, which currently has the page title `Hetionet bioinformatics`.

## Recommended Identity

- Rename the space to `Disease Atlas`.
- Use the description: `A disease-centered knowledge graph linking conditions to genes, pathways, anatomy, symptoms, and therapies, starting with curated Hetionet-derived relationships.`
- Treat `Hetionet v1.0` as a `Dataset` entity inside the space, not as the space identity.

## Immediate Cleanup

- Keep the tabs `About`, `Ontology`, and `Papers`.
- Remove the current template tabs `Courses`, `Schools`, `News`, and `People`.
- Add the tabs `Diseases` and `Sources`.

## Reuse First

- Reuse Root-style provenance entities such as `Dataset`, `Paper`, `Source`, `License`, `Claim`, `Quote`, `Text block`, and `Data block`.
- Reuse Health entities where they already exist, especially `Disease`, `Drug`, `Drug class`, `Gene`, `Pathway`, `Symptom`, `Side effect`, `Anatomical structure`, `Anatomical region`, and `Body system`.
- Reuse these existing Health disease entities:
- `Asthma` -> `c1d11a58e7f548fca52da2f8f0642a06`
- `Psoriasis` -> `1bd0dae46c25444d8d923e67dd421645`
- `Rheumatoid arthritis` -> `a9fbd2d46b235e259d2f671bd8c20a62`

## Ontology Delta To Add

- Add the types `Biological Process`, `Molecular Function`, and `Cellular Component`.
- Add identifier properties `GO ID`, `Disease Ontology ID`, `Entrez Gene ID`, `HGNC ID`, `Uberon ID`, `MeSH ID`, and `InChI`.
- Add relation properties `Associated genes`, `Participates in biological process`, `Has molecular function`, `Located in cellular component`, and `Affected anatomy`.
- Add import metadata properties `Hetionet metaedge`, `Import batch`, `Method`, `Unbiased`, `Z-score`, and `Log2 fold change`.

## What Not To Publish As Canonical In Wave 1

- Do not publish `symptom`, `anatomy`, or `resembles` edges from Hetionet as canonical facts without review.
- For the three starter diseases, those relations are largely MEDLINE cooccurrence and produce noisy objects such as broad tissue terms or weak disease similarities.
- Keep those edges available as exploratory notes later, but do not let them define the initial canonical graph.

## Publish Order

1. Create source entities for `Hetionet v1.0`, `Disease Ontology`, `DISEASES`, `DisGeNET`, `GWAS Catalog`, `PharmacotherapyDB`, `STARGEO`, `Gene Ontology`, and `Reactome`.
2. Add the missing ontology delta for GO-style entities and import metadata.
3. Publish one clean disease packet for `Asthma`.
4. Extend the same pattern to `Psoriasis`.
5. Add `Rheumatoid arthritis` once the first two packets feel stable in the UI.

## Wave 1 Canonical Data Model

- Disease -> identifier values and provenance
- Disease -> associated genes
- Compound -> treats disease
- Compound -> palliates disease
- Pharmacologic class -> includes compound
- Gene -> pathway
- Gene -> biological process
- Gene -> molecular function
- Gene -> cellular component

## Wave 1 Packet Sizes

- 1 disease page at a time
- 10 to 15 genes
- 8 to 10 compounds
- 3 to 6 pharmacologic classes
- 6 to 10 pathways or GO terms total
- 5 to 9 source entities

## Starter Diseases

### Asthma

- Publish this first because the Health disease node is clean and the treatment set is easy to understand.
- Starter genes: `IL4`, `IL5`, `IL13`, `IL33`, `TSLP`, `TNF`, `ADRB2`, `PDE4A`, `STAT6`, `GATA3`, `FCER1A`, `HLA-G`, `ALOX5`, `LTC4S`
- Starter compounds: `Montelukast`, `Beclomethasone`, `Prednisone`, `Prednisolone`, `Ciclesonide`, `Arformoterol`, `Salmeterol`, `Hydrocortisone`, `Nedocromil`
- Optional palliative compounds: `Epinephrine`, `Pseudoephedrine`
- Best starter drug classes from Hetionet: `Corticosteroid Hormone Receptor Agonists`, `Adrenergic beta2-Agonists`, `Leukotriene Receptor Antagonists`, `Xanthines`
- Good initial GO or pathway context: `inflammatory response`, `regulation of immune response`, `cytokine activity`, `Signaling by GPCR`, `Immune System`

### Psoriasis

- Publish this second because the disease node is clean and the biology maps well to cytokine and immune signaling.
- Starter genes: `TNF`, `IL17A`, `IL23A`, `IL23R`, `IL12B`, `IL36RN`, `IFIH1`, `IFNLR1`, `STAT3`, `CARD14`, `TRAF3IP2`, `TYK2`, `DDX58`
- Starter compounds: `Methotrexate`, `Cyclosporine`, `Clobetasol propionate`, `Triamcinolone`, `Betamethasone`, `Fluocinolone Acetonide`, `Methoxsalen`, `Mycophenolate mofetil`, `Cholecalciferol`
- Optional palliative compound: `Salicylic acid`
- Best starter drug classes from Hetionet: `Corticosteroid Hormone Receptor Agonists`, `Retinoids`, `Vitamin D`, `Psoralens`
- Good initial GO or pathway context: `response to cytokine`, `regulation of defense response`, `IL23-mediated signaling events`, `Cytokine Signaling in Immune system`, `Adaptive Immune System`

### Rheumatoid Arthritis

- Publish this third because it is rich but larger, and therefore a better follow-on once the pattern is stable.
- Starter genes: `TNF`, `IL6`, `IL1B`, `IL15`, `IFNG`, `PTPRC`, `BLK`, `DPP4`, `MIF`, `CD2`, `IL4`, `AIRE`, `PTPN22`, `CTLA4`, `HLA-DRB1`
- Starter compounds: `Methotrexate`, `Leflunomide`, `Cyclosporine`, `Dexamethasone`, `Hydrocortisone`, `Methylprednisolone`, `Triamcinolone`, `Auranofin`
- Optional palliative compounds: `Piroxicam`, `Diclofenac`, `Acetylsalicylic acid`, `Nabumetone`
- Best starter drug classes from Hetionet: `Nonsteroidal Anti-inflammatory Compounds`, `Corticosteroid Hormone Receptor Agonists`, `Folic Acid Metabolism Inhibitors`
- Good initial GO or pathway context: `response to cytokine`, `regulation of cytokine production`, `cytokine receptor binding`, `Immune System`, `Cytokine Signaling in Immune system`

## Practical Rule

- Search Geo before creating anything.
- If the object already exists in Health, connect to it.
- Only create new nodes when Geo does not already have a stable, correctly-typed entity.
