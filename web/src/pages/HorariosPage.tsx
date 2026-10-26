// "Horários": onde a psicóloga cadastra os locais em que atende e as faixas semanais de atendimento.
// A agenda usa isso para sugerir os horários livres. Aberta por um botão discreto na Agenda.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { Location, Modality, WorkingHour } from '../lib/types';
import { DIAS_SEMANA, faixaTexto } from '../lib/horarios';
import { errorMessage } from '../lib/errors';
import { Button, Dialog, ErrorBox, Loading, Select, TextField, cx, useConfirm, useToast } from '../components/ui';
import { IconChevronLeft, IconPlus } from '../components/icons';

const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // a semana de trabalho começa na segunda
const CORES = ['#6750A4', '#0B6E8A', '#B3541E', '#2F7D5B', '#9C2F6B', '#5B6472'];

export function HorariosPage() {
  const qc = useQueryClient();
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });
  const [editLocal, setEditLocal] = useState<Partial<Location> | null>(null);
  const [editHora, setEditHora] = useState<Partial<WorkingHour> | null>(null);
  const atualizar = () => {
    void qc.invalidateQueries({ queryKey: ['locations'] });
    void qc.invalidateQueries({ queryKey: ['working-hours'] });
    void qc.invalidateQueries({ queryKey: ['agenda'] });
  };

  const erro = locais.error ?? horas.error;
  const lista = locais.data ?? [];
  const nomeLocal = (id: string) => lista.find((l) => l.id === id);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-2">
        <Link to="/agenda" className="grid size-11 place-items-center rounded-xl text-tinta-2 hover:bg-cinza-fundo" aria-label="Voltar para a agenda"><IconChevronLeft /></Link>
        <div>
          <h1 className="text-[24px] font-bold leading-tight">Horários</h1>
          <p className="text-[15px] text-tinta-2">Onde e quando você atende. A agenda sugere os horários livres a partir daqui.</p>
        </div>
      </header>

      {erro && <ErrorBox>{errorMessage(erro)}</ErrorBox>}
      {(locais.isLoading || horas.isLoading) && <Loading />}

      {/* Locais */}
      <section aria-labelledby="t-locais" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 id="t-locais" className="text-[13px] font-bold uppercase tracking-[.06em] text-tinta-3">Locais de atendimento</h2>
          <Button variant="ghost" size="sm" onClick={() => setEditLocal({ modality: 'presencial', color: CORES[lista.length % CORES.length] })}><IconPlus /> Local</Button>
        </div>
        {locais.data && lista.length === 0 && (
          <button type="button" onClick={() => setEditLocal({ modality: 'presencial', color: CORES[0] })}
            className="rounded-2xl border border-dashed border-linha-forte bg-papel px-4 py-5 text-left text-tinta-2 hover:border-anil">
            <strong className="block text-tinta">Comece cadastrando um local</strong>
            Ex.: "Sala 1 · Centro" ou "On-line".
          </button>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {lista.map((l) => (
            <li key={l.id}>
              <button type="button" onClick={() => setEditLocal(l)}
                className={cx('flex w-full items-center gap-3 rounded-2xl border border-linha bg-papel px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,36,48,.06)]', !l.active && 'opacity-60')}>
                <span className="size-3 shrink-0 rounded-full" style={{ background: l.color ?? 'var(--color-anil)' }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate">{l.name}</strong>
                  <span className="text-sm text-tinta-3">{l.modality === 'online' ? 'On-line' : l.address || 'Presencial'}{!l.active && ' · desativado'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Semana */}
      {lista.length > 0 && (
        <section aria-labelledby="t-semana" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="t-semana" className="text-[13px] font-bold uppercase tracking-[.06em] text-tinta-3">Horários da semana</h2>
            <Button variant="ghost" size="sm" onClick={() => setEditHora({ weekday: 1, start_time: '08:00', end_time: '12:00', location_id: lista[0].id })}><IconPlus /> Horário</Button>
          </div>
          <ul className="flex flex-col divide-y divide-linha overflow-hidden rounded-2xl border border-linha bg-papel">
            {ORDEM_DIAS.map((d) => {
              const doDia = (horas.data ?? []).filter((h) => h.weekday === d);
              return (
                <li key={d} className="flex items-start gap-3 px-4 py-3">
                  <span className="w-20 shrink-0 pt-1.5 font-bold">{DIAS_SEMANA[d].slice(0, 3)}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                    {doDia.length === 0 && <span className="pt-1.5 text-tinta-3">Sem atendimento</span>}
                    {doDia.map((h) => {
                      const l = nomeLocal(h.location_id);
                      return (
                        <button key={h.id} type="button" onClick={() => setEditHora(h)}
                          className="num inline-flex min-h-9 items-center gap-2 rounded-full border border-linha bg-gesso px-3 text-[14px] font-bold hover:border-anil">
                          <span className="size-2 rounded-full" style={{ background: l?.color ?? 'var(--color-anil)' }} aria-hidden />
                          {faixaTexto(h)}<span className="font-normal text-tinta-3">{l?.name}</span>
                        </button>
                      );
                    })}
                    <button type="button" onClick={() => setEditHora({ weekday: d, start_time: '08:00', end_time: '12:00', location_id: lista[0].id })}
                      className="inline-flex min-h-9 items-center rounded-full px-2 text-tinta-3 hover:text-anil" aria-label={`Adicionar horário na ${DIAS_SEMANA[d]}`}>
                      <IconPlus />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <LocalDialog local={editLocal} onClose={() => setEditLocal(null)} onSaved={atualizar} />
      <HoraDialog hora={editHora} locais={lista} onClose={() => setEditHora(null)} onSaved={atualizar} />
    </div>
  );
}

function LocalDialog({ local, onClose, onSaved }: { local: Partial<Location> | null; onClose: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [form, setForm] = useState<Partial<Location>>({});
  const [aberto, setAberto] = useState<Partial<Location> | null>(null);
  if (local !== aberto) { setAberto(local); setForm(local ?? {}); }

  const salvar = useMutation({
    mutationFn: () => api.saveLocation({ ...form, name: (form.name ?? '').trim() }),
    onSuccess: () => { onSaved(); toast('Local salvo'); onClose(); },
  });
  const excluir = useMutation({
    mutationFn: () => api.deleteLocation(form.id!),
    onSuccess: () => { onSaved(); toast('Local excluído'); onClose(); },
  });

  async function pedirExclusao() {
    const ok = await confirm({ title: 'Excluir este local?', confirmLabel: 'Excluir', danger: true,
      body: 'Os horários deste local saem da semana. As sessões já marcadas continuam na agenda, só sem o local.' });
    if (ok) excluir.mutate();
  }
  function enviar(e: FormEvent) { e.preventDefault(); salvar.mutate(); }

  return (
    <Dialog open={!!local} onClose={onClose} title={form.id ? 'Editar local' : 'Novo local'}
      footer={<>
        {form.id && <Button variant="ghost" className="mr-auto text-vermelho" onClick={pedirExclusao} busy={excluir.isPending}>Excluir</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="form-local" busy={salvar.isPending}>Salvar</Button>
      </>}>
      <form id="form-local" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {(salvar.error || excluir.error) && <ErrorBox>{errorMessage(salvar.error ?? excluir.error)}</ErrorBox>}
        <TextField label="Nome" required maxLength={80} placeholder="Sala 1 · Centro" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="flex gap-2" role="radiogroup" aria-label="Tipo de atendimento">
          {(['presencial', 'online'] as Modality[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={form.modality === m} onClick={() => setForm({ ...form, modality: m })}
              className={cx('min-h-11 flex-1 rounded-xl border px-3 font-bold', form.modality === m ? 'border-anil bg-anil-claro text-anil' : 'border-linha-forte text-tinta-2')}>
              {m === 'online' ? 'On-line' : 'Presencial'}
            </button>
          ))}
        </div>
        {form.modality !== 'online' && (
          <TextField label="Endereço (opcional)" maxLength={300} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value || null })} />
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-bold text-tinta-2">Cor na agenda</legend>
          <div className="flex gap-2">
            {CORES.map((c) => (
              <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} aria-label={`Cor ${c}`} aria-pressed={form.color === c}
                className={cx('size-10 rounded-full border-2', form.color === c ? 'border-tinta' : 'border-transparent')} style={{ background: c }} />
            ))}
          </div>
        </fieldset>
        {form.id && (
          <label className="flex items-center gap-3 text-[15px]">
            <input type="checkbox" className="size-5 accent-anil" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Local em uso (desmarque para pausar sem excluir)
          </label>
        )}
      </form>
    </Dialog>
  );
}

function HoraDialog({ hora, locais, onClose, onSaved }: { hora: Partial<WorkingHour> | null; locais: Location[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<Partial<WorkingHour>>({});
  const [aberto, setAberto] = useState<Partial<WorkingHour> | null>(null);
  if (hora !== aberto) { setAberto(hora); setForm(hora ? { ...hora, start_time: hora.start_time?.slice(0, 5), end_time: hora.end_time?.slice(0, 5) } : {}); }

  const salvar = useMutation({
    mutationFn: () => api.saveWorkingHour({ id: form.id, weekday: form.weekday ?? 1, start_time: form.start_time ?? '', end_time: form.end_time ?? '', location_id: form.location_id ?? '' }),
    onSuccess: () => { onSaved(); toast('Horário salvo'); onClose(); },
  });
  const excluir = useMutation({
    mutationFn: () => api.deleteWorkingHour(form.id!),
    onSuccess: () => { onSaved(); toast('Horário excluído'); onClose(); },
  });
  function enviar(e: FormEvent) { e.preventDefault(); salvar.mutate(); }

  return (
    <Dialog open={!!hora} onClose={onClose} title={form.id ? 'Editar horário' : 'Novo horário'}
      footer={<>
        {form.id && <Button variant="ghost" className="mr-auto text-vermelho" onClick={() => excluir.mutate()} busy={excluir.isPending}>Excluir</Button>}
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button type="submit" form="form-hora" busy={salvar.isPending}>Salvar</Button>
      </>}>
      <form id="form-hora" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
        {(salvar.error || excluir.error) && <ErrorBox>{errorMessage(salvar.error ?? excluir.error)}</ErrorBox>}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-tinta-2">Dia da semana</span>
          <Select value={form.weekday ?? 1} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
            {ORDEM_DIAS.map((d) => <option key={d} value={d}>{DIAS_SEMANA[d]}</option>)}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Início" type="time" step={300} required value={form.start_time ?? ''} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          <TextField label="Fim" type="time" step={300} required value={form.end_time ?? ''} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-tinta-2">Local</span>
          <Select value={form.location_id ?? ''} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
            {locais.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
      </form>
    </Dialog>
  );
}
