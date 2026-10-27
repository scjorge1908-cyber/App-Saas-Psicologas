import { describe, expect, it } from 'vitest';
import {
  avisoNascimento,
  addDays, ageOn, formatCnpj, formatCpf, isValidCnpj, formatDate, formatLongDate, formatPhone, isMinor, isValidCpf,
  money, normalizeCrp, parseMoney, startOfWeek, sumMoney, zonedParts, zonedToUtc,
} from './format';
import { chargeText, confirmationUrl, reminderText, whatsappLink } from './messages';

describe('dinheiro', () => {
  it('formata BRL', () => {
    expect(money(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50');
  });
  it('interpreta entradas brasileiras e internacionais', () => {
    expect(parseMoney('1.234,56')).toBe(1234.56);
    expect(parseMoney('150')).toBe(150);
    expect(parseMoney('R$ 99,9')).toBe(99.9);
    expect(parseMoney('12.50')).toBe(12.5);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1,234')).toBeNull();
  });
  it('soma sem erro de ponto flutuante', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([150, 100, 250.5])).toBe(500.5);
  });
});

describe('documentos', () => {
  it('valida CPF', () => {
    expect(isValidCpf('123.456.789-09')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('12345678900')).toBe(false);
    expect(formatCpf('12345678909')).toBe('123.456.789-09');
  });
  it('normaliza CRP', () => {
    expect(normalizeCrp('6/123456')).toBe('06/123456');
    expect(normalizeCrp('06-12345')).toBe('06/12345');
    expect(normalizeCrp('123')).toBeNull();
  });
  it('formata telefone', () => {
    expect(formatPhone('48998385204')).toBe('(48) 99838-5204');
    expect(formatPhone('4832221111')).toBe('(48) 3222-1111');
  });
});

describe('datas e fuso', () => {
  it('converte horário local de São Paulo para UTC', () => {
    expect(zonedToUtc('2026-10-12', '14:00', 'America/Sao_Paulo')).toBe('2026-10-12T17:00:00.000Z');
  });
  it('converte em fuso com horário de verão (Nova York)', () => {
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '09:00', 'America/New_York')).toBe('2026-12-01T14:00:00.000Z');
  });
  it('extrai partes no fuso', () => {
    expect(zonedParts('2026-10-12T02:30:00Z', 'America/Sao_Paulo')).toMatchObject({ date: '2026-10-11', time: '23:30' });
  });
  it('aritmética de datas', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12'); // domingo -> segunda anterior
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
    expect(formatDate('2026-10-12')).toBe('12/10/2026');
    expect(formatLongDate('2026-10-12')).toBe('segunda-feira, 12 de outubro');
  });
  it('idade e menoridade', () => {
    expect(ageOn('2010-10-13', '2026-10-12')).toBe(15);
    expect(ageOn('2008-10-12', '2026-10-12')).toBe(18);
    expect(isMinor('2008-10-13', '2026-10-12')).toBe(true);
    expect(isMinor(null, '2026-10-12')).toBe(false);
  });
});

describe('mensagens', () => {
  it('monta link wa.me com DDI 55 e texto codificado', () => {
    expect(whatsappLink('(48) 99838-5204', 'Olá & até')).toBe('https://wa.me/5548998385204?text=Ol%C3%A1%20%26%20at%C3%A9');
    expect(whatsappLink('', 'x')).toBeNull();
  });
  it('lembrete com link de confirmação', () => {
    const t = reminderText({
      patientName: 'Carlos Souza', startsAt: '2026-10-14T17:00:00Z', tz: 'America/Sao_Paulo',
      professionalName: 'Ana Fictícia — CRP 06/123456', link: confirmationUrl('https://app.exemplo/', 'abc'), modality: 'presencial',
    });
    expect(t).toContain('Olá, Carlos!');
    expect(t).toContain('quarta-feira, 14 de outubro, às 14:00');
    expect(t).toContain('https://app.exemplo/c/abc');
  });
  it('mensagem de cobrança não expõe dados clínicos', () => {
    const t = chargeText({ patientName: 'Carlos', amount: 150, description: 'Sessão de 01/10/2026 14:00', professionalName: 'Ana' });
    expect(t).toContain('150,00');
  });
});

describe('aviso de data de nascimento', () => {
  it('avisa idade 0, 1, acima de 110 e data no futuro; não avisa idades normais', () => {
    expect(avisoNascimento('2026-03-01', '2026-10-27')).toContain('0 anos');
    expect(avisoNascimento('2025-05-01', '2026-10-27')).toContain('1 ano.');
    expect(avisoNascimento('1900-01-01', '2026-10-27')).toContain('126 anos');
    expect(avisoNascimento('2027-01-01', '2026-10-27')).toContain('futuro');
    expect(avisoNascimento('2023-01-01', '2026-10-27')).toBeNull();
    expect(avisoNascimento('1985-02-08', '2026-10-27')).toBeNull();
    expect(avisoNascimento(null, '2026-10-27')).toBeNull();
  });
});

describe('CNPJ', () => {
  it('valida pelos dígitos verificadores e formata', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
  });
});
