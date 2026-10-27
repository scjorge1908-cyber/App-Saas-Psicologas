// Avisos do dia: sininho discreto no cabeçalho, ao lado da engrenagem, com o número de avisos.
// Abre uma janela com os alertas; ela também abre sozinha sempre que o app é aberto e há pendências. Fecha no X, no "Fechar", tocando fora ou com Esc.
import { useEffect, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../lib/api';
import { money } from '../lib/format';
import { VALOR_OCULTO, useValoresVisiveis } from '../lib/privacidade';
import { Dialog, cx } from './ui';
import { IconChevronRight } from './icons';
import { JanelaAvulsos, useAvulsosSemRetorno } from './AvulsosSemRetorno';

// A janela abre sozinha a cada abertura do app (uma vez por abertura): a marca fica em sessionStorage,
// que zera quando o app/aba é fechado; navegar entre telas não reabre.
const CHAVE_VISTO = 'psi.avisos.mostrados';
let mostradoNestaAbertura = false;
const jaMostrado = () => { if (mostradoNestaAbertura) return true; try { return sessionStorage.getItem(CHAVE_VISTO) === '1'; } catch { return false; } };
const marcarMostrado = () => { mostradoNestaAbertura = true; try { sessionStorage.setItem(CHAVE_VISTO, '1'); } catch { /* sem armazenamento */ } };

// Janela aberta/fechada compartilhada entre o(s) sininho(s) e a janela única
let aberta = false;
const ouvintes = new Set<() => void>();
const definir = (v: boolean) => { aberta = v; ouvintes.forEach((f) => f()); };
const useAberta = () => useSyncExternalStore((f) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; }, () => aberta, () => aberta);

const IconBell = (p: React.SVGProps<SVGSVGElement>) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    <path d="M6 9a6 6 0 1112 0c0 4.5 1.8 6.3 2.4 7H3.6C4.2 15.3 6 13.5 6 9z" /><path d="M10 19.5a2.2 2.2 0 004 0" />
  </svg>
);

// Janela dos pacientes avulsos sem próxima sessão (aberta a partir de um aviso)
let avulsosAberta = false;
const ouvAvulsos = new Set<() => void>();
const definirAvulsos = (v: boolean) => { avulsosAberta = v; ouvAvulsos.forEach((f) => f()); };
const useAvulsosAberta = () => useSyncExternalStore((f) => { ouvAvulsos.add(f); return () => { ouvAvulsos.delete(f); }; }, () => avulsosAberta, () => avulsosAberta);

type Aviso = { n: string; t: string; tom: string; para?: string; acao?: () => void };

function useAvisos() {
  const [valoresVisiveis] = useValoresVisiveis();
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  const avulsos = useAvulsosSemRetorno();
  const d = dash.data;
  const itens = (d ? [
    avulsos.length > 0 && { n: String(avulsos.length), t: avulsos.length === 1 ? 'paciente avulso sem próxima sessão: manter ou dar alta?' : 'pacientes avulsos sem próxima sessão: manter ou dar alta?',
      acao: () => { definir(false); definirAvulsos(true); }, tom: 'bg-anil-claro text-sobre-anil-claro' },
    d.to_register > 0 && { n: String(d.to_register), t: d.to_register === 1 ? 'sessão aguarda registro' : 'sessões aguardam registro', para: '/?pendencias=1', tom: 'bg-ocre-fundo text-ocre' },
    d.to_confirm_48h > 0 && { n: String(d.to_confirm_48h), t: 'sem confirmação nas próximas 48 h', para: '/resumo', tom: 'bg-azul-fundo text-azul' },
    d.overdue > 0 && { n: 'R$', t: `${valoresVisiveis ? money(d.overdue) : VALOR_OCULTO} em atraso`, para: '/financeiro', tom: 'bg-vermelho-fundo text-vermelho' },
    d.receita_saude_pending > 0 && { n: String(d.receita_saude_pending), t: 'sem recibo no Receita Saúde', para: '/financeiro?aba=receita', tom: 'bg-ocre-fundo text-ocre' },
    d.invoices_pending > 0 && { n: String(d.invoices_pending), t: d.invoices_pending === 1 ? 'nota fiscal a emitir' : 'notas fiscais a emitir', para: '/notas-fiscais', tom: 'bg-azul-fundo text-azul' },
  ] : []).filter(Boolean) as Aviso[];
  return { d, itens };
}

/** Sininho do cabeçalho (mesmo tamanho do "?" e da engrenagem), com a bolinha do número de avisos. */
export function BotaoAvisos({ className }: { className?: string }) {
  const { itens } = useAvisos();
  const n = itens.length;
  return (
    <button type="button" onClick={() => definir(true)} aria-haspopup="dialog" title="Avisos de hoje"
      aria-label={n ? `Avisos de hoje: ${n} ${n === 1 ? 'aviso' : 'avisos'}` : 'Avisos de hoje: nenhum aviso'}
      className={cx('relative grid size-12 shrink-0 place-items-center rounded-full hover:bg-white/15', className)}>
      <IconBell />
      {n > 0 && <span aria-hidden className="absolute right-1.5 top-1.5 grid min-w-[1.125rem] place-items-center rounded-full bg-vermelho-forte px-1 text-[0.6875rem] font-extrabold leading-[1.125rem] text-white">{n}</span>}
    </button>
  );
}

/** Janela única dos avisos (montada uma vez no AppShell). */
export function JanelaAvisos() {
  const abertaAgora = useAberta();
  const { d, itens } = useAvisos();

  // Abre sozinha sempre que o app é aberto e há pendências (uma vez por abertura)
  useEffect(() => {
    if (itens.length === 0 || jaMostrado()) return;
    marcarMostrado();
    definir(true);
  }, [itens.length]);

  if (!d) return null;
  const sessoes = `${d.sessions_today} ${d.sessions_today === 1 ? 'sessão' : 'sessões'}`;
  const titulo = `Hoje · ${sessoes}${itens.length ? ` · ${itens.length} ${itens.length === 1 ? 'aviso' : 'avisos'}` : ''}`;
  const fechar = () => definir(false);

  return (
    <Dialog open={abertaAgora} onClose={fechar} title={titulo}
      footer={<button onClick={fechar} className="btn-degrade pressionar min-h-12 w-full rounded-botao font-bold">Fechar</button>}>
      <div className="flex flex-col gap-1.5">
        {itens.length === 0 && <p className="text-tinta-2">Nada pendente. Tudo em dia.</p>}
        {itens.map((i) => {
          const cls = cx('flex min-h-12 w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-campo px-3 py-1.5 text-left', i.tom);
          const corpo = (<>
            <span className="num min-w-9 text-center text-[1.5rem] font-extrabold leading-none">{i.n}</span>
            <span className="min-w-0 flex-1 basis-28 text-[0.9375rem] font-bold leading-snug">{i.t}</span>
            <IconChevronRight className="size-4 shrink-0 opacity-70" />
          </>);
          return i.acao
            ? <button key={i.t} type="button" onClick={i.acao} className={cls}>{corpo}</button>
            : <Link key={i.t} to={i.para ?? '/resumo'} onClick={fechar} className={cls}>{corpo}</Link>;
        })}
        <Link to="/resumo" onClick={fechar} className="inline-flex min-h-11 items-center self-start px-1 pt-1 text-sm font-bold text-anil-escuro">Ver resumo completo</Link>
      </div>
    </Dialog>
  );
}

/** Janela dos pacientes avulsos (montada uma vez no AppShell, ao lado da janela de avisos). */
export function JanelaAvulsosGlobal() {
  const aberta = useAvulsosAberta();
  return <JanelaAvulsos open={aberta} onClose={() => definirAvulsos(false)} />;
}
