import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_FILES = 8;
const MAX_FILE_BYTES = 16 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024;
const ALLOWED_PREFIX = 'synthetic-fiscal/';

export function validateProposalFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES)
    throw new Error('Expected 1-8 proposed files');
  let bytes = 0;
  const seen = new Set();
  return files.map((entry) => {
    if (!entry || typeof entry.path !== 'string' || typeof entry.content !== 'string')
      throw new Error('Each proposed file requires path and string content');
    const path = entry.path;
    if (path.length > 180 || !path.startsWith(ALLOWED_PREFIX) ||
        /[\\\u0000-\u001f]/.test(path) || isAbsolute(path) ||
        path.split('/').some(p => !p || p === '.' || p === '..') ||
        !/^[a-zA-Z0-9_./-]+$/.test(path) || !path.endsWith('.json'))
      throw new Error('Proposed path not allowed: ' + path);
    if (seen.has(path.toLowerCase())) throw new Error('Duplicate proposed path');
    seen.add(path.toLowerCase());
    const size = Buffer.byteLength(entry.content, 'utf8');
    if (size > MAX_FILE_BYTES) throw new Error('Proposed file too large');
    bytes += size;
    if (bytes > MAX_TOTAL_BYTES) throw new Error('Proposed patch too large');
    let parsed;
    try { parsed = JSON.parse(entry.content); }
    catch { throw new Error('Only valid JSON fixture files are allowed'); }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Fixture root must be a JSON object');
    return { path, content: entry.content };
  });
}

// Operates only inside an explicitly created disposable workspace, never in repo root.
// No commands are accepted from model output and JSON fixtures are not executable code.
export async function applySyntheticPatch({ workspace, files }) {
  const safeFiles = validateProposalFiles(files);
  const base = resolve(workspace);
  const stat = await lstat(base);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Workspace must be a real directory');
  const canonicalBase = await realpath(base);
  const results = [];
  for (const { path, content } of safeFiles) {
    const destination = resolve(canonicalBase, ...path.split('/'));
    const rel = relative(canonicalBase, destination);
    if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
      throw new Error('Target escapes workspace');
    // Refuse symlinks in any pre-existing parent path or target.
    let current = canonicalBase;
    for (const part of path.split('/')) {
      current = join(current, part);
      try {
        const s = await lstat(current);
        if (s.isSymbolicLink()) throw new Error('Symlink in proposed path');
        if (current !== destination && !s.isDirectory()) throw new Error('Parent is not directory');
        if (current === destination) throw new Error('Refusing to overwrite existing fixture');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await mkdir(dirname(destination), { recursive: true });
    const temp = destination + '.tmp-' + randomUUID();
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await rename(temp, destination);
    results.push(path);
  }
  return { written: results, executableCodeRun: false };
}

export async function reviewSyntheticFixture({ workspace, path }) {
  const validated = validateProposalFiles([{ path, content: '{}' }])[0];
  const base = await realpath(resolve(workspace));
  const target = resolve(base, ...validated.path.split('/'));
  if (!(target.startsWith(base + sep))) throw new Error('Target escapes workspace');
  const data = JSON.parse(await readFile(target, 'utf8'));
  return { jsonValid: true, hasIdempotencyKey: typeof data.idempotencyKey === 'string' && data.idempotencyKey.length > 0 };
}
