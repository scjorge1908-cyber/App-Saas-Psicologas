#!/usr/bin/env node
// Explicit opt-in: never invoked by CI, tests or mock demo.
// This adapter produces design proposals only; it does not modify app code.
//
// Usage:
//   node tools/fiscal-orchestrator/real-cli.mjs --check            (free: verifies Codex login + Anthropic key/model)
//   node tools/fiscal-orchestrator/real-cli.mjs "Objective ..."    (billed: Codex plans/reviews, Claude proposes/fixes)
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Orchestrator } from './orchestrator.mjs';
import { createCodexPlanner, createAnthropicExecutor, createBudget, checkAnthropic, checkCodex } from './providers.mjs';

const args = process.argv.slice(2);
const objective = args.filter(a => a !== '--check').join(' ').trim();
const storageDir = process.env.FISCAL_ORCHESTRATOR_STATE_DIR || '.fiscal-orchestrator-runs';

if (args.includes('--check')) {
  const [codex, anthropic] = await Promise.all([checkCodex(), checkAnthropic()]);
  console.log(JSON.stringify({ codex, anthropic }, null, 2));
  process.exitCode = codex.ok && anthropic.ok ? 0 : 1;
} else if (process.env.FISCAL_AI_REAL_MODE !== 'YES_I_ACCEPT_API_BILLING') {
  console.error('Real mode disabled. Explicitly approve API costs and set FISCAL_AI_REAL_MODE=YES_I_ACCEPT_API_BILLING.');
  process.exitCode = 2;
} else if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY. Claude Max login is not an Anthropic API key.');
  process.exitCode = 2;
} else if (objective.length < 8) {
  console.error('Usage: node tools/fiscal-orchestrator/real-cli.mjs "Your synthetic objective"');
  process.exitCode = 2;
} else {
  let budget;
  try {
    budget = createBudget();
    const orchestrator = new Orchestrator({
      planner: createCodexPlanner(),
      executor: createAnthropicExecutor({ budget }),
      maxRounds: Number(process.env.FISCAL_AI_MAX_ROUNDS || 3),
      maxSteps: 12,
      storageDir
    });
    const state = await orchestrator.start({ objective });
    const report = {
      runId: state.runId, status: state.status, reason: state.reason || null, detail: state.detail || null,
      rounds: state.round,
      cost: { capUsd: budget.maxUsd, spentUsdEstimate: Number(budget.spentUsd.toFixed(6)), anthropicCalls: budget.calls,
        codex: 'billed to ChatGPT plan usage (no per-call USD reported by Codex CLI)' },
      events: state.events
    };
    // Evidence file next to the checkpoint (git-ignored directory).
    await mkdir(resolve(storageDir), { recursive: true, mode: 0o700 });
    await writeFile(resolve(storageDir, state.runId + '.evidence.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (state.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    console.error('Real adapter failed:', error.message);
    if (budget) console.error('Anthropic spend so far (estimate): US$' + budget.spentUsd.toFixed(6));
    process.exitCode = 1;
  }
}
