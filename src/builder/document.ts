// The document: what you are editing, where it is kept, and how you save and open it.
// Like a drawing app:
// - Save overwrites the document's newest version. If you opened an older version, Save keeps it as a new version.
// - Save as… names a new version on your account, or saves a copy to this computer.
// - Versions are the named snapshots of your work on your account (up to 5).
// - Share makes a code (and a link) for a friend. Open loads your work, a code, the published game or a file.
import * as cloud from '../shared/cloud';
import { mountAuthForm, verifyAccount } from '../shared/auth-form';
import { shortDate } from '../shared/dates';
import { loadItems } from '../game/items';
import type { UserItem } from '../game/render/userItems';

interface Options {
  getItems: () => UserItem[];
  /** Replaces what the builder shows, clears the undo history and marks it saved. */
  setItems: (items: UserItem[]) => void;
  isDirty: () => boolean;
  markClean: () => void;
  onChange: () => void;
  msg: (text: string) => void;
  onSignedIn?: () => void;
}

export type DocKind = 'none' | 'work' | 'copy' | 'file';
export interface Doc { kind: DocKind; work: string; owner: string; version: number; latest: number; file: string; versions: cloud.VersionMeta[] }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORK_KEY = 'builder.work';
const BASE = import.meta.env.BASE_URL;

export interface DocApi {
  state(): Doc;
  /** The name shown in the toolbar. */
  title(): string;
  /** Short status for the toolbar: unsaved, saved, on this computer. */
  statusText(dirty: boolean): string;
  save(): Promise<boolean>;
  start(): Promise<void>;
  signOut(): void;
  /** Lets other parts of the builder ask the same question the sheets ask. */
  choose(title: string, text: string, labels: string[]): Promise<number>;
  /** Five seconds to change your mind before a destructive action. */
  countdown(seconds: number): Promise<boolean>;
  surveyor(): string;
}

export function initDocument(o: Options): DocApi {
  const doc: Doc = { kind: 'none', work: '', owner: '', version: 0, latest: 0, file: '', versions: [] };
  let me: { username: string; admin: boolean } | null = null;
  let form: ReturnType<typeof mountAuthForm> | null = null;

  const fail = (e: unknown) => o.msg(e instanceof cloud.CloudError ? e.message : 'Нешто не е во ред.');
  const whoAmI = async () => {
    if (me) return me;
    if (!cloud.account()) return null;
    try { me = await cloud.me(); } catch { me = null; }
    return me;
  };
  /** Your own work: your username. The admin's own work is the published map. */
  const defaultWork = async () => {
    const m = await whoAmI();
    return !m ? '' : m.admin ? 'published' : m.username;
  };
  const surveyor = () => cloud.account()?.username ?? 'builder';

  // ---------- the dialogs ----------
  /** A question with clear answers: the last label is the one that cancels. Resolves with the index chosen. */
  function choose(title: string, text: string, labels: string[]): Promise<number> {
    return new Promise((resolve) => {
      $('choiceTitle').textContent = title;
      $('choiceText').textContent = text;
      const box = $('choiceBtns');
      box.innerHTML = '';
      labels.forEach((label, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.className = i === 0 ? 'btn btn-primary btn-lg' : i === labels.length - 1 ? 'btn btn-lg btn-plain' : 'btn btn-lg';
        b.addEventListener('click', () => { $('choiceDlg').hidden = true; resolve(i); });
        box.appendChild(b);
      });
      $('choiceDlg').hidden = false;
    });
  }

  // ---------- what the toolbar and the versions list show ----------
  const nameOf = () => {
    if (doc.kind === 'work') return doc.work === 'published' ? 'Објавена игра' : `${doc.work}${doc.version ? ` · верзија ${doc.version}` : ''}`;
    if (doc.kind === 'copy') return 'Копија од објавената игра';
    if (doc.kind === 'file') return doc.file;
    return 'Нова работа';
  };
  function refresh() {
    $('docName').textContent = nameOf();
    $('docTitle').textContent = nameOf();
    $('docWho').textContent = doc.kind !== 'work' ? '' : doc.owner === me?.username ? 'твоја работа' : doc.owner ? `споделена од ${doc.owner}` : '';
    const list = $('verList');
    list.innerHTML = '';
    if (doc.kind !== 'work') {
      $('verEmpty').textContent = 'Верзиите се на твојот профил. Користи „Зачувај како…“ за да зачуваш тука.';
    } else {
      $('verEmpty').textContent = doc.versions.length ? '' : 'Уште нема верзии. Зачувај за да се создаде првата.';
      [...doc.versions].reverse().forEach((v) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ver-row';
        b.setAttribute('aria-current', String(v.version === doc.version));
        const t = document.createElement('span'); t.className = 'ver-title';
        t.textContent = `${v.label || `Верзија ${v.version}`}${v.version === doc.latest ? ' · најнова' : ''}`;
        const s = document.createElement('small'); s.className = 'ver-sub';
        s.textContent = `${v.count} ставки · ${shortDate(v.savedAt)}`;
        b.append(t, s);
        b.addEventListener('click', () => void openVersion(v.version));
        list.appendChild(b);
      });
    }
    o.onChange();
  }

  // ---------- loading ----------
  /** Shows a saved version of a work. Without a version, the newest. A new work that is not saved yet keeps what is open. */
  async function openWork(name: string, version?: number): Promise<boolean> {
    const a = cloud.account();
    if (!a) { o.msg('Најави се прво.'); return false; }
    try {
      const w = await cloud.loadWorkspace(name, version);
      Object.assign(doc, { kind: 'work', work: w.name, owner: w.owner, version: w.version, latest: w.latest, file: '', versions: w.versions });
      const items = (w.data as { items?: UserItem[] } | null)?.items;
      o.setItems(Array.isArray(items) ? items : []);
      localStorage.setItem(WORK_KEY, JSON.stringify({ user: a.username, work: name }));
      refresh();
      return true;
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 404 && version === undefined) {
        // not saved yet: it is yours when it has your own name; its first save creates it
        const own = name === (await defaultWork());
        Object.assign(doc, { kind: 'work', work: name, owner: own ? a.username : '', version: 0, latest: 0, file: '', versions: [] });
        localStorage.setItem(WORK_KEY, JSON.stringify({ user: a.username, work: name }));
        refresh();
        return true;
      }
      fail(e);
      return false;
    }
  }
  async function openVersion(v: number) {
    if (v === doc.version || doc.kind !== 'work') return;
    if (o.isDirty() && !(await guard())) return;
    if (await openWork(doc.work, v)) o.msg(`Отворена е верзија ${v}`);
  }
  /** Hard reset: the open items become the published game. Your saved versions stay as they are. */
  async function hardReset() {
    const i = await choose('Ресетирај на објавената игра?', 'Ова ги заменува ставките во отворената работа со објавената игра. Зачуваните верзии на профилот остануваат.', ['Продолжи', 'Откажи']);
    if (i !== 0) return;
    if (!(await countdown(5))) { o.msg('Ресетирањето е откажано'); return; }
    const f = await loadItems();
    if (!f) { o.msg('Објавената игра не е достапна.'); return; }
    o.setItems(f.items as UserItem[]);
    Object.assign(doc, { kind: 'copy', work: '', owner: '', version: 0, latest: 0, file: '', versions: [] });
    refresh();
    o.msg('Ресетирано на објавената игра. Зачувај како… за да ја зачуваш.');
  }
  /** Five seconds to change your mind. Resolves true when it runs out; cancel resolves false. */
  function countdown(seconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      $('choiceTitle').textContent = 'Ресетирање';
      $('choiceText').textContent = 'Ресетирањето почнува по неколку секунди. Откажи за да останеш.';
      const box = $('choiceBtns');
      box.innerHTML = '';
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'btn btn-lg btn-danger';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn btn-primary btn-lg'; cancel.textContent = 'Откажи';
      box.append(cancel, go);
      let left = seconds;
      go.textContent = `Ресетирај за ${left}…`;
      $('choiceDlg').hidden = false;
      const finish = (ok: boolean) => { clearInterval(timer); $('choiceDlg').hidden = true; resolve(ok); };
      const timer = window.setInterval(() => {
        left -= 1;
        if (left <= 0) finish(true);
        else go.textContent = `Ресетирај за ${left}…`;
      }, 1000);
      cancel.addEventListener('click', () => finish(false));
      go.addEventListener('click', () => finish(true));
    });
  }
  async function openFile(file: File) {
    let d: any;
    try { d = JSON.parse(await file.text()); } catch { o.msg('Датотеката не е исправна.'); return; }
    let items: UserItem[] | null = null;
    if (d && d.format === 'krug-builder-session' && Array.isArray(d.recs)) items = d.recs;
    else if (d && d.format === 'mapng-mod' && Array.isArray(d.items)) items = d.items;
    if (!items) { o.msg('Датотеката не е проект ниту извоз.'); return; }
    o.setItems(items);
    Object.assign(doc, { kind: 'file', work: '', owner: '', version: 0, latest: 0, file: file.name, versions: [] });
    refresh();
    o.msg(`Отворено: ${file.name} · ${items.length} ставки`);
  }

  // ---------- saving ----------
  /** Writes the open items to the work. 'overwrite' replaces the newest version; 'new' adds a named one. */
  async function saveToAccount(mode: 'overwrite' | 'new', label?: string): Promise<boolean> {
    const m = await whoAmI();
    if (!m) { o.msg('Најави се за да зачуваш.'); return false; }
    const work = doc.kind === 'work' ? doc.work : await defaultWork();
    const publishing = work === 'published';
    if (publishing && !(await confirmPublish())) return false;
    const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: surveyor(), items: o.getItems() };
    try {
      const base = doc.kind === 'work' && doc.work === work ? doc.latest : 0;
      const r = await cloud.saveWorkspace(work, data, base, { mode, label });
      Object.assign(doc, { kind: 'work', work, owner: doc.owner || m.username, version: r.version, latest: r.version, file: '' });
      await reloadList();
      o.markClean();
      const dropped = r.dropped ? ` · најстарата верзија (${r.dropped}) е избришана, лимит 5` : '';
      o.msg(publishing ? `Објавено за сите · верзија ${r.version}` : mode === 'new' ? `Зачувана е верзија ${r.version}${dropped}` : `Зачувано · верзија ${r.version}`);
      return true;
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 409) o.msg('Некој зачувал во меѓувреме. Отвори ја најновата верзија и обиди се повторно.');
      else fail(e);
      return false;
    }
  }
  /** The newest versions from the server (names, dates, counts). */
  async function reloadList() {
    if (doc.kind !== 'work') return;
    try {
      const w = await cloud.loadWorkspace(doc.work);
      doc.versions = w.versions; doc.latest = w.latest;
      refresh();
    } catch { /* the list is refreshed on the next change */ }
  }
  async function confirmPublish(): Promise<boolean> {
    const i = await choose('Објавување', 'Ова ќе ја промени играта за сите играчи.', ['Објави', 'Откажи']);
    return i === 0;
  }

  /** Saves as a copy file on this computer: a plain JSON file with the items. */
  function downloadFile(name?: string) {
    const s = { format: 'krug-builder-session', version: 1, savedAt: new Date().toISOString(), surveyor: surveyor(), nextId: 1, recs: o.getItems() };
    const file = name || `krug_${surveyor().replace(/\W+/g, '_')}_${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = file; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    o.msg(`Зачувано на компјутерот · ${file}`);
  }

  /** Save: writes to where the document is kept. A file or a copy asks where to keep it first. */
  async function save(): Promise<boolean> {
    if (doc.kind === 'work') {
      // on an older version, Save keeps it as a new version: the newest one is never overwritten by accident
      return saveToAccount(doc.version === doc.latest ? 'overwrite' : 'new');
    }
    if (doc.kind === 'file') { downloadFile(doc.file); o.markClean(); return true; }
    return saveAs();
  }

  // ---------- Save as: a sheet ----------
  let saveAsResolve: ((ok: boolean) => void) | null = null;
  let where: 'cloud' | 'computer' = 'cloud';
  const setWhere = (w: 'cloud' | 'computer') => {
    where = w;
    document.querySelectorAll<HTMLElement>('#saveAsWhere button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.where === w)));
    $('saveAsNote').textContent = w === 'cloud'
      ? (doc.kind === 'work' ? `Зачувај како нова верзија на „${doc.work}“. Најмногу 5 верзии.` : 'Зачувај како нова верзија на твојот профил. Најмногу 5 верзии.')
      : 'Датотека .json на компјутерот. Не се меша со верзиите на профилот.';
  };
  function saveAs(): Promise<boolean> {
    return new Promise((resolve) => {
      saveAsResolve = resolve;
      ($('saveAsName') as HTMLInputElement).value = '';
      setWhere(cloud.account() ? 'cloud' : 'computer');
      $('saveAsDlg').hidden = false;
      setTimeout(() => $('saveAsName').focus(), 0);
    });
  }
  function closeSaveAs(ok: boolean) { $('saveAsDlg').hidden = true; const r = saveAsResolve; saveAsResolve = null; r?.(ok); }

  // ---------- share: a code (and a link) for a friend ----------
  async function openShare() {
    // a friend can only join a work on your account: an unsaved document is saved to it first
    if (doc.kind !== 'work' && !(await saveAs())) return;
    $('shareCodeBox').hidden = true; $('shareCopy').hidden = true; $('shareLink').hidden = true;
    $('shareMake').hidden = false;
    $('shareText').textContent = `Создај код за „${doc.work}“ и испрати го. Пријателот го внесува во Отвори → Со код од пријател и ја добива работата. Кодот важи 7 дена.`;
    $('shareDlg').hidden = false;
  }
  let shareCode = '';
  async function makeCode() {
    if (doc.kind !== 'work') return;
    try {
      const r = await cloud.createCode(doc.work);
      shareCode = r.code;
      $('shareCode').textContent = r.code;
      $('shareCodeBox').hidden = false;
      $('shareCopy').hidden = false; $('shareLink').hidden = false; $('shareMake').hidden = true;
      $('shareText').textContent = 'Кодот важи 7 дена. Нов код го поништува стариот.';
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 404) o.msg('Прво зачувај ја работата, па создај код.');
      else fail(e);
    }
  }
  async function copy(text: string, done: string) {
    try { await navigator.clipboard.writeText(text); o.msg(done); } catch { o.msg(text); }
  }

  // ---------- open: a sheet ----------
  function openSheet() { $('openDlg').hidden = false; }
  /** Before anything replaces the open items: unsaved changes are saved, dropped, or kept (cancel). */
  async function guard(): Promise<boolean> {
    if (!o.isDirty()) return true;
    const i = await choose('Незачувани промени', 'Зачувај ги промените пред да отвориш друго?', ['Зачувај и продолжи', 'Продолжи без зачувување', 'Откажи']);
    if (i === 0) return save();
    return i === 1;
  }
  async function joinCode(code: string) {
    try {
      const r = await cloud.joinWithCode(code);
      if (await openWork(r.name)) o.msg(`Додаден си во „${r.name}“`);
    } catch (e) { fail(e); }
  }

  // ---------- wiring ----------
  // signed in: the sign-in form goes away and the work opens
  form = mountAuthForm($('authBoxB'), () => { who(); refresh(); void start(); o.onSignedIn?.(); });
  $('gateLogout').addEventListener('click', () => { cloud.setAccount(null); me = null; who(); o.msg('Одјавен си'); });

  document.querySelectorAll<HTMLElement>('#saveAsWhere button').forEach((b) => b.addEventListener('click', () => setWhere(b.dataset.where as 'cloud' | 'computer')));
  $('saveAsCancel').addEventListener('click', () => closeSaveAs(false));
  $('saveAsGo').addEventListener('click', async () => {
    const name = ($('saveAsName') as HTMLInputElement).value.trim() || undefined;
    if (where === 'computer') { downloadFile(); closeSaveAs(true); return; }
    if (!cloud.account()) { o.msg('Најави се за да зачуваш на профилот.'); closeSaveAs(false); return; }
    const ok = await saveToAccount('new', name);
    if (ok) closeSaveAs(true);
  });
  $('saveAsDlg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeSaveAs(false); });

  $('shareMake').addEventListener('click', () => void makeCode());
  $('shareCopy').addEventListener('click', () => void copy(shareCode, 'Кодот е копиран'));
  $('shareLink').addEventListener('click', () => void copy(`${location.origin}${BASE}build/?join=${encodeURIComponent(shareCode)}`, 'Линкот е копиран. Пријателот се најавува и го внесува кодот.'));
  $('shareClose').addEventListener('click', () => { $('shareDlg').hidden = true; });
  $('shareDlg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) $('shareDlg').hidden = true; });

  $('openClose').addEventListener('click', () => { $('openDlg').hidden = true; });
  $('openDlg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) $('openDlg').hidden = true; });
  $('openMine').addEventListener('click', async () => {
    $('openDlg').hidden = true;
    if (!(await guard())) return;
    await openWork(await defaultWork());
  });
  $('openCodeGo').addEventListener('click', async () => {
    const code = ($('openCode') as HTMLInputElement).value;
    if (!code.trim()) { o.msg('Внеси код.'); return; }
    $('openDlg').hidden = true;
    if (!(await guard())) return;
    await joinCode(code);
    ($('openCode') as HTMLInputElement).value = '';
  });
  $('openFile').addEventListener('click', () => { $('openDlg').hidden = true; $('openFileInput').click(); });
  $('openFileInput').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!(await guard())) return;
    await openFile(file);
  });

  // the visible ways in: the Open button, and the start sheet for someone with a friend's code
  $('openBtn').addEventListener('click', openSheet);
  $('shareBtn').addEventListener('click', () => void openShare());
  $('gateCode').addEventListener('click', () => { $('gate').style.display = 'none'; openSheet(); });

  // the File menu
  const menu = $('fileMenu');
  const fileBtn = $('fileBtn');
  const closeMenu = () => { menu.hidden = true; fileBtn.setAttribute('aria-expanded', 'false'); };
  fileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    fileBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== fileBtn) closeMenu(); });
  menu.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (!['open', 'save', 'saveas', 'computer', 'share', 'logout', 'reset'].includes(act!)) return; // the builder handles the rest
    closeMenu();
    if (act === 'open') { openSheet(); return; }
    if (act === 'save') { await save(); return; }
    if (act === 'saveas') { await saveAs(); return; }
    if (act === 'computer') { downloadFile(); return; }
    if (act === 'share') { await openShare(); return; }
    if (act === 'logout') { cloud.setAccount(null); location.reload(); }
    if (act === 'reset') { await hardReset(); return; }
  });
  // the shortcuts of the same actions
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.code === 'KeyS' && !e.shiftKey) { e.preventDefault(); void save(); }
    else if (e.code === 'KeyS' && e.shiftKey) { e.preventDefault(); void saveAs(); }
    else if (e.code === 'KeyO') { e.preventDefault(); openSheet(); }
  });

  // ---------- the sign-in start, the account, and the first document ----------
  function who() {
    const a = cloud.account();
    const initial = a ? a.username.slice(0, 1) : '';
    $('cAuth').hidden = !!a;
    if (!a) form?.show();
    $('gateSigned').hidden = !a;
    $('gateGo').hidden = !a;
    $('gateLead').textContent = a ? 'Твојата игра се отвора од профилот.' : 'Направи профил или најави се за да додаваш сообраќајни знаци.';
    $('gateUser').textContent = a?.username ?? '';
    $('gateAvatar').textContent = initial;
    ($('startBtn') as HTMLButtonElement).disabled = !a;
    ($('gateCode') as HTMLButtonElement).disabled = !a;
    $('menuWho').textContent = a ? `Најавен си како ${a.username}` : '';
  }
  /** Once the map is ready: open the work you had last, or your own. */
  async function start() {
    const a = cloud.account();
    if (!a) return;
    const saved = (() => { try { return JSON.parse(localStorage.getItem(WORK_KEY) ?? 'null') as { user: string; work: string } | null; } catch { return null; } })();
    const name = saved && saved.user === a.username ? saved.work : await defaultWork();
    await openWork(name);
  }

  who();
  refresh();
  void verifyAccount().then(() => who());

  return {
    state: () => doc,
    title: nameOf,
    statusText(dirty) {
      if (dirty) return 'Незачувано';
      if (doc.kind === 'work') return 'Зачувано';
      if (doc.kind === 'file') return 'На компјутерот';
      return '';
    },
    save,
    start,
    signOut() { cloud.setAccount(null); location.reload(); },
    choose,
    countdown,
    surveyor,
  };
}
