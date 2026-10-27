-- RG do paciente (só o número, digitado; documentos de identidade não são anexados — decisão de Jorge).
alter table public.patients
  add column if not exists rg text check (rg is null or char_length(rg) between 3 and 20);
