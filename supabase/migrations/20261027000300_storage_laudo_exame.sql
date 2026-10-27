-- Arquivo de laudo/exame no storage também não pode ser apagado (mesma regra dos anexos de avaliação).
-- Separado: contém a política de exclusão do storage (o conector do Supabase recusa esse texto; rodar no SQL Editor).
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
          a.category::text in ('avaliacao', 'documento_emitido', 'laudo', 'exame')
          or exists (select 1 from public.documents d where d.attachment_id = a.id)
          or exists (select 1 from public.invoices i where a.id in (i.pdf_attachment_id, i.xml_attachment_id))
        )
    )
  );
