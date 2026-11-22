// Procedural, real-scale PBR materials for the MapNG material names.
// MapNG buildings carry UVs in metres (u along the wall, v up), so a texture
// that depicts W×H metres repeats every W×H metres: storeys are 3 m, window
// bays 3.2 m, roof tiles ~0.35 m. Everything is drawn on canvases at load
// time — no downloaded imagery, nothing to license.

import * as THREE from 'three';

type Ctx = CanvasRenderingContext2D;
interface Painted {
  map: THREE.Texture;
  rough: THREE.Texture;
  normal?: THREE.Texture;
}

/** A CC0 photographed material set (ambientCG), with its real-world size. */
interface Photo {
  color: HTMLImageElement;
  normal: HTMLImageElement;
  rough: HTMLImageElement;
  wM: number;
  hM: number;
}
const TEX_BASE = `${import.meta.env.BASE_URL}textures/cc0`.replace(/\/+/g, '/');
const photoCache = new Map<string, Promise<Photo>>();
function loadPhoto(id: string, wM: number, hM: number): Promise<Photo> {
  const key = id;
  if (!photoCache.has(key)) {
    const img = (f: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error(`texture ${id}/${f}`));
        i.src = `${TEX_BASE}/${id}/${f}.jpg`;
      });
    photoCache.set(key, Promise.all([img('color'), img('normal'), img('roughness')]).then(([color, normal, rough]) => ({ color, normal, rough, wM, hM })));
  }
  return photoCache.get(key)!;
}
/** Repeat a photo map over a canvas at its true size in metres. */
function tile(x: Ctx, img: HTMLImageElement, W: number, H: number, wM: number, hM: number) {
  const tw = wM * PX, th = hM * PX;
  for (let yy = H; yy > -th; yy -= th) for (let xx = 0; xx < W; xx += tw) x.drawImage(img, xx, yy - th, tw, th);
}

const PX = 96; // pixels per metre at texture scale
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (hex: string, amt: number) => {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + (rnd() - 0.5) * amt)));
  return `#${c.getHexString()}`;
};

function canvasPair(wM: number, hM: number) {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = Math.round(wM * PX);
    c.height = Math.round(hM * PX);
    return c;
  };
  const a = make(), b = make();
  return { a, b, x: a.getContext('2d')!, r: b.getContext('2d')!, W: a.width, H: a.height };
}

/** Speckle/grime so flat colours read as real surfaces. */
function grain(x: Ctx, W: number, H: number, n: number, alpha: number, size = 2) {
  for (let i = 0; i < n; i++) {
    x.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${alpha * rnd()})` : `rgba(255,255,255,${alpha * rnd() * 0.6})`;
    x.fillRect(rnd() * W, rnd() * H, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
}
/** Vertical rain streaks and a darker band at ground level. */
function weather(x: Ctx, W: number, H: number, strength = 0.12) {
  for (let i = 0; i < W / 18; i++) {
    const gx = rnd() * W;
    const g = x.createLinearGradient(0, H * rnd() * 0.5, 0, H);
    g.addColorStop(0, 'rgba(40,35,30,0)');
    g.addColorStop(1, `rgba(40,35,30,${strength * rnd()})`);
    x.fillStyle = g;
    x.fillRect(gx, 0, 2 + rnd() * 5, H);
  }
}

function toTex(c: HTMLCanvasElement, wM: number, hM: number, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / wM, 1 / hM); // UVs are metres
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- surfaces ----------
function plaster(x: Ctx, W: number, H: number, base: string) {
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  grain(x, W, H, (W * H) / 40, 0.08, 3);
  weather(x, W, H, 0.1);
}
function bricks(x: Ctx, W: number, H: number, base: string, mortar: string) {
  x.fillStyle = mortar;
  x.fillRect(0, 0, W, H);
  const bh = 0.075 * PX, bw = 0.24 * PX, gap = 0.012 * PX;
  for (let row = 0, y = 0; y < H; row++, y += bh) {
    for (let xx = row % 2 ? -bw / 2 : 0; xx < W; xx += bw) {
      x.fillStyle = jitter(base, 0.12);
      x.fillRect(xx + gap, y + gap, bw - gap * 2, bh - gap * 2);
    }
  }
  grain(x, W, H, (W * H) / 60, 0.06, 2);
  weather(x, W, H, 0.12);
}
function stoneBlocks(x: Ctx, W: number, H: number, base: string) {
  x.fillStyle = '#7d766b';
  x.fillRect(0, 0, W, H);
  const bh = 0.4 * PX;
  for (let row = 0, y = 0; y < H; row++, y += bh) {
    let xx = -rnd() * 0.5 * PX;
    while (xx < W) {
      const bw = (0.5 + rnd() * 0.6) * PX;
      x.fillStyle = jitter(base, 0.1);
      x.fillRect(xx + 2, y + 2, bw - 4, bh - 4);
      xx += bw;
    }
  }
  grain(x, W, H, (W * H) / 30, 0.1, 3);
  weather(x, W, H, 0.14);
}
function concretePanels(x: Ctx, W: number, H: number, base: string, pw: number, ph: number) {
  x.fillStyle = base;
  x.fillRect(0, 0, W, H);
  grain(x, W, H, (W * H) / 25, 0.09, 3);
  x.strokeStyle = 'rgba(30,30,30,0.35)';
  x.lineWidth = 3;
  for (let xx = 0; xx <= W; xx += pw * PX) x.strokeRect(xx, 0, 0, H);
  for (let y = 0; y <= H; y += ph * PX) x.strokeRect(0, y, W, 0);
  weather(x, W, H, 0.18);
}

/** A window centred in a W×H bay (metres), drawn on colour + roughness canvases. */
function windowBay(x: Ctx, r: Ctx, ox: number, oy: number, wm: number, hm: number, frame: string, shutters: boolean, nrm?: Ctx) {
  const w = wm * PX, h = hm * PX;
  if (nrm) {
    nrm.fillStyle = '#8080ff'; // flat glass and frame
    nrm.fillRect(ox - 10, oy - 6, w + 20, h + 20);
  }
  // reveal (shadow) + frame
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.fillRect(ox - 6, oy - 6, w + 12, h + 12);
  x.fillStyle = frame;
  x.fillRect(ox - 3, oy - 3, w + 6, h + 6);
  // glass: sky reflection gradient
  const g = x.createLinearGradient(ox, oy, ox + w * 0.3, oy + h);
  g.addColorStop(0, '#9fb6c8');
  g.addColorStop(0.45, '#4d6376');
  g.addColorStop(1, '#1f2a33');
  x.fillStyle = g;
  x.fillRect(ox, oy, w, h);
  // curtains in some
  if (rnd() < 0.45) {
    x.fillStyle = `rgba(${200 + rnd() * 40},${190 + rnd() * 40},${170 + rnd() * 40},0.55)`;
    x.fillRect(ox, oy, w * (0.2 + rnd() * 0.3), h);
  }
  // mullion + transom
  x.fillStyle = frame;
  x.fillRect(ox + w / 2 - 3, oy, 6, h);
  x.fillRect(ox, oy + h * 0.3, w, 5);
  // sill
  x.fillStyle = '#d9d4c8';
  x.fillRect(ox - 10, oy + h + 3, w + 20, 8);
  if (shutters) {
    x.fillStyle = jitter('#4f6b4a', 0.1);
    x.fillRect(ox - w * 0.45, oy, w * 0.4, h);
    x.fillRect(ox + w + w * 0.05, oy, w * 0.4, h);
  }
  // roughness: glass is mirror-smooth
  r.fillStyle = '#141414';
  r.fillRect(ox, oy, w, h);
}

interface WallSpec {
  surface: (x: Ctx, W: number, H: number) => void;
  bayW: number;
  storey: number;
  win?: { w: number; h: number; frame: string; shutters?: number; balcony?: boolean };
  rough: number; // 0..255 wall roughness
  /** photographed surface to use instead of the drawn one, tinted to the local colour */
  photo?: { ph: Photo; tint: string };
}

function paintWall(spec: WallSpec): Painted {
  const { a, b, x, r, W, H } = canvasPair(spec.bayW * 2, spec.storey * 2); // 2×2 bays for variety
  let c: HTMLCanvasElement | null = null, n: Ctx | undefined;
  if (spec.photo) {
    const { ph, tint } = spec.photo;
    tile(x, ph.color, W, H, ph.wM, ph.hM);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = tint;
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'source-over';
    weather(x, W, H, 0.08);
    tile(r, ph.rough, W, H, ph.wM, ph.hM);
    c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    n = c.getContext('2d')!;
    tile(n, ph.normal, W, H, ph.wM, ph.hM);
  } else {
    spec.surface(x, W, H);
    r.fillStyle = `rgb(${spec.rough},${spec.rough},${spec.rough})`;
    r.fillRect(0, 0, W, H);
  }
  if (spec.win) {
    const { w, h, frame } = spec.win;
    for (let by = 0; by < 2; by++)
      for (let bx = 0; bx < 2; bx++) {
        const ox = (bx * spec.bayW + (spec.bayW - w) / 2) * PX;
        // canvas y=0 is the TOP; v grows upward, so storey `by` sits from the bottom
        const oy = H - (by * spec.storey + 0.9 + h) * PX;
        windowBay(x, r, ox, oy, w, h, frame, rnd() < (spec.win.shutters ?? 0), n);
        if (spec.win.balcony && bx === 0) {
          x.fillStyle = 'rgba(60,60,60,0.85)';
          x.fillRect(ox - 0.4 * PX, oy + h * PX - 0.95 * PX, (w + 0.8) * PX, 0.08 * PX);
          for (let k = 0; k < (w + 0.8) * 8; k++) x.fillRect(ox - 0.4 * PX + k * 12, oy + h * PX - 0.95 * PX, 2, 0.95 * PX);
        }
      }
    // floor slab line between storeys
    x.fillStyle = 'rgba(0,0,0,0.12)';
    x.fillRect(0, H - spec.storey * PX - 4, W, 5);
  }
  return {
    map: toTex(a, spec.bayW * 2, spec.storey * 2, true),
    rough: toTex(b, spec.bayW * 2, spec.storey * 2, false),
    normal: c ? toTex(c, spec.bayW * 2, spec.storey * 2, false) : undefined,
  };
}

function shopfront(): Painted {
  const bayW = 4, storey = 3.6;
  const { a, b, x, r, W, H } = canvasPair(bayW * 2, storey);
  plaster(x, W, H, '#d8cfc0');
  r.fillStyle = '#d0d0d0';
  r.fillRect(0, 0, W, H);
  const signs = ['#8c1c13', '#1f4e79', '#2e5e3a', '#c27c0e', '#3b3b3b'];
  for (let i = 0; i < 2; i++) {
    const ox = (i * bayW + 0.3) * PX, w = (bayW - 0.6) * PX;
    // sign band
    x.fillStyle = signs[Math.floor(rnd() * signs.length)];
    x.fillRect(ox, H - 3.3 * PX, w, 0.5 * PX);
    // glass
    const g = x.createLinearGradient(ox, H - 2.7 * PX, ox, H);
    g.addColorStop(0, '#8aa3b5');
    g.addColorStop(0.6, '#2b3a46');
    g.addColorStop(1, '#151d24');
    x.fillStyle = g;
    x.fillRect(ox, H - 2.7 * PX, w, 2.6 * PX);
    // goods/interior hints
    for (let k = 0; k < 6; k++) {
      x.fillStyle = `hsla(${rnd() * 360},40%,60%,0.35)`;
      x.fillRect(ox + rnd() * w * 0.9, H - (0.4 + rnd() * 1.6) * PX, 0.25 * PX, 0.3 * PX);
    }
    x.fillStyle = '#2a2a2a';
    x.fillRect(ox, H - 2.7 * PX, w, 6);
    x.fillRect(ox + w * 0.62, H - 2.7 * PX, 6, 2.6 * PX);
    r.fillStyle = '#121212';
    r.fillRect(ox, H - 2.7 * PX, w, 2.6 * PX);
  }
  return { map: toTex(a, bayW * 2, storey, true), rough: toTex(b, bayW * 2, storey, false) };
}

function door(color: string, rollup: boolean): Painted {
  const { a, b, x, r, W, H } = canvasPair(2, 2.4);
  x.fillStyle = color;
  x.fillRect(0, 0, W, H);
  if (rollup) for (let y = 0; y < H; y += 10) (x.fillStyle = 'rgba(0,0,0,0.18)'), x.fillRect(0, y, W, 3);
  else {
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    x.lineWidth = 6;
    x.strokeRect(W * 0.1, H * 0.08, W * 0.8, H * 0.4);
    x.strokeRect(W * 0.1, H * 0.55, W * 0.8, H * 0.4);
  }
  grain(x, W, H, 600, 0.08);
  r.fillStyle = '#9a9a9a';
  r.fillRect(0, 0, W, H);
  return { map: toTex(a, 2, 2.4, true), rough: toTex(b, 2, 2.4, false) };
}

function roofTiles(base: string, rows = 0.32): Painted {
  const { a, b, x, r, W, H } = canvasPair(2, 2);
  x.fillStyle = '#5a3a28';
  x.fillRect(0, 0, W, H);
  const rh = rows * PX, tw = 0.24 * PX;
  for (let row = 0, y = 0; y < H; row++, y += rh)
    for (let xx = row % 2 ? -tw / 2 : 0; xx < W; xx += tw) {
      const g = x.createLinearGradient(0, y, 0, y + rh);
      const c = jitter(base, 0.12);
      g.addColorStop(0, c);
      g.addColorStop(1, jitter(c, -0.25));
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(xx + tw / 2, y + rh * 0.55, tw * 0.48, rh * 0.55, 0, 0, Math.PI * 2);
      x.fill();
    }
  grain(x, W, H, 1500, 0.12);
  r.fillStyle = '#b4b4b4';
  r.fillRect(0, 0, W, H);
  return { map: toTex(a, 2, 2, true), rough: toTex(b, 2, 2, false) };
}
function roofSheet(base: string, ribs: number): Painted {
  const { a, b, x, r, W, H } = canvasPair(2, 2);
  for (let xx = 0; xx < W; xx++) {
    const k = 0.5 + 0.5 * Math.sin((xx / PX) * Math.PI * 2 * ribs);
    x.fillStyle = jitter(base, 0.02);
    x.globalAlpha = 1;
    x.fillRect(xx, 0, 1, H);
    x.fillStyle = `rgba(0,0,0,${0.25 * (1 - k)})`;
    x.fillRect(xx, 0, 1, H);
  }
  grain(x, W, H, 900, 0.1);
  weather(x, W, H, 0.2);
  r.fillStyle = '#707070';
  r.fillRect(0, 0, W, H);
  return { map: toTex(a, 2, 2, true), rough: toTex(b, 2, 2, false) };
}
function flatRoof(): Painted {
  const { a, b, x, r, W, H } = canvasPair(4, 4);
  x.fillStyle = '#6b6862';
  x.fillRect(0, 0, W, H);
  grain(x, W, H, 9000, 0.25, 2);
  x.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let y = 0; y < H; y += PX) x.strokeRect(0, y, W, 0);
  r.fillStyle = '#e0e0e0';
  r.fillRect(0, 0, W, H);
  return { map: toTex(a, 4, 4, true), rough: toTex(b, 4, 4, false) };
}
function pavers(base: string, size: number, joint = '#77736b'): Painted {
  const { a, b, x, r, W, H } = canvasPair(2, 2);
  x.fillStyle = joint;
  x.fillRect(0, 0, W, H);
  const s = size * PX;
  for (let y = 0; y < H; y += s)
    for (let xx = 0; xx < W; xx += s) {
      x.fillStyle = jitter(base, 0.08);
      x.fillRect(xx + 2, y + 2, s - 4, s - 4);
    }
  grain(x, W, H, 4000, 0.12, 2);
  r.fillStyle = '#d8d8d8';
  r.fillRect(0, 0, W, H);
  return { map: toTex(a, 2, 2, true), rough: toTex(b, 2, 2, false) };
}
export function asphalt(): Painted {
  const { a, b, x, r, W, H } = canvasPair(4, 4);
  x.fillStyle = '#3d3e40';
  x.fillRect(0, 0, W, H);
  grain(x, W, H, 26000, 0.28, 1.6);
  // patches and cracks
  for (let i = 0; i < 4; i++) {
    x.fillStyle = `rgba(20,20,22,${0.15 + rnd() * 0.15})`;
    x.fillRect(rnd() * W, rnd() * H, (0.5 + rnd()) * PX, (0.4 + rnd()) * PX);
  }
  x.strokeStyle = 'rgba(15,15,15,0.5)';
  x.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    x.beginPath();
    let px = rnd() * W, py = rnd() * H;
    x.moveTo(px, py);
    for (let k = 0; k < 8; k++) x.lineTo((px += (rnd() - 0.5) * 30), (py += (rnd() - 0.5) * 30));
    x.stroke();
  }
  r.fillStyle = '#d4d4d4';
  r.fillRect(0, 0, W, H);
  grain(r, W, H, 6000, 0.3, 2);
  return { map: toTex(a, 4, 4, true), rough: toTex(b, 4, 4, false) };
}

// ---------- the catalogue ----------
const walls: Record<string, (photo?: WallSpec['photo']) => Painted> = {
  plaster: (photo) => paintWall({ photo, surface: (x, W, H) => plaster(x, W, H, '#e6dcc6'), bayW: 3.2, storey: 3, rough: 225, win: { w: 1.3, h: 1.5, frame: '#f2f0ea', shutters: 0.3 } }),
  stucco: (photo) => paintWall({ photo, surface: (x, W, H) => plaster(x, W, H, '#e8c9a0'), bayW: 3.4, storey: 3.1, rough: 230, win: { w: 1.2, h: 1.55, frame: '#efe9dd', shutters: 0.5 } }),
  rendered: (photo) => paintWall({ photo, surface: (x, W, H) => plaster(x, W, H, '#ddd6cb'), bayW: 3.2, storey: 2.9, rough: 220, win: { w: 1.4, h: 1.45, frame: '#ffffff', balcony: true } }),
  facade: (photo) => paintWall({ photo, surface: (x, W, H) => plaster(x, W, H, '#cfc4b2'), bayW: 3.2, storey: 2.9, rough: 220, win: { w: 1.5, h: 1.45, frame: '#e9e9e9', balcony: true } }),
  panel: (photo) => paintWall({ photo, surface: (x, W, H) => concretePanels(x, W, H, '#b9b4aa', 3.2, 2.9), bayW: 3.2, storey: 2.9, rough: 235, win: { w: 1.5, h: 1.4, frame: '#d8d8d8', balcony: true } }),
  concrete: (photo) => paintWall({ photo, surface: (x, W, H) => concretePanels(x, W, H, '#a9a59d', 3, 3), bayW: 3, storey: 3, rough: 240, win: { w: 1.6, h: 1.4, frame: '#555' } }),
  smooth_concrete: (photo) => paintWall({ photo, surface: (x, W, H) => concretePanels(x, W, H, '#c4c0b8', 6, 3), bayW: 3, storey: 3, rough: 200, win: { w: 2.2, h: 1.6, frame: '#333' } }),
  brick: (photo) => paintWall({ photo, surface: (x, W, H) => bricks(x, W, H, '#9a4a32', '#cbbfae'), bayW: 3.2, storey: 3, rough: 235, win: { w: 1.2, h: 1.5, frame: '#efefef' } }),
  brick_dark: (photo) => paintWall({ photo, surface: (x, W, H) => bricks(x, W, H, '#5e3428', '#9a9184'), bayW: 3.2, storey: 3, rough: 235, win: { w: 1.2, h: 1.5, frame: '#e5e5e5' } }),
  brick_painted: (photo) => paintWall({ photo, surface: (x, W, H) => bricks(x, W, H, '#d9d2c4', '#e8e3d8'), bayW: 3.2, storey: 3, rough: 220, win: { w: 1.2, h: 1.5, frame: '#5b5b5b' } }),
  stone: (photo) => paintWall({ photo, surface: (x, W, H) => stoneBlocks(x, W, H, '#c8bca5'), bayW: 3.4, storey: 3.4, rough: 230, win: { w: 1.2, h: 1.8, frame: '#3d3a35', shutters: 0.4 } }),
  cladding: (photo) => paintWall({ photo, surface: (x, W, H) => concretePanels(x, W, H, '#8f9497', 1.2, 3), bayW: 3.6, storey: 3.5, rough: 160, win: { w: 2.6, h: 1.8, frame: '#2b2b2b' } }),
  siding: (photo) => paintWall({ photo, surface: (x, W, H) => concretePanels(x, W, H, '#c9c3b5', 4, 0.25), bayW: 3.2, storey: 3, rough: 200, win: { w: 1.2, h: 1.4, frame: '#fff' } }),
  blockwall: (photo) => paintWall({ photo, surface: (x, W, H) => concretePanels(x, W, H, '#a7a39a', 0.4, 0.2), bayW: 3, storey: 3, rough: 245 }),
  metal_white: () => roofSheet('#d6d8d8', 4),
};
const alias: Record<string, string> = {
  stucco: 'stucco', plaster: 'plaster', rendered: 'rendered', facade: 'facade', panel: 'panel', concrete: 'concrete',
  smooth_concrete: 'smooth_concrete', brick: 'brick', brick_eca: 'brick', brick_dark: 'brick_dark', brick_painted: 'brick_painted',
  brick_white: 'brick_painted', stone: 'stone', stone_clean: 'stone', stone_mixed: 'stone', stone_facade: 'stone',
  marble_cut: 'stone', cladding: 'cladding', cladding_old: 'cladding', siding: 'siding', blockwall: 'blockwall',
  metal_white: 'metal_white', metalwall: 'metal_white', office: 'cladding',
};

const cache = new Map<string, THREE.MeshStandardMaterial>();
const tint = new THREE.Color();

// CC0 ambientCG sets (public/textures/cc0, see LICENSE.md) with real sizes in metres.
// Sizes come from ambientCG's dimension data where given, otherwise measured from the
// texture (brick course 7.5 cm, slab 50 cm…). Tints match Skopje's facade palette.
const PHOTO = {
  plaster: { id: 'Plaster001', w: 2, h: 2 },
  paintedPlaster: { id: 'PaintedPlaster017', w: 2, h: 1 },
  brick: { id: 'Bricks105', w: 2.4, h: 1.2 },
  concrete: { id: 'Concrete046', w: 2.4, h: 2.4 },
  slab: { id: 'Concrete034', w: 1.1, h: 0.55 },
  terracotta: { id: 'RoofingTiles006', w: 3.2, h: 3.2 },
  slate: { id: 'RoofingTiles003', w: 2, h: 2 },
  corrugated: { id: 'CorrugatedSteel005', w: 2, h: 2 },
  gravel: { id: 'Gravel043', w: 1.6, h: 1.6 },
  asphalt: { id: 'Asphalt033', w: 2.5, h: 2.5 },
  cobbles: { id: 'PavingStones138', w: 1.25, h: 2.5 },
  sett: { id: 'PavingStones150', w: 0.9, h: 0.9 },
} as const;
type PhotoKey = keyof typeof PHOTO;
const WALL_PHOTO: Record<string, [PhotoKey, string]> = {
  plaster: ['plaster', '#efe3cc'],
  stucco: ['plaster', '#f1cfa3'],
  rendered: ['paintedPlaster', '#e9e2d6'],
  facade: ['paintedPlaster', '#ddd2c0'],
  panel: ['concrete', '#d8d3c9'],
  concrete: ['concrete', '#cfcac0'],
  smooth_concrete: ['concrete', '#e2ded6'],
  brick: ['brick', '#ffffff'],
  brick_dark: ['brick', '#8a7f78'],
  brick_painted: ['plaster', '#efeae0'],
  cladding: ['concrete', '#b9bfc3'],
  siding: ['paintedPlaster', '#e4ddcf'],
  blockwall: ['concrete', '#cbc6bc'],
};
const SURFACE_PHOTO: [RegExp, PhotoKey, string][] = [
  [/roof_(ochre|italy|rounded)/, 'terracotta', '#ffffff'],
  [/roof_(slate|slate_tiles|shingle)/, 'slate', '#ffffff'],
  [/roof_(metal|tin)|metal_white/, 'corrugated', '#ffffff'],
  [/roof_(flat|wood)/, 'gravel', '#ffffff'],
  [/^sidewalk$/, 'slab', '#ffffff'],
  [/^curbs$/, 'concrete', '#e6e2da'],
  [/plaza_pavers/, 'cobbles', '#ffffff'],
  [/plaza_sett/, 'sett', '#ffffff'],
  [/corner_asphalt/, 'asphalt', '#ffffff'],
];

function photoTextures(ph: Photo) {
  const mk = (img: HTMLImageElement, srgb: boolean) => {
    const t = new THREE.Texture(img);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / ph.wM, 1 / ph.hM);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(ph.color, true), normal: mk(ph.normal, false), rough: mk(ph.rough, false) };
}

/** Swap a material's drawn surface for the photographed one once it has loaded. */
function upgrade(m: THREE.MeshStandardMaterial, build: () => Promise<Painted & { tint?: string }>) {
  build()
    .then((p) => {
      m.map = p.map;
      m.roughnessMap = p.rough;
      if (p.normal) {
        m.normalMap = p.normal;
        m.normalScale.set(0.8, 0.8);
      }
      if (p.tint) m.color.set(p.tint);
      m.needsUpdate = true;
    })
    .catch((e) => console.warn('photo texture unavailable, keeping drawn surface:', e.message));
}

/** Asphalt with the photographed surface (for roads); resolves to texture set. */
export function asphaltPhoto() {
  const a = PHOTO.asphalt;
  return loadPhoto(a.id, a.w, a.h).then(photoTextures);
}

/** Realistic material for a MapNG material name (falls back to plaster). */
export function materialFor(name: string, vertexColors: boolean): THREE.MeshStandardMaterial {
  const key = `${name}|${vertexColors}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const nameSeed = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 2147483647, 7) || 7;
  seed = nameSeed;
  const n = name.replace(/^mapng_(bld_)?/, '');
  let p: Painted;
  if (n === 'shop') p = shopfront();
  else if (n === 'doors') p = door('#5a4632', false);
  else if (n === 'rollup_door') p = door('#8d9296', true);
  else if (/roof_(ochre|italy|rounded)/.test(n)) p = roofTiles(n.includes('ochre') ? '#c27a45' : '#b55a36');
  else if (/roof_(slate|slate_tiles|shingle)/.test(n)) p = roofTiles('#4b4f55', 0.26);
  else if (/roof_(metal|tin)/.test(n)) p = roofSheet(n.includes('tin') ? '#8b8f8c' : '#6f7f86', 6);
  else if (/roof_(flat|wood)/.test(n)) p = flatRoof();
  else if (n === 'sidewalk') p = pavers('#bdb7ab', 0.4);
  else if (n === 'curbs') p = pavers('#9c9890', 1.0, '#6e6a63');
  else if (/plaza_(pavers|sett)/.test(n)) p = pavers('#a89a86', 0.2, '#6f675c');
  else if (n === 'corner_asphalt') p = asphalt();
  else if (/sport_turf/.test(n)) p = pavers('#4f7d3a', 2, '#4a7536');
  else if (/sport_(dirt|sand)/.test(n)) p = pavers('#b58f63', 2, '#a9845a');
  else p = (walls[alias[n] ?? 'plaster'] ?? walls.plaster)();
  const m = new THREE.MeshStandardMaterial({
    map: p.map,
    roughnessMap: p.rough,
    roughness: 1,
    metalness: 0,
    vertexColors,
    // MapNG vertex colours are near-white tints; keep them subtle
    color: tint.setScalar(1),
  });
  m.name = name;
  cache.set(key, m);

  // Photographed CC0 surface: walls keep their drawn windows on top of it.
  const wallKey = alias[n];
  const surf = SURFACE_PHOTO.find(([re]) => re.test(n));
  if (wallKey && WALL_PHOTO[wallKey]) {
    const [pk, wallTint] = WALL_PHOTO[wallKey];
    const P = PHOTO[pk];
    upgrade(m, () =>
      loadPhoto(P.id, P.w, P.h).then((ph) => {
        seed = nameSeed; // same window layout as the drawn version
        return walls[wallKey]({ ph, tint: wallTint });
      }),
    );
  } else if (surf) {
    const P = PHOTO[surf[1]];
    upgrade(m, () => loadPhoto(P.id, P.w, P.h).then((ph) => ({ ...photoTextures(ph), tint: surf[2] })));
  }
  return m;
}
