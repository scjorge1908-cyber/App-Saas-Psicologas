-- Emissão de NFS-e pelo padrão nacional (Sefin Nacional, gov.br/nfse) — pedido do Jorge, 06/11/2026.
-- Só acréscimos: nada existente é removido ou alterado em comportamento para notas registradas à mão.
--
-- 1. Perfil: dados fiscais do prestador exigidos pela DPS (município IBGE, inscrição municipal, regime,
--    código de tributação nacional, série/numeração da DPS e ambiente).
-- 2. Notas: vínculo único nota × recebimento (lacuna L4), foto do tomador no momento da emissão (L2),
--    rastreio da DPS (Id, número, ambiente), estado da emissão, XML da NFS-e e dados do cancelamento.
-- 3. Certificado A1: guardado CIFRADO (AES-GCM, chave só no servidor) numa tabela sem acesso pelo app.
--    A psicóloga vê só titular, documento e validade.
-- 4. Funções do servidor (só service_role): contexto da emissão, reserva do número, gravação do resultado.
-- 5. Proteção: nota emitida pelo sistema não pode ser alterada nem apagada pelo app (lacuna L5 para NFS-e).

-- ---------------------------------------------------------------- 1. perfil ----
alter table public.profiles
  add column if not exists nfse_ibge_municipio text check (nfse_ibge_municipio is null or nfse_ibge_municipio ~ '^[0-9]{7}$'),
  add column if not exists nfse_inscricao_municipal text check (nfse_inscricao_municipal is null or nfse_inscricao_municipal ~ '^[0-9A-Za-z./-]{1,15}$'),
  add column if not exists nfse_regime text check (nfse_regime is null or nfse_regime in ('mei', 'me_epp', 'nao_optante')),
  add column if not exists nfse_cod_trib_nac text not null default '041601' check (nfse_cod_trib_nac ~ '^[0-9]{6}$'),
  add column if not exists nfse_aliquota_iss numeric(4,2) check (nfse_aliquota_iss is null or (nfse_aliquota_iss > 0 and nfse_aliquota_iss <= 5)),
  add column if not exists nfse_descricao text not null default 'Atendimento psicológico' check (char_length(btrim(nfse_descricao)) between 3 and 1000),
  add column if not exists nfse_serie text not null default '1' check (nfse_serie ~ '^[0-9]{1,5}$'),
  add column if not exists nfse_proximo_numero bigint not null default 1 check (nfse_proximo_numero between 1 and 999999999999999),
  add column if not exists nfse_ambiente text not null default 'homologacao' check (nfse_ambiente in ('homologacao', 'producao'));

comment on column public.profiles.nfse_ibge_municipio is 'Código IBGE (7 dígitos) do município do prestador; vem da busca do CEP.';
comment on column public.profiles.nfse_regime is 'Simples Nacional: mei, me_epp ou nao_optante (opSimpNac 2, 3 ou 1 na DPS).';
comment on column public.profiles.nfse_cod_trib_nac is 'Código de tributação nacional (LC 116): 041601 = 4.16 Psicologia e psicanálise.';
comment on column public.profiles.nfse_ambiente is 'homologacao = produção restrita (nota sem valor fiscal, para teste); producao = nota válida.';
comment on column public.profiles.nfse_proximo_numero is 'Próximo número da DPS na série; o servidor reserva e incrementa.';

-- ----------------------------------------------------------------- 2. notas ----
alter table public.invoices
  add column if not exists emissao text not null default 'manual' check (emissao in ('manual', 'nfse_nacional')),
  add column if not exists emissao_estado text check (emissao_estado is null or emissao_estado in ('processando', 'erro')),
  add column if not exists emissao_erro text check (emissao_erro is null or char_length(emissao_erro) <= 2000),
  add column if not exists emissao_tentativas int not null default 0,
  add column if not exists emissao_iniciada_em timestamptz,
  add column if not exists ambiente text check (ambiente is null or ambiente in ('homologacao', 'producao')),
  add column if not exists dps_id text check (dps_id is null or dps_id ~ '^DPS[0-9]{42}$'),
  add column if not exists dps_serie text,
  add column if not exists dps_numero bigint,
  add column if not exists descricao text check (descricao is null or char_length(descricao) <= 1000),
  add column if not exists tomador_tipo text check (tomador_tipo is null or tomador_tipo in ('pf', 'pj')),
  add column if not exists tomador_documento text check (tomador_documento is null or tomador_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  add column if not exists tomador_nome text check (tomador_nome is null or char_length(tomador_nome) <= 300),
  add column if not exists nfse_xml text,
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelamento_motivo text check (cancelamento_motivo is null or char_length(cancelamento_motivo) <= 255);

-- Id da DPS é único por profissional (o Id já contém o CNPJ/CPF; duas contas do mesmo CNPJ não se travam no banco).
create unique index if not exists invoices_dps_id_uidx on public.invoices (owner_id, dps_id) where dps_id is not null;
-- Uma nota ativa (não cancelada) por recebimento: impede nota em dobro para o mesmo pagamento (L4).
create unique index if not exists invoices_payment_ativa_uidx on public.invoices (payment_id) where payment_id is not null and status <> 'cancelada';

comment on column public.invoices.emissao is 'manual = registrada à mão (emitida fora do app); nfse_nacional = emitida pelo app na API nacional.';
comment on column public.invoices.emissao_estado is 'processando = envio em andamento; erro = última tentativa recusada (ver emissao_erro). Vazio = sem pendência.';

-- A visão de notas passa a trazer as colunas novas (i.*) e o nome do paciente, como antes.
-- (recriada porque o Postgres não insere colunas no meio de uma visão existente)
drop view if exists public.invoice_items;
create view public.invoice_items
with (security_invoker = true)
as
select i.*, pt.full_name as patient_name
from public.invoices i
join public.patients pt on pt.id = i.patient_id;

revoke all on public.invoice_items from anon;
grant select on public.invoice_items to authenticated;

-- Proteção das notas emitidas pelo sistema: o app (papel authenticated) não altera dados fiscais,
-- não apaga e não preenche campos que só o servidor grava.
create or replace function public.tg_invoices_nfse_protege()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    if new.emissao = 'nfse_nacional' and new.status <> 'a_emitir' then
      raise exception 'Nota pelo sistema nasce "a emitir"; quem emite é o servidor.' using errcode = '42501';
    end if;
    if new.dps_id is not null or new.dps_numero is not null or new.dps_serie is not null or new.ambiente is not null
       or new.nfse_xml is not null or new.emissao_estado is not null or new.emissao_erro is not null
       or new.emissao_tentativas <> 0 or new.emissao_iniciada_em is not null or new.tomador_tipo is not null
       or new.tomador_documento is not null or new.tomador_nome is not null
       or new.cancelada_em is not null or new.cancelamento_motivo is not null then
      raise exception 'Campos da emissão são gravados só pelo servidor.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.emissao = 'nfse_nacional' and (old.status <> 'a_emitir' or old.dps_id is not null) then
      raise exception 'Nota emitida pelo sistema não pode ser apagada. Use Cancelar nota.' using errcode = '42501';
    end if;
    return old;
  end if;
  -- UPDATE
  -- Campos que só o servidor grava: imutáveis pelo app em QUALQUER nota (revisão de segurança 06/11:
  -- impede "montar" uma nota manual e depois virá-la em nota do sistema).
  if (new.dps_id, new.dps_serie, new.dps_numero, new.ambiente, new.nfse_xml, new.emissao_estado, new.emissao_erro,
      new.emissao_tentativas, new.emissao_iniciada_em, new.tomador_tipo, new.tomador_documento, new.tomador_nome,
      new.cancelada_em, new.cancelamento_motivo)
     is distinct from
     (old.dps_id, old.dps_serie, old.dps_numero, old.ambiente, old.nfse_xml, old.emissao_estado, old.emissao_erro,
      old.emissao_tentativas, old.emissao_iniciada_em, old.tomador_tipo, old.tomador_documento, old.tomador_nome,
      old.cancelada_em, old.cancelamento_motivo) then
    raise exception 'Dados da emissão são gravados só pelo servidor.' using errcode = '42501';
  end if;
  -- Tipo da nota: só um rascunho "a emitir", nunca enviado, troca de tipo.
  if new.emissao is distinct from old.emissao
     and (old.status <> 'a_emitir' or new.status <> 'a_emitir' or old.dps_numero is not null) then
    raise exception 'Só um rascunho "a emitir" pode mudar entre nota manual e nota pelo sistema.' using errcode = '42501';
  end if;
  if old.emissao = 'nfse_nacional' then
    if (new.status, new.number, new.access_key, new.issued_on) is distinct from (old.status, old.number, old.access_key, old.issued_on) then
      raise exception 'Situação, número e dados fiscais desta nota são gravados só pelo servidor.' using errcode = '42501';
    end if;
    -- Depois de reservado o número (enviando ou já enviada), valor/competência/tomador ficam travados.
    if old.dps_numero is not null and (new.amount, new.competence, new.patient_id, new.payment_id, new.descricao)
       is distinct from (old.amount, old.competence, old.patient_id, old.payment_id, old.descricao) then
      raise exception 'Nota já enviada ao sistema nacional não pode ter valor, competência ou tomador alterados.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists invoices_nfse_protege on public.invoices;
create trigger invoices_nfse_protege before insert or update or delete on public.invoices
  for each row execute function public.tg_invoices_nfse_protege();

-- Nota de recebimento: o recebimento ligado a uma NFS-e emitida pelo sistema não pode ser apagado nem ter o valor mudado.
create or replace function public.tg_payments_nfse_protege()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and exists (
      select 1 from public.invoices i
      where i.payment_id = old.id and i.emissao = 'nfse_nacional' and i.status = 'emitida') then
    if tg_op = 'DELETE' or new.amount is distinct from old.amount or new.patient_id is distinct from old.patient_id then
      raise exception 'Este recebimento tem NFS-e emitida. Cancele a nota antes de apagar ou mudar o valor.' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists payments_nfse_protege on public.payments;
create trigger payments_nfse_protege before update or delete on public.payments
  for each row execute function public.tg_payments_nfse_protege();

-- ----------------------------------------------------------- 3. certificado ----
create table if not exists public.nfse_certificados (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  cifrado text not null,          -- AES-GCM (base64) de {pfx, senha}; a chave fica só no servidor (segredo)
  iv text not null,
  titular text not null check (char_length(titular) <= 300),
  documento text not null check (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  valido_ate timestamptz not null,
  enviado_em timestamptz not null default now()
);

comment on table public.nfse_certificados is 'Certificado A1 da psicóloga, cifrado. Sem acesso pelo app: só o servidor (service_role) lê e grava.';

alter table public.nfse_certificados enable row level security;
-- Sem políticas: authenticated e anon não leem nem gravam.
revoke all on public.nfse_certificados from public, anon, authenticated;
grant select, insert, update, delete on public.nfse_certificados to service_role;

-- O app vê só os dados públicos do próprio certificado.
create or replace function public.meu_certificado_nfse()
returns table (titular text, documento text, valido_ate timestamptz, enviado_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.titular, c.documento, c.valido_ate, c.enviado_em
  from public.nfse_certificados c
  where c.owner_id = (select auth.uid());
$$;

create or replace function public.remover_meu_certificado_nfse()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.nfse_certificados where owner_id = (select auth.uid());
$$;

revoke execute on function public.meu_certificado_nfse() from public, anon;
revoke execute on function public.remover_meu_certificado_nfse() from public, anon;
grant execute on function public.meu_certificado_nfse() to authenticated;
grant execute on function public.remover_meu_certificado_nfse() to authenticated;

-- ------------------------------------------------- 4. funções do servidor ----
-- Contexto completo de uma emissão (prestador, nota, tomador). Só service_role; sempre filtrado pelo dono.
create or replace function public.nfse_contexto(p_owner uuid, p_invoice uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  _pr public.profiles;
  _i public.invoices;
  _pt public.patients;
  _toma jsonb;
begin
  select * into _pr from public.profiles where id = p_owner;
  select * into _i from public.invoices where id = p_invoice and owner_id = p_owner;
  if _i.id is null then
    raise exception 'Nota não encontrada.' using errcode = 'P0002';
  end if;
  select * into _pt from public.patients where id = _i.patient_id and owner_id = p_owner;

  if coalesce(_pt.nf_tomador, 'paciente') = 'outro' and _pt.payer_tipo = 'pj' then
    _toma := jsonb_build_object('tipo', 'pj', 'documento', _pt.payer_cnpj, 'nome', _pt.payer_name, 'im', _pt.payer_im,
      'email', _pt.payer_email, 'fone', _pt.payer_phone);
  elsif coalesce(_pt.nf_tomador, 'paciente') = 'outro' then
    _toma := jsonb_build_object('tipo', 'pf', 'documento', _pt.payer_cpf, 'nome', _pt.payer_name,
      'email', _pt.payer_email, 'fone', _pt.payer_phone);
  else
    _toma := jsonb_build_object('tipo', 'pf', 'documento', _pt.cpf, 'nome', _pt.full_name,
      'email', _pt.email, 'fone', _pt.phone);
  end if;

  return jsonb_build_object(
    'prestador', jsonb_build_object(
      'nome', coalesce(nullif(_pr.company_name, ''), _pr.full_name), 'tipo', _pr.fiscal_type, 'cpf', _pr.cpf, 'cnpj', _pr.cnpj,
      'ibge', _pr.nfse_ibge_municipio, 'im', _pr.nfse_inscricao_municipal, 'regime', _pr.nfse_regime,
      'cod_trib_nac', _pr.nfse_cod_trib_nac, 'aliquota', _pr.nfse_aliquota_iss, 'descricao', _pr.nfse_descricao,
      'serie', _pr.nfse_serie, 'ambiente', _pr.nfse_ambiente, 'timezone', _pr.timezone),
    'nota', to_jsonb(_i) - 'nfse_xml',
    'tomador', _toma,
    'certificado', (select jsonb_build_object('documento', c.documento, 'valido_ate', c.valido_ate)
                    from public.nfse_certificados c where c.owner_id = p_owner)
  );
end $$;

-- Reserva a emissão: trava a nota, garante "a emitir", marca "processando" e dá o número da DPS.
-- Reenvio da mesma nota reaproveita o mesmo número/Id (idempotência: a Sefin recusa DPS repetida).
create or replace function public.nfse_reservar(p_owner uuid, p_invoice uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  _i public.invoices;
  _num bigint;
  _serie text;
  _amb text;
begin
  select * into _i from public.invoices where id = p_invoice and owner_id = p_owner for update;
  if _i.id is null then
    raise exception 'Nota não encontrada.' using errcode = 'P0002';
  end if;
  if _i.status <> 'a_emitir' then
    raise exception 'Esta nota não está "a emitir".' using errcode = '22023';
  end if;
  if _i.emissao_estado = 'processando' and _i.emissao_iniciada_em > now() - interval '2 minutes' then
    raise exception 'Esta nota já está sendo enviada. Aguarde um instante.' using errcode = '55P03';
  end if;

  if _i.dps_numero is null then
    update public.profiles set nfse_proximo_numero = nfse_proximo_numero + 1
    where id = p_owner
    returning nfse_proximo_numero - 1, nfse_serie, nfse_ambiente into _num, _serie, _amb;
  else
    _num := _i.dps_numero; _serie := _i.dps_serie; _amb := _i.ambiente;
  end if;

  update public.invoices set
    emissao = 'nfse_nacional', emissao_estado = 'processando', emissao_erro = null,
    emissao_tentativas = emissao_tentativas + 1, emissao_iniciada_em = now(),
    dps_numero = _num, dps_serie = _serie, ambiente = _amb
  where id = p_invoice;

  -- Devolve os valores da nota travada: a DPS é montada com eles (não com a leitura anterior à trava).
  return jsonb_build_object('numero', _num, 'serie', _serie, 'ambiente', _amb,
    'reenvio', _i.dps_id is not null, 'dps_id', _i.dps_id,
    'amount', _i.amount, 'competence', _i.competence, 'patient_id', _i.patient_id, 'descricao', _i.descricao);
end $$;

-- Grava o resultado: sucesso (emitida) ou erro (volta a "a emitir" com a mensagem).
create or replace function public.nfse_resultado(p_owner uuid, p_invoice uuid, p jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (p ->> 'ok')::boolean then
    update public.invoices set
      status = 'emitida', emissao_estado = null, emissao_erro = null,
      dps_id = p ->> 'dps_id', number = p ->> 'numero', access_key = p ->> 'chave',
      issued_on = (p ->> 'emitida_em')::date, nfse_xml = p ->> 'xml',
      descricao = coalesce(p ->> 'descricao', descricao),
      tomador_tipo = p ->> 'tomador_tipo', tomador_documento = p ->> 'tomador_documento', tomador_nome = p ->> 'tomador_nome'
    where id = p_invoice and owner_id = p_owner and status = 'a_emitir';
  else
    update public.invoices set
      emissao_estado = 'erro', emissao_erro = left(p ->> 'erro', 2000),
      dps_id = coalesce(p ->> 'dps_id', dps_id)
    where id = p_invoice and owner_id = p_owner and status = 'a_emitir'; -- erro tardio não estraga nota já emitida
  end if;
end $$;

create or replace function public.nfse_cancelada(p_owner uuid, p_invoice uuid, p_motivo text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.invoices set status = 'cancelada', cancelada_em = now(), cancelamento_motivo = left(p_motivo, 255),
    emissao_estado = null, emissao_erro = null
  where id = p_invoice and owner_id = p_owner and emissao = 'nfse_nacional' and status = 'emitida';
  if not found then
    raise exception 'Só nota emitida pelo sistema pode ser cancelada aqui.' using errcode = '22023';
  end if;
end $$;

create or replace function public.nfse_certificado_salvar(p_owner uuid, p jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.nfse_certificados (owner_id, cifrado, iv, titular, documento, valido_ate)
  values (p_owner, p ->> 'cifrado', p ->> 'iv', p ->> 'titular', p ->> 'documento', (p ->> 'valido_ate')::timestamptz)
  on conflict (owner_id) do update set cifrado = excluded.cifrado, iv = excluded.iv, titular = excluded.titular,
    documento = excluded.documento, valido_ate = excluded.valido_ate, enviado_em = now();
$$;

create or replace function public.nfse_certificado_obter(p_owner uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('cifrado', cifrado, 'iv', iv, 'documento', documento, 'valido_ate', valido_ate)
  from public.nfse_certificados where owner_id = p_owner;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.nfse_contexto(uuid, uuid)', 'public.nfse_reservar(uuid, uuid)', 'public.nfse_resultado(uuid, uuid, jsonb)',
    'public.nfse_cancelada(uuid, uuid, text)', 'public.nfse_certificado_salvar(uuid, jsonb)', 'public.nfse_certificado_obter(uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Funções de gatilho não são chamáveis pela API (padrão do projeto, teste L2 de 06_hardening).
revoke execute on function public.tg_invoices_nfse_protege() from public, anon, authenticated;
revoke execute on function public.tg_payments_nfse_protege() from public, anon, authenticated;
