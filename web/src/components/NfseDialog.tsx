// Emissão de NFS-e pelo app (padrão nacional) — pedido do Jorge, 06/11/2026.
// Caminho na tela: Notas fiscais → Emitir NFS-e (ou Financeiro → recebimento → Nota fiscal)
//   1. escolher paciente e recebimento (valor e competência vêm sozinhos) → Continuar
//   2. conferir o resumo (quem recebe a nota, valor, ambiente) e o que falta → Emitir NFS-e
//   3. nota emitida: número, chave, Baixar PDF/XML, Cancelar nota.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { InvoiceItem } from '../lib/types';
import { errorMessage } from '../lib/errors';
import { formatCnpj, formatCpf, formatDate, money, parseMoney } from '../lib/format';
import { saveBlob } from './patients/DocumentsTab';
import { useProfile } from '../auth/AuthProvider';
import { Badge, Button, DescList, Dialog, ErrorBox, Field, Input, Notice, Select, Spinner, Textarea, TextField, useConfirm, useToast } from './ui';

const docFmt = (d?: string | null) => (!d ? '' : d.length === 14 ? formatCnpj(d) : formatCpf(d));
const competenciaDe = (data: string) => `${data.slice(0, 7)}-01`;

export function AmbienteBadge({ ambiente }: { ambiente?: string | null }) {
  if (ambiente !== 'homologacao') return null;
  return <Badge tone="anil">Teste</Badge>;
}

export function NfseDialog({ nota, recebimentoInicial, notas, onClose, onRegistrarManual }: {
  nota: Partial<InvoiceItem> | null; recebimentoInicial?: string | null; notas: InvoiceItem[]; onClose: () => void;
  /** Município sem convênio nacional: o rascunho vira nota manual, para registrar a nota emitida na prefeitura. */
  onRegistrarManual?: (nota: InvoiceItem) => void;
}) {
  if (!nota) return null;
  if (!nota.id) return <NovaNfse recebimentoInicial={recebimentoInicial} notas={notas} onClose={onClose} />;
  return <NotaNfse id={nota.id} onClose={onClose} onRegistrarManual={onRegistrarManual} />;
}

/** Passo 1: paciente + recebimento → rascunho "a emitir". */
function NovaNfse({ recebimentoInicial, notas, onClose }: { recebimentoInicial?: string | null; notas: InvoiceItem[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { profile } = useProfile();
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.listPatients });
  const todos = useQuery({ queryKey: ['payments', 'nfse'], queryFn: () => api.listPayments({}) });
  const [pacienteId, setPacienteId] = useState('');
  const [recebimentoId, setRecebimentoId] = useState(recebimentoInicial ?? '');
  const [valor, setValor] = useState('');
  const [competencia, setCompetencia] = useState('');
  const [descricao, setDescricao] = useState(profile?.nfse_descricao ?? 'Atendimento psicológico');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [criada, setCriada] = useState<string | null>(null);

  const comNota = useMemo(() => new Set(notas.filter((n) => n.status !== 'cancelada' && n.payment_id).map((n) => n.payment_id)), [notas]);
  const recebimentos = (todos.data ?? []).filter((p) => (!pacienteId || p.patient_id === pacienteId) && !comNota.has(p.id))
    .sort((a, b) => b.paid_on.localeCompare(a.paid_on)).slice(0, 30);

  // Veio do Financeiro (atalho do recebimento): paciente, valor e competência já preenchidos.
  useEffect(() => {
    const r = todos.data?.find((p) => p.id === recebimentoId);
    if (!r) return;
    setPacienteId(r.patient_id); setValor(String(r.amount).replace('.', ',')); setCompetencia(competenciaDe(r.paid_on));
  }, [recebimentoId, todos.data]);

  async function continuar() {
    setError(null);
    const amount = parseMoney(valor);
    if (!pacienteId) return setError('Escolha o paciente.');
    if (!amount) return setError('Informe o valor da nota.');
    if (!competencia) return setError('Informe a competência (mês do atendimento).');
    if (recebimentoId && comNota.has(recebimentoId)) return setError('Este recebimento já tem nota fiscal.');
    setBusy(true);
    try {
      const n = await api.saveInvoice({ patient_id: pacienteId, payment_id: recebimentoId || null, amount, competence: competenciaDe(competencia),
        emissao: 'nfse_nacional', descricao: descricao.trim() || null, status: 'a_emitir' });
      await qc.invalidateQueries({ queryKey: ['invoices'] });
      setCriada((n as unknown as { id: string }).id);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  if (criada) return <NotaNfse id={criada} onClose={onClose} />;

  return (
    <Dialog open onClose={onClose} title="Emitir NFS-e" footer={<>
      <Button variant="secondary" onClick={onClose}>Voltar</Button><Button busy={busy} onClick={() => void continuar()}>Continuar</Button>
    </>}>
      <div className="flex flex-col gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <Field label="Paciente" required>{(id) => (
          <Select id={id} value={pacienteId} onChange={(e) => { setPacienteId(e.target.value); setRecebimentoId(''); }}>
            <option value="">Escolha o paciente</option>
            {patients.data?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </Select>
        )}</Field>
        <Field label="Recebimento" hint="A nota fica ligada ao pagamento: não sai nota em dobro.">{(id) => (
          <Select id={id} value={recebimentoId} onChange={(e) => setRecebimentoId(e.target.value)} disabled={todos.isLoading}>
            <option value="">{pacienteId ? 'Sem recebimento (valor à mão)' : 'Escolha o paciente primeiro'}</option>
            {recebimentos.map((p) => <option key={p.id} value={p.id}>{formatDate(p.paid_on)} — {money(p.amount)}{pacienteId ? '' : ` — ${p.patient_name}`}</option>)}
          </Select>
        )}</Field>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Valor (R$)" inputMode="decimal" required value={valor} onChange={(e) => setValor(e.target.value)} />
          <Field label="Competência" required>{(id) => <Input id={id} type="month" value={competencia.slice(0, 7)} onChange={(e) => setCompetencia(e.target.value ? `${e.target.value}-01` : '')} />}</Field>
        </div>
        <Field label="Descrição do serviço">{(id) => <Textarea id={id} rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

/** Passos 2 e 3: conferir/emitir; nota emitida (PDF, XML, cancelar). */
function NotaNfse({ id, onClose, onRegistrarManual }: { id: string; onClose: () => void; onRegistrarManual?: (nota: InvoiceItem) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const lista = useQuery({ queryKey: ['invoices'], queryFn: api.listInvoices });
  const nota = lista.data?.find((n) => n.id === id);
  const conferencia = useQuery({ queryKey: ['nfse-conferir', id, nota?.status], queryFn: () => api.nfse<api.ConferenciaNfse>('conferir', { nota_id: id }), enabled: nota?.status === 'a_emitir' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [codigo, setCodigo] = useState('1');

  const atualizar = async () => { await qc.invalidateQueries({ queryKey: ['invoices'] }); await qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  async function emitir() {
    setError(null);
    if (conferencia.data?.ambiente === 'producao' && !(await confirm({ title: 'Emitir nota válida?', confirmLabel: 'Emitir',
      body: `${money(nota!.amount)} para ${conferencia.data.tomador.nome}. A nota vale perante a Prefeitura e a Receita.` }))) return;
    setBusy('emitir');
    try {
      const r = await api.nfse<{ numero: string | null; ambiente: string }>('emitir', { nota_id: id });
      await atualizar();
      toast(r.ambiente === 'producao' ? `NFS-e nº ${r.numero} emitida` : `NFS-e de teste nº ${r.numero} emitida`);
    } catch (e) { setError(errorMessage(e)); await atualizar(); } finally { setBusy(null); }
  }

  async function cancelar() {
    setError(null);
    if (motivo.trim().length < 15) return setError('Escreva o motivo do cancelamento (pelo menos 15 letras).');
    if (!(await confirm({ title: 'Cancelar esta nota?', danger: true, confirmLabel: 'Cancelar nota', body: 'O cancelamento é enviado ao sistema nacional e não pode ser desfeito.' }))) return;
    setBusy('cancelar');
    try {
      await api.nfse('cancelar', { nota_id: id, codigo, motivo: motivo.trim() });
      await atualizar(); setCancelando(false); toast('Nota cancelada');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function baixarPdf() {
    setError(null); setBusy('pdf');
    try {
      const r = await api.nfse<{ pdf_b64: string }>('pdf', { nota_id: id });
      const bin = atob(r.pdf_b64); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      saveBlob(new Blob([bytes], { type: 'application/pdf' }), `nfse-${nota?.number ?? id}.pdf`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function excluirRascunho() {
    if (!(await confirm({ title: 'Excluir este rascunho?', confirmLabel: 'Excluir', danger: true }))) return;
    try {
      await api.deleteInvoice(id);
      await atualizar(); onClose();
    } catch (e) { setError(errorMessage(e)); }
  }

  if (!nota) return <Dialog open onClose={onClose} title="NFS-e"><Spinner /></Dialog>;
  const faltas = conferencia.data?.faltas ?? [];
  // O app só emite onde o município usa o Emissor Nacional; nos demais, modo assistido (06–07/11).
  const semConvenio = conferencia.data?.municipio === 'sem_convenio' || conferencia.data?.municipio === 'sistema_proprio';

  async function virarManual() {
    setError(null);
    try {
      await api.saveInvoice({ id, emissao: 'manual' });
      await atualizar();
      const n = (await api.listInvoices()).find((x) => x.id === id);
      if (n && onRegistrarManual) onRegistrarManual(n); else onClose();
    } catch (e) { setError(errorMessage(e)); }
  }
  const tomador = conferencia.data?.tomador;

  return (
    <Dialog open onClose={onClose} title={nota.status === 'emitida' ? `NFS-e nº ${nota.number}` : nota.status === 'cancelada' ? 'NFS-e cancelada' : 'Emitir NFS-e'} footer={
      nota.status === 'a_emitir' ? <>
        <Button variant="secondary" onClick={onClose}>Voltar</Button>
        <Button busy={busy === 'emitir'} disabled={conferencia.isLoading || faltas.length > 0 || semConvenio} onClick={() => void emitir()}>Emitir NFS-e</Button>
      </> : <Button variant="secondary" onClick={onClose}>Fechar</Button>
    }>
      <div className="flex flex-col gap-4" data-testid="dialogo-nfse">
        {error && <ErrorBox>{error}</ErrorBox>}
        {nota.ambiente === 'homologacao' || (nota.status === 'a_emitir' && conferencia.data?.ambiente === 'homologacao')
          ? <Notice>Modo <b>Teste</b>: a nota vai para o ambiente de testes do governo e <b>não tem valor fiscal</b>. Para notas válidas, mude para Produção em Configurações → Nota fiscal.</Notice> : null}

        {nota.status === 'a_emitir' && <>
          {nota.emissao_estado === 'erro' && nota.emissao_erro && <ErrorBox><b>Última tentativa recusada.</b> {nota.emissao_erro}</ErrorBox>}
          {conferencia.isLoading && <p className="flex items-center gap-2 text-tinta-2"><Spinner small /> Conferindo os dados…</p>}
          {conferencia.error && <ErrorBox>{errorMessage(conferencia.error)}</ErrorBox>}
          {semConvenio && (
            <ModoAssistido nota={nota} conferencia={conferencia.data!} onRegistrar={() => void virarManual()} />
          )}
          {faltas.length > 0 && (
            <Notice tone="ocre">
              <p><b>Antes de emitir, complete:</b></p>
              <ul className="mt-1 list-disc pl-5">{faltas.map((f) => <li key={f}>{f}</li>)}</ul>
              <p className="mt-2"><Link to="/configuracoes" className="font-bold underline">Abrir Configurações → Nota fiscal</Link>{' · '}<Link to={`/pacientes/${nota.patient_id}`} className="font-bold underline">Abrir cadastro do paciente</Link></p>
            </Notice>
          )}
          <DescList items={[
            ['Quem recebe a nota', tomador ? <>{tomador.nome ?? '—'} <span className="num text-tinta-2">{docFmt(tomador.documento)}</span></> : nota.patient_name],
            ['Valor', <span className="num font-bold">{money(nota.amount)}</span>],
            ['Competência', formatDate(nota.competence).slice(3)],
            ['Serviço', nota.descricao || 'Descrição padrão do Perfil'],
          ]} />
          {!nota.dps_id && <Button variant="ghost" size="sm" onClick={() => void excluirRascunho()}>Excluir rascunho</Button>}
        </>}

        {nota.status !== 'a_emitir' && <>
          <p className="flex flex-wrap items-center gap-2">
            {nota.status === 'emitida' ? <Badge tone="ok">Emitida</Badge> : <Badge tone="neutro">Cancelada</Badge>}
            <AmbienteBadge ambiente={nota.ambiente} />
          </p>
          <DescList items={[
            ['Número', <span className="num">{nota.number}</span>],
            ['Emitida em', formatDate(nota.issued_on)],
            ['Quem recebeu', <>{nota.tomador_nome} <span className="num text-tinta-2">{docFmt(nota.tomador_documento)}</span></>],
            ['Valor', <span className="num font-bold">{money(nota.amount)}</span>],
            ['Chave de acesso', <span className="num break-all text-sm" data-testid="chave-nfse">{nota.access_key}</span>],
            ...(nota.status === 'cancelada' ? [['Motivo do cancelamento', nota.cancelamento_motivo ?? '']] as Array<[string, string]> : []),
          ]} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" busy={busy === 'pdf'} onClick={() => void baixarPdf()}>Baixar PDF</Button>
            {nota.nfse_xml && <Button variant="secondary" size="sm" onClick={() => saveBlob(new Blob([nota.nfse_xml!], { type: 'application/xml' }), `nfse-${nota.number}.xml`)}>Baixar XML</Button>}
            {nota.status === 'emitida' && !cancelando && <Button variant="ghost" size="sm" onClick={() => setCancelando(true)}>Cancelar nota</Button>}
          </div>
          {cancelando && (
            <section className="flex flex-col gap-3 rounded-campo border border-linha p-3" aria-label="Cancelar nota">
              <Field label="Motivo">{(fid) => (
                <Select id={fid} value={codigo} onChange={(e) => setCodigo(e.target.value)}>
                  <option value="1">Erro na emissão</option><option value="2">Serviço não prestado</option><option value="9">Outros</option>
                </Select>
              )}</Field>
              <Field label="Explique o motivo" required>{(fid) => <Textarea id={fid} rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}</Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => setCancelando(false)}>Desistir</Button>
                <Button size="sm" busy={busy === 'cancelar'} onClick={() => void cancelar()}>Confirmar cancelamento</Button>
              </div>
            </section>
          )}
        </>}
      </div>
    </Dialog>
  );
}

/**
 * Modo assistido (06/11): o município ainda não emite pelo sistema nacional. A psicóloga emite no portal da
 * prefeitura copiando os dados daqui e depois registra a nota (número, data, PDF/XML) — sem perder o controle no app.
 */
function ModoAssistido({ nota, conferencia, onRegistrar }: { nota: InvoiceItem; conferencia: api.ConferenciaNfse; onRegistrar: () => void }) {
  const toast = useToast();
  const t = conferencia.tomador;
  const campos: Array<[string, string]> = [
    [t.tipo === 'pj' ? 'CNPJ de quem recebe' : 'CPF de quem recebe', t.documento ?? ''],
    ['Nome de quem recebe', t.nome ?? ''],
    ['Valor', String(Number(nota.amount).toFixed(2)).replace('.', ',')],
    ['Competência', formatDate(nota.competence).slice(3)],
    ['Código do serviço', conferencia.servico?.codigo ?? '041601'],
    ['Descrição', conferencia.servico?.descricao ?? ''],
  ];
  const copiar = async (texto: string, rotulo: string) => {
    try { await navigator.clipboard.writeText(texto); toast(`${rotulo} copiado`); } catch { toast('Não consegui copiar. Selecione e copie à mão.', 'erro'); }
  };
  return (
    <section className="flex flex-col gap-3 rounded-campo border border-ocre/40 bg-ocre-fundo p-3" aria-label="Modo assistido" data-testid="modo-assistido">
      <p><b>{conferencia.municipio === 'sistema_proprio' ? 'Sua prefeitura emite a NFS-e no sistema próprio dela.' : 'Seu município ainda não emite pelo sistema nacional.'}</b> O app conferiu isso sozinho. Emita no portal da sua prefeitura com os dados abaixo e depois registre a nota aqui.</p>
      <ul className="flex flex-col gap-1.5">
        {campos.map(([rotulo, valor]) => (
          <li key={rotulo} className="flex items-center justify-between gap-2">
            <span className="min-w-0"><span className="block text-xs text-tinta-2">{rotulo}</span><span className="num block break-words">{valor || '—'}</span></span>
            {valor && <Button variant="ghost" size="sm" onClick={() => void copiar(valor, rotulo)}>Copiar</Button>}
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onRegistrar}>Registrar como nota emitida na prefeitura</Button>
    </section>
  );
}
