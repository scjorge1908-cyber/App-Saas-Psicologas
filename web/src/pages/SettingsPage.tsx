import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import { errorMessage } from '../lib/errors';
import { isValidCpf, normalizeCrp, onlyDigits, parseMoney, todayIn } from '../lib/format';
import type { BackupProgress } from '../lib/backup';
import { signOut, useAuth, useProfile } from '../auth/AuthProvider';
import { Button, ErrorBox, Field, Loading, Notice, PageHeader, Panel, Select, TextField, useConfirm, useToast } from '../components/ui';
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
      <AgendaForm profile={profile} />
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

function ProfileForm({ profile }: { profile: Profile }) {
  const save = useSaveProfile();
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({
      full_name: profile.full_name, crp: profile.crp ?? '', cpf: profile.cpf ?? '', cnpj: profile.cnpj ?? '', fiscal_type: profile.fiscal_type,
      contact_email: profile.contact_email ?? '', phone: profile.phone ?? '', address: profile.address ?? '', city: profile.city ?? '', uf: profile.uf ?? '',
    });
  }, [profile]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setError(null);
    const crp = normalizeCrp(f.crp);
    if (!crp) return setError('CRP inválido. Use o formato 06/123456.');
    if (f.cpf && !isValidCpf(f.cpf)) return setError('CPF inválido.');
    const cnpj = onlyDigits(f.cnpj);
    if (cnpj && cnpj.length !== 14) return setError('CNPJ deve ter 14 números.');
    const phone = onlyDigits(f.phone);
    if (phone && (phone.length < 10 || phone.length > 11)) return setError('Telefone inválido.');
    setBusy(true);
    await save(profile.id, {
      full_name: f.full_name.trim(), crp, cpf: onlyDigits(f.cpf) || null, cnpj: cnpj || null, fiscal_type: f.fiscal_type as Profile['fiscal_type'],
      contact_email: f.contact_email.trim() || null, phone: phone || null, address: f.address.trim() || null, city: f.city.trim() || null, uf: f.uf.trim().toUpperCase() || null,
    }, setError);
    setBusy(false);
  }

  return (
    <Panel recolhivel aberto title="Perfil profissional" actions={<Button size="sm" busy={busy} onClick={submit}>Salvar perfil</Button>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nome completo" value={f.full_name ?? ''} onChange={set('full_name')} />
          <TextField label="CRP" value={f.crp ?? ''} onChange={set('crp')} placeholder="06/123456" />
          <TextField label="CPF" inputMode="numeric" value={f.cpf ?? ''} onChange={set('cpf')} hint="Aparece nos recibos." />
          <Field label="Atuação fiscal">{(id) => (
            <Select id={id} value={f.fiscal_type} onChange={set('fiscal_type')}>
              <option value="pf">Pessoa física (autônoma, Receita Saúde)</option>
              <option value="pj">Pessoa jurídica (NFS-e)</option>
            </Select>
          )}</Field>
          {f.fiscal_type === 'pj' && <TextField label="CNPJ" inputMode="numeric" value={f.cnpj ?? ''} onChange={set('cnpj')} />}
          <TextField label="E-mail profissional" type="email" value={f.contact_email ?? ''} onChange={set('contact_email')} />
          <TextField label="Telefone" inputMode="tel" value={f.phone ?? ''} onChange={set('phone')} />
          <TextField label="Endereço do consultório" value={f.address ?? ''} onChange={set('address')} className="sm:col-span-2" />
          <TextField label="Cidade" value={f.city ?? ''} onChange={set('city')} />
          <TextField label="UF" maxLength={2} value={f.uf ?? ''} onChange={set('uf')} />
        </div>
      </div>
    </Panel>
  );
}

function AgendaForm({ profile }: { profile: Profile }) {
  const save = useSaveProfile();
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setF({
      session_minutes: String(profile.session_minutes), buffer_minutes: String(profile.buffer_minutes),
      default_price: profile.default_price != null ? String(profile.default_price).replace('.', ',') : '',
      cancellation_hours: String(profile.cancellation_hours), agenda_start: profile.agenda_start.slice(0, 5), agenda_end: profile.agenda_end.slice(0, 5),
      timezone: profile.timezone, retention_years: String(profile.retention_years),
    });
  }, [profile]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setError(null);
    const price = f.default_price ? parseMoney(f.default_price) : null;
    if (f.default_price && price === null) return setError('Valor padrão inválido.');
    if (f.agenda_end <= f.agenda_start) return setError('O fim do expediente deve ser depois do início.');
    setBusy(true);
    await save(profile.id, {
      session_minutes: Number(f.session_minutes), buffer_minutes: Number(f.buffer_minutes), default_price: price,
      cancellation_hours: Number(f.cancellation_hours), agenda_start: f.agenda_start, agenda_end: f.agenda_end,
      timezone: f.timezone, retention_years: Number(f.retention_years),
    }, setError);
    setBusy(false);
  }

  return (
    <Panel recolhivel title="Agenda e atendimento" actions={<Button size="sm" busy={busy} onClick={submit}>Salvar</Button>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Duração padrão (min)" type="number" min={10} max={300} value={f.session_minutes ?? ''} onChange={set('session_minutes')} />
          <TextField label="Intervalo entre sessões (min)" type="number" min={0} max={120} value={f.buffer_minutes ?? ''} onChange={set('buffer_minutes')} />
          <TextField label="Valor padrão (R$)" inputMode="decimal" value={f.default_price ?? ''} onChange={set('default_price')} />
          <TextField label="Início do expediente" type="time" value={f.agenda_start ?? ''} onChange={set('agenda_start')} />
          <TextField label="Fim do expediente" type="time" value={f.agenda_end ?? ''} onChange={set('agenda_end')} />
          <TextField label="Antecedência para cancelar (h)" type="number" min={0} max={168} value={f.cancellation_hours ?? ''} onChange={set('cancellation_hours')} hint="Cancelamentos pelo link com menos antecedência ficam sinalizados." />
          <Field label="Fuso horário">{(id) => (
            <Select id={id} value={f.timezone} onChange={set('timezone')}>
              {['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'Europe/Lisbon'].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
            </Select>
          )}</Field>
          <TextField label="Guarda do prontuário (anos)" type="number" min={5} max={30} value={f.retention_years ?? ''} onChange={set('retention_years')} hint="Mínimo de 5 anos (Res. CFP 001/2009)." />
        </div>
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

function SecurityPanel() {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change() {
    setError(null);
    if (pw.length < 10) return setError('Use pelo menos 10 caracteres.');
    if (pw !== pw2) return setError('As senhas não coincidem.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    setPw(''); setPw2(''); toast('Senha alterada');
  }
  return (
    <Panel recolhivel title="Segurança">
      <div className="flex flex-col gap-3">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nova senha" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <TextField label="Repita a nova senha" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" busy={busy} onClick={change}>Alterar senha</Button>
          <Button variant="ghost" onClick={() => signOut()}>Sair da conta</Button>
        </div>
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
