import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexPlanner, createAnthropicExecutor, codexCommand } from './providers.mjs';

test('Codex planner handles JSON plan and review without actual network', async () => {
  const outputs = [
    JSON.stringify({ objective: 'synthetic fiscal scenario', acceptance: 'prevent duplicate', plan: ['test'] }),
    JSON.stringify({ accepted: false, findings: ['missing idempotency'], reason: 'unsafe' })
  ];
  const planner = createCodexPlanner({ run: async () => outputs.shift() });
  assert.equal((await planner.plan({ objective: 'synthetic fiscal scenario' })).plan.length, 1);
  assert.equal((await planner.review({ task: {}, proposal: {}, round: 1 })).accepted, false);
});
test('Anthropic executor uses official endpoint with mocked fetch and JSON response', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({
      content: [{ type: 'text', text: JSON.stringify({ summary: 'fictitious', design: 'test', tests: [], risks: [] }) }]
    }) };
  };
  const agent = createAnthropicExecutor({ fetcher, apiKey: 'fake-test-key', model: 'test-model' });
  const result = await agent.execute({ task: { acceptance: 'synthetic' }, feedback: null, round: 1 });
  assert.equal(result.summary, 'fictitious');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.headers['x-api-key'], 'fake-test-key');
});
test('Anthropic API credential is mandatory even if user has Max subscription', () => {
  assert.throws(() => createAnthropicExecutor({ apiKey: '' }), /ANTHROPIC_API_KEY required/);
});
test('provider failures are errors, not accidental approvals', async () => {
  const agent = createAnthropicExecutor({
    apiKey: 'fake-test-key', model: 'test-model',
    fetcher: async () => ({ ok: false, status: 429 })
  });
  await assert.rejects(() => agent.execute({ task: {}, round: 1 }), /HTTP 429/);
});
test('Codex requires structured JSON response', async () => {
  const agent = createCodexPlanner({ run: async () => 'not a json result' });
  await assert.rejects(() => agent.plan({ objective: 'test' }), /not valid JSON/);
});

// ---- Added 2026-11-05: budget guard, truncation, evidence and real spawn path ----
import { Orchestrator } from './orchestrator.mjs';
import { createBudget, runCodexReadOnly, parseObject } from './providers.mjs';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('JSON wrapped in prose is still parsed', () => {
  assert.equal(parseObject('Here it is: {"a":1} done').a, 1);
});
test('truncated Anthropic output is an error and usage is still billed', async () => {
  const budget = createBudget({ maxUsd: 1 });
  const agent = createAnthropicExecutor({ apiKey: 'fake-test-key', model: 'm', budget,
    fetcher: async () => ({ ok: true, json: async () => ({ stop_reason: 'max_tokens', usage: { input_tokens: 1000, output_tokens: 4000 }, content: [{ type: 'text', text: '{"summary":' }] }) }) });
  await assert.rejects(() => agent.execute({ task: {}, round: 1 }), /truncated/);
  assert.equal(budget.calls.length, 1);
  assert.ok(Math.abs(budget.spentUsd - 0.063) < 1e-9);
});
test('budget cap above workspace limit is refused', () => {
  assert.throws(() => createBudget({ maxUsd: 6 }), /<= 5/);
});
test('budget guard blocks the run before overspending, without approval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fiscal-budget-'));
  try {
    const budget = createBudget({ maxUsd: 0.1 });
    let calls = 0;
    const executor = createAnthropicExecutor({ apiKey: 'fake-test-key', model: 'm', budget,
      fetcher: async () => { calls++; return { ok: true, json: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 3000 },
        content: [{ type: 'text', text: JSON.stringify({ summary: 's', design: 'd', tests: [], risks: [] }) }] }) }; } });
    const planner = { plan: async () => ({ acceptance: 'x' }), review: async () => ({ accepted: false, findings: ['more'] }) };
    const state = await new Orchestrator({ planner, executor, storageDir: dir, maxRounds: 10, maxSteps: 50 })
      .start({ runId: 'budget', objective: 'Synthetic budget guard test' });
    assert.equal(state.status, 'blocked');
    assert.equal(state.reason, 'budget_limit');
    assert.ok(budget.spentUsd <= 0.1, 'never exceeds cap');
    assert.equal(calls, budget.calls.length);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('full cycle through the real codex spawn path (stub binary) records evidence', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fiscal-e2e-'));
  const oldPath = process.env.PATH;
  try {
    // Stub "codex": writes the last message to the -o file like the real CLI; first review rejects, second accepts.
    const stub = join(dir, 'codex');
    await writeFile(stub, `#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);const o=a[a.indexOf('--output-last-message')+1];
let input='';process.stdin.on('data',c=>input+=c).on('end',()=>{
  const counter='${dir}/n';const n=fs.existsSync(counter)?+fs.readFileSync(counter,'utf8'):0;fs.writeFileSync(counter,String(n+1));
  let msg;
  if(input.includes('Role: planner')) msg={objective:'o',acceptance:'unique (tenant_id, idempotency_key)',plan:['p']};
  else msg=input.includes('"round":1')?{accepted:false,findings:['missing unique constraint'],reason:'r'}:{accepted:true,findings:[],reason:'ok'};
  fs.writeFileSync(o,JSON.stringify(msg));process.stdout.write('progress noise\\n');});
`);
    await chmod(stub, 0o755);
    process.env.PATH = dir + ':' + oldPath;
    const seen = [];
    const executor = createAnthropicExecutor({ apiKey: 'fake-test-key', model: 'm', budget: createBudget({ maxUsd: 1 }),
      fetcher: async (url, options) => { const body = JSON.parse(options.body); seen.push(body.messages[0].content);
        const fixed = body.messages[0].content.includes('missing unique constraint');
        return { ok: true, json: async () => ({ stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
          content: [{ type: 'text', text: JSON.stringify({ summary: fixed ? 'fixed' : 'first', design: 'd', tests: [], risks: [] }) }] }) }; } });
    const state = await new Orchestrator({ planner: createCodexPlanner({ run: m => runCodexReadOnly(m, { cwd: dir }) }), executor, storageDir: dir })
      .start({ runId: 'e2e', objective: 'Synthetic NFS-e idempotency' });
    assert.equal(state.status, 'passed');
    assert.deepEqual(state.events.map(e => e.action), ['plan', 'execute', 'changes_requested', 'execute', 'approved']);
    assert.ok(seen[1].includes('missing unique constraint'), 'Claude received Codex feedback automatically');
    assert.equal(state.events[3].evidence.summary, 'fixed');
  } finally { process.env.PATH = oldPath; await rm(dir, { recursive: true, force: true }); }
});

test('Windows resolves Codex executable directly without invoking a shell', () => {
  assert.deepEqual(codexCommand('win32'), { command: 'codex.exe', shell: false });
  assert.deepEqual(codexCommand('linux'), { command: 'codex', shell: false });
});
