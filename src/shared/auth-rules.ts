// The account rules, shared by the sign-in form and its tests. The server enforces the same rules.
export type AuthMode = 'login' | 'register';

export const USER_RE = /^[a-z0-9_]{3,20}$/;
export const PASS_MIN = 8;
export const PASS_MAX = 200;

/** What the server will store: no spaces around it, lower case. */
export const normalizeUser = (v: string) => v.trim().toLowerCase();

/** The first problem with the form, in Macedonian, or null when it can be sent. */
export function validateAuth(mode: AuthMode, user: string, pass: string, pass2 = ''): string | null {
  const u = normalizeUser(user);
  if (!u) return 'Внеси корисничко име.';
  if (/\s/.test(u)) return 'Корисничкото име нема празни места.';
  if (/[^\x00-\x7f]/.test(u)) return 'Корисничкото име е со латинични букви (на пр. viktor).';
  if (!USER_RE.test(u)) return 'Корисничко име: 3–20 знаци, само букви, цифри или _.';
  if (!pass) return 'Внеси лозинка.';
  if (mode === 'register' && pass.length < PASS_MIN) return `Лозинката мора да има најмалку ${PASS_MIN} знаци.`;
  if (pass.length > PASS_MAX) return 'Лозинката е предолга.';
  if (mode === 'register' && pass !== pass2) return 'Лозинките не се исти.';
  return null;
}
