// Ajuda discreta: botão "?" (folha com como usar, passeio e dúvidas), passeio guiado sobre a tela real
// e cartão de primeiros passos. Nunca bloqueia o trabalho nem apaga formulário: abre por cima e fecha num toque.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PASSEIOS, ajudaDaRota, gravarFlag, lerFlag, FLAG_PASSOS_OCULTOS, type PasseioId } from '../../lib/ajuda';
import { Dialog, cx } from '../ui';
import { IconCheck, IconChevronRight } from '../icons';

// ---------------------------------------------------------------- passeio ---
let passeioAtual: { id: PasseioId; passo: number } | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());
export function iniciarPasseio(id: PasseioId) { passeioAtual = { id, passo: 0 }; avisar(); }
function usePasseio() {
  return useSyncExternalStore((f) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; }, () => passeioAtual, () => passeioAtual);
}

/** Camada do passeio: destaca o elemento [data-ajuda=alvo] e mostra o balão. Passos sem alvo na tela são pulados. */
export function Passeio() {
  const atual = usePasseio();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const passos = atual ? PASSEIOS[atual.id].filter((p) => document.querySelector(`[data-ajuda="${p.alvo}"]`)) : [];
  const passo = atual ? passos[Math.min(atual.passo, passos.length - 1)] : null;

  useLayoutEffect(() => {
    if (!passo) { setRect(null); return; }
    const el = document.querySelector(`[data-ajuda="${passo.alvo}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    const medir = () => setRect(el.getBoundingClientRect());
    medir();
    window.addEventListener('resize', medir); window.addEventListener('scroll', medir, true);
    cartao.current?.focus();
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('scroll', medir, true); };
  }, [passo]);

  useEffect(() => {
    if (!atual) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { passeioAtual = null; avisar(); } };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [atual]);

  if (!atual || !passo) return null;
  const i = Math.min(atual.passo, passos.length - 1);
  const fechar = () => { passeioAtual = null; avisar(); };
  const ir = (n: number) => { passeioAtual = { id: atual.id, passo: n }; avisar(); };
  const embaixo = rect ? rect.top < window.innerHeight / 2 : true;
  const pad = 6;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="passeio-titulo">
      <button aria-label="Fechar passeio" className="absolute inset-0 cursor-default" onClick={fechar} />
      {rect && (
        <div aria-hidden className="pointer-events-none absolute rounded-campo ring-4 ring-white/90 transition-all"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgb(0 0 0 / .55)' }} />
      )}
      <div ref={cartao} tabIndex={-1} className="cartao absolute inset-x-4 mx-auto max-w-sm p-4 outline-none"
        style={rect ? (embaixo ? { top: Math.min(rect.bottom + 16, window.innerHeight - 220) } : { bottom: Math.min(window.innerHeight - rect.top + 16, window.innerHeight - 220) }) : { top: '30%' }}>
        <p className="rotulo">Passo {i + 1} de {passos.length}</p>
        <h2 id="passeio-titulo" className="mt-1 text-[1.0625rem] font-bold">{passo.titulo}</h2>
        <p className="mt-1 text-[0.9375rem] text-tinta-2">{passo.texto}</p>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={fechar} className="min-h-11 px-2 text-sm font-bold text-tinta-3">Pular</button>
          {i > 0 && <button onClick={() => ir(i - 1)} className="ml-auto min-h-11 rounded-botao border border-linha px-3.5 text-sm font-bold">Voltar</button>}
          <button onClick={() => (i + 1 < passos.length ? ir(i + 1) : fechar())} className={cx('btn-degrade min-h-11 rounded-botao px-4 text-sm font-bold', i === 0 && 'ml-auto')}>
            {i + 1 < passos.length ? 'Próximo' : 'Concluir'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- botão "?" ---
export function BotaoAjuda({ className }: { className?: string }) {
  const [aberto, setAberto] = useState(false);
  const loc = useLocation();
  const ajuda = ajudaDaRota(loc.pathname);
  return (
    <>
      <button type="button" onClick={() => setAberto(true)} aria-label={`Ajuda: ${ajuda.titulo}`} title="Ajuda"
        className={cx('grid size-12 place-items-center rounded-full hover:bg-white/15', className)}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 014.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" /></svg>
      </button>
      <Dialog open={aberto} onClose={() => setAberto(false)} title={`Ajuda · ${ajuda.titulo}`}>
        <div className="flex flex-col gap-4">
          <section>
            <h3 className="rotulo mb-1.5">Como usar esta tela</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[0.9375rem]">{ajuda.comoUsar.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
          {ajuda.passeio && (
            <button onClick={() => { setAberto(false); setTimeout(() => iniciarPasseio(ajuda.passeio!), 150); }}
              className="btn-degrade pressionar inline-flex min-h-12 items-center justify-center gap-2 rounded-botao font-bold">Ver o passeio desta tela</button>
          )}
          {ajuda.duvidas.length > 0 && (
            <section>
              <h3 className="rotulo mb-1.5">Dúvidas frequentes</h3>
              <div className="flex flex-col gap-1.5">
                {ajuda.duvidas.map((d) => (
                  <details key={d.p} className="rounded-campo bg-afundado px-3 py-2">
                    <summary className="min-h-9 cursor-pointer py-1 font-bold">{d.p}</summary>
                    <p className="pb-1 text-[0.9375rem] text-tinta-2">{d.r}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
          <Link to="/ajuda" onClick={() => setAberto(false)} className="inline-flex min-h-11 items-center gap-1 self-start font-bold text-anil-escuro">Todas as ajudas e tutoriais <IconChevronRight className="size-4" /></Link>
        </div>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------ primeiros passos ---
export function PrimeirosPassos({ passos }: { passos: Array<{ feito: boolean; texto: string; acao?: () => void; para?: string }> }) {
  const [oculto, setOculto] = useState(() => lerFlag(FLAG_PASSOS_OCULTOS));
  const feitos = passos.filter((p) => p.feito).length;
  if (oculto || feitos === passos.length) return null;
  return (
    <section className="cartao cartao-boas-vindas px-4 pb-3 pt-5" aria-labelledby="t-passos">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 basis-40 flex-1">
          <h2 id="t-passos" className="text-[1.0625rem] font-bold">Primeiros passos</h2>
          <p className="text-sm text-tinta-2">{feitos} de {passos.length} feitos. Cada item se marca sozinho quando você faz.</p>
        </div>
        <button onClick={() => { gravarFlag(FLAG_PASSOS_OCULTOS); setOculto(true); }} className="min-h-11 shrink-0 px-2 text-sm font-bold text-tinta-3">Ocultar</button>
      </div>
      <ol className="mt-2 flex flex-col">
        {passos.map((p) => {
          const conteudo = (<>
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full border-2', p.feito ? 'border-transparent bg-livre text-sobre-status' : 'border-linha-forte')}>{p.feito && <IconCheck className="size-4" />}</span>
            <span className={cx('flex-1', p.feito && 'text-tinta-3 line-through')}>{p.texto}</span>
            {!p.feito && <IconChevronRight className="size-4 text-tinta-3" />}
          </>);
          const cls = 'flex min-h-12 w-full items-center gap-3 text-left';
          return (
            <li key={p.texto} className="border-t border-linha/60 first:border-t-0">
              {p.feito ? <div className={cls}>{conteudo}</div>
                : p.para ? <Link to={p.para} className={cls}>{conteudo}</Link>
                  : <button onClick={p.acao} className={cls}>{conteudo}</button>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
