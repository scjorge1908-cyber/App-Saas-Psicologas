import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { runDevelopment, sanitizedEnvironment, redact, validateDevId } from './development-worker.mjs';

test('development run ID must be UUID', () => {
  assert.throws(()=>validateDevId('../outside'));
  assert.equal(validateDevId('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
});
test('development worker strips external credentials',()=>{
  const env=sanitizedEnvironment({ANTHROPIC_API_KEY:'x',OPENAI_API_KEY:'x',GITHUB_TOKEN:'x',SUPABASE_SERVICE_ROLE_KEY:'x',DATABASE_URL:'x',PATH:'ok'});
  assert.equal(env.ANTHROPIC_API_KEY,undefined);
  assert.equal(env.OPENAI_API_KEY,undefined);
  assert.equal(env.GITHUB_TOKEN,undefined);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY,undefined);
  assert.equal(env.DATABASE_URL,undefined);
  assert.equal(env.PATH,'ok');
});
test('redact hides secret-like identifiers',()=>{
  assert.equal(redact('sk-ant-exampleToken 12345678901'),'[REDACTED KEY] [REDACTED ID]');
});
test('mocked worker completes without invoking real API or Codex',async()=>{
  const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const calls=[];
  const run=async(command,args,{env})=>{
    calls.push(command);
    assert.equal(env.ANTHROPIC_API_KEY,undefined);
    if(command==='git' && args[0]==='clone') await mkdir(args.at(-1),{recursive:true});
    if(/codex/.test(command)) await writeFile(args[args.indexOf('--output-last-message')+1],'mocked successful work');
    if(command==='git' && args[0]==='status') return ' M web/src/mock.ts\n';
    return '';
  };
  const result=await runDevelopment(id,{run});
  assert.equal(result.status,'completed_unreviewed');
  assert.ok(result.summary.includes('mocked'));
  assert.deepEqual(result.changedFiles,['M web/src/mock.ts']);
  assert.equal(calls.length,4);
});
