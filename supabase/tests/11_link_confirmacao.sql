-- =============================================================================
-- Teste 11 — Data do link de confirmação na agenda (Confirmar agenda)
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.link@exemplo.invalid', 'Ana Link', '06/555551'));
select tests.put('B', tests.create_user('bia.link@exemplo.invalid', 'Bia Link', '06/555552'));
select tests.login(tests.id('A'));

with _i as (insert into public.patients (full_name) values ('Paciente Link') returning id) select tests.put('P', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at) values (tests.id('P'), now() + interval '2 days', now() + interval '2 days 50 minutes') returning id)
select tests.put('S', id) from _i;

select tests.eq((select (confirmation_link_at is null)::text from public.agenda_items where id = tests.id('S')), 'true', 'Sem link gerado: "Falta enviar link"');
select length(public.create_confirmation_link(tests.id('S'))) > 0;
select tests.eq((select (confirmation_link_at is not null)::text from public.agenda_items where id = tests.id('S')), 'true', 'Link gerado: "Aguardando confirmação"');

-- Remarcar invalida o link
update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = tests.id('S');
select tests.eq((select (confirmation_link_at is null)::text from public.agenda_items where id = tests.id('S')), 'true', 'Remarcada: precisa enviar link de novo');

select tests.login(tests.id('B'));
select tests.eq((select public._link_confirmacao_em(tests.id('S')) is null)::text, 'true', 'Outra psicóloga não vê a data do link');
reset role;
rollback;
