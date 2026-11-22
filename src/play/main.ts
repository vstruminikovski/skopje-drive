// The game start screen (also the home page): a small control panel.
// Desktop, signed out: play the game, build it, or sign in / create a profile to load your own game.
// Desktop, signed in: who you are, your saved game (items, when), play it, edit it, sign out.
// Phones and tablets: only "play the game". Building and accounts are for desktops.
import { fixLinks } from '../shared/links';
import { startGame } from '../game/boot';
import { isItemsFile, type ItemsFile } from '../game/items';
import * as cloud from '../shared/cloud';
import { mountAuthForm, verifyAccount } from '../shared/auth-form';

fixLinks();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function play(opts: { ws?: string | null; items?: ItemsFile | null }) {
  $('pick').hidden = true;
  $('loading').hidden = false;
  $('menuBtn').hidden = false;
  startGame(undefined, opts);
}

// Macedonian dates by hand: browsers often have no Macedonian date names
const MONTHS = ['јануари', 'февруари', 'март', 'април', 'мај', 'јуни', 'јули', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const when = (iso: string) => {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} во ${hm}`;
};

/** Signed out: the three options. */
function showSignedOut(note = '') {
  $('mine').hidden = true;
  $('signinWrap').hidden = true;
  $('load').hidden = false;
  $('build').hidden = false;
  if (note) { $('load').hidden = true; $('signinWrap').hidden = false; form?.show('login'); form?.note(note); }
}

/** Signed in: look up your saved game on the server and say exactly what is there. */
async function showMine(a: cloud.Account) {
  $('load').hidden = true;
  $('build').hidden = true;
  $('signinWrap').hidden = true;
  $('mine').hidden = false;
  $('mineUser').textContent = a.username;
  $('minePlay').hidden = true;
  $('mineStatus').textContent = 'Ја барам твојата зачувана игра…';
  let admin = false;
  try {
    admin = (await cloud.me()).admin;
  } catch (e) {
    if (e instanceof cloud.CloudError && e.status === 401) { cloud.setAccount(null); showSignedOut('Најавата истече. Најави се повторно.'); return; }
    $('mineStatus').textContent = 'Нема врска со серверот. Провери ја интернет-врската и освежи ја страницата.';
    return;
  }
  // the admin's game is the published one (what everyone plays); everyone else has their own
  const name = admin ? 'published' : a.username;
  try {
    const w = await cloud.loadWorkspace(name);
    if (!isItemsFile(w.data)) throw new cloud.CloudError('Зачуваната игра е оштетена.', 500);
    const data = w.data;
    $('mineStatus').textContent = `${admin ? 'Објавената игра' : 'Твојата игра'}: ${data.items.length} ставки · зачувана ${when(w.savedAt)}${w.savedBy && w.savedBy !== a.username ? ` од ${w.savedBy}` : ''}.`;
    $('minePlay').hidden = false;
    $('minePlay').onclick = () => play({ items: data });
  } catch (e) {
    if (e instanceof cloud.CloudError && e.status === 404) {
      $('mineStatus').textContent = 'Уште немаш зачувана игра. Отвори го градителот, додај знаци и притисни „Зачувај“.';
    } else {
      $('mineStatus').textContent = e instanceof cloud.CloudError ? e.message : 'Не успеав да ја вчитам играта.';
    }
  }
}

let form: ReturnType<typeof mountAuthForm> | null = null;

function start() {
  const params = new URLSearchParams(location.search);
  const linked = params.get('ws'); // a link to a workspace plays that workspace
  if (linked) return play({ ws: linked });

  $('loading').hidden = true; // the choice comes first
  $('pick').hidden = false;
  $('guest').addEventListener('click', () => play({ ws: null }));

  const desktop = matchMedia('(min-width: 900px) and (pointer: fine) and (hover: hover)').matches;
  if (!desktop) {
    $('pick').classList.add('phone');
    $('phoneNote').hidden = false;
    return;
  }

  form = mountAuthForm($('authBox'), (a) => void showMine(a));
  $('load').addEventListener('click', () => {
    $('load').hidden = true;
    $('signinWrap').hidden = false;
    form?.show('login');
  });
  $('pBack').addEventListener('click', () => showSignedOut());
  $('logout').addEventListener('click', () => { cloud.setAccount(null); showSignedOut(); });

  const remembered = cloud.account();
  if (remembered) {
    void showMine(remembered);
    void verifyAccount().then((a) => { if (!a) showSignedOut('Најавата истече. Најави се повторно.'); });
  } else showSignedOut();
}

start();
