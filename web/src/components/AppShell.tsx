import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { cx } from './ui';
import { IconCalendar, IconClock, IconDoc, IconLogout, IconMoney, IconMore, IconPeople, IconReceipt, IconSettings, IconToday } from './icons';
import { signOut, useProfile } from '../auth/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useDemo } from '../lib/demo/modo';

type NavItem = { to: string; label: string; icon: (p: React.SVGProps<SVGSVGElement>) => React.ReactElement; end?: boolean };
const MAIN: NavItem[] = [
  { to: '/', label: 'Hoje', icon: IconToday, end: true },
  { to: '/agenda', label: 'Agenda', icon: IconCalendar },
  { to: '/pacientes', label: 'Pacientes', icon: IconPeople },
  { to: '/financeiro', label: 'Financeiro', icon: IconMoney },
];
const EXTRA: NavItem[] = [
  { to: '/prontuario', label: 'Prontuário', icon: IconDoc },
  { to: '/agenda/horarios', label: 'Horários', icon: IconClock },
  { to: '/notas-fiscais', label: 'Notas fiscais', icon: IconReceipt },
  { to: '/configuracoes', label: 'Configurações', icon: IconSettings },
];

export function AppShell() {
  const { profile } = useProfile();
  const loc = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Leva o foco ao conteúdo ao trocar de página (leitores de tela)
  useEffect(() => { mainRef.current?.focus(); window.scrollTo(0, 0); }, [loc.pathname]);

  const demo = useDemo();
  return (
    <div className="min-h-dvh lg:flex">
      {demo && <FaixaDemo />}
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-papel focus:px-3 focus:py-2">Pular para o conteúdo</a>

      {/* Lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-linha bg-papel lg:flex">
        <div className="cabecalho-marca m-3 rounded-cartao px-4 pb-4 pt-5">
          <Marca />
          {profile && <p className="mt-3 truncate text-sm font-bold opacity-95">{profile.full_name}</p>}
          {profile?.crp && <p className="truncate text-sm opacity-80">CRP {profile.crp}</p>}
        </div>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-0.5 px-3">
          {[...MAIN, ...EXTRA].map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => cx('flex min-h-12 items-center gap-3 rounded-full px-4 text-[15px] font-bold', isActive ? 'bg-anil-claro text-sobre-anil-claro' : 'text-tinta-2 hover:bg-cinza-fundo')}>
              <i.icon /> {i.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => signOut()} className="m-3 flex min-h-12 items-center gap-3 rounded-full px-4 text-left font-bold text-tinta-3 hover:bg-cinza-fundo"><IconLogout /> Sair</button>
      </aside>

      <div className="min-w-0 flex-1">
      {/* Cabeçalho com degradê (celular) — formato HopeCore */}
      <header className={cx('cabecalho-marca pt-safe sticky top-0 z-30 lg:hidden', demo && 'mt-11')}>
        <div className="flex min-h-16 items-center gap-2 pl-4 pr-2">
          <div className="flex-1"><Marca /></div>
          <NavLink to="/configuracoes" aria-label="Configurações" className="grid size-12 place-items-center rounded-full hover:bg-white/15"><IconSettings /></NavLink>
        </div>
      </header>
      <main id="conteudo" ref={mainRef} tabIndex={-1} className={cx('mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 lg:pb-12 lg:pt-8', demo && 'lg:mt-11')}>
        <Outlet />
      </main>
      </div>

      {/* Barra inferior (celular) */}
      <nav aria-label="Principal" className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-linha/70 bg-papel/95 px-1 pt-1 backdrop-blur lg:hidden">
        {[...MAIN, { to: '/mais', label: 'Mais', icon: IconMore } as NavItem].map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}
            className={({ isActive }) => cx('group flex min-h-14 flex-col items-center justify-center gap-1 text-[12px] font-bold', isActive ? 'text-tinta' : 'text-tinta-3')}>
            {({ isActive }) => (<>
              <span className={cx('grid h-8 w-14 place-items-center rounded-full transition-colors', isActive && 'bg-anil-claro text-sobre-anil-claro')}><i.icon /></span>
              {i.label}
            </>)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function MorePage() {
  const { profile } = useProfile();
  return (
    <div className="flex flex-col gap-1">
      <h1 className="titulo-display mb-1 text-[30px]">Mais</h1>
      {profile && <p className="mb-4 text-tinta-2">{profile.full_name}{profile.crp ? `, CRP ${profile.crp}` : ''}</p>}
      {EXTRA.map((i) => (
        <NavLink key={i.to} to={i.to} className="cartao pressionar flex min-h-14 items-center gap-3 px-4 py-3 font-bold">
          <span className="atalho-icone grid size-10 place-items-center bg-anil-claro text-sobre-anil-claro"><i.icon /></span> {i.label}
        </NavLink>
      ))}
      <button onClick={() => signOut()} className="cartao mt-4 flex min-h-14 items-center gap-3 px-4 py-3 text-left font-bold text-vermelho"><IconLogout /> Sair da conta</button>
    </div>
  );
}

/** Aviso fixo durante a demonstração, com o caminho para criar a conta de verdade. */
function FaixaDemo() {
  const nav = useNavigate();
  async function criarConta() {
    await signOut(); // sai da demonstração e descarta os dados fictícios
    nav('/cadastro');
  }
  return (
    <div className="pt-safe fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-ocre-fundo px-4 py-2 text-[14px] text-ocre lg:left-64">
      <span><b>Demonstração</b> · dados fictícios, nada é salvo</span>
      <button type="button" onClick={criarConta} className="shrink-0 rounded-full bg-ocre px-3.5 py-1.5 font-bold text-ocre-fundo">Criar minha conta</button>
    </div>
  );
}

/** Marca: símbolo + nome em fonte de título, sobre o degradê. */
export function Marca() {
  return (
    <span className="titulo-display flex items-center gap-2 text-[22px] leading-none">
      <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-white/16">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 3v18M6 6c0 5 2.5 8 6 8s6-3 6-8" /></svg>
      </span>
      PsiConsultório
    </span>
  );
}
