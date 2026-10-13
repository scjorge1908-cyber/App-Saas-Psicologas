-- =============================================================================
-- Teste 05 — Financeiro: cobranças automáticas, pagamentos, saldos, relatórios
-- Critério: "Cálculos financeiros conferem."
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.fin@exemplo.invalid', 'Ana Financeiro', '06/777777'));
select tests.login(tests.id('A'));
with _i as (insert into public.patients (full_name, session_price) values ('Paciente Por Sessão', 150) returning id) select tests.put('P1', id) from _i;
with _i as (insert into public.patients (full_name, billing_mode) values ('Paciente Mensalista', 'mensal') returning id) select tests.put('P2', id) from _i;

-- Três sessões passadas de P1 (preço 150), uma de P2 (mensal)
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, price) values
  (tests.id('P1'), now() - interval '10 days', now() - interval '10 days' + interval '50 min', 150) returning id) select tests.put('S1', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, price) values
  (tests.id('P1'), now() - interval '3 days', now() - interval '3 days' + interval '50 min', 150) returning id) select tests.put('S2', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, price) values
  (tests.id('P1'), now() - interval '2 days', now() - interval '2 days' + interval '50 min', 150) returning id) select tests.put('S3', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, price) values
  (tests.id('P2'), now() - interval '1 day', now() - interval '1 day' + interval '50 min', 600) returning id) select tests.put('S4', id) from _i;

update public.appointments set status = 'atendido' where id in (tests.id('S1'), tests.id('S2'));
update public.appointments set status = 'faltou' where id = tests.id('S3');
update public.appointments set status = 'atendido' where id = tests.id('S4');

select tests.eq((select count(*) from public.charges where canceled_at is null)::int, 2, 'Cobranças automáticas: 2 sessões atendidas por sessão');
select tests.eq((select count(*) from public.charges where appointment_id = tests.id('S4'))::int, 0, 'Paciente mensalista não gera cobrança por sessão');
select tests.eq((select count(*) from public.charges where appointment_id = tests.id('S3'))::int, 0, 'Falta sem cobrança não gera valor');

update public.appointments set charge_no_show = true where id = tests.id('S3');
select tests.ok((select amount = 150 and description like 'Falta de %' from public.charges where appointment_id = tests.id('S3')), 'Falta cobrada gera cobrança "Falta de ..."');

-- Corrigir status sem pagamento cancela a cobrança
update public.appointments set charge_no_show = false where id = tests.id('S3');
select tests.ok((select canceled_at is not null from public.charges where appointment_id = tests.id('S3')), 'Desmarcar cobrança de falta cancela o valor');
update public.appointments set charge_no_show = true where id = tests.id('S3');
select tests.ok((select canceled_at is null from public.charges where appointment_id = tests.id('S3')), 'Remarcar cobrança reativa o mesmo lançamento (sem duplicar)');
select tests.eq((select count(*) from public.charges where appointment_id = tests.id('S3'))::int, 1, 'Sem duplicidade de cobrança por sessão');

-- Cobrança manual (mensalidade) para P2
with _i as (insert into public.charges (patient_id, description, amount, due_date)
  values (tests.id('P2'), 'Mensalidade fictícia', 600, current_date - 5) returning id) select tests.put('C_MENS', id) from _i;

-- Pagamentos
insert into public.payments (patient_id, charge_id, amount, method)
values (tests.id('P1'), (select id from public.charges where appointment_id = tests.id('S1')), 150, 'pix');
insert into public.payments (patient_id, charge_id, amount, method)
values (tests.id('P1'), (select id from public.charges where appointment_id = tests.id('S2')), 100, 'dinheiro');
insert into public.payments (patient_id, charge_id, amount, method, paid_on)
values (tests.id('P2'), tests.id('C_MENS'), 250.50, 'transferencia', current_date);

select tests.throws(format('insert into public.payments (patient_id, charge_id, amount) values (%L, %L, 50.01)',
  tests.id('P1'), (select id from public.charges where appointment_id = tests.id('S2'))), 'P0001', 'Pagamento acima do saldo é rejeitado', 'excede');
select tests.throws(format('insert into public.payments (patient_id, charge_id, amount) values (%L, %L, 10)',
  tests.id('P2'), (select id from public.charges where appointment_id = tests.id('S2'))), 'P0001', 'Pagamento de outro paciente na cobrança é rejeitado');
select tests.throws(format('insert into public.payments (patient_id, amount) values (%L, 0)', tests.id('P1')), '23514', 'Pagamento zero rejeitado');

select tests.eq((select status from public.charge_balances where appointment_id = tests.id('S1')), 'paga', 'Status "paga"');
select tests.eq((select status || ':' || balance from public.charge_balances where appointment_id = tests.id('S2')), 'parcial:50.00', 'Status "parcial" com saldo 50,00');
select tests.eq((select status || ':' || balance from public.charge_balances where appointment_id = tests.id('S3')), 'aberta:150.00', 'Falta cobrada em aberto');
select tests.eq((select balance from public.charge_balances where id = tests.id('C_MENS')), 349.50::numeric(10,2), 'Saldo com centavos correto (600 - 250,50)');
select tests.ok((select overdue from public.charge_balances where id = tests.id('C_MENS')), 'Mensalidade vencida marcada como inadimplente');

-- Totais: a receber = 50 + 150 + 349,50 = 549,50
select tests.eq((select sum(balance) from public.charge_balances where status in ('aberta', 'parcial')), 549.50::numeric, 'Total a receber confere');

-- Alterar status de sessão com pagamento é bloqueado
select tests.throws(format($q$update public.appointments set status = 'cancelado', canceled_by = 'profissional' where id = %L$q$, tests.id('S1')),
  'P0001', 'Não altera status de sessão já paga', 'pagamento registrado');
select tests.throws(format('delete from public.charges where id = %L', (select id from public.charges where appointment_id = tests.id('S1'))),
  'P0001', 'Não exclui cobrança paga');
select tests.throws(format('update public.charges set amount = 100 where id = %L', (select id from public.charges where appointment_id = tests.id('S1'))),
  'P0001', 'Não reduz cobrança abaixo do recebido');

-- Despesas
insert into public.expenses (description, category, amount, expense_date) values
  ('Aluguel de sala fictício', 'aluguel', 400, current_date),
  ('Supervisão fictícia', 'supervisao', 99.90, current_date);

-- Relatório do mês corrente
create temp table rep as select * from public.financial_report(current_date, current_date);
select tests.eq((select received from rep), 500.50::numeric, 'Recebido no mês = 150 + 100 + 250,50');
select tests.eq((select expenses from rep), 499.90::numeric, 'Despesas no mês = 400 + 99,90');
select tests.eq((select net from rep), 0.60::numeric, 'Resultado = recebido - despesas');

-- Painel
create temp table dash as select public.dashboard_summary() as d;
select tests.eq(((select d ->> 'receivable' from dash))::numeric, 549.50, 'Painel: a receber');
select tests.eq(((select d ->> 'received_month' from dash))::numeric, 500.50, 'Painel: recebido no mês');
select tests.eq(((select d ->> 'receita_saude_pending' from dash))::int, 3, 'Painel: recibos Receita Saúde pendentes (PF)');

-- NFS-e: só controle de status, nunca nota simulada
select tests.throws(format('insert into public.invoices (patient_id, amount, status) values (%L, 150, %L)', tests.id('P1'), 'emitida'),
  '23514', 'NFS-e "emitida" exige número e data reais');
insert into public.invoices (patient_id, amount, status) values (tests.id('P1'), 150, 'a_emitir');
update public.invoices set status = 'emitida', number = '2026000123', issued_on = current_date where patient_id = tests.id('P1');
select tests.eq((select status::text from public.invoices where patient_id = tests.id('P1')), 'emitida', 'Status da NFS-e atualizado após emissão externa');
select tests.throws(format('insert into public.invoices (patient_id, amount, access_key) values (%L, 10, %L)', tests.id('P1'), '123'),
  '23514', 'Chave de acesso inválida rejeitada');
reset role;

rollback;
