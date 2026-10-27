import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Patient } from '../../lib/types';
import * as api from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { avisoNascimento, isMinor, isValidCpf, onlyDigits, parseMoney, todayIn } from '../../lib/format';
import { useProfile } from '../../auth/AuthProvider';
import { Button, Dialog, ErrorBox, Field, Input, Notice, Select, TextField, Textarea, cx } from '../ui';
import { EnderecoCampos, enderecoFaltando, enderecoParaPaciente, ENDERECO_VAZIO, type Endereco } from './EnderecoCampos';

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

/** Endereço de quem paga (colunas payer_*) no formato dos campos de endereço. */
function enderecoPagador(p?: Patient | null): Endereco {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return { cep: s(p?.payer_cep), street: s(p?.payer_street), address_number: s(p?.payer_number), address_complement: s(p?.payer_complement),
    neighborhood: s(p?.payer_neighborhood), city: s(p?.payer_city), uf: s(p?.payer_uf) };
}
const emailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

function toForm(p?: Patient | null): Form {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  return {
    full_name: s(p?.full_name), social_name: s(p?.social_name), birth_date: s(p?.birth_date), cpf: s(p?.cpf),
    phone: s(p?.phone), email: s(p?.email), address: s(p?.address), rg: s(p?.rg),
    cep: s(p?.cep), street: s(p?.street), address_number: s(p?.address_number), address_complement: s(p?.address_complement),
    neighborhood: s(p?.neighborhood), city: s(p?.city), uf: s(p?.uf),
    emergency_contact_name: s(p?.emergency_contact_name), emergency_contact_phone: s(p?.emergency_contact_phone),
    guardian_name: s(p?.guardian_name), guardian_cpf: s(p?.guardian_cpf), guardian_relationship: s(p?.guardian_relationship),
    guardian_phone: s(p?.guardian_phone), guardian_authorization_date: s(p?.guardian_authorization_date),
    payer_name: s(p?.payer_name), payer_cpf: s(p?.payer_cpf), payer_email: s(p?.payer_email), payer_phone: s(p?.payer_phone),
    billing_mode: p?.billing_mode ?? 'por_sessao', session_price: p?.session_price != null ? String(p.session_price).replace('.', ',') : '',
    session_minutes: s(p?.session_minutes), modality: p?.modality ?? 'presencial', meeting_url: s(p?.meeting_url),
    status: p?.status ?? 'ativo', admin_notes: s(p?.admin_notes),
  };
}

export function PatientForm({ open, onClose, patient, onSaved }: { open: boolean; onClose: () => void; patient?: Patient | null; onSaved?: (p: Patient) => void }) {
  const { tz } = useProfile();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(toForm(patient));
  const [otherPayer, setOtherPayer] = useState(!!patient?.payer_name || patient?.nf_tomador === 'outro');
  const [emiteNota, setEmiteNota] = useState(!!patient?.nf_tomador);
  const [endPagador, setEndPagador] = useState<Endereco>(enderecoPagador(patient));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setF(toForm(patient)); setOtherPayer(!!patient?.payer_name || patient?.nf_tomador === 'outro'); setEmiteNota(!!patient?.nf_tomador);
      setEndPagador(enderecoPagador(patient)); setError(null);
    }
  }, [open, patient]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const minor = isMinor(f.birth_date || null, todayIn(tz));

  // O que falta para emitir a nota fiscal (tomador = paciente ou quem paga)
  const faltaNota: string[] = !emiteNota ? [] : otherPayer
    ? [
        ...(f.payer_name.trim().length < 2 ? ['nome completo'] : []), ...(!isValidCpf(f.payer_cpf) ? ['CPF'] : []),
        ...(!emailOk(f.payer_email) ? ['e-mail'] : []), ...enderecoFaltando(endPagador),
      ]
    : [
        ...(f.full_name.trim().length < 2 ? ['nome completo'] : []), ...(!isValidCpf(f.cpf) ? ['CPF do paciente'] : []),
        ...(!emailOk(f.email) ? ['e-mail do paciente'] : []), ...enderecoFaltando(f as unknown as Endereco).map((x) => `${x} do paciente`),
      ];
  /** "Pode repetir o contato principal": copia celular, e-mail e endereço do paciente para quem paga. */
  const repetirContato = () => {
    setF((x) => ({ ...x, payer_email: x.email, payer_phone: x.phone }));
    setEndPagador({ ...ENDERECO_VAZIO, cep: f.cep, street: f.street, address_number: f.address_number, address_complement: f.address_complement, neighborhood: f.neighborhood, city: f.city, uf: f.uf });
  };

  async function submit() {
    setError(null);
    if (f.full_name.trim().length < 2) return setError('Informe o nome do paciente.');
    for (const [k, label] of [['cpf', 'CPF do paciente'], ['guardian_cpf', 'CPF do responsável'], ['payer_cpf', 'CPF do pagador']] as const) {
      if (f[k] && !isValidCpf(f[k])) return setError(`${label} inválido.`);
    }
    for (const [k, label] of [['phone', 'Telefone'], ['emergency_contact_phone', 'Telefone de emergência'], ['guardian_phone', 'Telefone do responsável'], ['payer_phone', 'Telefone de quem paga']] as const) {
      const d = onlyDigits(f[k]);
      if (d && (d.length < 10 || d.length > 11)) return setError(`${label} inválido: informe DDD + número.`);
    }
    if (f.rg.trim() && (f.rg.trim().length < 3 || f.rg.trim().length > 20)) return setError('RG inválido.');
    const price = f.session_price.trim() ? parseMoney(f.session_price) : null;
    if (f.session_price.trim() && price === null) return setError('Valor da sessão inválido. Exemplo: 150,00');
    if (f.meeting_url && !/^https:\/\//i.test(f.meeting_url)) return setError('O link da sala online deve começar com https://');
    if (minor && !f.guardian_name.trim()) return setError('Paciente menor de idade: informe o responsável legal.');
    if (otherPayer && (f.payer_name.trim().length < 2 || !f.payer_cpf.trim())) return setError('Nota fiscal: informe o nome completo e o CPF de quem paga.');
    if (f.payer_email.trim() && !emailOk(f.payer_email)) return setError('Nota fiscal: e-mail de quem paga inválido.');
    if (faltaNota.length) return setError(`Para emitir a nota fiscal, falta: ${faltaNota.join(', ')}.`);

    const nn = (v: string) => (v.trim() ? v.trim() : null);
    const payload: Partial<Patient> = {
      id: patient?.id,
      full_name: f.full_name.trim(), social_name: nn(f.social_name), birth_date: nn(f.birth_date), cpf: nn(onlyDigits(f.cpf)),
      phone: nn(onlyDigits(f.phone)), email: nn(f.email), address: nn(f.address), rg: nn(f.rg),
      ...enderecoParaPaciente(f as unknown as Endereco),
      emergency_contact_name: nn(f.emergency_contact_name), emergency_contact_phone: nn(onlyDigits(f.emergency_contact_phone)),
      guardian_name: nn(f.guardian_name), guardian_cpf: nn(onlyDigits(f.guardian_cpf)), guardian_relationship: nn(f.guardian_relationship),
      guardian_phone: nn(onlyDigits(f.guardian_phone)), guardian_authorization_date: nn(f.guardian_authorization_date),
      payer_name: otherPayer ? nn(f.payer_name) : null, payer_cpf: otherPayer ? nn(onlyDigits(f.payer_cpf)) : null,
      ...dadosPagador(otherPayer, f, endPagador),
      nf_tomador: emiteNota ? (otherPayer ? 'outro' : 'paciente') : null,
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
            <Field label="Nascimento" hint={avisoNascimento(f.birth_date, todayIn(tz)) && <span className="font-bold text-ocre">{avisoNascimento(f.birth_date, todayIn(tz))}</span>}>{(id, d) => <Input id={id} aria-describedby={d} type="date" value={f.birth_date} onChange={set('birth_date')} />}</Field>
            <TextField label="CPF" inputMode="numeric" value={f.cpf} onChange={set('cpf')} hint="Necessário para recibos." />
            <TextField label="RG" value={f.rg} onChange={set('rg')} />
          </div>
        </Group>

        <Group title="Contato">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Celular (WhatsApp)" inputMode="tel" placeholder="(48) 99999-9999" value={f.phone} onChange={set('phone')} />
            <TextField label="E-mail" type="email" value={f.email} onChange={set('email')} />
          </div>
          <EnderecoCampos valor={f as unknown as Endereco} onChange={(e) => setF((x) => ({ ...x, ...e }))} />
          {f.address && !f.street && <TextField label="Endereço anterior (texto livre)" value={f.address} onChange={set('address')} />}
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
        </Group>

        <Group title="Nota fiscal">
          <p className="text-sm text-tinta-2">Dados de quem recebe a nota (e o recibo do Receita Saúde). Com a nota marcada, os campos com <span className="text-vermelho">*</span> são obrigatórios.</p>
          <div role="radiogroup" aria-label="Quem paga as sessões" className="grid grid-cols-2 gap-2">
            {([[false, 'O próprio paciente'], [true, 'Outra pessoa']] as const).map(([v, rot]) => (
              <button key={rot} type="button" role="radio" aria-checked={otherPayer === v} onClick={() => setOtherPayer(v)}
                className={cx('min-h-12 rounded-campo border-[1.5px] px-3 text-[0.9375rem] font-bold', otherPayer === v ? 'border-anil bg-anil-claro text-sobre-anil-claro' : 'border-linha bg-papel text-tinta-2')}>{rot}</button>
            ))}
          </div>
          <label className="flex items-center gap-3">
            <input type="checkbox" className="h-5 w-5 accent-anil" checked={emiteNota} onChange={(e) => setEmiteNota(e.target.checked)} />
            Emitir nota fiscal para este paciente
          </label>
          {otherPayer ? (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="Nome completo de quem paga" required value={f.payer_name} onChange={set('payer_name')} className="sm:col-span-2" />
                <TextField label="CPF de quem paga" required inputMode="numeric" value={f.payer_cpf} onChange={set('payer_cpf')} hint="Exigido na nota e no recibo do Receita Saúde." />
                <TextField label="Celular" inputMode="tel" placeholder="(48) 99999-9999" value={f.payer_phone} onChange={set('payer_phone')} />
                <TextField label="E-mail (recebe a nota)" required={emiteNota} type="email" value={f.payer_email} onChange={set('payer_email')} className="sm:col-span-2" />
              </div>
              <Button type="button" variant="ghost" size="sm" className="self-start" onClick={repetirContato}>Repetir celular, e-mail e endereço do paciente</Button>
              <EnderecoCampos valor={endPagador} onChange={setEndPagador} obrigatorio={emiteNota} />
            </div>
          ) : (
            <p className="text-sm text-tinta-2">A nota sai no nome do paciente, com o CPF, o e-mail e o endereço preenchidos acima.</p>
          )}
          {emiteNota && (faltaNota.length
            ? <Notice tone="ocre">Para emitir a nota, falta: {faltaNota.join(', ')}.</Notice>
            : <p className="text-sm font-bold text-verde">Dados completos para a nota fiscal.</p>)}
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

/** Contato e endereço de quem paga (só quando é outra pessoa; senão, limpa). */
function dadosPagador(outro: boolean, f: Form, e: Endereco): Partial<Patient> {
  const nn = (v: string) => (v.trim() ? v.trim() : null);
  if (!outro) return { payer_email: null, payer_phone: null, payer_cep: null, payer_street: null, payer_number: null, payer_complement: null, payer_neighborhood: null, payer_city: null, payer_uf: null };
  const end = enderecoParaPaciente(e);
  return {
    payer_email: nn(f.payer_email), payer_phone: nn(onlyDigits(f.payer_phone)),
    payer_cep: end.cep, payer_street: end.street, payer_number: end.address_number, payer_complement: end.address_complement,
    payer_neighborhood: end.neighborhood, payer_city: end.city, payer_uf: end.uf,
  };
}
