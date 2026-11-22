// The Cloud panel: sign in, load and save a shared workspace, share it, and copy the play link.
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
    $('cWho').textContent = a ? `Најавен си како ${a.username}` : 'Не си најавен';
    $('cAuth').hidden = !!a;
    if (!a) form?.show();
    $('gateSigned').hidden = !a;
    $('gateUser').textContent = a ? a.username : '';
    ($('startBtn') as HTMLButtonElement).disabled = !a; // no building without a sign-in
    ($('gateOpen') as HTMLButtonElement).disabled = !a;
    $('cWork').hidden = !a;
    if (a && !$<HTMLInputElement>('cName').value) $<HTMLInputElement>('cName').value = a.username;
  };
  const link = () => {
    const n = $<HTMLInputElement>('cName').value.trim().toLowerCase();
    $('cLink').textContent = n ? `Линк за играње: ${location.origin}${import.meta.env.BASE_URL}play/?ws=${n}` : '';
  };
  const fail = (e: unknown) => o.msg(e instanceof cloud.CloudError ? e.message : 'Нешто не е во ред.');

  // signing in or up: the shared form (rules first, one request at a time, messages inside the form)
  form = mountAuthForm($('authBoxB'), () => { who(); o.onSignedIn?.(); });
  $('gateOpen').addEventListener('click', () => $('openProj').click());
  $('gateLogout').addEventListener('click', () => { cloud.setAccount(null); version = 0; who(); o.msg('Одјавен си. Можеш да создадеш нов профил.'); });
  $('cLogout').addEventListener('click', () => { cloud.setAccount(null); version = 0; who(); o.msg('Одјавен си.'); });

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
  void verifyAccount().then(() => who());
}
