// The save server for the Skopje drive builder. Runs on Cloudflare Workers with Durable Objects:
//   Account   one object per username: the password hash and failed-login lockout
//   Workspace one object per workspace name: its saves run one at a time, so a version check is exact
//   Limiter   one object per (hashed) client address: caps signups and sign-ins per minute
// The published map is public. Every other workspace is open only to its owner and members (signed in), and only they can save.
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ACCOUNTS: DurableObjectNamespace;
  WORKSPACES: DurableObjectNamespace;
  LIMITS: DurableObjectNamespace;
  SECRET: string; // npx wrangler secret put SECRET: signs tokens and keys the password hashes
  ALLOWED_ORIGIN: string;
  ADMINS: string; // usernames that may create workspaces with any name (e.g. player)
  TURNSTILE_SECRET?: string; // optional: when set, signups and sign-ins need a Turnstile check
  SIGNUPS_PER_MIN?: string; // per address; defaults in wrangler.toml
  SIGNINS_PER_MIN?: string;
}

const TOKEN_DAYS = 30;
const MAX_BODY = 1_500_000; // bytes: a workspace is well under the 2 MB storage value limit
const USER_RE = /^[a-z0-9_]{3,20}$/;
const WS_RE = /^[a-z0-9_-]{3,32}$/;
const LOCK_AFTER_FAILS = 10;
const LOCK_MINUTES = 15;

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const now = () => new Date().toISOString();

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function json(env: Env, body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Cache-Control': 'no-store',
    },
  });
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** Password hash: HMAC keyed with SECRET over salt and password. Fast enough for the free plan's CPU limit. */
async function passwordHash(env: Env, password: string, salt: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.SECRET), enc.encode(`${salt}|${password}`));
  return b64(sig);
}

async function issueToken(env: Env, username: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400;
  const payload = `${username}.${exp}`;
  return `${payload}.${b64(await crypto.subtle.sign('HMAC', await hmacKey(env.SECRET), enc.encode(payload)))}`;
}

async function userFromToken(env: Env, req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const parts = (auth.startsWith('Bearer ') ? auth.slice(7) : '').split('.');
  if (parts.length !== 3) return null;
  const [username, expText, sigText] = parts;
  if (!USER_RE.test(username) || Number(expText) * 1000 < Date.now()) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.SECRET), unb64(sigText), enc.encode(`${username}.${expText}`));
  return ok ? username : null;
}

async function readBody(req: Request): Promise<any> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Податоците се преголеми.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Невалидно барање.'); }
}

/** Calls a Durable Object with a JSON body and returns its status and JSON answer. */
async function callDo(ns: DurableObjectNamespace, name: string, path: string, body: unknown = {}): Promise<{ status: number; data: any }> {
  const stub = ns.get(ns.idFromName(name));
  const res = await stub.fetch(`https://do${path}`, { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function clientKey(req: Request): Promise<string> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(ip)); // the address itself is never stored
  return `ip:${Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function underLimit(env: Env, req: Request, bucket: string, max: number): Promise<void> {
  const r = await callDo(env.LIMITS, `${bucket}:${await clientKey(req)}`, '/hit', { max, windowMs: 60_000 });
  if (r.status !== 200) throw new HttpError(429, 'Премногу обиди. Почекај една минута.');
}

async function turnstileOk(env: Env, req: Request, token: unknown): Promise<void> {
  if (!env.TURNSTILE_SECRET) return;
  if (typeof token !== 'string' || !token) throw new HttpError(403, 'Потврди дека си човек.');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', req.headers.get('CF-Connecting-IP') ?? '');
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  if (!((await r.json()) as { success?: boolean }).success) throw new HttpError(403, 'Потврдата не успеа. Обиди се повторно.');
}

async function register(env: Env, req: Request): Promise<Response> {
  await underLimit(env, req, 'signup', Number(env.SIGNUPS_PER_MIN ?? 20));
  const body = await readBody(req);
  const username = String(body.username ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  // the rules first: a typo must not use up the single-use bot check
  if (!USER_RE.test(username)) throw new HttpError(400, 'Корисничко име: 3–20 латинични букви, цифри или _.');
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'Лозинката мора да има 8 до 200 знаци.');
  await turnstileOk(env, req, body.turnstile);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await passwordHash(env, password, salt);
  const r = await callDo(env.ACCOUNTS, username, '/create', { salt, hash });
  if (r.status === 409) throw new HttpError(409, 'Ова корисничко име е зафатено.');
  return json(env, { username, token: await issueToken(env, username) }, 201);
}

async function login(env: Env, req: Request): Promise<Response> {
  await underLimit(env, req, 'signin', Number(env.SIGNINS_PER_MIN ?? 60));
  const body = await readBody(req);
  const username = String(body.username ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  if (!USER_RE.test(username) || !password) throw new HttpError(401, 'Погрешно корисничко име или лозинка.');
  await turnstileOk(env, req, body.turnstile);
  const salt = await callDo(env.ACCOUNTS, username, '/salt');
  if (salt.status !== 200) throw new HttpError(401, 'Погрешно корисничко име или лозинка.');
  const hash = await passwordHash(env, password, salt.data.salt);
  const r = await callDo(env.ACCOUNTS, username, '/verify', { hash });
  if (r.status === 429) throw new HttpError(429, `Премногу погрешни обиди. Пробај по ${LOCK_MINUTES} минути.`);
  if (r.status !== 200) throw new HttpError(401, 'Погрешно корисничко име или лозинка.');
  return json(env, { username, token: await issueToken(env, username) });
}

async function getWorkspace(env: Env, req: Request, name: string): Promise<Response> {
  // the published map is what everyone plays; every other work is open only to its owner and members
  const user = await userFromToken(env, req);
  const v = new URL(req.url).searchParams.get('v');
  const version = v === null ? 0 : Number(v);
  if (v !== null && (!Number.isInteger(version) || version < 1)) throw new HttpError(400, 'Невалидна верзија.');
  const r = await callDo(env.WORKSPACES, name, '/get', { user, public: name === 'published', version });
  if (r.status === 403) throw new HttpError(401, user ? 'Немаш пристап до оваа работа.' : 'Најави се за да ја отвориш оваа работа.');
  if (r.status !== 200) throw new HttpError(404, 'Нема таква работа.');
  return json(env, { name, ...r.data });
}

async function saveWorkspace(env: Env, req: Request, name: string): Promise<Response> {
  const user = await userFromToken(env, req);
  if (!user) throw new HttpError(401, 'Најави се за да зачуваш.');
  if (!WS_RE.test(name)) throw new HttpError(400, 'Името на работата: 3–32 мали букви, цифри, _ или -.');
  const body = await readBody(req);
  const admins = env.ADMINS.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const r = await callDo(env.WORKSPACES, name, '/put', {
    user, name, admins, baseVersion: Number(body.baseVersion ?? 0), data: body.data, savedAt: now(), mode: body.mode, label: body.label,
  });
  if (r.status === 409) return json(env, { error: 'Некој зачувал меѓувреме.', version: r.data.version }, 409);
  if (r.status === 403) throw new HttpError(403, r.data.error ?? 'Немаш пристап до оваа работа.');
  if (r.status !== 200) throw new HttpError(500, 'Не успеав да зачувам.');
  return json(env, { name, version: r.data.version, savedAt: r.data.savedAt });
}

/** A join code: 24 characters from a 32-letter alphabet (no 0, O, 1, I), so 120 random bits. Only its hash is stored. */
const INVITE_DAYS = 7;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const sha256 = async (text: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let out = '';
  for (const x of bytes) out += CODE_ALPHABET[x & 31]; // 256 is a multiple of 32: every letter is equally likely
  return out.match(/.{1,4}/g)!.join('-');
}
/** What people type: letters and digits only, in any case, with or without dashes. */
const normalizeCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The owner makes a code for one work. A new code replaces the old one. */
async function invite(env: Env, req: Request, name: string): Promise<Response> {
  const user = await userFromToken(env, req);
  if (!user) throw new HttpError(401, 'Најави се.');
  const code = newCode();
  const hash = await sha256(normalizeCode(code));
  const expires = Date.now() + INVITE_DAYS * 86_400_000;
  const r = await callDo(env.WORKSPACES, name, '/invite', { user, hash, expires });
  if (r.status === 404) throw new HttpError(404, 'Прво зачувај ја работата под твоето име, па создај код.');
  if (r.status === 403) throw new HttpError(403, 'Само сопственикот може да создава код.');
  await callDo(env.ACCOUNTS, `code:${hash}`, '/code-put', { name, expires });
  return json(env, { name, code, expiresAt: new Date(expires).toISOString() });
}

/** Someone types a code in the builder: they are added to the work the code belongs to. */
async function join(env: Env, req: Request): Promise<Response> {
  const user = await userFromToken(env, req);
  if (!user) throw new HttpError(401, 'Најави се за да ја отвориш работата.');
  const code = normalizeCode(String((await readBody(req)).code ?? ''));
  if (code.length !== 24) throw new HttpError(400, 'Кодот има 24 знаци (пример: ABCD-EFGH-...).');
  const hash = await sha256(code);
  const found = await callDo(env.ACCOUNTS, `code:${hash}`, '/code-get');
  if (found.status !== 200) throw new HttpError(403, 'Кодот не е важечки или е истечен.');
  const r = await callDo(env.WORKSPACES, found.data.name, '/join', { user, hash });
  if (r.status !== 200) throw new HttpError(403, 'Кодот не е важечки или е истечен.');
  return json(env, { name: found.data.name });
}

export class Account extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const body = (await req.json()) as any;
    // one request at a time per account: two signups with the same name cannot both succeed
    return this.ctx.blockConcurrencyWhile(async () => {
      const rec = await this.ctx.storage.get<{ salt: string; hash: string; created: string; fails: number; lockedUntil: number }>('user');
      const reply = (status: number, data: unknown = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
      if (path === '/create') {
        if (rec) return reply(409);
        await this.ctx.storage.put('user', { salt: body.salt, hash: body.hash, created: now(), fails: 0, lockedUntil: 0 });
        return reply(201);
      }
      if (path === '/exists') return reply(200, { exists: !!rec });
      // join codes are kept here too, under "code:<hash>" (a user name can never contain a colon)
      if (path === '/code-put') { await this.ctx.storage.put('code', { name: body.name, expires: body.expires }); return reply(200); }
      if (path === '/code-get') {
        const c = await this.ctx.storage.get<{ name: string; expires: number }>('code');
        return c && c.expires > Date.now() ? reply(200, { name: c.name }) : reply(404);
      }
      if (path === '/salt') return rec ? reply(200, { salt: rec.salt }) : reply(404);
      if (path === '/verify') {
        if (!rec) return reply(401);
        if (rec.lockedUntil > Date.now()) return reply(429, { retryAt: rec.lockedUntil });
        if (rec.hash !== body.hash) {
          rec.fails += 1;
          if (rec.fails >= LOCK_AFTER_FAILS) { rec.fails = 0; rec.lockedUntil = Date.now() + LOCK_MINUTES * 60_000; }
          await this.ctx.storage.put('user', rec);
          return reply(401);
        }
        if (rec.fails || rec.lockedUntil) { rec.fails = 0; rec.lockedUntil = 0; await this.ctx.storage.put('user', rec); }
        return reply(200);
      }
      return reply(404);
    });
  }
}

/** Each work keeps its newest 5 versions. The versions list is small; each version's items are kept under "v<n>". */
const MAX_VERSIONS = 5;
interface VersionMeta { version: number; savedAt: string; savedBy: string; count: number; label?: string }
interface WsRec { owner: string; members: string[]; version: number; versions: VersionMeta[] }
const itemCount = (data: unknown) => (data && Array.isArray((data as { items?: unknown[] }).items) ? (data as { items: unknown[] }).items.length : 0);

export class Workspace extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const body = (await req.json()) as any;
    return this.ctx.blockConcurrencyWhile(async () => {
      const reply = (status: number, data: unknown = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
      const st = this.ctx.storage;
      let ws = await st.get<WsRec & { data?: unknown; savedAt?: string; savedBy?: string }>('ws');
      // a work saved before versions existed: its one version becomes version 1 of the list
      if (ws && 'data' in ws) {
        const { data, savedAt = new Date().toISOString(), savedBy = ws.owner, ...rest } = ws;
        await st.put(`v${rest.version}`, data);
        ws = { ...rest, versions: [{ version: rest.version, savedAt, savedBy, count: itemCount(data) }] };
        await st.put('ws', ws);
      }
      if (path === '/get') {
        if (!ws) return reply(404);
        const allowed = body.public || body.user === ws.owner || ws.members.includes(body.user);
        if (!allowed) return reply(403);
        const shown = body.version ? Number(body.version) : ws.version;
        const meta = ws.versions.find((x) => x.version === shown);
        if (!meta) return reply(404);
        const data = await st.get(`v${shown}`);
        return reply(200, { owner: ws.owner, members: ws.members, latest: ws.version, version: shown, savedAt: meta.savedAt, savedBy: meta.savedBy, data, versions: ws.versions });
      }
      if (path === '/put') {
        const user: string = body.user;
        const now = body.savedAt;
        const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : undefined;
        const overwrite = body.mode === 'overwrite';
        if (body.name === 'published' && !body.admins.includes(user)) return reply(403, { error: 'Само администраторот може да ја објави играта за сите.' });
        if (!ws) {
          // a new workspace takes your own username as its name; admins may use any name (e.g. player)
          if (user !== body.name && !body.admins.includes(user)) return reply(403, { error: 'Новата работа се создава со твоето корисничко име.' });
          if (body.baseVersion !== 0) return reply(409, { version: 0 });
          await st.put('v1', body.data);
          const rec: WsRec = { owner: user, members: [], version: 1, versions: [{ version: 1, savedAt: now, savedBy: user, count: itemCount(body.data), label }] };
          await st.put('ws', rec);
          return reply(200, { version: 1, savedAt: now });
        }
        if (ws.owner !== user && !ws.members.includes(user)) return reply(403, { error: 'Немаш пристап до оваа работа.' });
        if (body.baseVersion !== ws.version) return reply(409, { version: ws.version });
        // Save overwrites the newest version (like saving a document); Save as adds a named version
        if (overwrite) {
          await st.put(`v${ws.version}`, body.data);
          const versions = ws.versions.map((v) => (v.version === ws.version ? { ...v, savedAt: now, savedBy: user, count: itemCount(body.data) } : v));
          await st.put('ws', { ...ws, versions, savedAt: now, savedBy: user } as WsRec);
          return reply(200, { version: ws.version, savedAt: now, dropped: 0 });
        }
        const next = ws.version + 1;
        await st.put(`v${next}`, body.data);
        const versions = [...ws.versions, { version: next, savedAt: now, savedBy: user, count: itemCount(body.data), label }];
        // over the limit: the oldest version without a name goes first, then the oldest of all
        let dropped = 0;
        while (versions.length > MAX_VERSIONS) {
          const i = versions.findIndex((v) => !v.label);
          const [old] = versions.splice(i >= 0 ? i : 0, 1);
          await st.delete(`v${old.version}`);
          dropped++;
        }
        await st.put('ws', { ...ws, version: next, versions });
        return reply(200, { version: next, savedAt: now, dropped });
      }
      if (path === '/invite') {
        if (!ws) return reply(404);
        if (ws.owner !== body.user) return reply(403);
        await st.put('invite', { hash: body.hash, expires: body.expires });
        return reply(200);
      }
      if (path === '/join') {
        if (!ws) return reply(404);
        const inv = await st.get<{ hash: string; expires: number }>('invite');
        if (!inv || inv.hash !== body.hash || inv.expires < Date.now()) return reply(403);
        if (ws.owner !== body.user && !ws.members.includes(body.user)) {
          await st.put('ws', { ...ws, members: [...ws.members, body.user] });
        }
        return reply(200, { members: ws.members });
      }
      return reply(404);
    });
  }
}

/** Counts requests in a one-minute window. */
export class Limiter extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const body = (await req.json()) as { max: number; windowMs: number };
    return this.ctx.blockConcurrencyWhile(async () => {
      const t = Date.now();
      let w = (await this.ctx.storage.get<{ start: number; count: number }>('w')) ?? { start: t, count: 0 };
      if (t - w.start > body.windowMs) w = { start: t, count: 0 };
      w.count += 1;
      await this.ctx.storage.put('w', w);
      return new Response('{}', { status: w.count <= body.max ? 200 : 429, headers: { 'Content-Type': 'application/json' } });
    });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return json(env, null, 204);
    const parts = new URL(req.url).pathname.split('/').filter(Boolean);
    try {
      if (parts[0] !== 'api') throw new HttpError(404, 'Не постои.');
      if (req.method === 'POST' && parts.length === 2 && parts[1] === 'register') return await register(env, req);
      if (req.method === 'POST' && parts.length === 2 && parts[1] === 'login') return await login(env, req);
      if (req.method === 'GET' && parts.length === 2 && parts[1] === 'me') {
        const user = await userFromToken(env, req);
        if (!user) throw new HttpError(401, 'Најави се.');
        const admins = env.ADMINS.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
        return json(env, { username: user, admin: admins.includes(user) });
      }
      if (parts[1] === 'ws' && parts.length === 3) {
        const name = parts[2].toLowerCase();
        if (req.method === 'GET') return await getWorkspace(env, req, name);
        if (req.method === 'PUT') return await saveWorkspace(env, req, name);
      }
      if (parts[1] === 'ws' && parts.length === 4 && parts[3] === 'invite' && req.method === 'POST') {
        return await invite(env, req, parts[2].toLowerCase());
      }
      if (parts.length === 2 && parts[1] === 'join' && req.method === 'POST') return await join(env, req);
      throw new HttpError(404, 'Не постои.');
    } catch (e) {
      if (e instanceof HttpError) return json(env, { error: e.message }, e.status);
      return json(env, { error: 'Серверот има проблем. Обиди се повторно.' }, 500);
    }
  },
};
