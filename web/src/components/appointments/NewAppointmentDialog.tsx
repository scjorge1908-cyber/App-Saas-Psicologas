import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { AttachmentCategory, Modality, SeriesFrequency } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { addDays, formatDateTime, formatLongDate, isValidCpf, money, onlyDigits, parseMoney, todayIn, zonedToUtc } from '../../lib/format';
import { useAuth, useProfile } from '../../auth/AuthProvider';
import { ENDERECO_VAZIO, EnderecoCampos, enderecoParaPaciente, type Endereco } from '../patients/EnderecoCampos';
import { Button, Dialog, ErrorBox, Field, Input, Notice, Select, TextField, cx, useToast } from '../ui';
import { useInvalidateAgenda } from './AppointmentSheet';

type Repeat = 'nao' | SeriesFrequency;
type Ending = 'quantidade' | 'data' | 'sem_fim';
const STEP: Record<SeriesFrequency, number> = { semanal: 7, quinzenal: 14, mensal: 28 };

type NovoPaciente = { full_name: string; phone: string; cpf: string; rg: string; birth_date: string; email: string } & Endereco;
const NOVO_VAZIO: NovoPaciente = { full_name: '', phone: '', cpf: '', rg: '', birth_date: '', email: '', ...ENDERECO_VAZIO };
type ArquivoPendente = { file: File; category: AttachmentCategory };

export function NewAppointmentDialog({ open, onClose, initialDate, initialTime, patientId, initialLocationId, initialMinutes }: {
  open: boolean; onClose: () => void; initialDate?: string; initialTime?: string; patientId?: string; initialLocationId?: string | null; initialMinutes?: number;
}) {
  const { profile, tz } = useProfile();
  const { session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [modo, setModo] = useState<'existente' | 'novo'>('existente');
  const [novo, setNovo] = useState<NovoPaciente>(NOVO_VAZIO);
  const [arquivos, setArquivos] = useState<ArquivoPendente[]>([]);
  const invalidate = useInvalidateAgenda();
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.listPatients, enabled: open });
  const [pid, setPid] = useState(patientId ?? '');
  const [date, setDate] = useState(initialDate ?? todayIn(tz));
  const [time, setTime] = useState(initialTime ?? '');
  const [duration, setDuration] = useState(String(profile?.session_minutes ?? 50));
  const [price, setPrice] = useState('');
  const [modality, setModality] = useState<Modality>('presencial');
  const locais = useQuery({ queryKey: ['locations'], queryFn: api.listLocations, enabled: open });
  const [locationId, setLocationId] = useState<string>(initialLocationId ?? '');
  const [repeat, setRepeat] = useState<Repeat>('nao');
  const [ending, setEnding] = useState<Ending>('quantidade');
  const [count, setCount] = useState('12');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; conflicts: string[] } | null>(null);

  // Ao abrir: reinicia campos
  useEffect(() => {
    if (!open) return;
    setPid(patientId ?? ''); setDate(initialDate ?? todayIn(tz)); setTime(initialTime ?? '');
    setRepeat('nao'); setResult(null); setError(null); setEnding('quantidade'); setCount('12'); setUntil('');
    setLocationId(initialLocationId ?? '');
    setNovo(NOVO_VAZIO); setArquivos([]); setModo('existente');
    if (initialMinutes) setDuration(String(initialMinutes));
  }, [open, patientId, initialDate, initialTime, tz, initialLocationId, initialMinutes]);

  // Sem pacientes ativos: já abre no cadastro de paciente novo
  const semPacientes = !!patients.data && patients.data.filter((p) => p.status === 'ativo').length === 0;
  useEffect(() => { if (open && semPacientes && !patientId) setModo('novo'); }, [open, semPacientes, patientId]);

  // Preenche padrões do paciente escolhido
  const patient = useMemo(() => patients.data?.find((p) => p.id === pid), [patients.data, pid]);
  useEffect(() => {
    if (!patient) return;
    setDuration(String(patient.session_minutes ?? profile?.session_minutes ?? 50));
    const pr = patient.session_price ?? profile?.default_price;
    setPrice(pr != null ? String(pr).replace('.', ',') : '');
    setModality(patient.modality);
  }, [patient, profile]);

  const preview = useMemo(() => {
    if (repeat === 'nao' || !date) return [];
    const n = ending === 'quantidade' ? Math.min(Number(count) || 0, 104) : 104;
    const limit = ending === 'data' ? until : ending === 'sem_fim' ? addDays(date, 182) : null;
    const out: string[] = [];
    for (let i = 0, d = date; i < n && (!limit || d <= limit); i++, d = addDays(d, STEP[repeat])) out.push(d);
    return out;
  }, [repeat, date, ending, count, until]);

  async function submit() {
    setError(null);
    const cadastrar = modo === 'novo' && !patientId;
    if (cadastrar) {
      if (novo.full_name.trim().length < 2) return setError('Informe o nome do paciente.');
      if (novo.cpf && !isValidCpf(novo.cpf)) return setError('CPF inválido.');
      const tel = onlyDigits(novo.phone);
      if (tel && (tel.length < 10 || tel.length > 11)) return setError('Celular inválido: informe DDD + número.');
      if (novo.rg.trim() && (novo.rg.trim().length < 3 || novo.rg.trim().length > 20)) return setError('RG inválido.');
    } else if (!pid) return setError('Escolha o paciente.');
    if (!date || !time) return setError('Informe data e horário.');
    const dur = Number(duration);
    if (!dur || dur < 10 || dur > 300) return setError('Duração deve estar entre 10 e 300 minutos.');
    const pr = price.trim() ? parseMoney(price) : null;
    if (price.trim() && pr === null) return setError('Valor inválido. Exemplo: 150,00');
    if (repeat !== 'nao' && ending === 'data' && (!until || until < date)) return setError('Informe a data final da recorrência.');
    if (repeat !== 'nao' && ending === 'quantidade' && (!Number(count) || Number(count) < 1 || Number(count) > 104)) return setError('Quantidade de sessões entre 1 e 104.');

    setBusy(true);
    try {
      let pacienteId = pid;
      if (cadastrar) {
        const nn = (v: string) => (v.trim() ? v.trim() : null);
        const p = await api.savePatient({
          full_name: novo.full_name.trim(), phone: nn(onlyDigits(novo.phone)), cpf: nn(onlyDigits(novo.cpf)), rg: nn(novo.rg),
          birth_date: nn(novo.birth_date), email: nn(novo.email), modality, ...enderecoParaPaciente(novo),
        });
        pacienteId = p.id;
        // Paciente já existe a partir daqui: se algo falhar depois, não cadastra de novo
        setPid(p.id); setModo('existente');
        await qc.invalidateQueries({ queryKey: ['patients'] });
        for (const a of arquivos) {
          try {
            const bytes = new Uint8Array(await a.file.arrayBuffer());
            await api.uploadAttachment({ ownerId: session!.user.id, patientId: p.id, bytes, fileName: a.file.name, mime: a.file.type || 'application/octet-stream', category: a.category });
          } catch (e) { toast(`Não foi possível anexar ${a.file.name}: ${errorMessage(e)}`, 'erro'); }
        }
        setArquivos([]);
      }
      if (repeat === 'nao') {
        const s = zonedToUtc(date, time, tz);
        await api.createAppointment({ patient_id: pacienteId, starts_at: s, ends_at: new Date(new Date(s).getTime() + dur * 60000).toISOString(), price: pr, modality, location_id: locationId || null });
        await invalidate();
        onClose();
      } else {
        const r = await api.createSeries({
          patientId: pacienteId, frequency: repeat, startDate: date, startTime: time, duration: dur,
          untilDate: ending === 'data' ? until : null, occurrences: ending === 'quantidade' ? Number(count) : null, price: pr, modality,
          locationId: locationId || null,
        });
        await invalidate();
        if (r.conflicts.length === 0) onClose();
        else setResult({ created: r.created.length, conflicts: r.conflicts.map((c) => c.starts_at) });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const active = patients.data?.filter((p) => p.status === 'ativo') ?? [];

  return (
    <Dialog open={open} onClose={onClose} wide={modo === 'novo'} title={modo === 'novo' ? 'Novo agendamento e paciente' : 'Novo agendamento'} footer={result ? <Button onClick={onClose}>Entendi</Button> : <>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={busy} onClick={submit}>{repeat === 'nao' ? 'Agendar' : `Agendar ${preview.length} sessões`}</Button>
    </>}>
      {result ? (
        <div className="flex flex-col gap-3">
          <Notice tone="ocre">
            {result.created} sessões agendadas. {result.conflicts.length} {result.conflicts.length === 1 ? 'data ficou' : 'datas ficaram'} de fora porque o horário já estava ocupado:
          </Notice>
          <ul className="list-inside list-disc text-tinta-2">
            {result.conflicts.map((c) => <li key={c} className="num">{formatDateTime(c, tz)}</li>)}
          </ul>
          <p className="text-sm text-tinta-3">Agende essas datas manualmente em outro horário, se precisar.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <ErrorBox>{error}</ErrorBox>}
          {date && time && <p className="num rounded-campo bg-anil-claro/60 px-3 py-2 font-bold text-sobre-anil-claro first-letter:uppercase">{formatLongDate(date)} às {time}</p>}
          {!patientId && (
            <div role="tablist" aria-label="Paciente" className="inline-flex gap-1 self-start rounded-campo bg-afundado p-1">
              {([['existente', 'Paciente cadastrado'], ['novo', 'Paciente novo']] as const).map(([v, r]) => (
                <button key={v} role="tab" type="button" aria-selected={modo === v} onClick={() => setModo(v)}
                  className={cx('min-h-10 rounded-[calc(var(--r-field)-4px)] px-3.5 text-sm font-bold', modo === v ? 'bg-papel text-anil-escuro shadow-cartao' : 'text-tinta-2')}>{r}</button>
              ))}
            </div>
          )}
          {modo === 'existente' || patientId ? (
            <Field label="Paciente" required>
              {(id) => (
                <Select id={id} value={pid} onChange={(e) => setPid(e.target.value)} disabled={!!patientId}>
                  <option value="">{patients.isLoading ? 'Carregando…' : 'Escolha o paciente'}</option>
                  {active.map((p) => <option key={p.id} value={p.id}>{p.social_name || p.full_name}</option>)}
                </Select>
              )}
            </Field>
          ) : (
            <NovoPacienteCampos valor={novo} onChange={setNovo} arquivos={arquivos} onArquivos={setArquivos} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data" required>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <TextField label="Horário" type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} />
            <TextField label="Duração (min)" type="number" inputMode="numeric" min={10} max={300} value={duration} onChange={(e) => setDuration(e.target.value)} />
            <TextField label="Valor (R$)" inputMode="decimal" placeholder="150,00" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          {(locais.data?.filter((l) => l.active).length ?? 0) > 0 && (
            <Field label="Local">
              {(id) => (
                <Select id={id} value={locationId} onChange={(e) => {
                  setLocationId(e.target.value);
                  const l = locais.data?.find((x) => x.id === e.target.value);
                  if (l) setModality(l.modality);
                }}>
                  <option value="">Sem local</option>
                  {locais.data!.filter((l) => l.active || l.id === locationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Modalidade">
            {(id) => (
              <Select id={id} value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
                <option value="presencial">Presencial</option>
                <option value="online">Online</option>
              </Select>
            )}
          </Field>
          <Field label="Repetir">
            {(id) => (
              <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
                <option value="nao">Não repetir</option>
                <option value="semanal">Toda semana</option>
                <option value="quinzenal">A cada 2 semanas</option>
                <option value="mensal">A cada 4 semanas</option>
              </Select>
            )}
          </Field>
          {repeat !== 'nao' && (
            <div className="flex flex-col gap-3 rounded-lg bg-gesso p-3">
              <Field label="Até quando">
                {(id) => (
                  <Select id={id} value={ending} onChange={(e) => setEnding(e.target.value as Ending)}>
                    <option value="quantidade">Por um número de sessões</option>
                    <option value="data">Até uma data</option>
                    <option value="sem_fim">Sem data para terminar</option>
                  </Select>
                )}
              </Field>
              {ending === 'quantidade' && <TextField label="Número de sessões" type="number" min={1} max={104} value={count} onChange={(e) => setCount(e.target.value)} />}
              {ending === 'data' && <Field label="Última data">{(id) => <Input id={id} type="date" min={date} value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>}
              {ending === 'sem_fim' && <p className="text-sm text-tinta-2">As próximas 26 semanas ficam agendadas. Você pode encerrar a recorrência a qualquer momento, por exemplo na alta.</p>}
              {preview.length > 0 && (
                <p className="text-sm text-tinta-2">
                  {preview.length} sessões, de {formatLongDate(preview[0])} a {formatLongDate(preview[preview.length - 1], true)}
                  {price && parseMoney(price) ? `, ${money(parseMoney(price))} cada` : ''}. Datas com horário ocupado são ignoradas e listadas ao final.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

const ACEITOS = 'application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif';

/** Cadastro do paciente dentro do agendamento: dados, endereço pelo CEP e anexos (laudo, encaminhamento médico). */
function NovoPacienteCampos({ valor, onChange, arquivos, onArquivos }: {
  valor: NovoPaciente; onChange: (v: NovoPaciente) => void; arquivos: ArquivoPendente[]; onArquivos: (a: ArquivoPendente[]) => void;
}) {
  const set = (k: keyof NovoPaciente) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...valor, [k]: e.target.value });
  const laudo = useRef<HTMLInputElement>(null);
  const enc = useRef<HTMLInputElement>(null);
  function adicionar(files: FileList | null, category: AttachmentCategory) {
    const novos = Array.from(files ?? []).filter((f) => f.size <= 10 * 1024 * 1024).map((file) => ({ file, category }));
    onArquivos([...arquivos, ...novos]);
  }
  return (
    <div className="flex flex-col gap-4 rounded-cartao border border-linha p-4">
      <TextField label="Nome completo" required autoComplete="off" value={valor.full_name} onChange={set('full_name')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Celular (WhatsApp)" inputMode="tel" placeholder="(48) 99999-9999" value={valor.phone} onChange={set('phone')} />
        <TextField label="E-mail" type="email" value={valor.email} onChange={set('email')} />
        <TextField label="CPF" inputMode="numeric" value={valor.cpf} onChange={set('cpf')} />
        <TextField label="RG" value={valor.rg} onChange={set('rg')} />
        <Field label="Nascimento">{(id) => <Input id={id} type="date" value={valor.birth_date} onChange={set('birth_date')} />}</Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="rotulo mb-1">Endereço</legend>
        <EnderecoCampos valor={valor} onChange={(e) => onChange({ ...valor, ...e })} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="rotulo mb-1">Laudos e encaminhamento médico (opcional)</legend>
        <div className="flex flex-wrap gap-2">
          <input ref={laudo} type="file" accept={ACEITOS} multiple className="hidden" onChange={(e) => { adicionar(e.target.files, 'laudo'); e.target.value = ''; }} />
          <input ref={enc} type="file" accept={ACEITOS} multiple className="hidden" onChange={(e) => { adicionar(e.target.files, 'encaminhamento'); e.target.value = ''; }} />
          <Button type="button" size="sm" variant="secondary" onClick={() => laudo.current?.click()}>Anexar laudo</Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => enc.current?.click()}>Anexar encaminhamento</Button>
        </div>
        {arquivos.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {arquivos.map((a, i) => (
              <li key={`${a.file.name}-${i}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate"><b>{a.category === 'laudo' ? 'Laudo' : 'Encaminhamento'}:</b> {a.file.name}</span>
                <button type="button" className="min-h-9 px-2 font-bold text-tinta-3" onClick={() => onArquivos(arquivos.filter((_, j) => j !== i))} aria-label={`Remover ${a.file.name}`}>Remover</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-tinta-3">PDF ou foto, até 10 MB cada. Ficam no prontuário do paciente e não podem ser excluídos depois.</p>
      </fieldset>
    </div>
  );
}
