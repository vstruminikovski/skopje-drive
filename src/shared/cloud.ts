// Talks to the save server (worker/). Accounts are username + password; a signed token is kept in this browser.
// The password is sent only to the server, over HTTPS, and never stored here.

const API = ((import.meta.env.VITE_API as string | undefined) ?? '').replace(/\/$/, '');
const ACCOUNT_KEY = 'skopje.account';

export interface Account { username: string; token: string }
export interface Workspace { name: string; owner: string; members: string[]; version: number; savedAt: string; savedBy: string; data: unknown }

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
export function loadWorkspace(name: string) {
  return call<Workspace>(`/api/ws/${encodeURIComponent(name)}`);
}
export function saveWorkspace(name: string, data: unknown, baseVersion: number) {
  return call<{ name: string; version: number; savedAt: string }>(`/api/ws/${encodeURIComponent(name)}`, {
    method: 'PUT', headers: auth(), body: JSON.stringify({ data, baseVersion }),
  });
}
export function shareWorkspace(name: string, username: string) {
  return call<{ name: string; members: string[] }>(`/api/ws/${encodeURIComponent(name)}/share`, {
    method: 'POST', headers: auth(), body: JSON.stringify({ username }),
  });
}
