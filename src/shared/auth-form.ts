// One sign-in / sign-up form for the whole app (game start screen and builder start screen).
// - two clear modes (sign in / create profile); create asks for the password twice
// - checks the rules before anything is sent, so the single-use bot check is never wasted on a typo
// - one request at a time (a double click cannot create the account and then report it as taken)
// - messages appear inside the form, where you are looking
// - the bot check (Cloudflare Turnstile) is drawn only when the form is visible, and renewed after every attempt
import './ui.css';
import './auth-form.css';
import * as cloud from './cloud';
import { normalizeUser, validateAuth, type AuthMode } from './auth-rules';

interface Turnstile {
  render: (el: HTMLElement, o: object) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
const turnstileApi = () => (window as unknown as { turnstile?: Turnstile }).turnstile;
const SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';

let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (turnstileApi()) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface AuthForm {
  /** Shows the form (and draws the bot check the first time). */
  show(mode?: AuthMode): void;
  setMode(mode: AuthMode): void;
  /** Shows a message inside the form. */
  note(text: string): void;
}

/** Checks a remembered sign-in with the server; a sign-in that expired or was revoked is forgotten. */
export async function verifyAccount(): Promise<cloud.Account | null> {
  const a = cloud.account();
  if (!a) return null;
  try {
    const me = await cloud.me();
    return me.username === a.username ? a : null;
  } catch (e) {
    if (e instanceof cloud.CloudError && e.status === 401) { cloud.setAccount(null); return null; }
    return a; // no connection right now: keep it, the server checks again on save
  }
}

export function mountAuthForm(host: HTMLElement, onSignedIn: (a: cloud.Account) => void, initial: AuthMode = 'login'): AuthForm {
  host.innerHTML = `
    <div class="af">
      <div class="seg af-seg" role="tablist" aria-label="Профил">
        <button type="button" role="tab" data-mode="login">Најави се</button>
        <button type="button" role="tab" data-mode="register">Нов профил</button>
      </div>
      <form novalidate>
        <div class="af-group">
          <label class="vh" for="afUser">Корисничко име</label>
          <input id="afUser" class="field" name="username" placeholder="Корисничко име" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40">
          <label class="vh" for="afPass">Лозинка</label>
          <input id="afPass" class="field" name="password" type="password" placeholder="Лозинка" autocomplete="current-password" maxlength="200">
          <label class="vh af-reg" for="afPass2">Повтори ја лозинката</label>
          <input id="afPass2" class="field af-reg" name="password2" type="password" placeholder="Повтори ја лозинката" autocomplete="new-password" maxlength="200">
        </div>
        <small class="af-hint" id="afHint"></small>
        <div class="af-ts" ${SITE_KEY ? '' : 'hidden'}></div>
        <p class="af-msg" role="alert" aria-live="polite"></p>
        <button type="submit" class="btn btn-primary btn-lg af-submit">Најави се</button>
      </form>
    </div>`;
  const q = <T extends HTMLElement>(sel: string) => host.querySelector(sel) as T;
  const user = q<HTMLInputElement>('#afUser');
  const pass = q<HTMLInputElement>('#afPass');
  const pass2 = q<HTMLInputElement>('#afPass2');
  const hint = q('#afHint');
  const regs = Array.from(host.querySelectorAll<HTMLElement>('.af-reg'));
  const tsBox = q('.af-ts');
  const msgEl = q('.af-msg');
  const submit = q<HTMLButtonElement>('.af-submit');
  const tabs = Array.from(host.querySelectorAll<HTMLButtonElement>('.af-seg button'));

  let mode: AuthMode = initial;
  let busy = false;
  let token = '';
  let widget: string | null = null;
  let tsFailed = false;

  const say = (text: string, kind: 'err' | 'ok' | '' = 'err') => { msgEl.textContent = text; msgEl.className = `af-msg ${kind}`; };

  function setMode(m: AuthMode) {
    mode = m;
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    regs.forEach((el) => (el.hidden = m !== 'register'));
    pass.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    pass.placeholder = m === 'register' ? 'Лозинка (најмалку 8 знаци)' : 'Лозинка';
    submit.textContent = m === 'register' ? 'Создај профил' : 'Најави се';
    showHint();
    say('', '');
    [user, pass, pass2].forEach((i) => i.removeAttribute('aria-invalid'));
  }

  // one quiet hint line: the username rule while creating a profile, or what the typed name becomes
  function showHint() {
    const n = normalizeUser(user.value);
    hint.textContent = n && n !== user.value ? `Ќе се најавиш како ${n}` : mode === 'register' ? '3–20 латинични букви, цифри или _' : '';
  }
  user.addEventListener('input', () => { showHint(); user.removeAttribute('aria-invalid'); });
  [pass, pass2].forEach((i) => i.addEventListener('input', () => i.removeAttribute('aria-invalid')));
  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode as AuthMode)));

  async function drawCheck() {
    if (!SITE_KEY || widget || tsFailed) return;
    try {
      await loadTurnstile();
      const t = turnstileApi();
      if (!t) throw new Error('turnstile');
      widget = t.render(tsBox, {
        sitekey: SITE_KEY,
        theme: 'dark',
        size: 'flexible',
        callback: (tk: string) => { token = tk; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; say('Проверката не се вчита. Освежи ја страницата.'); },
      });
    } catch {
      tsFailed = true;
      say('Проверката не може да се вчита (блокирана мрежа или додаток). Обиди се на друга мрежа.');
    }
  }
  /** a check token works once: after every attempt a fresh one is needed */
  function renewCheck() {
    token = '';
    const t = turnstileApi();
    if (widget && t) t.reset(widget);
  }

  q('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const problem = validateAuth(mode, user.value, pass.value, pass2.value);
    if (problem) {
      say(problem);
      const field = /корисничко/i.test(problem) ? user : /исти/.test(problem) ? pass2 : pass;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    if (SITE_KEY && !token) { say(tsFailed ? 'Проверката не е достапна.' : 'Почекај проверката подолу да заврши (или кликни на неа).'); return; }
    busy = true;
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Се испраќа…';
    say('', '');
    const username = normalizeUser(user.value);
    try {
      const r = mode === 'register' ? await cloud.register(username, pass.value, token) : await cloud.login(username, pass.value, token);
      cloud.setAccount({ username: r.username, token: r.token });
      pass.value = ''; pass2.value = '';
      say(mode === 'register' ? `Профилот е создаден. Добредојде, ${r.username}!` : `Добредојде назад, ${r.username}.`, 'ok');
      onSignedIn({ username: r.username, token: r.token });
    } catch (err) {
      const status = err instanceof cloud.CloudError ? err.status : 0;
      if (mode === 'register' && status === 409) { say('Ова корисничко име е зафатено. Избери друго, или најави се ако е твое.'); user.setAttribute('aria-invalid', 'true'); }
      else if (mode === 'login' && status === 401) { say('Погрешно корисничко име или лозинка.'); pass.select(); }
      else say(err instanceof cloud.CloudError ? err.message : 'Нешто не е во ред. Обиди се повторно.');
    } finally {
      renewCheck();
      busy = false;
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  setMode(initial);
  return {
    show(m?: AuthMode) {
      if (m) setMode(m);
      host.hidden = false;
      void drawCheck(); // drawn only once the form is on screen
      setTimeout(() => user.focus(), 0);
    },
    setMode,
    note: (text: string) => say(text),
  };
}
