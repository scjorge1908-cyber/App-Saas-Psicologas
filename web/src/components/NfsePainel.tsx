// Configurações → "Nota fiscal (NFS-e)" (pedido do Jorge, 06/11/2026).
// Dados fiscais do prestador exigidos pelo padrão nacional e envio do certificado A1.
// O certificado vai direto para o servidor, que o guarda cifrado; o app só vê titular, documento e validade.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import { supabase } from '../lib/supabase';
import { buscarCep } from '../lib/cep';
import { errorMessage } from '../lib/errors';
import { formatCnpj, formatCpf, formatDate } from '../lib/format';
import { isDemo } from '../lib/demo/modo';
import { atualizarPerfilDemo } from '../lib/demo/api-demo';
import type { AmbienteNfse, Profile, RegimeNfse } from '../lib/types';
import { Badge, Button, ErrorBox, Field, Input, Notice, Panel, Select, Spinner, TextField, useConfirm, useToast } from './ui';

const doc = (d: string) => (d.length === 14 ? formatCnpj(d) : formatCpf(d));

/** O que falta no Perfil para emitir pelo app (sem consultar o servidor). */
export function faltandoNfse(p: Partial<Profile>, temCertificado: boolean): string[] {
  const f: string[] = [];
  if (!/^\d{7}$/.test(p.nfse_ibge_municipio ?? '')) f.push('município (código IBGE)');
  if (!p.nfse_regime) f.push('regime tributário');
  if (!temCertificado) f.push('certificado A1');
  return f;
}

export function NfsePainel({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const cert = useQuery({ queryKey: ['certificado-nfse'], queryFn: api.meuCertificadoNfse });
  const [f, setF] = useState<Record<string, string>>({});
  const [cidade, setCidade] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [buscandoIbge, setBuscandoIbge] = useState(false);

  useEffect(() => {
    setF({
      nfse_ibge_municipio: profile.nfse_ibge_municipio ?? '', nfse_inscricao_municipal: profile.nfse_inscricao_municipal ?? '',
      nfse_regime: profile.nfse_regime ?? '', nfse_cod_trib_nac: profile.nfse_cod_trib_nac ?? '041601',
      nfse_aliquota_iss: profile.nfse_aliquota_iss != null ? String(profile.nfse_aliquota_iss).replace('.', ',') : '',
      nfse_descricao: profile.nfse_descricao ?? 'Atendimento psicológico', nfse_serie: profile.nfse_serie ?? '1',
      nfse_proximo_numero: String(profile.nfse_proximo_numero ?? 1), nfse_ambiente: profile.nfse_ambiente ?? 'homologacao',
    });
  }, [profile]);

  // Município: vem do CEP do consultório (Perfil profissional). Busca sozinho quando ainda está vazio.
  async function buscarIbge(silencioso = false) {
    if (!profile.cep) { if (!silencioso) setError('Preencha o CEP no Perfil profissional primeiro.'); return; }
    setBuscandoIbge(true);
    const r = await buscarCep(profile.cep);
    setBuscandoIbge(false);
    if (r?.ibge) { setF((x) => ({ ...x, nfse_ibge_municipio: r.ibge! })); setCidade(`${r.city}/${r.uf}`); }
    else if (!silencioso) setError('Não consegui o código do município pelo CEP. Digite o código IBGE (7 números).');
  }
  const tentou = useRef(false);
  useEffect(() => {
    if (!tentou.current && !profile.nfse_ibge_municipio && profile.cep) { tentou.current = true; void buscarIbge(true); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.cep, profile.nfse_ibge_municipio]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const faltas = faltandoNfse({ ...profile, nfse_ibge_municipio: f.nfse_ibge_municipio, nfse_regime: (f.nfse_regime || null) as RegimeNfse | null }, !!cert.data);
  const salvoOk = faltandoNfse(profile, !!cert.data).length === 0;

  async function salvar() {
    setError(null);
    if (f.nfse_ibge_municipio && !/^\d{7}$/.test(f.nfse_ibge_municipio)) return setError('O código do município (IBGE) tem 7 números.');
    if (!/^\d{6}$/.test(f.nfse_cod_trib_nac)) return setError('O código de tributação nacional tem 6 números (psicologia: 041601).');
    if (!/^\d{1,5}$/.test(f.nfse_serie)) return setError('A série tem de 1 a 5 números.');
    const prox = Number(f.nfse_proximo_numero);
    if (!Number.isInteger(prox) || prox < 1) return setError('O próximo número da DPS precisa ser 1 ou maior.');
    const aliq = f.nfse_aliquota_iss ? Number(f.nfse_aliquota_iss.replace(',', '.')) : null;
    if (aliq != null && !(aliq > 0 && aliq <= 5)) return setError('A alíquota do ISS fica entre 0,01% e 5%.');
    if (f.nfse_descricao.trim().length < 3) return setError('Escreva a descrição do serviço que vai na nota.');
    if (f.nfse_ambiente === 'producao' && profile.nfse_ambiente !== 'producao') {
      const ok = await confirm({ title: 'Emitir notas de verdade?', confirmLabel: 'Sim, notas válidas',
        body: 'No modo Produção, cada nota emitida vale perante a Prefeitura e a Receita. Faça antes um teste no modo Teste.' });
      if (!ok) return;
    }
    const patch: Partial<Profile> = {
      nfse_ibge_municipio: f.nfse_ibge_municipio || null, nfse_inscricao_municipal: f.nfse_inscricao_municipal.trim() || null,
      nfse_regime: (f.nfse_regime || null) as RegimeNfse | null, nfse_cod_trib_nac: f.nfse_cod_trib_nac,
      nfse_aliquota_iss: f.nfse_regime === 'me_epp' ? aliq : null, nfse_descricao: f.nfse_descricao.trim(),
      nfse_serie: f.nfse_serie, nfse_proximo_numero: prox, nfse_ambiente: f.nfse_ambiente as AmbienteNfse,
    };
    setBusy(true);
    try {
      if (isDemo()) atualizarPerfilDemo(patch);
      else { const { error: e } = await supabase.from('profiles').update(patch).eq('id', profile.id); if (e) throw e; }
      await qc.invalidateQueries({ queryKey: ['profile'] });
      toast('Dados da nota fiscal salvos');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Panel recolhivel ok={salvoOk} okTexto="Pronto para emitir" title="Nota fiscal (NFS-e)">
      <div className="flex flex-col gap-4" data-testid="painel-nfse">
        <Notice>
          <p>O app emite a NFS-e pelo <b>sistema nacional do governo</b> (gratuito), com o seu certificado digital A1.</p>
          {!salvoOk && <p className="mt-1">Para emitir, falta: <b>{faltas.join(', ')}</b>.</p>}
        </Notice>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Município (código IBGE)" required hint={buscandoIbge ? <span className="inline-flex items-center gap-1.5"><Spinner small /> Buscando pelo CEP…</span> : cidade || 'Vem do CEP do consultório.'}>{(id) => (
            <div className="flex gap-2">
              <Input id={id} inputMode="numeric" maxLength={7} value={f.nfse_ibge_municipio ?? ''} onChange={set('nfse_ibge_municipio')} />
              <Button variant="secondary" size="sm" onClick={() => void buscarIbge()}>Pelo CEP</Button>
            </div>
          )}</Field>
          <TextField label="Inscrição municipal" value={f.nfse_inscricao_municipal ?? ''} onChange={set('nfse_inscricao_municipal')} hint="Se a sua prefeitura exigir." />
          <Field label="Regime tributário" required>{(id) => (
            <Select id={id} value={f.nfse_regime} onChange={set('nfse_regime')}>
              <option value="">Escolha</option>
              <option value="mei">MEI</option>
              <option value="me_epp">Simples Nacional (ME/EPP)</option>
              <option value="nao_optante">Não optante do Simples</option>
            </Select>
          )}</Field>
          {f.nfse_regime === 'me_epp' && <TextField label="Alíquota do ISS (%)" inputMode="decimal" value={f.nfse_aliquota_iss ?? ''} onChange={set('nfse_aliquota_iss')} hint="Do seu enquadramento no Simples (ex.: 2,00). Deixe vazio se não souber." />}
          <TextField label="Código de tributação nacional" inputMode="numeric" maxLength={6} value={f.nfse_cod_trib_nac ?? ''} onChange={set('nfse_cod_trib_nac')} hint="041601 = Psicologia e psicanálise." />
          <TextField label="Descrição do serviço" value={f.nfse_descricao ?? ''} onChange={set('nfse_descricao')} hint="Texto padrão da nota; dá para mudar em cada nota." />
          <TextField label="Série da DPS" inputMode="numeric" maxLength={5} value={f.nfse_serie ?? ''} onChange={set('nfse_serie')} />
          <TextField label="Próximo número da DPS" inputMode="numeric" value={f.nfse_proximo_numero ?? ''} onChange={set('nfse_proximo_numero')} hint="Se já emitiu notas em outro sistema nesta série, continue a numeração." />
          <Field label="Ambiente">{(id) => (
            <Select id={id} value={f.nfse_ambiente} onChange={set('nfse_ambiente')}>
              <option value="homologacao">Teste (nota sem valor fiscal)</option>
              <option value="producao">Produção (nota válida)</option>
            </Select>
          )}</Field>
        </div>
        <div className="flex justify-end"><Button busy={busy} onClick={() => void salvar()}>Salvar dados da nota</Button></div>
        <CertificadoA1 carregando={cert.isLoading} cert={cert.data ?? null} docPerfil={profile.fiscal_type === 'pj' ? profile.cnpj : profile.cpf} />
      </div>
    </Panel>
  );
}

function CertificadoA1({ cert, carregando, docPerfil }: { cert: Awaited<ReturnType<typeof api.meuCertificadoNfse>>; carregando: boolean; docPerfil: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const vencido = cert ? new Date(cert.valido_ate) < new Date() : false;
  const outroDoc = cert && docPerfil && cert.documento !== docPerfil;

  async function enviar() {
    setError(null);
    if (!arquivo) return setError('Escolha o arquivo do certificado (.pfx ou .p12).');
    if (arquivo.size > 50_000) return setError('Arquivo grande demais para um certificado A1.');
    if (!senha) return setError('Digite a senha do certificado.');
    setBusy(true);
    try {
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
      await api.nfse('certificado', { pfx_b64: btoa(bin), senha });
      setArquivo(null); setSenha('');
      await qc.invalidateQueries({ queryKey: ['certificado-nfse'] });
      toast('Certificado guardado com segurança');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  async function remover() {
    if (!(await confirm({ title: 'Remover o certificado?', confirmLabel: 'Remover', danger: true, body: 'Sem ele o app não emite notas até você enviar outro.' }))) return;
    try { await api.removerCertificadoNfse(); await qc.invalidateQueries({ queryKey: ['certificado-nfse'] }); toast('Certificado removido'); }
    catch (e) { setError(errorMessage(e)); }
  }

  return (
    <section className="rounded-campo border border-linha p-3" aria-label="Certificado digital A1">
      <h3 className="mb-2 font-bold">Certificado digital A1</h3>
      {error && <ErrorBox>{error}</ErrorBox>}
      {carregando ? <Spinner small /> : cert ? (
        <div className="flex flex-col gap-2" data-testid="certificado-guardado">
          <p><b>{cert.titular}</b> — {doc(cert.documento)}</p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-tinta-2">
            Vale até {formatDate(cert.valido_ate.slice(0, 10))}
            {vencido ? <Badge tone="erro">Vencido</Badge> : <Badge tone="ok">Válido</Badge>}
            {outroDoc && <Badge tone="atencao">Documento diferente do Perfil</Badge>}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>Trocar certificado</Button>
            <Button variant="ghost" size="sm" onClick={() => void remover()}>Remover</Button>
          </div>
        </div>
      ) : <p className="text-sm text-tinta-2">Nenhum certificado enviado. Ele fica guardado cifrado no servidor e nunca volta para o aparelho.</p>}
      <input ref={input} type="file" accept=".pfx,.p12,application/x-pkcs12" className="hidden" data-testid="arquivo-certificado"
        onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      {(!cert || arquivo) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => input.current?.click()}>{arquivo ? `Arquivo: ${arquivo.name}` : 'Escolher arquivo .pfx'}</Button>
          <TextField label="Senha do certificado" type="password" autoComplete="off" value={senha} onChange={(e) => setSenha(e.target.value)} />
          <div className="sm:col-span-2 flex justify-end"><Button busy={busy} onClick={() => void enviar()}>Enviar certificado</Button></div>
        </div>
      )}
    </section>
  );
}
