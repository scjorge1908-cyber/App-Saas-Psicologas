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
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu perfil profissional' })).toBeVisible();
  await page.getByLabel('CRP').fill(crp);
  await page.getByLabel('Cidade').fill('Palhoça');
  await page.getByLabel('UF').fill('SC');
  await page.getByRole('button', { name: 'Começar a usar' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeAttached(); // tela inicial = agenda
}

test.describe.configure({ mode: 'serial' });

let page: Page;
let patientUrl = '';
let backupPath = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // A janela de avisos abre sozinha ao abrir o app quando há pendências; nos fluxos ela é testada à parte (sininho)
  await page.addInitScript(() => { try { sessionStorage.setItem('psi.avisos.mostrados', '1'); } catch { /* sem armazenamento */ } });
});

test('cadastro, perfil e tela inicial', async () => {
  await signup(page, 'Ana Fictícia Teste', `ana.e2e.${RUN}@exemplo.invalid`, '12/345678');
  // Sem grade: a agenda convida a criar os horários e mostra os primeiros passos
  await expect(page.getByText('Monte sua grade de horários')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Primeiros passos' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-agenda-vazia.png`, fullPage: true });
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
  await dlg.getByLabel('Modalidade').selectOption('semanal');
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
  await dlg.getByLabel('Modalidade').selectOption('nao');
  await dlg.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dlg.getByRole('alert')).toContainText('horário já está ocupado');
  // Sessão de ontem, para registrar presença
  await dlg.getByLabel('Data').fill(tzDate(-1));
  await dlg.getByLabel('Horário').fill('10:00');
  await dlg.getByLabel('Modalidade').selectOption('nao');
  await dlg.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText('Próximas sessões')).toBeVisible();
});

test('registro de presença gera cobrança; recebimento quita', async () => {
  await page.goto('/resumo');
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
  await page.getByRole('tab', { name: 'Avaliação e plano' }).click();
  await page.getByRole('button', { name: 'Avaliação da demanda' }).click();
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
  await page.getByText('Seus dados', { exact: true }).click(); // seção recolhível
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar backup completo' }).click();
  backupPath = `test-results/backup-${RUN}.zip`;
  await (await dl).saveAs(backupPath);
  const zip = unzipSync(new Uint8Array(readFileSync(backupPath)));
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

test('restauração do backup em conta nova (dados + arquivos)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true });
  const p3 = await ctx.newPage();
  await signup(p3, 'Clara Fictícia Restauração', `clara.e2e.${RUN}@exemplo.invalid`, '06/222222');
  await p3.goto('http://127.0.0.1:5173/configuracoes');
  await p3.getByText('Seus dados', { exact: true }).click();
  await p3.locator('input[type=file][accept=".zip,.json"]').setInputFiles(backupPath);
  await p3.getByRole('dialog').getByRole('button', { name: 'Restaurar' }).click();
  await expect(p3.getByText(/Backup restaurado: 1 pacientes/)).toBeVisible({ timeout: 20000 });
  await p3.goto('http://127.0.0.1:5173/pacientes');
  await p3.getByText('Carlos Fictício da Silva').click();
  await p3.getByRole('tab', { name: 'Prontuário' }).click();
  await p3.getByRole('tab', { name: 'Avaliação e plano' }).click();
  await expect(p3.getByText('versão corrigida')).toBeVisible();
  await p3.getByRole('tab', { name: 'Documentos' }).click();
  const dl = p3.waitForEvent('download');
  await p3.getByRole('button', { name: 'Baixar PDF' }).click();
  expect(readFileSync(await (await dl).path()).subarray(0, 5).toString()).toBe('%PDF-');
  await ctx.close();
});

test('grade de horários, agenda em cards e mover sessão', async () => {
  // Gera a grade da noite em todos os dias (sempre há horário livre à frente nesta semana ou na próxima)
  await page.goto('/agenda/horarios');
  await page.getByLabel('Nome da sala').fill('Sala Fictícia');
  for (const d of ['Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('tab', { name: 'Noite' }).click();
  await expect(page.getByText(/horários de 50 min/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar e gerar grade' }).click();
  await expect(page.getByText(/Grade gerada/)).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('Carlos Silva').first()).toBeVisible(); // nome e último sobrenome
  await page.screenshot({ path: `${SHOTS}/10-agenda-cards-celular.png`, fullPage: true });
  // Horário livre: linha verde "LIVRE"; tocar abre o agendamento já com dia e horário
  const livre = page.getByRole('button', { name: /^Horário livre às/ }).first();
  if (await livre.count() === 0) await page.getByRole('button', { name: 'Próxima semana' }).click();
  await page.getByRole('button', { name: /^Horário livre às/ }).first().click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Cadastrar paciente' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Voltar' }).click();
  // Semana | Dia: Dia mostra só o dia escolhido, com os 7 dias para trocar
  await page.goto('/');
  await page.getByRole('tab', { name: 'Dia' }).click();
  await expect(page.getByRole('button', { name: 'Próximo dia' })).toBeVisible();
  await expect(page.getByLabel('Dias da semana').getByRole('button')).toHaveCount(7);
  await page.getByRole('tab', { name: 'Semana' }).click();
  await expect(page.getByRole('button', { name: 'Próxima semana' })).toBeVisible();
  // Mover em 2 etapas: 1) horário livre por dia da semana e sala 2) modalidade + data de início (ocupadas não escolhem)
  await page.getByRole('button', { name: /^Mover / }).first().click();
  const mv = page.getByRole('dialog');
  await expect(mv.getByText('Toque no novo horário')).toBeVisible();
  await mv.getByRole('button', { name: / às \d\d:\d\d, / }).first().click();
  await mv.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(mv.getByRole('radiogroup', { name: 'Modalidade' })).toBeVisible();
  await expect(mv.getByRole('radiogroup', { name: 'Data de início' }).getByRole('radio', { checked: true })).toHaveCount(1);
  await mv.getByRole('button', { name: 'Outro horário' }).click();
  await mv.getByRole('button', { name: 'Voltar' }).click();
});

test('ajuda: botão ?, passeio opcional (uma vez) e página de tutoriais', async () => {
  await page.goto('/');
  // Sininho de avisos no cabeçalho abre a janela dos avisos do dia
  await page.getByRole('button', { name: /^Avisos de hoje/ }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /^Hoje · / })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /^Ajuda:/ }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Ajuda · Agenda' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();
  // Oferta do passeio aparece uma vez; Pular fecha e não volta
  await page.getByRole('button', { name: 'Fazer o passeio' }).click();
  await expect(page.getByText(/Passo 1 de \d/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/12-passeio.png` });
  await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.getByText(/Passo 2 de \d/)).toBeVisible();
  await page.getByRole('button', { name: 'Pular' }).click();
  await expect(page.getByText(/Passo \d de \d/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Fazer o passeio' })).toHaveCount(0);
  // Mais → Ajuda e tutoriais, com busca
  await page.goto('/mais');
  await page.getByRole('link', { name: 'Ajuda e tutoriais' }).click();
  await page.getByLabel('Buscar na ajuda').fill('evolução');
  await expect(page.getByText(/resultado/)).toBeVisible();
});

test('responsividade: 320 px sem quebra de duração e zoom de 200% sem sobreposição', async () => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const quebras = await page.evaluate(() => [...document.querySelectorAll('span')].filter((e) => /^\d+\s?min$/.test(e.textContent?.trim() ?? '') && e.getBoundingClientRect().height > parseFloat(getComputedStyle(e).lineHeight) * 1.5).length);
  expect(quebras, 'duração quebrando linha em 320 px').toBe(0);
  // 200% de zoom em celular de 360 px = 180 px úteis
  await page.setViewportSize({ width: 180, height: 400 });
  for (const path of ['/', '/agenda/horarios', '/pacientes', '/prontuario', '/financeiro', '/notas-fiscais', '/configuracoes', '/mais', '/resumo', '/ajuda']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `rolagem horizontal com zoom em ${path}`).toBeLessThanOrEqual(1);
    const sobrepostos = await page.evaluate(() => {
      const r = [...document.querySelectorAll('nav[aria-label="Principal"] a span:last-child')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 1 && b.height > 1);
      return r.some((a, i) => r.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
    });
    expect(sobrepostos, `rótulos da barra inferior sobrepostos em ${path}`).toBe(false);
  }
  await page.setViewportSize({ width: 412, height: 915 });
});

test('sem rolagem horizontal nas telas principais (celular)', async () => {
  for (const path of ['/', '/agenda/horarios', '/pacientes', patientUrl, '/prontuario', '/financeiro', '/notas-fiscais', '/configuracoes']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(1);
  }
});
