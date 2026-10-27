-- Nota fiscal PF ou PJ (pedido do Jorge, 27/10/2026, versão 22): quem paga pode ser pessoa física ou empresa.
-- payer_tipo: 'pf' = pessoa física (payer_name + payer_cpf) · 'pj' = empresa (payer_name = razão social + payer_cnpj).
-- payer_im: inscrição municipal da empresa (opcional, alguns municípios pedem).
alter table public.patients
  add column if not exists payer_tipo text check (payer_tipo is null or payer_tipo in ('pf', 'pj')),
  add column if not exists payer_cnpj text check (payer_cnpj is null or payer_cnpj ~ '^[0-9]{14}$'),
  add column if not exists payer_im text check (payer_im is null or char_length(payer_im) <= 20);

comment on column public.patients.payer_tipo is 'Quem paga: pf (pessoa física, CPF) ou pj (empresa, CNPJ). Vazio = o próprio paciente.';
comment on column public.patients.payer_cnpj is 'CNPJ da empresa que paga (só números), tomador da nota fiscal.';
comment on column public.patients.payer_im is 'Inscrição municipal da empresa que paga (opcional).';

-- Pagadores já cadastrados (só existia pessoa física)
update public.patients set payer_tipo = 'pf' where payer_name is not null and payer_tipo is null;
