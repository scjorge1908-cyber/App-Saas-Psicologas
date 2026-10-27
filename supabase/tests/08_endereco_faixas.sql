-- =============================================================================
-- Teste 08 — Endereço do paciente, duração/intervalo por faixa e laudos/exames permanentes
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.endereco@exemplo.invalid', 'Ana Endereço', '06/333331'));
select tests.login(tests.id('A'));

with _i as (insert into public.patients (full_name, cep, street, address_number, neighborhood, city, uf)
  values ('Paciente Endereço', '88132150', 'Rua Fictícia', '100', 'Centro', 'Palhoça', 'SC') returning id)
select tests.put('P', id) from _i;
select tests.eq((select city from public.patients where id = tests.id('P')), 'Palhoça', 'Endereço em campos é gravado');
select tests.throws($q$insert into public.patients (full_name, cep) values ('CEP ruim', '88132-150')$q$, '23514', 'CEP com traço é recusado (só números)');
select tests.throws($q$insert into public.patients (full_name, uf) values ('UF ruim', 'sc')$q$, '23514', 'UF minúscula é recusada');
select tests.eq(tests.affected($q$update public.patients set rg = '12.345.678-9' where full_name = 'Paciente Endereço'$q$), 1, 'RG digitado é gravado');

with _i as (insert into public.locations (name) values ('Sala 1') returning id) select tests.put('L', id) from _i;
select tests.eq(tests.affected(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time, session_minutes, buffer_minutes)
  values (%L, 1, '07:00', '12:00', 60, 10)$q$, tests.id('L'))), 1, 'Faixa com duração e intervalo próprios');
select tests.throws(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time, session_minutes)
  values (%L, 2, '07:00', '12:00', 5)$q$, tests.id('L')), '23514', 'Duração menor que 10 min é recusada');

-- Laudo permanente; RG pode ser excluído (sem arquivo real: só a linha)
with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'laudo', tests.id('A')::text || '/x/laudo.pdf', 'laudo.pdf', 'application/pdf', 10) returning id)
select tests.put('LAU', id) from _i;
with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'documento_identidade', tests.id('A')::text || '/x/rg.jpg', 'rg.jpg', 'image/jpeg', 10) returning id)
select tests.put('RG', id) from _i;
select tests.throws(format($q$delete from public.attachments where id = %L$q$, tests.id('LAU')), 'P0001', 'Laudo não pode ser excluído');
select tests.throws(format($q$update public.attachments set category = 'outro' where id = %L$q$, tests.id('LAU')), 'P0001', 'Laudo não muda de categoria');
select tests.eq(tests.affected(format($q$delete from public.attachments where id = %L$q$, tests.id('RG'))), 1, 'Anexo comum pode ser excluído');
with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'encaminhamento', tests.id('A')::text || '/x/enc.pdf', 'enc.pdf', 'application/pdf', 10) returning id)
select tests.put('ENC', id) from _i;
select tests.throws(format($q$delete from public.attachments where id = %L$q$, tests.id('ENC')), 'P0001', 'Encaminhamento médico não pode ser excluído');

rollback;
