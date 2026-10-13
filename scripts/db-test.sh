#!/usr/bin/env bash
# Recria um banco local, aplica o shim do Supabase + migrations e roda os testes SQL.
# Uso: scripts/db-test.sh [nome_do_banco]
# Requer: PostgreSQL 15+ com btree_gist e pgcrypto; usuário com permissão de superusuário
# (por padrão "postgres" via sudo -u postgres, ou defina PSQL="psql -U ... -h ...").
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${1:-psi_test}"
PSQL="${PSQL:-sudo -u postgres psql}"
OUT="${ROOT}/docs/evidencias"
mkdir -p "$OUT"

run() { $PSQL -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "==> Recriando banco $DB"
run -d postgres -c "drop database if exists $DB with (force);" -c "create database $DB;"

echo "==> Shim local do Supabase"
run -d "$DB" -f "$ROOT/supabase/local-shim/00_supabase_shim.sql"

echo "==> Migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  run -d "$DB" -f "$f"
done

echo "==> Testes SQL"
LOG="$OUT/testes-sql.log"
: > "$LOG"
FAIL=0
for f in "$ROOT"/supabase/tests/*.sql; do
  name="$(basename "$f")"
  if run -d "$DB" -f "$f" >>"$LOG" 2>&1; then
    oks=$(grep -c "NOTICE:  ok - " "$LOG" || true)
    echo "    PASSOU  $name"
  else
    echo "    FALHOU  $name"
    FAIL=1
  fi
done
TOTAL=$(grep -c "NOTICE:  ok - " "$LOG" || true)
echo "==> Asserções aprovadas: $TOTAL (log: docs/evidencias/testes-sql.log)"
if [ "$FAIL" -ne 0 ]; then
  grep -E "ERROR|FALHOU" "$LOG" | head -20
  exit 1
fi
