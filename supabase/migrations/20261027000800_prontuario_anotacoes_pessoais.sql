-- Prontuário (layout Stitch): anotações pessoais da psicóloga ficam num campo próprio, separado do registro.
-- Não entram no texto do registro nem em documentos; seguem o mesmo controle (sem exclusão, com histórico).
alter table public.record_entries
  add column if not exists private_notes text check (private_notes is null or char_length(private_notes) <= 20000);
alter table public.record_entry_versions
  add column if not exists private_notes text;

comment on column public.record_entries.private_notes is 'Anotações pessoais da psicóloga (uso restrito). Não entram em declarações, laudos ou relatórios.';

-- Versionamento passa a guardar também as anotações pessoais (mesma função da migration 20261012000800).
create or replace function public.tg_record_entries_versioning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'Registros de prontuário não podem ser excluídos (Res. CFP 001/2009 — guarda obrigatória). Faça uma retificação.'
      using errcode = 'P0001';
  end if;

  if new.owner_id <> old.owner_id or new.patient_id <> old.patient_id then
    raise exception 'Não é permitido transferir registros de prontuário.' using errcode = 'P0001';
  end if;
  if new.appointment_id is distinct from old.appointment_id then
    raise exception 'Não é permitido alterar a sessão vinculada a um registro.' using errcode = 'P0001';
  end if;
  new.created_at := old.created_at;
  new.restored_from_backup := old.restored_from_backup;

  if (new.content, new.kind, new.entry_date, new.title, new.private_notes)
     is distinct from (old.content, old.kind, old.entry_date, old.title, old.private_notes) then
    insert into public.record_entry_versions
      (entry_id, owner_id, version, kind, entry_date, title, content, valid_from, private_notes)
    values
      (old.id, old.owner_id, old.version, old.kind, old.entry_date, old.title, old.content, old.updated_at, old.private_notes);
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end $$;
revoke execute on function public.tg_record_entries_versioning() from public, anon, authenticated;
