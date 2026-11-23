// Documents, like a drawing app:
// - Your three documents live on the server under your account, so they open on any computer after you sign in.
// - Every change is saved by itself: first to this browser (right away), then to the server (a moment later).
//   If the connection drops, the change waits in this browser and is sent when it can be.
// - Export is the only "save as": a file on this computer. Import opens a file into the open document.
// - Share makes a code for a friend; a code from a friend opens their document.
// - The administrator can deploy the open document to the live game, with 5 seconds to cancel.
import * as cloud from '../shared/cloud';
import { mountAuthForm, verifyAccount } from '../shared/auth-form';
import { shortDate } from '../shared/dates';
import { readCache, writeCache } from './store';
import type { UserItem } from '../game/render/userItems';

interface Options {
  getItems: () => UserItem[];
  /** Shows a document's items. `key` names the document, so its history of actions comes back with it. */
  setItems: (items: UserItem[], key: string) => void;
  msg: (text: string) => void;
  onSignedIn?: () => void;
}

export interface DocApi {
  /** A change to the items: saved here at once, and to the server a moment later. */
  changed(): void;
  /** True while a change has not reached the server. */
  pending(): boolean;
  /** Sends a pending change now. */
  flush(): Promise<boolean>;
  /** Opens your last document (or your first) once the map is ready and you are signed in. */
  start(): Promise<void>;
  /** A question with clear answers: the last label is the one that cancels. Resolves with the index chosen. */
  choose(title: string, text: string, labels: string[]): Promise<number>;
  /** Seconds to change your mind before a destructive action. Resolves true when it runs out. */
  countdown(seconds: number, title?: string, text?: string, goLabel?: string): Promise<boolean>;
  surveyor(): string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LAST_KEY = 'builder.doc';
const SEND_AFTER = 5000; // ms after the last change: fewer writes to the server, the change is in this browser at once
const RETRY_AFTER = 20_000; // ms, when the server could not be reached

export function initDocument(o: Options): DocApi {
  let me: { username: string; admin: boolean } | null = null;
  let docs: cloud.DocMeta[] = [];
  /** the open document */
  let cur: { name: string; title: string; owner: string } | null = null;
  let dirty = false; // a change that has not reached the server
  let sending = false;
  let sendTimer = 0;
  let cacheTimer = 0;
  let offline = false;
  let form: ReturnType<typeof mountAuthForm> | null = null;

  const fail = (e: unknown) => o.msg(e instanceof cloud.CloudError ? e.message : 'Нешто не е во ред.');
  const whoAmI = async () => {
    if (me) return me;
    if (!cloud.account()) return null;
    try { me = await cloud.me(); } catch { me = null; }
    return me;
  };
  const surveyor = () => cloud.account()?.username ?? 'builder';
  const titleOf = (d: { n?: number; title: string; name: string }) => d.title || (d.n ? `Документ ${d.n}` : d.name);

  // ---------- the status in the toolbar ----------
  function status() {
    const el = $('saveStatus');
    const text = !cur ? '' : sending ? 'Се зачувува…' : dirty ? (offline ? 'Нема врска · зачувано на овој компјутер' : 'Се зачувува…') : 'Зачувано';
    el.textContent = text;
    el.classList.toggle('dirty', dirty && !offline);
    el.classList.toggle('bad', dirty && offline);
    el.title = offline ? 'Промената е на овој компјутер и ќе се испрати кога ќе има врска.' : '';
  }

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

  // ---------- the document list ----------
  function renderDocs() {
    $('docName').textContent = cur ? cur.title : 'Градител';
    const list = $('wsList');
    list.innerHTML = '';
    const rows: { name: string; title: string; sub: string }[] = docs.map((d) => ({
      name: d.name,
      title: titleOf(d),
      sub: d.exists ? `${d.count} ставки · ${shortDate(d.savedAt)}` : 'празен',
    }));
    if (cur && !docs.some((d) => d.name === cur!.name)) rows.push({ name: cur.name, title: cur.title, sub: `споделен од ${cur.owner}` });
    for (const r of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ver-row';
      b.setAttribute('aria-current', String(cur?.name === r.name));
      const t = document.createElement('span'); t.className = 'ver-title'; t.textContent = r.title;
      const s = document.createElement('small'); s.className = 'ver-sub'; s.textContent = r.sub;
      b.append(t, s);
      b.addEventListener('click', () => void open(r.name));
      list.appendChild(b);
    }
  }
  async function refreshList() {
    try { docs = (await cloud.listDocs()).docs; } catch { /* offline: the list stays as it was */ }
    renderDocs();
  }

  // ---------- opening ----------
  /** Opens a document: a change still waiting in this browser wins; otherwise the server copy. */
  async function open(name: string) {
    if (cur?.name === name) return;
    await flush();
    const cached = await readCache(name).catch(() => null);
    let items: unknown[] = [];
    let title = '';
    let owner = me?.username ?? '';
    try {
      const w = await cloud.loadWorkspace(name);
      owner = w.owner;
      title = w.title ?? '';
      const server = (w.data as { items?: unknown[] } | null)?.items;
      items = cached?.dirty ? cached.recs : Array.isArray(server) ? server : [];
      dirty = !!cached?.dirty;
      offline = false;
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status === 404) { items = cached?.recs ?? []; dirty = !!cached?.dirty; }
      else if (cached) { items = cached.recs; dirty = cached.dirty; offline = true; }
      else { fail(e); return; }
    }
    const meta = docs.find((d) => d.name === name);
    cur = { name, title: title || (meta ? titleOf(meta) : name), owner };
    o.setItems(items as UserItem[], name);
    localStorage.setItem(LAST_KEY, JSON.stringify({ user: cloud.account()?.username, name }));
    await writeCache({ name, title: cur.title, recs: o.getItems(), savedAt: new Date().toISOString(), dirty });
    renderDocs();
    status();
    if (dirty) schedule(); // a change from before is sent now
  }

  // ---------- saving: this browser at once, the server a moment later ----------
  function changed() {
    if (!cur) return;
    dirty = true;
    status();
    clearTimeout(cacheTimer);
    cacheTimer = window.setTimeout(() => void writeCache({ name: cur!.name, title: cur!.title, recs: o.getItems(), savedAt: new Date().toISOString(), dirty: true }), 200);
    schedule();
  }
  function schedule(after = SEND_AFTER) {
    clearTimeout(sendTimer);
    sendTimer = window.setTimeout(() => void flush(), after);
  }
  async function flush(): Promise<boolean> {
    clearTimeout(sendTimer);
    if (!cur || !dirty) return true;
    if (sending) { schedule(300); return false; }
    sending = true; status();
    const doc = cur;
    const items = o.getItems();
    const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: surveyor(), items };
    try {
      await cloud.saveWorkspace(doc.name, data, doc.title);
      // a change made while this was sending stays pending
      if (cur === doc && JSON.stringify(o.getItems()) === JSON.stringify(items)) dirty = false;
      offline = false;
      await writeCache({ name: doc.name, title: doc.title, recs: items, savedAt: data.savedAt, dirty });
      const d = docs.find((x) => x.name === doc.name);
      if (d) Object.assign(d, { exists: true, count: items.length, savedAt: data.savedAt });
      renderDocs();
      return true;
    } catch (e) {
      if (e instanceof cloud.CloudError && e.status !== 0) { fail(e); }
      offline = true;
      schedule(RETRY_AFTER);
      return false;
    } finally {
      sending = false;
      status();
      if (dirty && !offline) schedule();
    }
  }

  // ---------- rename, export, import ----------
  async function rename() {
    if (!cur) return;
    const t = prompt('Име на документот', cur.title);
    if (!t || !t.trim()) return;
    cur.title = t.trim().slice(0, 60);
    const d = docs.find((x) => x.name === cur!.name);
    if (d) d.title = cur.title;
    dirty = true;
    renderDocs();
    await flush();
  }
  /** Export: the only "save as". The open document as a file on this computer. */
  function exportFile() {
    if (!cur) return;
    const data = { format: 'krug-builder-session', version: 1, savedAt: new Date().toISOString(), surveyor: surveyor(), nextId: 1, recs: o.getItems() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${cur.title.replace(/[^\p{L}\p{N}]+/gu, '_')}.json`; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    o.msg(`Извезено · ${cur.title}`);
  }
  async function importFile(file: File) {
    if (!cur) return;
    let d: any;
    try { d = JSON.parse(await file.text()); } catch { o.msg('Датотеката не е исправна.'); return; }
    const items = d?.format === 'krug-builder-session' && Array.isArray(d.recs) ? d.recs : d?.format === 'mapng-mod' && Array.isArray(d.items) ? d.items : null;
    if (!items) { o.msg('Датотеката не е проект ниту извоз.'); return; }
    if (o.getItems().length && (await choose('Увези датотека', `Ставките во „${cur.title}“ ќе се заменат со ${items.length} ставки од „${file.name}“. Врати (⌘Z) ги враќа.`, ['Увези', 'Откажи'])) !== 0) return;
    o.setItems(items, cur.name);
    changed();
    o.msg(`Увезено: ${file.name}`);
  }

  // ---------- share and codes ----------
  let shareCode = '';
  function openShare() {
    if (!cur) return;
    $('shareCodeBox').hidden = true; $('shareCopy').hidden = true; $('shareMake').hidden = false;
    $('shareText').textContent = `Создај код за „${cur.title}“ и испрати му го на пријателот. Тој го внесува во Отвори со код. Кодот важи 7 дена.`;
    $('shareDlg').hidden = false;
  }
  async function makeCode() {
    if (!cur) return;
    if (!(await flush())) { o.msg('Прво мора документот да стигне до серверот.'); return; }
    try {
      const r = await cloud.createCode(cur.name);
      shareCode = r.code;
      $('shareCode').textContent = r.code;
      $('shareCodeBox').hidden = false;
      $('shareCopy').hidden = false; $('shareMake').hidden = true;
      $('shareText').textContent = 'Кодот важи 7 дена. Нов код го поништува стариот.';
    } catch (e) { fail(e); }
  }
  async function joinCode(code: string) {
    try {
      const r = await cloud.joinWithCode(code);
      await open(r.name);
      o.msg(`Отворен е споделениот документ „${cur?.title ?? r.name}“`);
    } catch (e) { fail(e); }
  }

  // ---------- the live game (administrator) ----------
  async function deployLive(): Promise<void> {
    const m = await whoAmI();
    if (!m?.admin) { o.msg('Само администраторот може да објави за сите.'); return; }
    const n = o.getItems().length;
    const i = await choose('Деплој во живата игра', `Играта за сите играчи ќе ги има ${n} ставки од „${cur?.title ?? ''}“. Во следните 5 секунди можеш да откажеш.`, ['Деплој', 'Откажи']);
    if (i !== 0) return;
    if (!(await countdown(5, 'Деплој во живата игра', 'Деплојот почнува за неколку секунди. Откажи за да останеш.', 'Деплој'))) { o.msg('Деплојот е откажан'); return; }
    try {
      await cloud.saveWorkspace('published', { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: surveyor(), items: o.getItems() });
      o.msg(`Деплојувано за сите играчи · ${n} ставки`);
    } catch (e) { fail(e); }
  }

  // ---------- sign-in, and the first document ----------
  function who() {
    const a = cloud.account();
    const initial = a ? a.username.slice(0, 1) : '';
    $('cAuth').hidden = !!a;
    if (!a) form?.show();
    $('gateSigned').hidden = !a;
    $('gateGo').hidden = !a;
    $('gateLead').textContent = a ? 'Твоите документи се на серверот и се отвораат на секој компјутер.' : 'Направи профил или најави се за да додаваш сообраќајни знаци.';
    $('gateUser').textContent = a?.username ?? '';
    $('gateAvatar').textContent = initial;
    ($('startBtn') as HTMLButtonElement).disabled = !a;
    ($('gateCode') as HTMLButtonElement).disabled = !a;
    $('menuWho').textContent = a ? `Најавен си како ${a.username}` : '';
  }
  async function start() {
    const a = cloud.account();
    if (!a) return;
    await whoAmI();
    await refreshList();
    const last = (() => { try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as { user: string; name: string } | null; } catch { return null; } })();
    await open(last && last.user === a.username ? last.name : a.username);
  }
  form = mountAuthForm($('authBoxB'), () => { who(); o.onSignedIn?.(); });
  $('gateLogout').addEventListener('click', () => { cloud.setAccount(null); me = null; who(); o.msg('Одјавен си'); });

  // ---------- wiring ----------
  $('openBtn').addEventListener('click', () => { $('openDlg').hidden = false; });
  $('shareBtn').addEventListener('click', openShare);
  $('gateCode').addEventListener('click', () => { $('gate').style.display = 'none'; $('openDlg').hidden = false; });
  $('openClose').addEventListener('click', () => { $('openDlg').hidden = true; });
  $('openDlg').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) $('openDlg').hidden = true; });
  $('openCodeGo').addEventListener('click', async () => {
    const code = ($('openCode') as HTMLInputElement).value;
    if (!code.trim()) { o.msg('Внеси код.'); return; }
    $('openDlg').hidden = true;
    await joinCode(code);
    ($('openCode') as HTMLInputElement).value = '';
  });
  $('openFileInput').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importFile(file);
  });
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
    const show = menu.hidden;
    menu.hidden = !show;
    fileBtn.setAttribute('aria-expanded', String(show));
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== fileBtn) closeMenu(); });
  menu.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (!['rename', 'export', 'import', 'share', 'code', 'deploy', 'logout'].includes(act!)) return; // the builder handles the rest
    closeMenu();
    if (act === 'rename') await rename();
    else if (act === 'export') exportFile();
    else if (act === 'import') $('openFileInput').click();
    else if (act === 'share') openShare();
    else if (act === 'code') $('openDlg').hidden = false;
    else if (act === 'deploy') await deployLive();
    else if (act === 'logout') { await flush(); cloud.setAccount(null); location.reload(); }
  });
  // Cmd+S sends the change now (it is saved anyway)
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyS') { e.preventDefault(); void flush().then((ok) => o.msg(ok ? 'Зачувано' : 'Нема врска · зачувано на овој компјутер')); }
  });
  // a change waiting to be sent: try once more when the page is hidden or closed
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });

  who();
  void verifyAccount().then(() => who());

  return {
    changed,
    pending: () => dirty,
    flush,
    start,
    choose,
    countdown,
    surveyor,
  };
}
