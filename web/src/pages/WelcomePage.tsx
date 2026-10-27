// Primeira tela do app: a pessoa conhece o app antes de qualquer cadastro.
// "Conhecer o app" abre a demonstração (dados fictícios, no aparelho). Entrar/criar conta só quando ela quiser.
import { Versao } from '../components/Versao';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { entrarNaDemo } from '../lib/demo/modo';
import { entrarComGoogle } from '../lib/google';
import { errorMessage } from '../lib/errors';
import { ErrorBox } from '../components/ui';
import { IconCalendar, IconDoc, IconMoney, IconWhats } from '../components/icons';

const RECURSOS = [
  { Icone: IconCalendar, titulo: 'Agenda que se organiza', texto: 'Sessões recorrentes, horários livres e conflitos evitados.' },
  { Icone: IconWhats, titulo: 'Paciente confirma pelo link', texto: 'Mensagem pronta no WhatsApp; a agenda atualiza sozinha.' },
  { Icone: IconDoc, titulo: 'Prontuário e documentos CFP', texto: 'Evoluções com histórico e declarações em PDF.' },
  { Icone: IconMoney, titulo: 'Financeiro sem planilha', texto: 'Quem pagou, quem deve e recibos do Receita Saúde.' },
];

export function WelcomePage() {
  const nav = useNavigate();
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);

  // erro vindo do retorno do Google no app nativo
  useEffect(() => {
    const ouvir = (e: Event) => setErro((e as CustomEvent<string>).detail);
    window.addEventListener('psi:erro-login', ouvir);
    return () => window.removeEventListener('psi:erro-login', ouvir);
  }, []);

  function conhecer() {
    entrarNaDemo();
    nav('/', { replace: true });
  }

  async function google() {
    setErro(null);
    setIndo(true);
    try {
      await entrarComGoogle();
    } catch (e) {
      setErro(errorMessage(e));
    } finally {
      setIndo(false);
    }
  }

  return (
    <div className="boas-vindas-app flex min-h-dvh flex-col">
      <header className="cabecalho-marca px-6 pb-10 pt-[calc(2.5rem+var(--sat,0px))]">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo-branca.png`} alt="" width={52} height={52} className="size-[52px] object-contain" />
          <div>
            <p className="text-[26px] font-extrabold leading-none tracking-[.04em]">PSI</p>
            <p className="mt-0.5 text-[13px] font-bold leading-none tracking-[.2em]">CONSULTÓRIO</p>
            <p className="mt-1 text-[12px] font-semibold uppercase tracking-[.14em] opacity-85">Psicologia e bem-estar</p>
          </div>
        </div>
        <h1 className="titulo-display mt-6 max-w-md text-[30px] leading-tight">Seu consultório inteiro no celular.</h1>
        <p className="mt-3 max-w-md text-[17px] opacity-90">Agenda, prontuário, documentos e financeiro — feito para psicólogas.</p>
      </header>

      <main className="-mt-6 flex flex-1 flex-col gap-5 rounded-t-[28px] bg-gesso px-5 pb-[calc(1.5rem+var(--sab,0px))] pt-6">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {RECURSOS.map(({ Icone, titulo, texto }) => (
            <li key={titulo} className="flex items-start gap-3 cartao p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-anil-claro text-anil"><Icone /></span>
              <span>
                <strong className="block text-[16px]">{titulo}</strong>
                <span className="text-[15px] text-tinta-2">{texto}</span>
              </span>
            </li>
          ))}
        </ul>

        {erro && <ErrorBox>{erro}</ErrorBox>}

        <div className="mt-auto flex flex-col gap-3">
          <button type="button" onClick={conhecer}
            className="min-h-13 btn-degrade pressionar rounded-botao px-5 text-[17px] font-bold shadow-elevado">
            Conhecer o app
          </button>
          <p className="-mt-1 text-center text-sm text-tinta-3">Sem cadastro, com dados fictícios. Nada sai do seu celular.</p>
          <button type="button" onClick={google} disabled={indo}
            className="flex min-h-13 items-center justify-center gap-3 rounded-2xl border border-linha-forte bg-papel px-5 text-[16px] font-bold text-tinta transition active:scale-[.98] disabled:opacity-60">
            <LogoGoogle /> {indo ? 'Abrindo o Google…' : 'Entrar com Google'}
          </button>
          <div className="flex items-center justify-center gap-5 text-[15px]">
            <Link to="/entrar" className="font-bold text-anil">Entrar com e-mail</Link>
            <span className="text-linha-forte" aria-hidden>•</span>
            <Link to="/cadastro" className="font-bold text-anil">Criar conta</Link>
          </div>
        </div>
        <Versao className="mt-8 pb-safe" />
      </main>
    </div>
  );
}

/** Marca oficial "G" do Google (uso permitido em botões de login, conforme as diretrizes da marca). */
export function LogoGoogle() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
