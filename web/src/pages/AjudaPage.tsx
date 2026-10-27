// Mais → Ajuda e tutoriais: todos os guias em texto (alternativa acessível ao passeio), com busca,
// e o atalho para refazer o passeio da agenda.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AJUDA, TODAS_DUVIDAS } from '../lib/ajuda';
import { iniciarPasseio } from '../components/ajuda/Ajuda';
import { Input } from '../components/ui';
import { IconSearch } from '../components/icons';

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function AjudaPage() {
  const nav = useNavigate();
  const [busca, setBusca] = useState('');
  const achadas = useMemo(() => {
    const t = norm(busca.trim());
    return t ? TODAS_DUVIDAS.filter((d) => norm(`${d.p} ${d.r} ${d.tela}`).includes(t)) : [];
  }, [busca]);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <header>
        <h1 className="titulo-display text-[1.75rem] leading-tight">Ajuda e tutoriais</h1>
        <p className="text-tinta-2">Guias curtos de cada tela. O botão “?” no topo mostra a ajuda da tela em que você está.</p>
      </header>

      <button onClick={() => { nav('/'); setTimeout(() => iniciarPasseio('agenda'), 600); }}
        className="btn-degrade pressionar inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-botao px-5 font-bold">Fazer o passeio da agenda (1 min)</button>

      <label className="relative block">
        <span className="sr-only">Buscar na ajuda</span>
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tinta-3" />
        <Input className="pl-11" placeholder="Buscar: agendar, evolução, pagamento…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </label>

      {busca.trim() ? (
        <section aria-live="polite">
          <p className="rotulo mb-2">{achadas.length} {achadas.length === 1 ? 'resultado' : 'resultados'}</p>
          <ul className="flex flex-col gap-2">
            {achadas.map((d) => (
              <li key={d.p} className="cartao p-3"><p className="font-bold">{d.p}</p><p className="text-[0.9375rem] text-tinta-2">{d.r}</p><p className="mt-1 text-sm text-tinta-3">{d.tela}</p></li>
            ))}
          </ul>
        </section>
      ) : (
        AJUDA.map(({ ajuda }) => (
          <section key={ajuda.titulo} className="cartao p-4">
            <h2 className="text-[1.0625rem] font-bold">{ajuda.titulo}</h2>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[0.9375rem]">{ajuda.comoUsar.map((t) => <li key={t}>{t}</li>)}</ul>
            {ajuda.duvidas.length > 0 && (
              <div className="mt-2 flex flex-col gap-1.5">
                {ajuda.duvidas.map((d) => (
                  <details key={d.p} className="rounded-campo bg-afundado px-3 py-2">
                    <summary className="min-h-9 cursor-pointer py-1 font-bold">{d.p}</summary>
                    <p className="pb-1 text-[0.9375rem] text-tinta-2">{d.r}</p>
                  </details>
                ))}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
