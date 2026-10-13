// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { DocumentType } from '../types';
import { buildSpec, renderDocumentPdf, sanitize, sha256Hex } from './documents';

const pro = { full_name: 'Ana Fictícia de Souza', crp: '12/345678', cpf: '12345678909', city: 'Palhoça', uf: 'SC', phone: '(48) 99999-0000' };
const patient = { name: 'Carlos Fictício', cpf: '98765432100' };
const OUT = join(__dirname, '../../../test-results/pdf');
mkdirSync(OUT, { recursive: true });

function text(bytes: Uint8Array, name: string): string {
  const f = join(OUT, `${name}.pdf`);
  writeFileSync(f, bytes);
  return execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
}

describe('PDF de documentos psicológicos', () => {
  const fields: Record<DocumentType, Record<string, string>> = {
    declaracao: { finalidade: 'comprovação junto ao empregador', acompanhamento: 'está em acompanhamento psicológico', dias_horarios: 'às quartas-feiras, das 14h às 14h50', duracao: 'desde março de 2026', sigilo: 'sim' },
    atestado: { solicitante: 'o próprio paciente', finalidade: 'apresentação escolar', condicoes: 'apresenta condições psicológicas para...', validade: '30 dias' },
    relatorio: { solicitante: 'Escola Fictícia', finalidade: 'acompanhamento escolar', demanda: 'Demanda fictícia.', procedimento: '10 sessões.', analise: 'Análise fictícia.', conclusao: 'Conclusão fictícia.', validade: '90 dias' },
    laudo: { solicitante: 'Juízo fictício', finalidade: 'avaliação', demanda: 'x', procedimento: 'y', analise: 'z', conclusao: 'w', referencias: 'Referência fictícia (2020).' },
    parecer: { solicitante: 'Fictício', finalidade: 'Questão técnica', demanda: 'a', analise: 'b', conclusao: 'c', referencias: 'd' },
    recibo: { valor: '150', descricao: 'sessão de psicoterapia', data_pagamento: '2026-10-10', pagador_nome: 'Maria Responsável', pagador_cpf: '11144477735' },
    contrato: { valor: '180', frequencia: 'semanal', foro: 'Palhoça/SC' },
  };

  for (const type of Object.keys(fields) as DocumentType[]) {
    it(`gera ${type} válido, com autora, CRP e data`, async () => {
      const bytes = await renderDocumentPdf(buildSpec(type, fields[type], patient, pro, '2026-10-12'), pro);
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
      const t = text(bytes, type);
      expect(t).toContain('Ana Fictícia de Souza');
      expect(t).toContain('CRP 12/345678');
      expect(t).toContain('12 de outubro de 2026');
      expect(t).toMatch(/Página 1 de \d/);
    });
  }

  it('declaração não tem campo de sintomas e inclui finalidade e cláusula de sigilo', async () => {
    const t = text(await renderDocumentPdf(buildSpec('declaracao', fields.declaracao, patient, pro, '2026-10-12'), pro), 'decl2');
    expect(t).toContain('comprovação junto ao empregador');
    expect(t).toMatch(/caráter sigiloso/);
  });

  it('relatório tem os 5 itens obrigatórios; laudo inclui referências', async () => {
    const r = text(await renderDocumentPdf(buildSpec('relatorio', fields.relatorio, patient, pro, '2026-10-12'), pro), 'rel2');
    for (const h of ['Identificação', 'Descrição da demanda', 'Procedimento', 'Análise', 'Conclusão']) expect(r).toContain(h);
    expect(r).toContain('Prazo de validade deste documento: 90 dias');
    const l = text(await renderDocumentPdf(buildSpec('laudo', fields.laudo, patient, pro, '2026-10-12'), pro), 'laudo2');
    expect(l).toContain('Referências');
  });

  it('recibo traz pagador, CPF, valor e beneficiário', async () => {
    const t = text(await renderDocumentPdf(buildSpec('recibo', fields.recibo, patient, pro, '2026-10-12'), pro), 'rec2');
    expect(t).toContain('Maria Responsável');
    expect(t).toContain('111.444.777-35');
    expect(t).toMatch(/R\$\s150,00/);
    expect(t).toContain('prestado a Carlos Fictício');
    expect(t).toContain('Receita Saúde');
  });

  it('documento longo: várias páginas numeradas e rubrica até a penúltima', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Parágrafo fictício número ${i + 1} com texto suficiente para ocupar uma linha inteira do documento.`).join('\n');
    const bytes = await renderDocumentPdf(buildSpec('relatorio', { ...fields.relatorio, analise: long }, patient, pro, '2026-10-12'), pro);
    const doc = await PDFDocument.load(bytes);
    const n = doc.getPageCount();
    expect(n).toBeGreaterThan(2);
    const t = text(bytes, 'longo');
    expect(t).toContain(`Página ${n} de ${n}`);
    expect((t.match(/Rubrica:/g) ?? []).length).toBe(n - 1);
    expect(t).toContain('Parágrafo fictício número 120');
  });

  it('substitui caracteres fora do WinAnsi sem quebrar', async () => {
    expect(sanitize('Olá 😀 ção')).toBe('Olá ? ção');
    const bytes = await renderDocumentPdf(buildSpec('declaracao', { ...fields.declaracao, finalidade: 'teste 😀 →' }, patient, pro, '2026-10-12'), pro);
    expect(bytes.length).toBeGreaterThan(500);
  });

  it('hash SHA-256 é estável', async () => {
    const h = await sha256Hex(new TextEncoder().encode('abc'));
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
