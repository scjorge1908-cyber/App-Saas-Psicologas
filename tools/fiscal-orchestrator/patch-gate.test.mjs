import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applySyntheticPatch, validateProposalFiles, reviewSyntheticFixture } from './patch-gate.mjs';

async function inWorkspace(fn) {
  const workspace = await mkdtemp(join(tmpdir(), 'psi-sandbox-'));
  try { await fn(workspace); }
  finally { await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); }
}
const fixture = (path, obj) => ({ path, content: JSON.stringify(obj) });

test('creates a synthetic JSON fixture without executing it', async () => inWorkspace(async workspace => {
  const files = [fixture('synthetic-fiscal/test-case.json', { idempotencyKey: 'P1:PG1' })];
  const result = await applySyntheticPatch({ workspace, files });
  assert.equal(result.executableCodeRun, false);
  assert.deepEqual(result.written, ['synthetic-fiscal/test-case.json']);
  assert.deepEqual(JSON.parse(await readFile(join(workspace, files[0].path), 'utf8')), { idempotencyKey: 'P1:PG1' });
  assert.equal((await reviewSyntheticFixture({ workspace, path: files[0].path })).hasIdempotencyKey, true);
}));
test('rejects traversal, absolute paths, code files and duplicate paths', () => {
  for (const path of ['synthetic-fiscal/../secret.json','synthetic-fiscal/sub/../../x.json',
    'synthetic-fiscal/code.js','synthetic-fiscal\\evil.json','/tmp/x.json','../oops.json'])
    assert.throws(() => validateProposalFiles([fixture(path, {})]));
  assert.throws(() => validateProposalFiles([fixture('synthetic-fiscal/A.json',{}), fixture('synthetic-fiscal/a.json',{})]));
});
test('rejects oversized output, non-JSON output and null roots', () => {
  assert.throws(() => validateProposalFiles([fixture('synthetic-fiscal/large.json', { value: 'a'.repeat(20000) })]));
  assert.throws(() => validateProposalFiles([{ path: 'synthetic-fiscal/x.json', content: 'not json' }]));
  assert.throws(() => validateProposalFiles([{ path: 'synthetic-fiscal/x.json', content: 'null' }]));
});
test('refuses to overwrite an existing file', async () => inWorkspace(async workspace => {
  const input = [fixture('synthetic-fiscal/example.json', { ok: true })];
  await applySyntheticPatch({ workspace, files: input });
  await assert.rejects(() => applySyntheticPatch({ workspace, files: input }), /overwrite/);
}));
test('refuses symlinked parent directories', async () => inWorkspace(async workspace => {
  const elsewhere = await mkdtemp(join(tmpdir(), 'psi-elsewhere-'));
  try {
    await symlink(elsewhere, join(workspace, 'synthetic-fiscal'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => applySyntheticPatch({ workspace,
      files: [fixture('synthetic-fiscal/example.json', { ok: true })] }), /Symlink/);
  } finally { await rm(elsewhere, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); }
}));
