import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexPlanner, createAnthropicExecutor } from './providers.mjs';

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
