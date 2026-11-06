# Autonomous code phase — safety gate (2026-11-05)

Jorge authorized work toward autonomous code generation and revision in the fiscal module; **not** auto-merge, real invoice issuance, access to patient data, production migrations, or unbounded API spending.

## Implemented in this PR
- \`patch-gate.mjs\` is a **restricted, non-executable fixture writer**. It validates model-proposed JSON fixture files with path allowlists, size and file count limits, path traversal rejection, no overwrites, and symlink checks.
- \`patch-gate.test.mjs\` tests accepted and rejected writes, including Windows-safe test cleanup.
- No model calls or charged API transactions occur in these tests.
- The existing real provider adapters still exchange **design proposals**, not source files. The new gate is **not wired** to model output, intentionally.
- This is a safety foundation, **not** a functioning arbitrary code sandbox. A filesystem allowlist is not an OS-level sandbox.

## Before enabling model-generated executable code
1. Create a disposable isolated environment (container/VM, separate nonprivileged account), no host credentials, no production network route, no mounted home/SSH config, no Docker socket.
2. Narrow allowed repo paths and edit operations; block secrets, manifests, workflows, database migrations, production code and external effects until separately reviewed.
3. Parse and validate structured diffs; ensure no symlink escapes, no overwrites outside target, limit total diff size and use a fresh clean checkout per task.
4. Execute only trusted predefined test commands in the disposable environment with CPU/memory/time/network limits. Never run shell strings supplied by a model.
5. Add a deterministic test/verifier that can overrule model approval, persistent spending accounting across restarts, bounded retries and reproducible evidence.
6. Require GitHub PR review and explicit human authorization for merge and deployment.

## Fiscal correctness constraints from first real exchange
- Uniqueness must be enforced durably by database constraint on a canonical fiscal event; locks alone cannot guarantee concurrent uniqueness.
- A timeout or unknown provider outcome must not trigger reissuance without conclusive reconciliation; releasing worker lease does not clear fiscal uncertainty.
- Cancellation/substitution needs its own legally validated lifecycle; don't invent a new payment just to bypass uniqueness.
- Tests must verify crashes, delayed emission, concurrent workers and repeated callbacks—not simply list hypothetical scenarios.
