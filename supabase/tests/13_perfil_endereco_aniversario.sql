-- =============================================================================
-- Teste 13 — Endereço do consultório com CEP e bloqueio "Aniversário" (28/10)
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.perfil@exemplo.invalid', 'Ana Perfil', '06/777771'));
select tests.login(tests.id('A'));

select tests.eq(tests.affected($q$update public.profiles set cep = '88132150', address = 'Rua Fictícia', address_number = '10', address_complement = 'Sala 2', neighborhood = 'Centro' where id = auth.uid()$q$), 1, 'Endereço completo do consultório');
select tests.throws($q$update public.profiles set cep = '8813-215' where id = auth.uid()$q$, '23514', 'CEP fora do formato é recusado');
select tests.eq(tests.affected($q$insert into public.schedule_blocks (kind, starts_on, ends_on, reason) values ('aniversario', '2027-02-08', '2027-02-08', 'Meu aniversário')$q$), 1, 'Bloqueio de aniversário');
select tests.throws($q$insert into public.schedule_blocks (kind, starts_on, ends_on) values ('viagem', '2026-11-06', '2026-11-06')$q$, '23514', 'Tipo desconhecido continua recusado');
reset role;
rollback;
