// Perfil profissional obrigatório (28/10): depois do cadastro o app abre em Configurações até o perfil ficar completo.
import { expect, type Page } from '@playwright/test';

export async function completarPerfil(page: Page) {
  // CEP respondido na hora e sempre igual (no GitHub a busca sai para a internet)
  await page.route('https://viacep.com.br/**', (r) => r.fulfill({ json: { logradouro: 'Rua Fictícia', bairro: 'Centro', localidade: 'Palhoça', uf: 'SC' } }));
  await expect(page).toHaveURL(/\/configuracoes$/);
  await expect(page.getByText('Complete o seu perfil profissional para liberar o app.')).toBeVisible();
  const campo = (name: string) => page.getByRole('textbox', { name, exact: true }).first();
  await campo('CPF').fill('529.982.247-25');
  await campo('Telefone').fill('(48) 99999-0000');
  await campo('CEP').fill('88132150');
  await expect(campo('Rua')).toHaveValue('Rua Fictícia');
  await expect(campo('UF')).toHaveValue('SC');
  await campo('Número').fill('10');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Complete o seu perfil profissional para liberar o app.')).toHaveCount(0);
  await page.unroute('https://viacep.com.br/**');
}
