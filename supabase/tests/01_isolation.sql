-- =============================================================================
-- Teste 01 — Isolamento entre profissionais (RLS + FKs compostas + grants)
-- Critério: "Uma profissional não consegue acessar dados de outra."
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.teste@exemplo.invalid', 'Ana Fictícia', '06/111111'));
select tests.put('B', tests.create_user('bia.teste@exemplo.invalid', 'Bia Fictícia', '12/222222'));

-- ---- A cria dados de todos os tipos ----
select tests.login(tests.id('A'));
with _i as (insert into public.patients (full_name, session_price) values ('Paciente Fictício Um', 150) returning id) select tests.put('A_pat', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, price)
  values (tests.id('A_pat'), now() - interval '2 days', now() - interval '2 days' + interval '50 minutes', 150)
  returning id) select tests.put('A_appt_past', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, price)
  values (tests.id('A_pat'), now() + interval '3 days', now() + interval '3 days' + interval '50 minutes', 150)
  returning id) select tests.put('A_appt_future', id) from _i;
update public.appointments set status = 'atendido' where id = tests.id('A_appt_past');
with _i as (insert into public.record_entries (patient_id, content) values (tests.id('A_pat'), 'Conteúdo clínico fictício') returning id) select tests.put('A_rec', id) from _i;
update public.record_entries set content = 'Conteúdo clínico fictício (retificado)' where id = tests.id('A_rec');
with _i as (insert into public.expenses (description, amount) values ('Aluguel fictício', 500) returning id) select tests.put('A_exp', id) from _i;
insert into storage.objects (bucket_id, name, owner) values ('prontuario', tests.id('A')::text || '/' || tests.id('A_pat')::text || '/a.pdf', tests.id('A'));
select tests.eq((select count(*) from public.charges)::int, 1, 'A: cobrança automática criada para sessão atendida');
select tests.eq((select count(*) from public.record_entry_versions)::int, 1, 'A: versão anterior do registro preservada');
reset role;

-- ---- B não enxerga nem altera nada de A ----
select tests.login(tests.id('B'));
select tests.eq((select count(*) from public.patients)::int, 0, 'B não vê pacientes de A');
select tests.eq((select count(*) from public.appointments)::int, 0, 'B não vê agendamentos de A');
select tests.eq((select count(*) from public.appointment_series)::int, 0, 'B não vê séries de A');
select tests.eq((select count(*) from public.record_entries)::int, 0, 'B não vê prontuário de A');
select tests.eq((select count(*) from public.record_entry_versions)::int, 0, 'B não vê versões do prontuário de A');
select tests.eq((select count(*) from public.charges)::int, 0, 'B não vê cobranças de A');
select tests.eq((select count(*) from public.charge_balances)::int, 0, 'B não vê saldos (view) de A');
select tests.eq((select count(*) from public.expenses)::int, 0, 'B não vê despesas de A');
select tests.eq((select count(*) from public.audit_log where owner_id <> tests.id('B'))::int, 0, 'B não vê auditoria de A (só a própria)');
select tests.eq((select count(*) from public.profiles)::int, 1, 'B vê apenas o próprio perfil');
select tests.eq((select count(*) from storage.objects)::int, 0, 'B não vê arquivos de A no storage');

select tests.eq(tests.affected(format('update public.patients set full_name = %L where id = %L', 'Hack', tests.id('A_pat'))), 0, 'B não altera paciente de A');
select tests.eq(tests.affected(format('update public.record_entries set content = %L where id = %L', 'Hack', tests.id('A_rec'))), 0, 'B não altera prontuário de A');
select tests.eq(tests.affected(format('delete from public.expenses where id = %L', tests.id('A_exp'))), 0, 'B não exclui despesa de A');
select tests.eq(tests.affected(format('update public.profiles set full_name = %L where id = %L', 'Hack', tests.id('A'))), 0, 'B não altera perfil de A');

select tests.throws(format('insert into public.patients (owner_id, full_name) values (%L, %L)', tests.id('A'), 'Intruso'),
  '42501', 'B não insere linhas em nome de A (RLS WITH CHECK)');
select tests.throws(format('insert into public.appointments (patient_id, starts_at, ends_at) values (%L, now() + interval ''10 days'', now() + interval ''10 days 50 minutes'')', tests.id('A_pat')),
  '23503', 'B não agenda sessão para paciente de A (FK composta)');
select tests.throws(format('insert into public.record_entries (patient_id, content) values (%L, %L)', tests.id('A_pat'), 'x'),
  '23503', 'B não escreve no prontuário de paciente de A (FK composta)');
select tests.throws(format('insert into storage.objects (bucket_id, name) values (''prontuario'', %L)', tests.id('A')::text || '/x/y.pdf'),
  '42501', 'B não grava arquivo na pasta de A no storage');
select tests.throws(format('select public.create_confirmation_link(%L)', tests.id('A_appt_future')),
  'P0002', 'B não gera link de confirmação para sessão de A');
select tests.throws(format('select public.extend_appointment_series(%L, current_date + 30)', tests.id('A_appt_future')),
  'P0002', 'B não manipula séries inexistentes/alheias');
select tests.throws('select * from public.confirmation_tokens', '42501', 'Tabela de tokens inacessível a usuários');
select tests.throws('insert into public.audit_log (owner_id, actor, action, table_name) values (auth.uid(), ''x'', ''x'', ''x'')',
  '42501', 'Usuário não escreve diretamente na auditoria');
reset role;

-- ---- Anônimo não acessa tabelas ----
select tests.login_anon();
select tests.throws('select * from public.patients', '42501', 'Anônimo sem acesso a pacientes');
select tests.throws('select * from public.record_entries', '42501', 'Anônimo sem acesso a prontuário');
select tests.throws('select * from public.profiles', '42501', 'Anônimo sem acesso a perfis');
select tests.throws('select * from public.charge_balances', '42501', 'Anônimo sem acesso a financeiro');
select tests.throws(format('select public.create_confirmation_link(%L)', tests.id('A_appt_future')), '42501', 'Anônimo não gera links');
select tests.throws('select public.export_my_data()', '42501', 'Anônimo não exporta dados');
select tests.eq((select count(*) from storage.objects)::int, 0, 'Anônimo não lista arquivos');
reset role;

-- ---- Auditoria sem conteúdo clínico ----
select tests.ok(
  not exists (select 1 from public.audit_log where changed_fields::text ilike '%fictício%'),
  'Auditoria não contém conteúdo clínico, apenas nomes de colunas');
select tests.ok(
  exists (select 1 from public.audit_log where table_name = 'record_entries' and action = 'UPDATE' and 'content' = any(changed_fields)),
  'Auditoria registra QUE o prontuário foi alterado (coluna), sem o texto');

-- ---- Todas as tabelas do schema public têm RLS ativo ----
select tests.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  'RLS habilitado em todas as tabelas do schema public');

rollback;
