// The home page: one primary action (play), two quiet options (build, load my game).
// Signing in is a sheet over the home page, opened only when it is needed.
// "Load my game" shows what is on your account (items, date) and plays it in one click.
// Phones and tablets: only "play the game". Building and accounts are for desktops.
import '../shared/ui.css';
import { fixLinks } from '../shared/links';
import { startGame } from '../game/boot';
import { isItemsFile, type ItemsFile } from '../game/items';
import * as cloud from '../shared/cloud';
import { mountAuthForm, type AuthForm } from '../shared/auth-form';

fixLinks();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function play(opts: { ws?: string | null; items?: ItemsFile | null }) {
  closeSignin();
  $('pickGame').hidden = true;
  $('pick').hidden = true;
  $('loading').hidden = false;
  $('menuBtn').hidden = false;
  startGame(undefined, opts);
}

// ---------- "load my game": one row that always says what it will do ----------
function loadRow(sub: string, enabled: boolean) {
  $('loadSub').textContent = sub;
  $('load').setAttribute('aria-disabled', String(!enabled));
}

/** What you can play after sign-in: your deployed game, and your documents that have items. */
let choices: { label: string; name: string }[] = [];

/** Reads the account, your deployed game and your documents from the server (the server is the only source of truth). */
async function refresh() {
  const a = cloud.account();
  choices = [];
  $('acct').hidden = !a;
  if (!a) { loadRow('Најави се за да ја отвориш', true); return; }
  $('acctName').textContent = a.username;
  loadRow('Се вчитува…', false);
  try {
    const admin = (await cloud.me()).admin;
    $('acctName').textContent = `${a.username}${admin ? ' · админ' : ''}`;
  } catch (e) {
    if (e instanceof cloud.CloudError && e.status === 401) {
      cloud.setAccount(null);
      void refresh();
      openSignin('Најавата истече. Најави се повторно.');
      return;
    }
    loadRow('Нема врска со серверот', false);
    return;
  }
  try {
    const { docs } = await cloud.listDocs();
    for (const d of docs) if (d.exists && d.count > 0) choices.push({ label: d.title || `Документ ${d.n}`, name: d.name });
    loadRow(choices.length ? `${choices.length} на избор` : 'Уште нема зачувана игра', choices.length > 0);
  } catch {
    loadRow('Не може да се вчита', false);
  }
}

/** Plays one of the choices: its items are loaded from the server. */
async function playChoice(name: string) {
  try {
    const w = await cloud.loadWorkspace(name);
    if (!isItemsFile(w.data)) { loadRow('Играта е оштетена', false); return; }
    play({ items: w.data });
  } catch {
    loadRow('Не може да се вчита', false);
  }
}
function openPick() {
  const box = $('pickList');
  box.innerHTML = '';
  for (const c of choices) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-lg';
    b.textContent = c.label;
    b.addEventListener('click', () => void playChoice(c.name));
    box.appendChild(b);
  }
  $('pickGame').hidden = false;
}

// ---------- sign-in sheet ----------
let form: AuthForm | null = null;
function openSignin(note = '') {
  form ??= mountAuthForm($('authBox'), () => { closeSignin(); void refresh(); });
  $('signin').hidden = false;
  form.show('login');
  if (note) form.note(note);
}
function closeSignin() { $('signin').hidden = true; }

function start() {
  const linked = new URLSearchParams(location.search).get('ws'); // a shared link plays that workspace
  if (linked) return play({ ws: linked });

  $('loading').hidden = true;
  $('pick').hidden = false;
  $('guest').addEventListener('click', () => play({ ws: null }));

  const desktop = matchMedia('(min-width: 900px) and (pointer: fine) and (hover: hover)').matches;
  if (!desktop) {
    $('pick').classList.add('phone');
    $('phoneNote').hidden = false;
    return;
  }

  $('load').addEventListener('click', () => {
    if (!cloud.account()) openSignin();
    else if (choices.length) openPick();
  });
  $('pickClose').addEventListener('click', () => { $('pickGame').hidden = true; });
  $('pickGame').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) $('pickGame').hidden = true; });
  $('logout').addEventListener('click', () => { cloud.setAccount(null); void refresh(); });
  $('signinClose').addEventListener('click', closeSignin);
  $('signin').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeSignin(); });

  void refresh();
}

start();
