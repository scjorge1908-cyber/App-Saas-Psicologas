-- =============================================================================
-- Teste 06 — Regressão dos achados da auditoria independente (docs/SEGURANCA.md)
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.hard@exemplo.invalid', 'Ana Hard', '06/313131'));
select tests.put('B', tests.create_user('bia.hard@exemplo.invalid', 'Bia Hard', '06/323232'));

-- H1: TRUNCATE
select tests.login(tests.id('B'));
insert into public.expenses (description, amount) values ('Despesa da Bia', 10);
reset role;
select tests.login(tests.id('A'));
select tests.throws('truncate public.expenses', '42501', 'H1: usuário não executa TRUNCATE');
select tests.throws('truncate public.charges cascade', '42501', 'H1: TRUNCATE em cascata bloqueado');
reset role;
select tests.ok(not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type = 'TRUNCATE' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'H1: nenhum TRUNCATE concedido a clientes');

-- L2: anon executa só as duas RPCs públicas
select tests.eq((
  select array_agg(p.proname::text order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['get_confirmation', 'respond_confirmation'], 'L2: anon só executa get_confirmation e respond_confirmation');

-- H2: histórico de sessões
select tests.login(tests.id('A'));
with _i as (insert into public.patients (full_name, session_price) values ('Paciente Hard', 100) returning id) select tests.put('P', id) from _i;
with _i as (insert into public.patients (full_name) values ('Outra Paciente') returning id) select tests.put('P2', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, status) values
  (tests.id('P'), now() - interval '2 days', now() - interval '2 days' + interval '50 min', 'atendido') returning id) select tests.put('PAST', id) from _i;
select tests.throws(format('delete from public.appointments where id = %L', tests.id('PAST')), 'P0001', 'H2: sessão atendida não pode ser excluída');
update public.appointments set status = 'agendado' where id = tests.id('PAST'); -- correção permitida (sem prontuário)
select tests.throws(format('delete from public.appointments where id = %L', tests.id('PAST')), 'P0001', 'H2: sessão passada não pode ser excluída nem após desfazer o status');
select tests.throws(format('delete from public.patients where id = %L', tests.id('P')), 'P0001', 'H2: paciente com sessão passada não pode ser excluído');
update public.appointments set status = 'atendido' where id = tests.id('PAST');
insert into public.record_entries (patient_id, appointment_id, content) values (tests.id('P'), tests.id('PAST'), 'Evolução fictícia');
select tests.throws(format($q$update public.appointments set status = 'agendado' where id = %L$q$, tests.id('PAST')), 'P0001', 'H2: status não pode ser desfeito com prontuário vinculado');
select tests.throws(format('update public.appointments set patient_id = %L where id = %L', tests.id('P2'), tests.id('PAST')), 'P0001', 'H2: sessão registrada não troca de paciente');

with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'avaliacao', tests.id('A')::text || '/x/aval.pdf', 'aval.pdf', 'application/pdf', 10) returning id) select tests.put('AV', id) from _i;
select tests.throws(format('update public.attachments set patient_id = null where id = %L', tests.id('AV')), 'P0001', 'H2: anexo de avaliação não é desvinculado');
select tests.throws(format('update public.attachments set patient_id = %L where id = %L', tests.id('P2'), tests.id('AV')), 'P0001', 'H2: anexo de avaliação não muda de paciente');

-- M1: datas e versões forjadas
with _i as (insert into public.record_entries (patient_id, content, version, created_at)
  values (tests.id('P'), 'Registro com data forjada', 99, '2001-01-01') returning id) select tests.put('R', id) from _i;
select tests.ok((select version = 1 and created_at > now() - interval '1 minute' and not restored_from_backup from public.record_entries where id = tests.id('R')),
  'M1: versão e data de criação forçadas no INSERT');
update public.record_entries set created_at = '1999-01-01' where id = tests.id('R');
select tests.ok((select created_at > now() - interval '1 minute' from public.record_entries where id = tests.id('R')), 'M1: data de criação imutável');
select tests.throws(format('update public.record_entries set appointment_id = %L where id = %L', tests.id('PAST'), tests.id('R')), 'P0001', 'M1: sessão vinculada imutável');

with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'outro', tests.id('A')::text || '/x/outro.pdf', 'outro.pdf', 'application/pdf', 10) returning id) select tests.put('OUT', id) from _i;
select tests.throws(format('insert into public.documents (patient_id, doc_type, title, attachment_id) values (%L, %L, %L, %L)', tests.id('P'), 'declaracao', 'Declaração', tests.id('OUT')),
  'P0001', 'L1: PDF de documento precisa ser anexo do tipo documento emitido');
with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'documento_emitido', tests.id('A')::text || '/x/d.pdf', 'd.pdf', 'application/pdf', 10) returning id) select tests.put('DA', id) from _i;
with _i as (insert into public.documents (patient_id, doc_type, title, attachment_id, created_at, delivered_at)
  values (tests.id('P'), 'declaracao', 'Declaração', tests.id('DA'), '2001-01-01', '2001-01-02') returning id) select tests.put('D', id) from _i;
select tests.ok((select created_at > now() - interval '1 minute' and delivered_at is null from public.documents where id = tests.id('D')), 'M1: documento nasce com data real e sem entrega');
select tests.throws(format($q$update public.documents set created_at = '2030-01-01' where id = %L$q$, tests.id('D')), 'P0001', 'M1: data do documento imutável');
update public.documents set delivered_at = '2001-01-01', delivered_to = 'Responsável' where id = tests.id('D');
select tests.ok((select delivered_at > now() - interval '1 minute' from public.documents where id = tests.id('D')), 'M1: entrega registrada com horário do servidor');
select tests.throws(format('update public.documents set delivered_at = null, delivered_to = null where id = %L', tests.id('D')), 'P0001', 'M1: entrega não pode ser apagada');

-- M2 + resposta do paciente
with _i as (insert into public.appointments (patient_id, starts_at, ends_at) values
  (tests.id('P'), now() + interval '3 days', now() + interval '3 days 50 min') returning id) select tests.put('FUT', id) from _i;
create temp table tk as select public.create_confirmation_link(tests.id('FUT')) as t;
grant select on tk to anon;
update public.appointments set patient_id = tests.id('P2') where id = tests.id('FUT');
update public.appointments set patient_response = 'confirmou', responded_at = now() where id = tests.id('FUT');
select tests.ok((select patient_response is null from public.appointments where id = tests.id('FUT')), 'Profissional não forja resposta do paciente');
reset role;
select tests.login_anon();
select tests.eq((public.get_confirmation((select t from tk)) ->> 'state'), 'invalido', 'M2: link antigo invalidado ao trocar o paciente');
reset role;

-- Série encerrada hoje não tenta apagar sessões passadas
select tests.login(tests.id('A'));
create temp table s as select public.create_appointment_series(tests.id('P2'), 'semanal', (current_date - 14), '06:00', 50, null, 4) as r;
select tests.ok(public.end_appointment_series(((select r ->> 'series_id' from s))::uuid, current_date - 14) >= 0, 'Encerrar série com ocorrências passadas não falha');
select tests.eq((select count(*) from public.appointments where series_id = ((select r ->> 'series_id' from s))::uuid and starts_at < now())::int,
  (select count(*) from jsonb_array_elements((select r -> 'created' from s)) e where (e ->> 'starts_at')::timestamptz < now())::int,
  'Ocorrências passadas da série são preservadas');
reset role;

-- Isolamento continua: B não vê nada de A
select tests.login(tests.id('B'));
select tests.eq((select count(*) from public.appointments)::int + (select count(*) from public.record_entries)::int, 0, 'Isolamento preservado após endurecimento');
reset role;

rollback;
