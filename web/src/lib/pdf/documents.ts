/**
 * Geração de documentos psicológicos em PDF, no próprio aparelho (pdf-lib).
 * Estrutura conforme Res. CFP 06/2019 (ver docs/CONFORMIDADE.md):
 *  - identificação da autora com nome e CRP;
 *  - páginas numeradas "Página X de Y";
 *  - campo de rubrica em todas as páginas, exceto a última;
 *  - local, data e assinatura na última página;
 *  - prazo de validade quando aplicável e cláusula opcional de sigilo.
 * A assinatura (gov.br ou ICP-Brasil) é aplicada FORA do sistema sobre o PDF.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { longDatePt, type DocumentSpec, type Professional } from './spec';

export * from './spec';

// pdf-lib com fontes padrão usa WinAnsi: substitui caracteres não suportados.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function sanitize(text: string): string {
  return Array.from(text.normalize('NFC'))
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (ch === '\n' || ch === '\t') return ch === '\t' ? '    ' : ch;
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) return ch;
      return '?';
    })
    .join('');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of sanitize(text).split('\n')) {
    if (para.trim() === '') { out.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= maxWidth) {
        line = tryLine;
      } else {
        if (line) out.push(line);
        // palavra maior que a linha: quebra forçada
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > maxWidth) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderDocumentPdf(spec: DocumentSpec, pro: Professional): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(sanitize(spec.title));
  pdf.setAuthor(sanitize(pro.full_name));
  pdf.setCreator('PsiConsultório');
  pdf.setProducer('PsiConsultório (pdf-lib)');
  pdf.setLanguage('pt-BR');
  pdf.setCreationDate(new Date(`${spec.issuedOn}T12:00:00Z`));

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.14, 0.19);
  const soft = rgb(0.35, 0.37, 0.42);

  const W = 595.28; const H = 841.89; // A4
  const M = 64; const maxW = W - 2 * M;
  const bodySize = 11.5; const lead = 17;
  const top = H - 72; const bottomLimit = 110;

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    // Cabeçalho: identificação da autora
    page.drawText(sanitize(pro.full_name), { x: M, y: H - 46, size: 11, font: bold, color: ink });
    const sub = [`Psicóloga${pro.crp ? ` - CRP ${pro.crp}` : ''}`, pro.phone, pro.contact_email].filter(Boolean).join('   ');
    page.drawText(sanitize(sub), { x: M, y: H - 60, size: 9, font: regular, color: soft });
    page.drawLine({ start: { x: M, y: H - 68 }, end: { x: W - M, y: H - 68 }, thickness: 0.6, color: soft });
    y = top - 18;
  };

  const ensure = (needed: number) => {
    if (y - needed < bottomLimit) newPage();
  };

  const drawLines = (lines: string[], font: PDFFont, size: number, opts: { center?: boolean } = {}) => {
    for (const l of lines) {
      ensure(lead);
      const x = opts.center ? (W - font.widthOfTextAtSize(l, size)) / 2 : M;
      if (l) page.drawText(l, { x, y, size, font, color: ink });
      y -= l ? lead : lead * 0.6;
    }
  };

  newPage();
  // Título
  const titleLines = wrap(spec.title.toUpperCase(), bold, 14, maxW);
  drawLines(titleLines, bold, 14, { center: true });
  y -= 10;

  for (const s of spec.sections) {
    if (s.heading) {
      ensure(lead * 3);
      y -= 4;
      drawLines(wrap(s.heading, bold, bodySize, maxW), bold, bodySize);
    }
    drawLines(wrap(s.text, regular, bodySize, maxW), regular, bodySize);
    y -= 8;
  }

  if (spec.validity) {
    drawLines(wrap(`Prazo de validade deste documento: ${spec.validity}.`, regular, bodySize, maxW), regular, bodySize);
    y -= 8;
  }
  if (spec.confidentialityClause) {
    const clause = 'Este documento não poderá ser utilizado para fins diferentes do apontado no item de identificação, '
      + 'possui caráter sigiloso, trata-se de documento extrajudicial e não se responsabiliza a psicóloga '
      + 'por seu uso indevido após a entrega.';
    drawLines(wrap(clause, regular, 10, maxW), regular, 10);
    y -= 8;
  }

  // Local, data e assinatura (última página)
  ensure(lead * 7);
  y -= lead;
  const place = [pro.city, pro.uf].filter(Boolean).join('/');
  drawLines([sanitize(`${place ? `${place}, ` : ''}${longDatePt(spec.issuedOn)}.`)], regular, bodySize);
  y -= lead * 2.2;
  page.drawLine({ start: { x: W / 2 - 130, y }, end: { x: W / 2 + 130, y }, thickness: 0.6, color: ink });
  y -= 14;
  drawLines([sanitize(pro.full_name)], bold, bodySize, { center: true });
  drawLines([sanitize(`Psicóloga${pro.crp ? ` - CRP ${pro.crp}` : ''}`)], regular, 10, { center: true });

  // Rodapé: numeração e rubrica
  const total = pages.length;
  pages.forEach((p, i) => {
    const label = `Página ${i + 1} de ${total}`;
    p.drawText(sanitize(label), { x: W - M - regular.widthOfTextAtSize(sanitize(label), 9), y: 40, size: 9, font: regular, color: soft });
    if (i < total - 1) {
      p.drawText('Rubrica: ______________________', { x: M, y: 40, size: 9, font: regular, color: soft });
    }
  });

  return pdf.save({ useObjectStreams: false });
}

export { sha256Hex } from '../hash';
