// The game page. Signed out: the published map. Signed in (on any device): your own saved map.
// Only this page loads the game, and the builder stays on desktop.
import { startGame } from '../game/boot';
import * as cloud from '../shared/cloud';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function play(ws: string | null) {
  $('pick').hidden = true;
  $('loading').hidden = false;
  startGame(undefined, { ws });
}

async function start() {
  // a link to a workspace plays that workspace, as before
  const linked = new URLSearchParams(location.search).get('ws');
  if (linked) return play(linked);
  const a = cloud.account();
  if (a) return play(a.username);
  $('loading').hidden = true; // the choice comes first
  $('pick').hidden = false;
  $('guest').addEventListener('click', () => play(null));
  // phones and tablets: only the game button. Accounts and building are for desktops.
  const desktop = matchMedia('(min-width: 900px) and (pointer: fine) and (hover: hover)').matches;
  if (!desktop) { $('pick').classList.add('phone'); return; }
  // the bot check (when a site key is set) is shown on this screen too
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';
  type TS = { render: (el: string, o: object) => string; getResponse: (id: string) => string; reset: (id: string) => void };
  let widget: string | null = null;
  if (siteKey) {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => { const t = (window as unknown as { turnstile?: TS }).turnstile; if (t) widget = t.render('#pTurnstile', { sitekey: siteKey }); };
    document.head.appendChild(s);
  }
  const check = () => {
    const t = (window as unknown as { turnstile?: TS }).turnstile;
    return siteKey && widget && t ? t.getResponse(widget) : '';
  };
  const resetCheck = () => {
    const t = (window as unknown as { turnstile?: TS }).turnstile;
    if (widget && t) t.reset(widget);
  };
  const go = async (register: boolean) => {
    const username = $<HTMLInputElement>('pUser').value.trim().toLowerCase();
    const password = $<HTMLInputElement>('pPass').value;
    const token = check();
    if (siteKey && !token) { $('pErr').textContent = 'Потврди дека си човек, па обиди се.'; return; }
    try {
      const r = register ? await cloud.register(username, password, token) : await cloud.login(username, password, token);
      cloud.setAccount({ username: r.username, token: r.token });
      play(r.username);
    } catch (err) {
      resetCheck();
      $('pErr').textContent = err instanceof cloud.CloudError ? err.message : 'Нешто не е во ред.';
    }
  };
  $('signin').addEventListener('submit', (e) => { e.preventDefault(); void go(false); });
  $('pRegister').addEventListener('click', () => void go(true));
}

void start();
