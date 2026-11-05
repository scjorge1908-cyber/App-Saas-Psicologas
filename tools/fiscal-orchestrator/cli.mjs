#!/usr/bin/env node
import { Orchestrator, createMockAgents } from './orchestrator.mjs';

const [command, arg] = process.argv.slice(2);
const runner = new Orchestrator({ ...createMockAgents(), storageDir: process.env.FISCAL_ORCHESTRATOR_STATE_DIR || '.fiscal-orchestrator-runs' });
try {
  if (!['demo', 'resume'].includes(command)) throw new Error('Usage: node tools/fiscal-orchestrator/cli.mjs demo | resume <runId>');
  const state = command === 'demo'
    ? await runner.start({ objective: 'Validate idempotency in a synthetic NFS-e fiscal connector' })
    : await runner.resume(arg);
  console.log(JSON.stringify({ runId: state.runId, status: state.status, reason: state.reason || null, rounds: state.round, events: state.events }, null, 2));
  if (state.status !== 'passed') process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
