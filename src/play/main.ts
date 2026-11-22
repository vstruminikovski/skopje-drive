// The game page. Signed out: the published map. Signed in (on any device): your own saved map.
// Only this page loads the game, and the builder stays on desktop.
import { startGame } from '../game/boot';
import * as cloud from '../shared/cloud';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function play(ws: string | null) {
  $('pick').hidden = true;
  $('loading').hidden = false;
  startGame(undefined, { ws });
}

async function start() {
  // a link to a workspace plays that workspace, as before
  const linked = new URLSearchParams(location.search).get('ws');
  if (linked) return play(linked);
  const a = cloud.account();
  if (a) return play(a.username);
  $('loading').hidden = true; // the choice comes first
  $('pick').hidden = false;
  $('guest').addEventListener('click', () => play(null));
  $('signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $<HTMLInputElement>('pUser').value.trim().toLowerCase();
    const password = $<HTMLInputElement>('pPass').value;
    try {
      const r = await cloud.login(username, password);
      cloud.setAccount({ username: r.username, token: r.token });
      play(r.username);
    } catch (err) {
      $('pErr').textContent = err instanceof cloud.CloudError ? err.message : 'Нешто не е во ред.';
    }
  });
}

void start();
