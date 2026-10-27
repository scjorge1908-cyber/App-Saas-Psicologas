// Mover sessão em duas etapas:
//  1) EscolherHorario: horários livres da grade por DIA DA SEMANA e sala (sem datas), ex.: "Quarta · Sala 1".
//  2) EscolherDataInicio: as próximas datas daquele dia/horário; as ocupadas por outro paciente aparecem como
//     "Ocupado" e não podem ser escolhidas; já vem marcada a primeira data livre.
// Ocupação conferida data a data (cada sessão da série tem a sua data): um paciente quinzenal ocupa só as datas
// dele, então dois quinzenais podem dividir o mesmo horário em semanas alternadas — mesma regra da migration 105
// do HopeCore (paridade pela data de início), sem presumir alternância quando não há datas.
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { AgendaItem, Location, SeriesFrequency } from '../../lib/types';
import { horariosLivres } from '../../lib/horarios';
import { addDays, todayIn, weekday, weekdayName, zonedParts, zonedToUtc } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Loading, cx } from '../ui';

export type Escolha = { weekday: number; time: string; location: Location | null };

const SEMANAS = 8; // olha 8 semanas à frente
const NOMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ddmmaaaa = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const nomeSala = (l: Location | null) => (!l ? 'Sem sala' : l.modality === 'online' && !/on-?line/i.test(l.name) ? `${l.name} · On-line` : l.name);

/** Horários livres por data nas próximas semanas, sem contar a própria sessão (nem as futuras da mesma série). */
function useLivres(item: AgendaItem) {
  const { profile, tz } = useProfile();
  const hoje = todayIn(tz);
  const fim = addDays(hoje, SEMANAS * 7);
  const fromIso = zonedToUtc(hoje, '00:00', tz);
  const toIso = zonedToUtc(fim, '00:00', tz);
  const agenda = useQuery({ queryKey: ['agenda', fromIso, toIso], queryFn: () => api.listAgenda(fromIso, toIso) });
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations });
  const horas = useQuery({ queryKey: ['working-hours'], queryFn: api.listWorkingHours });

  const porData = useMemo(() => {
    const m = new Map<string, Array<{ time: string; location: Location | null }>>();
    if (!agenda.data || !horas.data || !locais.data || !profile) return m;
    const itens = agenda.data.filter((it) => it.id !== item.id && !(item.series_id && it.series_id === item.series_id && it.starts_at >= item.starts_at));
    const ativas = new Set(locais.data.filter((l) => l.active).map((l) => l.id));
    const faixas = horas.data.filter((h) => !h.location_id || ativas.has(h.location_id));
    for (let i = 0; i < SEMANAS * 7; i++) {
      const d = addDays(hoje, i);
      m.set(d, horariosLivres({ date: d, hours: faixas, locations: locais.data, items: itens.filter((it) => zonedParts(it.starts_at, tz).date === d),
        sessionMinutes: profile.session_minutes, bufferMinutes: profile.buffer_minutes, tz }).map((l) => ({ time: l.time, location: l.location })));
    }
    return m;
  }, [agenda.data, horas.data, locais.data, profile, item.id, item.series_id, item.starts_at, hoje, tz]);

  return { porData, hoje, carregando: agenda.isLoading || horas.isLoading || locais.isLoading, semGrade: !!horas.data && horas.data.length === 0 };
}

/** Etapa 1: horários livres por dia da semana e sala (sem datas). */
export function EscolherHorario({ item, escolhido, onEscolher }: { item: AgendaItem; escolhido: Escolha | null; onEscolher: (e: Escolha) => void }) {
  const { porData, hoje, carregando, semGrade } = useLivres(item);
  const grupos = useMemo(() => {
    const g = new Map<string, { weekday: number; location: Location | null; horarios: Set<string> }>();
    for (const [d, livres] of porData) for (const l of livres) {
      const k = `${weekday(d)}|${l.location?.id ?? ''}`;
      if (!g.has(k)) g.set(k, { weekday: weekday(d), location: l.location, horarios: new Set() });
      g.get(k)!.horarios.add(l.time);
    }
    // ordem: a partir do dia de hoje (ex.: hoje terça → terça, quarta, …, segunda)
    const base = weekday(hoje);
    return [...g.values()].map((x) => ({ ...x, horarios: [...x.horarios].sort() }))
      .sort((a, b) => ((a.weekday - base + 7) % 7) - ((b.weekday - base + 7) % 7) || nomeSala(a.location).localeCompare(nomeSala(b.location)));
  }, [porData, hoje]);

  if (carregando) return <Loading />;
  if (semGrade) return <p className="text-tinta-2">Você ainda não tem grade de horários. Crie em Agenda → Editar grade para escolher um horário aqui.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.9375rem] text-tinta-2">Toque no novo horário e depois em <b>Mover</b> para escolher a data de início.</p>
      {grupos.length === 0 && <p className="rounded-campo bg-afundado px-3 py-3 text-tinta-2">Nenhum horário livre nas próximas semanas.</p>}
      {grupos.map((g) => (
        <section key={`${g.weekday}|${g.location?.id ?? ''}`} aria-label={`${NOMES[g.weekday]}, ${nomeSala(g.location)}`} className="flex flex-col gap-1.5">
          <h3 className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.9375rem] font-extrabold">
            <span>{NOMES[g.weekday]}</span>
            <span className="ml-auto rounded-full bg-afundado px-2.5 py-0.5 text-[0.8125rem] font-bold text-tinta-2">{nomeSala(g.location)}</span>
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
            {g.horarios.map((h) => {
              const sel = !!escolhido && escolhido.weekday === g.weekday && escolhido.time === h && (escolhido.location?.id ?? null) === (g.location?.id ?? null);
              return (
                <button key={h} type="button" onClick={() => onEscolher({ weekday: g.weekday, time: h, location: g.location })} aria-pressed={sel}
                  aria-label={`${NOMES[g.weekday]} às ${h}, ${nomeSala(g.location)}`}
                  className={cx('num min-h-11 rounded-campo border-l-4 text-[1rem] font-extrabold',
                    sel ? 'border-l-ag-livre bg-ag-livre text-papel' : 'border-l-ag-livre-borda bg-ag-livre-fundo text-ag-livre hover:brightness-[.97]')}>
                  {h}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Etapa 2: data de início naquele dia/horário/sala. Ocupadas aparecem como "Ocupado" e não podem ser escolhidas. */
export type FreqMover = 'nao' | SeriesFrequency;
const FREQS: Array<[FreqMover, string]> = [['nao', 'Avulso'], ['semanal', 'Semanal'], ['quinzenal', 'Quinzenal']];

export function EscolherDataInicio({ item, escolha, data, onData, freq, onFreq }: {
  item: AgendaItem; escolha: Escolha; data: string | null; onData: (d: string) => void; freq: FreqMover; onFreq: (f: FreqMover) => void;
}) {
  const { porData, hoje, carregando } = useLivres(item);
  const datas = useMemo(() => {
    const primeira = addDays(hoje, (escolha.weekday - weekday(hoje) + 7) % 7);
    return Array.from({ length: SEMANAS }, (_, i) => addDays(primeira, 7 * i)).filter((d) => porData.has(d)).map((d) => ({
      d, livre: (porData.get(d) ?? []).some((l) => l.time === escolha.time && (l.location?.id ?? null) === (escolha.location?.id ?? null)),
    }));
  }, [porData, hoje, escolha]);
  // Já vem marcada a primeira data livre
  const primeiraLivre = datas.find((x) => x.livre)?.d ?? null;
  useEffect(() => { if (!data && primeiraLivre) onData(primeiraLivre); }, [data, primeiraLivre, onData]);
  if (carregando) return <Loading />;
  const opcoes = item.series_frequency === 'mensal' && item.series_id ? [...FREQS, ['mensal', 'A cada 4 semanas'] as [FreqMover, string]] : FREQS;
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-campo bg-ag-livre-fundo px-3 py-2 font-bold text-ag-livre">{NOMES[escolha.weekday]} às {escolha.time} · {nomeSala(escolha.location)}</p>
      {/* Modalidade: quem decide é a psicóloga (vem marcada a atual do paciente) */}
      <div className="flex flex-col gap-1.5">
        <span className="rotulo">Modalidade</span>
        <div role="radiogroup" aria-label="Modalidade" className="grid grid-cols-3 gap-1 rounded-campo bg-afundado p-1">
          {opcoes.map(([v, r]) => (
            <button key={v} type="button" role="radio" aria-checked={freq === v} onClick={() => onFreq(v)}
              className={cx('min-h-11 rounded-[calc(var(--r-field)-4px)] text-[0.9375rem] font-bold', freq === v ? 'btn-degrade' : 'text-tinta-2 hover:bg-papel/60')}>{r}</button>
          ))}
        </div>
      </div>
      <p className="text-[0.9375rem] text-tinta-2">
        Escolha a <b>data de início</b>.{' '}
        {freq === 'quinzenal' ? 'A partir dela, a sessão se repete a cada 2 semanas.' : freq === 'semanal' ? 'A partir dela, a sessão se repete toda semana.' : freq === 'mensal' ? 'A partir dela, a sessão se repete a cada 4 semanas.' : 'Uma sessão só, nesta data.'}
        {item.series_id && ' As sessões já registradas não mudam.'}
        {item.series_id && freq === 'nao' && ' As próximas sessões da repetição atual são retiradas da agenda.'}
      </p>
      <div role="radiogroup" aria-label="Data de início" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {datas.map(({ d, livre }) => (
          <button key={d} type="button" role="radio" aria-checked={data === d} disabled={!livre} onClick={() => onData(d)}
            aria-label={`${ddmmaaaa(d)}${livre ? '' : ', ocupado'}`}
            className={cx('flex min-h-12 flex-col items-center justify-center rounded-campo border text-[0.9375rem] leading-tight',
              !livre ? 'cursor-not-allowed border-linha bg-afundado text-tinta-3 line-through decoration-1'
                : data === d ? 'border-transparent bg-ag-livre font-extrabold text-papel' : 'border-ag-livre-borda/45 bg-papel font-bold text-ag-livre')}>
            <span className="num">{ddmmaaaa(d)}</span>
            <span className="text-[0.75rem] font-bold no-underline">{livre ? (d === hoje ? 'hoje' : weekdayName(d).replace('-feira', '')) : 'Ocupado'}</span>
          </button>
        ))}
      </div>
      {datas.every((x) => !x.livre) && <p className="rounded-campo bg-ocre-fundo px-3 py-2 text-ocre">Este horário está ocupado em todas as próximas datas. Escolha outro horário.</p>}
    </div>
  );
}
