import { expect, test } from '@playwright/test';

const RUN = Date.now().toString(36);
const SHOTS = '../docs/evidencias/telas';
const tzDate = (o: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + o * 86400e3));

test('desktop: agenda semanal em grade e ficha do paciente', async ({ page }) => {
  await page.goto('/cadastro');
  await page.getByLabel('Nome completo').fill('Dora Fictícia Desktop');
  await page.getByLabel('E-mail').fill(`dora.${RUN}@exemplo.invalid`);
  await page.getByRole('textbox', { name: 'Senha', exact: true }).fill('Senha-Ficticia-2026');
  await page.getByLabel('Repita a senha').fill('Senha-Ficticia-2026');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByLabel('CRP').fill('12/999999');
  await page.getByRole('button', { name: 'Começar a usar' }).click();
  await expect(page.getByRole('heading', { name: 'Hoje', exact: true })).toBeVisible();

  for (const [name, time, freq] of [['Helena Fictícia', '09:00', 'semanal'], ['Rafael Fictício', '11:00', 'quinzenal'], ['Júlia Fictícia', '16:30', 'semanal']] as const) {
    await page.goto('/pacientes');
    await page.getByRole('button', { name: 'Novo paciente' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Nome completo').fill(name);
    await d.getByLabel('Valor da sessão (R$)').fill('180,00');
    await d.getByRole('button', { name: 'Cadastrar paciente' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await page.getByRole('button', { name: 'Agendar' }).click();
    const a = page.getByRole('dialog');
    await a.getByLabel('Data').fill(tzDate(0));
    await a.getByLabel('Horário').fill(time);
    await a.getByLabel('Repetir').selectOption(freq);
    await a.getByLabel('Número de sessões').fill('6');
    await a.getByRole('button', { name: /Agendar 6 sessões/ }).click();
    await expect(a).toBeHidden();
  }
  await page.goto('/agenda?v=semana');
  await expect(page.getByText('Helena Fictícia').filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/20-desktop-agenda-semana.png` });
  await page.goto('/');
  await page.screenshot({ path: `${SHOTS}/21-desktop-hoje.png`, fullPage: true });
  await page.goto('/agenda?v=mes');
  await page.screenshot({ path: `${SHOTS}/22-desktop-agenda-mes.png` });
});
