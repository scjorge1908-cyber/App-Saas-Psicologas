/**
 * Fluxos principais, em tela de celular, com dados fictícios.
 * Executa contra o app real + gateway local + Postgres com as migrations reais.
 */
import { expect, test, type Page } from '@playwright/test';
import { completarPerfil } from './perfil';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

/** O app abre no Resumo do dia; a agenda fica no rodapé (link "Agenda"). */
async function irParaAgenda(p: Page) {
  await p.goto('/');
  await p.waitForURL(/\/resumo$/);
  await p.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Agenda', exact: true }).click();
  await p.waitForURL(/\/$/);
}

/** Paciente novo nasce pelo agendamento (27/10): cadastra pelo Encaixe do Resumo do dia. */
async function novoPacienteNoEncaixe(p: Page, o: { nome: string; celular: string; data: string; hora: string; freq: 'nao' | 'semanal' | 'quinzenal'; n?: number; valor?: string }) {
  await p.goto('/resumo');
  await p.getByRole('button', { name: 'Encaixe', exact: true }).click();
  const d = p.getByRole('dialog');
  await d.getByRole('tab', { name: 'Paciente novo' }).click();
  await d.getByRole('textbox', { name: 'Nome completo', exact: true }).fill(o.nome);
  await d.getByLabel('Celular (WhatsApp)').fill(o.celular);
  await d.getByLabel('Data').fill(o.data);
  await d.getByLabel('Horário').fill(o.hora);
  if (o.valor) await d.getByLabel('Valor sessão').fill(o.valor);
  await d.getByLabel('Modalidade').selectOption(o.freq);
  if (o.n) await d.getByLabel('Número de sessões').fill(String(o.n));
  return d;
}

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
  // Perfil profissional obrigatório: sem ele completo o app fica em Configurações
  await page.goto('/resumo');
  await completarPerfil(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/(resumo)?$/); // entra no app (tela inicial = Resumo do dia; a agenda fica no rodapé)
}

test.describe.configure({ mode: 'serial' });

let page: Page;
let patientUrl = '';
let backupPath = '';

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  // A janela de avisos abre sozinha ao abrir o app quando há pendências; nos fluxos ela é testada à parte (sininho)
  await page.addInitScript(() => { try { sessionStorage.setItem('psi.avisos.mostrados', '1'); sessionStorage.setItem('psi.pendencias.mostradas', '1'); } catch { /* sem armazenamento */ } });
});

test('cadastro, perfil e tela inicial', async () => {
  await signup(page, 'Ana Fictícia Teste', `ana.e2e.${RUN}@exemplo.invalid`, '12/345678');
  // O app abre no Resumo do dia; sem grade, a agenda convida a criar os horários e mostra os primeiros passos
  await page.goto('/resumo');
  await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Voltar ao Resumo' })).toBeVisible();
  await expect(page.getByText('Monte sua grade de horários')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Primeiros passos' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-agenda-vazia.png`, fullPage: true });
  // Configurações: sem o cartão "Agenda e atendimento"; trocar a senha pede a senha atual; "Esqueci a senha" manda o link
  await page.goto('/configuracoes');
  await expect(page.getByText('Agenda e atendimento')).toHaveCount(0);
  await page.getByText('Segurança', { exact: true }).click();
  const campo = (name: string) => page.getByRole('textbox', { name, exact: true });
  await campo('Senha atual').fill('Senha-Errada-2026');
  await campo('Nova senha').fill('Senha-Nova-Ficticia-2026');
  await campo('Repita a nova senha').fill('Senha-Nova-Ficticia-2026');
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page.getByText(/Senha atual incorreta/)).toBeVisible();
  await page.getByRole('button', { name: /Esqueci a senha/ }).click();
  await expect(page.getByText(/um link para criar uma nova senha/)).toBeVisible();
  await campo('Senha atual').fill('Senha-Ficticia-2026');
  await page.getByRole('button', { name: 'Alterar senha' }).click();
  await expect(page.getByText('Senha alterada')).toBeVisible();
});

test('cadastro de paciente com validação (o paciente nasce pelo agendamento)', async () => {
  // Não existe mais cadastro solto em Pacientes
  await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Pacientes' }).click();
  await expect(page.getByRole('button', { name: 'Novo paciente' })).toHaveCount(0);
  const dlg = await novoPacienteNoEncaixe(page, { nome: 'Carlos Fictício da Silva', celular: '(48) 99999-0001', data: tzDate(30), hora: '09:00', freq: 'nao', valor: '150,00' });
  await dlg.getByLabel('CPF', { exact: true }).fill('123.456.789-00');
  await dlg.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dlg.getByRole('alert')).toContainText('CPF inválido');
  await dlg.getByLabel('CPF', { exact: true }).fill('123.456.789-09');
  await page.screenshot({ path: `${SHOTS}/02-novo-paciente.png` });
  await dlg.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(dlg.getByRole('heading', { name: 'Paciente cadastrado' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Concluir' }).click();
  await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Pacientes' }).click();
  await page.getByText('Carlos Fictício da Silva').click();
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
  // Pendências de registro: saíram do Resumo e ficam na Agenda (janela + botão com o número)
  await page.goto('/resumo');
  await expect(page.getByText('Aguardando registro')).toHaveCount(0);
  await irParaAgenda(page);
  const pending = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Aguardando registro' }) });
  if (!(await pending.isVisible())) await page.getByRole('button', { name: /^Pendências de registro: \d+/ }).click();
  await expect(pending.getByText('Carlos Fictício da Silva')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-hoje-pendencias.png`, fullPage: true });
  await pending.getByRole('button', { name: 'Atendida' }).click();
  await expect(page.getByText('Sessão registrada como atendida')).toBeVisible();
  await expect(pending.getByText('Nenhuma pendência de registro.')).toBeVisible();
  await pending.getByRole('button', { name: 'Fechar' }).last().click();
  await expect(page.getByRole('button', { name: 'Pendências de registro: nenhuma' })).toBeVisible();

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
  await page.locator('#conteudo').getByRole('link', { name: 'Configurações' }).click();
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
  // Bolinha "i" dos dias: orientação de como ativar a sala (vários dias, turno, Aplicar)
  await page.getByRole('button', { name: 'Como ativar a sala nos dias' }).click();
  await expect(page.getByText(/pode marcar/)).toBeVisible();
  await page.getByRole('button', { name: 'Como ativar a sala nos dias' }).click();
  await page.mouse.move(0, 0);
  await expect(page.getByText(/pode marcar/)).toHaveCount(0);
  // A grade vai das 07:00 às 23:00
  await expect(page.getByText(/Pode criar manhã, tarde e noite/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Sobre o turno de atendimento' }).click();
  await expect(page.getByText(/Pode criar manhã, tarde e noite/)).toBeVisible();
  await page.getByLabel('Início do turno').fill('06:00');
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByText('A grade vai das 07:00 às 23:00. Ajuste o início e o término dentro desse horário.')).toBeVisible();
  await page.getByRole('tab', { name: 'Noite' }).click();
  await expect(page.getByText(/horários de 50 min/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Resumo da pré-visualização' }).click();
  await expect(page.getByText(/horários de 50 min/)).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByText(/Grade gerada/)).toBeVisible();
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Consultório criado com sucesso!' }) }).getByRole('button', { name: 'OK' }).click();
  // Grade atual: lápis e lixeira em cada horário (muda/exclui só aquele horário)
  await page.getByRole('button', { name: /^Excluir o horário das 19:00 de / }).first().click();
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Excluir o horário das 19:00?' }) }).getByRole('button', { name: 'Excluir horário' }).click();
  await expect(page.getByText('Horário das 19:00 excluído')).toBeVisible();
  await page.getByRole('button', { name: /^Mudar o horário das 21:00 de / }).first().click();
  const mh = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Mudar o horário das 21:00' }) });
  await mh.getByLabel('Novo horário').fill('21:05');
  await mh.getByRole('button', { name: 'Salvar horário' }).click();
  await expect(page.getByText('Horário mudado de 21:00 para 21:05')).toBeVisible();

  await irParaAgenda(page);
  await expect(page.getByText('Carlos Silva').first()).toBeVisible(); // nome e último sobrenome
  await page.screenshot({ path: `${SHOTS}/10-agenda-cards-celular.png`, fullPage: true });
  // Horário livre: linha verde "LIVRE"; tocar abre o agendamento já com dia e horário
  const livre = page.getByRole('button', { name: /^Horário livre às/ }).first();
  if (await livre.count() === 0) await page.getByRole('button', { name: 'Próxima semana' }).click();
  await page.getByRole('button', { name: /^Horário livre às/ }).first().click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Cadastrar paciente' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('group', { name: 'Nota fiscal' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Voltar' }).click();
  // Semana | Dia: Dia mostra só o dia escolhido, com os 7 dias para trocar
  await irParaAgenda(page);
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
  // WhatsApp: cartão com mensagens prontas (aviso de que não vai atender) e atalho para mover
  await page.getByRole('button', { name: /^Enviar WhatsApp para / }).first().click();
  const wz = page.getByRole('dialog');
  await expect(wz.getByRole('button', { name: /Mover a sessão/ })).toBeVisible();
  // Os 3 modelos de texto aparecem sempre
  await expect(wz.getByRole('button', { name: /Confirmar presença/ })).toBeVisible();
  await expect(wz.getByRole('button', { name: /Mensagem livre/ })).toBeVisible();
  await wz.getByRole('button', { name: /Avisar que não vou atender/ }).click();
  await expect(wz.getByRole('textbox')).toHaveValue(/não vou poder atender/);
  await expect(wz.getByRole('button', { name: 'Abrir no WhatsApp' })).toBeVisible();
  await wz.getByRole('button', { name: 'Voltar' }).click();
  await wz.getByRole('button', { name: 'Fechar' }).first().click();
  // Turno com paciente não muda nem sai inteiro: pede nova sala (Mover) ou alta
  // Na mesma sala dá para criar outro turno (manhã) além da noite; o do Carlos (9h/10h) fica com paciente
  await page.goto('/agenda/horarios');
  for (const d of ['Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('tab', { name: 'Manhã' }).click();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByText(/Grade gerada: 7 dias/)).toBeVisible();
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Consultório criado com sucesso!' }) }).getByRole('button', { name: 'OK' }).click();
  // No cartão do dia: "+ Tarde" abre o Turno de atendimento já com o dia e a sala; Aplicar cria e mostra o popup
  await page.getByRole('button', { name: /^Criar tarde na / }).first().click();
  const nt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Criar tarde · / }) });
  await expect(nt.getByLabel('Início do turno')).toHaveValue('13:00');
  await nt.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByRole('heading', { name: 'Consultório criado com sucesso!' })).toBeVisible();
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Consultório criado com sucesso!' }) }).getByRole('button', { name: 'OK' }).click();
  const comPaciente = page.getByText(/^\d+ pacientes?$/).first();
  await expect(comPaciente).toBeVisible();
  await comPaciente.locator('xpath=..').getByRole('button', { name: 'Ajustar horário' }).click();
  const tv = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Este turno tem \d+ pacientes?$/ }) });
  await expect(tv.getByRole('button', { name: 'Criar nova sala' })).toBeVisible();
  await expect(tv.getByRole('button', { name: 'Dar alta' })).toBeVisible();
  await tv.getByRole('button', { name: 'Voltar' }).click();
});

test('sessão registrada (atendida ou falta) sai da agenda e fica no histórico do paciente', async () => {
  await irParaAgenda(page);
  // A sessão passada do Carlos foi registrada como atendida no teste do financeiro: não aparece mais como linha da agenda
  await expect(page.getByRole('button', { name: /, Atendida\. Abrir detalhes$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /, Falta\. Abrir detalhes$/ })).toHaveCount(0);
  await page.goto(patientUrl);
  await expect(page.getByText(/1 atendidas, 0 faltas no histórico/)).toBeVisible();
});

test('cartão Nota fiscal: obrigatórios e dados de quem paga', async () => {
  // CEP que demora a responder (como no GitHub): o que foi digitado durante a busca não pode ser apagado
  await page.route('https://viacep.com.br/**', async (r) => {
    await new Promise((ok) => setTimeout(ok, 1500));
    await r.fulfill({ json: { logradouro: 'Rua Najla Carone Guedert', bairro: 'Pagani', localidade: 'Palhoça', uf: 'SC' } });
  });
  await page.goto(patientUrl);
  await page.getByRole('button', { name: 'Editar cadastro' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Emitir nota fiscal para este paciente').check();
  await expect(dlg.getByText(/Para emitir a nota, falta: .*e-mail do paciente/)).toBeVisible();
  await dlg.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Nota fiscal: falta');
  await dlg.getByRole('radio', { name: /^Outra pessoa/ }).click();
  await dlg.getByLabel('Nome completo de quem paga').fill('Maria Fictícia da Silva');
  await dlg.getByLabel('CPF de quem paga').fill('529.982.247-25');
  await dlg.getByRole('button', { name: /Repetir celular, e-mail e endereço/ }).click();
  await expect(dlg.getByLabel('Celular', { exact: true })).toHaveValue(/9999\D?0001$/);
  await dlg.getByLabel('E-mail (recebe a nota)').fill('maria@exemplo.invalid');
  const cepPronto = page.waitForResponse(/viacep\.com\.br/);
  await dlg.getByRole('textbox', { name: 'CEP', exact: true }).last().fill('88132150');
  await dlg.getByRole('textbox', { name: 'Rua', exact: true }).last().fill('Rua Fictícia');
  await dlg.getByRole('textbox', { name: 'Número', exact: true }).last().fill('10');
  await dlg.getByRole('textbox', { name: 'Bairro', exact: true }).last().fill('Centro');
  await dlg.getByRole('textbox', { name: 'Cidade', exact: true }).last().fill('Palhoça');
  await dlg.getByRole('textbox', { name: 'UF', exact: true }).last().fill('SC');
  await cepPronto;
  await expect(dlg.getByRole('textbox', { name: 'Rua', exact: true }).last()).toHaveValue('Rua Fictícia');
  await expect(dlg.getByRole('textbox', { name: 'Número', exact: true }).last()).toHaveValue('10');
  await expect(dlg.getByText('Dados completos para a nota fiscal (PF).')).toBeVisible();
  await dlg.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText(/PF, no nome de Maria Fictícia da Silva, maria@exemplo\.invalid, Palhoça\/SC/)).toBeVisible();

  // Empresa (PJ): razão social e CNPJ válidos
  await page.getByRole('button', { name: 'Editar cadastro' }).click();
  await dlg.getByRole('radio', { name: /^Empresa/ }).click();
  // CNPJ digitado → razão social automática (BrasilAPI simulada)
  await page.route('https://brasilapi.com.br/**', (r) => r.fulfill({ json: { razao_social: 'Empresa Fictícia Ltda', nome_fantasia: 'Fictícia' } }));
  await dlg.getByLabel('CNPJ').fill('11.222.333/0001-82');
  await expect(dlg.getByText(/falta: .*CNPJ válido/i)).toBeVisible();
  await expect(dlg.getByText('CNPJ inválido. Confira os números.')).toBeVisible();
  await dlg.getByLabel('CNPJ').fill('11.222.333/0001-81');
  await expect(dlg.getByLabel('Razão social')).toHaveValue('Empresa Fictícia Ltda');
  await expect(dlg.getByText(/Nome da empresa preenchido pelo CNPJ/)).toBeVisible();
  await expect(dlg.getByText('Dados completos para a nota fiscal (PJ).')).toBeVisible();
  await dlg.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText(/PJ, no nome de Empresa Fictícia Ltda/)).toBeVisible();
  await expect(page.getByText(/CNPJ 11\.222\.333\/0001-81/)).toBeVisible();
});

test('ajuda: botão ?, passeio opcional (uma vez) e página de tutoriais', async () => {
  await irParaAgenda(page);
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
  await irParaAgenda(page);
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

test('Resumo: Confirmar agenda com sessões de hoje ou amanhã e WhatsApp', async () => {
  await page.goto('/resumo');
  await expect(page.getByRole('heading', { name: 'Sessões de hoje' })).toHaveCount(0); // a lista saiu do Resumo
  await page.getByRole('button', { name: 'Confirmar agenda' }).click();
  const dlg = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Confirmar agenda' }) });
  await expect(dlg.getByRole('tab', { name: 'Hoje' })).toHaveAttribute('aria-selected', 'true');
  await dlg.getByRole('tab', { name: 'Amanhã' }).click();
  await expect(dlg.getByRole('tab', { name: 'Amanhã' })).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.getByText('Agendada', { exact: true })).toHaveCount(0); // situação: Confirmado / Aguardando confirmação / Falta enviar link
  await expect(dlg.getByRole('button', { name: 'Falta ou outro' })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Fechar' }).last().click();
});

test('encaixe no Resumo com regra de horário e Dar alta leva o paciente para Inativos', async () => {
  // Encaixe: fica no Resumo do dia e respeita o horário de atendimento do perfil
  await page.goto('/resumo');
  await page.getByRole('button', { name: 'Encaixe', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: 'Encaixe fora da grade' })).toBeVisible();
  await dlg.getByRole('combobox', { name: 'Paciente' }).selectOption({ index: 1 });
  await dlg.getByLabel('Data').fill(tzDate(3));
  await dlg.getByLabel('Horário').fill('23:30');
  await dlg.getByLabel('Modalidade').selectOption('nao');
  await dlg.getByRole('button', { name: 'Agendar' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Encaixe só dentro do seu horário de atendimento');
  await dlg.getByRole('button', { name: 'Voltar' }).click();

  // Dar alta: sai da agenda e vai para Inativos (histórico continua)
  await irParaAgenda(page);
  await page.getByRole('button', { name: 'Dar alta' }).click();
  const alta = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Dar alta', exact: true }) });
  await alta.getByRole('listitem').filter({ hasText: 'Carlos' }).getByRole('button', { name: 'Dar alta' }).click();
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Dar alta a / }) }).getByRole('button', { name: 'Dar alta' }).click();
  await expect(page.getByText(/foi para Inativos/)).toBeVisible();
  await alta.getByRole('button', { name: 'Fechar' }).last().click();
  await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Pacientes' }).click();
  await page.getByRole('tab', { name: /Inativos/ }).click();
  await expect(page.locator('#conteudo ul').getByText('Carlos Fictício da Silva')).toBeVisible();
});

test('paciente ativo sempre na agenda: "Começa dd/mm" e avulso sem próximo horário com alerta', async () => {
  // Começa só daqui a 5 semanas: já aparece hoje (mesmo dia da semana) com "Começa dd/mm"
  const inicio = tzDate(35);
  const ddmm = `${inicio.slice(8, 10)}/${inicio.slice(5, 7)}`;
  const d = await novoPacienteNoEncaixe(page, { nome: 'Fernanda Fictícia', celular: '(48) 97777-0000', data: inicio, hora: '10:00', freq: 'nao', valor: '150,00' });
  await d.getByRole('button', { name: 'Agendar', exact: true }).click();
  await d.getByRole('button', { name: 'Concluir' }).click();
  await irParaAgenda(page);
  await expect(page.getByText(`Começa ${ddmm}`).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/22-comeca-no-futuro.png`, fullPage: true });

  // Vira avulso sem próximo horário: sessão passada há 7 dias e a futura cancelada
  await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Pacientes' }).click();
  await page.getByText('Fernanda Fictícia').click();
  await page.getByRole('button', { name: 'Agendar' }).first().click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Data').fill(tzDate(-7));
  await a.getByLabel('Horário').fill('10:00');
  await a.getByLabel('Modalidade').selectOption('nao');
  await a.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(a).toBeHidden();
  await page.getByRole('button', { name: /Agendada/ }).first().click();
  const sh = page.getByRole('dialog');
  await sh.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await sh.getByRole('button', { name: 'Cancelar sessão' }).click();
  await expect(page.getByText('Sessão cancelada')).toBeVisible();

  await irParaAgenda(page);
  const linha = page.getByRole('button', { name: /Fernanda.*sem próximo horário: ajustar/ }).first();
  await expect(linha).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/23-sem-proximo-horario.png`, fullPage: true });
  await linha.click();
  const aj = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Ajustar paciente' }) });
  await expect(aj.getByRole('button', { name: 'Marcar novo horário' })).toBeVisible();
  await aj.getByRole('button', { name: 'Dar alta' }).click();
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /^Dar alta a / }) }).getByRole('button', { name: 'Dar alta' }).click();
  await expect(page.getByText(/Fernanda Fictícia foi para Inativos/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Fernanda.*sem próximo horário/ })).toHaveCount(0);
});

test('bloqueio de agenda: folga amanhã some com os horários livres e avisa a sessão marcada', async () => {
  const amanha = tzDate(1);
  const ddmm = `${amanha.slice(8, 10)}/${amanha.slice(5, 7)}`;
  await page.goto('/agenda/horarios');
  await expect(page.getByRole('heading', { name: 'Bloquear: férias, feriados, aniversário ou folgas' })).toBeVisible();
  await page.getByRole('button', { name: 'O que acontece nos dias bloqueados' }).click();
  await expect(page.getByText('Nos dias bloqueados a agenda não mostra horários livres e não deixa marcar sessão nova.')).toBeVisible();
  await page.getByRole('button', { name: 'Novo bloqueio' }).click();
  const dlg = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Novo bloqueio' }) });
  await dlg.getByLabel('Tipo').selectOption('folga');
  await dlg.getByLabel('Primeiro dia').fill(amanha);
  await dlg.getByLabel('Último dia').fill(amanha);
  await dlg.getByLabel('Motivo (opcional)').fill('Consulta médica');
  await dlg.getByRole('button', { name: 'Salvar bloqueio' }).click();
  await expect(page.getByText(/Bloqueio salvo/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Bloqueios' }).getByText('Folga · dia inteiro · Consulta médica')).toBeVisible();
  // Feriados nacionais em um toque
  await page.getByRole('button', { name: /^Feriados nacionais de \d{4}$/ }).last().click();
  await expect(page.getByText(/feriados? nacionais? adicionados?|já estão na agenda/)).toBeVisible();

  await irParaAgenda(page);
  const dia = page.locator('section').filter({ hasText: ddmm }).first();
  await expect(dia.getByText('Bloqueado · Folga · dia inteiro · Consulta médica')).toBeVisible();
  await expect(dia.getByRole('button', { name: /^Horário livre/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/24-bloqueio-folga.png`, fullPage: true });

  // Tira o bloqueio: os horários voltam
  await page.goto('/agenda/horarios');
  await page.getByRole('list', { name: 'Bloqueios' }).getByRole('listitem').filter({ hasText: 'Consulta médica' }).getByRole('button', { name: 'Tirar' }).click();
  await page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Tirar este bloqueio?' }) }).getByRole('button', { name: 'Tirar bloqueio' }).click();
  await expect(page.getByText('Bloqueio retirado')).toBeVisible();
});
