// Library icons: one picture per item, drawn so each says what it places.
// Drawn on a 64 × 64 canvas with the origin in the middle; keep shapes within ±26.

type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const WHITE = '#fff';
const YELLOW = '#ffd60a';

function circle(g: G, x: number, y: number, r: number, fill: string) { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function poly(g: G, pts: [number, number][], fill?: string, stroke?: string, w = 0) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = w; g.lineJoin = 'round'; g.stroke(); }
}
function line(g: G, pts: [number, number][], color: string, w: number) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
}
/** A filled arrow head with its tip at (x, y), pointing along `deg` (0 = up, 90 = right). */
function head(g: G, x: number, y: number, deg: number, size = 10, color = WHITE) {
  const a = (deg * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a); // forward
  const px = -dy, py = dx; // side
  const bx = x - dx * size, by = y - dy * size;
  poly(g, [[x, y], [bx + px * size * 0.7, by + py * size * 0.7], [bx - px * size * 0.7, by - py * size * 0.7]], color);
}

// ---------- signs ----------
function arrowGlyph(g: G, deg: number, len: number, color: string) {
  g.save(); g.rotate((deg * Math.PI) / 180);
  line(g, [[0, len / 2], [0, -len / 2 + 6]], color, 5);
  head(g, 0, -len / 2 - 2, 0, 10, color);
  g.restore();
}
export function drawSignIcon(g: G, type: string) {
  const r = 25;
  switch (type) {
    case 'give_way': // white triangle, red border, point down
      poly(g, [[-r, -r * 0.75], [r, -r * 0.75], [0, r * 0.95]], '#e0301e');
      poly(g, [[-r * 0.62, -r * 0.52], [r * 0.62, -r * 0.52], [0, r * 0.5]], WHITE);
      return;
    case 'noentry':
      circle(g, 0, 0, r, '#e0301e');
      g.fillStyle = WHITE; g.fillRect(-r * 0.66, -r * 0.15, r * 1.32, r * 0.3);
      return;
    case 'one_way': // blue square, white arrow
      g.fillStyle = '#1f5fbf'; g.beginPath(); g.roundRect(-r, -r, 2 * r, 2 * r, 5); g.fill();
      arrowGlyph(g, 0, 30, WHITE);
      return;
    case 'priorityroad': // yellow diamond with a white rim
      poly(g, [[0, -r], [r, 0], [0, r], [-r, 0]], WHITE);
      poly(g, [[0, -r * 0.72], [r * 0.72, 0], [0, r * 0.72], [-r * 0.72, 0]], YELLOW);
      return;
    case 'arrow_right': // blue disc, white arrow to the right
      circle(g, 0, 0, r, '#1f5fbf');
      arrowGlyph(g, 90, 30, WHITE);
      return;
    default:
      if (type.startsWith('speed')) {
        circle(g, 0, 0, r, '#e0301e');
        circle(g, 0, 0, r * 0.78, WHITE);
        g.fillStyle = '#111'; g.font = 'bold 22px -apple-system, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(type.replace('speed_', ''), 0, 1);
        return;
      }
      circle(g, 0, 0, r, '#1f5fbf');
  }
}

// ---------- traffic lights ----------
function lightHead(g: G, x: number, y: number, s = 1) {
  g.fillStyle = '#2b2d31'; g.beginPath(); g.roundRect(x - 8 * s, y - 20 * s, 16 * s, 40 * s, 4 * s); g.fill();
  circle(g, x, y - 12 * s, 4.6 * s, '#ff453a');
  circle(g, x, y, 4.6 * s, '#ffd60a');
  circle(g, x, y + 12 * s, 4.6 * s, '#30d158');
}
function drawLightIcon(g: G, key: string) {
  if (key === 'glue') {
    // a light fixed to the side of a pole block
    g.fillStyle = '#8e9299'; g.fillRect(-20, -10, 16, 34);
    g.fillStyle = '#6e7279'; g.fillRect(-20, -10, 16, 4);
    g.fillStyle = '#5a5e64'; g.fillRect(-4, -2, 6, 4);
    lightHead(g, 10, 2, 0.95);
  } else {
    // a light on its own tall pole
    g.fillStyle = '#8e9299'; g.fillRect(-2, -6, 4, 32);
    g.fillStyle = '#6e7279'; g.fillRect(-8, 24, 16, 3);
    lightHead(g, 0, -10, 0.8);
  }
}

// ---------- road markings (drawn lines) ----------
function drawMarkIcon(g: G, key: string) {
  g.fillStyle = WHITE;
  switch (key) {
    case 'solid': g.fillRect(-2.5, -26, 5, 52); return;
    case 'dashed': for (let y = -26; y < 26; y += 15) g.fillRect(-2.5, y, 5, 9); return;
    case 'double': g.fillRect(-8, -26, 5, 52); g.fillRect(3, -26, 5, 52); return;
    case 'stop': // a wide bar across the lane, the lane line behind it
      g.fillRect(-26, -5, 52, 9);
      for (let y = 10; y < 26; y += 10) g.fillRect(-1.5, y, 3, 6);
      return;
    case 'zebra': for (let x = -25; x < 26; x += 10) g.fillRect(x, -20, 5, 40); return;
  }
}

// ---------- painted symbols (placed once, turned with Q / E) ----------
function drawTemplateIcon(g: G, key: string) {
  const W = 5;
  switch (key) {
    case 'arrow_straight':
      line(g, [[0, 24], [0, -12]], WHITE, W); head(g, 0, -25, 0, 13);
      return;
    case 'arrow_right':
      line(g, [[-8, 24], [-8, -2], [6, -2]], WHITE, W); head(g, 21, -2, 90, 13);
      return;
    case 'arrow_left':
      line(g, [[8, 24], [8, -2], [-6, -2]], WHITE, W); head(g, -21, -2, -90, 13);
      return;
    case 'arrow_straight_right':
      line(g, [[-6, 24], [-6, -12]], WHITE, W); head(g, -6, -25, 0, 12);
      line(g, [[-6, 10], [-6, 4], [8, -6]], WHITE, W); head(g, 19, -14, 54, 12);
      return;
    case 'arrow_straight_left':
      line(g, [[6, 24], [6, -12]], WHITE, W); head(g, 6, -25, 0, 12);
      line(g, [[6, 10], [6, 4], [-8, -6]], WHITE, W); head(g, -19, -14, -54, 12);
      return;
    case 'arrow_uturn': // up, over the top, and back down on the left
      g.strokeStyle = WHITE; g.lineWidth = W; g.lineCap = 'round';
      g.beginPath(); g.moveTo(9, 24); g.lineTo(9, -6); g.arc(-1, -6, 10, 0, Math.PI, true); g.lineTo(-11, 2); g.stroke();
      head(g, -11, 16, 180, 12);
      return;
    case 'give_way_triangle': // painted outline; up on the icon is forward, as for the arrows
      poly(g, [[-22, 14], [22, 14], [0, -20]], undefined, WHITE, 4);
      return;
    case 'bus_stop':
      g.strokeStyle = YELLOW; g.lineWidth = 3; g.strokeRect(-26, -15, 52, 30);
      g.fillStyle = YELLOW; g.font = 'bold 17px -apple-system, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('BUS', 0, 1);
      return;
  }
}

// ---------- trees, lamps, blocks, tools ----------
function trunk(g: G, h: number, w = 4) { g.fillStyle = '#7a5a3a'; g.fillRect(-w / 2, 26 - h, w, h); }
function drawTreeIcon(g: G, key: string) {
  if (key.includes('oak_sml')) { trunk(g, 16); circle(g, 0, 2, 12, '#34c759'); return; }
  if (key.includes('oak_large')) {
    trunk(g, 20, 5);
    circle(g, -9, -2, 12, '#2fa84f'); circle(g, 9, -2, 12, '#2fa84f'); circle(g, 0, -12, 13, '#34c759');
    return;
  }
  if (key.includes('beech')) { trunk(g, 18, 5); g.fillStyle = '#5bc26a'; g.beginPath(); g.ellipse(0, -6, 15, 20, 0, 0, TAU); g.fill(); return; }
  if (key.includes('aspen')) { trunk(g, 14, 3); g.fillStyle = '#a8d84e'; g.beginPath(); g.ellipse(0, -4, 8, 18, 0, 0, TAU); g.fill(); return; }
  // city holm oak: dense dark crown in a square planter
  g.fillStyle = '#8e9299'; g.fillRect(-12, 20, 24, 6);
  trunk(g, 12, 4);
  circle(g, 0, -2, 14, '#1e7a3c');
}
function drawLampIcon(g: G) {
  g.fillStyle = '#8e9299'; g.fillRect(-12, -22, 3, 48); g.fillRect(-12, -22, 22, 3);
  g.fillStyle = '#6e7279'; g.fillRect(-17, 23, 13, 3);
  g.fillStyle = '#ffe9a8'; g.fillRect(4, -19, 10, 4);
  const glow = g.createRadialGradient(9, -14, 1, 9, -14, 18);
  glow.addColorStop(0, 'rgba(255, 233, 168, 0.55)'); glow.addColorStop(1, 'rgba(255, 233, 168, 0)');
  g.fillStyle = glow; g.beginPath(); g.arc(9, -10, 18, 0, TAU); g.fill();
}
function drawPoleIcon(g: G) {
  // one cube, seen from above at an angle
  poly(g, [[0, -20], [18, -11], [0, -2], [-18, -11]], '#b8bcc3');
  poly(g, [[-18, -11], [0, -2], [0, 20], [-18, 11]], '#8e9299');
  poly(g, [[18, -11], [0, -2], [0, 20], [18, 11]], '#6e7279');
}
function drawAxeIcon(g: G) {
  g.save(); g.rotate(0.35);
  g.fillStyle = '#9a7a55'; g.fillRect(-2, -24, 5, 50);
  poly(g, [[2, -24], [20, -20], [22, -6], [2, -8]], '#d0d4da');
  g.restore();
}

export type IconCat = 'sign' | 'sfloat' | 'light' | 'mark' | 'tpl' | 'tree' | 'lamp' | 'pole' | 'axe';
/** Draws the icon of one library item. */
export function drawItemIcon(g: G, cat: IconCat, key: string) {
  if (cat === 'sign' || cat === 'sfloat') drawSignIcon(g, key);
  else if (cat === 'light') drawLightIcon(g, key);
  else if (cat === 'mark') drawMarkIcon(g, key);
  else if (cat === 'tpl') drawTemplateIcon(g, key);
  else if (cat === 'tree') drawTreeIcon(g, key);
  else if (cat === 'lamp') drawLampIcon(g);
  else if (cat === 'pole') drawPoleIcon(g);
  else drawAxeIcon(g);
}
