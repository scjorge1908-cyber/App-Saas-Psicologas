-- =============================================================================
-- Teste 09 — Anotações pessoais no prontuário: gravação, histórico e proteção
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.anotacoes@exemplo.invalid', 'Ana Anotações', '06/444441'));
select tests.put('B', tests.create_user('bia.anotacoes@exemplo.invalid', 'Bia Anotações', '06/444442'));
select tests.login(tests.id('A'));
with _i as (insert into public.patients (full_name) values ('Paciente Anotações') returning id) select tests.put('P', id) from _i;
with _i as (insert into public.record_entries (patient_id, kind, content, private_notes)
  values (tests.id('P'), 'evolucao', 'Registro da sessão', 'Hipótese para supervisão') returning id)
select tests.put('R', id) from _i;
select tests.eq((select private_notes from public.record_entries where id = tests.id('R')), 'Hipótese para supervisão', 'Anotação pessoal gravada');

update public.record_entries set private_notes = 'Hipótese revista' where id = tests.id('R');
select tests.eq((select version from public.record_entries where id = tests.id('R')), 2, 'Mudar só a anotação pessoal gera nova versão');
select tests.eq((select private_notes from public.record_entry_versions where entry_id = tests.id('R') and version = 1), 'Hipótese para supervisão', 'Versão anterior da anotação fica no histórico');
select tests.throws(format($q$delete from public.record_entries where id = %L$q$, tests.id('R')), '42501', 'Registro continua sem exclusão (sem permissão de apagar)');

select tests.login(tests.id('B'));
select tests.eq((select count(*)::int from public.record_entries where id = tests.id('R')), 0, 'Outra psicóloga não vê o registro');
reset role;
rollback;
