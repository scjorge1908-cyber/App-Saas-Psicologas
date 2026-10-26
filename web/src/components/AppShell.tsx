import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { cx } from './ui';
import { IconCalendar, IconDoc, IconMoney, IconMore, IconPeople, IconReceipt, IconSettings, IconToday } from './icons';
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
  { to: '/agenda/horarios', label: 'Horários', icon: IconToday },
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
      <aside className="hidden w-64 shrink-0 flex-col border-r border-linha bg-papel lg:flex">
        <div className="px-5 pb-4 pt-6">
          <p className="text-lg font-bold text-anil">PsiConsultório</p>
          {profile && <p className="mt-1 truncate text-sm text-tinta-2">{profile.full_name}</p>}
          {profile?.crp && <p className="truncate text-sm text-tinta-3">CRP {profile.crp}</p>}
        </div>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-0.5 px-3">
          {[...MAIN, ...EXTRA].map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2.5 font-bold', isActive ? 'bg-anil-claro text-anil-escuro' : 'text-tinta-2 hover:bg-cinza-fundo')}>
              <i.icon /> {i.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => signOut()} className="m-3 rounded-lg px-3 py-2.5 text-left font-bold text-tinta-3 hover:bg-cinza-fundo">Sair</button>
      </aside>

      <main id="conteudo" ref={mainRef} tabIndex={-1} className={cx('mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 outline-none sm:px-6 lg:pb-12 lg:pt-8', demo && 'mt-11')}>
        <Outlet />
      </main>

      {/* Barra inferior (celular) */}
      <nav aria-label="Principal" className="pb-safe fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-linha bg-papel lg:hidden">
        {[...MAIN, { to: '/mais', label: 'Mais', icon: IconMore } as NavItem].map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end}
            className={({ isActive }) => cx('flex flex-col items-center gap-0.5 pt-2 text-[12px] font-bold', isActive ? 'text-anil' : 'text-tinta-3')}>
            <i.icon /> {i.label}
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
      <h1 className="mb-1 text-[26px] font-bold">Mais</h1>
      {profile && <p className="mb-4 text-tinta-2">{profile.full_name}{profile.crp ? `, CRP ${profile.crp}` : ''}</p>}
      {EXTRA.map((i) => (
        <NavLink key={i.to} to={i.to} className="flex items-center gap-3 rounded-lg border border-linha bg-papel px-4 py-3.5 font-bold">
          <i.icon /> {i.label}
        </NavLink>
      ))}
      <button onClick={() => signOut()} className="mt-4 rounded-lg border border-linha bg-papel px-4 py-3.5 text-left font-bold text-vermelho">Sair da conta</button>
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
      <button type="button" onClick={criarConta} className="shrink-0 rounded-lg bg-ocre px-3 py-1.5 font-bold text-white">Criar minha conta</button>
    </div>
  );
}
