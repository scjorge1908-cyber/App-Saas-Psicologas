// Prontuários (layout Stitch, com informações verdadeiras sobre guarda e sigilo):
// guarda e sigilo, busca e filtros, atalhos de modelos (anamnese, laudo, declaração, encaminhamento)
// e um card por paciente com demanda principal, última/próxima sessão e evolução pendente.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { errorMessage } from '../lib/errors';
import { ageOn, formatDate, formatTime, todayIn, zonedParts } from '../lib/format';
import { cpfMascarado, type ProntuarioResumo } from '../lib/prontuario';
import { useProfile } from '../auth/AuthProvider';
import { ErrorBox, Input, Loading, cx } from '../components/ui';
import { IconCalendar, IconChevronRight, IconClock, IconDoc, IconEye, IconEyeOff, IconLink, IconLock, IconReceipt, IconSearch, IconToday } from '../components/icons';

type Filtro = 'todos' | 'ativo' | 'alta' | 'inativo';
type Destino = { rotulo: string; aba: string; sub: string; icone: typeof IconDoc };
const MODELOS: Destino[] = [
  { rotulo: 'Anamnese', sub: 'Avaliação da demanda', aba: 'prontuario', icone: IconDoc },
  { rotulo: 'Laudo', sub: 'Documentos CFP', aba: 'documentos', icone: IconReceipt },
  { rotulo: 'Declaração', sub: 'Comparecimento', aba: 'documentos', icone: IconCalendar },
  { rotulo: 'Encaminhar', sub: 'Encaminhamento', aba: 'prontuario', icone: IconLink },
];
const SEM_ACENTO = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function lerPref(): boolean { try { return localStorage.getItem('psi.resumosClinicos') !== 'ocultos'; } catch { return true; } }

export function ProntuarioPage() {
  const { profile, tz } = useProfile();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['prontuarios'], queryFn: api.listProntuarios });
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [modelo, setModelo] = useState<Destino | null>(null);
  const [verResumos, setVerResumos] = useState(lerPref);
  const hoje = todayIn(tz);

  const alternarResumos = () => setVerResumos((v) => { try { localStorage.setItem('psi.resumosClinicos', v ? 'ocultos' : 'visiveis'); } catch { /* sem armazenamento */ } return !v; });
  const todos = q.data ?? [];
  const conta = (f: Filtro) => (f === 'todos' ? todos.length : todos.filter((r) => r.patient.status === f).length);
  const lista = useMemo(() => {
    const t = SEM_ACENTO(busca.trim());
    const dig = busca.replace(/\D/g, '');
    return todos.filter((r) => (filtro === 'todos' || r.patient.status === filtro)
      && (!t || SEM_ACENTO(`${r.patient.full_name} ${r.patient.social_name ?? ''} ${r.demanda ?? ''}`).includes(t) || (dig.length >= 3 && (r.patient.cpf ?? '').includes(dig))));
  }, [todos, busca, filtro]);

  const abrir = (r: ProntuarioResumo) => {
    if (modelo) { nav(`/pacientes/${r.patient.id}?aba=${modelo.aba}`); setModelo(null); return; }
    nav(`/pacientes/${r.patient.id}?aba=prontuario`);
  };

  return (
    <div className="flex flex-col gap-4 pb-6">
      <header>
        <h1 className="titulo-display text-[28px] leading-tight">Prontuários</h1>
        {profile && <p className="text-[15px] text-tinta-2">{profile.full_name}{profile.crp ? ` · CRP ${profile.crp}` : ''}</p>}
      </header>

      {/* Guarda e sigilo (informações verdadeiras do sistema) */}
      <section className="cartao flex flex-col gap-2 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-campo bg-anil-claro text-sobre-anil-claro"><IconLock /></span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-bold">Guarda e sigilo <span className="rounded-full bg-livre-fundo px-2 py-0.5 text-[12px] text-livre">Ativo</span></p>
            <p className="text-sm text-tinta-2">Registro documental conforme a Res. CFP 001/2009.</p>
          </div>
        </div>
        <ul className="grid gap-1 text-sm text-tinta-2 sm:grid-cols-3">
          <li>• Só você acessa; cada abertura fica registrada</li>
          <li>• Nada é apagado; correções ficam no histórico</li>
          <li>• Guarda mínima de 5 anos</li>
        </ul>
      </section>

      <label className="relative block">
        <span className="sr-only">Buscar paciente</span>
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tinta-3" />
        <Input className="pl-11" placeholder="Buscar por paciente, CPF ou demanda" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </label>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Situação">
        {([['todos', 'Todos'], ['ativo', 'Em atendimento'], ['alta', 'Alta'], ['inativo', 'Inativos']] as Array<[Filtro, string]>).map(([f, r]) => (
          <button key={f} role="tab" aria-selected={filtro === f} onClick={() => setFiltro(f)}
            className={cx('min-h-10 shrink-0 rounded-full border px-3.5 text-sm font-bold', filtro === f ? 'btn-degrade border-transparent' : 'border-linha bg-papel text-tinta-2')}>
            {r} ({conta(f)})
          </button>
        ))}
      </div>

      {/* Modelos e documentos */}
      <section>
        <p className="mb-2 font-bold">Modelos e documentos</p>
        <div className="grid grid-cols-4 gap-2">
          {MODELOS.map((m) => (
            <button key={m.rotulo} onClick={() => setModelo(modelo?.rotulo === m.rotulo ? null : m)} aria-pressed={modelo?.rotulo === m.rotulo}
              className={cx('cartao pressionar flex flex-col items-center gap-1 px-1 py-3 text-center', modelo?.rotulo === m.rotulo && 'ring-2 ring-anil-escuro')}>
              <span className="grid size-10 place-items-center rounded-campo bg-anil-claro text-sobre-anil-claro"><m.icone className="size-5" /></span>
              <span className="text-[13px] font-bold leading-tight">{m.rotulo}</span>
              <span className="text-[11px] leading-tight text-tinta-3">{m.sub}</span>
            </button>
          ))}
        </div>
        {modelo && <p className="mt-2 rounded-campo bg-anil-claro/60 px-3 py-2 text-sm font-bold text-sobre-anil-claro">Escolha o paciente para: {modelo.rotulo}</p>}
      </section>

      <div className="flex items-center justify-between">
        <p className="font-bold">Prontuários recentes</p>
        <button onClick={alternarResumos} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-anil-escuro" aria-pressed={verResumos}>
          {verResumos ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />} {verResumos ? 'Ocultar resumos' : 'Mostrar resumos'}
        </button>
      </div>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox>{errorMessage(q.error)}</ErrorBox>}
      {q.data && lista.length === 0 && <p className="text-tinta-3">{busca ? 'Nenhum paciente encontrado.' : 'Nenhum paciente cadastrado ainda.'}</p>}

      <ol className="flex flex-col gap-3">
        {lista.map((r) => {
          const p = r.patient;
          const nome = p.social_name || p.full_name;
          const iniciais = nome.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
          const cpf = cpfMascarado(p.cpf);
          const selo = r.evolucaoPendente ? { t: 'Evolução pendente', c: 'bg-ocre-fundo text-ocre' }
            : p.status === 'alta' ? { t: 'Alta', c: 'bg-cinza-fundo text-tinta-2' }
              : p.status === 'inativo' ? { t: 'Inativo', c: 'bg-cinza-fundo text-tinta-2' }
                : r.evolucoes > 0 ? { t: 'Evoluída', c: 'bg-livre-fundo text-livre' } : { t: 'Início', c: 'bg-anil-claro text-sobre-anil-claro' };
          return (
            <li key={p.id} className="cartao flex flex-col gap-3 p-4">
              <button onClick={() => abrir(r)} className="flex items-start gap-3 text-left">
                <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-anil-claro font-bold text-sobre-anil-claro">{iniciais}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate text-[17px] font-bold">{nome}</span>
                    <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-bold', selo.c)}>{selo.t}</span>
                  </span>
                  <span className="block text-sm text-tinta-2">{[p.birth_date ? `${ageOn(p.birth_date, hoje)} anos` : null, cpf ? `CPF ${cpf}` : null].filter(Boolean).join(' · ') || '—'}</span>
                </span>
              </button>

              {verResumos && (
                <div className="rounded-campo bg-afundado p-3">
                  <p className="rotulo text-anil-escuro">Demanda principal</p>
                  <p className="mt-0.5 line-clamp-3 text-[15px]">{r.demanda ?? <span className="text-tinta-3">Avaliação da demanda ainda não registrada.</span>}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 rounded-campo bg-afundado px-3 py-2">
                  <IconClock className="size-5 shrink-0 text-tinta-3" />
                  <span className="min-w-0"><span className="rotulo block">Última sessão{r.ultima ? ` #${r.ultima.numero}` : ''}</span>
                    <span className="num block truncate text-sm font-bold">{r.ultima ? `${formatDate(zonedParts(r.ultima.starts_at, tz).date).slice(0, 5)}, ${formatTime(r.ultima.starts_at, tz)}` : '—'}</span></span>
                </div>
                <div className={cx('flex items-center gap-2 rounded-campo px-3 py-2', r.proxima ? 'bg-livre-fundo' : 'bg-afundado')}>
                  <IconToday className="size-5 shrink-0 text-tinta-3" />
                  <span className="min-w-0"><span className="rotulo block">Próxima sessão</span>
                    <span className="num block truncate text-sm font-bold">{r.proxima ? `${formatDate(zonedParts(r.proxima, tz).date).slice(0, 5)}, ${formatTime(r.proxima, tz)}` : '—'}</span></span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-tinta-3">{r.evolucoes} {r.evolucoes === 1 ? 'evolução' : 'evoluções'}</span>
                {r.evolucaoPendente ? (
                  <Link to={`/pacientes/${p.id}?aba=prontuario${r.ultima ? `&sessao=${r.ultima.id}` : ''}`} className="btn-degrade pressionar inline-flex min-h-11 items-center gap-1.5 rounded-botao px-4 text-sm font-bold"><IconDoc className="size-4" /> Evoluir sessão</Link>
                ) : (
                  <button onClick={() => abrir(r)} className="inline-flex min-h-11 items-center gap-1 rounded-botao border border-linha px-3.5 text-sm font-bold text-anil-escuro">Abrir prontuário <IconChevronRight className="size-4" /></button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-center text-[12px] text-tinta-3">Código de Ética Profissional do Psicólogo, art. 9º: sigilo profissional.</p>
    </div>
  );
}
