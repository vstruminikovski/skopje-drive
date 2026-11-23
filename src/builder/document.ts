// The document: the work you are editing. One saved version, and automatic backups.
// - Save writes your work (the one saved version).
// - Every 10 minutes a backup is kept when the work changed; the newest 5 are kept.
// - Restore from backup opens a backup as your work (you still save it).
// - Share makes a code for a friend. Open loads your work, a friend's code or a file.
import * as cloud from '../shared/cloud';
import { mountAuthForm, verifyAccount } from '../shared/auth-form';
import { shortDate } from '../shared/dates';
import type { UserItem } from '../game/render/userItems';

interface Options {
  getItems: () => UserItem[];
  /** Replaces what the builder shows, clears the undo history. */
  setItems: (items: UserItem[]) => void;
  isDirty: () => boolean;
  setDirty: (dirty: boolean) => void;
  onChange: () => void;
  msg: (text: string) => void;
  onSignedIn?: () => void;
}

export type DocKind = 'none' | 'work' | 'file';
export interface Doc { kind: DocKind; work: string; owner: string; file: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORK_KEY = 'builder.work';
const BACKUP_EVERY = 10 * 60 * 1000;

export interface DocApi {
  statusText(dirty: boolean): string;
  save(): Promise<boolean>;
  start(): Promise<void>;
  /** A question with clear answers: the last label is the one that cancels. Resolves with the index chosen. */
  choose(title: string, text: string, labels: string[]): Promise<number>;
  /** Five seconds to change your mind before a destructive action. Resolves true when it runs out. */
  countdown(seconds: number): Promise<boolean>;
  surveyor(): string;
}

export function initDocument(o: Options): DocApi {
  const doc: Doc = { kind: 'none', work: '', owner: '', file: '' };
  let me: { username: string; admin: boolean } | null = null;
  let backups: cloud.BackupMeta[] = [];
  /** The items as last written to the account (saved or backed up): a backup is only taken when this changed. */
  let lastWritten = '';
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

  // ---------- the questions ----------
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
  function countdown(seconds: number): Promise<boolean> {
    return new Promise((resolve) => {
      $('choiceTitle').textContent = 'Бришење';
      $('choiceText').textContent = 'Почнува по неколку секунди. Откажи за да останеш.';
      const box = $('choiceBtns');
      box.innerHTML = '';
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'btn btn-lg btn-danger';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn btn-primary btn-lg'; cancel.textContent = 'Откажи';
      box.append(cancel, go);
      let left = seconds;
      go.textContent = `Избриши за ${left}…`;
      $('choiceDlg').hidden = false;
      const finish = (ok: boolean) => { clearInterval(timer); $('choiceDlg').hidden = true; resolve(ok); };
      const timer = window.setInterval(() => {
        left -= 1;
        if (left <= 0) finish(true);
        else go.textContent = `Избриши за ${left}…`;
      }, 1000);
      cancel.addEventListener('click', () => finish(false));
      go.addEventListener('click', () => finish(true));
    });
  }
  /** Before anything replaces the open items: unsaved changes are saved, dropped, or kept (cancel). */
  async function guard(): Promise<boolean> {
    if (!o.isDirty()) return true;
    const i = await choose('Незачувани промени', 'Зачувај ги промените пред да отвориш друго?', ['Зачувај и продолжи', 'Продолжи без зачувување', 'Откажи']);
    if (i === 0) return save();
    return i === 1;
  }

  // ---------- what the toolbar and the menu show ----------
  function refresh() {
    $('docName').textContent = doc.kind === 'work' ? doc.work : doc.kind === 'file' ? doc.file : 'Нова работа';
    $('docName').title = doc.kind !== 'work' ? '' : doc.owner === me?.username ? 'твоја работа' : doc.owner ? `споделена од ${doc.owner}` : '';
    o.onChange();
  }

  // ---------- opening ----------
  async function openWork(name: string): Promise<boolean> {
    const a = cloud.account();
    if (!a) { o.msg('Најави се прво.'); return false; }
    try {
      const w = await cloud.loadWorkspace(name);
      Object.assign(doc, { kind: 'work', work: w.name, owner: w.owner, file: '' });
      backups = w.backups;
      const items = (w.data as { items?: UserItem[] } | null)?.items;
      o.setItems(Array.isArray(items) ? items : []);
      lastWritten = JSON.stringify(o.getItems());
      localStorage.setItem(WORK_KEY, JSON.stringify({ user: a.username, work: name }));
      refresh();
      return true;
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 404) {
        // not saved yet: it is yours when it has your own name; the first save creates it
        Object.assign(doc, { kind: 'work', work: name, owner: name === (await defaultWork()) ? a.username : '', file: '' });
        backups = [];
        localStorage.setItem(WORK_KEY, JSON.stringify({ user: a.username, work: name }));
        refresh();
        return true;
      }
      fail(e);
      return false;
    }
  }
  async function openFile(file: File) {
    let d: any;
    try { d = JSON.parse(await file.text()); } catch { o.msg('Датотеката не е исправна.'); return; }
    let items: UserItem[] | null = null;
    if (d && d.format === 'krug-builder-session' && Array.isArray(d.recs)) items = d.recs;
    else if (d && d.format === 'mapng-mod' && Array.isArray(d.items)) items = d.items;
    if (!items) { o.msg('Датотеката не е проект ниту извоз.'); return; }
    o.setItems(items);
    Object.assign(doc, { kind: 'file', work: '', owner: '', file: file.name });
    backups = [];
    refresh();
    o.msg(`Отворено: ${file.name} · ${items.length} ставки`);
  }
  /** Opens one of the backups as your work. It is not saved until you save it. */
  async function restoreBackup(id: string) {
    try {
      const w = await cloud.loadWorkspace(doc.work, id);
      const items = (w.data as { items?: UserItem[] } | null)?.items;
      o.setItems(Array.isArray(items) ? items : []);
      o.setDirty(true);
      refresh();
      o.msg('Бекапот е вратен. Зачувај за да стане твојата работа.');
    } catch (e) { fail(e); }
  }
  async function backupsMenu() {
    if (doc.kind !== 'work') { o.msg('Бекапите се на зачувана работа.'); return; }
    if (!backups.length) { o.msg('Уште нема бекапи. Се прават на секои 10 минути.'); return; }
    if (o.isDirty() && !(await guard())) return;
    const list = [...backups].reverse();
    const i = await choose('Врати од бекап', 'Избери бекап. Ставките во отворената работа се заменуваат; потоа зачувај.', [...list.map((b) => `${shortDate(b.savedAt)} · ${b.count} ставки`), 'Откажи']);
    if (i < list.length) await restoreBackup(list[i].id);
  }

  // ---------- saving ----------
  /** Writes the open items as the saved version of the work, or as a backup next to it. */
  async function saveToAccount(backup = false): Promise<boolean> {
    const m = await whoAmI();
    if (!m) { if (!backup) o.msg('Најави се за да зачуваш.'); return false; }
    const work = doc.kind === 'work' ? doc.work : await defaultWork();
    const publishing = work === 'published' && !backup;
    if (publishing && (await choose('Објавување', 'Ова ќе ја промени играта за сите играчи.', ['Објави', 'Откажи'])) !== 0) return false;
    const items = o.getItems();
    const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: surveyor(), items };
    try {
      await cloud.saveWorkspace(work, data, backup);
      lastWritten = JSON.stringify(items);
      if (backup) { await reloadBackups(work); return true; }
      Object.assign(doc, { kind: 'work', work, owner: doc.owner || m.username, file: '' });
      o.setDirty(false);
      await reloadBackups(work);
      refresh();
      o.msg(publishing ? 'Објавено за сите' : `Зачувано · ${items.length} ставки`);
      return true;
    } catch (e) { if (!backup) fail(e); return false; }
  }
  async function reloadBackups(work: string) {
    try { backups = (await cloud.loadWorkspace(work)).backups; } catch { /* the list is read again next time */ }
  }
  /** Every 10 minutes: a backup of the work, when it changed. Never on the published game. */
  async function autoBackup() {
    if (doc.kind !== 'work' || doc.work === 'published' || !cloud.account()) return;
    if (JSON.stringify(o.getItems()) === lastWritten) return;
    await saveToAccount(true);
  }
  window.setInterval(() => void autoBackup(), BACKUP_EVERY);

  /** Save: the work on your account, or a file (saved again the same way). */
  async function save(): Promise<boolean> {
    if (doc.kind === 'file') { downloadFile(doc.file); o.setDirty(false); return true; }
    return saveToAccount(false);
  }
  /** Saves a copy on this computer: a plain JSON file with the items. */
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

  // ---------- share: a code for a friend ----------
  async function openShare() {
    if (doc.kind !== 'work' && !(await saveToAccount(false))) return;
    $('shareCodeBox').hidden = true; $('shareCopy').hidden = true; $('shareMake').hidden = false;
    $('shareText').textContent = `Создај код за „${doc.work}“ и испрати му го. Пријателот го внесува во Отвори → Со код од пријател. Кодот важи 7 дена.`;
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
      $('shareCopy').hidden = false; $('shareMake').hidden = true;
      $('shareText').textContent = 'Кодот важи 7 дена. Нов код го поништува стариот.';
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 404) o.msg('Прво зачувај ја работата, па создај код.');
      else fail(e);
    }
  }

  // ---------- open: your work, a friend's code, or a file ----------
  async function joinCode(code: string) {
    try {
      const r = await cloud.joinWithCode(code);
      if (await openWork(r.name)) o.msg(`Додаден си во „${r.name}“`);
    } catch (e) { fail(e); }
  }

  // ---------- the sign-in start ----------
  form = mountAuthForm($('authBoxB'), () => { who(); refresh(); void start(); o.onSignedIn?.(); });
  $('gateLogout').addEventListener('click', () => { cloud.setAccount(null); me = null; who(); o.msg('Одјавен си'); });
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
  /** Once the map is ready: open your work, or the one you had open last. */
  async function start() {
    const a = cloud.account();
    if (!a) return;
    const saved = (() => { try { return JSON.parse(localStorage.getItem(WORK_KEY) ?? 'null') as { user: string; work: string } | null; } catch { return null; } })();
    const name = saved && saved.user === a.username ? saved.work : await defaultWork();
    await openWork(name);
  }

  // ---------- the visible ways in: the Open and Share buttons, and the start sheet ----------
  $('openBtn').addEventListener('click', () => { $('openDlg').hidden = false; });
  $('shareBtn').addEventListener('click', () => void openShare());
  $('gateCode').addEventListener('click', () => { $('gate').style.display = 'none'; $('openDlg').hidden = false; });

  // the Open sheet
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

  // the share sheet
  $('shareMake').addEventListener('click', () => void makeCode());
  $('shareCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(shareCode); o.msg('Кодот е копиран'); } catch { o.msg(shareCode); }
  });
  $('shareClose').addEventListener('click', () => { $('shareDlg').hidden = true; });
  $('shareDlg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) $('shareDlg').hidden = true; });

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
    if (!['open', 'save', 'computer', 'backups', 'share', 'logout'].includes(act!)) return; // the builder handles the rest
    closeMenu();
    if (act === 'open') { $('openDlg').hidden = false; return; }
    if (act === 'save') { await save(); return; }
    if (act === 'computer') { downloadFile(); return; }
    if (act === 'backups') { await backupsMenu(); return; }
    if (act === 'share') { await openShare(); return; }
    if (act === 'logout') { cloud.setAccount(null); location.reload(); }
  });
  // the shortcuts of the same actions
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
    if (e.code === 'KeyS') { e.preventDefault(); void save(); }
    else if (e.code === 'KeyO') { e.preventDefault(); $('openDlg').hidden = false; }
  });

  who();
  refresh();
  void verifyAccount().then(() => who());

  return {
    statusText(dirty) {
      if (dirty) return 'Незачувано';
      if (doc.kind === 'work') return 'Зачувано';
      if (doc.kind === 'file') return 'На компјутерот';
      return '';
    },
    save,
    start,
    choose,
    countdown,
    surveyor,
  };
}
