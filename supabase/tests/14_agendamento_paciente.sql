-- =============================================================================
-- Teste 14 — Agendamento pelo paciente (link com horários escolhidos, 28/10)
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.link@exemplo.invalid', 'Ana Link', '06/888881'));
select tests.put('B', tests.create_user('bia.link@exemplo.invalid', 'Bia Link', '06/888882'));
create table tests.lk (k text primary key, t text);
grant all on tests.lk to anon, authenticated;

select tests.login(tests.id('A'));
with _i as (insert into public.locations (name) values ('Sala Fictícia') returning id) select tests.put('L', id) from _i;
with _i as (insert into public.patients (full_name) values ('Paciente Ocupando Fictício') returning id) select tests.put('P', id) from _i;
-- Horário 2 (amanhã+1 às 10h) já ocupado por uma sessão
insert into public.appointments (patient_id, starts_at, ends_at)
values (tests.id('P'), date_trunc('day', now()) + interval '2 days 13 hours', date_trunc('day', now()) + interval '2 days 13 hours 50 minutes');

insert into tests.lk values ('L1', public.create_booking_link(
  jsonb_build_array(
    jsonb_build_object('starts_at', date_trunc('day', now()) + interval '2 days 12 hours', 'ends_at', date_trunc('day', now()) + interval '2 days 12 hours 50 minutes', 'location_id', tests.id('L')),
    jsonb_build_object('starts_at', date_trunc('day', now()) + interval '2 days 13 hours', 'ends_at', date_trunc('day', now()) + interval '2 days 13 hours 50 minutes', 'location_id', tests.id('L'))),
  'semanal', 12, 50, 180, 'Maria', 7));
insert into tests.lk values ('L2', public.create_booking_link(
  jsonb_build_array(jsonb_build_object('starts_at', date_trunc('day', now()) + interval '2 days 12 hours', 'ends_at', date_trunc('day', now()) + interval '2 days 12 hours 50 minutes')),
  'nao', null, 50, null, null, 7));
select tests.eq((select char_length(t) from tests.lk where k = 'L1'), 32, 'Token com 32 caracteres');
select tests.throws($q$select public.create_booking_link('[]'::jsonb, 'nao', null, 50, null, null, 7)$q$, '22023', 'Link sem horário é recusado');
select tests.throws($q$select public.create_booking_link(jsonb_build_array(jsonb_build_object('starts_at', now() - interval '1 day', 'ends_at', now() - interval '23 hours')), 'nao', null, 50, null, null, 7)$q$, '22023', 'Horário que já passou é recusado');
select tests.throws($q$insert into public.booking_links (token_hash, frequency, session_minutes, expires_at) values ('x', 'nao', 50, now())$q$, '42501', 'Cliente não cria link direto (só pela função)');
reset role;

-- ---- Paciente (anônimo) ----
select tests.login_anon();
create temp table g as select public.get_booking((select t from tests.lk where k = 'L1')) as r;
select tests.eq((select r ->> 'state' from g), 'aberto', 'Link aberto');
select tests.eq((select jsonb_array_length(r -> 'slots') from g), 1, 'Mostra só o horário escolhido que ainda está livre');
select tests.eq((select r -> 'slots' -> 0 ->> 'location_name' from g), 'Sala Fictícia', 'Mostra a sala');
select tests.ok((select not (r ? 'owner_id') and not (r ? 'label') from g), 'Sem dados internos na resposta');
select tests.eq((public.get_booking('x') ->> 'state'), 'invalido', 'Token malformado é inválido');

create temp table dados as select jsonb_build_object(
  'full_name', 'Maria Fictícia Souza', 'phone', '48999990001', 'cpf', '52998224725', 'email', 'maria@exemplo.invalid',
  'birth_date', '1990-03-25', 'cep', '88132150', 'street', 'Rua Fictícia', 'address_number', '10', 'neighborhood', 'Centro',
  'city', 'Palhoça', 'uf', 'SC', 'status', 'inativo', 'owner_id', '00000000-0000-0000-0000-000000000000') as d;
select tests.eq((public.request_booking((select t from tests.lk where k = 'L1'), (select (r -> 'slots' -> 0 ->> 'starts_at')::timestamptz from g),
  (select d - 'cpf' from dados)) ->> 'state'), 'dados_incompletos', 'Cadastro sem CPF é recusado');
select tests.eq((public.request_booking((select t from tests.lk where k = 'L1'), date_trunc('day', now()) + interval '2 days 12 hours',
  (select d || '{"payer_tipo": "xx", "nf_tomador": "outro"}'::jsonb from dados)) ->> 'state'), 'dados_incompletos', 'Campo da nota fora do formato é recusado (o pedido não poderia ser aprovado)');
select tests.eq((public.request_booking((select t from tests.lk where k = 'L1'), date_trunc('day', now()) + interval '2 days 12 hours',
  (select d || '{"birth_date": "1990-02-31"}'::jsonb from dados)) ->> 'state'), 'dados_incompletos', 'Data que não existe é recusada sem erro');
select tests.eq((public.request_booking((select t from tests.lk where k = 'L1'), date_trunc('day', now()) + interval '2 days 13 hours', (select d from dados)) ->> 'state'),
  'ocupado', 'Horário ocupado por sessão é recusado');
select tests.eq((public.request_booking((select t from tests.lk where k = 'L1'), date_trunc('day', now()) + interval '9 days', (select d from dados)) ->> 'state'),
  'horario_invalido', 'Horário fora do link é recusado');
select tests.eq((public.request_booking((select t from tests.lk where k = 'L1'), date_trunc('day', now()) + interval '2 days 12 hours', (select d from dados)) ->> 'state'),
  'pendente', 'Pedido feito: fica pendente');
select tests.eq((public.get_booking((select t from tests.lk where k = 'L1')) ->> 'state'), 'usado', 'Link de uma pessoa: depois do pedido, deixa de valer');
select tests.eq((public.request_booking((select t from tests.lk where k = 'L1'), date_trunc('day', now()) + interval '2 days 12 hours', (select d from dados)) ->> 'state'),
  'usado', 'Não dá para pedir duas vezes no mesmo link');
-- O mesmo horário em outro link já não aparece (reservado pelo pedido pendente)
select tests.eq((jsonb_array_length(public.get_booking((select t from tests.lk where k = 'L2')) -> 'slots')), 0, 'Horário pedido fica reservado para os outros links');
select tests.throws($q$select * from public.booking_requests$q$, '42501', 'Anônimo não lê os pedidos');
reset role;

-- ---- Psicóloga ----
select tests.login(tests.id('A'));
select tests.eq((select count(*)::int from public.booking_requests where status = 'pendente'), 1, 'Psicóloga vê o pedido');
select tests.ok((select not (patient_data ? 'status') and not (patient_data ? 'owner_id') from public.booking_requests), 'Só os campos do cadastro são guardados');
select tests.eq((select patient_data ->> 'full_name' from public.booking_requests), 'Maria Fictícia Souza', 'Cadastro guardado');
select tests.throws($q$update public.booking_requests set starts_at = now() + interval '20 days'$q$, '42501', 'Não muda o horário do pedido (só aprova ou recusa)');
select tests.throws($q$update public.booking_requests set status = 'aprovado'$q$, '22023', 'Aprovar sem paciente é recusado');
select tests.eq(tests.affected($q$update public.booking_requests set status = 'recusado', decided_at = now()$q$), 1, 'Recusar o pedido');
select tests.eq((select patient_data from public.booking_requests), '{}'::jsonb, 'Ao decidir, o cadastro guardado no pedido é apagado (LGPD)');
select tests.throws($q$update public.booking_requests set status = 'pendente'$q$, 'P0001', 'Pedido decidido não volta para pendente');
update public.booking_links set canceled_at = now() where id = (select link_id from public.booking_requests);
select tests.throws($q$update public.booking_links set canceled_at = null where canceled_at is not null$q$, 'P0001', 'Link cancelado não volta a valer');
reset role;
select tests.login_anon();
select tests.eq((jsonb_array_length(public.get_booking((select t from tests.lk where k = 'L2')) -> 'slots')), 1, 'Recusado: o horário volta a ficar livre');
reset role;

select tests.login(tests.id('B'));
select tests.eq((select count(*)::int from public.booking_requests), 0, 'Outra psicóloga não vê os pedidos');
select tests.eq((select count(*)::int from public.booking_links), 0, 'Outra psicóloga não vê os links');
reset role;
rollback;
