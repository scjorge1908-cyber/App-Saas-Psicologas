-- =============================================================================
-- Teste 03 — Confirmação por link seguro
-- Critério: "Confirmações atualizam o agendamento correspondente."
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.conf@exemplo.invalid', 'Ana Confirma', '06/123456'));
update public.profiles set cancellation_hours = 24 where id = tests.id('A');

create table tests.tokens (k text primary key, t text);
grant all on tests.tokens to anon, authenticated;

select tests.login(tests.id('A'));
with _i as (insert into public.patients (full_name, social_name) values ('Carlos Fictício Souza', null) returning id) select tests.put('P', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at)
  values (tests.id('P'), now() + interval '3 days', now() + interval '3 days 50 minutes') returning id) select tests.put('S1', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at)
  values (tests.id('P'), now() + interval '5 hours', now() + interval '5 hours 50 minutes') returning id) select tests.put('S2', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at)
  values (tests.id('P'), now() + interval '7 days', now() + interval '7 days 50 minutes') returning id) select tests.put('S3', id) from _i;

insert into tests.tokens values ('S1', public.create_confirmation_link(tests.id('S1')));
insert into tests.tokens values ('S2', public.create_confirmation_link(tests.id('S2')));
insert into tests.tokens values ('S3', public.create_confirmation_link(tests.id('S3')));
select tests.eq((select char_length(t) from tests.tokens where k = 'S1'), 32, 'Token com 32 caracteres (192 bits)');
select tests.ok((select t ~ '^[A-Za-z0-9_-]+$' from tests.tokens where k = 'S1'), 'Token seguro para URL');
reset role;

select tests.ok(not exists (select 1 from public.confirmation_tokens ct join tests.tokens tk on convert_to(tk.t, 'UTF8') = ct.token_hash),
  'Banco guarda apenas o hash, não o token');

-- ---- Paciente (anônimo) ----
select tests.login_anon();
create temp table g1 as select public.get_confirmation((select t from tests.tokens where k = 'S1')) as r;
select tests.eq((select r ->> 'state' from g1), 'pendente', 'Link válido mostra estado pendente');
select tests.eq((select r ->> 'patient_first_name' from g1), 'Carlos', 'Mostra apenas o primeiro nome do paciente');
select tests.eq((select r ->> 'professional_crp' from g1), '06/123456', 'Mostra CRP da profissional');
select tests.ok((select not (r ? 'patient_id') and not (r ? 'cpf') and not (r ? 'content') from g1), 'Sem dados sensíveis na resposta');
select tests.eq((public.get_confirmation('x') ->> 'state'), 'invalido', 'Token malformado é inválido');
select tests.eq((public.get_confirmation(repeat('A', 32)) ->> 'state'), 'invalido', 'Token inexistente é inválido');

select tests.eq((public.respond_confirmation((select t from tests.tokens where k = 'S1'), 'confirmar') ->> 'state'), 'confirmado', 'Paciente confirma pelo link');
reset role;
select tests.eq((select status::text from public.appointments where id = tests.id('S1')), 'confirmado', 'Agendamento atualizado para confirmado');
select tests.ok((select confirmed_at is not null and patient_response = 'confirmou' from public.appointments where id = tests.id('S1')), 'Registra data e resposta');
select tests.ok(exists (select 1 from public.audit_log where record_id = tests.id('S1') and actor = 'paciente-link'), 'Auditoria marca ação feita pelo link');

-- Cancelamento com antecedência (>24h) não é tardio
select tests.login_anon();
select tests.eq((public.respond_confirmation((select t from tests.tokens where k = 'S1'), 'cancelar') ->> 'state'), 'cancelado', 'Paciente pode cancelar após confirmar');
reset role;
select tests.ok((select status = 'cancelado' and canceled_by = 'paciente' and not late_cancellation from public.appointments where id = tests.id('S1')),
  'Cancelamento com antecedência registrado como do paciente e não tardio');

-- Cancelamento tardio (<24h)
select tests.login_anon();
select tests.eq((public.respond_confirmation((select t from tests.tokens where k = 'S2'), 'cancelar') ->> 'state'), 'cancelado', 'Cancelamento pelo link a menos de 24h');
select tests.eq((public.respond_confirmation((select t from tests.tokens where k = 'S2'), 'confirmar') ->> 'state'), 'cancelado', 'Sessão cancelada não pode ser reconfirmada pelo link');
select tests.throws(format('select public.respond_confirmation(%L, %L)', (select t from tests.tokens where k = 'S3'), 'apagar'), '22023', 'Ação inválida rejeitada');
reset role;
select tests.ok((select late_cancellation from public.appointments where id = tests.id('S2')), 'Cancelamento tardio sinalizado para a profissional decidir cobrança');

-- Remarcação invalida o link
select tests.login(tests.id('A'));
update public.appointments set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = tests.id('S3');
reset role;
select tests.login_anon();
select tests.eq((public.get_confirmation((select t from tests.tokens where k = 'S3')) ->> 'state'), 'invalido', 'Link antigo deixa de valer após remarcação');
reset role;

-- Link expira no início da sessão
select tests.login(tests.id('A'));
insert into tests.tokens values ('S3b', public.create_confirmation_link(tests.id('S3')));
reset role;
update public.confirmation_tokens set expires_at = now() - interval '1 minute' where appointment_id = tests.id('S3');
select tests.login_anon();
select tests.eq((public.get_confirmation((select t from tests.tokens where k = 'S3b')) ->> 'state'), 'expirado', 'Link expirado é identificado');
select tests.eq((public.respond_confirmation((select t from tests.tokens where k = 'S3b'), 'confirmar') ->> 'ok'), 'false', 'Link expirado não altera o agendamento');
reset role;
select tests.eq((select status::text from public.appointments where id = tests.id('S3')), 'agendado', 'Agendamento permanece agendado após tentativa expirada');

-- Não gera link para sessão passada
select tests.login(tests.id('A'));
with _i as (insert into public.appointments (patient_id, starts_at, ends_at)
  values (tests.id('P'), now() - interval '3 days', now() - interval '3 days' + interval '50 minutes') returning id) select tests.put('OLD', id) from _i;
select tests.throws(format('select public.create_confirmation_link(%L)', tests.id('OLD')), 'P0001', 'Sem link para sessão que já passou');
reset role;

rollback;
