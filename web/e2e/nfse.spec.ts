/**
 * Navegação da NFS-e no celular (Pixel 7), com dados FICTÍCIOS, contra app + gateway local + simulador da Sefin:
 * Configurações → Nota fiscal (NFS-e) → certificado A1 → Financeiro → recebimento → Nota fiscal →
 * conferir → Emitir → nota emitida (PDF/XML) → Cancelar → lista de Notas fiscais.
 * Paciente e recebimento entram pela API (o cadastro deles já tem E2E próprio em flows.spec.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completarPerfil } from './perfil';

const RUN = Date.now().toString(36);
const EMAIL = `nfse.e2e.${RUN}@exemplo.invalid`;
const SENHA = 'Senha-Ficticia-2026';
const SHOTS = '../docs/evidencias/telas';
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function cnpjFicticio(): string {
  const b = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (n: number[]) => { const p = n.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = n.reduce((s, x, i) => s + x * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); return [...b, d1, dv([...b, d1])].join('');
}
const CNPJ = cnpjFicticio();

function pfxFicticio(): Buffer {
  const d = mkdtempSync(join(tmpdir(), 'nfse-e2e-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(d, 'k.pem'), '-out', join(d, 'c.pem'), '-days', '300', '-subj', `/CN=CLINICA FICTICIA LTDA:${CNPJ}`], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', join(d, 'k.pem'), '-in', join(d, 'c.pem'), '-out', join(d, 'a1.pfx'), '-passout', 'pass:senha-a1'], { stdio: 'ignore' });
  return readFileSync(join(d, 'a1.pfx'));
}

test.describe.configure({ mode: 'serial' });
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.addInitScript(() => { try { sessionStorage.setItem('psi.avisos.mostrados', '1'); sessionStorage.setItem('psi.pendencias.mostradas', '1'); } catch { /* sem armazenamento */ } });
});

test('cadastro da psicóloga PJ, paciente e recebimento (fictícios)', async () => {
  await page.goto('/cadastro');
  await page.getByLabel('Nome completo').fill('Clínica Fictícia NFS-e');
  await page.getByLabel('E-mail').fill(EMAIL);
  await page.getByRole('textbox', { name: 'Senha', exact: true }).fill(SENHA);
  await page.getByLabel('Repita a senha').fill(SENHA);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu perfil profissional' })).toBeVisible();
  await page.getByLabel('CRP').fill('12/345679');
  await page.getByLabel('Cidade').fill('Palhoça');
  await page.getByLabel('UF').fill('SC');
  await page.getByRole('button', { name: 'Começar a usar' }).click();
  await page.goto('/resumo');
  await completarPerfil(page);

  const sb = createClient('http://localhost:54321', 'dev-anon-key', { auth: { persistSession: false } });
  const { data: login, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: SENHA });
  expect(error).toBeNull();
  await sb.from('profiles').update({ fiscal_type: 'pj', cnpj: CNPJ, company_name: 'Clínica Fictícia Ltda' }).eq('id', login.user!.id).throwOnError();
  const { data: p } = await sb.from('patients').insert({ full_name: 'Paciente Nota Fictícia', cpf: '52998224725', email: 'paciente@exemplo.invalid' }).select('id').single().throwOnError();
  await sb.from('payments').insert({ patient_id: p!.id, amount: 250, paid_on: hoje, method: 'pix' }).throwOnError();
});

test('Configurações → Nota fiscal (NFS-e): município pelo CEP, regime e certificado A1', async () => {
  await page.route('https://viacep.com.br/**', (r) => r.fulfill({ json: { logradouro: 'Rua Fictícia', bairro: 'Centro', localidade: 'Palhoça', uf: 'SC', ibge: '4211900' } }));
  await page.goto('/configuracoes');
  const painel = page.getByTestId('painel-nfse');
  await page.getByText('Nota fiscal (NFS-e)', { exact: true }).click();
  await expect(painel.getByText(/Para emitir, falta/)).toBeVisible();
  await expect(painel.getByLabel('Município (código IBGE)')).toHaveValue('4211900'); // veio sozinho pelo CEP
  await painel.getByLabel('Regime tributário').selectOption('me_epp');
  await painel.getByLabel('Alíquota do ISS (%)').fill('2,00');
  await expect(painel.getByLabel('Código de tributação nacional')).toHaveValue('041601');
  await painel.getByRole('button', { name: 'Salvar dados da nota' }).click();
  await expect(page.getByText('Dados da nota fiscal salvos')).toBeVisible();

  await painel.getByTestId('arquivo-certificado').setInputFiles({ name: 'clinica-a1.pfx', mimeType: 'application/x-pkcs12', buffer: pfxFicticio() });
  await painel.getByLabel('Senha do certificado').fill('errada');
  await painel.getByRole('button', { name: 'Enviar certificado' }).click();
  await expect(painel.getByText(/Senha do certificado incorreta/)).toBeVisible();
  await painel.getByLabel('Senha do certificado').fill('senha-a1');
  await painel.getByRole('button', { name: 'Enviar certificado' }).click();
  await expect(page.getByText('Certificado guardado com segurança')).toBeVisible();
  const guardado = painel.getByTestId('certificado-guardado');
  await expect(guardado).toContainText('CLINICA FICTICIA LTDA');
  await expect(guardado).toContainText('Válido');
  await expect(page.getByText('Pronto para emitir')).toBeVisible();
  await painel.screenshot({ path: `${SHOTS}/nfse-01-configuracoes.png` });
  await page.unroute('https://viacep.com.br/**');
});

test('Financeiro → recebimento → Nota fiscal → conferir → Emitir NFS-e (modo Teste)', async () => {
  await page.goto('/financeiro?aba=recebimentos');
  await page.getByRole('link', { name: 'Nota fiscal' }).first().click();
  await expect(page).toHaveURL(/\/notas-fiscais\?recebimento=/);
  const d = page.getByRole('dialog', { name: 'Emitir NFS-e' });
  await expect(d.getByLabel('Valor (R$)')).toHaveValue('250');
  await expect(d.getByLabel('Paciente')).toHaveValue(/.+/);
  await d.screenshot({ path: `${SHOTS}/nfse-02-nova.png` });
  await d.getByRole('button', { name: 'Continuar' }).click();

  const n = page.getByTestId('dialogo-nfse');
  await expect(n.getByText('Paciente Nota Fictícia')).toBeVisible();
  await expect(n.getByText('529.982.247-25')).toBeVisible();
  await expect(n.getByText(/Modo Teste/)).toBeVisible();
  await expect(n.getByText(/Antes de emitir, complete/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/nfse-03-conferir.png` });
  await page.getByRole('dialog', { name: 'Emitir NFS-e' }).getByRole('button', { name: 'Emitir NFS-e', exact: true }).click();
  await expect(page.getByText(/NFS-e de teste nº \d+ emitida/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('dialog', { name: /NFS-e nº \d+/ })).toBeVisible();
  await expect(n.getByTestId('chave-nfse')).toHaveText(/^\d{50}$/);
  await expect(n.getByText('Emitida', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/nfse-04-emitida.png` });
});

test('nota emitida: baixa PDF e XML; recebimento não aceita segunda nota', async () => {
  const n = page.getByTestId('dialogo-nfse');
  const [pdf] = await Promise.all([page.waitForEvent('download'), n.getByRole('button', { name: 'Baixar PDF' }).click()]);
  expect(readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe('%PDF-');
  const [xml] = await Promise.all([page.waitForEvent('download'), n.getByRole('button', { name: 'Baixar XML' }).click()]);
  expect(readFileSync(await xml.path(), 'utf8')).toContain('<nNFSe>');
  await page.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  // De novo pelo Financeiro: abre a MESMA nota, sem criar outra
  await page.goto('/financeiro?aba=recebimentos');
  await page.getByRole('link', { name: 'Nota fiscal' }).first().click();
  await expect(page.getByRole('dialog', { name: /NFS-e nº \d+/ })).toBeVisible();
});

test('cancelar nota com motivo; lista mostra Cancelada e o selo Teste', async () => {
  const n = page.getByTestId('dialogo-nfse');
  await n.getByRole('button', { name: 'Cancelar nota' }).click();
  await n.getByLabel('Motivo', { exact: true }).selectOption('1');
  await n.getByLabel('Explique o motivo').fill('curto');
  await n.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(n.getByText(/pelo menos 15 letras/)).toBeVisible();
  await n.getByLabel('Explique o motivo').fill('Valor da sessão informado errado');
  await n.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await page.getByRole('dialog', { name: 'Cancelar esta nota?' }).getByRole('button', { name: 'Cancelar nota' }).click();
  await expect(page.getByText('Nota cancelada')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('dialog', { name: 'NFS-e cancelada' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/nfse-05-cancelada.png` });
  await page.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  await page.getByRole('tab', { name: 'Canceladas' }).click();
  const item = page.getByRole('button', { name: /Paciente Nota Fictícia/ });
  await expect(item).toContainText('Cancelada');
  await expect(item).toContainText('Teste');
  await expect(item).toContainText('pelo app');
  await page.screenshot({ path: `${SHOTS}/nfse-06-lista.png` });
});

test('emissão com dado faltando mostra o que completar e links para corrigir', async () => {
  await page.getByRole('main').getByRole('button', { name: 'Emitir NFS-e', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Emitir NFS-e' });
  await d.getByLabel('Paciente').selectOption({ label: 'Paciente Nota Fictícia' });
  await d.getByLabel('Valor (R$)').fill('180,00');
  await d.getByLabel('Competência').fill(hoje.slice(0, 7));
  await d.getByRole('button', { name: 'Continuar' }).click();
  // Sem recebimento escolhido também funciona; agora tira o CPF do paciente para ver a conferência
  const sb = createClient('http://localhost:54321', 'dev-anon-key', { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email: EMAIL, password: SENHA });
  await sb.from('patients').update({ cpf: null }).eq('full_name', 'Paciente Nota Fictícia').throwOnError();
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.getByRole('tab', { name: 'A emitir' }).click();
  await page.getByRole('button', { name: /Paciente Nota Fictícia/ }).first().click();
  const n = page.getByTestId('dialogo-nfse');
  await expect(n.getByText(/Antes de emitir, complete/)).toBeVisible();
  await expect(n.getByText(/CPF ou CNPJ de quem recebe a nota/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Emitir NFS-e' }).getByRole('button', { name: 'Emitir NFS-e', exact: true })).toBeDisabled();
  await expect(n.getByRole('link', { name: 'Abrir cadastro do paciente' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/nfse-07-falta-dado.png` });
  // Sem rolagem horizontal no celular
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
