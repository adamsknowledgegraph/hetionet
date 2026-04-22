# Geo Local Review

This project can load the Disease Atlas Wave 3 packet into a local
[`geo-local`](https://github.com/PierrickGT/geo-local) explorer before or after
publishing to Geo.

## What Is Running

- `geo-local` clone: `/Users/adamhome/Projects/geo-local`
- Local PostgreSQL: `/Users/adamhome/Projects/geo-local/.local/postgres-data`
- Local explorer: `http://localhost:3003`
- Local ingest API: `http://localhost:3001`
- Local read API: `http://localhost:3002/api`
- Review page entity: `60913c0c35b1df9a32e17d69d6c34fb3`

The `geo-local` `.env` only contains local ports, database URL, and
`SPACE_ID=141d3ace705feabc04d50c78bbf7226e`. It does not contain Geo private
keys. Both `.env` and `.local/` are ignored by `geo-local` git.

## Commands

From `/Users/adamhome/Projects/Hetionet`:

```bash
PATH=/Users/adamhome/.nvm/versions/node/v24.13.0/bin:$PATH npm run geo-local:start
```

This starts local PostgreSQL, runs migrations, and launches ingest, API,
indexer, and explorer.

In another terminal:

```bash
PATH=/Users/adamhome/.nvm/versions/node/v24.13.0/bin:$PATH npm run geo-local:export-wave3
PATH=/Users/adamhome/.nvm/versions/node/v24.13.0/bin:$PATH npm run geo-local:submit-wave3
```

Use a dry run when you only want to inspect the generated upload:

```bash
PATH=/Users/adamhome/.nvm/versions/node/v24.13.0/bin:$PATH DRY_RUN=1 npm run geo-local:submit-wave3
```

## Useful Review URLs

- Explorer home: `http://localhost:3003/entities`
- Wave 3 review page: `http://localhost:3003/entities/60913c0c35b1df9a32e17d69d6c34fb3`
- Breast cancer: `http://localhost:3003/entities/9c639f44dcaa51d4adf89b10f5b01cba`
- Evidence example: `http://localhost:3003/entities/c80c3094ad2bee9d99a869ceb57872b2`
- API diseases: `http://localhost:3002/api/entities?type=aa949a7e4e615830b37b793fac1257e5&limit=25&sort=properties_text&order=asc`
- API genes: `http://localhost:3002/api/entities?type=93a0c3dc71314daf862e66c3af8b4fe4&limit=25&sort=properties_text&order=asc`
- API sources: `http://localhost:3002/api/entities?type=706779bf537744a68694ea06cf87a3a2&limit=25&sort=properties_text&order=asc`

## Current Wave 3 Payload

Generated file:

```text
/Users/adamhome/Projects/Hetionet/data/geo-local/wave3-review-mutations.json
```

Current contents:

- 5 primary disease packets: Breast cancer, Hypertension, Type 2 diabetes mellitus, Alzheimer's disease, Crohn's disease
- 17 Disease-typed entities total, because disease-similarity evidence also creates linked disease entities
- 725 entities
- 4,965 relations
- 1,138 evidence relation entities
- 275 genes
- 40 drugs
- 26 drug classes
- 31 pathways
- 56 GO terms
- 80 symptoms
- 89 anatomy terms
- 19 sources
- 1 dataset
- 3 papers

## Local Patch

I patched `/Users/adamhome/Projects/geo-local/packages/api/src/routes.ts` so
`GET /api/entities?type=...` only uses Geo `Types` relations. Without that,
relation-property constraints such as `Treats -> Disease` polluted type-filtered
entity tables.

## Ontology Note

Regulation evidence uses generic `Upregulates` and `Downregulates` relation
properties. The current STARGEO disease packets link diseases to genes, but the
properties are intentionally unconstrained so the ontology can later represent
other regulation claims without creating disease-specific duplicate predicates.
