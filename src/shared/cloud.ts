// Talks to the save server (worker/). Accounts are username + password; a signed token is kept in this browser.
// The password is sent only to the server, over HTTPS, and never stored here.

const API = ((import.meta.env.VITE_API as string | undefined) ?? '').replace(/\/$/, '');
const ACCOUNT_KEY = 'skopje.account';

export interface Account { username: string; token: string }
/** One saved version of a work. A work keeps its newest 5. */
export interface VersionMeta { version: number; savedAt: string; savedBy: string; count: number }
/** A work as the server gives it: `data` is the version asked for (the newest by default), `latest` the newest number. */
export interface Workspace { name: string; owner: string; members: string[]; latest: number; version: number; savedAt: string; savedBy: string; data: unknown; versions: VersionMeta[] }

export class CloudError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function account(): Account | null {
  try {
    const v = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null') as Account | null;
    return v && v.username && v.token ? v : null;
  } catch { return null; }
}
export function setAccount(a: Account | null) {
  try { if (a) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)); else localStorage.removeItem(ACCOUNT_KEY); } catch { /* private mode: just not remembered */ }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API) throw new CloudError('Серверот не е поставен во оваа верзија.', 0);
  let res: Response;
  try {
    res = await fetch(API + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new CloudError('Нема врска со серверот. Провери ја интернет-врската.', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new CloudError(body.error ?? 'Нешто не е во ред.', res.status);
  return body as T;
}

const auth = (): Record<string, string> => {
  const a = account();
  return a ? { Authorization: `Bearer ${a.token}` } : {};
};

export function register(username: string, password: string, turnstile?: string) {
  return call<{ username: string; token: string }>('/api/register', { method: 'POST', body: JSON.stringify({ username, password, turnstile }) });
}
export function login(username: string, password: string, turnstile?: string) {
  return call<{ username: string; token: string }>('/api/login', { method: 'POST', body: JSON.stringify({ username, password, turnstile }) });
}
/** Opens a work. Without `version` it gives the newest version. */
export function loadWorkspace(name: string, version?: number) {
  const q = version ? `?v=${version}` : '';
  return call<Workspace>(`/api/ws/${encodeURIComponent(name)}${q}`, { headers: auth() });
}
export function saveWorkspace(name: string, data: unknown, baseVersion: number) {
  return call<{ name: string; version: number; savedAt: string; dropped?: number }>(`/api/ws/${encodeURIComponent(name)}`, {
    method: 'PUT', headers: auth(), body: JSON.stringify({ data, baseVersion }),
  });
}
/** A join code for one work: only its owner can make one, and a new one replaces the old. */
export function createCode(name: string) {
  return call<{ name: string; code: string; expiresAt: string }>(`/api/ws/${encodeURIComponent(name)}/invite`, {
    method: 'POST', headers: auth(), body: '{}',
  });
}
/** Types a join code: the signed-in user is added to that work. */
export function joinWithCode(code: string) {
  return call<{ name: string }>('/api/join', { method: 'POST', headers: auth(), body: JSON.stringify({ code }) });
}
export function me() {
  return call<{ username: string; admin: boolean }>('/api/me', { headers: auth() });
}
