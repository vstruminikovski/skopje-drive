// Accounts in the builder: the start sheet (sign in first), and the profile and shared-work groups in the "more" panel.
import * as cloud from '../shared/cloud';
import { mountAuthForm, verifyAccount } from '../shared/auth-form';
import type { UserItem } from '../game/render/userItems';

interface Options {
  onSignedIn?: () => void;
  getItems: () => UserItem[];
  onLoad: (items: UserItem[]) => void;
  getSurveyor: () => string;
  msg: (text: string) => void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initCloudPanel(o: Options) {
  let version = 0; // the version you loaded: a save over a newer one is refused
  let form: ReturnType<typeof mountAuthForm> | null = null;
  let name = '';

  const who = () => {
    const a = cloud.account();
    const initial = a ? a.username.slice(0, 1) : '';
    // start sheet: the form while signed out; your name and "Start" once signed in
    $('cAuth').hidden = !!a;
    if (!a) form?.show();
    $('gateSigned').hidden = !a;
    $('gateGo').hidden = !a;
    $('gateLead').textContent = a ? 'Твојата игра се отвора од профилот.' : 'Направи акаунт или најави се за да додаваш сообраќајни знаци.';
    $('gateUser').textContent = a?.username ?? '';
    $('gateAvatar').textContent = initial;
    ($('startBtn') as HTMLButtonElement).disabled = !a; // no building without a sign-in
    ($('gateOpen') as HTMLButtonElement).disabled = !a;
    // the "more" panel
    $('cWho').textContent = a?.username ?? 'Не си најавен';
    $('cAvatar').textContent = initial;
    $('cWork').hidden = !a;
    if (a && !$<HTMLInputElement>('cName').value) $<HTMLInputElement>('cName').value = a.username;
  };
  const link = () => {
    const n = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    $('cLink').textContent = n ? `${location.origin}${import.meta.env.BASE_URL}play/?ws=${n}` : '';
  };
  const fail = (e: unknown) => o.msg(e instanceof cloud.CloudError ? e.message : 'Нешто не е во ред.');

  // signing in or up: the shared form (rules first, one request at a time, messages inside the form)
  form = mountAuthForm($('authBoxB'), () => { who(); o.onSignedIn?.(); });
  $('gateOpen').addEventListener('click', () => $('openProj').click());
  $('gateLogout').addEventListener('click', () => { cloud.setAccount(null); version = 0; who(); o.msg('Одјавен си'); });
  $('cLogout').addEventListener('click', () => { cloud.setAccount(null); location.reload(); }); // signed out: back to the start sheet

  $<HTMLInputElement>('cName').addEventListener('input', () => { version = 0; link(); });

  $('cLoad').addEventListener('click', async () => {
    name = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    try {
      const w = await cloud.loadWorkspace(name);
      const f = w.data as { items?: UserItem[] } | null;
      version = w.version;
      if (f && Array.isArray(f.items)) o.onLoad(f.items);
      link();
      o.msg(`Вчитана „${name}“ · верзија ${w.version} од ${w.savedBy}`);
    } catch (e) { fail(e); }
  });

  $('cSave').addEventListener('click', async () => {
    name = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: o.getSurveyor(), items: o.getItems() };
    try {
      const r = await cloud.saveWorkspace(name, data, version);
      version = r.version;
      link();
      o.msg(`Зачувана „${name}“ · верзија ${r.version}`);
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
    const url = $('cLink').textContent ?? '';
    if (!url) { o.msg('Прво внеси име на работата.'); return; }
    try { await navigator.clipboard.writeText(url); o.msg('Линкот е копиран'); } catch { o.msg(url); }
  });

  $('cName').addEventListener('input', link);
  who();
  link();
  void verifyAccount().then(() => who());
}
