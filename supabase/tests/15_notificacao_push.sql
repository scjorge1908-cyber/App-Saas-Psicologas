-- =============================================================================
-- Teste 15 — Notificação no celular: tokens por psicóloga (28/10)
-- =============================================================================
begin;
select tests.put('A', tests.create_user('ana.push@exemplo.invalid', 'Ana Push', '06/999991'));
select tests.put('B', tests.create_user('bia.push@exemplo.invalid', 'Bia Push', '06/999992'));
select tests.login(tests.id('A'));
select tests.eq(tests.affected($q$insert into public.device_tokens (token) values ('token-ficticio-da-ana-0000000001')$q$), 1, 'Psicóloga registra o celular');
select tests.throws($q$insert into public.device_tokens (token) values ('curto')$q$, '23514', 'Token inválido é recusado');
select tests.throws($q$select * from public.booking_notifications$q$, '42501', 'Controle de avisos não é lido pelo app');
select tests.throws($q$select * from public._config$q$, '42501', 'Configuração do servidor não é lida pelo app');
reset role;
select tests.login(tests.id('B'));
select tests.eq((select count(*)::int from public.device_tokens), 0, 'Outra psicóloga não vê os celulares');
reset role;
select tests.login_anon();
select tests.throws($q$select * from public.device_tokens$q$, '42501', 'Anônimo não vê os celulares');
reset role;
rollback;
