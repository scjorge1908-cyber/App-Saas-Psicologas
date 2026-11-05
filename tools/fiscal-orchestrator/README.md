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

## Provider adapters (not activated)

`providers.mjs` contains the **real transport integration code** for:
- **Codex:** official local `codex exec --sandbox read-only`, using the user's independently configured Codex CLI login. `OPENAI_API_KEY` is intentionally unset in the subprocess to prefer the CLI's existing account login.
- **Claude:** official Anthropic Messages API, requiring `ANTHROPIC_API_KEY`. **Claude Max is a subscription to Claude services, not free API credits.** No OAuth token extraction or repurposing of a subscription login is attempted.

`real-cli.mjs` is disabled by default and requires an explicit environment opt-in and API credentials. It only collects **JSON design proposals**, and never generates/apply patches, runs tests from model output, sends invoices, accesses patient records, or deploys. Running it against Anthropic's API **can incur charges**. The repository does not enable it in GitHub Actions.

Real-mode prerequisites: install official Codex CLI, sign in locally to ChatGPT, obtain **separately billed** Anthropic API access and configure it securely. Do not commit keys or store them in a shell history. Budget approval is required **before** enabling real mode. No API cost is incurred by mock tests.

```bash
node --test tools/fiscal-orchestrator/*.test.mjs
node tools/fiscal-orchestrator/cli.mjs demo
# The following is intentionally NOT an executable default setup:
# FISCAL_AI_REAL_MODE=YES_I_ACCEPT_API_BILLING ANTHROPIC_API_KEY=<secret> \
#   node tools/fiscal-orchestrator/real-cli.mjs "Review synthetic fiscal idempotency"
```

This is a **transport integration**, not yet autonomous code development. Implementation of sandboxed file patches, independent test validation, budget enforcement, and permitted authentication for unattended automation is required before production use. In particular, an environment opt-in is not a budget limit, and Anthropic's API billing must be configured and monitored separately.

