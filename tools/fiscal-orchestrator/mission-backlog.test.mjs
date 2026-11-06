import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialMission, readyTasks, transitionTask, loadMission, saveMission } from './mission-backlog.mjs';

test('permanent mission starts with independent tasks but blocks dependent phases', () => {
  const mission = initialMission();
  assert.equal(mission.status,'open');
  assert.deepEqual(readyTasks(mission).map(x=>x.id), ['f0-inventory','agent-sandbox','agent-budget']);
  assert.throws(()=>transitionTask(mission,'f3-fiscal-core','in_progress'),/Dependencies/);
});
test('completion requires evidence, failed tasks are recorded and never auto-approved', () => {
  const mission = initialMission();
  const started = transitionTask(mission,'f0-inventory','in_progress');
  assert.throws(()=>transitionTask(started,'f0-inventory','done'),/evidence/);
  const blocked = transitionTask(started,'f0-inventory','blocked',{reason:'Missing official documentation'});
  assert.equal(blocked.tasks[0].status,'blocked');
  assert.equal(blocked.tasks[0].reason,'Missing official documentation');
  const retried = transitionTask(blocked,'f0-inventory','in_progress');
  assert.equal(retried.tasks[0].attempts,2);
  const finished = transitionTask(retried,'f0-inventory','done',{evidence:'https://github.com/example/repo/pull/23'});
  assert.equal(finished.tasks[0].status,'done');
  assert.equal(finished.tasks[0].evidence.length,1);
  assert.ok(readyTasks(finished).some(x=>x.id==='f1-official-rules'));
  assert.equal(mission.tasks[0].status,'pending');
});
test('mission persists locally across restart without any API calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'psi-mission-'));
  try{
    const path=join(dir,'mission.json');
    const mission=transitionTask(initialMission(),'agent-budget','in_progress');
    await saveMission(path,mission);
    assert.deepEqual(await loadMission(path),mission);
  }finally{
    await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:150});
  }
});
