// =============================================================================
// Gateway local compatível com o subconjunto da API do Supabase usado pelo app.
// SOMENTE DESENVOLVIMENTO E TESTES. Não usar em produção.
//
// Por que existe: neste ambiente não é possível baixar as imagens Docker do
// Supabase nem criar um novo projeto gratuito. O gateway fala o mesmo
// protocolo HTTP (Auth /auth/v1, PostgREST /rest/v1, Storage /storage/v1) e
// executa tudo no Postgres local, ASSUMINDO O PAPEL do usuário (anon /
// authenticated + request.jwt.claims), exatamente como o PostgREST. Assim, os
// testes E2E exercitam as migrations, RLS, gatilhos e RPCs reais.
//
// Limitações conhecidas (documentadas em docs/TESTES.md): subconjunto de
// filtros do PostgREST, sem embedding de relações, sem realtime; e-mails de
// autenticação vão para uma "caixa postal" em memória (GET /__mailbox).
// =============================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const PORT = Number(process.env.PORT || 54321);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me-0123456789abcdef';
const ANON_KEY = process.env.ANON_KEY || 'dev-anon-key';
const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve('.storage');
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://gateway:gateway@127.0.0.1:5432/psi_e2e';
const ACCESS_TTL = 3600;

fs.mkdirSync(STORAGE_DIR, { recursive: true });
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
const mailbox = []; // {to, type, link, at}
const refreshTokens = new Map(); // token -> user id

// ---------------------------------------------------------------- JWT -------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// ------------------------------------------------------------ helpers -------
function send(res, status, body, headers = {}) {
  const h = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
    'access-control-expose-headers': 'content-range,content-type',
    ...headers,
  };
  if (body === undefined || body === null) {
    res.writeHead(status, h);
    return res.end();
  }
  if (Buffer.isBuffer(body)) {
    res.writeHead(status, h);
    return res.end(body);
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...h });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const qi = (name) => {
  if (!IDENT.test(name)) throw Object.assign(new Error(`identificador inválido: ${name}`), { status: 400, code: 'PGRST100' });
  return `"${name}"`;
};

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

function userJson(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.email_confirmed_at, confirmed_at: u.email_confirmed_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: u.raw_user_meta_data || {}, identities: [],
    created_at: u.created_at, updated_at: u.updated_at,
  };
}
function sessionFor(u) {
  const now = Math.floor(Date.now() / 1000);
  const access = signJwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, iat: now, exp: now + ACCESS_TTL });
  const refresh = crypto.randomBytes(24).toString('base64url');
  refreshTokens.set(refresh, u.id);
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_TTL, expires_at: now + ACCESS_TTL, refresh_token: refresh, user: userJson(u) };
}
const authError = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });

function claimsFrom(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token || token === ANON_KEY) return { role: 'anon' };
  const p = verifyJwt(token);
  if (!p) return null;
  return p;
}

async function asRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)",
      [claims.role === 'authenticated' ? 'authenticated' : 'anon', JSON.stringify(claims)]);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function pgErrorToHttp(e, claims) {
  if (e.status) return [e.status, { code: e.code, message: e.message, details: null, hint: null }];
  const code = e.code || 'XX000';
  let status = 400;
  if (code === '42501') status = claims?.role === 'authenticated' ? 403 : 401;
  else if (code === 'P0002') status = 404;
  else if (['23505', '23503', '23P01'].includes(code)) status = 409;
  else if (code.startsWith('08') || code === 'XX000') status = 500;
  return [status, { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null }];
}

// ---------------------------------------------------------- PostgREST -------
let relCache = null;
async function relations() {
  if (relCache) return relCache;
  const { rows } = await pool.query(`
    select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v')`);
  relCache = new Set(rows.map((r) => r.relname));
  return relCache;
}

function parseInList(v) {
  // (a,b,"c,d")
  const inner = v.replace(/^\(/, '').replace(/\)$/, '');
  const out = [];
  let cur = ''; let q = false;
  for (const ch of inner) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur !== '' || inner.endsWith(',')) out.push(cur);
  return out;
}

function buildWhere(params, values) {
  const conds = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
    let val = raw; let negate = false;
    if (val.startsWith('not.')) { negate = true; val = val.slice(4); }
    const dot = val.indexOf('.');
    if (dot < 0) throw Object.assign(new Error(`filtro inválido: ${key}`), { status: 400, code: 'PGRST100' });
    const op = val.slice(0, dot); const arg = val.slice(dot + 1);
    const col = qi(key);
    let sql;
    const p = (x) => { values.push(x); return `$${values.length}`; };
    switch (op) {
      case 'eq': sql = `${col} = ${p(arg)}`; break;
      case 'neq': sql = `${col} <> ${p(arg)}`; break;
      case 'gt': sql = `${col} > ${p(arg)}`; break;
      case 'gte': sql = `${col} >= ${p(arg)}`; break;
      case 'lt': sql = `${col} < ${p(arg)}`; break;
      case 'lte': sql = `${col} <= ${p(arg)}`; break;
      case 'like': sql = `${col}::text like ${p(arg.replaceAll('*', '%'))}`; break;
      case 'ilike': sql = `${col}::text ilike ${p(arg.replaceAll('*', '%'))}`; break;
      case 'is': {
        const m = { null: 'null', true: 'true', false: 'false' }[arg];
        if (!m) throw Object.assign(new Error('is inválido'), { status: 400, code: 'PGRST100' });
        sql = `${col} is ${m}`; break;
      }
      case 'in': {
        const items = parseInList(arg);
        sql = items.length ? `${col} in (${items.map((i) => p(i)).join(',')})` : 'false';
        break;
      }
      default: throw Object.assign(new Error(`operador não suportado: ${op}`), { status: 400, code: 'PGRST100' });
    }
    conds.push(negate ? `not (${sql})` : sql);
  }
  return conds.length ? `where ${conds.join(' and ')}` : '';
}

function buildSelect(sel) {
  if (!sel || sel === '*') return '*';
  return sel.split(',').map((c) => c.trim()).filter(Boolean).map((c) => {
    if (c.includes('(')) throw Object.assign(new Error('embedding não suportado no gateway local'), { status: 400, code: 'PGRST100' });
    const [name, alias] = c.includes(':') ? c.split(':').reverse() : [c, null];
    return alias ? `${qi(name)} as ${qi(alias)}` : qi(name);
  }).join(', ');
}

function buildOrder(order) {
  if (!order) return '';
  return 'order by ' + order.split(',').map((part) => {
    const [col, ...mods] = part.split('.');
    let s = qi(col);
    if (mods.includes('desc')) s += ' desc'; else s += ' asc';
    if (mods.includes('nullsfirst')) s += ' nulls first';
    if (mods.includes('nullslast')) s += ' nulls last';
    return s;
  }).join(', ');
}

async function handleRest(req, res, url, claims) {
  const rest = url.pathname.replace(/^\/rest\/v1\//, '');
  const params = [...url.searchParams.entries()];
  const sp = url.searchParams;
  const prefer = req.headers.prefer || '';
  const wantsObject = (req.headers.accept || '').includes('application/vnd.pgrst.object+json');
  const returnRep = prefer.includes('return=representation');
  const countExact = prefer.includes('count=exact');

  // ---- RPC ----
  if (rest.startsWith('rpc/')) {
    const fn = rest.slice(4);
    qi(fn);
    const bodyBuf = req.method === 'GET' ? null : await readBody(req);
    const args = req.method === 'GET' ? Object.fromEntries(sp.entries()) : (bodyBuf.length ? JSON.parse(bodyBuf.toString()) : {});
    const { rows: meta } = await pool.query(
      `select p.proretset, t.typname, t.typtype from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       join pg_type t on t.oid = p.prorettype where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
    if (!meta.length) return send(res, 404, { code: 'PGRST202', message: `função ${fn} não encontrada` });
    const values = [];
    const named = Object.entries(args).map(([k, v]) => {
      values.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
      return `${qi(k)} => $${values.length}`;
    }).join(', ');
    const isTable = meta[0].proretset || meta[0].typtype === 'c';
    const sql = isTable ? `select * from public.${qi(fn)}(${named})` : `select public.${qi(fn)}(${named}) as r`;
    const rows = await asRole(claims, async (c) => (await c.query(sql, values)).rows);
    if (isTable) return send(res, 200, wantsObject ? rows[0] ?? null : rows);
    return send(res, 200, rows[0].r);
  }

  const rel = rest;
  if (!(await relations()).has(rel)) return send(res, 404, { code: '42P01', message: `relação ${rel} não existe` });
  const table = `public.${qi(rel)}`;

  if (req.method === 'GET' || req.method === 'HEAD') {
    const values = [];
    const where = buildWhere(params, values);
    let sql = `select ${buildSelect(sp.get('select'))} from ${table} ${where} ${buildOrder(sp.get('order'))}`;
    let limit = sp.get('limit'); let offset = sp.get('offset');
    const range = req.headers.range;
    if (range && /^\d+-\d+$/.test(range)) {
      const [a, b] = range.split('-').map(Number); offset = String(a); limit = String(b - a + 1);
    }
    if (limit) sql += ` limit ${Number(limit)}`;
    if (offset) sql += ` offset ${Number(offset)}`;
    const { rows, total } = await asRole(claims, async (c) => {
      const r = (await c.query(sql, values)).rows;
      let t = null;
      if (countExact) t = Number((await c.query(`select count(*) from ${table} ${where}`, values)).rows[0].count);
      return { rows: r, total: t };
    });
    const start = Number(offset || 0);
    const headers = { 'content-range': `${rows.length ? `${start}-${start + rows.length - 1}` : '*'}/${total ?? '*'}` };
    if (req.method === 'HEAD') return send(res, 200, null, headers);
    if (wantsObject) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
      return send(res, 200, rows[0], headers);
    }
    return send(res, 200, rows, headers);
  }

  const bodyBuf = await readBody(req);
  const body = bodyBuf.length ? JSON.parse(bodyBuf.toString()) : null;
  const returning = returnRep ? `returning ${buildSelect(sp.get('select'))}` : '';

  if (req.method === 'POST') {
    const items = Array.isArray(body) ? body : [body];
    const cols = [...new Set(items.flatMap((o) => Object.keys(o)))];
    cols.forEach(qi);
    const colList = cols.map(qi).join(', ');
    const sql = `insert into ${table} (${colList}) select ${colList} from json_populate_recordset(null::${table}, $1::json) ${returning}`;
    const rows = await asRole(claims, async (c) => (await c.query(sql, [JSON.stringify(items)])).rows);
    if (!returnRep) return send(res, 201, null);
    return send(res, 201, wantsObject ? rows[0] : rows);
  }

  if (req.method === 'PATCH') {
    const cols = Object.keys(body || {});
    if (!cols.length) return send(res, 400, { code: 'PGRST100', message: 'corpo vazio' });
    const values = [JSON.stringify(body)];
    const where = buildWhere(params, values);
    if (!where) return send(res, 400, { code: '21000', message: 'UPDATE requires a WHERE clause' });
    const set = `(${cols.map(qi).join(', ')}) = (select ${cols.map(qi).join(', ')} from json_populate_record(null::${table}, $1::json))`;
    const sql = cols.length === 1
      ? `update ${table} set ${qi(cols[0])} = (select ${qi(cols[0])} from json_populate_record(null::${table}, $1::json)) ${where} ${returning}`
      : `update ${table} set ${set} ${where} ${returning}`;
    const rows = await asRole(claims, async (c) => (await c.query(sql, values)).rows);
    if (!returnRep) return send(res, 204, null);
    if (wantsObject) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      return send(res, 200, rows[0]);
    }
    return send(res, 200, rows);
  }

  if (req.method === 'DELETE') {
    const values = [];
    const where = buildWhere(params, values);
    if (!where) return send(res, 400, { code: '21000', message: 'DELETE requires a WHERE clause' });
    const rows = await asRole(claims, async (c) => (await c.query(`delete from ${table} ${where} ${returning}`, values)).rows);
    if (!returnRep) return send(res, 204, null);
    return send(res, 200, rows);
  }
  return send(res, 405, { message: 'método não suportado' });
}

// ---------------------------------------------------------------- Auth ------
async function handleAuth(req, res, url) {
  const route = url.pathname.replace(/^\/auth\/v1/, '');
  const body = ['POST', 'PUT'].includes(req.method) ? JSON.parse((await readBody(req)).toString() || '{}') : {};

  if (route === '/settings') return send(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: true });

  if (route === '/signup' && req.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (password.length < 8) return authError(res, 422, 'weak_password', 'Password should be at least 8 characters.');
    const exists = await pool.query('select 1 from auth.users where email = $1', [email]);
    if (exists.rowCount) return authError(res, 422, 'user_already_exists', 'User already registered');
    const { rows } = await pool.query(
      `insert into auth.users (email, encrypted_password, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3, now()) returning *`, [email, hashPassword(password), body.data || {}]);
    return send(res, 200, sessionFor(rows[0]));
  }

  if (route === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await pool.query('select * from auth.users where email = $1', [String(body.email || '').trim().toLowerCase()]);
      if (!rows.length || !checkPassword(String(body.password || ''), rows[0].encrypted_password)) {
        return authError(res, 400, 'invalid_credentials', 'Invalid login credentials');
      }
      return send(res, 200, sessionFor(rows[0]));
    }
    if (grant === 'refresh_token') {
      const uid = refreshTokens.get(body.refresh_token);
      if (!uid) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      refreshTokens.delete(body.refresh_token);
      const { rows } = await pool.query('select * from auth.users where id = $1', [uid]);
      return send(res, 200, sessionFor(rows[0]));
    }
    return authError(res, 400, 'unsupported_grant_type', 'unsupported grant');
  }

  if (route === '/recover' && req.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const { rows } = await pool.query('select * from auth.users where email = $1', [email]);
    if (rows.length) {
      const token = crypto.randomBytes(24).toString('base64url');
      refreshTokens.set(`recovery:${token}`, rows[0].id);
      const redirect = url.searchParams.get('redirect_to') || 'http://localhost:5173/';
      const link = `http://localhost:${PORT}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(redirect)}`;
      mailbox.push({ to: email, type: 'recovery', link, at: new Date().toISOString() });
    }
    return send(res, 200, {}); // não revela se o e-mail existe
  }

  if (route === '/verify' && req.method === 'GET') {
    const token = url.searchParams.get('token');
    const uid = refreshTokens.get(`recovery:${token}`);
    const redirect = url.searchParams.get('redirect_to') || 'http://localhost:5173/';
    if (!uid) return send(res, 303, null, { location: `${redirect}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired` });
    refreshTokens.delete(`recovery:${token}`);
    const { rows } = await pool.query('select * from auth.users where id = $1', [uid]);
    const s = sessionFor(rows[0]);
    const frag = new URLSearchParams({ access_token: s.access_token, expires_at: String(s.expires_at), expires_in: String(s.expires_in), refresh_token: s.refresh_token, token_type: 'bearer', type: 'recovery' });
    return send(res, 303, null, { location: `${redirect}#${frag}` });
  }

  const claims = claimsFrom(req);
  if (!claims || claims.role !== 'authenticated') return authError(res, 401, 'bad_jwt', 'invalid JWT');

  if (route === '/user' && req.method === 'GET') {
    const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub]);
    if (!rows.length) return authError(res, 404, 'user_not_found', 'User not found');
    return send(res, 200, userJson(rows[0]));
  }
  if (route === '/user' && req.method === 'PUT') {
    if (body.password !== undefined && String(body.password).length < 8) return authError(res, 422, 'weak_password', 'Password should be at least 8 characters.');
    const { rows } = await pool.query(
      `update auth.users set
         encrypted_password = coalesce($2, encrypted_password),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || coalesce($3::jsonb, '{}'::jsonb),
         updated_at = now()
       where id = $1 returning *`,
      [claims.sub, body.password ? hashPassword(String(body.password)) : null, body.data ? JSON.stringify(body.data) : null]);
    return send(res, 200, userJson(rows[0]));
  }
  if (route === '/logout' && req.method === 'POST') {
    for (const [k, v] of refreshTokens) if (v === claims.sub) refreshTokens.delete(k);
    return send(res, 204, null);
  }
  return send(res, 404, { msg: 'rota de auth não suportada no gateway local' });
}

// ------------------------------------------------------------- Storage ------
function safeStoragePath(bucket, objectPath) {
  const p = path.normalize(path.join(STORAGE_DIR, bucket, objectPath));
  if (!p.startsWith(path.join(STORAGE_DIR, bucket) + path.sep)) throw Object.assign(new Error('caminho inválido'), { status: 400 });
  return p;
}

async function handleStorage(req, res, url, claims) {
  const route = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
  const storageErr = (status, message) => send(res, status, { statusCode: String(status), error: message, message });

  if (route.startsWith('/object/') && req.method === 'POST' && !route.startsWith('/object/sign') && !route.startsWith('/object/list')) {
    const full = route.slice('/object/'.length);
    const bucket = full.split('/')[0]; const name = full.slice(bucket.length + 1);
    const data = await readBody(req);
    const mime = (req.headers['content-type'] || 'application/octet-stream').split(';')[0];
    const { rows: b } = await pool.query('select * from storage.buckets where id = $1', [bucket]);
    if (!b.length) return storageErr(404, 'Bucket not found');
    if (b[0].file_size_limit && data.length > Number(b[0].file_size_limit)) return storageErr(413, 'The object exceeded the maximum allowed size');
    if (b[0].allowed_mime_types && !b[0].allowed_mime_types.includes(mime)) return storageErr(415, `mime type ${mime} is not supported`);
    try {
      const row = await asRole(claims, async (c) => (await c.query(
        `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4) returning id`,
        [bucket, name, claims.sub || null, JSON.stringify({ mimetype: mime, size: data.length })])).rows[0]);
      const fp = safeStoragePath(bucket, name);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, data);
      return send(res, 200, { Id: row.id, Key: `${bucket}/${name}` });
    } catch (e) {
      if (e.code === '42501') return storageErr(403, 'new row violates row-level security policy');
      if (e.code === '23505') return storageErr(409, 'The resource already exists');
      throw e;
    }
  }

  if (route.startsWith('/object/') && req.method === 'GET') {
    let full = route.slice('/object/'.length);
    if (full.startsWith('authenticated/')) full = full.slice('authenticated/'.length);
    const bucket = full.split('/')[0]; const name = full.slice(bucket.length + 1);
    const rows = await asRole(claims, async (c) => (await c.query(
      'select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rows);
    if (!rows.length) return storageErr(400, 'Object not found');
    const fp = safeStoragePath(bucket, name);
    if (!fs.existsSync(fp)) return storageErr(400, 'Object not found');
    return send(res, 200, fs.readFileSync(fp), { 'content-type': rows[0].metadata?.mimetype || 'application/octet-stream' });
  }

  if (/^\/object\/[^/]+$/.test(route) && req.method === 'DELETE') {
    const bucket = route.split('/')[2];
    const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || '{}');
    const rows = await asRole(claims, async (c) => (await c.query(
      'delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name, id, bucket_id',
      [bucket, prefixes])).rows);
    for (const r of rows) {
      const fp = safeStoragePath(bucket, r.name);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    return send(res, 200, rows);
  }
  return storageErr(404, 'rota de storage não suportada no gateway local');
}

// ---------------------------------------------------------------- server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') return send(res, 204, null);
  let claims = null;
  try {
    if (url.pathname === '/__mailbox') return send(res, 200, mailbox);
    if (url.pathname === '/__health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
    claims = claimsFrom(req);
    if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT expired or invalid' });
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url, claims);
    if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url, claims);
    return send(res, 404, { message: 'not found' });
  } catch (e) {
    const [status, body] = pgErrorToHttp(e, claims);
    if (status >= 500) console.error(e);
    return send(res, status, body);
  }
});

server.listen(PORT, () => console.log(`[gateway] http://localhost:${PORT}  db=${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`));
