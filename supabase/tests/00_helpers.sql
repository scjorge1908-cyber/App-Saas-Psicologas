-- Utilitários de teste (somente ambiente local). Criados após as migrations.
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Cria usuário no auth.users (o gatilho cria o perfil) e devolve o id
create or replace function tests.create_user(p_email text, p_name text, p_crp text default null)
returns uuid language plpgsql as $$
declare _id uuid;
begin
  insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
  values (p_email, jsonb_build_object('full_name', p_name), now())
  returning id into _id;
  update public.profiles set crp = p_crp, onboarded_at = now() where id = _id;
  return _id;
end $$;

-- Assume a identidade de um usuário autenticado (como o PostgREST faz)
create or replace function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALHOU: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

create or replace function tests.eq(p_got anyelement, p_expected anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_expected then
    raise exception 'FALHOU: % (obtido=%, esperado=%)', p_msg, p_got, p_expected;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Executa SQL e exige erro com SQLSTATE esperado (e opcionalmente trecho da mensagem)
create or replace function tests.throws(p_sql text, p_state text, p_msg text, p_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then
      raise exception 'FALHOU: % (sqlstate obtido=% esperado=%, msg=%)', p_msg, sqlstate, p_state, sqlerrm;
    end if;
    if p_like is not null and sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'FALHOU: % (mensagem inesperada: %)', p_msg, sqlerrm;
    end if;
    raise notice 'ok - %', p_msg;
    return;
  end;
  raise exception 'FALHOU: % (nenhum erro foi lançado)', p_msg;
end $$;

-- Executa SQL e devolve o número de linhas afetadas
create or replace function tests.affected(p_sql text) returns int language plpgsql as $$
declare _n int;
begin
  execute p_sql;
  get diagnostics _n = row_count;
  return _n;
end $$;

grant execute on all functions in schema tests to anon, authenticated;

-- Registro de ids compartilhados entre passos do teste (limpo a cada arquivo via ROLLBACK)
create table if not exists tests.ids (k text primary key, v uuid not null);
grant select, insert, update on tests.ids to anon, authenticated;
create or replace function tests.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into tests.ids values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v
$$;
create or replace function tests.id(p_k text) returns uuid language sql stable as $$
  select v from tests.ids where k = p_k
$$;
grant execute on all functions in schema tests to anon, authenticated;
