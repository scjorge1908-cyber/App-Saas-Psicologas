import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

function assert(ok, message) { if (!ok) throw new Error(message); }
function validId(id) { assert(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(id), 'Invalid run ID'); return id; }
async function persist(file, state) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.tmp-' + randomUUID();
  await writeFile(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}
export class Orchestrator {
  constructor({ planner, executor, storageDir = '.fiscal-orchestrator-runs', maxRounds = 4, maxSteps = 16 }) {
    assert(planner && executor, 'Planner and executor are required');
    assert(Number.isInteger(maxRounds) && maxRounds >= 1 && maxRounds <= 10, 'Invalid maxRounds');
    assert(Number.isInteger(maxSteps) && maxSteps >= 1 && maxSteps <= 50, 'Invalid maxSteps');
    Object.assign(this, { planner, executor, storageDir: resolve(storageDir), maxRounds, maxSteps });
  }
  file(runId) { return resolve(this.storageDir, validId(runId) + '.json'); }
  async load(runId) { return JSON.parse(await readFile(this.file(runId), 'utf8')); }
  async start({ runId = randomUUID(), objective }) {
    const id = validId(runId);
    assert(typeof objective === 'string' && objective.length >= 8 && objective.length <= 4000, 'Invalid objective');
    const state = { schema: 1, runId: id, objective, status: 'running', round: 0, steps: 0, phase: 'plan', task: null, proposal: null, review: null, events: [], createdAt: new Date().toISOString() };
    await persist(this.file(id), state);
    return this.resume(id);
  }
  async resume(runId) {
    const state = await this.load(runId);
    assert(state.schema === 1, 'Unsupported checkpoint schema');
    if (state.status !== 'running') return state;
    while (state.status === 'running') {
      if (state.steps >= this.maxSteps) { state.status = 'blocked'; state.reason = 'step_limit'; break; }
      if (state.phase === 'plan') {
        const task = await this.planner.plan({ objective: state.objective });
        assert(task && typeof task === 'object', 'Invalid plan');
        state.task = task;
        state.events.push({ role: 'planner', action: 'plan', round: state.round, at: new Date().toISOString(), evidence: task });
        state.phase = 'execute';
      } else if (state.phase === 'execute') {
        if (state.round >= this.maxRounds) { state.status = 'blocked'; state.reason = 'round_limit'; break; }
        const round = state.round + 1;
        let proposal;
        try { proposal = await this.executor.execute({ task: state.task, feedback: state.review, round }); }
        catch (error) {
          // Budget guard is a controlled stop, not a crash: checkpoint as blocked.
          if (error?.name === 'BudgetExceededError') { state.status = 'blocked'; state.reason = 'budget_limit'; state.detail = error.message; break; }
          throw error;
        }
        assert(proposal && typeof proposal === 'object', 'Invalid proposal');
        state.round = round;
        state.proposal = proposal;
        state.events.push({ role: 'executor', action: 'execute', round, at: new Date().toISOString(), evidence: proposal });
        state.phase = 'review';
      } else if (state.phase === 'review') {
        const review = await this.planner.review({ task: state.task, proposal: state.proposal, round: state.round });
        assert(review && typeof review.accepted === 'boolean', 'Invalid review');
        state.review = review;
        state.events.push({ role: 'planner', action: review.accepted ? 'approved' : 'changes_requested', round: state.round, at: new Date().toISOString(), evidence: review });
        if (review.accepted) { state.status = 'passed'; state.phase = 'done'; }
        else state.phase = 'execute';
      } else throw new Error('Invalid phase');
      state.steps++;
      state.updatedAt = new Date().toISOString();
      await persist(this.file(runId), state);
    }
    state.updatedAt = new Date().toISOString();
    await persist(this.file(runId), state);
    return state;
  }
}
export function createMockAgents() {
  return {
    planner: {
      async plan({ objective }) { return { objective, acceptance: 'Reject duplicate fiscal documents per tenant and idempotency key' }; },
      async review({ proposal }) { return { accepted: proposal.idempotent === true, findings: proposal.idempotent ? [] : ['Missing idempotency protection'] }; }
    },
    executor: {
      async execute({ feedback }) { return { idempotent: Boolean(feedback), artifact: feedback ? 'synthetic tenant-scoped idempotency constraint' : 'unguarded insert simulation' }; }
    }
  };
}
