-- 28/10/2026 (pedido do Jorge): psicóloga PJ guarda a razão social da empresa, preenchida pelo CNPJ.
-- Só acrescenta.
alter table public.profiles
  add column if not exists company_name text check (company_name is null or char_length(company_name) <= 200);
comment on column public.profiles.company_name is 'Razão social (psicóloga PJ), preenchida pela consulta do CNPJ.';
