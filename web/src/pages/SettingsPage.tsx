import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { publicOrigin, supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { errorMessage } from '../lib/errors';
import { formatCnpj, formatCpf, formatPhone, normalizeCrp, onlyDigits, todayIn } from '../lib/format';
import { faltandoPerfil } from '../lib/perfil';
import { formatarCep } from '../lib/cep';
import { ENDERECO_VAZIO, EnderecoCampos, type Endereco } from '../components/patients/EnderecoCampos';
import type { BackupProgress } from '../lib/backup';
import { signOut, useAuth, useProfile } from '../auth/AuthProvider';
import { Button, ErrorBox, Field, Loading, Notice, PageHeader, Panel, Select, Spinner, TextField, useConfirm, useToast } from '../components/ui';
import { useCnpjAutomatico } from '../components/useCnpjAutomatico';
import { mascararCnpj } from '../lib/mascaras';
import { saveBlob } from '../components/patients/DocumentsTab';
import { isDemo } from '../lib/demo/modo';
import { atualizarPerfilDemo } from '../lib/demo/api-demo';
import { TEMAS, definirAparencia, useAparencia, type Modo } from '../lib/tema';

export function SettingsPage() {
  const { profile, isLoading } = useProfile();
  if (isLoading || !profile) return <Loading />;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Configurações" />
      <AparenciaPanel />
      <ProfileForm profile={profile} />
      <BackupPanel />
      <SecurityPanel />
      <Panel recolhivel title="Sobre e privacidade">
        <ul className="flex flex-col gap-2">
          <li><Link to="/termos" className="font-bold text-anil">Termos de uso e política de privacidade</Link></li>
          <li className="text-tinta-2">Você é a controladora dos dados dos seus pacientes (LGPD). A plataforma atua como operadora e guarda os dados em servidor com acesso restrito à sua conta.</li>
        </ul>
      </Panel>
    </div>
  );
}

function useSaveProfile() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (id: string, patch: Partial<Profile>, setError: (e: string | null) => void) => {
    if (isDemo()) {
      atualizarPerfilDemo(patch); // demonstração: muda só no aparelho
    } else {
      const { error } = await supabase.from('profiles').update(patch).eq('id', id);
      if (error) { setError(errorMessage(error)); return false; }
    }
    await qc.invalidateQueries({ queryKey: ['profile'] });
    toast('Configurações salvas');
    return true;
  };
}

/**
 * Perfil profissional (28/10): todos os campos são obrigatórios (só o complemento é opcional) e, sem ele completo,
 * o resto do app não abre. Endereço pelo CEP (rua, bairro, cidade e UF vêm sozinhos), com número e complemento.
 * O botão Salvar fica no fim do cartão; dá para voltar e alterar quando quiser.
 */
function ProfileForm({ profile }: { profile: Profile }) {
  const save = useSaveProfile();
  const [f, setF] = useState<Record<string, string>>({});
  const [end, setEnd] = useState<Endereco>(ENDERECO_VAZIO);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({
      full_name: profile.full_name, crp: profile.crp ?? '', cpf: formatCpf(profile.cpf), cnpj: formatCnpj(profile.cnpj), company_name: profile.company_name ?? '', fiscal_type: profile.fiscal_type,
      contact_email: profile.contact_email ?? '', phone: formatPhone(profile.phone),
    });
    setEnd({ cep: formatarCep(profile.cep ?? ''), street: profile.address ?? '', address_number: profile.address_number ?? '', address_complement: profile.address_complement ?? '',
      neighborhood: profile.neighborhood ?? '', city: profile.city ?? '', uf: profile.uf ?? '' });
  }, [profile]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  // CNPJ → razão social automática (28/10)
  const cnpjAuto = useCnpjAutomatico(f.cnpj ?? '', f.company_name ?? '', (company_name) => setF((x) => ({ ...x, company_name })));
  const dados = { ...f, fiscal_type: f.fiscal_type as Profile['fiscal_type'], cep: end.cep, address: end.street, address_number: end.address_number,
    neighborhood: end.neighborhood, city: end.city, uf: end.uf };
  const falta = faltandoPerfil(dados);
  const salvoCompleto = faltandoPerfil(profile).length === 0;
  const cartao = useRef<HTMLDetailsElement>(null);

  async function submit() {
    setError(null);
    if (falta.length) return setError(`Para salvar, falta: ${falta.join(', ')}.`);
    setBusy(true);
    const ok = await save(profile.id, {
      full_name: f.full_name.trim(), crp: normalizeCrp(f.crp), cpf: onlyDigits(f.cpf), cnpj: f.fiscal_type === 'pj' ? onlyDigits(f.cnpj) : null, company_name: f.fiscal_type === 'pj' ? f.company_name.trim() : null,
      fiscal_type: f.fiscal_type as Profile['fiscal_type'], contact_email: f.contact_email.trim(), phone: onlyDigits(f.phone),
      cep: onlyDigits(end.cep), address: end.street.trim(), address_number: end.address_number.trim(), address_complement: end.address_complement.trim() || null,
      neighborhood: end.neighborhood.trim(), city: end.city.trim(), uf: end.uf.trim().toUpperCase(),
    }, setError);
    setBusy(false);
    // Salvou (28/10): o cartão fecha e fica verde, mostrando que o perfil está ok
    if (ok && cartao.current) cartao.current.open = false;
  }

  return (
    <Panel recolhivel aberto={!salvoCompleto} ok={salvoCompleto} okTexto="Completo" detalhesRef={cartao} title="Perfil profissional">
      <div className="flex flex-col gap-4">
        {!salvoCompleto && <Notice tone="ocre"><b>Complete o seu perfil profissional para liberar o app.</b> Todos os campos são obrigatórios (só o complemento é opcional).</Notice>}
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome completo" required value={f.full_name ?? ''} onChange={set('full_name')} />
          <TextField label="CRP" required value={f.crp ?? ''} onChange={set('crp')} placeholder="06/123456" />
          <TextField label="CPF" required inputMode="numeric" value={f.cpf ?? ''} onChange={set('cpf')} hint="Aparece nos recibos." />
          <Field label="Atuação fiscal" required>{(id) => (
            <Select id={id} value={f.fiscal_type} onChange={set('fiscal_type')}>
              <option value="pf">Pessoa física (autônoma, Receita Saúde)</option>
              <option value="pj">Pessoa jurídica (NFS-e)</option>
            </Select>
          )}</Field>
          {f.fiscal_type === 'pj' && <>
            <TextField label="CNPJ" required inputMode="numeric" value={f.cnpj ?? ''}
              hint={cnpjAuto.buscando ? <span className="inline-flex items-center gap-1.5"><Spinner small /> Buscando o nome da empresa…</span> : cnpjAuto.aviso ?? 'Digite o CNPJ: a razão social vem sozinha.'}
              onChange={(e) => { const cnpj = mascararCnpj(e.target.value); setF({ ...f, cnpj }); void cnpjAuto.aoMudarCnpj(cnpj); }} />
            <TextField label="Razão social" required value={f.company_name ?? ''} onChange={set('company_name')} />
          </>}
          <TextField label="E-mail profissional" required type="email" value={f.contact_email ?? ''} onChange={set('contact_email')} />
          <TextField label="Telefone" required inputMode="tel" placeholder="(48) 99999-9999" value={f.phone ?? ''} onChange={set('phone')} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-tinta-2">Endereço do consultório</legend>
          <p className="text-[0.8125rem] text-tinta-3">Digite o CEP: rua, bairro, cidade e UF vêm preenchidos. Depois coloque o número e, se tiver, o complemento.</p>
          <EnderecoCampos valor={end} onChange={setEnd} obrigatorio />
        </fieldset>
        {falta.length > 0 && <p className="text-[0.8125rem] text-tinta-3">Falta: {falta.join(', ')}.</p>}
        <Button busy={busy} onClick={submit} className="w-full">Salvar perfil</Button>
      </div>
    </Panel>
  );
}

function BackupPanel() {
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function doExport() {
    setError(null);
    try {
      const { buildBackupZip } = await import('../lib/backup');
      const zip = await buildBackupZip(setProgress);
      saveBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `backup-psiconsultorio-${todayIn()}.zip`);
      toast('Backup gerado');
    } catch (e) { setError(errorMessage(e, 'Não foi possível gerar o backup.')); } finally { setProgress(null); }
  }

  async function doImport(file?: File) {
    if (!file) return;
    if (!(await confirm({ title: 'Restaurar backup?', body: 'A restauração só funciona em uma conta sem pacientes e sem despesas. Os dados do arquivo serão importados para esta conta.', confirmLabel: 'Restaurar' }))) return;
    setError(null);
    try {
      const { restoreBackup } = await import('../lib/backup');
      const counts = await restoreBackup(file, session!.user.id, setProgress);
      await qc.invalidateQueries();
      toast(`Backup restaurado: ${counts.patients ?? 0} pacientes, ${counts.appointments ?? 0} sessões, ${counts.record_entries ?? 0} registros`);
    } catch (e) { setError(errorMessage(e, e instanceof Error ? e.message : 'Não foi possível restaurar o backup.')); } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Panel recolhivel title="Seus dados">
      <div className="flex flex-col gap-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <p className="text-tinta-2">Baixe um arquivo com todos os dados da conta e os anexos. Use para guardar uma cópia de segurança, levar seus dados para outro sistema ou atender a pedidos de acesso.</p>
        <Notice tone="ocre">O backup contém dados sensíveis de saúde. Guarde em local protegido e não envie por e-mail ou mensagem.</Notice>
        <div className="flex flex-wrap gap-2">
          <Button busy={!!progress} onClick={doExport}>Baixar backup completo</Button>
          <input ref={input} type="file" accept=".zip,.json" className="hidden" onChange={(e) => doImport(e.target.files?.[0])} />
          <Button variant="secondary" disabled={!!progress} onClick={() => input.current?.click()}>Restaurar backup</Button>
        </div>
        {progress && <p role="status" className="text-sm text-tinta-2">{progress.step}{progress.total > 1 ? ` (${progress.done} de ${progress.total})` : ''}…</p>}
        <p className="text-sm text-tinta-3">Exclusão da conta: prontuários e documentos têm guarda mínima de {5} anos e não são apagados antes disso. Solicite pelo canal de suporte.</p>
      </div>
    </Panel>
  );
}

/**
 * Segurança (28/10): para trocar a senha é preciso a senha atual (ter o app aberto não basta).
 * Quem não lembra toca em "Esqueci a senha" e recebe no e-mail o link para criar outra.
 */
function SecurityPanel() {
  const toast = useToast();
  const { session } = useAuth();
  const email = session?.user.email ?? '';
  const [atual, setAtual] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change() {
    setError(null);
    if (!atual) return setError('Digite a sua senha atual.');
    if (pw.length < 10) return setError('A nova senha precisa ter pelo menos 10 caracteres.');
    if (pw !== pw2) return setError('As senhas novas não coincidem.');
    if (pw === atual) return setError('A nova senha precisa ser diferente da atual.');
    if (isDemo()) return setError('Na demonstração a senha não muda.');
    setBusy(true);
    // Confere a senha atual antes de trocar
    const conf = await supabase.auth.signInWithPassword({ email, password: atual });
    if (conf.error) { setBusy(false); return setError('Senha atual incorreta. Se não lembra, toque em "Esqueci a senha".'); }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setAtual(''); setPw(''); setPw2(''); toast('Senha alterada');
  }
  async function esqueci() {
    setError(null);
    if (isDemo()) return setError('Na demonstração não há envio de e-mail.');
    setEnviando(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${publicOrigin()}/redefinir-senha` });
    setEnviando(false);
    if (error) return setError(errorMessage(error));
    setEnviado(true);
  }
  return (
    <Panel recolhivel title="Segurança">
      <div className="flex flex-col gap-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        {enviado && <Notice>Enviamos para <b>{email}</b> um link para criar uma nova senha. Confira também a caixa de spam.</Notice>}
        <TextField label="Senha atual" required type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nova senha" required type="password" autoComplete="new-password" hint="Pelo menos 10 caracteres." value={pw} onChange={(e) => setPw(e.target.value)} />
          <TextField label="Repita a nova senha" required type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <Button busy={busy} onClick={change} className="w-full">Alterar senha</Button>
        <Button variant="ghost" busy={enviando} onClick={esqueci} className="w-full">Esqueci a senha</Button>
        <Button variant="secondary" onClick={() => signOut()} className="w-full">Sair da conta</Button>
      </div>
    </Panel>
  );
}

/** Tema e modo claro/escuro — vale só para este aparelho. */
function AparenciaPanel() {
  const { tema, modo } = useAparencia();
  const MODOS: Array<[Modo, string]> = [['sistema', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']];
  return (
    <Panel recolhivel title="Aparência">
      <fieldset>
        <legend className="rotulo mb-2">Tema</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMAS.map((t) => (
            <label key={t.id} className={`pressionar flex min-h-16 min-w-0 cursor-pointer flex-wrap items-center gap-3 rounded-campo border-[1.5px] px-3 py-2 ${tema === t.id ? 'border-anil bg-anil-claro/50' : 'border-linha'}`}>
              <input type="radio" name="tema" value={t.id} checked={tema === t.id} onChange={() => definirAparencia({ tema: t.id })} className="sr-only" />
              <span aria-hidden className="flex -space-x-1.5">
                {t.cores.map((c) => <span key={c} className="size-6 rounded-full ring-2 ring-papel" style={{ background: c }} />)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{t.nome}</span>
                <span className="block text-sm text-tinta-2">{t.descricao}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="rotulo mb-2">Modo</legend>
        <div className="inline-flex gap-1 rounded-campo bg-afundado p-1">
          {MODOS.map(([v, r]) => (
            <label key={v} className={`flex min-h-11 cursor-pointer items-center rounded-[calc(var(--r-field)-4px)] px-4 text-sm font-bold ${modo === v ? 'bg-papel text-anil-escuro shadow-cartao' : 'text-tinta-2'}`}>
              <input type="radio" name="modo" value={v} checked={modo === v} onChange={() => definirAparencia({ modo: v })} className="sr-only" />
              {r}
            </label>
          ))}
        </div>
      </fieldset>
    </Panel>
  );
}
