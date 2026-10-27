-- 1) Endereço do paciente em campos (CEP preenche o resto). A coluna "address" antiga continua para os cadastros já feitos.
alter table public.patients
  add column if not exists cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  add column if not exists street text check (street is null or char_length(street) <= 200),
  add column if not exists address_number text check (address_number is null or char_length(address_number) <= 20),
  add column if not exists address_complement text check (address_complement is null or char_length(address_complement) <= 100),
  add column if not exists neighborhood text check (neighborhood is null or char_length(neighborhood) <= 100),
  add column if not exists city text check (city is null or char_length(city) <= 100),
  add column if not exists uf text check (uf is null or uf ~ '^[A-Z]{2}$');

comment on column public.patients.cep is 'CEP só com números (8 dígitos). Endereço preenchido pela consulta ao CEP e conferido pela psicóloga.';

-- 2) Duração da sessão e intervalo próprios de cada faixa de atendimento (vazio = usa o padrão do perfil).
alter table public.working_hours
  add column if not exists session_minutes int check (session_minutes is null or session_minutes between 10 and 300),
  add column if not exists buffer_minutes int check (buffer_minutes is null or buffer_minutes between 0 and 120);

comment on column public.working_hours.session_minutes is 'Duração de cada sessão nesta faixa, em minutos. Vazio = padrão do perfil.';
comment on column public.working_hours.buffer_minutes is 'Intervalo entre sessões nesta faixa, em minutos. Vazio = padrão do perfil.';

-- 3) Laudos e exames fazem parte do prontuário: como avaliação, não podem ser excluídos nem alterados.
--    (mesma função da migration de endurecimento 20261012000800, só com as duas categorias novas)
create or replace function public.tg_attachments_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  permanente constant text[] := array['avaliacao', 'documento_emitido', 'laudo', 'exame'];
begin
  if tg_op = 'INSERT' then
    if not public._importing() then new.created_at := now(); end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.storage_path <> old.storage_path or new.sha256 is distinct from old.sha256
       or new.owner_id <> old.owner_id or new.size_bytes <> old.size_bytes then
      raise exception 'O arquivo de um anexo não pode ser alterado.' using errcode = 'P0001';
    end if;
    if old.category::text = any (permanente)
       and (new.category, new.patient_id, new.record_entry_id, new.file_name, new.mime_type)
           is distinct from (old.category, old.patient_id, old.record_entry_id, old.file_name, old.mime_type) then
      raise exception 'Este anexo faz parte do prontuário e não pode ser alterado.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- exclusão
  if old.category::text = any (permanente) then
    raise exception 'Avaliações, laudos, exames e documentos emitidos fazem parte do prontuário e não podem ser excluídos.'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.documents d where d.attachment_id = old.id)
     or exists (select 1 from public.invoices i where old.id in (i.pdf_attachment_id, i.xml_attachment_id)) then
    raise exception 'Este arquivo está vinculado a um documento ou nota fiscal e não pode ser excluído.' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke execute on function public.tg_attachments_protect() from public, anon, authenticated;
