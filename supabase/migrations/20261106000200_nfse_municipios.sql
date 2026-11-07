-- Situação de cada município no sistema nacional da NFS-e (pedido do Jorge, 06/11/2026, 23:07: "SaaS nacional,
-- não dá para checar prefeitura por prefeitura"). Só acréscimo.
-- O servidor consulta a API oficial (parametros_municipais/{município}/convenio) e guarda a resposta aqui por alguns dias.
-- É informação pública do governo (não é dado de paciente nem da psicóloga): todas as contas leem; só o servidor grava.
create table if not exists public.nfse_municipios (
  ibge text not null check (ibge ~ '^[0-9]{7}$'),
  ambiente text not null check (ambiente in ('homologacao', 'producao')),
  situacao text not null check (situacao in ('conveniado', 'sem_convenio')),
  detalhe text check (detalhe is null or char_length(detalhe) <= 500),
  consultado_em timestamptz not null default now(),
  primary key (ibge, ambiente)
);

comment on table public.nfse_municipios is 'Cache da consulta de convênio de cada município com o sistema nacional da NFS-e (por ambiente). Só o servidor grava.';

alter table public.nfse_municipios enable row level security;
create policy nfse_municipios_le on public.nfse_municipios for select to authenticated using (true);
revoke all on public.nfse_municipios from public, anon, authenticated;
grant select on public.nfse_municipios to authenticated;
grant select, insert, update on public.nfse_municipios to service_role;

create or replace function public.nfse_municipio_obter(p_ibge text, p_ambiente text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('situacao', situacao, 'consultado_em', consultado_em)
  from public.nfse_municipios where ibge = p_ibge and ambiente = p_ambiente;
$$;

create or replace function public.nfse_municipio_salvar(p_ibge text, p_ambiente text, p_situacao text, p_detalhe text)
returns void
language sql
set search_path = ''
as $$
  insert into public.nfse_municipios (ibge, ambiente, situacao, detalhe, consultado_em)
  values (p_ibge, p_ambiente, p_situacao, left(p_detalhe, 500), now())
  on conflict (ibge, ambiente) do update set situacao = excluded.situacao, detalhe = excluded.detalhe, consultado_em = now();
$$;

revoke execute on function public.nfse_municipio_obter(text, text) from public, anon, authenticated;
revoke execute on function public.nfse_municipio_salvar(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nfse_municipio_obter(text, text) to service_role;
grant execute on function public.nfse_municipio_salvar(text, text, text, text) to service_role;
