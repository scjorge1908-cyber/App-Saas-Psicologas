// Auditoria UX automatizada (somente leitura): larguras, zoom, alvos de toque, cortes e axe-core.
const { chromium } = require('playwright');
const fs = require('fs');
const AXE = fs.readFileSync(process.argv[3] + '/node_modules/axe-core/axe.min.js', 'utf8');
const OUT = process.argv[2];
const BASE = 'http://localhost:4190';
const AGORA = new Date('2026-10-27T09:00:00-03:00').getTime();
const PAGINAS = [['agenda', '/'], ['grade', '/agenda/horarios'], ['pacientes', '/pacientes'], ['paciente', 'PACIENTE'], ['prontuarios', '/prontuario'],
  ['financeiro', '/financeiro'], ['notas', '/notas-fiscais'], ['config', '/configuracoes'], ['mais', '/mais'], ['resumo', '/resumo']];
const TELAS = [['320', 320, 640, 1], ['360', 360, 760, 1], ['412', 412, 915, 1], ['768', 768, 1024, 1], ['1280', 1280, 800, 1], ['zoom200-360', 180, 380, 2]];

async function medir(p) {
  return p.evaluate(() => {
    const vw = window.innerWidth;
    const r = { overflowX: document.documentElement.scrollWidth - vw, cortados: [], foraDaTela: [], alvosPequenos: 0, alvosPequenosEx: [], duracaoQuebrada: 0, totalInterativos: 0 };
    const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    for (const e of document.querySelectorAll('button, a[href], input, select, textarea, [role=tab]')) {
      if (!vis(e) || e.closest('.sr-only')) continue;
      r.totalInterativos++;
      const b = e.getBoundingClientRect();
      const inline = e.tagName === 'A' && getComputedStyle(e).display === 'inline';
      if (!inline && (b.height < 44 || b.width < 44) && !['checkbox', 'radio'].includes(e.type)) { r.alvosPequenos++; if (r.alvosPequenosEx.length < 6) r.alvosPequenosEx.push(`${(e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 30)} ${Math.round(b.width)}x${Math.round(b.height)}`); }
      if (b.right > vw + 1 && !e.closest('[class*=overflow-x-auto]')) r.foraDaTela.push((e.innerText || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 40));
      if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') r.cortados.push((e.innerText || '').trim().slice(0, 40));
    }
    for (const e of document.querySelectorAll('span, p')) {
      if (/^\d+\s?min$/.test((e.innerText || '').trim()) && vis(e)) { const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; if (e.getBoundingClientRect().height > lh * 1.5) r.duracaoQuebrada++; }
    }
    r.foraDaTela = [...new Set(r.foraDaTela)].slice(0, 8); r.cortados = [...new Set(r.cortados)].filter(Boolean).slice(0, 8);
    return r;
  });
}

(async () => {
  const b = await chromium.launch();
  const resultado = {};
  for (const [nomeTela, w, h, dpr] of TELAS) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    await ctx.addInitScript((now) => { const D = Date; class F extends D { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } } globalThis.Date = F; }, AGORA);
    const p = await ctx.newPage();
    await p.goto(BASE + '/boas-vindas'); await p.waitForTimeout(600);
    resultado[`${nomeTela}/boas-vindas`] = await medir(p);
    if (['320', '360', '1280', 'zoom200-360'].includes(nomeTela)) await p.screenshot({ path: `${OUT}/${nomeTela}-boas-vindas.png`, fullPage: true });
    await p.getByText('Conhecer o app').click(); await p.waitForTimeout(1200);
    let pacienteUrl = null;
    for (const [nome, rota] of PAGINAS) {
      if (rota === 'PACIENTE') {
        if (!pacienteUrl) { await p.goto(BASE + '/pacientes'); await p.waitForTimeout(800); await p.getByText('Mariana Costa Fictícia').first().click(); await p.waitForTimeout(800); pacienteUrl = new URL(p.url()).pathname; }
        await p.goto(BASE + pacienteUrl + '?aba=prontuario');
      } else await p.goto(BASE + rota);
      await p.waitForTimeout(1000);
      const m = await medir(p);
      if (nomeTela === '360') {
        await p.addScriptTag({ content: AXE });
        const ax = await p.evaluate(async () => { const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }); return r.violations.map((v) => ({ id: v.id, impacto: v.impact, n: v.nodes.length, ex: v.nodes.slice(0, 2).map((n) => n.target.join(' ')) })); });
        m.axe = ax;
      }
      resultado[`${nomeTela}/${nome}`] = m;
      if (['320', '360', '1280', 'zoom200-360'].includes(nomeTela) && ['agenda', 'grade', 'prontuarios', 'paciente', 'financeiro'].includes(nome)) await p.screenshot({ path: `${OUT}/${nomeTela}-${nome}.png`, fullPage: nome !== 'agenda' || nomeTela !== '1280' });
    }
    // Diálogo de agendamento (paciente novo) — formulário mais longo
    await p.goto(BASE + '/'); await p.waitForTimeout(900);
    const agendar = p.getByRole('button', { name: /Agendar paciente/ }).first();
    if (await agendar.count()) { await agendar.click(); await p.waitForTimeout(600); resultado[`${nomeTela}/dialogo-agendar`] = await medir(p); if (['320', 'zoom200-360'].includes(nomeTela)) await p.screenshot({ path: `${OUT}/${nomeTela}-dialogo-agendar.png` }); }
    await ctx.close();
  }
  // Fonte do sistema ampliada (simulação): texto-padrão 200% — mostra o que NÃO cresce por estar em px fixo
  const ctx = await b.newContext({ viewport: { width: 360, height: 760 } });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Page.enable'); await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
  await p.goto(BASE + '/boas-vindas'); await p.waitForTimeout(600); await p.getByText('Conhecer o app').click(); await p.waitForTimeout(1200);
  resultado['fonte200/agenda'] = await p.evaluate(() => {
    let px = 0, rem = 0;
    for (const e of document.querySelectorAll('[class*="text-["]')) px++;
    for (const e of document.querySelectorAll('.text-sm,.text-lg,.text-xl,.text-base')) rem++;
    return { elementosComTamanhoFixoPx: px, elementosEmRem: rem, fonteRaiz: getComputedStyle(document.documentElement).fontSize };
  });
  await p.screenshot({ path: `${OUT}/fonte200-agenda.png` });
  await b.close();
  fs.writeFileSync(`${OUT}/resultado.json`, JSON.stringify(resultado, null, 1));
  console.log('ok');
})();
