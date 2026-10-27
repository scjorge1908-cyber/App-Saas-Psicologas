-- Cartão "Nota fiscal" no cadastro do paciente (pedido do Jorge, 27/10/2026): dados de quem recebe a nota (tomador).
-- nf_tomador: 'paciente' = a nota sai no nome do próprio paciente (usa CPF, e-mail e endereço do cadastro);
--             'outro'    = outra pessoa paga e recebe a nota (campos payer_*). Vazio = ainda não definido.
-- O nome e o CPF do pagador já existiam (payer_name, payer_cpf); aqui entram contato e endereço.
alter table public.patients
  add column if not exists nf_tomador text check (nf_tomador is null or nf_tomador in ('paciente', 'outro')),
  add column if not exists payer_email text check (payer_email is null or (char_length(payer_email) <= 200 and payer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column if not exists payer_phone text check (payer_phone is null or payer_phone ~ '^[0-9]{10,11}$'),
  add column if not exists payer_cep text check (payer_cep is null or payer_cep ~ '^[0-9]{8}$'),
  add column if not exists payer_street text check (payer_street is null or char_length(payer_street) <= 200),
  add column if not exists payer_number text check (payer_number is null or char_length(payer_number) <= 20),
  add column if not exists payer_complement text check (payer_complement is null or char_length(payer_complement) <= 100),
  add column if not exists payer_neighborhood text check (payer_neighborhood is null or char_length(payer_neighborhood) <= 100),
  add column if not exists payer_city text check (payer_city is null or char_length(payer_city) <= 100),
  add column if not exists payer_uf text check (payer_uf is null or payer_uf ~ '^[A-Z]{2}$');

comment on column public.patients.nf_tomador is 'Quem recebe a nota fiscal: paciente (dados do cadastro) ou outro (campos payer_*). Vazio = não definido.';
comment on column public.patients.payer_email is 'E-mail de quem paga, para receber a nota fiscal.';
comment on column public.patients.payer_cep is 'CEP de quem paga (só números). Endereço do tomador na nota fiscal.';
