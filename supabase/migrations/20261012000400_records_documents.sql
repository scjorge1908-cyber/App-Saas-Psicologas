-- =============================================================================
-- 0004 — Prontuário, anexos e documentos psicológicos
-- Base normativa (ver docs/CONFORMIDADE.md):
--  * Res. CFP 001/2009: registro documental obrigatório, sigiloso, guarda mínima
--    de 5 anos, conteúdo mínimo (identificação, demanda/objetivos, evolução,
--    encaminhamento/encerramento, cópias de documentos emitidos).
--  * Res. CFP 06/2019: documentos psicológicos e guarda de 5 anos.
-- Regras implementadas:
--  * Registros de prontuário NUNCA são apagados; edições geram versão anterior
--    preservada (retificação rastreável).
--  * Documentos emitidos são imutáveis.
--  * Anexos de avaliação e documentos emitidos não podem ser removidos.
-- =============================================================================

create type public.record_kind as enum (
  'identificacao_demanda',  -- avaliação da demanda
  'objetivos',              -- definição de objetivos do trabalho
  'evolucao',               -- evolução / procedimentos
  'encaminhamento',
  'encerramento',
  'observacao'
);

create type public.attachment_category as enum (
  'avaliacao',               -- material de avaliação psicológica (acesso restrito)
  'documento_emitido',       -- cópia de documento emitido (gerado pelo sistema)
  'autorizacao_responsavel', -- autorização do responsável legal
  'nota_fiscal',             -- PDF/XML de NFS-e emitida externamente
  'outro'
);

create type public.document_type as enum (
  'declaracao', 'atestado', 'relatorio', 'laudo', 'parecer', 'recibo', 'contrato'
);

-- Registros do prontuário ----------------------------------------------------
create table public.record_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid not null,
  appointment_id uuid,
  kind public.record_kind not null default 'evolucao',
  entry_date date not null default current_date,
  title text check (title is null or char_length(title) <= 200),
  content text not null check (char_length(btrim(content)) between 1 and 50000),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  foreign key (appointment_id, owner_id) references public.appointments (id, owner_id) on delete restrict
);

create index record_entries_patient_idx on public.record_entries (owner_id, patient_id, entry_date desc);

create table public.record_entry_versions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  version int not null,
  kind public.record_kind not null,
  entry_date date not null,
  title text,
  content text not null,
  valid_from timestamptz not null,
  replaced_at timestamptz not null default now(),
  foreign key (entry_id, owner_id) references public.record_entries (id, owner_id) on delete restrict,
  unique (entry_id, version)
);

create or replace function public.tg_record_entries_versioning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Registros de prontuário não podem ser excluídos (Res. CFP 001/2009 — guarda obrigatória). Faça uma retificação.'
      using errcode = 'P0001';
  end if;

  if new.owner_id <> old.owner_id or new.patient_id <> old.patient_id then
    raise exception 'Não é permitido transferir registros de prontuário.' using errcode = 'P0001';
  end if;

  if (new.content, new.kind, new.entry_date, new.title)
     is distinct from (old.content, old.kind, old.entry_date, old.title) then
    insert into public.record_entry_versions
      (entry_id, owner_id, version, kind, entry_date, title, content, valid_from)
    values
      (old.id, old.owner_id, old.version, old.kind, old.entry_date, old.title, old.content,
       old.updated_at);
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;

revoke execute on function public.tg_record_entries_versioning() from public, anon, authenticated;

create trigger record_entries_versioning before update or delete on public.record_entries
  for each row execute function public.tg_record_entries_versioning();
create trigger record_entries_updated_at before update on public.record_entries
  for each row execute function public.tg_set_updated_at();
create trigger record_entries_audit after insert or update on public.record_entries
  for each row execute function public.tg_audit();

alter table public.record_entries enable row level security;
create policy record_entries_select_own on public.record_entries
  for select to authenticated using (owner_id = (select auth.uid()));
create policy record_entries_insert_own on public.record_entries
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy record_entries_update_own on public.record_entries
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

alter table public.record_entry_versions enable row level security;
create policy record_entry_versions_select_own on public.record_entry_versions
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.record_entries, public.record_entry_versions from anon;
revoke delete, truncate on public.record_entries from authenticated;
revoke insert, update, delete, truncate on public.record_entry_versions from authenticated;

-- Anexos ---------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid,
  record_entry_id uuid,
  category public.attachment_category not null default 'outro',
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 120),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  foreign key (record_entry_id, owner_id) references public.record_entries (id, owner_id) on delete restrict,
  -- O caminho no storage deve começar pela pasta da própria profissional
  constraint attachments_path_owner check (storage_path like owner_id::text || '/%')
);

create index attachments_patient_idx on public.attachments (owner_id, patient_id, created_at desc);

create or replace function public.tg_attachments_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.category in ('avaliacao', 'documento_emitido') then
      raise exception 'Anexos de avaliação e documentos emitidos fazem parte do prontuário e não podem ser excluídos.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  -- UPDATE: somente categoria/vínculo podem mudar, nunca o arquivo
  if new.storage_path <> old.storage_path or new.sha256 is distinct from old.sha256
     or new.owner_id <> old.owner_id or new.size_bytes <> old.size_bytes then
    raise exception 'O arquivo de um anexo não pode ser alterado.' using errcode = 'P0001';
  end if;
  if old.category in ('avaliacao', 'documento_emitido') and new.category <> old.category then
    raise exception 'A categoria deste anexo não pode ser alterada.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger attachments_protect before update or delete on public.attachments
  for each row execute function public.tg_attachments_protect();
create trigger attachments_audit after insert or update or delete on public.attachments
  for each row execute function public.tg_audit();

alter table public.attachments enable row level security;
create policy attachments_all_own on public.attachments
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
revoke all on public.attachments from anon;

-- Documentos emitidos (imutáveis) -----------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  patient_id uuid not null,
  doc_type public.document_type not null,
  title text not null check (char_length(title) between 1 and 200),
  purpose text check (purpose is null or char_length(purpose) <= 500),       -- finalidade
  recipient text check (recipient is null or char_length(recipient) <= 300), -- solicitante/destinatário
  issued_on date not null default current_date,
  fields jsonb not null default '{}'::jsonb,  -- conteúdo estruturado usado na geração do PDF
  attachment_id uuid,                         -- cópia do PDF emitido
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  delivered_at timestamptz,                   -- protocolo de entrega (Res. CFP 06/2019, art. 16)
  delivered_to text check (delivered_to is null or char_length(delivered_to) <= 200),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (patient_id, owner_id) references public.patients (id, owner_id) on delete restrict,
  foreign key (attachment_id, owner_id) references public.attachments (id, owner_id) on delete restrict
);

create index documents_patient_idx on public.documents (owner_id, patient_id, issued_on desc);

create or replace function public.tg_documents_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Documentos emitidos não podem ser excluídos (guarda mínima de 5 anos).' using errcode = 'P0001';
  end if;
  -- Únicas mudanças permitidas: registrar entrega e vincular o PDF uma única vez
  if (new.owner_id, new.patient_id, new.doc_type, new.title, new.purpose, new.recipient,
      new.issued_on, new.fields)
     is distinct from
     (old.owner_id, old.patient_id, old.doc_type, old.title, old.purpose, old.recipient,
      old.issued_on, old.fields) then
    raise exception 'Documentos emitidos são imutáveis. Emita um novo documento se necessário.' using errcode = 'P0001';
  end if;
  if old.attachment_id is not null and new.attachment_id is distinct from old.attachment_id then
    raise exception 'O PDF de um documento emitido não pode ser substituído.' using errcode = 'P0001';
  end if;
  if old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then
    raise exception 'O hash do PDF emitido não pode ser alterado.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger documents_immutable before update or delete on public.documents
  for each row execute function public.tg_documents_immutable();
create trigger documents_audit after insert or update on public.documents
  for each row execute function public.tg_audit();

alter table public.documents enable row level security;
create policy documents_select_own on public.documents
  for select to authenticated using (owner_id = (select auth.uid()));
create policy documents_insert_own on public.documents
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy documents_update_own on public.documents
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke all on public.documents from anon;
revoke delete, truncate on public.documents from authenticated;

-- Pacientes: impedir exclusão quando houver registro clínico ou financeiro ----
-- (as FKs com ON DELETE RESTRICT já impedem; esta mensagem é mais clara)
create or replace function public.tg_patients_protect_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.record_entries where patient_id = old.id)
     or exists (select 1 from public.documents where patient_id = old.id)
     or exists (select 1 from public.attachments where patient_id = old.id)
     or exists (select 1 from public.appointments where patient_id = old.id and status in ('atendido', 'faltou')) then
    raise exception 'Paciente com prontuário ou atendimentos registrados não pode ser excluído. Use "Dar alta" ou "Inativar".'
      using errcode = 'P0001';
  end if;
  -- Sessões futuras sem registro podem ser removidas junto
  delete from public.appointments where patient_id = old.id;
  delete from public.appointment_series where patient_id = old.id;
  return old;
end $$;

create trigger patients_protect_delete before delete on public.patients
  for each row execute function public.tg_patients_protect_delete();

-- Storage: bucket privado por profissional --------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prontuario', 'prontuario', false, 10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/xml', 'application/xml',
        'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "prontuario_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'prontuario' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "prontuario_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'prontuario' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Arquivos não são sobrescritos (sem política de UPDATE).
-- Exclusão só de arquivos que não sejam avaliação/documento emitido.
create policy "prontuario_delete_own_unprotected" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'prontuario'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.attachments a
      where a.storage_path = storage.objects.name
        and a.category in ('avaliacao', 'documento_emitido')
    )
  );
