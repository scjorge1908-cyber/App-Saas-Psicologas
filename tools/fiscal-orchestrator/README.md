# Fiscal AI Orchestrator — isolated proof of concept (Issue #24)

**Status (2026-11-05): mock tests plus opt-in Codex CLI/Anthropic transport and local mission dashboard.** A real design-proposal cycle has been observed on the operator PC, ending at the configured round limit. No fiscal documents are emitted and app source code is not modified by the agent loop.

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


## Update 2026-11-05 — connection setup, fixes and how to run one mission

### Connection status (verified 2026-11-05)
| Provider | Status | Notes |
|---|---|---|
| Anthropic API | **Key created, not yet installed in a runtime** | Workspace `PsiConsultorio-IA` (`wrkspc_01RLfNNo2CXujK5itgYZdrpf`), monthly spend limit **US$ 5**, key `psiconsultorio-fiscal-orchestrator` scoped only to this workspace, expires 2026-12-05. Org has no payment method and no auto-reload; usage draws on promotional credit (expires 2026-11-11). `HopeCore-Unimed-Robo` untouched. |
| Codex CLI (ChatGPT Plus) | **Not logged in** | Requires Jorge's own `codex login` (official ChatGPT sign-in). No token extraction. |
| Real end-to-end cycle | **Not executed** | Blocked until both rows above are connected. The stub-binary test below is **not** proof of real integration. |
| Cost recorded | US$ 0.00 | No billed call was made. |

### Fixes in this update
- **Windows:** `codex` is `codex.cmd` on Windows and Node 22 refuses to spawn `.cmd` without a shell → adapter now uses `codex.cmd` + shell on win32 (fixed args only).
- **Codex output:** reads the clean final message via `--output-last-message` instead of parsing stdout (which can contain progress text); `--color never`; clearer login / usage-limit errors.
- **Truncation:** `max_tokens` raised to 4000 (env `ANTHROPIC_MAX_TOKENS`); a truncated response (`stop_reason=max_tokens`) is an error, never parsed as approval.
- **Budget guard:** real token usage from the API is recorded per call; before each call the worst-case cost is reserved, so the run stops as `blocked/budget_limit` before crossing `FISCAL_AI_MAX_USD` (default US$ 0.50, hard max US$ 5). The workspace limit in the Console remains the final safety net.
- **Evidence:** every event stores the plan, proposal and review content with timestamps; real runs write `.fiscal-orchestrator-runs/<runId>.evidence.json` (git-ignored) including costs.
- **Free connectivity check:** `real-cli.mjs --check` verifies `codex login status` and the Anthropic key/model via `GET /v1/models/{model}` (no tokens billed).
- Plan schema validated (`acceptance` required); JSON surrounded by prose is tolerated.

### Tests (mock / stub — not real integration)
`node --test tools/fiscal-orchestrator/*.test.mjs` → 15/15 pass, including: budget guard stops before overspending; truncated output is rejected; full cycle **plan → Claude proposal → Codex requests change → Claude receives feedback automatically and fixes → Codex approves** through the real `spawn('codex')` path using a stub binary.

### Run one mission (Jorge's Windows PC)
```powershell
npm i -g @openai/codex
codex login                     # sign in with ChatGPT Plus in the browser (official flow)
cd <repo>; git checkout feature/fiscal-ai-orchestrator-poc
powershell -ExecutionPolicy Bypass -File tools\fiscal-orchestrator\run-real.ps1 -Check
powershell -ExecutionPolicy Bypass -File tools\fiscal-orchestrator\run-real.ps1 -Objective "Projetar idempotencia de emissao NFS-e por (tenant_id, chave) com dados ficticios" -MaxUsd 0.5
```
The script asks for the API key with hidden input and keeps it only in that process. Output: status `passed` / `blocked` (`round_limit`, `budget_limit`, `step_limit`), rounds, cost and full evidence.

**Scope reminder:** this still produces *design proposals only* (no patches applied, no commands from model output, no invoices, no production data). Moving to autonomous code changes requires the sandbox/allowlist work listed above and Jorge's authorization.


## Painel local — Central de missões (Windows)

Nova interface, acessível apenas no computador em http://127.0.0.1:4876. Permite consultar checkpoints e, quando habilitado, iniciar uma missão de propostas com dados fictícios sem redigitar comandos no PowerShell.

1. Atualize a branch com \`git pull origin feature/fiscal-ai-orchestrator-poc\`.
2. Para **acompanhar histórico, sem chave e sem cobrança**:
   \`\`\`powershell
   powershell -ExecutionPolicy Bypass -File .\tools\fiscal-orchestrator\start-panel.ps1
   \`\`\`
3. Para permitir **missões reais de propostas** com Anthropic API (custos reais podem ocorrer):
   \`\`\`powershell
   powershell -ExecutionPolicy Bypass -File .\tools\fiscal-orchestrator\start-panel.ps1 -EnableRuns
   \`\`\`
   Cole a chave quando o PowerShell solicitar (não envie ao ChatGPT nem grave no GitHub). Abra http://127.0.0.1:4876 no navegador.

A interface mostra somente metadados de execução, não o conteúdo das propostas nem informações de pacientes. Há uma missão por vez, até 3 rodadas. O teto de custo estimado da **missão individual** é US$ 0,50, sujeito às limitações de apuração já documentadas; **não existe ainda controle agregado e persistente de US$ 80**. O workspace do PsiConsultorio-IA foi relatado com limite de US$ 5, que deve ser confirmado no Console antes de ampliar consumo. Não alterar esse limite por instruções de modelo.

**Para consultar amanhã:** a tela pode ler arquivos anteriores da pasta local mesmo após reiniciar o painel, mas o trabalho NÃO continua em segundo plano se o PowerShell fechar, o PC dormir, desligar ou reiniciar. Este painel ainda não dispara tarefas subsequentes automaticamente, não escreve código do app e não publica. Para execução autônoma noturna serão necessários agendador/process manager, política de retomada sem duplicidade, autenticação persistente em cofre de segredos, watchdog e teto agregado auditável — ainda não implementados.

Executar testes grátis:
\`\`\`powershell
node --test tools/fiscal-orchestrator/*.test.mjs
\`\`\`
