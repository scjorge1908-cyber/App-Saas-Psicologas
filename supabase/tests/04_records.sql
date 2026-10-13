-- =============================================================================
-- Teste 04 — Prontuário, anexos e documentos
-- Critério: "Registros clínicos e anexos permanecem restritos" + guarda obrigatória
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.pront@exemplo.invalid', 'Ana Prontuário', '06/654321'));
select tests.login(tests.id('A'));
with _i as (insert into public.patients (full_name) values ('Paciente Prontuário') returning id) select tests.put('P', id) from _i;
with _i as (insert into public.record_entries (patient_id, kind, content) values (tests.id('P'), 'identificacao_demanda', 'Demanda fictícia v1') returning id) select tests.put('R', id) from _i;

-- Retificação gera versões
update public.record_entries set content = 'Demanda fictícia v2' where id = tests.id('R');
update public.record_entries set content = 'Demanda fictícia v3', title = 'Retificada' where id = tests.id('R');
update public.record_entries set entry_date = entry_date where id = tests.id('R'); -- sem mudança real
select tests.eq((select version from public.record_entries where id = tests.id('R')), 3, 'Versão incrementa a cada retificação');
select tests.eq((select array_agg(content order by version) from public.record_entry_versions where entry_id = tests.id('R')),
  array['Demanda fictícia v1', 'Demanda fictícia v2'], 'Versões anteriores preservadas na íntegra');
select tests.throws(format('delete from public.record_entries where id = %L', tests.id('R')), '42501', 'Exclusão de registro bloqueada por permissão');
reset role;
-- Mesmo com privilégio total (ex.: suporte com service_role), o gatilho impede
select tests.throws(format('delete from public.record_entries where id = %L', tests.id('R')), 'P0001', 'Exclusão de registro bloqueada também para administrador', 'não podem ser excluídos');
select tests.login(tests.id('A'));
select tests.throws(format('update public.record_entry_versions set content = %L', 'adulterado'), '42501', 'Versões são somente leitura');
select tests.throws(format('insert into public.record_entries (patient_id, content) values (%L, %L)', tests.id('P'), '   '), '23514', 'Registro vazio rejeitado');

-- Anexos
with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'avaliacao', tests.id('A')::text || '/' || tests.id('P')::text || '/teste.pdf', 'teste.pdf', 'application/pdf', 1000) returning id)
select tests.put('ATT_AV', id) from _i;
with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes)
  values (tests.id('P'), 'outro', tests.id('A')::text || '/' || tests.id('P')::text || '/outro.png', 'outro.png', 'image/png', 1000) returning id)
select tests.put('ATT_OUT', id) from _i;
insert into storage.objects (bucket_id, name) values
  ('prontuario', tests.id('A')::text || '/' || tests.id('P')::text || '/teste.pdf'),
  ('prontuario', tests.id('A')::text || '/' || tests.id('P')::text || '/outro.png');

select tests.throws(format('delete from public.attachments where id = %L', tests.id('ATT_AV')), 'P0001', 'Anexo de avaliação não pode ser excluído');
select tests.eq(tests.affected(format('delete from storage.objects where name = %L', tests.id('A')::text || '/' || tests.id('P')::text || '/teste.pdf')), 0,
  'Arquivo de avaliação não pode ser apagado do storage');
select tests.eq(tests.affected(format('delete from public.attachments where id = %L', tests.id('ATT_OUT'))), 1, 'Anexo comum pode ser excluído');
select tests.eq(tests.affected(format('delete from storage.objects where name = %L', tests.id('A')::text || '/' || tests.id('P')::text || '/outro.png')), 1,
  'Arquivo comum pode ser apagado do storage');
select tests.eq(tests.affected(format('update storage.objects set metadata = %L', '{}')), 0, 'Sem política de UPDATE no storage: nada é sobrescrito');
select tests.throws(format('insert into public.attachments (patient_id, storage_path, file_name, mime_type, size_bytes) values (%L, %L, %L, %L, 10)',
  tests.id('P'), 'outra-pasta/x.pdf', 'x.pdf', 'application/pdf'), '23514', 'Caminho do anexo deve estar na pasta da profissional');
select tests.throws(format('insert into public.attachments (patient_id, storage_path, file_name, mime_type, size_bytes) values (%L, %L, %L, %L, 20000000)',
  tests.id('P'), tests.id('A')::text || '/g.pdf', 'g.pdf', 'application/pdf'), '23514', 'Limite de 10 MB por anexo');

-- Documentos emitidos são imutáveis
with _i as (insert into public.attachments (patient_id, category, storage_path, file_name, mime_type, size_bytes, sha256)
  values (tests.id('P'), 'documento_emitido', tests.id('A')::text || '/' || tests.id('P')::text || '/decl.pdf', 'decl.pdf', 'application/pdf', 2000, repeat('a', 64)) returning id)
select tests.put('ATT_DOC', id) from _i;
with _i as (insert into public.documents (patient_id, doc_type, title, purpose, fields, attachment_id, pdf_sha256)
  values (tests.id('P'), 'declaracao', 'Declaração', 'Comprovação de comparecimento', '{"x":1}', tests.id('ATT_DOC'), repeat('a', 64)) returning id)
select tests.put('DOC', id) from _i;
select tests.throws(format('update public.documents set purpose = %L where id = %L', 'Outra', tests.id('DOC')), 'P0001', 'Documento emitido não pode ser editado', 'imutáveis');
select tests.throws(format('delete from public.documents where id = %L', tests.id('DOC')), '42501', 'Documento emitido não pode ser excluído');
update public.documents set delivered_at = now(), delivered_to = 'Responsável fictício' where id = tests.id('DOC');
select tests.ok((select delivered_at is not null from public.documents where id = tests.id('DOC')), 'Registro de entrega (protocolo) é permitido');
select tests.throws(format('delete from public.attachments where id = %L', tests.id('ATT_DOC')), 'P0001', 'Cópia do documento emitido não pode ser excluída');

-- Paciente com prontuário não pode ser excluído
select tests.throws(format('delete from public.patients where id = %L', tests.id('P')), 'P0001', 'Paciente com prontuário não pode ser excluído');
reset role;

-- Outra profissional não vê nada disso
select tests.put('B', tests.create_user('bia.pront@exemplo.invalid', 'Bia', '06/654322'));
select tests.login(tests.id('B'));
select tests.eq((select count(*) from public.attachments)::int + (select count(*) from public.documents)::int
               + (select count(*) from public.record_entries)::int + (select count(*) from public.record_entry_versions)::int, 0,
  'Outra profissional não vê registros, versões, anexos ou documentos');
select tests.eq((select count(*) from storage.objects)::int, 0, 'Outra profissional não vê arquivos');
reset role;

rollback;
