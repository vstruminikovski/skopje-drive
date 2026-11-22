// Street and place names from OpenStreetMap (names.json, ODbL).
// Road names: whole labels flat on the ground, on a straight piece long enough to hold
// them, one per name per 120 m, always reading left to right.
// Place names: small sprites above the roof of the building they name, with clearance.

import * as THREE from 'three';
import type { Terrain } from '../import/loadLevel';

export interface NamesFile {
  source: string;
  roads: { name: string; pts: number[][] }[];
  places: { name: string; x: number; y: number }[];
}

const ROAD_FONT = 28; // canvas px (half of the previous 56)
const PLACE_FONT = 20; // canvas px (half of the previous 40)
const PLACE_H = 1.3; // sprite height, m (half of the previous 2.6)
const ROOF_CLEARANCE = 1.5; // m between the roof and the bottom of a place label

const SS = 4; // supersampling: canvas is drawn at 4× so text stays sharp at any distance

/** Text on a rounded box, drawn at SS× the nominal size; the box keeps its shape at any width. */
function textCanvas(text: string, px: number, color: string, bg: string | null) {
  const f = px * SS;
  const font = `600 ${f}px -apple-system, system-ui, sans-serif`;
  const c = document.createElement('canvas');
  const x = c.getContext('2d')!;
  x.font = font;
  const pad = f * 0.55;
  const w = Math.ceil(x.measureText(text).width + pad * 2);
  const h = Math.ceil(f * 1.5);
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    const r = h / 2;
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(r, h);
    ctx.arc(r, r, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + f * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { tex: t, aspect: w / h };
}

export function buildNames(names: NamesFile, terrain: Terrain, roofAt: (x: number, y: number) => number | null): THREE.Group {
  const g = new THREE.Group();
  g.name = 'names';

  // Road names: every named road gets labels. Along long straight pieces they repeat every
  // ~90 m; a road too short for a full-size label gets one smaller label that fits its
  // longest piece. Labels are always whole and read left to right.
  const SPACING = 90, FIRST = 60, MIN_GAP = 40, FIT = 1.3, MIN_SCALE = 0.45;
  const placed: { name: string; x: number; y: number }[] = [];
  const addRoadLabel = (name: string, tex: THREE.Texture, aspect: number, mx: number, my: number, theta: number, scale: number) => {
    const h = 1.2 * scale;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(h * aspect, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.rotation.z = theta;
    plane.position.set(mx, terrain.heightAt(mx, my) + 0.3, -my); // clear of the road surface
    plane.renderOrder = 5;
    plane.name = name;
    g.add(plane);
    placed.push({ name, x: mx, y: my });
  };
  for (const r of names.roads) {
    const { tex, aspect } = textCanvas(r.name, ROAD_FONT, '#2a2a2c', 'rgba(255,255,255,0.75)');
    const fullLen = 1.2 * aspect; // full-size label length, m
    const orient = (a: number[], b: number[]) => {
      let t = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (Math.cos(t) < 0) t += Math.PI; // never upside down
      return t;
    };
    let placedHere = 0;
    let run = 0, next = FIRST;
    let longest = { L: 0, a: r.pts[0], b: r.pts[1] };
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > longest.L) longest = { L, a, b };
      while (L > 0 && run + L >= next) {
        const t = (next - run) / L;
        const mx = a[0] + (b[0] - a[0]) * t, my = a[1] + (b[1] - a[1]) * t;
        next += SPACING;
        if (L < fullLen * FIT || placed.some((q) => q.name === r.name && Math.hypot(q.x - mx, q.y - my) < MIN_GAP)) continue;
        addRoadLabel(r.name, tex, aspect, mx, my, orient(a, b), 1);
        placedHere++;
      }
      run += L;
    }
    // no full-size spot on this road: one label, shrunk to fit its longest piece
    if (placedHere === 0 && longest.L > 0) {
      const scale = Math.max(MIN_SCALE, Math.min(1, longest.L / (fullLen * FIT)));
      addRoadLabel(r.name, tex, aspect, (longest.a[0] + longest.b[0]) / 2, (longest.a[1] + longest.b[1]) / 2, orient(longest.a, longest.b), scale);
    }
  }

  // place names: sprite above the roof of the building (or above the ground if none)
  for (const p of names.places) {
    const { tex, aspect } = textCanvas(p.name, PLACE_FONT, '#ffffff', 'rgba(20,20,22,0.62)');
    // drawn on top of buildings, so the name is readable from the street at any angle
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    s.renderOrder = 10;
    s.scale.set(PLACE_H * aspect, PLACE_H, 1);
    const roof = roofAt(p.x, p.y);
    const base = roof ?? terrain.heightAt(p.x, p.y) + 3; // no building: 3 m above ground
    s.position.set(p.x, base + ROOF_CLEARANCE + PLACE_H / 2, -p.y);
    g.add(s);
  }
  return g;
}
