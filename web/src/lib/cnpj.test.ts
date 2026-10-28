import { describe, expect, it } from 'vitest';
import { buscarCnpj } from './cnpj';

const resposta = (status: number, corpo: unknown) => (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;

describe('consulta de CNPJ', () => {
  it('traz a razão social', async () => {
    expect(await buscarCnpj('11.222.333/0001-81', resposta(200, { razao_social: 'EMPRESA FICTICIA LTDA ', nome_fantasia: 'Fictícia' })))
      .toEqual({ razaoSocial: 'EMPRESA FICTICIA LTDA', nomeFantasia: 'Fictícia' });
  });
  it('CNPJ inválido nem consulta; não encontrado ou sem internet devolve vazio', async () => {
    let chamou = false;
    expect(await buscarCnpj('11.222.333/0001-82', (async () => { chamou = true; return new Response('{}'); }) as unknown as typeof fetch)).toBeNull();
    expect(chamou).toBe(false);
    expect(await buscarCnpj('11222333000181', resposta(404, { message: 'não encontrado' }))).toBeNull();
    expect(await buscarCnpj('11222333000181', (async () => { throw new Error('rede'); }) as unknown as typeof fetch)).toBeNull();
  });
});
