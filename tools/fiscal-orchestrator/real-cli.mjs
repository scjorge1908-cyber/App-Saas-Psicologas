#!/usr/bin/env node
// Explicit opt-in: never invoked by CI, tests or mock demo.
// This adapter produces design proposals only; it does not modify app code.
import { Orchestrator } from './orchestrator.mjs';
import { createCodexPlanner, createAnthropicExecutor } from './providers.mjs';

const objective = process.argv.slice(2).join(' ').trim();
if (process.env.FISCAL_AI_REAL_MODE !== 'YES_I_ACCEPT_API_BILLING') {
  console.error('Real mode disabled. Explicitly approve API costs and set FISCAL_AI_REAL_MODE=YES_I_ACCEPT_API_BILLING.');
  process.exitCode = 2;
} else if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY. Claude Max login is not an Anthropic API key.');
  process.exitCode = 2;
} else if (objective.length < 8) {
  console.error('Usage: node tools/fiscal-orchestrator/real-cli.mjs "Your synthetic objective"');
  process.exitCode = 2;
} else {
  try {
    const orchestrator = new Orchestrator({
      planner: createCodexPlanner(),
      executor: createAnthropicExecutor(),
      maxRounds: 2,
      maxSteps: 5,
      storageDir: process.env.FISCAL_ORCHESTRATOR_STATE_DIR || '.fiscal-orchestrator-runs'
    });
    const state = await orchestrator.start({ objective });
    console.log(JSON.stringify({
      runId: state.runId, status: state.status, reason: state.reason,
      rounds: state.round, events: state.events
    }, null, 2));
    if (state.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error('Real adapter failed:', error.message);
    process.exitCode = 1;
  }
}
