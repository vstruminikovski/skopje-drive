// The Cloud panel: sign in, load and save a shared workspace, share it, and copy the play link.
import * as cloud from '../shared/cloud';
import type { UserItem } from '../game/render/userItems';

interface Options {
  getItems: () => UserItem[];
  onLoad: (items: UserItem[]) => void;
  getSurveyor: () => string;
  msg: (text: string) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initCloudPanel(o: Options) {
  let version = 0; // the version you loaded: a save over a newer one is refused
  let name = '';

  const who = () => {
    const a = cloud.account();
    $('cWho').textContent = a ? `Најавен си како ${a.username}` : 'Не си најавен';
    $('cAuth').hidden = !!a;
    ($('startBtn') as HTMLButtonElement).disabled = !a; // no building without a sign-in
    $('cWork').hidden = !a;
    if (a && !$<HTMLInputElement>('cName').value) $<HTMLInputElement>('cName').value = a.username;
  };
  const link = () => {
    const n = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    $('cLink').textContent = n ? `Линк за играње: ${location.origin}${import.meta.env.BASE_URL}play/?ws=${n}` : '';
  };
  const fail = (e: unknown) => o.msg(e instanceof cloud.CloudError ? e.message : 'Нешто не е во ред.');

  // Turnstile (optional): when a site key is set, signing in or up needs a quick check that you are a person
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '';
  let widget: string | null = null;
  if (siteKey) {
    const s2 = document.createElement('script');
    s2.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s2.async = true;
    s2.onload = () => {
      const t = (window as unknown as { turnstile?: { render: (el: string, o: object) => string } }).turnstile;
      if (t) widget = t.render('#cTurnstile', { sitekey: siteKey });
    };
    document.head.appendChild(s2);
  }
  const check = () => {
    if (!siteKey) return '';
    const t = (window as unknown as { turnstile?: { getResponse: (id: string) => string } }).turnstile;
    return widget && t ? t.getResponse(widget) : '';
  };
  const resetCheck = () => {
    const t = (window as unknown as { turnstile?: { reset: (id: string) => void } }).turnstile;
    if (widget && t) t.reset(widget);
  };

  async function signIn(register: boolean) {
    const username = $<HTMLInputElement>('cUser').value.trim().toLowerCase();
    const password = $<HTMLInputElement>('cPass').value;
    const token = check();
    if (siteKey && !token) { o.msg('Потврди дека си човек, па обиди се.'); return; }
    try {
      const r = register ? await cloud.register(username, password, token) : await cloud.login(username, password, token);
      cloud.setAccount({ username: r.username, token: r.token });
      $<HTMLInputElement>('cPass').value = '';
      who();
      o.msg(register ? `Добредојде, ${r.username}!` : `Добредојде назад, ${r.username}.`);
    } catch (e) { resetCheck(); fail(e); }
  }
  $('cLogin').addEventListener('click', () => void signIn(false));
  $('cRegister').addEventListener('click', () => void signIn(true));
  $('cLogout').addEventListener('click', () => { cloud.setAccount(null); version = 0; who(); o.msg('Одјавен си.'); });
  $('cPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') void signIn(false); });

  $<HTMLInputElement>('cName').addEventListener('input', () => { version = 0; link(); });

  $('cLoad').addEventListener('click', async () => {
    name = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    try {
      const w = await cloud.loadWorkspace(name);
      const f = w.data as { items?: UserItem[] } | null;
      version = w.version;
      if (f && Array.isArray(f.items)) o.onLoad(f.items);
      link();
      o.msg(`Вчитана е „${name}“ · верзија ${w.version}, зачувано од ${w.savedBy}.`);
    } catch (e) { fail(e); }
  });

  $('cSave').addEventListener('click', async () => {
    name = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: o.getSurveyor(), items: o.getItems() };
    try {
      const r = await cloud.saveWorkspace(name, data, version);
      version = r.version;
      link();
      o.msg(`Зачувано во облакот · „${name}“ верзија ${r.version}.`);
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 409) o.msg('Некој зачувал меѓувреме. Прво вчитај ја најновата верзија.');
      else fail(e);
    }
  });

  $('cShareBtn').addEventListener('click', async () => {
    name = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    const who2 = $<HTMLInputElement>('cShare').value.trim().toLowerCase();
    if (!who2) { o.msg('Напиши корисничко име за споделување.'); return; }
    try {
      await cloud.shareWorkspace(name, who2);
      $<HTMLInputElement>('cShare').value = '';
      o.msg(`„${who2}“ може сега да ја уредува „${name}“.`);
    } catch (e) { fail(e); }
  });

  $('cCopy').addEventListener('click', async () => {
    const url = $('cLink').textContent?.replace('Линк за играње: ', '') ?? '';
    if (!url) { o.msg('Прво внеси име на работата.'); return; }
    try { await navigator.clipboard.writeText(url); o.msg('Линкот е копиран.'); } catch { o.msg(url); }
  });

  $('cName').addEventListener('input', link);
  who();
  link();
}
