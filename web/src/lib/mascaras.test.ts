import { describe, expect, it } from 'vitest';
import { dataBrParaIso, isoParaDataBr, mascararCpf, mascararData, mascararTelefone } from './mascaras';

describe('máscaras de digitação', () => {
  it('telefone celular e fixo', () => {
    expect(mascararTelefone('4')).toBe('(4');
    expect(mascararTelefone('48999')).toBe('(48) 999');
    expect(mascararTelefone('4833334444')).toBe('(48) 3333-4444');
    expect(mascararTelefone('48999990001')).toBe('(48) 99999-0001');
    expect(mascararTelefone('(48) 99999-00012345')).toBe('(48) 99999-0001');
  });
  it('CPF', () => {
    expect(mascararCpf('123')).toBe('123');
    expect(mascararCpf('1234567')).toBe('123.456.7');
    expect(mascararCpf('12345678909')).toBe('123.456.789-09');
  });
  it('data dd/mm/aaaa', () => {
    expect(mascararData('2503')).toBe('25/03');
    expect(mascararData('25031990')).toBe('25/03/1990');
    expect(dataBrParaIso('25/03/1990')).toBe('1990-03-25');
    expect(dataBrParaIso('31/02/1990')).toBeNull();
    expect(dataBrParaIso('25/03/19')).toBeNull();
    expect(isoParaDataBr('1990-03-25')).toBe('25/03/1990');
  });
});
