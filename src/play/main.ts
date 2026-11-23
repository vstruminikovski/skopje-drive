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
import { shortDate } from '../shared/dates';

fixLinks();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function play(opts: { ws?: string | null; items?: ItemsFile | null }) {
  closeSignin();
  $('pick').hidden = true;
  $('loading').hidden = false;
  $('menuBtn').hidden = false;
  startGame(undefined, opts);
}

// ---------- "load my game": one row that always says what it will do ----------
let mine: ItemsFile | null = null;
function loadRow(sub: string, enabled: boolean) {
  $('loadSub').textContent = sub;
  $('load').setAttribute('aria-disabled', String(!enabled));
}

/** Reads the account and its saved game from the server (the server is the only source of truth). */
async function refresh() {
  const a = cloud.account();
  mine = null;
  $('acct').hidden = !a;
  if (!a) { loadRow('Најави се за да ја отвориш', true); return; }
  $('acctName').textContent = a.username;
  loadRow('Се вчитува…', false);
  let admin = false;
  try {
    admin = (await cloud.me()).admin;
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
  // the admin's game is the published one everyone plays; everyone else has their own
  try {
    const w = await cloud.loadWorkspace(admin ? 'published' : a.username);
    if (!isItemsFile(w.data)) { loadRow('Зачуваната игра е оштетена', false); return; }
    mine = w.data;
    loadRow(`${admin ? 'Објавена · ' : ''}${mine.items.length} ставки · ${shortDate(w.savedAt)}`, true);
  } catch (e) {
    if (e instanceof cloud.CloudError && e.status === 404) loadRow('Уште нема зачувана игра', false);
    else loadRow('Не може да се вчита', false);
  }
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
    else if (mine) play({ items: mine });
  });
  $('logout').addEventListener('click', () => { cloud.setAccount(null); void refresh(); });
  $('signinClose').addEventListener('click', closeSignin);
  $('signin').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeSignin(); });

  void refresh();
}

start();
