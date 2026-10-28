-- 28/10/2026 (pedido do Jorge): endereço do consultório com CEP, número, complemento e bairro
-- (a rua continua em profiles.address); e "Aniversário" como tipo de bloqueio de agenda.
-- Só acrescenta: nenhum dado existente muda.
alter table public.profiles
  add column if not exists cep text check (cep is null or cep ~ '^[0-9]{8}$'),
  add column if not exists address_number text check (address_number is null or char_length(address_number) <= 20),
  add column if not exists address_complement text check (address_complement is null or char_length(address_complement) <= 120),
  add column if not exists neighborhood text check (neighborhood is null or char_length(neighborhood) <= 120);

comment on column public.profiles.cep is 'CEP do consultório (8 números).';
comment on column public.profiles.address is 'Rua do consultório.';

alter table public.schedule_blocks drop constraint if exists schedule_blocks_kind_check;
alter table public.schedule_blocks add constraint schedule_blocks_kind_check
  check (kind in ('ferias', 'feriado', 'folga', 'aniversario', 'outro'));
