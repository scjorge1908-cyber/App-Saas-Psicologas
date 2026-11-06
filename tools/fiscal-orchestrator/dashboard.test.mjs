import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicState, validateMission } from './dashboard.mjs';

test('dashboard hides objective, proposals and evidence', () => {
  const snapshot = publicState({
    runId: 'safe', status: 'blocked', phase: 'review', round: 2, steps: 5,
    reason: 'round_limit', updatedAt: '2026-11-05T20:00:00Z',
    objective: 'sensitive', proposal: { token: 'secret' }, events: [{ secret: true }]
  });
  assert.deepEqual(Object.keys(snapshot).sort(), ['phase','reason','round','runId','status','steps','updatedAt'].sort());
  assert.equal(JSON.stringify(snapshot).includes('sensitive'), false);
});
test('dashboard requires a bounded synthetic mission', () => {
  assert.equal(validateMission('  Criar regra de testes fictícios  '), 'Criar regra de testes fictícios');
  for (const mission of ['curta', 'a'.repeat(801), 'CPF 12345678901 de paciente', 'sk-ant-1234567890'])
    assert.throws(() => validateMission(mission));
});
