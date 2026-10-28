-- =============================================================================
-- Teste 12 — Bloqueios de agenda (férias, feriados, folgas)
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.bloq@exemplo.invalid', 'Ana Bloqueio', '06/666661'));
select tests.put('B', tests.create_user('bia.bloq@exemplo.invalid', 'Bia Bloqueio', '06/666662'));
select tests.login(tests.id('A'));

select tests.eq(tests.affected($q$insert into public.schedule_blocks (kind, starts_on, ends_on, reason) values ('ferias', '2027-01-04', '2027-01-15', 'Férias de janeiro')$q$), 1, 'Férias de dia inteiro');
select tests.eq(tests.affected($q$insert into public.schedule_blocks (kind, starts_on, ends_on, start_time, end_time) values ('folga', '2026-11-06', '2026-11-06', '14:00', '18:00')$q$), 1, 'Folga só à tarde');
select tests.throws($q$insert into public.schedule_blocks (kind, starts_on, ends_on) values ('ferias', '2027-01-15', '2027-01-04')$q$, '23514', 'Fim antes do início é recusado');
select tests.throws($q$insert into public.schedule_blocks (kind, starts_on, ends_on, start_time) values ('folga', '2026-11-06', '2026-11-06', '14:00')$q$, '23514', 'Horário pela metade é recusado');
select tests.throws($q$insert into public.schedule_blocks (kind, starts_on, ends_on) values ('viagem', '2026-11-06', '2026-11-06')$q$, '23514', 'Tipo desconhecido é recusado');

select tests.login(tests.id('B'));
select tests.eq((select count(*)::int from public.schedule_blocks), 0, 'Outra psicóloga não vê os bloqueios');
reset role;
rollback;
