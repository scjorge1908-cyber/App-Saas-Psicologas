import { expect, test, type Page } from '@playwright/test';

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
const tzDate = (o: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + o * 86400e3));

test('desktop: agenda semanal em grade e ficha do paciente', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('psi.avisos.mostrados', '1'); sessionStorage.setItem('psi.pendencias.mostradas', '1'); } catch { /* sem armazenamento */ } });
  await page.goto('/cadastro');
  await page.getByLabel('Nome completo').fill('Dora Fictícia Desktop');
  await page.getByLabel('E-mail').fill(`dora.${RUN}@exemplo.invalid`);
  await page.getByRole('textbox', { name: 'Senha', exact: true }).fill('Senha-Ficticia-2026');
  await page.getByLabel('Repita a senha').fill('Senha-Ficticia-2026');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByLabel('CRP').fill('12/999999');
  await page.getByRole('button', { name: 'Começar a usar' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda', exact: true })).toBeAttached();

  for (const [name, time, freq] of [['Helena Fictícia', '09:00', 'semanal'], ['Rafael Fictício', '11:00', 'quinzenal'], ['Júlia Fictícia', '16:30', 'semanal']] as const) {
    const a = await novoPacienteNoEncaixe(page, { nome: name, celular: '(48) 98888-0000', data: tzDate(1), hora: time, freq, n: 6, valor: '180,00' });
    await a.getByRole('button', { name: /Agendar 6 sessões/ }).click();
    await expect(a.getByRole('heading', { name: 'Paciente cadastrado' })).toBeVisible();
    await a.getByRole('button', { name: 'Concluir' }).click();
    await expect(a).toBeHidden();
  }
  await irParaAgenda(page);
  await expect(page.getByText('Helena Fictícia').filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/20-desktop-agenda.png`, fullPage: true });
  await page.goto('/resumo');
  await page.screenshot({ path: `${SHOTS}/21-desktop-resumo.png`, fullPage: true });
});
