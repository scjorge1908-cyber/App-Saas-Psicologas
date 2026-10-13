#!/usr/bin/env bash
# Teste de backup e restauração em ambiente local seguro (dados fictícios).
#  1) Banco de origem: cria profissional + dados fictícios de todos os tipos.
#  2) Exporta via export_my_data() (mesma função usada pelo app).
#  3) Banco NOVO e vazio (simula perda total): cria conta, importa com
#     import_my_data() e compara o conteúdo restaurado com o original.
#  4) Backup operacional: pg_dump do banco de origem + pg_restore num terceiro
#     banco, com conferência de contagens.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="${PSQL:-sudo -u postgres psql}"
PGDUMP="${PGDUMP:-sudo -u postgres pg_dump}"
PGRESTORE="${PGRESTORE:-sudo -u postgres pg_restore}"
OUT="$ROOT/docs/evidencias"
WORK="$(mktemp -d)"; chmod 777 "$WORK"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
LOG="$OUT/teste-backup-restauracao.log"; : > "$LOG"
log() { echo "$*" | tee -a "$LOG"; }
q() { $PSQL -X -q -v ON_ERROR_STOP=1 "$@"; }

fresh_db() {
  q -d postgres -c "drop database if exists $1 with (force);" -c "create database $1;" >/dev/null
  q -d "$1" -f "$ROOT/supabase/local-shim/00_supabase_shim.sql" >/dev/null
  for f in "$ROOT"/supabase/migrations/*.sql; do q -d "$1" -f "$f" >/dev/null; done
}

log "== Preparando banco de origem (psi_bk_src)"
fresh_db psi_bk_src
q -d psi_bk_src >/dev/null <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'origem@exemplo.invalid', '{"full_name":"Psicóloga Origem"}');
update public.profiles set crp = '06/101010', default_price = 160, onboarded_at = now()
 where id = '11111111-1111-1111-1111-111111111111';
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
set role authenticated;
insert into public.patients (id, full_name, cpf, session_price) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Paciente Backup Um', '12345678909', 160),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Paciente Backup Dois', null, 120);
select public.create_appointment_series('aaaaaaaa-0000-0000-0000-000000000001', 'semanal', current_date + 7, '10:00', 50, null, 5, 160, 'presencial');
insert into public.appointments (id, patient_id, starts_at, ends_at, price) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', now() - interval '5 days', now() - interval '5 days' + interval '50 min', 120);
update public.appointments set status = 'atendido' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
insert into public.record_entries (id, patient_id, appointment_id, content)
  values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Evolução fictícia original');
update public.record_entries set content = 'Evolução fictícia retificada' where id = 'cccccccc-0000-0000-0000-000000000001';
insert into public.attachments (id, patient_id, category, storage_path, file_name, mime_type, size_bytes) values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'documento_emitido',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000002/decl.pdf', 'decl.pdf', 'application/pdf', 1234);
insert into public.documents (patient_id, doc_type, title, attachment_id) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'declaracao', 'Declaração', 'dddddddd-0000-0000-0000-000000000001');
insert into public.payments (patient_id, charge_id, amount, method)
  select patient_id, id, 70, 'pix' from public.charges limit 1;
insert into public.expenses (description, amount) values ('Despesa fictícia', 89.9);
insert into public.invoices (patient_id, amount) values ('aaaaaaaa-0000-0000-0000-000000000002', 120);
SQL

log "== Exportando (export_my_data)"
q -d psi_bk_src -t -A -o "$WORK/export.json" -c "select set_config('request.jwt.claims', '{\"sub\":\"11111111-1111-1111-1111-111111111111\",\"role\":\"authenticated\"}', false); set role authenticated; select public.export_my_data();"
# Primeira linha é o resultado do set_config; a segunda é o JSON
tail -n 1 "$WORK/export.json" > "$WORK/backup.json"
log "   tamanho do backup: $(wc -c < "$WORK/backup.json") bytes"

log "== Restaurando num banco novo e vazio (psi_bk_dst)"
fresh_db psi_bk_dst
q -d psi_bk_dst -c "insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'restaurada@exemplo.invalid');" >/dev/null
cp "$WORK/backup.json" "$WORK/in.json"; chmod 644 "$WORK/in.json"
q -d psi_bk_dst -v ON_ERROR_STOP=1 >/dev/null <<SQL
create temp table bk (j jsonb);
\copy bk from program 'cat $WORK/in.json | sed "s/\\\\\\\\/\\\\\\\\\\\\\\\\/g"' with (format text)
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
grant select on bk to authenticated;
set role authenticated;
create temp table res as select public.import_my_data((select j from bk)) as r;
SQL

log "== Comparando origem x restaurado"
COMPARE_SQL="select concat_ws('|',
 (select count(*) from public.patients), (select count(*) from public.appointments),
 (select count(*) from public.appointment_series), (select count(*) from public.record_entries),
 (select count(*) from public.record_entry_versions), (select count(*) from public.attachments),
 (select count(*) from public.documents), (select count(*) from public.charges),
 (select count(*) from public.payments), (select count(*) from public.expenses),
 (select count(*) from public.invoices),
 (select sum(amount) from public.payments), (select sum(amount) from public.charges),
 (select string_agg(content, ',' order by id) from public.record_entries),
 (select string_agg(content, ',' order by id) from public.record_entry_versions),
 (select string_agg(id::text || status::text || starts_at::text, ',' order by id) from public.appointments),
 (select string_agg(id::text || full_name || coalesce(cpf,''), ',' order by id) from public.patients))"
SRC=$(q -d psi_bk_src -t -A -c "$COMPARE_SQL")
DST=$(q -d psi_bk_dst -t -A -c "$COMPARE_SQL")
log "   origem   : ${SRC:0:120}..."
log "   restauro : ${DST:0:120}..."
if [ "$SRC" != "$DST" ]; then log "FALHOU: conteúdo restaurado difere do original"; exit 1; fi
OWN=$(q -d psi_bk_dst -t -A -c "select count(*) from public.patients where owner_id <> '22222222-2222-2222-2222-222222222222'")
[ "$OWN" = "0" ] || { log "FALHOU: owner_id não remapeado"; exit 1; }
PATH_OK=$(q -d psi_bk_dst -t -A -c "select bool_and(storage_path like '22222222-2222-2222-2222-222222222222/%') from public.attachments")
[ "$PATH_OK" = "t" ] || { log "FALHOU: caminhos de anexos não remapeados"; exit 1; }
log "ok - restauração lógica idêntica (contagens, valores, textos clínicos e versões); owner e caminhos remapeados"

# Restaurar de novo na mesma conta deve ser recusado
set +e
q -d psi_bk_dst >/dev/null 2>"$WORK/err.txt" <<SQL
create temp table bk (j jsonb);
\copy bk from program 'cat $WORK/in.json | sed "s/\\\\\\\\/\\\\\\\\\\\\\\\\/g"' with (format text)
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
grant select on bk to authenticated;
set role authenticated;
select public.import_my_data((select j from bk));
SQL
RC=$?
set -e
if [ $RC -eq 0 ] || ! grep -q "conta sem dados" "$WORK/err.txt"; then log "FALHOU: importação duplicada não foi bloqueada"; exit 1; fi
log "ok - restauração sobre conta com dados é recusada"

log "== Backup operacional: pg_dump (formato custom) + pg_restore"
$PGDUMP -Fc -d psi_bk_src -f "$WORK/full.dump"
log "   dump: $(wc -c < "$WORK/full.dump") bytes"
q -d postgres -c "drop database if exists psi_bk_pitr with (force);" -c "create database psi_bk_pitr;" >/dev/null
$PGRESTORE -d psi_bk_pitr --no-owner "$WORK/full.dump"
SRC2=$(q -d psi_bk_src -t -A -c "$COMPARE_SQL")
DST2=$(q -d psi_bk_pitr -t -A -c "$COMPARE_SQL")
[ "$SRC2" = "$DST2" ] || { log "FALHOU: pg_restore difere"; exit 1; }
log "ok - pg_dump/pg_restore reproduz o banco integralmente"

q -d postgres -c "drop database psi_bk_src with (force);" -c "drop database psi_bk_dst with (force);" -c "drop database psi_bk_pitr with (force);" >/dev/null
log "== Backup e restauração: TODOS OS TESTES PASSARAM"
