import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator, createMockAgents } from './orchestrator.mjs';

async function sandbox(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'fiscal-orch-'));
  try { await callback(dir); } finally {
    // Windows can temporarily hold JSON checkpoint handles (antivirus/indexer).
    // Node retries transient ENOTEMPTY/EPERM/EBUSY failures for recursive rm.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
}
test('mock agents request change and then approve', async () => sandbox(async dir => {
  const runner = new Orchestrator({ ...createMockAgents(), storageDir: dir });
  const state = await runner.start({ runId: 'example', objective: 'Test synthetic fiscal idempotency' });
  assert.equal(state.status, 'passed');
  assert.equal(state.round, 2);
  assert.deepEqual(state.events.map(e => e.action), ['plan', 'execute', 'changes_requested', 'execute', 'approved']);
  assert.equal((await runner.load('example')).status, 'passed');
}));
test('round limit stops without false approval', async () => sandbox(async dir => {
  const runner = new Orchestrator({ ...createMockAgents(), storageDir: dir, maxRounds: 1 });
  const state = await runner.start({ runId: 'limit', objective: 'Test synthetic fiscal idempotency' });
  assert.equal(state.status, 'blocked');
  assert.equal(state.reason, 'round_limit');
}));
test('resume completed run is stable', async () => sandbox(async dir => {
  const runner = new Orchestrator({ ...createMockAgents(), storageDir: dir });
  const initial = await runner.start({ runId: 'resume', objective: 'Test synthetic fiscal idempotency' });
  const later = await runner.resume('resume');
  assert.deepEqual(later.events, initial.events);
}));
test('invalid run IDs rejected', async () => sandbox(async dir => {
  const runner = new Orchestrator({ ...createMockAgents(), storageDir: dir });
  await assert.rejects(() => runner.start({ runId: '../bad', objective: 'Test synthetic fiscal idempotency' }), /Invalid run ID/);
}));
test('execution error preserves last checkpoint', async () => sandbox(async dir => {
  const agents = createMockAgents();
  agents.executor.execute = async () => { throw new Error('synthetic failure'); };
  const runner = new Orchestrator({ ...agents, storageDir: dir });
  await assert.rejects(() => runner.start({ runId: 'error', objective: 'Test synthetic fiscal idempotency' }), /synthetic failure/);
  const state = await runner.load('error');
  assert.equal(state.phase, 'execute');
  assert.equal(state.steps, 1);
}));
