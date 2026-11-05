# Fiscal AI Orchestrator — isolated proof of concept (Issue #24)

**Status: MOCK ONLY. Not connected to Codex, ChatGPT, Claude, Anthropic, OpenAI, government APIs, GitHub write workflows or patient data.** Nothing in this directory emits fiscal documents or modifies app behavior.

## Run locally (Node.js 22+)

```bash
node --test tools/fiscal-orchestrator/orchestrator.test.mjs
node tools/fiscal-orchestrator/cli.mjs demo
```

The demonstration runs the following deterministic dialogue: planner gives a synthetic invoice-idempotency acceptance criterion; executor proposes an insufficient solution; planner requests changes; executor submits a revised synthetic proposal; planner approves. This **does not** execute implementation patches or independently verify their correctness.

Checkpoints are saved as JSON to `.fiscal-orchestrator-runs/` (ignored locally). Each workflow step commits a checkpoint. Restart with `node tools/fiscal-orchestrator/cli.mjs resume <runId>`. A process interruption during an external call can repeat that call after resume; real external operations must implement deduplication.

## Safety and next implementation phase
- Avoid real clinical data, credentials, tax certificates, secrets or patient identifiers in objectives and checkpoint logs.
- There is no payment, credential, login, or API provider integration.
- A future adapter must use official authentication and honor Anthropic/OpenAI account and subscription terms, with a real capability and billing check before any execution.
- Real model outputs are untrusted. Before running code, introduce a sandbox, path allowlist, diff limits, minimal privileges, command allowlist, max cost, timeouts, output redaction, proof of tests, and GitHub branch protections.
- Sequential single-run only: implement a lock or external durable queue before running multiple workers.
- Never automatically merge, deploy, perform fiscal issuance, run production migrations or purchase credits.
- Next deliverable: validate **permitted** integration mechanisms and costs, implement adapters only after authorization, with independent tests and audited PRs.

Source of project decisions: `CLAUDE.md`, `docs/HISTORICO-DECISOES.md`, `docs/PROJETO-FISCAL-NACIONAL-COORDENACAO.md`.
