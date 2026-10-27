-- Encaminhamento médico também faz parte do prontuário: não pode ser excluído nem alterado (anexo e arquivo).
create or replace function public.tg_attachments_protect()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  permanente constant text[] := array['avaliacao', 'documento_emitido', 'laudo', 'exame', 'encaminhamento'];
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
    raise exception 'Avaliações, laudos, encaminhamentos e documentos emitidos fazem parte do prontuário e não podem ser excluídos.'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.documents d where d.attachment_id = old.id)
     or exists (select 1 from public.invoices i where old.id in (i.pdf_attachment_id, i.xml_attachment_id)) then
    raise exception 'Este arquivo está vinculado a um documento ou nota fiscal e não pode ser excluído.' using errcode = 'P0001';
  end if;
  return old;
end $$;
revoke execute on function public.tg_attachments_protect() from public, anon, authenticated;

drop policy "prontuario_delete_own_unprotected" on storage.objects;
create policy "prontuario_delete_own_unprotected" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'prontuario'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.attachments a
      where a.storage_path = storage.objects.name
        and (
          a.category::text in ('avaliacao', 'documento_emitido', 'laudo', 'exame', 'encaminhamento')
          or exists (select 1 from public.documents d where d.attachment_id = a.id)
          or exists (select 1 from public.invoices i where a.id in (i.pdf_attachment_id, i.xml_attachment_id))
        )
    )
  );
