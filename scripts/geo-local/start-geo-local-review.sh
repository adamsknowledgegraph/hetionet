#!/usr/bin/env bash
set -euo pipefail

export PATH="/Users/adamhome/.nvm/versions/node/v24.13.0/bin:$PATH"

GEO_LOCAL_DIR="${GEO_LOCAL_DIR:-/Users/adamhome/Projects/geo-local}"
PG_APP="${PG_APP:-/Users/adamhome/Applications/Postgres-GeoLocal.app}"
PG_BIN="$PG_APP/Contents/Versions/16/bin"
PGDATA="$GEO_LOCAL_DIR/.local/postgres-data"
PGLOG="$GEO_LOCAL_DIR/.local/postgres.log"

mkdir -p "$GEO_LOCAL_DIR/.local"

if [ ! -x "$PG_BIN/postgres" ]; then
  echo "Missing PostgreSQL binary at $PG_BIN/postgres"
  echo "Install Postgres.app for geo-local first, or set PG_APP to the app path."
  exit 1
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  "$PG_BIN/initdb" -D "$PGDATA" --username=postgres --auth=trust --encoding=UTF8 --locale=C
fi

if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-p 5433" -l "$PGLOG" start
fi

"$PG_BIN/createdb" -h localhost -p 5433 -U postgres geo 2>/dev/null || true

cd "$GEO_LOCAL_DIR"
pnpm db:migrate
pnpm -r --parallel run dev
