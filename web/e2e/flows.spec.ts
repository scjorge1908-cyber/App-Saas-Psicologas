/**
 * Fluxos principais, em tela de celular, com dados fictícios.
 * Executa contra o app real + gateway local + Postgres com as migrations reais.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const RUN = Date.now().toString(36);
const SHOTS = '../docs/evidencias/telas';
const tzDate = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86400e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

async function signup(page: Page, name: string, email: string, crp: string) {
  await page.goto('/cadastro');
  await page.getByLabel('Nome completo').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('textbox', { name: 'Senha', exact: true }).fill('Senha-Ficticia-2026');
  await page.getByLabel('Repita a senha').fill('Senha-Ficticia-2026');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Seu perfil profissional' })).toBeVisible();
  await page.getByLabel('CRP').fill(crp);
  await page.getByLabel('Cidade').fill('Palhoça');
  await page.getByLabel('UF').fill('SC');
  await page.getByRole('button', { name: 'Começar a usar' }).click();
  await expect(page.getByRole('heading', { name: 'Hoje', exact: true })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

let page: Page;
let patientUrl = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test('cadastro, perfil e tela inicial', async () => {
  await signup(page, 'Ana Fictícia Teste', `ana.e2e.${RUN}@exemplo.invalid`, '12/345678');
  await expect(page.getByText('Nenhuma sessão hoje.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-hoje-vazio.png`, fullPage: true });
});

test('cadastro de paciente com validação', async () => {
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Pacientes' }).click();
  await page.getByRole('button', { name: 'Novo paciente' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Nome completo').fill('Carlos Fictício da Silva');
  await dlg.getByLabel('CPF', { exact: true }).fill('123.456.789-00');
  await dlg.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(dlg.getByRole('alert')).toContainText('CPF do paciente inválido');
  await dlg.getByLabel('CPF', { exact: true }).fill('123.456.789-09');
  await dlg.getByLabel('Celular (WhatsApp)').fill('(48) 99999-0001');
  await dlg.getByLabel('Valor da sessão (R$)').fill('150,00');
  await page.screenshot({ path: `${SHOTS}/02-novo-paciente.png` });
  await dlg.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(page.getByRole('heading', { name: 'Carlos Fictício da Silva' })).toBeVisible();
  patientUrl = page.url();
});

test('agenda: série semanal e sessão passada', async () => {
  // Série semanal de 4 sessões a partir de amanhã, 14:00
  await page.getByRole('button', { name: 'Agendar' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByLabel('Data').fill(tzDate(1));
  await dlg.getByLabel('Horário').fill('14:00');
  await dlg.getByLabel('Repetir').selectOption('semanal');
  await dlg.getByLabel('Número de sessões').fill('4');
  await expect(dlg.getByText(/4 sessões, de/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-nova-serie.png` });
  await dlg.getByRole('button', { name: 'Agendar 4 sessões' }).click();
  await expect(dlg).toBeHidden();

  // Conflito: mesma hora amanhã deve ser bloqueada
  await page.getByRole('button', { name: 'Agendar' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel('Data').fill(tzDate(1));
  await dlg.getByLabel('Horário').fill('14:20');
  await dlg.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dlg.getByRole('alert')).toContainText('horário já está ocupado');
  // Sessão de ontem, para registrar presença
  await dlg.getByLabel('Data').fill(tzDate(-1));
  await dlg.getByLabel('Horário').fill('10:00');
  await dlg.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText('Próximas sessões')).toBeVisible();
});

test('registro de presença gera cobrança; recebimento quita', async () => {
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Hoje' }).click();
  const pending = page.locator('#registrar');
  await expect(pending.getByText('Carlos Fictício da Silva')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-hoje-pendencias.png`, fullPage: true });
  await pending.getByRole('button', { name: 'Atendida' }).click();
  await expect(page.getByText('Sessão registrada como atendida')).toBeVisible();

  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Financeiro' }).click();
  await expect(page.getByText(/^Sessão de /)).toBeVisible();
  await expect(page.locator('li', { hasText: 'Carlos' }).getByText('R$ 150,00')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-financeiro-a-receber.png`, fullPage: true });
  await page.getByRole('button', { name: 'Receber' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Valor (R$)')).toHaveValue('150');
  await dlg.getByLabel('Valor (R$)').fill('200');
  await dlg.getByRole('button', { name: 'Registrar recebimento' }).click();
  await expect(dlg.getByRole('alert')).toContainText('não pode passar do saldo');
  await dlg.getByLabel('Valor (R$)').fill('100,00');
  await dlg.getByRole('button', { name: 'Registrar recebimento' }).click();
  await expect(page.getByText('Recebimento registrado')).toBeVisible();
  await expect(page.getByText('recebido R$ 100,00')).toBeVisible();
  await expect(page.locator('li', { hasText: 'Carlos' }).getByText('R$ 50,00').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Recebimentos' }).click();
  await expect(page.getByText('Total do mês: R$ 100,00')).toBeVisible();
  await page.getByRole('tab', { name: /Receita Saúde/ }).click();
  await expect(page.getByRole('button', { name: 'Recibo emitido' })).toBeVisible();
});

test('lembrete com link e confirmação pelo paciente', async ({ browser }) => {
  await page.goto(patientUrl);
  await page.getByRole('button', { name: /Agendada/ }).first().click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Preparar lembrete com link de confirmação' }).click();
  const text = await dlg.locator('pre').innerText();
  expect(text).toContain('Olá, Carlos!');
  const link = text.match(/https?:\/\/\S+\/c\/[A-Za-z0-9_-]{32}/)?.[0];
  expect(link).toBeTruthy();
  const wa = await dlg.getByRole('link', { name: 'Abrir no WhatsApp' }).getAttribute('href');
  expect(wa).toMatch(/^https:\/\/wa\.me\/5548999990001\?text=/);
  await page.screenshot({ path: `${SHOTS}/06-lembrete.png` });
  await dlg.getByRole('button', { name: 'Fechar' }).click();

  // Paciente abre o link, sem login, em outro navegador
  const anon = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const p2 = await anon.newPage();
  await p2.goto(link!.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:5173'));
  await expect(p2.getByRole('heading', { name: 'Confirme sua sessão' })).toBeVisible();
  await expect(p2.getByText('CRP 12/345678')).toBeVisible();
  await expect(p2.getByText('Silva')).toHaveCount(0); // sobrenome do paciente não aparece
  await p2.screenshot({ path: `${SHOTS}/07-paciente-confirma.png` });
  await p2.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(p2.getByRole('heading', { name: 'Presença confirmada' })).toBeVisible();
  await anon.close();

  await page.reload();
  await expect(page.getByRole('button', { name: /Confirmada/ }).first()).toBeVisible();
});

test('prontuário com retificação preservada', async () => {
  await page.getByRole('tab', { name: 'Prontuário' }).click();
  await page.getByRole('button', { name: 'Registrar avaliação da demanda' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox', { name: 'Registro', exact: true }).fill('Demanda fictícia: texto de teste, versão original.');
  await dlg.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(page.getByText('versão original')).toBeVisible();
  await page.getByRole('button', { name: 'Retificar' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox', { name: 'Registro', exact: true }).fill('Demanda fictícia: texto de teste, versão corrigida.');
  await dlg.getByRole('button', { name: 'Salvar retificação' }).click();
  await expect(page.getByText('versão corrigida')).toBeVisible();
  await page.getByRole('button', { name: 'retificado (1x)' }).click();
  await expect(page.getByRole('dialog').getByText('versão original')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-prontuario-historico.png` });
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();
});

test('emissão de documento em PDF', async () => {
  await page.getByRole('tab', { name: 'Documentos' }).click();
  await page.getByRole('button', { name: 'Emitir documento' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Finalidade', { exact: true }).fill('comprovação junto ao empregador');
  await dlg.getByLabel('Dias e horários').fill('às quartas-feiras, das 14h às 14h50');
  await page.screenshot({ path: `${SHOTS}/09-emitir-documento.png` });
  const dl = page.waitForEvent('download');
  await dlg.getByRole('button', { name: 'Emitir e baixar' }).click();
  const file = await dl;
  const path = await file.path();
  expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByText('Emitido em')).toBeVisible();
  // Baixar de novo a cópia guardada
  const dl2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar PDF' }).click();
  expect(readFileSync(await (await dl2).path()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('anexo em armazenamento privado', async () => {
  await page.getByRole('tab', { name: 'Anexos' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'autorizacao-ficticia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ficticio') });
  await expect(page.getByText('autorizacao-ficticia.pdf')).toBeVisible();
  // documento emitido aparece como anexo protegido (sem botão Excluir)
  const docRow = page.locator('li', { hasText: 'Documento emitido' });
  await expect(docRow.getByRole('button', { name: 'Excluir' })).toHaveCount(0);
});

test('backup completo em ZIP', async () => {
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Mais' }).click();
  await page.getByRole('link', { name: 'Configurações' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar backup completo' }).click();
  const zip = unzipSync(new Uint8Array(readFileSync(await (await dl).path())));
  const data = JSON.parse(strFromU8(zip['dados.json']));
  expect(data.patients).toHaveLength(1);
  expect(data.record_entry_versions).toHaveLength(1);
  expect(data.documents).toHaveLength(1);
  expect(Object.keys(zip).filter((k) => k.startsWith('arquivos/')).length).toBe(2);
});

test('outra profissional não acessa os dados', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const p2 = await ctx.newPage();
  await signup(p2, 'Bia Fictícia Teste', `bia.e2e.${RUN}@exemplo.invalid`, '06/111111');
  await p2.goto(patientUrl.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:5173'));
  await expect(p2.getByRole('alert')).toContainText('não encontrado');
  await p2.goto('http://127.0.0.1:5173/pacientes');
  await expect(p2.getByText('Nenhum paciente cadastrado.')).toBeVisible();
  await p2.goto('http://127.0.0.1:5173/financeiro');
  await expect(p2.getByText('Nada a receber.')).toBeVisible();
  await ctx.close();
});

test('agenda nas visões dia, semana e mês', async () => {
  await page.goto('/agenda?v=semana');
  await expect(page.getByText('Carlos Fictício da Silva').filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-agenda-semana-celular.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Mês' }).click();
  await page.screenshot({ path: `${SHOTS}/11-agenda-mes-celular.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Dia' }).click();
  await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
});

test('sem rolagem horizontal nas telas principais (celular)', async () => {
  for (const path of ['/', '/agenda', '/pacientes', patientUrl, '/financeiro', '/notas-fiscais', '/configuracoes']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(1);
  }
});
