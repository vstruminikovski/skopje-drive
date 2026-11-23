// The shared-work panel in the builder.
// - The work is named after its owner: your username (the admin's is the published map).
// - Each work keeps its newest 5 versions; pick one from the list to open it, or save a new one.
// - A join code from someone else opens their work here, so you can save versions to it too.
import * as cloud from '../shared/cloud';
import { mountAuthForm, verifyAccount } from '../shared/auth-form';
import { shortDate } from '../shared/dates';
import type { UserItem } from '../game/render/userItems';

interface Options {
  onSignedIn?: () => void;
  getItems: () => UserItem[];
  onLoad: (items: UserItem[]) => void;
  getSurveyor: () => string;
  msg: (text: string) => void;
}

export interface CloudApi {
  /** Saves the items as a new version of the open work. Throws CloudError when it cannot. */
  save(items: UserItem[]): Promise<{ version: number; dropped: number }>;
  /** The open work's name ('' when nobody is signed in). */
  work(): string;
  /** Opens your work (or the one you had open last). Call once the map is ready. */
  open(): Promise<void>;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORK_KEY = 'builder.work';

export function initCloudPanel(o: Options): CloudApi {
  let form: ReturnType<typeof mountAuthForm> | null = null;
  let work = '';   // the open work
  let latest = 0;  // newest version on the server: a save over a newer one is refused
  let owner = '';  // who owns the open work

  const fail = (e: unknown) => o.msg(e instanceof cloud.CloudError ? e.message : 'Нешто не е во ред.');
  /** Your own work: your username, or the published map for the admin. */
  const myWork = async (): Promise<string> => {
    const a = cloud.account();
    if (!a) return '';
    let admin = false;
    try { admin = (await cloud.me()).admin; } catch { /* the server checks again on save */ }
    return admin ? 'published' : a.username;
  };

  /** Shows the open work and fills its version list (newest first). Returns the loaded version. */
  async function showWork(version?: number) {
    const a = cloud.account();
    $('cWorkName').textContent = work || '—';
    $('cWorkWho').textContent = !work || !a ? '' : owner === a.username ? 'твоја' : 'споделена со тебе';
    if (!a || !work) return null;
    const w = await cloud.loadWorkspace(work, version);
    latest = w.latest;
    owner = w.owner;
    $('cWorkWho').textContent = owner === a.username ? 'твоја' : 'споделена со тебе';
    const sel = $<HTMLSelectElement>('cVersion');
    sel.innerHTML = '';
    [...w.versions].reverse().forEach((v) => {
      const opt = document.createElement('option');
      opt.value = String(v.version);
      opt.textContent = `Верзија ${v.version}${v.version === latest ? ' (најнова)' : ''} · ${v.count} ставки · ${shortDate(v.savedAt)}`;
      sel.appendChild(opt);
    });
    sel.value = String(w.version);
    return w;
  }

  /** Opens a work (yours, or one someone shared with you) and shows its newest version in the builder. */
  async function openWork(name: string) {
    work = name;
    localStorage.setItem(WORK_KEY, JSON.stringify({ user: cloud.account()?.username ?? '', work: name }));
    const w = await showWork();
    if (w && Array.isArray((w.data as { items?: UserItem[] } | null)?.items)) o.onLoad((w.data as { items: UserItem[] }).items);
  }

  const who = () => {
    const a = cloud.account();
    const initial = a ? a.username.slice(0, 1) : '';
    $('cAuth').hidden = !!a;
    if (!a) form?.show();
    $('gateSigned').hidden = !a;
    $('gateGo').hidden = !a;
    $('gateLead').textContent = a ? 'Твојата игра се отвора од профилот.' : 'Направи профил или најави се за да додаваш сообраќајни знаци.';
    $('gateUser').textContent = a?.username ?? '';
    $('gateAvatar').textContent = initial;
    ($('startBtn') as HTMLButtonElement).disabled = !a; // no building without a sign-in
    $('cWho').textContent = a?.username ?? 'Не си најавен';
    $('cAvatar').textContent = initial;
    $('cWork').hidden = !a;
  };

  /** Once signed in: open the work you had last, or your own. */
  async function start() {
    const a = cloud.account();
    if (!a) return;
    const saved = (() => { try { return JSON.parse(localStorage.getItem(WORK_KEY) ?? 'null') as { user: string; work: string } | null; } catch { return null; } })();
    const name = saved && saved.user === a.username ? saved.work : await myWork();
    try { await openWork(name); } catch (e) {
      // not saved yet: the work exists once its first version is saved
      if (e instanceof cloud.CloudError && e.status === 404) {
        // not saved yet: it is yours when it is your own name, and it exists once you save its first version
        work = name;
        owner = name === (await myWork()) ? a.username : '';
        $('cWorkName').textContent = name;
        $('cWorkWho').textContent = owner ? 'твоја (още не е зачувана)' : '';
      }
      else fail(e);
    }
  }

  // signing in or up: the shared form (rules first, one request at a time, messages inside the form)
  form = mountAuthForm($('authBoxB'), () => { who(); o.onSignedIn?.(); });
  $('gateLogout').addEventListener('click', () => { cloud.setAccount(null); who(); o.msg('Одјавен си'); });
  $('cLogout').addEventListener('click', () => { cloud.setAccount(null); location.reload(); }); // signed out: back to the start sheet

  // the version list: pick one to open it
  $('cVersion').addEventListener('change', async () => {
    const v = Number(($('cVersion') as HTMLSelectElement).value);
    try {
      const w = await cloud.loadWorkspace(work, v);
      if (Array.isArray((w.data as { items?: UserItem[] } | null)?.items)) o.onLoad((w.data as { items: UserItem[] }).items);
      o.msg(`Отворена е верзија ${w.version}`);
    } catch (e) { fail(e); }
  });
  $('cSaveVer').addEventListener('click', async () => {
    try {
      const r = await api.save(o.getItems());
      o.msg(`Зачувана е верзија ${r.version}${r.dropped ? ` · најстарата (${r.dropped}) е избришана, лимит 5` : ''}`);
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 409) o.msg('Некој зачувал во меѓувреме. Отвори ја најновата верзија и обиди се повторно.');
      else fail(e);
    }
  });

  // a join code for this work: copied, and typed by the person who should join
  $('cLinkBtn').addEventListener('click', async () => {
    if (!work) { o.msg('Најави се прво.'); return; }
    try {
      const r = await cloud.createCode(work);
      $('cLink').textContent = r.code;
      try { await navigator.clipboard.writeText(r.code); o.msg('Кодот е копиран. Важи 7 дена; нов код го поништува стариот.'); }
      catch { o.msg(`Код: ${r.code}`); }
    } catch (e) {
      // the work is not saved yet: its first version comes first
      if (e instanceof cloud.CloudError && e.status === 404) o.msg('Прво зачувај ја работата (Зачувај), па создај код.');
      else fail(e);
    }
  });
  $('cCopy').addEventListener('click', async () => {
    const code = $('cLink').textContent ?? '';
    if (!code) { o.msg('Прво создај код.'); return; }
    try { await navigator.clipboard.writeText(code); o.msg('Кодот е копиран.'); } catch { o.msg(code); }
  });

  // typing someone's code: join their work, then open it
  const joinNow = async () => {
    const code = $<HTMLInputElement>('cCode').value;
    if (!code.trim()) { o.msg('Внеси код.'); return; }
    if (!cloud.account()) { o.msg('Најави се за да ја отвориш работата.'); return; }
    try {
      const r = await cloud.joinWithCode(code);
      $<HTMLInputElement>('cCode').value = '';
      await openWork(r.name);
      o.msg(`Додаден си во „${r.name}“`);
    } catch (e) { fail(e); }
  };
  $('cJoin').addEventListener('click', joinNow);
  $<HTMLInputElement>('cCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') void joinNow(); });

  const api: CloudApi = {
    work: () => work,
    open: start,
    async save(items) {
      if (!work) throw new cloud.CloudError('Најави се за да зачуваш.', 401);
      const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: o.getSurveyor(), items };
      const r = await cloud.saveWorkspace(work, data, latest);
      latest = r.version;
      await showWork().catch(() => undefined); // refresh the version list
      return { version: r.version, dropped: r.dropped ?? 0 };
    },
  };

  who();
  void verifyAccount().then(() => who());
  return api;
}
