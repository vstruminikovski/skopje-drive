// The document: the work you are editing.
// - Save writes your work on your account (one saved version).
// - Save a local version writes a file to this computer.
// - Share makes a code for a friend. Open loads your work, a friend's code or a file.
// - The administrator can deploy the work to the live game, with 5 seconds to cancel.
import * as cloud from '../shared/cloud';
import { mountAuthForm, verifyAccount } from '../shared/auth-form';
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

export type DocKind = 'none' | 'work';
export interface Doc { kind: DocKind; work: string; owner: string }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WORK_KEY = 'builder.work';

export interface DocApi {
  statusText(dirty: boolean): string;
  save(): Promise<boolean>;
  /** A question with clear answers: the last label is the one that cancels. Resolves with the index chosen. */
  choose(title: string, text: string, labels: string[]): Promise<number>;
  /** Seconds to change your mind before a destructive action. Resolves true when it runs out. */
  countdown(seconds: number, title?: string, text?: string, goLabel?: string): Promise<boolean>;
  surveyor(): string;
}

export function initDocument(o: Options): DocApi {
  const doc: Doc = { kind: 'none', work: '', owner: '' };
  let me: { username: string; admin: boolean } | null = null;
  let form: ReturnType<typeof mountAuthForm> | null = null;

  const fail = (e: unknown) => o.msg(e instanceof cloud.CloudError ? e.message : 'Нешто не е во ред.');
  const whoAmI = async () => {
    if (me) return me;
    if (!cloud.account()) return null;
    try { me = await cloud.me(); } catch { me = null; }
    return me;
  };
  /** Your own work: your username. The live game is only changed by Deploy. */
  const defaultWork = async () => {
    const m = await whoAmI();
    return m ? m.username : '';
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
  function countdown(seconds: number, title = 'Бришење', text = 'Почнува по неколку секунди. Откажи за да останеш.', goLabel = 'Избриши'): Promise<boolean> {
    return new Promise((resolve) => {
      $('choiceTitle').textContent = title;
      $('choiceText').textContent = text;
      const box = $('choiceBtns');
      box.innerHTML = '';
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'btn btn-lg btn-danger';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn btn-primary btn-lg'; cancel.textContent = 'Откажи';
      box.append(cancel, go);
      let left = seconds;
      go.textContent = `${goLabel} за ${left}…`;
      $('choiceDlg').hidden = false;
      const finish = (ok: boolean) => { clearInterval(timer); $('choiceDlg').hidden = true; resolve(ok); };
      const timer = window.setInterval(() => {
        left -= 1;
        if (left <= 0) finish(true);
        else go.textContent = `${goLabel} за ${left}…`;
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
    $('docName').title = doc.kind === 'work' ? (doc.owner === me?.username ? 'Зачувано на твојот профил' : `Зачувано на профилот на ${doc.owner}`) : '';
    o.onChange();
  }

  // ---------- opening ----------
  async function openWork(name: string): Promise<boolean> {
    const a = cloud.account();
    if (!a) { o.msg('Најави се прво.'); return false; }
    try {
      const w = await cloud.loadWorkspace(name);
      Object.assign(doc, { kind: 'work', work: w.name, owner: w.owner });
      const items = (w.data as { items?: UserItem[] } | null)?.items;
      o.setItems(Array.isArray(items) ? items : []);
      localStorage.setItem(WORK_KEY, JSON.stringify({ user: a.username, work: name }));
      refresh();
      return true;
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 404) {
        // not saved yet: it is yours when it has your own name; the first save creates it
        Object.assign(doc, { kind: 'work', work: name, owner: name === (await defaultWork()) ? a.username : '' });
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
    doc.kind = 'none'; doc.work = ''; doc.owner = '';
    refresh();
    o.msg(`Отворено: ${file.name} · ${items.length} ставки`);
  }

  // ---------- saving ----------
  /** Writes the open items as the saved version of your work on your account. */
  async function saveToAccount(): Promise<boolean> {
    const m = await whoAmI();
    if (!m) { o.msg('Најави се за да зачуваш.'); return false; }
    const work = doc.kind === 'work' ? doc.work : await defaultWork();
    const items = o.getItems();
    const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: surveyor(), items };
    try {
      await cloud.saveWorkspace(work, data);
      Object.assign(doc, { kind: 'work', work, owner: doc.owner || m.username });
      o.setDirty(false);
      refresh();
      o.msg(`Зачувано · ${items.length} ставки`);
      return true;
    } catch (e) { fail(e); return false; }
  }
  /** Administrator: the open items become the live game for everyone, after 5 seconds to cancel. */
  async function deployLive(): Promise<void> {
    const m = await whoAmI();
    if (!m?.admin) { o.msg('Само администраторот може да објави за сите.'); return; }
    const n = o.getItems().length;
    const i = await choose('Деплој во живата игра', `Играта за сите играчи ќе ги има ${n} ставки. Во следните 5 секунди можеш да откажеш.`, ['Деплој', 'Откажи']);
    if (i !== 0) return;
    if (!(await countdown(5, 'Деплој во живата игра', 'Деплојот почнува за неколку секунди. Откажи за да останеш.', 'Деплој'))) { o.msg('Деплојот е откажан'); return; }
    try {
      await cloud.saveWorkspace('published', { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: surveyor(), items: o.getItems() });
      o.msg(`Деплојувано за сите играчи · ${n} ставки`);
    } catch (e) { fail(e); }
  }
  /** Save: your work on your account (the one saved version). */
  async function save(): Promise<boolean> {
    return saveToAccount();
  }

  // ---------- share: a code for a friend ----------
  async function openShare() {
    if (doc.kind !== 'work' && !(await saveToAccount())) return;
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
  form = mountAuthForm($('authBoxB'), () => { who(); refresh(); o.onSignedIn?.(); });
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
    if (!['open', 'save', 'share', 'deploy', 'logout'].includes(act!)) return; // the builder handles the rest
    closeMenu();
    if (act === 'open') { $('openDlg').hidden = false; return; }
    if (act === 'save') { await save(); return; }
    if (act === 'deploy') { await deployLive(); return; }
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
      return dirty ? 'Незачувано на профилот' : 'Зачувано на профилот';
    },
    save,
    choose,
    countdown,
    surveyor,
  };
}
