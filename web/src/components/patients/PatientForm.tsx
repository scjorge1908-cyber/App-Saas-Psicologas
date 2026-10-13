import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Patient } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { isMinor, isValidCpf, onlyDigits, parseMoney, todayIn } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, ErrorBox, Field, Input, Notice, Select, TextField, Textarea } from '../ui';

type Form = Record<string, string>;

// Definido fora do componente para não remontar os campos a cada digitação.
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-linha pt-4 first:border-t-0 first:pt-0">
      <legend className="mb-1 text-lg font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

function toForm(p?: Patient | null): Form {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    full_name: s(p?.full_name), social_name: s(p?.social_name), birth_date: s(p?.birth_date), cpf: s(p?.cpf),
    phone: s(p?.phone), email: s(p?.email), address: s(p?.address),
    emergency_contact_name: s(p?.emergency_contact_name), emergency_contact_phone: s(p?.emergency_contact_phone),
    guardian_name: s(p?.guardian_name), guardian_cpf: s(p?.guardian_cpf), guardian_relationship: s(p?.guardian_relationship),
    guardian_phone: s(p?.guardian_phone), guardian_authorization_date: s(p?.guardian_authorization_date),
    payer_name: s(p?.payer_name), payer_cpf: s(p?.payer_cpf),
    billing_mode: p?.billing_mode ?? 'por_sessao', session_price: p?.session_price != null ? String(p.session_price).replace('.', ',') : '',
    session_minutes: s(p?.session_minutes), modality: p?.modality ?? 'presencial', meeting_url: s(p?.meeting_url),
    status: p?.status ?? 'ativo', admin_notes: s(p?.admin_notes),
  };
}

export function PatientForm({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: Patient | null; onSaved?: (p: Patient) => void }) {
  const { tz } = useProfile();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(toForm(patient));
  const [otherPayer, setOtherPayer] = useState(!!patient?.payer_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setF(toForm(patient)); setOtherPayer(!!patient?.payer_name); setError(null); } }, [open, patient]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const minor = isMinor(f.birth_date || null, todayIn(tz));

  async function submit() {
    setError(null);
    if (f.full_name.trim().length < 2) return setError('Informe o nome do paciente.');
    for (const [k, label] of [['cpf', 'CPF do paciente'], ['guardian_cpf', 'CPF do responsável'], ['payer_cpf', 'CPF do pagador']] as const) {
      if (f[k] && !isValidCpf(f[k])) return setError(`${label} inválido.`);
    }
    for (const [k, label] of [['phone', 'Telefone'], ['emergency_contact_phone', 'Telefone de emergência'], ['guardian_phone', 'Telefone do responsável']] as const) {
      const d = onlyDigits(f[k]);
      if (d && (d.length < 10 || d.length > 11)) return setError(`${label} inválido: informe DDD + número.`);
    }
    const price = f.session_price.trim() ? parseMoney(f.session_price) : null;
    if (f.session_price.trim() && price === null) return setError('Valor da sessão inválido. Exemplo: 150,00');
    if (f.meeting_url && !/^https:\/\//i.test(f.meeting_url)) return setError('O link da sala online deve começar com https://');
    if (minor && !f.guardian_name.trim()) return setError('Paciente menor de idade: informe o responsável legal.');

    const nn = (v: string) => (v.trim() ? v.trim() : null);
    const payload: Partial<Patient> = {
      id: patient?.id,
      full_name: f.full_name.trim(), social_name: nn(f.social_name), birth_date: nn(f.birth_date), cpf: nn(onlyDigits(f.cpf)),
      phone: nn(onlyDigits(f.phone)), email: nn(f.email), address: nn(f.address),
      emergency_contact_name: nn(f.emergency_contact_name), emergency_contact_phone: nn(onlyDigits(f.emergency_contact_phone)),
      guardian_name: nn(f.guardian_name), guardian_cpf: nn(onlyDigits(f.guardian_cpf)), guardian_relationship: nn(f.guardian_relationship),
      guardian_phone: nn(onlyDigits(f.guardian_phone)), guardian_authorization_date: nn(f.guardian_authorization_date),
      payer_name: otherPayer ? nn(f.payer_name) : null, payer_cpf: otherPayer ? nn(onlyDigits(f.payer_cpf)) : null,
      billing_mode: f.billing_mode as Patient['billing_mode'], session_price: price,
      session_minutes: f.session_minutes ? Number(f.session_minutes) : null,
      modality: f.modality as Patient['modality'], meeting_url: nn(f.meeting_url),
      status: f.status as Patient['status'], admin_notes: nn(f.admin_notes),
    };
    setBusy(true);
    try {
      const saved = await api.savePatient(payload);
      await qc.invalidateQueries({ queryKey: ['patients'] });
      await qc.invalidateQueries({ queryKey: ['patient', saved.id] });
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} wide title={patient ? 'Editar paciente' : 'Novo paciente'} footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={busy} onClick={submit}>{patient ? 'Salvar alterações' : 'Cadastrar paciente'}</Button>
    </>}>
      <div className="flex flex-col gap-5">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Group title="Identificação">
          <TextField label="Nome completo" required value={f.full_name} onChange={set('full_name')} />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Nome social" value={f.social_name} onChange={set('social_name')} hint="Usado na agenda e nas mensagens." className="sm:col-span-3" />
            <Field label="Nascimento">{(id) => <Input id={id} type="date" value={f.birth_date} onChange={set('birth_date')} />}</Field>
            <TextField label="CPF" inputMode="numeric" value={f.cpf} onChange={set('cpf')} hint="Necessário para recibos." className="sm:col-span-2" />
          </div>
        </Group>

        <Group title="Contato">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Celular (WhatsApp)" inputMode="tel" placeholder="(48) 99999-9999" value={f.phone} onChange={set('phone')} />
            <TextField label="E-mail" type="email" value={f.email} onChange={set('email')} />
          </div>
          <TextField label="Endereço" value={f.address} onChange={set('address')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Contato de emergência" value={f.emergency_contact_name} onChange={set('emergency_contact_name')} />
            <TextField label="Telefone de emergência" inputMode="tel" value={f.emergency_contact_phone} onChange={set('emergency_contact_phone')} />
          </div>
        </Group>

        {(minor || f.guardian_name) && (
          <Group title="Responsável legal">
            {minor && <Notice tone="ocre">Paciente menor de idade. O atendimento não eventual exige autorização de ao menos um responsável (Código de Ética, art. 8º).</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Nome do responsável" required={minor} value={f.guardian_name} onChange={set('guardian_name')} />
              <TextField label="Parentesco" value={f.guardian_relationship} onChange={set('guardian_relationship')} />
              <TextField label="CPF do responsável" inputMode="numeric" value={f.guardian_cpf} onChange={set('guardian_cpf')} />
              <TextField label="Telefone do responsável" inputMode="tel" value={f.guardian_phone} onChange={set('guardian_phone')} />
              <Field label="Data da autorização" hint="Anexe a autorização assinada na aba Anexos.">{(id) => <Input id={id} type="date" value={f.guardian_authorization_date} onChange={set('guardian_authorization_date')} />}</Field>
            </div>
          </Group>
        )}

        <Group title="Atendimento e cobrança">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Modalidade">{(id) => (
              <Select id={id} value={f.modality} onChange={set('modality')}><option value="presencial">Presencial</option><option value="online">Online</option></Select>
            )}</Field>
            {f.modality === 'online' && <TextField label="Link da sala online" placeholder="https://" value={f.meeting_url} onChange={set('meeting_url')} />}
            <TextField label="Valor da sessão (R$)" inputMode="decimal" placeholder="150,00" value={f.session_price} onChange={set('session_price')} />
            <TextField label="Duração (min)" type="number" min={10} max={300} placeholder="Padrão do perfil" value={f.session_minutes} onChange={set('session_minutes')} />
            <Field label="Forma de cobrança" hint={f.billing_mode === 'mensal' ? 'Lance a mensalidade no Financeiro; sessões não geram cobrança individual.' : 'Cada sessão atendida gera um valor a receber.'}>{(id) => (
              <Select id={id} value={f.billing_mode} onChange={set('billing_mode')}><option value="por_sessao">Por sessão</option><option value="mensal">Mensalidade ou pacote</option></Select>
            )}</Field>
          </div>
          <label className="flex items-center gap-3">
            <input type="checkbox" className="h-5 w-5 accent-anil" checked={otherPayer} onChange={(e) => setOtherPayer(e.target.checked)} />
            Outra pessoa paga as sessões
          </label>
          {otherPayer && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Nome do pagador" value={f.payer_name} onChange={set('payer_name')} />
              <TextField label="CPF do pagador" inputMode="numeric" value={f.payer_cpf} onChange={set('payer_cpf')} hint="Exigido no recibo do Receita Saúde." />
            </div>
          )}
        </Group>

        <Group title="Situação">
          {patient && (
            <Field label="Situação do paciente">{(id) => (
              <Select id={id} value={f.status} onChange={set('status')}>
                <option value="ativo">Ativo</option><option value="inativo">Inativo (pausa)</option><option value="alta">Alta</option>
              </Select>
            )}</Field>
          )}
          <Field label="Observações administrativas" hint="Ex.: preferência de horário. Conteúdo clínico vai no prontuário.">
            {(id) => <Textarea id={id} maxLength={2000} value={f.admin_notes} onChange={set('admin_notes')} />}
          </Field>
        </Group>
      </div>
    </Dialog>
  );
}
