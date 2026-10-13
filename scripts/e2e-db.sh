#!/usr/bin/env bash
# Prepara o banco local "psi_e2e" (shim Supabase + migrations + papel do gateway)
# para testes de integração/E2E via dev-gateway. Somente desenvolvimento.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${1:-psi_e2e}"
PSQL="${PSQL:-sudo -u postgres psql}"
q() { $PSQL -X -q -v ON_ERROR_STOP=1 "$@"; }
q -d postgres -c "drop database if exists $DB with (force);" -c "create database $DB;" >/dev/null
q -d "$DB" -f "$ROOT/supabase/local-shim/00_supabase_shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do q -d "$DB" -f "$f" >/dev/null; done
q -d "$DB" -f "$ROOT/dev-gateway/setup.sql" >/dev/null
rm -rf "$ROOT/dev-gateway/.storage"
echo "Banco $DB pronto."
