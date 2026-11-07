import { describe, expect, it } from 'vitest';
import { buscarCep, formatarCep } from './cep';

const resp = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe('CEP', () => {
  it('preenche rua, bairro, cidade e UF', async () => {
    const r = await buscarCep('88132-150', resp({ logradouro: 'Rua Fictícia', bairro: 'Pagani', localidade: 'Palhoça', uf: 'sc' }));
    expect(r).toEqual({ street: 'Rua Fictícia', neighborhood: 'Pagani', city: 'Palhoça', uf: 'SC' });
  });
  it('traz o código IBGE do município (NFS-e)', async () => {
    const r = await buscarCep('88132150', resp({ logradouro: 'Rua', bairro: 'B', localidade: 'Palhoça', uf: 'SC', ibge: '4211900' }));
    expect(r?.ibge).toBe('4211900');
    expect((await buscarCep('88132150', resp({ localidade: 'X', uf: 'SC', ibge: 'abc' })))?.ibge).toBeUndefined();
  });
  it('CEP inexistente, incompleto ou sem rede devolve vazio', async () => {
    expect(await buscarCep('00000000', resp({ erro: true }))).toBeNull();
    expect(await buscarCep('8813', resp({}))).toBeNull();
    expect(await buscarCep('88132150', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBeNull();
  });
  it('formata com traço', () => { expect(formatarCep('88132150')).toBe('88132-150'); });
});
