-- =============================================================================
-- Teste 02 — Agenda: conflitos, recorrência, remarcação, cancelamento, status
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.agenda@exemplo.invalid', 'Ana Agenda', '06/111112'));
select tests.put('B', tests.create_user('bia.agenda@exemplo.invalid', 'Bia Agenda', '06/111113'));
select tests.login(tests.id('A'));
with _i as (insert into public.patients (full_name) values ('Paciente Agenda Um') returning id) select tests.put('P1', id) from _i;
with _i as (insert into public.patients (full_name) values ('Paciente Agenda Dois') returning id) select tests.put('P2', id) from _i;

-- ---- Conflitos ----
with _i as (insert into public.appointments (patient_id, starts_at, ends_at)
  values (tests.id('P1'), '2030-03-04 14:00-03', '2030-03-04 14:50-03') returning id)
select tests.put('S1', id) from _i;

select tests.throws(format($q$insert into public.appointments (patient_id, starts_at, ends_at)
  values (%L, '2030-03-04 14:30-03', '2030-03-04 15:20-03')$q$, tests.id('P2')),
  '23P01', 'Sobreposição parcial é bloqueada pelo banco');
select tests.throws(format($q$insert into public.appointments (patient_id, starts_at, ends_at)
  values (%L, '2030-03-04 13:00-03', '2030-03-04 16:00-03')$q$, tests.id('P2')),
  '23P01', 'Sessão que engloba outra é bloqueada');
select tests.eq(tests.affected(format($q$insert into public.appointments (patient_id, starts_at, ends_at)
  values (%L, '2030-03-04 14:50-03', '2030-03-04 15:40-03')$q$, tests.id('P2'))), 1,
  'Sessões encostadas (fim = início) são permitidas');
select tests.throws(format($q$update public.appointments set starts_at = '2030-03-04 15:00-03', ends_at = '2030-03-04 15:50-03' where id = %L$q$, tests.id('S1')),
  '23P01', 'Remarcação para horário ocupado é bloqueada');

update public.appointments set status = 'cancelado', canceled_by = 'profissional', cancel_reason = 'teste' where id = tests.id('S1');
select tests.eq(tests.affected(format($q$insert into public.appointments (patient_id, starts_at, ends_at)
  values (%L, '2030-03-04 14:00-03', '2030-03-04 14:50-03')$q$, tests.id('P2'))), 1,
  'Horário de sessão cancelada fica livre');
select tests.throws(format($q$update public.appointments set status = 'agendado' where id = %L$q$, tests.id('S1')),
  '23P01', 'Reativar sessão cancelada em horário já ocupado é bloqueado');
select tests.throws($q$update public.appointments set status = 'cancelado' where starts_at = '2030-03-04 14:50-03'$q$,
  '23514', 'Cancelamento exige informar quem cancelou');
reset role;

-- Outra profissional pode usar o mesmo horário (conflito é por profissional)
select tests.login(tests.id('B'));
with _i as (insert into public.patients (full_name) values ('Paciente da Bia') returning id) select tests.put('PB', id) from _i;
select tests.eq(tests.affected(format($q$insert into public.appointments (patient_id, starts_at, ends_at)
  values (%L, '2030-03-04 14:00-03', '2030-03-04 14:50-03')$q$, tests.id('PB'))), 1,
  'Mesmo horário em agendas de profissionais diferentes não conflita');
reset role;

-- ---- Recorrência ----
select tests.login(tests.id('A'));
-- Ocupa 2030-03-25 10:00 para provocar conflito na série
insert into public.appointments (patient_id, starts_at, ends_at)
values (tests.id('P2'), '2030-03-25 10:00-03', '2030-03-25 10:50-03');

create temp table r1 as
select public.create_appointment_series(tests.id('P1'), 'semanal', '2030-03-11', '10:00', 50, null, 4, 180, 'presencial') as r;
select tests.eq(jsonb_array_length((select r -> 'created' from r1)), 3, 'Série semanal de 4: 3 criadas');
select tests.eq(jsonb_array_length((select r -> 'conflicts' from r1)), 1, 'Série semanal de 4: 1 conflito reportado');
select tests.eq(((select r -> 'conflicts' -> 0 ->> 'starts_at' from r1))::timestamptz, '2030-03-25 10:00-03'::timestamptz,
  'Conflito reportado na data correta (25/03)');
select tests.put('SER1', (select (r ->> 'series_id')::uuid from r1));
select tests.eq((select array_agg(to_char(starts_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') order by starts_at)
                   from public.appointments where series_id = tests.id('SER1')),
  array['2030-03-11 10:00', '2030-03-18 10:00', '2030-04-01 10:00'],
  'Ocorrências semanais no horário local correto, pulando o conflito');
select tests.eq((select bool_and(price = 180 and ends_at - starts_at = interval '50 minutes')
                   from public.appointments where series_id = tests.id('SER1')), true,
  'Ocorrências herdam valor e duração da série');

create temp table r2 as
select public.create_appointment_series(tests.id('P2'), 'quinzenal', '2030-04-02', '08:00', 50, '2030-05-14', null, null, 'online') as r;
select tests.eq((select array_agg(to_char(starts_at at time zone 'America/Sao_Paulo', 'MM-DD') order by starts_at)
                   from public.appointments where series_id = ((select r ->> 'series_id' from r2))::uuid),
  array['04-02', '04-16', '04-30', '05-14'], 'Série quinzenal respeita intervalo de 14 dias e data final');

create temp table r3 as
select public.create_appointment_series(tests.id('P2'), 'mensal', '2030-06-03', '18:00', 50, null, 3, null, 'presencial') as r;
select tests.eq((select array_agg(to_char(starts_at at time zone 'America/Sao_Paulo', 'MM-DD') order by starts_at)
                   from public.appointments where series_id = ((select r ->> 'series_id' from r3))::uuid),
  array['06-03', '07-01', '07-29'], 'Série "mensal" = a cada 4 semanas, mesmo dia da semana');

-- Série sem fim: materializa ~26 semanas
create temp table r4 as
select public.create_appointment_series(tests.id('P1'), 'semanal', '2031-01-06', '09:00', 50) as r;
select tests.eq(jsonb_array_length((select r -> 'created' from r4)), 27, 'Série sem data final materializa 26 semanas à frente');

-- Estender série
select tests.eq(jsonb_array_length((public.extend_appointment_series(((select r ->> 'series_id' from r4))::uuid, '2031-07-21')) -> 'created'), 2,
  'Extensão gera apenas as ocorrências novas');

-- Encerrar série (alta): remove só futuras não realizadas
select tests.eq(public.end_appointment_series(tests.id('SER1'), '2030-03-18'), 2, 'Encerrar série remove ocorrências a partir da data');
select tests.eq((select count(*) from public.appointments where series_id = tests.id('SER1'))::int, 1, 'Ocorrência anterior à data é mantida');
select tests.ok((select ended_at is not null and until_date = '2030-03-17' from public.appointment_series where id = tests.id('SER1')),
  'Série marcada como encerrada');

-- Alterar série a partir de uma data (novo horário/valor)
create temp table r5 as
select public.change_appointment_series(((select r ->> 'series_id' from r2))::uuid, '2030-04-16', '2030-04-17', '09:00', null, 200) as r;
select tests.eq((select array_agg(to_char(starts_at at time zone 'America/Sao_Paulo', 'MM-DD HH24:MI') order by starts_at)
                   from public.appointments where series_id = ((select r ->> 'series_id' from r2))::uuid),
  array['04-02 08:00'], 'Série antiga mantém só o que veio antes da alteração');
select tests.eq((select array_agg(to_char(starts_at at time zone 'America/Sao_Paulo', 'MM-DD HH24:MI') || '/' || price::text order by starts_at)
                   from public.appointments where series_id = ((select r ->> 'series_id' from r5))::uuid),
  array['04-17 09:00/200.00', '05-01 09:00/200.00'], 'Nova série criada com novo horário/valor até a data final original');

-- ---- Status ----
select tests.throws(format($q$update public.appointments set status = 'atendido' where id = %L$q$,
  (select id from public.appointments where series_id = ((select r ->> 'series_id' from r5))::uuid limit 1)),
  'P0001', 'Não marca "atendido" em sessão futura', 'ainda não começou');

with _i as (insert into public.appointments (patient_id, starts_at, ends_at)
  values (tests.id('P1'), now() - interval '1 day', now() - interval '1 day' + interval '50 minutes') returning id)
select tests.put('PAST', id) from _i;
update public.appointments set status = 'faltou' where id = tests.id('PAST');
select tests.eq((select status::text from public.appointments where id = tests.id('PAST')), 'faltou', 'Sessão passada pode ser marcada como falta');
select tests.throws(format($q$update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = %L$q$, tests.id('PAST')),
  'P0001', 'Sessão já registrada não pode ser remarcada');

-- Remarcar sessão confirmada volta para "agendado"
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, status)
  values (tests.id('P1'), '2032-01-05 10:00-03', '2032-01-05 10:50-03', 'confirmado') returning id)
select tests.put('CONF', id) from _i;
update public.appointments set starts_at = '2032-01-06 10:00-03', ends_at = '2032-01-06 10:50-03' where id = tests.id('CONF');
select tests.eq((select status::text from public.appointments where id = tests.id('CONF')), 'agendado',
  'Remarcação de sessão confirmada exige nova confirmação');

-- Exclusão de paciente sem histórico remove as sessões futuras; com histórico é bloqueada
with _i as (insert into public.patients (full_name) values ('Paciente Cadastrado Por Engano') returning id) select tests.put('P3', id) from _i;
insert into public.appointments (patient_id, starts_at, ends_at) values (tests.id('P3'), '2033-01-03 10:00-03', '2033-01-03 10:50-03');
select tests.eq(tests.affected(format('delete from public.patients where id = %L', tests.id('P3'))), 1, 'Paciente sem histórico pode ser excluído');
select tests.throws(format('delete from public.patients where id = %L', tests.id('P1')), 'P0001', 'Paciente com atendimento registrado não pode ser excluído', 'não pode ser excluído');

rollback;
