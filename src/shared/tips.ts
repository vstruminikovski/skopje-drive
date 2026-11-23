// Small "i" info buttons: hover or focus shows a short explanation, a click pins it until you click elsewhere.
// Markup: <button class="info" type="button" data-tip="...">i</button>, or infoButton(text) from code.

let tip: HTMLDivElement | null = null;
let pinned: HTMLElement | null = null;

function el(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip glass ui';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

function show(btn: HTMLElement) {
  const t = el();
  t.textContent = btn.dataset.tip ?? '';
  t.hidden = false;
  // beside the button, kept inside the window
  const b = btn.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight, m = 8;
  let x = b.right + m, y = b.top + b.height / 2 - h / 2;
  if (x + w > innerWidth - m) x = b.left - w - m;
  if (x < m) { x = Math.min(Math.max(m, b.left + b.width / 2 - w / 2), innerWidth - w - m); y = b.bottom + m; }
  y = Math.min(Math.max(m, y), innerHeight - h - m);
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
function hide() { if (tip) tip.hidden = true; }

export function infoButton(text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'info';
  b.dataset.tip = text;
  b.setAttribute('aria-label', text);
  b.textContent = 'i';
  return b;
}

export function initTips() {
  document.querySelectorAll<HTMLElement>('.info[data-tip]').forEach((b) => b.setAttribute('aria-label', b.dataset.tip ?? ''));
  const target = (e: Event) => (e.target as HTMLElement | null)?.closest?.('.info[data-tip]') as HTMLElement | null;
  document.addEventListener('pointerover', (e) => { const b = target(e); if (b && !pinned) show(b); });
  document.addEventListener('pointerout', (e) => { const b = target(e); if (b && !pinned) hide(); });
  document.addEventListener('focusin', (e) => { const b = target(e); if (b) show(b); });
  document.addEventListener('focusout', (e) => { if (target(e) && !pinned) hide(); });
  document.addEventListener('click', (e) => {
    const b = target(e);
    if (b) { e.preventDefault(); e.stopPropagation(); pinned = pinned === b ? null : b; if (pinned) show(b); else hide(); return; }
    if (pinned) { pinned = null; hide(); }
  }, true);
}
