-- =============================================================================
-- Teste 07 — Locais e horários de atendimento: isolamento, sobreposição, vínculo com sessões
-- =============================================================================
begin;

select tests.put('A', tests.create_user('ana.horarios@exemplo.invalid', 'Ana Horários', '06/222221'));
select tests.put('B', tests.create_user('bia.horarios@exemplo.invalid', 'Bia Horários', '06/222222'));

select tests.login(tests.id('A'));
with _i as (insert into public.locations (name) values ('Sala 1') returning id) select tests.put('L1', id) from _i;
with _i as (insert into public.locations (name, modality) values ('On-line', 'online') returning id) select tests.put('L2', id) from _i;
select tests.throws($q$insert into public.locations (name) values ('Sala 1')$q$, '23505', 'Nome de local repetido é recusado');

select tests.eq(tests.affected(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time)
  values (%L, 1, '08:00', '12:00')$q$, tests.id('L1'))), 1, 'Faixa de segunda 8h–12h criada');
select tests.eq(tests.affected(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time)
  values (%L, 1, '12:00', '14:00')$q$, tests.id('L2'))), 1, 'Faixa encostada (12h–14h) é permitida');
select tests.throws(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time)
  values (%L, 1, '11:00', '13:00')$q$, tests.id('L2')), '23P01', 'Faixas sobrepostas no mesmo dia são bloqueadas');
select tests.eq(tests.affected(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time)
  values (%L, 2, '11:00', '13:00')$q$, tests.id('L2'))), 1, 'Mesmo horário em outro dia é permitido');
select tests.throws(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time)
  values (%L, 3, '14:00', '13:00')$q$, tests.id('L1')), '23514', 'Fim antes do início é recusado');

with _i as (insert into public.patients (full_name) values ('Paciente Horário') returning id) select tests.put('P1', id) from _i;
with _i as (insert into public.appointments (patient_id, starts_at, ends_at, location_id)
  values (tests.id('P1'), '2030-05-06 09:00-03', '2030-05-06 09:50-03', tests.id('L1')) returning id)
select tests.put('S1', id) from _i;
select tests.eq((select location_name from public.agenda_items where id = tests.id('S1')), 'Sala 1', 'Agenda mostra o nome do local');

-- excluir o local mantém a sessão, só sem local
delete from public.locations where id = tests.id('L1');
select tests.ok((select location_id is null from public.appointments where id = tests.id('S1')), 'Excluir local não apaga a sessão');
select tests.eq((select count(*)::int from public.working_hours where location_id = tests.id('L1')), 0, 'Faixas do local excluído saem junto');
reset role;

-- Outra profissional não vê nem usa os locais da primeira
select tests.login(tests.id('B'));
select tests.eq((select count(*)::int from public.locations), 0, 'Outra profissional não vê locais alheios');
select tests.eq((select count(*)::int from public.working_hours), 0, 'Outra profissional não vê horários alheios');
select tests.throws(format($q$insert into public.working_hours (location_id, weekday, start_time, end_time)
  values (%L, 4, '08:00', '09:00')$q$, tests.id('L2')), '23503', 'Não dá para usar local de outra profissional');
select tests.eq(tests.affected($q$insert into public.working_hours (location_id, weekday, start_time, end_time)
  select id, 1, '08:00', '12:00' from public.locations$q$), 0, 'Inserção via local alheio não acontece');
reset role;

-- Visitante sem login não acessa nada
select tests.login_anon();
select tests.throws($q$select * from public.locations$q$, '42501', 'Anônimo não lê locais');
select tests.throws($q$select * from public.working_hours$q$, '42501', 'Anônimo não lê horários');
reset role;

rollback;
