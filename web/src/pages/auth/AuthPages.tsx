import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { publicOrigin, supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { normalizeCrp, onlyDigits } from '../../lib/format';
import { Button, ErrorBox, Notice, TextField } from '../../components/ui';
import { useAuth, useProfile } from '../../auth/AuthProvider';
import { entrarComGoogle } from '../../lib/google';
import { LogoGoogle } from '../WelcomePage';

function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-xl font-bold text-anil">PsiConsultório</p>
        <h1 className="mb-6 text-[1.75rem] font-bold leading-tight">{title}</h1>
        {children}
        {footer && <div className="mt-6 flex flex-col gap-2 text-[0.9375rem]">{footer}</div>}
      </div>
    </div>
  );
}

const linkCls = 'font-bold text-anil underline-offset-4 hover:underline';

/** Entrar/criar conta com Google em um toque (mesma conta serve para entrar depois). */
function BotaoGoogle({ rotulo }: { rotulo: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  async function ir() {
    setErro(null); setIndo(true);
    try { await entrarComGoogle(); } catch (e) { setErro(errorMessage(e)); } finally { setIndo(false); }
  }
  return (
    <div className="mb-6 flex flex-col gap-3">
      {erro && <ErrorBox>{erro}</ErrorBox>}
      <button type="button" onClick={ir} disabled={indo}
        className="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-linha-forte bg-papel px-4 font-bold transition active:scale-[.98] disabled:opacity-60">
        <LogoGoogle /> {indo ? 'Abrindo o Google…' : rotulo}
      </button>
      <div className="flex items-center gap-3 text-sm text-tinta-3"><span className="h-px flex-1 bg-linha" />ou com e-mail<span className="h-px flex-1 bg-linha" /></div>
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    nav('/', { replace: true });
  }

  return (
    <AuthLayout title="Entrar" footer={<>
      <Link to="/esqueci-senha" className={linkCls}>Esqueci minha senha</Link>
      <span>Ainda não tem conta? <Link to="/cadastro" className={linkCls}>Criar conta</Link></span>
    </>}>
      <BotaoGoogle rotulo="Entrar com Google" />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" busy={busy}>Entrar</Button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', password2: '' });
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const nav = useNavigate();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.name.trim().length < 3) return setError('Informe seu nome completo.');
    if (form.password.length < 10) return setError('Use uma senha com pelo menos 10 caracteres.');
    if (form.password !== form.password2) return setError('As senhas não coincidem.');
    if (!accepted) return setError('Para continuar, aceite os termos de uso e a política de privacidade.');
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { full_name: form.name.trim() }, emailRedirectTo: `${publicOrigin()}/` },
    });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    if (data.session) nav('/', { replace: true });
    else setSent(true); // confirmação de e-mail ativa no servidor
  }

  if (sent) {
    return (
      <AuthLayout title="Confirme seu e-mail" footer={<Link to="/entrar" className={linkCls}>Voltar para entrar</Link>}>
        <p className="text-tinta-2">Enviamos um link para <strong>{form.email}</strong>. Abra o link para ativar a conta e depois entre com sua senha.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar conta" footer={<span>Já tem conta? <Link to="/entrar" className={linkCls}>Entrar</Link></span>}>
      <BotaoGoogle rotulo="Criar conta com Google" />
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="Nome completo" autoComplete="name" required value={form.name} onChange={set('name')} />
        <TextField label="E-mail" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <TextField label="Senha" type="password" autoComplete="new-password" required hint="Mínimo de 10 caracteres." value={form.password} onChange={set('password')} />
        <TextField label="Repita a senha" type="password" autoComplete="new-password" required value={form.password2} onChange={set('password2')} />
        <label className="flex items-start gap-3 text-[0.9375rem]">
          <input type="checkbox" className="mt-1 h-5 w-5 accent-anil" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>Li e aceito os <Link to="/termos" className={linkCls} target="_blank">termos de uso e a política de privacidade</Link>.</span>
        </label>
        <Button type="submit" busy={busy}>Criar conta</Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${publicOrigin()}/redefinir-senha` });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setSent(true);
  }

  return (
    <AuthLayout title="Recuperar acesso" footer={<Link to="/entrar" className={linkCls}>Voltar para entrar</Link>}>
      {sent ? (
        <Notice>Se houver uma conta com <strong>{email}</strong>, você receberá um link para criar uma nova senha. Confira também a caixa de spam.</Notice>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <ErrorBox>{error}</ErrorBox>}
          <p className="text-tinta-2">Informe o e-mail da conta. Enviaremos um link para criar uma nova senha.</p>
          <TextField label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" busy={busy}>Enviar link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { session, loading, clearRecovering } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 10) return setError('Use uma senha com pelo menos 10 caracteres.');
    if (pw !== pw2) return setError('As senhas não coincidem.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    clearRecovering();
    nav('/', { replace: true });
  }

  if (loading) return null;
  if (!session) {
    return (
      <AuthLayout title="Link inválido ou expirado" footer={<Link to="/esqueci-senha" className={linkCls}>Pedir um novo link</Link>}>
        <p className="text-tinta-2">Este link de recuperação não é mais válido. Peça um novo link para redefinir a senha.</p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Criar nova senha">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="Nova senha" type="password" autoComplete="new-password" required hint="Mínimo de 10 caracteres." value={pw} onChange={(e) => setPw(e.target.value)} />
        <TextField label="Repita a nova senha" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <Button type="submit" busy={busy}>Salvar nova senha</Button>
      </form>
    </AuthLayout>
  );
}

/** Primeiro acesso: nome e CRP são obrigatórios (aparecem em documentos e links). */
export function OnboardingPage() {
  const { profile } = useProfile();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [crp, setCrp] = useState(profile?.crp ?? '');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [uf, setUf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const crpN = normalizeCrp(crp);
    if (name.trim().length < 3) return setError('Informe seu nome completo.');
    if (crp.trim() && !crpN) return setError('CRP no formato região/número, por exemplo 06/123456. Pode deixar em branco e preencher depois.');
    const ph = onlyDigits(phone);
    if (ph && (ph.length < 10 || ph.length > 11)) return setError('Telefone inválido. Informe DDD + número.');
    setBusy(true);
    const { error } = await supabase.from('profiles').update({
      full_name: name.trim(), crp: crpN || null, phone: ph || null, city: city.trim() || null,
      uf: uf.trim().toUpperCase() || null, onboarded_at: new Date().toISOString(),
    }).eq('id', profile!.id);
    setBusy(false);
    if (error) return setError(errorMessage(error));
    await qc.invalidateQueries({ queryKey: ['profile'] });
  }

  return (
    <AuthLayout title="Seu perfil profissional">
      <p className="mb-5 text-tinta-2">Só o nome é obrigatório agora. O CRP aparece nos documentos e na página de confirmação do paciente; se preferir, preencha depois em Configurações.</p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="Nome completo" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="CRP (opcional agora)" placeholder="06/123456" value={crp} onChange={(e) => setCrp(e.target.value)} />
        <TextField label="Telefone profissional" inputMode="tel" placeholder="(48) 99999-9999" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <TextField label="Cidade" value={city} onChange={(e) => setCity(e.target.value)} />
          <TextField label="UF" maxLength={2} value={uf} onChange={(e) => setUf(e.target.value)} />
        </div>
        <Button type="submit" busy={busy}>Começar a usar</Button>
      </form>
    </AuthLayout>
  );
}
