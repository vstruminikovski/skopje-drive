// The save server for the Skopje drive builder. Runs on Cloudflare Workers; data lives in one KV namespace (SAVES).
// Every person has their own account (username + password, stored as a PBKDF2 hash). Writing needs a signed token.
// Reading a workspace is public, so the Player map can be opened by anyone with a link.

export interface Env {
  SAVES: KVNamespace;
  SECRET: string; // set with: npx wrangler secret put SECRET
  ALLOWED_ORIGIN: string;
  ADMINS: string; // comma-separated usernames that may create workspaces with any name (e.g. player)
}

interface User { salt: string; hash: string; created: string }
interface Workspace { owner: string; members: string[]; version: number; savedAt: string; savedBy: string; data: unknown }

const ITERATIONS = 100_000; // the most Workers allow for PBKDF2
const TOKEN_DAYS = 30;
const MAX_BODY = 2_000_000; // bytes
const USER_RE = /^[a-z0-9_]{3,20}$/;
const WS_RE = /^[a-z0-9-]{3,32}$/;
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...(buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return b64(bits);
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(env.SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** token = username.expiry.signature (stateless: the server keeps no session records, so saves cost no extra writes) */
async function issueToken(env: Env, username: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400;
  const payload = `${username}.${exp}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload));
  return `${payload}.${b64(sig)}`;
}

async function userFromToken(env: Env, req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [username, expText, sigText] = parts;
  if (!USER_RE.test(username) || Number(expText) * 1000 < Date.now()) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64(sigText), enc.encode(`${username}.${expText}`));
  return ok ? username : null;
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

async function readBody(req: Request): Promise<any> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'Податоците се преголеми.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'Невалидно барање.'); }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function register(env: Env, body: any): Promise<Response> {
  const username = String(body.username ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  if (!USER_RE.test(username)) throw new HttpError(400, 'Корисничкото име: 3–20 мали букви, цифри или _.');
  if (password.length < 8) throw new HttpError(400, 'Лозинката мора да има најмалку 8 знаци.');
  if (await env.SAVES.get(`user:${username}`)) throw new HttpError(409, 'Ова корисничко име е зафатено.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const user: User = { salt: b64(salt), hash: await derive(password, salt), created: new Date().toISOString() };
  await env.SAVES.put(`user:${username}`, JSON.stringify(user));
  return json(env, { username, token: await issueToken(env, username) }, 201);
}

async function login(env: Env, body: any): Promise<Response> {
  const username = String(body.username ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  const raw = USER_RE.test(username) ? await env.SAVES.get(`user:${username}`) : null;
  // the same message for a wrong name and a wrong password
  if (!raw) throw new HttpError(401, 'Погрешно корисничко име или лозинка.');
  const user = JSON.parse(raw) as User;
  if ((await derive(password, unb64(user.salt))) !== user.hash) throw new HttpError(401, 'Погрешно корисничко име или лозинка.');
  return json(env, { username, token: await issueToken(env, username) });
}

async function getWorkspace(env: Env, name: string): Promise<Response> {
  const raw = await env.SAVES.get(`ws:${name}`);
  if (!raw) throw new HttpError(404, 'Нема таква работа.');
  return json(env, { name, ...(JSON.parse(raw) as Workspace) });
}

async function saveWorkspace(env: Env, req: Request, name: string): Promise<Response> {
  const user = await userFromToken(env, req);
  if (!user) throw new HttpError(401, 'Најави се за да зачуваш.');
  const body = await readBody(req);
  const baseVersion = Number(body.baseVersion ?? 0);
  const raw = await env.SAVES.get(`ws:${name}`);
  const ws: Workspace = raw ? JSON.parse(raw) : { owner: user, members: [], version: 0, savedAt: '', savedBy: '', data: null };
  if (raw && ws.owner !== user && !ws.members.includes(user)) throw new HttpError(403, 'Немаш пристап до оваа работа.');
  if (!raw && !WS_RE.test(name)) throw new HttpError(400, 'Името на работата: 3–32 мали букви, цифри или црта.');
  // a new workspace takes your own username as its name, so nobody can take a name first; admins may use any name (e.g. player)
  const admins = env.ADMINS.split(',').map((x) => x.trim().toLowerCase());
  if (!raw && name !== user && !admins.includes(user)) throw new HttpError(403, 'Новата работа се создава со твоето корисничко име.');
  // someone else saved since you loaded it: say so instead of overwriting their work
  if (baseVersion !== ws.version) return json(env, { error: 'Некој зачувал меѓувреме.', version: ws.version }, 409);
  const next: Workspace = { ...ws, version: ws.version + 1, savedAt: new Date().toISOString(), savedBy: user, data: body.data };
  await env.SAVES.put(`ws:${name}`, JSON.stringify(next));
  return json(env, { name, version: next.version, savedAt: next.savedAt });
}

async function share(env: Env, req: Request, name: string): Promise<Response> {
  const user = await userFromToken(env, req);
  if (!user) throw new HttpError(401, 'Најави се.');
  const raw = await env.SAVES.get(`ws:${name}`);
  if (!raw) throw new HttpError(404, 'Нема таква работа.');
  const ws = JSON.parse(raw) as Workspace;
  if (ws.owner !== user) throw new HttpError(403, 'Само сопственикот може да споделува.');
  const who = String((await readBody(req)).username ?? '').toLowerCase().trim();
  if (!USER_RE.test(who) || !(await env.SAVES.get(`user:${who}`))) throw new HttpError(404, 'Нема таков корисник.');
  if (!ws.members.includes(who)) ws.members.push(who);
  await env.SAVES.put(`ws:${name}`, JSON.stringify(ws));
  return json(env, { name, members: ws.members });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return json(env, null, 204);
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // api, ...
    try {
      if (parts[0] !== 'api') throw new HttpError(404, 'Не постои.');
      if (req.method === 'POST' && parts[1] === 'register' && parts.length === 2) return await register(env, await readBody(req));
      if (req.method === 'POST' && parts[1] === 'login' && parts.length === 2) return await login(env, await readBody(req));
      if (parts[1] === 'ws' && parts.length === 3) {
        const name = parts[2].toLowerCase();
        if (req.method === 'GET') return await getWorkspace(env, name);
        if (req.method === 'PUT') return await saveWorkspace(env, req, name);
      }
      if (parts[1] === 'ws' && parts.length === 4 && parts[3] === 'share' && req.method === 'POST') {
        return await share(env, req, parts[2].toLowerCase());
      }
      throw new HttpError(404, 'Не постои.');
    } catch (e) {
      if (e instanceof HttpError) return json(env, { error: e.message }, e.status);
      return json(env, { error: 'Серверот има проблем. Обиди се повторно.' }, 500);
    }
  },
};
