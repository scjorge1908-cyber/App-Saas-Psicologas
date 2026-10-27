-- =============================================================================
-- Teste 10 — Cartão "Nota fiscal" do paciente: dados de quem recebe a nota
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.nota@exemplo.invalid', 'Ana Nota', '06/444441'));
select tests.put('B', tests.create_user('bia.nota@exemplo.invalid', 'Bia Nota', '06/444442'));
select tests.login(tests.id('A'));

with _i as (insert into public.patients (full_name, nf_tomador, payer_name, payer_cpf, payer_email, payer_phone,
    payer_cep, payer_street, payer_number, payer_neighborhood, payer_city, payer_uf)
  values ('Paciente Nota', 'outro', 'Mãe Fictícia', '52998224725', 'mae@exemplo.invalid', '48999990002',
    '88132150', 'Rua Fictícia', '10', 'Centro', 'Palhoça', 'SC') returning id)
select tests.put('P', id) from _i;
select tests.eq((select payer_city from public.patients where id = tests.id('P')), 'Palhoça', 'Endereço de quem paga é gravado');
select tests.eq(tests.affected($q$update public.patients set nf_tomador = 'paciente' where full_name = 'Paciente Nota'$q$), 1, 'Nota no nome do próprio paciente');
select tests.throws($q$insert into public.patients (full_name, nf_tomador) values ('X', 'empresa')$q$, '23514', 'Tomador desconhecido é recusado');
select tests.throws($q$insert into public.patients (full_name, payer_email) values ('X', 'sem-arroba')$q$, '23514', 'E-mail inválido é recusado');
select tests.throws($q$insert into public.patients (full_name, payer_cep) values ('X', '88132-150')$q$, '23514', 'CEP com traço é recusado');
select tests.throws($q$insert into public.patients (full_name, payer_phone) values ('X', '9999')$q$, '23514', 'Telefone sem DDD é recusado');
select tests.throws($q$insert into public.patients (full_name, payer_uf) values ('X', 'sc')$q$, '23514', 'UF minúscula é recusada');

-- Empresa (PJ) pagando
select tests.eq(tests.affected($q$insert into public.patients (full_name, nf_tomador, payer_tipo, payer_name, payer_cnpj, payer_im)
  values ('Paciente PJ', 'outro', 'pj', 'Empresa Fictícia Ltda', '11222333000181', '12345')$q$), 1, 'Empresa (CNPJ) como tomadora da nota');
select tests.throws($q$insert into public.patients (full_name, payer_tipo) values ('X', 'mei')$q$, '23514', 'Tipo de pagador desconhecido é recusado');
select tests.throws($q$insert into public.patients (full_name, payer_cnpj) values ('X', '11.222.333/0001-81')$q$, '23514', 'CNPJ com pontuação é recusado');

select tests.login(tests.id('B'));
select tests.eq((select count(*)::int from public.patients where id = tests.id('P')), 0, 'Outra psicóloga não vê os dados da nota');
reset role;
rollback;
