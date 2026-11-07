-- =============================================================================
-- Teste 16 — NFS-e Nacional (06/11/2026): proteção das notas, certificado e funções do servidor
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.nfse@exemplo.invalid', 'Ana NFS-e', '06/555551'));
select tests.put('B', tests.create_user('bia.nfse@exemplo.invalid', 'Bia NFS-e', '06/555552'));
select tests.login(tests.id('A'));

with _p as (insert into public.patients (full_name, cpf) values ('Paciente NFS-e', '52998224725') returning id)
select tests.put('P', id) from _p;
with _g as (insert into public.payments (patient_id, amount) values (tests.id('P'), 200) returning id)
select tests.put('G', id) from _g;
with _n as (insert into public.invoices (patient_id, payment_id, amount, emissao) values (tests.id('P'), tests.id('G'), 200, 'nfse_nacional') returning id)
select tests.put('N', id) from _n;

-- Perfil: campos fiscais e validações
select tests.eq((select nfse_cod_trib_nac from public.profiles where id = tests.id('A')), '041601', 'Código padrão = psicologia (4.16)');
select tests.eq((select nfse_ambiente from public.profiles where id = tests.id('A')), 'homologacao', 'Ambiente padrão = teste (sem valor fiscal)');
select tests.throws($q$update public.profiles set nfse_ibge_municipio = '42119' where id = auth.uid()$q$, '23514', 'IBGE precisa de 7 números');
select tests.throws($q$update public.profiles set nfse_regime = 'lucro_real' where id = auth.uid()$q$, '23514', 'Regime desconhecido é recusado');
select tests.throws($q$update public.profiles set nfse_aliquota_iss = 7 where id = auth.uid()$q$, '23514', 'Alíquota do ISS acima de 5% é recusada');

-- O app não grava campos da emissão
select tests.throws($q$insert into public.invoices (patient_id, amount, emissao, status, number, issued_on) values (tests.id('P'), 1, 'nfse_nacional', 'emitida', '1', current_date)$q$, '42501', 'Nota pelo sistema não nasce emitida');
select tests.throws($q$insert into public.invoices (patient_id, amount, dps_id) values (tests.id('P'), 1, 'DPS' || repeat('1', 42))$q$, '42501', 'Id da DPS só pelo servidor');
select tests.throws($q$update public.invoices set status = 'emitida', number = '9', issued_on = current_date where id = tests.id('N')$q$, '42501', 'Situação da nota pelo sistema só muda pelo servidor');
select tests.eq(tests.affected($q$update public.invoices set amount = 210 where id = tests.id('N')$q$), 1, 'Rascunho (antes do envio) pode ter o valor ajustado');
select tests.throws($q$insert into public.invoices (patient_id, payment_id, amount) values (tests.id('P'), tests.id('G'), 200)$q$, '23505', 'Segunda nota ativa para o mesmo recebimento é recusada');

-- Funções do servidor: o app não chama
select tests.throws($q$select public.nfse_reservar(tests.id('A'), tests.id('N'))$q$, '42501', 'App não reserva número da DPS');
select tests.throws($q$select public.nfse_certificado_obter(tests.id('A'))$q$, '42501', 'App não lê o certificado cifrado');
select tests.throws($q$select * from public.nfse_certificados$q$, '42501', 'Tabela do certificado sem acesso pelo app');

-- Servidor (service_role): reserva, emite, protege
reset role;
grant usage on schema tests to service_role;
grant all on all tables in schema tests to service_role;
grant execute on all functions in schema tests to service_role;
set local role service_role;
select tests.eq((public.nfse_reservar(tests.id('A'), tests.id('N')) ->> 'numero')::int, 1, 'Servidor reserva o número 1');
select tests.eq((select nfse_proximo_numero from public.profiles where id = tests.id('A'))::int, 2, 'Próximo número avança');
select tests.throws($q$select public.nfse_reservar(tests.id('A'), tests.id('N'))$q$, '55P03', 'Envio em andamento não é reservado de novo');
update public.invoices set emissao_iniciada_em = now() - interval '5 minutes' where id = tests.id('N');
select tests.eq((public.nfse_reservar(tests.id('A'), tests.id('N')) ->> 'numero')::int, 1, 'Reenvio reaproveita o mesmo número');
select tests.eq((select nfse_proximo_numero from public.profiles where id = tests.id('A'))::int, 2, 'Reenvio não gasta número');
select tests.throws($q$select public.nfse_reservar(tests.id('B'), tests.id('N'))$q$, 'P0002', 'Outra profissional não reserva nota alheia');
select public.nfse_resultado(tests.id('A'), tests.id('N'), jsonb_build_object('ok', true, 'dps_id', 'DPS' || repeat('2', 42),
  'numero', '15', 'chave', repeat('3', 50), 'emitida_em', '2026-11-06', 'xml', '<NFSe/>', 'tomador_tipo', 'pf', 'tomador_documento', '52998224725', 'tomador_nome', 'Paciente NFS-e'));
select tests.eq((select status::text from public.invoices where id = tests.id('N')), 'emitida', 'Resultado grava a nota como emitida');
select public.nfse_certificado_salvar(tests.id('A'), jsonb_build_object('cifrado', 'x', 'iv', 'y', 'titular', 'ANA', 'documento', '11222333000181', 'valido_ate', '2027-01-01'));

-- De volta ao app
reset role;
select tests.login(tests.id('A'));
select tests.throws($q$update public.invoices set amount = 1 where id = tests.id('N')$q$, '42501', 'Nota emitida não muda de valor');
select tests.throws($q$delete from public.invoices where id = tests.id('N')$q$, '42501', 'Nota emitida não pode ser apagada');
select tests.throws($q$delete from public.payments where id = tests.id('G')$q$, '42501', 'Recebimento com NFS-e emitida não pode ser apagado');
select tests.eq(tests.affected($q$update public.invoices set notes = 'observação' where id = tests.id('N')$q$), 1, 'Observação continua editável');
select tests.eq((select documento from public.meu_certificado_nfse()), '11222333000181', 'App vê só os dados públicos do certificado');

select tests.login(tests.id('B'));
select tests.eq((select count(*)::int from public.meu_certificado_nfse()), 0, 'Outra profissional não vê o certificado');
select tests.eq((select count(*)::int from public.invoices where id = tests.id('N')), 0, 'Outra profissional não vê a nota');

select tests.login_anon();
select tests.throws($q$select * from public.meu_certificado_nfse()$q$, '42501', 'Anônimo não consulta certificado');

reset role;
rollback;
