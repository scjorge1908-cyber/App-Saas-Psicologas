/**
 * NFS-e Nacional ponta a ponta com dados FICTÍCIOS: app (supabase-js) → função "nfse" → simulador da Sefin.
 * Cobre: certificado A1 cifrado, conferência do que falta, emissão assinada (esquema + assinatura conferidos
 * pelo simulador), proteção contra nota em dobro, recusa da Sefin, cancelamento, PDF e isolamento.
 * Pré-requisito: scripts/e2e-db.sh && node dev-gateway/server.mjs (sobe o simulador junto).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const KEY = process.env.SUPABASE_ANON_KEY ?? 'dev-anon-key';
const run = Date.now().toString(36);
// CNPJ fictício válido e diferente a cada execução (o simulador guarda as DPS já recebidas, como a Sefin).
function cnpjFicticio(): string {
  const b = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (n: number[]) => { const p = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = n.reduce((s, x, i) => s + x * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join('');
}
const CNPJ = cnpjFicticio();

function pfxFicticio(cn: string, senha: string): string {
  const d = mkdtempSync(join(tmpdir(), 'nfse-int-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(d, 'k.pem'), '-out', join(d, 'c.pem'), '-days', '200', '-subj', `/CN=${cn}`], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', join(d, 'k.pem'), '-in', join(d, 'c.pem'), '-out', join(d, 'a.pfx'), '-passout', `pass:${senha}`], { stdio: 'ignore' });
  return readFileSync(join(d, 'a.pfx')).toString('base64');
}

async function usuario(nome: string) {
  const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signUp({ email: `${nome}.nfse.${run}@exemplo.invalid`, password: 'Senha-Teste-123', options: { data: { full_name: `${nome} Fictícia` } } });
  if (error) throw error;
  return { sb, id: data.user!.id };
}

async function chamar(sb: SupabaseClient, body: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke('nfse', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx ? await ctx.json().catch(() => ({})) : {};
    return { erro: (corpo as { erro?: string }).erro ?? error.message, status: ctx?.status };
  }
  return { data };
}

let ana: { sb: SupabaseClient; id: string };
let bia: { sb: SupabaseClient; id: string };
let paciente: string;
let nota: string;

beforeAll(async () => {
  ana = await usuario('ana');
  bia = await usuario('bia');
  const { data: p, error } = await ana.sb.from('patients').insert({ full_name: 'Paciente Fictícia', cpf: '52998224725', email: 'p@exemplo.invalid' }).select('id').single();
  if (error) throw error;
  paciente = p.id;
  const { data: pg, error: e2 } = await ana.sb.from('payments').insert({ patient_id: paciente, amount: 250, paid_on: '2026-11-03', method: 'pix' }).select('id').single();
  if (e2) throw e2;
  const { data: n, error: e3 } = await ana.sb.from('invoices').insert({ patient_id: paciente, payment_id: pg.id, amount: 250, competence: '2026-11-01', emissao: 'nfse_nacional' }).select('id').single();
  if (e3) throw e3;
  nota = n.id;
});

describe('NFS-e Nacional (simulador local)', () => {
  it('confere e lista o que falta antes de emitir', async () => {
    const r = await chamar(ana.sb, { acao: 'conferir', nota_id: nota });
    const faltas = (r.data as { faltas: string[] }).faltas.join(' | ');
    expect(faltas).toMatch(/CNPJ \(ou CPF\) do prestador/);
    expect(faltas).toMatch(/IBGE/);
    expect(faltas).toMatch(/regime/);
    expect(faltas).toMatch(/certificado A1/);
  });

  it('emitir sem cadastro completo é recusado sem gastar número', async () => {
    const r = await chamar(ana.sb, { acao: 'emitir', nota_id: nota });
    expect(r.erro).toMatch(/complete/);
    const { data } = await ana.sb.from('profiles').select('nfse_proximo_numero').single();
    expect(data!.nfse_proximo_numero).toBe(1);
  });

  it('certificado: senha errada é recusada; o certo fica cifrado e só os dados públicos voltam', async () => {
    const pfx = pfxFicticio(`ANA FICTICIA LTDA:${CNPJ}`, 's3nha');
    expect((await chamar(ana.sb, { acao: 'certificado', pfx_b64: pfx, senha: 'errada' })).erro).toMatch(/Senha/);
    const ok = await chamar(ana.sb, { acao: 'certificado', pfx_b64: pfx, senha: 's3nha' });
    expect(ok.data).toMatchObject({ titular: 'ANA FICTICIA LTDA', documento: CNPJ });
    const { data: meu } = await ana.sb.rpc('meu_certificado_nfse');
    expect(meu[0]).toMatchObject({ documento: CNPJ });
    expect(Object.keys(meu[0])).not.toContain('cifrado');
    const { error } = await ana.sb.from('nfse_certificados').select('*');
    expect(error).not.toBeNull(); // tabela sem acesso pelo app
  });

  it('app não chama as funções do servidor nem grava campos da emissão', async () => {
    const { error } = await ana.sb.rpc('nfse_reservar', { p_owner: ana.id, p_invoice: nota });
    expect(error).not.toBeNull();
    const up = await ana.sb.from('invoices').update({ status: 'emitida', number: '1', issued_on: '2026-11-03' }).eq('id', nota);
    expect(up.error?.message).toMatch(/servidor/);
  });

  it('com o Perfil completo, emite: número, chave de 50 dígitos e XML gravados', async () => {
    const { error } = await ana.sb.from('profiles').update({ fiscal_type: 'pj', cnpj: CNPJ, nfse_ibge_municipio: '4211900', nfse_regime: 'me_epp', nfse_aliquota_iss: 2 }).eq('id', ana.id);
    expect(error).toBeNull();
    expect((await chamar(ana.sb, { acao: 'conferir', nota_id: nota })).data).toMatchObject({ faltas: [] });
    const r = await chamar(ana.sb, { acao: 'emitir', nota_id: nota });
    expect(r.erro).toBeUndefined();
    expect(r.data).toMatchObject({ ok: true, ambiente: 'homologacao' });
    const { data: n } = await ana.sb.from('invoice_items').select('*').eq('id', nota).single();
    expect(n).toMatchObject({ status: 'emitida', emissao: 'nfse_nacional', emissao_estado: null, dps_numero: 1, tomador_documento: '52998224725', tomador_nome: 'Paciente Fictícia' });
    expect(n.access_key).toMatch(/^\d{50}$/);
    expect(n.dps_id).toBe(`DPS42119002${CNPJ}00001${'0'.repeat(14)}1`);
    expect(n.nfse_xml).toContain('<nNFSe>');
  });

  it('nota emitida não pode ser alterada nem apagada; recebimento dela fica travado', async () => {
    expect((await ana.sb.from('invoices').update({ amount: 10 }).eq('id', nota)).error).not.toBeNull();
    expect((await ana.sb.from('invoices').delete().eq('id', nota)).error).not.toBeNull();
    const { data: n } = await ana.sb.from('invoices').select('payment_id').eq('id', nota).single();
    expect((await ana.sb.from('payments').delete().eq('id', n!.payment_id)).error?.message).toMatch(/NFS-e emitida/);
    expect((await chamar(ana.sb, { acao: 'emitir', nota_id: nota })).erro).toMatch(/não está "a emitir"/);
  });

  it('segunda nota para o mesmo recebimento é recusada', async () => {
    const { data: n } = await ana.sb.from('invoices').select('payment_id').eq('id', nota).single();
    const { error } = await ana.sb.from('invoices').insert({ patient_id: paciente, payment_id: n!.payment_id, amount: 250, emissao: 'nfse_nacional' });
    expect(error?.code).toBe('23505');
  });

  it('recusa da Sefin vira mensagem clara e a nota volta a "a emitir"; o reenvio reaproveita o número', async () => {
    const { data: n2 } = await ana.sb.from('invoices').insert({ patient_id: paciente, amount: 666, emissao: 'nfse_nacional' }).select('id').single();
    const r = await chamar(ana.sb, { acao: 'emitir', nota_id: n2!.id });
    expect(r.erro).toMatch(/E0310/);
    const { data: n } = await ana.sb.from('invoices').select('status, emissao_estado, emissao_erro, dps_numero').eq('id', n2!.id).single();
    expect(n).toMatchObject({ status: 'a_emitir', emissao_estado: 'erro', dps_numero: 2 });
    expect((await chamar(ana.sb, { acao: 'emitir', nota_id: n2!.id })).erro).toMatch(/E0310/);
    const { data: n3 } = await ana.sb.from('invoices').select('dps_numero, emissao_tentativas').eq('id', n2!.id).single();
    expect(n3).toMatchObject({ dps_numero: 2, emissao_tentativas: 2 });
  });

  it('resposta perdida: a nota foi gerada na Sefin; o reenvio recupera a mesma nota sem emitir outra', async () => {
    const { data: n4 } = await ana.sb.from('invoices').insert({ patient_id: paciente, amount: 777, emissao: 'nfse_nacional' }).select('id').single();
    const r1 = await chamar(ana.sb, { acao: 'emitir', nota_id: n4!.id });
    expect(r1.erro).toMatch(/resposta inesperada/);
    const { data: a } = await ana.sb.from('invoices').select('status, dps_id, dps_numero').eq('id', n4!.id).single();
    expect(a!.status).toBe('a_emitir');
    const r2 = await chamar(ana.sb, { acao: 'emitir', nota_id: n4!.id });
    expect(r2.erro).toBeUndefined();
    const { data: b } = await ana.sb.from('invoices').select('status, dps_id, dps_numero, access_key').eq('id', n4!.id).single();
    expect(b).toMatchObject({ status: 'emitida', dps_id: a!.dps_id, dps_numero: a!.dps_numero });
  });

  it('município sem convênio: detectado sozinho, não gasta número e orienta o modo assistido', async () => {
    const { data: antes } = await ana.sb.from('profiles').select('nfse_proximo_numero').single();
    await ana.sb.from('profiles').update({ nfse_ibge_municipio: '4200000' }).eq('id', ana.id).throwOnError();
    const { data: n5 } = await ana.sb.from('invoices').insert({ patient_id: paciente, amount: 90, emissao: 'nfse_nacional' }).select('id').single();
    const c = await chamar(ana.sb, { acao: 'conferir', nota_id: n5!.id });
    expect(c.data).toMatchObject({ municipio: 'sem_convenio', servico: { codigo: '041601' } });
    const r = await chamar(ana.sb, { acao: 'emitir', nota_id: n5!.id });
    expect(r.erro).toMatch(/não emite pelo sistema nacional/);
    const { data: depois } = await ana.sb.from('profiles').select('nfse_proximo_numero').single();
    expect(depois!.nfse_proximo_numero).toBe(antes!.nfse_proximo_numero);
    const { data: cache } = await ana.sb.from('nfse_municipios').select('situacao').eq('ibge', '4200000');
    expect(cache).toEqual([{ situacao: 'sem_convenio' }]); // guardado para todas as contas (informação pública)
    // Rascunho vira nota manual (emitida na prefeitura)
    expect((await ana.sb.from('invoices').update({ emissao: 'manual' }).eq('id', n5!.id)).error).toBeNull();
    await ana.sb.from('profiles').update({ nfse_ibge_municipio: '4211900' }).eq('id', ana.id).throwOnError();
    const ok = await chamar(ana.sb, { acao: 'conferir', nota_id: nota });
    expect((ok.data as { municipio: string }).municipio).toBe('conveniado');
  });

  it('o app não grava na tabela de municípios', async () => {
    const { error } = await ana.sb.from('nfse_municipios').insert({ ibge: '1234567', ambiente: 'producao', situacao: 'conveniado' });
    expect(error).not.toBeNull();
  });

  it('baixa o PDF (DANFSe) da nota emitida', async () => {
    const r = await chamar(ana.sb, { acao: 'pdf', nota_id: nota });
    expect(atob((r.data as { pdf_b64: string }).pdf_b64).slice(0, 5)).toBe('%PDF-');
  });

  it('cancela com motivo; motivo curto é recusado', async () => {
    expect((await chamar(ana.sb, { acao: 'cancelar', nota_id: nota, codigo: '1', motivo: 'curto' })).erro).toMatch(/motivo/);
    const r = await chamar(ana.sb, { acao: 'cancelar', nota_id: nota, codigo: '1', motivo: 'Valor da sessão informado errado' });
    expect(r.data).toMatchObject({ ok: true });
    const { data: n } = await ana.sb.from('invoices').select('status, cancelamento_motivo').eq('id', nota).single();
    expect(n).toMatchObject({ status: 'cancelada', cancelamento_motivo: 'Valor da sessão informado errado' });
  });

  it('outra psicóloga não confere, não emite e não vê a nota', async () => {
    expect((await chamar(bia.sb, { acao: 'conferir', nota_id: nota })).erro).toMatch(/não encontrada/i);
    expect((await chamar(bia.sb, { acao: 'emitir', nota_id: nota })).erro).toMatch(/não encontrada/i);
    const { data } = await bia.sb.from('invoices').select('id').eq('id', nota);
    expect(data).toEqual([]);
  });

  it('sem login a função recusa', async () => {
    const anon = createClient(URL, KEY, { auth: { persistSession: false } });
    expect((await chamar(anon, { acao: 'conferir', nota_id: nota })).status).toBe(401);
  });
});
