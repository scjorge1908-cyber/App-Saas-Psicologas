import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRepo = resolve(here, '../..');
const outputRoot = resolve(sourceRepo, '.fiscal-orchestrator-runs', 'development');
const workingBranch = 'feature/fiscal-ai-orchestrator-poc';
const MAX_RUNTIME_MS = 70 * 60 * 1000;
export const PROJECT_GOAL = 'Develop an actual working local/mock-only NFS-e issuance experience in Psi Consultorio using existing architecture. Read CLAUDE.md, docs/HISTORICO-DECISOES.md and docs/PROJETO-FISCAL-NACIONAL-COORDENACAO.md first. For fictional professional and payment, support mock issuance, a no-fiscal-validity banner, status/history, duplicate blocking and unknown outcome/timeout blocking. Inspect existing app and implement source code, not just advice. Use only fictional data and dependencies already present. Run feasible tests and report precisely which ran. Do not push, deploy, install services, access government APIs, apply migrations, connect production Supabase, use real patients or credentials, or create tax-valid PDFs/XML. Work only in disposable clone and do not change unrelated files. If external services would be needed, document the blocker and complete the mock UI.';

export function validateDevId(id) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid development id'); return id; }
export function redact(text) {
  return String(text).slice(0, 2000)
    .replace(/sk-(?:ant|proj)-[a-z0-9_-]+/gi,'[REDACTED KEY]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[REDACTED EMAIL]')
    .replace(/\b\d{11}\b|\b\d{14}\b/g,'[REDACTED ID]');
}
async function runProgram(command, args, { cwd, env, timeoutMs = 150000, input = null } = {}) {
  return await new Promise((resolvePromise,reject) => {
    const child=spawn(command,args,{cwd,env,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',done=false;
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolvePromise(result)};
    const timer=setTimeout(()=>{child.kill();finish(new Error(command+' timed out'))},timeoutMs);
    child.on('error',error=>finish(error));
    for(const stream of [child.stdout,child.stderr]) stream.on('data',part=>{output=(output+part.toString()).slice(-12000)});
    child.on('exit',code=>finish(code===0?null:new Error(command+' exited with '+code+'; '+redact(output.slice(-300))),output));
    child.stdin.on('error',()=>{});
    child.stdin.end(input??'');
  });
}
export function sanitizedEnvironment(source=process.env) {
  const env={...source};
  for(const name of Object.keys(env))
    if (/^(?:ANTHROPIC_|OPENAI_API_KEY$|GITHUB_TOKEN$|GH_TOKEN$|SUPABASE_|VERCEL_|DATABASE_URL$|PGPASSWORD$|AWS_|GOOGLE_APPLICATION_CREDENTIALS$)/i.test(name)) delete env[name];
  env.FISCAL_AI_REAL_MODE='OFF';
  env.CI='true';
  return env;
}
export async function saveStatus(file,record) {
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.'+randomUUID()+'.tmp';
  await writeFile(temp,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temp,file);
}
export async function loadStatus(file) {return JSON.parse(await readFile(file,'utf8'))}
export async function runDevelopment(id,{run=runProgram,now=()=>new Date().toISOString()}={}) {
  validateDevId(id);
  const dir=join(outputRoot,id),checkout=join(dir,'checkout'),statusFile=join(dir,'status.json');
  const state={runId:id,status:'running',phase:'preparing',startedAt:now(),updatedAt:now(),message:'Preparando cópia local separada do repositório',sourceBranch:workingBranch};
  const update=async(fields)=>{Object.assign(state,fields,{updatedAt:now()});await saveStatus(statusFile,state)};
  await update({});
  const env=sanitizedEnvironment();
  try {
    await run('git',['clone','--no-hardlinks','--local','--single-branch','--branch',workingBranch,sourceRepo,checkout],{cwd:dir,env,timeoutMs:90000});
    await update({phase:'developing',message:'Codex desenvolvendo protótipo local. Nenhuma chamada Anthropic.',checkout});
    const outputFile=join(dir,'codex-last-message.txt');
    await run(process.platform==='win32'?'codex.exe':'codex',
      ['exec','--sandbox','workspace-write','--skip-git-repo-check','--color','never','--output-last-message',outputFile,'-'],
      {cwd:checkout,env,timeoutMs:MAX_RUNTIME_MS,input:PROJECT_GOAL});
    await update({phase:'reviewing',message:'Coletando arquivos alterados e evidências'});
    const diff=await run('git',['status','--short'],{cwd:checkout,env,timeoutMs:30000});
    const files=diff.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,80);
    const finalText=await readFile(outputFile,'utf8').catch(()=> 'Codex não deixou resposta final.');
    await update({status:'completed_unreviewed',phase:'done',message:'Desenvolvimento local concluído; revisar e testar antes de incorporar ao repositório',changedFiles:files,summary:redact(finalText),completedAt:now()});
  }catch(error) {
    await update({status:'blocked',phase:'blocked',message:redact(error.message),completedAt:now()});
  }
  return state;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runDevelopment(process.argv[2]).catch(error=>{console.error('Worker failed:',redact(error.message));process.exitCode=1});
}
