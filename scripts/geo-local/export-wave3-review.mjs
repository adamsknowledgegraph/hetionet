import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { SystemIds } from "@geoprotocol/geo-sdk";

import {
  deterministicEntityId,
  deterministicPropertyId,
  deterministicRelationEntityId,
  deterministicRelationId,
  relationEntityName,
} from "../geo/lib/ids.mjs";
import { buildEvidenceSchema, buildLocalSchema } from "../geo/lib/local-schema.mjs";

const TARGET_SPACE_ID = "141d3ace705feabc04d50c78bbf7226e";
const HEALTH_SPACE_ID = "52c7ae149838b6d47ce0f3b2a5974546";
const ROOT_SPACE_ID = "a19c345ab9866679b001d7d2138d88a1";

const INPUT_PATH = fileURLToPath(
  new URL("../../data/geo/disease-wave3-packets.json", import.meta.url)
);
const OUTPUT_PATH =
  process.env.GEO_LOCAL_WAVE3_OUTPUT ??
  fileURLToPath(new URL("../../data/geo-local/wave3-review-mutations.json", import.meta.url));

const HETIONET_PAPER =
  "Systematic integration of biomedical knowledge prioritizes drugs for repurposing";
const DOAF_PAPER = "A Framework for Annotating Human Genome in Disease Context";

const SOURCE_ALIASES = {
  "Reactome via Pathway Commons": "Reactome",
  "PID via Pathway Commons": "Pathway Interaction Database",
  "FDA via DrugCentral": "DrugCentral",
};

const PATHWAY_SOURCES = new Set([
  "Reactome",
  "Pathway Interaction Database",
  "WikiPathways",
]);

const sharedTypes = {
  Page: {
    id: SystemIds.PAGE_TYPE,
    ownerSpaceId: ROOT_SPACE_ID,
    description: "Geo page entity.",
  },
  Disease: {
    id: "aa949a7e4e615830b37b793fac1257e5",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Disease or medical condition.",
  },
  Drug: {
    id: "1115f250e2a953ee8c8e4cfd0ae7a297",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Drug or therapeutic compound.",
  },
  "Drug class": {
    id: "291e33212b7146e79d79eb2739809fea",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Pharmacologic or therapeutic drug class.",
  },
  Gene: {
    id: "93a0c3dc71314daf862e66c3af8b4fe4",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Human gene entity.",
  },
  Pathway: {
    id: "4dc67296e849f4108914da6c662a5d12",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Biological pathway.",
  },
  Dataset: {
    id: "0c4babfb43893486af827341bbf32e09",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Dataset used as a source or import artifact.",
  },
  Source: {
    id: "706779bf537744a68694ea06cf87a3a2",
    ownerSpaceId: ROOT_SPACE_ID,
    description: "Source database, ontology, paper, or website.",
  },
  Paper: {
    id: "5e24fb52856c4189a9716af4387b1b89",
    ownerSpaceId: ROOT_SPACE_ID,
    description: "Scholarly paper or publication.",
  },
  Symptom: {
    id: "b57c864fa7f9f581c0017a8cd83b21a8",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Clinical symptom term.",
  },
  "Anatomical structure": {
    id: "cf59ea3ca51645978867c19a6d583e56",
    ownerSpaceId: HEALTH_SPACE_ID,
    description: "Anatomical structure term.",
  },
};

const sharedValueProperties = {
  Website: {
    id: "eed38e74e67946bf8a42ea3e4f8fb5fb",
    ownerSpaceId: ROOT_SPACE_ID,
    dataType: "TEXT",
  },
  DOI: {
    id: "7cb59354e30c48119e99ff62fcf61646",
    ownerSpaceId: ROOT_SPACE_ID,
    dataType: "TEXT",
  },
  Pmid: {
    id: "1577e86142964c9484c92cf079e330e1",
    ownerSpaceId: HEALTH_SPACE_ID,
    dataType: "TEXT",
  },
  "Publish date": {
    id: "94e43fe8faf241009eb887ab4f999723",
    ownerSpaceId: ROOT_SPACE_ID,
    dataType: "DATETIME",
  },
  Abstract: {
    id: "1d274ed52372471289614a50168a37aa",
    ownerSpaceId: ROOT_SPACE_ID,
    dataType: "TEXT",
  },
  "Source database identifier": {
    id: "5e92c8a417144ee79a09389ef4336aeb",
    ownerSpaceId: ROOT_SPACE_ID,
    dataType: "TEXT",
  },
  "Version ID": {
    id: "152d879eebdb42cd93f3fabfc5559c6b",
    ownerSpaceId: ROOT_SPACE_ID,
    dataType: "TEXT",
  },
  "DrugBank ID": {
    id: "e142c01d5d7a2a1eae85ebc34473ac1b",
    ownerSpaceId: HEALTH_SPACE_ID,
    dataType: "TEXT",
  },
  Inchikey: {
    id: "93d0ecbc41df4c668d2fb16172002dcb",
    ownerSpaceId: HEALTH_SPACE_ID,
    dataType: "TEXT",
  },
};

const sharedRelationProperties = {
  Sources: {
    id: "49c5d5e1679a4dbdbfd33f618f227c94",
    ownerSpaceId: ROOT_SPACE_ID,
    relationValueTypes: [sharedTypes.Source.id, sharedTypes.Dataset.id, sharedTypes.Paper.id],
  },
  Treats: {
    id: "0099eeaf5c36acba4463ca5c4cda1930",
    ownerSpaceId: HEALTH_SPACE_ID,
    relationValueTypes: [sharedTypes.Disease.id],
  },
  "Related drugs": {
    id: "f7fea61b67d46d101a9cb86e824351fd",
    ownerSpaceId: HEALTH_SPACE_ID,
    relationValueTypes: [sharedTypes.Drug.id],
  },
  "Related pathways": {
    id: "1319ec6913998db3074be690307671db",
    ownerSpaceId: HEALTH_SPACE_ID,
    relationValueTypes: [sharedTypes.Pathway.id],
  },
};

const localSchema = buildLocalSchema(TARGET_SPACE_ID, {
  Gene: sharedTypes.Gene,
  Pathway: sharedTypes.Pathway,
  Drug: sharedTypes.Drug,
});
const evidenceSchema = buildEvidenceSchema(TARGET_SPACE_ID, sharedTypes);

const supportingLocalProperties = [
  {
    name: "Disease Ontology ID",
    description: "Stable Disease Ontology identifier, for example DOID:2841.",
    dataType: "TEXT",
  },
  {
    name: "Entrez Gene ID",
    description: "NCBI Entrez Gene identifier used by Hetionet gene nodes.",
    dataType: "TEXT",
  },
  {
    name: "License",
    description: "License or reuse terms recorded from the source metadata.",
    dataType: "TEXT",
  },
  {
    name: "InChI",
    description: "IUPAC International Chemical Identifier for a compound.",
    dataType: "TEXT",
  },
  {
    name: "Class type",
    description: "Classification subtype for an imported pharmacologic class.",
    dataType: "TEXT",
  },
].map((property) => ({
  ...property,
  id: deterministicPropertyId(TARGET_SPACE_ID, property.name),
}));

const sharedProperties = {
  ...sharedValueProperties,
  ...sharedRelationProperties,
};

const valueProperties = [
  ...Object.entries(sharedValueProperties).map(([name, property]) => ({ name, ...property })),
  ...supportingLocalProperties,
  ...localSchema.valueProperties,
  ...evidenceSchema.valueProperties,
];

const relationProperties = [
  ...Object.entries(sharedRelationProperties).map(([name, property]) => ({ name, ...property })),
  ...localSchema.relationProperties,
  ...evidenceSchema.relationProperties,
];

const dataTypeIds = {
  TEXT: SystemIds.TEXT,
  BOOLEAN: SystemIds.BOOLEAN,
  FLOAT: SystemIds.FLOAT,
  DATETIME: SystemIds.DATETIME,
};

const entityMap = new Map();
const relationMap = new Map();
const collections = {
  diseases: new Map(),
  genes: new Map(),
  drugs: new Map(),
  drugClasses: new Map(),
  pathways: new Map(),
  goTerms: new Map(),
  symptoms: new Map(),
  anatomy: new Map(),
  similarDiseases: new Map(),
  palliativeDrugs: new Map(),
  expressionGenes: new Map(),
  datasets: new Map(),
  sources: new Map(),
  papers: new Map(),
  sourcesAndDatasets: new Map(),
  evidenceRelations: new Map(),
};

function valueText(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function textValue(property, value) {
  const text = valueText(value);
  if (text === null) return null;
  return { property, type: "text", value: text };
}

function booleanValue(property, value) {
  return { property, type: "boolean", value: Boolean(value) };
}

function floatValue(property, value) {
  if (value === undefined || value === null || value === "") return null;
  return { property, type: "float", value: Number(value) };
}

function datetimeValue(property, value) {
  const text = valueText(value);
  if (text === null) return null;
  return { property, type: "datetime", value: text };
}

function compactValues(values) {
  return values.filter(Boolean);
}

function valueKey(value) {
  return `${value.property}:${value.type}:${String(value.value)}`;
}

function addEntity({ id, name, description, types = [], values = [] }) {
  const existing =
    entityMap.get(id) ?? {
      id,
      name,
      description,
      types: [],
      values: [],
      valueKeys: new Set(),
    };

  existing.name = existing.name ?? name;
  existing.description = existing.description ?? description;
  for (const type of types.filter(Boolean)) {
    if (!existing.types.includes(type)) existing.types.push(type);
  }
  for (const value of values.filter(Boolean)) {
    const key = valueKey(value);
    if (existing.valueKeys.has(key)) continue;
    existing.valueKeys.add(key);
    existing.values.push(value);
  }

  entityMap.set(id, existing);
  return existing;
}

function addRelation(params) {
  if (relationMap.has(params.id)) return relationMap.get(params.id);
  relationMap.set(params.id, params);
  return params;
}

function typeIdFor(typeName) {
  if (sharedTypes[typeName]) return sharedTypes[typeName].id;
  if (localSchema.typeIds[typeName]) return localSchema.typeIds[typeName];
  throw new Error(`Unsupported type ${typeName}`);
}

function localValuePropertyId(name) {
  const property = valueProperties.find((entry) => entry.name === name);
  if (!property) throw new Error(`Missing value property ${name}`);
  return property.id;
}

function relationPropertyId(name) {
  const property = relationProperties.find((entry) => entry.name === name);
  if (!property) throw new Error(`Missing relation property ${name}`);
  return property.id;
}

function collectionFor(typeName, { evidenceRole = null } = {}) {
  if (typeName === "Disease" && evidenceRole !== "similarDisease") return collections.diseases;
  if (typeName === "Gene" && evidenceRole !== "expressionGene") return collections.genes;
  if (typeName === "Gene" && evidenceRole === "expressionGene") return collections.expressionGenes;
  if (typeName === "Drug" && evidenceRole === "palliativeDrug") return collections.palliativeDrugs;
  if (typeName === "Drug") return collections.drugs;
  if (typeName === "Drug class") return collections.drugClasses;
  if (typeName === "Pathway") return collections.pathways;
  if (
    typeName === "Biological Process" ||
    typeName === "Molecular Function" ||
    typeName === "Cellular Component"
  ) {
    return collections.goTerms;
  }
  if (typeName === "Symptom") return collections.symptoms;
  if (typeName === "Anatomical structure") return collections.anatomy;
  if (typeName === "Dataset") return collections.datasets;
  if (typeName === "Source") return collections.sources;
  if (typeName === "Paper") return collections.papers;
  return null;
}

function normalizeSourceName(name) {
  if (!name) return null;
  return SOURCE_ALIASES[name] ?? name;
}

function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  for (const rawName of names) {
    const name = normalizeSourceName(rawName);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function entityValues(entity, typeName) {
  if (typeName === "Disease") {
    return compactValues([
      textValue(localValuePropertyId("Disease Ontology ID"), entity.diseaseOntologyId ?? entity.externalId),
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.diseaseOntologyId ?? entity.externalId
      ),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Gene") {
    return compactValues([
      textValue(localValuePropertyId("Entrez Gene ID"), entity.entrezGeneId ?? entity.externalId),
      textValue(sharedProperties["Source database identifier"].id, entity.entrezGeneId ?? entity.externalId),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Drug") {
    return compactValues([
      textValue(sharedProperties["DrugBank ID"].id, entity.drugBankId ?? entity.externalId),
      textValue(sharedProperties.Inchikey.id, entity.inchikey),
      textValue(localValuePropertyId("InChI"), entity.inchi),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Drug class") {
    return compactValues([
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.sourceDatabaseIdentifier ?? entity.externalId
      ),
      textValue(localValuePropertyId("Class type"), entity.classType),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Pathway") {
    return compactValues([
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.sourceDatabaseIdentifier ?? entity.externalId
      ),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (
    typeName === "Biological Process" ||
    typeName === "Molecular Function" ||
    typeName === "Cellular Component"
  ) {
    return compactValues([
      textValue(localSchema.propertyIds["GO ID"], entity.goId ?? entity.externalId),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Symptom" || typeName === "Anatomical structure") {
    return compactValues([
      textValue(
        sharedProperties["Source database identifier"].id,
        entity.sourceDatabaseIdentifier ?? entity.externalId
      ),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Dataset" || typeName === "Source") {
    return compactValues([
      textValue(sharedProperties.Website.id, entity.website),
      textValue(sharedProperties["Source database identifier"].id, entity.sourceDatabaseIdentifier),
      textValue(sharedProperties["Version ID"].id, entity.version),
      textValue(sharedProperties.DOI.id, entity.doi),
      textValue(localValuePropertyId("License"), entity.license),
    ]);
  }

  if (typeName === "Paper") {
    return compactValues([
      textValue(sharedProperties.DOI.id, entity.doi),
      textValue(sharedProperties.Pmid.id, entity.pmid),
      datetimeValue(sharedProperties["Publish date"].id, entity.publishDate),
      textValue(sharedProperties.Website.id, entity.website),
      textValue(sharedProperties.Abstract.id, entity.description),
    ]);
  }

  return [];
}

function ownerSpaceFor(typeName, data) {
  if (data.reuseEntityId && sharedTypes[typeName]?.ownerSpaceId) {
    return sharedTypes[typeName].ownerSpaceId;
  }
  return TARGET_SPACE_ID;
}

function ensureTypedEntity({ data, typeName, evidenceRole = null }) {
  const typeId = typeIdFor(typeName);
  const id = data.reuseEntityId ?? deterministicEntityId(TARGET_SPACE_ID, typeName, data.name);
  const ownerSpaceId = ownerSpaceFor(typeName, data);

  addEntity({
    id,
    name: data.name,
    description: data.description,
    types: [typeId],
    values: entityValues(data, typeName),
  });

  const entity = {
    id,
    name: data.name,
    ownerSpaceId,
  };

  collectionFor(typeName, { evidenceRole })?.set(entity.id, entity.name);
  if (evidenceRole === "similarDisease") collections.similarDiseases.set(entity.id, entity.name);
  if (evidenceRole === "expressionGene") collections.genes.set(entity.id, entity.name);
  return entity;
}

function sourceNamesForEntity(entity, typeName) {
  const names = [entity.source, ...(entity.sources ?? [])];

  if (typeName === "Disease") names.push("Disease Ontology");
  if (typeName === "Gene") names.push("Entrez Gene");
  if (typeName === "Drug") names.push("DrugBank");
  if (typeName === "Drug class") names.push("DrugCentral");
  if (typeName === "Pathway") {
    names.push(entity.source);
    if (PATHWAY_SOURCES.has(normalizeSourceName(entity.source))) names.push("Pathway Commons");
  }
  if (
    typeName === "Biological Process" ||
    typeName === "Molecular Function" ||
    typeName === "Cellular Component"
  ) {
    names.push("Gene Ontology", "NCBI gene2go");
  }
  if (typeName === "Symptom") names.push("MeSH", "MEDLINE cooccurrence");
  if (typeName === "Anatomical structure") names.push("Uberon", "MEDLINE cooccurrence");
  if (!["Dataset", "Source", "Paper"].includes(typeName)) names.push("Hetionet v1.0");

  return uniqueNames(names);
}

function relationValues(packet, relation) {
  return compactValues([
    textValue(localSchema.propertyIds["Hetionet metaedge"], relation.metaedge),
    booleanValue(localSchema.propertyIds.Unbiased, relation.unbiased),
    textValue(localSchema.propertyIds["Import batch"], packet.importBatch),
    textValue(evidenceSchema.propertyIds["Hetionet edge ID"], relation.hetionetEdgeId),
    textValue(evidenceSchema.propertyIds["Evidence category"], relation.evidenceCategory),
    textValue(evidenceSchema.propertyIds["Source family"], relation.sourceFamily),
    textValue(localValuePropertyId("License"), relation.license),
    floatValue(evidenceSchema.propertyIds["Log2 fold change"], relation.log2FoldChange),
  ]);
}

function sourceNamesForRelation(relation) {
  const names = [
    ...(relation.sourceNames ?? []),
    relation.primarySource,
    "Hetionet v1.0",
    HETIONET_PAPER,
  ];
  if ((relation.sourceNames ?? []).includes("DOAF")) names.push(DOAF_PAPER);
  return uniqueNames(names);
}

function stableRelationSourceKeyName(propertyName) {
  if (propertyName === "Associated with") return "Associated genes";
  if (propertyName === "Includes") return "Includes drug";
  if (propertyName === "Presents with") return "Presents symptom evidence";
  if (propertyName === "Localizes to") return "Localizes to anatomy evidence";
  if (propertyName === "Resembles") return "Resembles disease evidence";
  if (propertyName === "Palliates") return "Palliates disease";
  if (propertyName === "Upregulates") return "Disease upregulates gene";
  if (propertyName === "Downregulates") return "Disease downregulates gene";
  return propertyName;
}

function addSourceLinks(entity, sourceNames, sourceMap, sourceKey) {
  for (const sourceName of uniqueNames(sourceNames)) {
    const source = sourceMap.get(sourceName);
    if (!source) continue;
    addRelation({
      id: deterministicRelationId({
        fromId: entity.id,
        typeId: sharedProperties.Sources.id,
        toId: source.id,
        spaceId: TARGET_SPACE_ID,
        sourceKey: `${sourceKey}:${source.name}`,
      }),
      fromEntity: entity.id,
      toEntity: source.id,
      fromSpace: entity.ownerSpaceId !== TARGET_SPACE_ID ? entity.ownerSpaceId : undefined,
      type: sharedProperties.Sources.id,
    });
  }
}

function addClaim({
  packet,
  relation,
  fromEntity,
  typeId,
  propertyName,
  toEntity,
  sourceMap,
  includeEvidence = true,
}) {
  if (!fromEntity || !toEntity) {
    throw new Error(`Missing endpoint for ${packet.importBatch}: ${propertyName}`);
  }

  const sourceIds = sourceNamesForRelation(relation)
    .map((sourceName) => sourceMap.get(sourceName)?.id)
    .filter(Boolean);

  const relationId = deterministicRelationId({
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
    spaceId: TARGET_SPACE_ID,
    sourceKey: `${packet.importBatch}:${relation.hetionetEdgeId}:${stableRelationSourceKeyName(propertyName)}`,
  });
  const relationEntityId = deterministicRelationEntityId({
    fromId: fromEntity.id,
    typeId,
    toId: toEntity.id,
    spaceId: TARGET_SPACE_ID,
    sourceKey: `${packet.importBatch}:${relation.hetionetEdgeId}:${stableRelationSourceKeyName(propertyName)}`,
  });

  addRelation({
    id: relationId,
    entityId: relationEntityId,
    entityName: relationEntityName(fromEntity.name, propertyName, toEntity.name),
    fromEntity: fromEntity.id,
    toEntity: toEntity.id,
    fromSpace: fromEntity.ownerSpaceId !== TARGET_SPACE_ID ? fromEntity.ownerSpaceId : undefined,
    toSpace: toEntity.ownerSpaceId !== TARGET_SPACE_ID ? toEntity.ownerSpaceId : undefined,
    type: typeId,
    entityValues: relationValues(packet, relation),
    entityRelations:
      sourceIds.length > 0
        ? {
            [sharedProperties.Sources.id]: sourceIds.map((sourceId) => ({ toEntity: sourceId })),
          }
        : undefined,
  });

  if (includeEvidence) {
    collections.evidenceRelations.set(
      relationEntityId,
      `${fromEntity.name} - ${propertyName} - ${toEntity.name}`
    );
  }
}

function addOntologyEntities() {
  addEntity({
    id: SystemIds.DATA_BLOCK,
    name: "Data block",
    description: "Geo data block used to display a collection of entities.",
    types: [SystemIds.SCHEMA_TYPE],
  });
  addEntity({
    id: SystemIds.COLLECTION_DATA_SOURCE,
    name: "Collection",
    description: "Collection-backed data source.",
  });

  for (const [name, type] of Object.entries(sharedTypes)) {
    addEntity({
      id: type.id,
      name,
      description: type.description,
      types: [SystemIds.SCHEMA_TYPE],
    });
  }
  for (const type of localSchema.types) {
    addEntity({
      id: type.id,
      name: type.name,
      description: type.description,
      types: [SystemIds.SCHEMA_TYPE],
    });
  }

  for (const property of valueProperties) {
    addEntity({
      id: property.id,
      name: property.name,
      description: property.description,
      types: [SystemIds.PROPERTY],
    });
    if (property.dataType && dataTypeIds[property.dataType]) {
      addRelation({
        id: deterministicRelationId({
          fromId: property.id,
          typeId: SystemIds.DATA_TYPE,
          toId: dataTypeIds[property.dataType],
          spaceId: TARGET_SPACE_ID,
          sourceKey: `property-data-type:${property.name}`,
        }),
        fromEntity: property.id,
        toEntity: dataTypeIds[property.dataType],
        type: SystemIds.DATA_TYPE,
      });
    }
  }

  for (const property of relationProperties) {
    addEntity({
      id: property.id,
      name: property.name,
      description: property.description,
      types: [SystemIds.PROPERTY, SystemIds.RELATION],
    });
    for (const toTypeId of property.relationValueTypes ?? []) {
      addRelation({
        id: deterministicRelationId({
          fromId: property.id,
          typeId: SystemIds.RELATION_VALUE_RELATIONSHIP_TYPE,
          toId: toTypeId,
          spaceId: TARGET_SPACE_ID,
          sourceKey: `relation-value-type:${property.name}:${toTypeId}`,
        }),
        fromEntity: property.id,
        toEntity: toTypeId,
        type: SystemIds.RELATION_VALUE_RELATIONSHIP_TYPE,
      });
    }
  }
}

function buildSourceMap(wave) {
  const sourceMap = new Map();

  for (const definition of wave.sources) {
    const entity = ensureTypedEntity({
      data: definition,
      typeName: definition.type,
    });
    sourceMap.set(definition.name, entity);
    collections.sourcesAndDatasets.set(entity.id, entity.name);
  }

  for (const paper of wave.papers) {
    const entity = ensureTypedEntity({
      data: paper,
      typeName: "Paper",
    });
    sourceMap.set(paper.name, entity);
  }

  for (const definition of wave.sources) {
    const entity = sourceMap.get(definition.name);
    addSourceLinks(entity, definition.sources ?? [], sourceMap, `source-provenance:${definition.name}`);
  }

  for (const paper of wave.papers) {
    const entity = sourceMap.get(paper.name);
    addSourceLinks(entity, paper.sources ?? [], sourceMap, `paper-provenance:${paper.name}`);
  }

  return sourceMap;
}

function resolvePacket(packet, sourceMap) {
  const disease = ensureTypedEntity({
    data: packet.disease,
    typeName: "Disease",
  });
  addSourceLinks(
    disease,
    sourceNamesForEntity(packet.disease, "Disease"),
    sourceMap,
    `disease:${packet.importBatch}:${packet.disease.name}`
  );

  const entities = {
    disease,
    genes: new Map(),
    drugs: new Map(),
    drugClasses: new Map(),
    pathways: new Map(),
    biologicalProcesses: new Map(),
    molecularFunctions: new Map(),
    cellularComponents: new Map(),
    symptoms: new Map(),
    anatomy: new Map(),
    similarDiseases: new Map(),
    palliativeDrugs: new Map(),
    expressionGenes: new Map(),
  };

  function resolveMany(bucket, typeName, targetMap, evidenceRole = null) {
    for (const data of packet.entities[bucket] ?? []) {
      const entity = ensureTypedEntity({ data, typeName, evidenceRole });
      targetMap.set(data.name, entity);
      addSourceLinks(
        entity,
        sourceNamesForEntity(data, typeName),
        sourceMap,
        `${typeName}:${packet.importBatch}:${data.name}`
      );
    }
  }

  resolveMany("genes", "Gene", entities.genes);
  resolveMany("drugs", "Drug", entities.drugs);
  resolveMany("drugClasses", "Drug class", entities.drugClasses);
  resolveMany("pathways", "Pathway", entities.pathways);
  resolveMany("biologicalProcesses", "Biological Process", entities.biologicalProcesses);
  resolveMany("molecularFunctions", "Molecular Function", entities.molecularFunctions);
  resolveMany("cellularComponents", "Cellular Component", entities.cellularComponents);
  resolveMany("symptoms", "Symptom", entities.symptoms);
  resolveMany("anatomy", "Anatomical structure", entities.anatomy);
  resolveMany("similarDiseases", "Disease", entities.similarDiseases, "similarDisease");
  resolveMany("palliativeDrugs", "Drug", entities.palliativeDrugs, "palliativeDrug");
  resolveMany("expressionGenes", "Gene", entities.expressionGenes, "expressionGene");

  return entities;
}

function createPacketRelations(packet, entities, sourceMap) {
  for (const relation of packet.relations.associatedGenes ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: relationPropertyId("Associated with"),
      propertyName: "Associated with",
      toEntity: entities.genes.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.treats ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.drugs.get(relation.from),
      typeId: sharedProperties.Treats.id,
      propertyName: "Treats",
      toEntity: entities.disease,
      sourceMap,
    });
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: sharedProperties["Related drugs"].id,
      propertyName: "Related drugs",
      toEntity: entities.drugs.get(relation.from),
      sourceMap,
      includeEvidence: false,
    });
  }

  for (const relation of packet.relations.includesDrug ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.drugClasses.get(relation.from),
      typeId: relationPropertyId("Includes"),
      propertyName: "Includes",
      toEntity: entities.drugs.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.participatesInPathway ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.genes.get(relation.from),
      typeId: relationPropertyId("Participates in pathway"),
      propertyName: "Participates in pathway",
      toEntity: entities.pathways.get(relation.to),
      sourceMap,
    });
  }

  const diseasePathways = new Set();
  for (const relation of packet.relations.participatesInPathway ?? []) {
    if (diseasePathways.has(relation.to)) continue;
    diseasePathways.add(relation.to);
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: sharedProperties["Related pathways"].id,
      propertyName: "Related pathways",
      toEntity: entities.pathways.get(relation.to),
      sourceMap,
      includeEvidence: false,
    });
  }

  for (const relation of packet.relations.participatesInBiologicalProcess ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.genes.get(relation.from),
      typeId: relationPropertyId("Participates in biological process"),
      propertyName: "Participates in biological process",
      toEntity: entities.biologicalProcesses.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.hasMolecularFunction ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.genes.get(relation.from),
      typeId: relationPropertyId("Has molecular function"),
      propertyName: "Has molecular function",
      toEntity: entities.molecularFunctions.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.locatedInCellularComponent ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.genes.get(relation.from),
      typeId: relationPropertyId("Located in cellular component"),
      propertyName: "Located in cellular component",
      toEntity: entities.cellularComponents.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.symptomEvidence ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: relationPropertyId("Presents with"),
      propertyName: "Presents with",
      toEntity: entities.symptoms.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.anatomyEvidence ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: relationPropertyId("Localizes to"),
      propertyName: "Localizes to",
      toEntity: entities.anatomy.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.diseaseSimilarityEvidence ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: relationPropertyId("Resembles"),
      propertyName: "Resembles",
      toEntity: entities.similarDiseases.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.palliates ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.palliativeDrugs.get(relation.from),
      typeId: relationPropertyId("Palliates"),
      propertyName: "Palliates",
      toEntity: entities.disease,
      sourceMap,
    });
  }

  for (const relation of packet.relations.upregulatedGenes ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: relationPropertyId("Upregulates"),
      propertyName: "Upregulates",
      toEntity: entities.expressionGenes.get(relation.to),
      sourceMap,
    });
  }

  for (const relation of packet.relations.downregulatedGenes ?? []) {
    addClaim({
      packet,
      relation,
      fromEntity: entities.disease,
      typeId: relationPropertyId("Downregulates"),
      propertyName: "Downregulates",
      toEntity: entities.expressionGenes.get(relation.to),
      sourceMap,
    });
  }
}

function addReviewCollections() {
  const reviewPageId = deterministicEntityId(
    TARGET_SPACE_ID,
    "Geo local review",
    "Disease Atlas Wave 3 Review"
  );
  addEntity({
    id: reviewPageId,
    name: "Disease Atlas Wave 3 Review",
    description:
      "Local geo-local review page for the Disease Atlas Wave 3 import payload. Use the linked collection blocks to inspect diseases, genes, treatments, mechanisms, evidence relations, sources, datasets, and papers.",
    types: [SystemIds.PAGE_TYPE],
  });

  const blockConfigs = [
    ["Diseases", collections.diseases],
    ["Genes", collections.genes],
    ["Treating drugs", collections.drugs],
    ["Drug classes", collections.drugClasses],
    ["Pathways", collections.pathways],
    ["GO annotations", collections.goTerms],
    ["Symptoms", collections.symptoms],
    ["Anatomy evidence", collections.anatomy],
    ["Similar diseases", collections.similarDiseases],
    ["Palliative drugs", collections.palliativeDrugs],
    ["Expression genes", collections.expressionGenes],
    ["Evidence relations", collections.evidenceRelations],
    ["Datasets", collections.datasets],
    ["Sources", collections.sources],
    ["Sources and datasets", collections.sourcesAndDatasets],
    ["Papers", collections.papers],
  ];

  let index = 0;
  for (const [name, itemMap] of blockConfigs) {
    const blockId = deterministicEntityId(TARGET_SPACE_ID, "Geo local collection", name);
    addEntity({
      id: blockId,
      name,
      description: `Local review collection for ${name}.`,
      types: [SystemIds.DATA_BLOCK],
    });
    addRelation({
      id: deterministicRelationId({
        fromId: blockId,
        typeId: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
        toId: SystemIds.COLLECTION_DATA_SOURCE,
        spaceId: TARGET_SPACE_ID,
        sourceKey: `${name}:collection-source`,
      }),
      fromEntity: blockId,
      toEntity: SystemIds.COLLECTION_DATA_SOURCE,
      type: SystemIds.DATA_SOURCE_TYPE_RELATION_TYPE,
    });
    addRelation({
      id: deterministicRelationId({
        fromId: reviewPageId,
        typeId: SystemIds.BLOCKS,
        toId: blockId,
        spaceId: TARGET_SPACE_ID,
        sourceKey: `review-page:block:${index}:${name}`,
      }),
      fromEntity: reviewPageId,
      toEntity: blockId,
      type: SystemIds.BLOCKS,
    });

    let itemIndex = 0;
    for (const [itemId, itemName] of itemMap.entries()) {
      addRelation({
        id: deterministicRelationId({
          fromId: blockId,
          typeId: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
          toId: itemId,
          spaceId: TARGET_SPACE_ID,
          sourceKey: `${name}:item:${itemIndex}:${itemName}`,
        }),
        fromEntity: blockId,
        toEntity: itemId,
        type: SystemIds.COLLECTION_ITEM_RELATION_TYPE,
      });
      itemIndex += 1;
    }
    index += 1;
  }
}

function mutationFromEntity(entity) {
  const params = {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    types: entity.types,
  };
  if (entity.values.length > 0) params.values = entity.values;
  return { type: "createEntity", params };
}

function mutationFromRelation(relation) {
  const params = Object.fromEntries(
    Object.entries(relation).filter(([, value]) => value !== undefined && value !== null)
  );
  return { type: "createRelation", params };
}

function summarizePayload(wave) {
  return {
    packets: wave.packets.map((packet) => packet.disease.name),
    packetCount: wave.packets.length,
    entityCount: entityMap.size,
    relationCount: relationMap.size,
    collectionCounts: Object.fromEntries(
      Object.entries(collections).map(([key, itemMap]) => [key, itemMap.size])
    ),
    ontology: {
      sharedTypes: Object.keys(sharedTypes),
      localTypes: localSchema.types.map((type) => type.name),
      sharedProperties: Object.keys(sharedProperties),
      localProperties: [
        ...supportingLocalProperties.map((property) => property.name),
        ...localSchema.valueProperties.map((property) => property.name),
        ...localSchema.relationProperties.map((property) => property.name),
        ...evidenceSchema.valueProperties.map((property) => property.name),
        ...evidenceSchema.relationProperties.map((property) => property.name),
      ],
    },
  };
}

const wave = JSON.parse(await readFile(INPUT_PATH, "utf8"));

addOntologyEntities();
const sourceMap = buildSourceMap(wave);

for (const packet of wave.packets) {
  const entities = resolvePacket(packet, sourceMap);
  createPacketRelations(packet, entities, sourceMap);
}

addReviewCollections();

const mutations = [
  ...Array.from(entityMap.values()).map(mutationFromEntity),
  ...Array.from(relationMap.values()).map(mutationFromRelation),
];

const payload = {
  name: "Disease Atlas - Wave 3 geo-local review",
  generatedAt: new Date().toISOString(),
  targetSpaceId: TARGET_SPACE_ID,
  input: INPUT_PATH,
  summary: summarizePayload(wave),
  mutations,
};

await mkdir(fileURLToPath(new URL("../../data/geo-local/", import.meta.url)), {
  recursive: true,
});
await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      outputPath: OUTPUT_PATH,
      mutationCount: mutations.length,
      ...payload.summary,
    },
    null,
    2
  )
);
