import {
  deterministicPropertyId,
  deterministicTypeId,
} from "./ids.mjs";

export function buildLocalSchema(targetSpaceId, sharedTypes) {
  const typeIds = {
    "Biological Process": deterministicTypeId(
      targetSpaceId,
      "Biological Process"
    ),
    "Molecular Function": deterministicTypeId(
      targetSpaceId,
      "Molecular Function"
    ),
    "Cellular Component": deterministicTypeId(
      targetSpaceId,
      "Cellular Component"
    ),
  };

  const propertyIds = {
    "GO ID": deterministicPropertyId(targetSpaceId, "GO ID"),
    "Hetionet metaedge": deterministicPropertyId(
      targetSpaceId,
      "Hetionet metaedge"
    ),
    Unbiased: deterministicPropertyId(targetSpaceId, "Unbiased"),
    "Import batch": deterministicPropertyId(targetSpaceId, "Import batch"),
    "Associated genes": deterministicPropertyId(
      targetSpaceId,
      "Associated genes"
    ),
    "Participates in pathway": deterministicPropertyId(
      targetSpaceId,
      "Participates in pathway"
    ),
    "Participates in biological process": deterministicPropertyId(
      targetSpaceId,
      "Participates in biological process"
    ),
    "Has molecular function": deterministicPropertyId(
      targetSpaceId,
      "Has molecular function"
    ),
    "Located in cellular component": deterministicPropertyId(
      targetSpaceId,
      "Located in cellular component"
    ),
    "Includes drug": deterministicPropertyId(targetSpaceId, "Includes drug"),
  };

  return {
    types: [
      {
        id: typeIds["Biological Process"],
        name: "Biological Process",
        description:
          "GO-style process term used to describe coordinated biological activities relevant to disease mechanisms.",
      },
      {
        id: typeIds["Molecular Function"],
        name: "Molecular Function",
        description:
          "GO-style function term describing an activity performed by a gene product.",
      },
      {
        id: typeIds["Cellular Component"],
        name: "Cellular Component",
        description:
          "GO-style location term describing where a gene product acts.",
      },
    ],
    valueProperties: [
      {
        id: propertyIds["GO ID"],
        name: "GO ID",
        dataType: "TEXT",
        description: "Stable Gene Ontology identifier for a GO-style concept.",
      },
      {
        id: propertyIds["Hetionet metaedge"],
        name: "Hetionet metaedge",
        dataType: "TEXT",
        description:
          "Hetionet metaedge code preserved on an imported relation entity.",
      },
      {
        id: propertyIds.Unbiased,
        name: "Unbiased",
        dataType: "BOOLEAN",
        description:
          "Whether the Hetionet source marked the imported relation as unbiased.",
      },
      {
        id: propertyIds["Import batch"],
        name: "Import batch",
        dataType: "TEXT",
        description:
          "Named import batch used to group a Disease Atlas publishing wave.",
      },
    ],
    relationProperties: [
      {
        id: propertyIds["Associated genes"],
        name: "Associated with",
        description:
          "General association relation between two biomedical entities. Disease Atlas currently uses it for disease-gene association evidence, but the predicate is intentionally reusable across entity types.",
      },
      {
        id: propertyIds["Participates in pathway"],
        name: "Participates in pathway",
        relationValueTypes: [sharedTypes.Pathway.id],
        description:
          "Links a gene to a pathway annotation included in a Hetionet-derived disease packet.",
      },
      {
        id: propertyIds["Participates in biological process"],
        name: "Participates in biological process",
        relationValueTypes: [typeIds["Biological Process"]],
        description:
          "Links a gene to a GO-style biological process annotation included in Disease Atlas.",
      },
      {
        id: propertyIds["Has molecular function"],
        name: "Has molecular function",
        relationValueTypes: [typeIds["Molecular Function"]],
        description:
          "Links a gene to a GO-style molecular function annotation included in Disease Atlas.",
      },
      {
        id: propertyIds["Located in cellular component"],
        name: "Located in cellular component",
        relationValueTypes: [typeIds["Cellular Component"]],
        description:
          "Links a gene to a GO-style cellular component annotation included in Disease Atlas.",
      },
      {
        id: propertyIds["Includes drug"],
        name: "Includes",
        description:
          "General membership or containment relation. Disease Atlas currently uses it for drug-class membership, but the predicate is intentionally reusable across entity types.",
      },
    ],
    typeIds,
    propertyIds,
  };
}

export function buildEvidenceSchema(targetSpaceId, sharedTypes) {
  const propertyIds = {
    "Hetionet edge ID": deterministicPropertyId(targetSpaceId, "Hetionet edge ID"),
    "Evidence category": deterministicPropertyId(targetSpaceId, "Evidence category"),
    "Source family": deterministicPropertyId(targetSpaceId, "Source family"),
    "Log2 fold change": deterministicPropertyId(targetSpaceId, "Log2 fold change"),
    "Presents symptom evidence": deterministicPropertyId(
      targetSpaceId,
      "Presents symptom evidence"
    ),
    "Localizes to anatomy evidence": deterministicPropertyId(
      targetSpaceId,
      "Localizes to anatomy evidence"
    ),
    "Resembles disease evidence": deterministicPropertyId(
      targetSpaceId,
      "Resembles disease evidence"
    ),
    Upregulates: deterministicPropertyId(
      targetSpaceId,
      "Disease upregulates gene"
    ),
    Downregulates: deterministicPropertyId(
      targetSpaceId,
      "Disease downregulates gene"
    ),
    "Palliates disease": deterministicPropertyId(targetSpaceId, "Palliates disease"),
  };

  return {
    valueProperties: [
      {
        id: propertyIds["Hetionet edge ID"],
        name: "Hetionet edge ID",
        dataType: "TEXT",
        description:
          "Stable raw Hetionet edge identifier used to trace an imported claim back to the source graph.",
      },
      {
        id: propertyIds["Evidence category"],
        name: "Evidence category",
        dataType: "TEXT",
        description:
          "Human-readable evidence category, for example cooccurrence, expression, or curated indication.",
      },
      {
        id: propertyIds["Source family"],
        name: "Source family",
        dataType: "TEXT",
        description:
          "Original Hetionet source family recorded on an imported claim.",
      },
      {
        id: propertyIds["Log2 fold change"],
        name: "Log2 fold change",
        dataType: "FLOAT",
        description:
          "STARGEO disease-gene expression effect size preserved from Hetionet.",
      },
    ],
    relationProperties: [
      {
        id: propertyIds["Presents symptom evidence"],
        name: "Presents with",
        description:
          "Clinical presentation relation linking an entity to an observed sign, symptom, phenotype, or presentation. Evidence strength and source are recorded on the relation entity.",
      },
      {
        id: propertyIds["Localizes to anatomy evidence"],
        name: "Localizes to",
        description:
          "Localization relation linking an entity to an anatomical, cellular, tissue, or spatial context. Evidence strength and source are recorded on the relation entity.",
      },
      {
        id: propertyIds["Resembles disease evidence"],
        name: "Resembles",
        description:
          "Similarity relation between entities. Evidence strength and source are recorded on the relation entity.",
      },
      {
        id: propertyIds.Upregulates,
        name: "Upregulates",
        description:
          "Evidence-only regulation relation indicating the source entity is associated with increased activity or expression of the target entity. The current STARGEO imports target genes, but the predicate is intentionally reusable across entity types.",
      },
      {
        id: propertyIds.Downregulates,
        name: "Downregulates",
        description:
          "Evidence-only regulation relation indicating the source entity is associated with decreased activity or expression of the target entity. The current STARGEO imports target genes, but the predicate is intentionally reusable across entity types.",
      },
      {
        id: propertyIds["Palliates disease"],
        name: "Palliates",
        description:
          "Palliative relation where an intervention helps relieve or manage an entity without necessarily treating its underlying cause.",
      },
    ],
    propertyIds,
  };
}
