#!/usr/bin/env bash
# Prepares a local Postgres for development and tests. Safe to run again.
#
# Creates the role `casino` (password `casino`) and the databases
# casino_dev, casino_test and casino_e2e. Local only: hosted databases are
# managed by Netlify and never touched by this script.
set -euo pipefail

as_postgres() {
  if [ "$(id -un)" = "postgres" ]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo -u postgres "$@"
  else su postgres -c "$(printf '%q ' "$@")"
  fi
}

if command -v pg_lsclusters >/dev/null 2>&1; then
  # Debian and Ubuntu: start the newest cluster if it is down.
  read -r version cluster _ status _ < <(pg_lsclusters --no-header | sort -k1,1nr | head -n1)
  if [ "${status:-}" != "online" ]; then
    pg_ctlcluster "$version" "$cluster" start
  fi
fi

as_postgres psql -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'casino') THEN
    CREATE ROLE casino LOGIN PASSWORD 'casino' CREATEDB;
  END IF;
END
$$;
SQL

for db in casino_dev casino_test casino_e2e; do
  if ! as_postgres psql -Atqc "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
    as_postgres createdb -O casino "$db"
    echo "created $db"
  fi
done

if [ ! -f .env ]; then
  cp .env.example .env
  echo "wrote .env from .env.example"
fi

echo "Local Postgres is ready. Run: npm run db:migrate:local"
