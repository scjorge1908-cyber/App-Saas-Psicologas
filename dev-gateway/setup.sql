-- Papel de login do gateway local (equivalente ao "authenticator" do PostgREST
-- + "supabase_auth_admin"/"supabase_storage_admin"). Somente desenvolvimento.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'gateway') then
    create role gateway login password 'gateway' noinherit bypassrls;
  end if;
end $$;
grant anon, authenticated to gateway;
grant usage on schema auth, storage, public to gateway;
grant select, insert, update on auth.users to gateway;
grant select on storage.buckets to gateway;
alter role gateway bypassrls;

-- Função "nfse" no gateway local: executa as funções do servidor (nfse_*) como service_role,
-- como a função do Supabase faz com a chave de serviço. Somente desenvolvimento.
grant service_role to gateway;
