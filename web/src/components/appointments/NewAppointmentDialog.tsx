import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../lib/api';
import type { AttachmentCategory, Modality, SeriesFrequency } from '../../lib/types';
import { errorMessage } from '../../lib/errors';
import { addDays, avisoNascimento, formatDateTime, formatLongDate, isValidCpf, money, onlyDigits, parseMoney, todayIn, weekdayName, zonedToUtc } from '../../lib/format';
import { dataBrParaIso, mascararCpf, mascararData, mascararTelefone } from '../../lib/mascaras';
import { useAuth, useProfile } from '../../auth/AuthProvider';
import { ENDERECO_VAZIO, EnderecoCampos, enderecoParaPaciente, type Endereco } from '../patients/EnderecoCampos';
import { PatientForm } from '../patients/PatientForm';
import { Button, Dialog, ErrorBox, Field, Input, Notice, Select, TextField, cx, useToast } from '../ui';
import { useInvalidateAgenda } from './AppointmentSheet';

// Modalidade do atendimento (obrigatória): avulso = uma sessão; semanal e quinzenal criam a série.
type Repeat = 'nao' | SeriesFrequency;
type Ending = 'quantidade' | 'data' | 'sem_fim';
const STEP: Record<SeriesFrequency, number> = { semanal: 7, quinzenal: 14, mensal: 28 };
const DURACOES = [30, 45, 50, 60];
const rotuloDuracao = (m: number) => (m === 60 ? '1 hora' : `${m} min`);
const diaSemana = (d: string) => { const n = weekdayName(d).replace('-feira', ''); return n[0].toUpperCase() + n.slice(1); };

type NovoPaciente = { full_name: string; phone: string; cpf: string; rg: string; birth_date: string; nasc_texto: string; email: string } & Endereco;
const NOVO_VAZIO: NovoPaciente = { full_name: '', phone: '', cpf: '', rg: '', birth_date: '', nasc_texto: '', email: '', ...ENDERECO_VAZIO };
type ArquivoPendente = { file: File; category: AttachmentCategory };

export function NewAppointmentDialog({ open, onClose, initialDate, initialTime, patientId, initialLocationId, initialMinutes, initialModo, initialRepeat, encaixe }: {
  open: boolean; onClose: () => void; initialDate?: string; initialTime?: string; patientId?: string; initialLocationId?: string | null; initialMinutes?: number;
  initialModo?: 'novo' | 'existente'; initialRepeat?: SeriesFrequency;
  /** Encaixe: sessão em qualquer dia e horário, mesmo fora da grade (só não pode bater com outra sessão). */
  encaixe?: boolean;
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
  const [repeat, setRepeat] = useState<Repeat | ''>('');
  const [ending, setEnding] = useState<Ending>('quantidade');
  const [count, setCount] = useState('12');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; conflicts: string[] } | null>(null);
  const [editandoCadastro, setEditandoCadastro] = useState(false);
  const [cadastrado, setCadastrado] = useState(false); // paciente novo salvo nesta janela

  // Vindo de um horário livre da agenda: horário e sala ficam fixos (seguem a grade da sala)
  const horarioFixo = !!initialTime;
  const localFixo = !!initialLocationId;
  const salaFixa = localFixo ? locais.data?.find((l) => l.id === initialLocationId) ?? null : null;

  // Ao abrir: reinicia campos
  useEffect(() => {
    if (!open) return;
    setPid(patientId ?? ''); setDate(initialDate ?? todayIn(tz)); setTime(initialTime ?? '');
    setRepeat(initialRepeat ?? ''); setResult(null); setError(null); setEnding('quantidade'); setCount('12'); setUntil('');
    setLocationId(initialLocationId ?? '');
    setNovo(NOVO_VAZIO); setArquivos([]); setModo(initialModo ?? 'existente'); setCadastrado(false); setEditandoCadastro(false);
    if (initialMinutes) setDuration(String(initialMinutes));
  }, [open, patientId, initialDate, initialTime, tz, initialLocationId, initialMinutes, initialModo, initialRepeat]);

  // Datas do mesmo dia da semana em que o horário está LIVRE (as que dariam conflito com outro agendamento não aparecem)
  const iniLista = initialDate ?? todayIn(tz);
  const ocupadas = useQuery({
    queryKey: ['agenda', zonedToUtc(iniLista, '00:00', tz), zonedToUtc(addDays(iniLista, 84), '00:00', tz)],
    queryFn: () => api.listAgenda(zonedToUtc(iniLista, '00:00', tz), zonedToUtc(addDays(iniLista, 84), '00:00', tz)),
    enabled: open && horarioFixo && !!initialDate,
  });
  const datasLivres = useMemo(() => {
    if (!horarioFixo || !initialDate || !time || !ocupadas.data) return [];
    const dur = Number(duration) || 50;
    return Array.from({ length: 12 }, (_, i) => addDays(initialDate, 7 * i)).filter((d) => {
      const ini = new Date(zonedToUtc(d, time, tz)).getTime();
      const fim = ini + dur * 60000;
      return !ocupadas.data.some((it) => it.status !== 'cancelado' && new Date(it.starts_at).getTime() < fim && ini < new Date(it.ends_at).getTime());
    });
  }, [horarioFixo, initialDate, time, duration, ocupadas.data, tz]);
  // Se a data marcada deixar de estar livre (ex.: mudou a duração), passa para a primeira livre
  useEffect(() => { if (datasLivres.length && !datasLivres.includes(date)) setDate(datasLivres[0]); }, [datasLivres, date]);

  // Presencial ou on-line segue a sala fixa
  useEffect(() => { if (salaFixa) setModality(salaFixa.modality); }, [salaFixa]);

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
    if (!localFixo) setModality(patient.modality);
  }, [patient, profile, localFixo]);

  const preview = useMemo(() => {
    if (!repeat || repeat === 'nao' || !date) return [];
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
      const tel = onlyDigits(novo.phone);
      if (!tel) return setError('Informe o celular (WhatsApp) do paciente.');
      if (tel.length < 10 || tel.length > 11) return setError('Celular inválido: informe DDD + número.');
      if (novo.cpf && !isValidCpf(novo.cpf)) return setError('CPF inválido.');
      if (novo.nasc_texto && !novo.birth_date) return setError('Data de nascimento inválida. Use dia/mês/ano, por exemplo 25/03/1990.');
      if (novo.rg.trim() && (novo.rg.trim().length < 3 || novo.rg.trim().length > 20)) return setError('RG inválido.');
    } else if (!pid) return setError('Escolha o paciente.');
    if (!date) return setError('Informe a data.');
    if (!time) return setError('Informe o horário.');
    if (!repeat) return setError('Escolha a modalidade: avulso, semanal ou quinzenal.');
    const dur = Number(duration);
    if (!dur || dur < 10 || dur > 300) return setError('Escolha a duração da sessão.');
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
        setPid(p.id); setModo('existente'); setCadastrado(true);
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
        // Paciente novo: mostra a confirmação com "Editar cadastro" para corrigir algo logo após salvar
        if (cadastrar) setResult({ created: 1, conflicts: [] }); else onClose();
      } else {
        const r = await api.createSeries({
          patientId: pacienteId, frequency: repeat, startDate: date, startTime: time, duration: dur,
          untilDate: ending === 'data' ? until : null, occurrences: ending === 'quantidade' ? Number(count) : null, price: pr, modality,
          locationId: locationId || null,
        });
        await invalidate();
        if (r.conflicts.length === 0 && !cadastrar) onClose();
        else setResult({ created: r.created.length, conflicts: r.conflicts.map((c) => c.starts_at) });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const active = patients.data?.filter((p) => p.status === 'ativo') ?? [];
  const duracoes = DURACOES.includes(Number(duration)) || !Number(duration) ? DURACOES : [...DURACOES, Number(duration)].sort((a, b) => a - b);

  return (
    <Dialog open={open} onClose={onClose} wide={modo === 'novo'} title={result ? (cadastrado ? 'Paciente cadastrado' : 'Agendamento') : encaixe ? 'Encaixe fora da grade' : modo === 'novo' ? 'Cadastrar paciente' : 'Novo agendamento'} footer={result ? <>
      {cadastrado && patient && <Button variant="secondary" onClick={() => setEditandoCadastro(true)}>Editar cadastro</Button>}
      <Button onClick={onClose}>Concluir</Button>
    </> : <>
      <Button variant="secondary" onClick={onClose}>Voltar</Button>
      <Button busy={busy} onClick={submit}>{repeat && repeat !== 'nao' ? `Agendar ${preview.length} sessões` : 'Agendar'}</Button>
    </>}>
      {result ? (
        <div className="flex flex-col gap-3">
          {cadastrado && (
            <Notice tone="anil">
              <b>{patient?.social_name || patient?.full_name || 'Paciente'}</b> foi cadastrado(a) e {result.created === 1 ? '1 sessão foi agendada' : `${result.created} sessões foram agendadas`}.
              Viu algo errado? Toque em <b>Editar cadastro</b> para corrigir e salvar de novo.
            </Notice>
          )}
          {result.conflicts.length > 0 && <>
            <Notice tone="ocre">
              {result.created} sessões agendadas. {result.conflicts.length} {result.conflicts.length === 1 ? 'data ficou' : 'datas ficaram'} de fora porque o horário já estava ocupado:
            </Notice>
            <ul className="list-inside list-disc text-tinta-2">
              {result.conflicts.map((c) => <li key={c} className="num">{formatDateTime(c, tz)}</li>)}
            </ul>
            <p className="text-sm text-tinta-3">Agende essas datas manualmente em outro horário, se precisar.</p>
          </>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <ErrorBox>{error}</ErrorBox>}
          {encaixe && (
            <Notice tone="anil">
              Para um horário que <b>não está na sua grade</b> (ex.: 12:30 ou 21:00, ou um dia em que você não atende). Escolha o dia e o horário livremente;
              o app só não deixa coincidir com outra sessão. Nos horários da grade, use o <b>+ Agendar</b> da linha LIVRE.
            </Notice>
          )}
          {date && time && <p className="num rounded-campo bg-anil-claro/60 px-3 py-2 font-bold text-sobre-anil-claro first-letter:uppercase">{formatLongDate(date)} às {time}</p>}
          {!patientId && (
            <div role="tablist" aria-label="Paciente" className="inline-flex gap-1 self-start rounded-campo bg-afundado p-1">
              {([['existente', 'Paciente cadastrado'], ['novo', 'Paciente novo']] as const).map(([v, r]) => (
                <button key={v} role="tab" type="button" aria-selected={modo === v} onClick={() => setModo(v)}
                  className={cx('min-h-11 rounded-[calc(var(--r-field)-4px)] px-3.5 text-sm font-bold', modo === v ? 'bg-papel text-anil-escuro shadow-cartao' : 'text-tinta-2')}>{r}</button>
              ))}
            </div>
          )}
          {modo === 'existente' || patientId ? (
            <div className="flex flex-col gap-1.5">
              <Field label="Paciente" required>
                {(id) => (
                  <Select id={id} value={pid} onChange={(e) => setPid(e.target.value)} disabled={!!patientId}>
                    <option value="">{patients.isLoading ? 'Carregando…' : 'Escolha o paciente'}</option>
                    {active.map((p) => <option key={p.id} value={p.id}>{p.social_name || p.full_name}</option>)}
                  </Select>
                )}
              </Field>
              {patient && <button type="button" onClick={() => setEditandoCadastro(true)} className="min-h-11 self-start px-1 text-sm font-bold text-anil-escuro underline">Editar cadastro deste paciente</button>}
            </div>
          ) : (
            <NovoPacienteCampos valor={novo} onChange={setNovo} hoje={todayIn(tz)} />
          )}
          <div className="grid grid-cols-2 gap-3">
            {horarioFixo && initialDate ? (
              // Vindo de um horário da agenda: lista com as próximas datas no mesmo dia da semana (já marcada a do horário)
              <Field label={`Data (${diaSemana(date)})`} required>
                {(id) => (
                  <Select id={id} value={date} onChange={(e) => setDate(e.target.value)}>
                    {datasLivres.length === 0 && <option value={date}>{ocupadas.isLoading ? 'Carregando…' : 'Nenhuma data livre'}</option>}
                    {datasLivres.map((d) => (
                      <option key={d} value={d}>{`${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`}</option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Data" required>{(id) => <Input id={id} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            )}
            {horarioFixo
              ? <Field label="Horário">{(id) => <Input id={id} value={time} readOnly aria-readonly className="cursor-default bg-afundado font-bold" />}</Field>
              : <TextField label="Horário" type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} />}
            <Field label="Duração" required>
              {(id) => (
                <Select id={id} value={duration} onChange={(e) => setDuration(e.target.value)}>
                  {duracoes.map((m) => <option key={m} value={String(m)}>{rotuloDuracao(m)}</option>)}
                </Select>
              )}
            </Field>
            <TextField label="Valor sessão" inputMode="decimal" placeholder="150,00" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          {localFixo ? (
            // Sala do horário, como cadastrada (nome e endereço); não muda aqui
            <div className="flex flex-col gap-1.5">
              <span className="rotulo">Local</span>
              <div className="rounded-campo border border-linha bg-afundado px-3 py-2.5">
                <p className="font-bold">{salaFixa?.name ?? 'Carregando…'}</p>
                {salaFixa?.address && <p className="text-sm text-tinta-2">{salaFixa.address}</p>}
              </div>
            </div>
          ) : (
            (locais.data?.filter((l) => l.active).length ?? 0) > 0 && (
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
            )
          )}
          <Field label="Modalidade" required>
            {(id) => (
              <Select id={id} value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat | '')}>
                <option value="">Escolha: avulso, semanal ou quinzenal</option>
                <option value="nao">Avulso (uma sessão)</option>
                <option value="semanal">Semanal</option>
                <option value="quinzenal">Quinzenal</option>
              </Select>
            )}
          </Field>
          {/* Presencial ou on-line: já vem como a sala foi cadastrada; dá para trocar com um toque */}
          <div role="radiogroup" aria-label="Atendimento presencial ou on-line" className="grid grid-cols-2 gap-1 rounded-campo bg-afundado p-1">
            {([['presencial', 'Presencial'], ['online', 'On-line']] as const).map(([v, r]) => (
              <button key={v} type="button" role="radio" aria-checked={modality === v} onClick={() => setModality(v)}
                className={cx('min-h-11 rounded-[calc(var(--r-field)-4px)] text-[0.9375rem] font-bold', modality === v ? 'btn-degrade' : 'text-tinta-2 hover:bg-papel/60')}>{r}</button>
            ))}
          </div>
          {repeat && repeat !== 'nao' && (
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
          {/* Anexos por último (só no cadastro de paciente novo) */}
          {modo === 'novo' && !patientId && <AnexosCampos arquivos={arquivos} onArquivos={setArquivos} />}
        </div>
      )}
      {patient && <PatientForm open={editandoCadastro} onClose={() => setEditandoCadastro(false)} patient={patient} />}
    </Dialog>
  );
}

const ACEITOS = 'application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif';

/** Cadastro do paciente dentro do agendamento: dados e endereço pelo CEP. Celular obrigatório; máscaras ao digitar. */
function NovoPacienteCampos({ valor, onChange, hoje }: { valor: NovoPaciente; onChange: (v: NovoPaciente) => void; hoje: string }) {
  const set = (k: keyof NovoPaciente) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...valor, [k]: e.target.value });
  const aviso = avisoNascimento(valor.birth_date, hoje);
  return (
    <div className="flex flex-col gap-4 rounded-cartao border border-linha p-4">
      <TextField label="Nome completo" required autoComplete="off" value={valor.full_name} onChange={set('full_name')} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Celular (WhatsApp)" required inputMode="tel" autoComplete="off" placeholder="(48) 99999-9999" maxLength={15}
          value={valor.phone} onChange={(e) => onChange({ ...valor, phone: mascararTelefone(e.target.value) })} />
        <TextField label="E-mail" type="email" value={valor.email} onChange={set('email')} />
        <TextField label="CPF" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" maxLength={14}
          value={valor.cpf} onChange={(e) => onChange({ ...valor, cpf: mascararCpf(e.target.value) })} />
        <TextField label="RG" value={valor.rg} onChange={set('rg')} />
        <Field label="Nascimento" hint={aviso && <span className="font-bold text-ocre">{aviso}</span>}>
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" maxLength={10}
            value={valor.nasc_texto} onChange={(e) => { const t = mascararData(e.target.value); onChange({ ...valor, nasc_texto: t, birth_date: dataBrParaIso(t) ?? '' }); }} />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="rotulo mb-1">Endereço</legend>
        <EnderecoCampos valor={valor} onChange={(e) => onChange({ ...valor, ...e })} />
      </fieldset>
    </div>
  );
}

/** Anexos do paciente novo (laudo, encaminhamento médico) — último bloco do cadastro. */
function AnexosCampos({ arquivos, onArquivos }: { arquivos: ArquivoPendente[]; onArquivos: (a: ArquivoPendente[]) => void }) {
  const laudo = useRef<HTMLInputElement>(null);
  const enc = useRef<HTMLInputElement>(null);
  const troca = useRef<HTMLInputElement>(null);
  const trocarIdx = useRef<number | null>(null);
  function adicionar(files: FileList | null, category: AttachmentCategory) {
    const novos = Array.from(files ?? []).filter((f) => f.size <= 10 * 1024 * 1024).map((file) => ({ file, category }));
    onArquivos([...arquivos, ...novos]);
  }
  return (
    <fieldset className="flex flex-col gap-2 rounded-cartao border border-linha p-4">
      <legend className="rotulo px-1">Laudos e encaminhamento médico (opcional)</legend>
      <div className="flex flex-wrap gap-2">
        <input ref={laudo} type="file" accept={ACEITOS} multiple className="hidden" onChange={(e) => { adicionar(e.target.files, 'laudo'); e.target.value = ''; }} />
        <input ref={enc} type="file" accept={ACEITOS} multiple className="hidden" onChange={(e) => { adicionar(e.target.files, 'encaminhamento'); e.target.value = ''; }} />
        {/* Trocar: escolhe outro arquivo no lugar do selecionado (mesmo tipo: laudo ou encaminhamento) */}
        <input ref={troca} type="file" accept={ACEITOS} className="hidden" onChange={(e) => {
          const f = e.target.files?.[0]; const i = trocarIdx.current; e.target.value = '';
          if (!f || i === null || f.size > 10 * 1024 * 1024) return;
          onArquivos(arquivos.map((a, j) => (j === i ? { ...a, file: f } : a)));
        }} />
        <Button type="button" size="sm" variant="secondary" onClick={() => enc.current?.click()}>Anexar encaminhamento</Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => laudo.current?.click()}>Anexar laudo</Button>
      </div>
      {arquivos.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {arquivos.map((a, i) => (
            <li key={`${a.file.name}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate"><b>{a.category === 'laudo' ? 'Laudo' : 'Encaminhamento'}:</b> {a.file.name}</span>
              <button type="button" className="min-h-11 px-2 font-bold text-anil-escuro" onClick={() => { trocarIdx.current = i; troca.current?.click(); }} aria-label={`Trocar ${a.file.name}`}>Trocar</button>
              <button type="button" className="min-h-11 px-2 font-bold text-tinta-3" onClick={() => onArquivos(arquivos.filter((_, j) => j !== i))} aria-label={`Remover ${a.file.name}`}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-tinta-3">PDF ou foto, até 10 MB cada. Anexou o arquivo errado? Toque em “Trocar” ou “Remover” ao lado dele. Depois de salvo, dá para excluir na ficha do paciente, em Anexos.</p>
    </fieldset>
  );
}
