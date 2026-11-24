// Floating windows, as in a design app: drag one by its title bar, collapse it with "–" or a double click.
// Where each window sits, whether it is collapsed and which sections are open are remembered on this computer.

const MARGIN = 8;
const TOP = 46; // below the toolbar

function load<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function store(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window: not remembered */ }
}

/** x and y are set once the window has been dragged; until then the stylesheet places it. */
interface Place { x?: number; y?: number; min: boolean }

/** Keeps a window inside the browser window, below the toolbar. */
function clamp(el: HTMLElement, x: number, y: number) {
  const w = el.offsetWidth, h = el.offsetHeight;
  return {
    x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, innerWidth - w - MARGIN)),
    y: Math.min(Math.max(TOP, y), Math.max(TOP, innerHeight - Math.min(h, 60) - MARGIN)),
  };
}

export function makeFloating(el: HTMLElement) {
  const key = `builder.fw.${el.dataset.fw}`;
  const head = el.querySelector<HTMLElement>('.fw-head')!;
  const minBtn = el.querySelector<HTMLButtonElement>('.fw-min')!;
  const place: Place = load<Place>(key) ?? { min: false };

  const apply = () => {
    if (place.x === undefined || place.y === undefined) return;
    const c = clamp(el, place.x, place.y);
    el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; el.style.right = 'auto';
  };
  const setMin = (on: boolean) => {
    el.classList.toggle('min', on);
    minBtn.textContent = on ? '+' : '–';
    minBtn.title = on ? 'Рашири' : 'Собери';
    place.min = on;
    store(key, place);
  };

  if (place.min) { el.classList.add('min'); minBtn.textContent = '+'; }
  apply();

  minBtn.addEventListener('click', () => setMin(!el.classList.contains('min')));
  head.addEventListener('dblclick', (e) => { if (e.target === minBtn) return; setMin(!el.classList.contains('min')); });

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (m: PointerEvent) => {
      const c = clamp(el, m.clientX - dx, m.clientY - dy);
      el.style.left = `${c.x}px`; el.style.top = `${c.y}px`; el.style.right = 'auto';
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      el.classList.remove('dragging');
      const now = el.getBoundingClientRect();
      place.x = now.left; place.y = now.top;
      store(key, place);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up, { once: true });
    head.addEventListener('pointercancel', up, { once: true });
  });

  addEventListener('resize', apply);
}

/** Collapsible sections inside a window remember whether they are open. */
export function rememberPanes(root: ParentNode) {
  root.querySelectorAll<HTMLDetailsElement>('details[data-pane]').forEach((d) => {
    const key = `builder.pane.${d.dataset.pane}`;
    const saved = load<boolean>(key);
    if (saved !== null) d.open = saved;
    d.addEventListener('toggle', () => store(key, d.open));
  });
}
