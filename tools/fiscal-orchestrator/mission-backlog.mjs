import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Deterministic mission ledger: no model calls, shell execution, API billing or app changes.
// A task can be marked done only with an independently verified evidence reference.
const TASKS = Object.freeze([
  { id: 'f0-inventory', title: 'Inventory existing fiscal flows', dependsOn: [] },
  { id: 'f1-official-rules', title: 'Validate official national tax API rules', dependsOn: ['f0-inventory'] },
  { id: 'f2-coverage', title: 'Build municipality and taxpayer eligibility matrix', dependsOn: ['f1-official-rules'] },
  { id: 'agent-sandbox', title: 'Validate disposable agent code/test environment', dependsOn: [] },
  { id: 'agent-budget', title: 'Implement persistent aggregated Anthropic cost ledger', dependsOn: [] },
  { id: 'f3-fiscal-core', title: 'Implement synthetic fiscal core and concurrency tests', dependsOn: ['f0-inventory', 'agent-sandbox'] },
  { id: 'f4-connector-test', title: 'Test official connector in permitted sandbox', dependsOn: ['f1-official-rules','f2-coverage','f3-fiscal-core'] },
  { id: 'f5-pilot-gate', title: 'Prepare human-reviewed pilot package', dependsOn: ['f4-connector-test'] }
]);

const ALLOWED = {
  pending: new Set(['in_progress','blocked']),
  in_progress: new Set(['done','blocked']),
  blocked: new Set(['in_progress']),
  done: new Set()
};
export function initialMission() {
  return { schema: 1, missionId: randomUUID(), goal: 'Psi Consultorio: national fiscal issuance, with verified eligibility',
    mode: 'offline-planning', status: 'open',
    tasks: TASKS.map(task => ({ ...task, status:'pending', evidence:[], attempts:0, updatedAt:null })),
    updatedAt: new Date().toISOString() };
}
function assertMission(mission) {
  if (!mission || mission.schema !== 1 || !Array.isArray(mission.tasks))
    throw new Error('Invalid mission');
}
export function readyTasks(mission) {
  assertMission(mission);
  return mission.tasks.filter(task => task.status === 'pending' &&
    task.dependsOn.every(id => mission.tasks.find(t => t.id === id)?.status === 'done'));
}
export function transitionTask(mission, id, next, { evidence, reason } = {}) {
  assertMission(mission);
  const task = mission.tasks.find(item => item.id === id);
  if (!task || !ALLOWED[task.status]?.has(next)) throw new Error('Invalid task transition');
  if (next === 'in_progress' && task.status === 'pending' &&
    task.dependsOn.some(dep => mission.tasks.find(t => t.id === dep)?.status !== 'done'))
    throw new Error('Dependencies not satisfied');
  if (next === 'done') {
    if (typeof evidence !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:pull|commit|issues)\/[A-Za-z0-9_.-]+/.test(evidence))
      throw new Error('Done requires GitHub evidence');
  }
  if (next === 'blocked' && (!reason || typeof reason !== 'string'))
    throw new Error('Blocked task requires reason');
  const clone = structuredClone(mission);
  const target = clone.tasks.find(t => t.id === id);
  target.status = next;
  if (next === 'in_progress') target.attempts += 1;
  if (next === 'done') target.evidence.push(evidence);
  if (next === 'blocked') target.reason = reason.slice(0,500);
  if (next === 'in_progress') delete target.reason;
  target.updatedAt = new Date().toISOString();
  clone.updatedAt = target.updatedAt;
  if (clone.tasks.every(t => t.status === 'done')) clone.status = 'done';
  return clone;
}
export async function loadMission(file) {
  const mission = JSON.parse(await readFile(resolve(file),'utf8'));
  assertMission(mission);
  return mission;
}
export async function saveMission(file, mission) {
  assertMission(mission);
  const destination = resolve(file);
  await mkdir(dirname(destination), { recursive:true, mode:0o700 });
  const temp = destination + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(mission,null,2) + '\n',{flag:'wx',mode:0o600});
  await rename(temp,destination);
  return destination;
}
