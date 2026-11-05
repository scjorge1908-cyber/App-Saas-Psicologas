import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const stateDir = resolve(root, '.fiscal-orchestrator-runs');
const token = randomBytes(32).toString('hex');
const LOOPBACK = '127.0.0.1';
const PORT = 4876;
const MAX_OBJECTIVE = 800;
const allowedOrigins = new Set(['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT]);
const budgetCap = 0.5; // one mission estimate; NOT a lifetime spending cap
let active = null;

async function safeReadJson(name) {
  if (!/^[a-f0-9-]{36}\.json$/.test(name)) return null;
  try {
    const text = await readFile(join(stateDir, name), 'utf8');
    if (text.length > 2_000_000) return null;
    return JSON.parse(text);
  } catch { return null; }
}
export function publicState(data) {
  return {
    runId: data.runId,
    status: data.status,
    phase: data.phase,
    round: data.round,
    steps: data.steps,
    reason: data.reason || null,
    updatedAt: data.updatedAt || data.createdAt || null,
    // No objective, proposal, patient data, tokens, model responses or evidence.
  };
}
export function validateMission(value) {
  if (typeof value !== 'string' || value.trim().length < 12 || value.length > MAX_OBJECTIVE)
    throw new Error('Missão deve ter entre 12 e 800 caracteres');
  if (/(\b\d{11}\b|\b\d{14}\b|sk-ant-|sk-proj-)/i.test(value))
    throw new Error('Não inclua CPFs, CNPJs ou segredos na missão');
  return value.trim();
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  res.end(JSON.stringify(data));
}
function authorized(req) {
  return req.headers['x-hope-panel-token'] === token &&
    (req.headers.origin === undefined || allowedOrigins.has(req.headers.origin));
}
async function snapshots() {
  const names = (await readdir(stateDir).catch(() => []))
    .filter(x => /^[a-f0-9-]{36}\.json$/.test(x)).slice(-100);
  const rows = (await Promise.all(names.map(safeReadJson))).filter(Boolean);
  return rows.map(publicState).sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0,25);
}
async function serve(req, res) {
  const url = new URL(req.url, 'http://' + LOOPBACK + ':' + PORT);
  if (url.pathname === '/' && req.method === 'GET') {
    const template = await readFile(join(here, 'dashboard.html'), 'utf8');
    const html = template.replace('__SESSION_TOKEN__', token);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    return res.end(html);
  }
  if (!authorized(req)) return json(res, 403, { error: 'Acesso não autorizado' });
  if (url.pathname === '/api/status' && req.method === 'GET')
    return json(res, 200, { ready: Boolean(process.env.ANTHROPIC_API_KEY),
      executionEnabled: process.env.FISCAL_DASHBOARD_ENABLE_RUN === 'YES',
      active: active ? { running: true, startedAt: active.startedAt } : null,
      missionCapUsd: budgetCap, runs: await snapshots() });
  if (url.pathname === '/api/run' && req.method === 'POST') {
    if (process.env.FISCAL_DASHBOARD_ENABLE_RUN !== 'YES')
      return json(res, 403, { error: 'Execução desabilitada. Ative explicitamente no computador.' });
    if (!process.env.ANTHROPIC_API_KEY) return json(res, 403, { error: 'Chave Anthropic ausente no processo local.' });
    if (active) return json(res, 409, { error: 'Uma missão já está em execução.' });
    let body = '';
    try {
      for await (const part of req) {
        body += part.toString();
        if (body.length > 2000) throw new Error('Solicitação muito grande');
      }
      const mission = validateMission(JSON.parse(body).objective);
      const child = spawn(process.execPath, [join(here, 'real-cli.mjs'), mission], {
        cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FISCAL_AI_REAL_MODE: 'YES_I_ACCEPT_API_BILLING',
          FISCAL_AI_MAX_USD: String(budgetCap), FISCAL_AI_MAX_ROUNDS: '3' }
      });
      const job = { child, startedAt: new Date().toISOString() };
      active = job;
      // Logs are not persisted; do not return provider outputs or secret-bearing details.
      child.stdout.resume(); child.stderr.resume();
      child.on('error', () => { if (active === job) active = null; });
      child.on('exit', () => { if (active === job) active = null; });
      return json(res, 202, { started: true, message: 'Missão iniciada. Acompanhe o status nesta tela.' });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  return json(res, 404, { error: 'Não encontrado' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer((req,res) => serve(req,res).catch(() => json(res,500,{error:'Falha no painel'})))
    .listen(PORT, LOOPBACK, () => {
      console.log('Painel local: http://' + LOOPBACK + ':' + PORT);
      console.log('Execução habilitada:', process.env.FISCAL_DASHBOARD_ENABLE_RUN === 'YES');
      console.log('Não feche esta janela enquanto precisar executar missões.');
    });
}
