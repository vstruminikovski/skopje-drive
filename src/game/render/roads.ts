// Road surfaces, markings and crossings as ribbons along the DecalRoad nodes.

import * as THREE from 'three';
import type { ImportedRoad } from '../import/types';
import { asphalt, asphaltPhoto } from './materials';

let asphaltTex: ReturnType<typeof asphalt> | null = null;

interface Style {
  color: number;
  lift: number;
  order: number;
  dashed?: boolean;
  stripes?: boolean;
  asphalt?: boolean;
}
function styleFor(r: ImportedRoad): Style | null {
  const m = r.material;
  if (m === 'road_invisible' || r.kind === 'gutter') return null;
  if (r.kind === 'zebra') return { color: 0xf2f2ee, lift: 0.07, order: 4, stripes: true };
  if (r.kind === 'marking') return { color: /yellow/.test(m) ? 0xf2c12e : 0xf4f4ef, lift: 0.06, order: 3, dashed: /discontinue/.test(m) };
  if (/pavers/.test(m)) return { color: 0xa39582, lift: 0.025, order: 1 };
  if (/dirt/.test(m)) return { color: 0x8a7458, lift: 0.025, order: 1 };
  if (/concrete/.test(m)) return { color: 0x9d9c97, lift: 0.03, order: 1 };
  if (r.kind === 'path') return { color: 0xb3a892, lift: 0.025, order: 1 };
  if (/asphalt/.test(m)) return { asphalt: true, color: r.kind === 'service' ? 0x4a4b4d : 0x3a3c3f, lift: r.kind === 'carriageway' ? 0.045 : 0.035, order: 2 };
  return null;
}

/** Left/right offset ribbon; returns positions (three axes) and v along length. */
function ribbon(points: [number, number, number, number][], lift: number, widthScale = 1) {
  const pos: number[] = [];
  const along: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const hw = (p[3] * widthScale) / 2;
    if (i) acc += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    // right = (dy, -dx)
    pos.push(p[0] - dy * hw, p[2] + lift, -(p[1] + dx * hw), p[0] + dy * hw, p[2] + lift, -(p[1] - dx * hw));
    along.push(acc, acc);
  }
  return { pos, along };
}

export function buildRoads(roads: ImportedRoad[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'roads';
  const buckets = new Map<string, { style: Style; pos: number[]; uv: number[]; idx: number[] }>();
  for (const r of roads) {
    const st = styleFor(r);
    if (!st || r.points.length < 2) continue;
    const key = `${st.color}|${st.lift}|${st.dashed ? 'd' : ''}${st.stripes ? 's' : ''}${st.asphalt ? 'a' : ''}`;
    if (!buckets.has(key)) buckets.set(key, { style: st, pos: [], uv: [], idx: [] });
    const b = buckets.get(key)!;
    const { pos, along } = ribbon(r.points, st.lift);
    const base = b.pos.length / 3;
    b.pos.push(...pos);
    along.forEach((s, k) => b.uv.push(k % 2, s));
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = base + i * 2;
      b.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // counter-clockwise seen from above
    }
  }
  for (const b of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: b.style.color,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -b.style.order,
      polygonOffsetUnits: -b.style.order * 2,
    });
    if (b.style.asphalt) {
      // u runs 0→1 across the road, v is metres along it
      asphaltTex ??= asphalt();
      const map = asphaltTex.map.clone(), rough = asphaltTex.rough.clone();
      for (const t of [map, rough]) t.repeat.set(1.4, 1 / 4);
      mat.map = map;
      mat.roughnessMap = rough;
      mat.roughness = 1;
      mat.color.set(b.style.color === 0x4a4b4d ? 0xd6d6d6 : 0xffffff);
      // photographed CC0 asphalt once loaded (u across the road is 0..1 ≈ 7.5 m, i.e. 3 tiles)
      asphaltPhoto()
        .then((t) => {
          for (const tx of [t.map, t.normal, t.rough]) tx.repeat.set(3, 1 / 2.5);
          mat.map = t.map;
          mat.normalMap = t.normal;
          mat.roughnessMap = t.rough;
          // Asphalt033 is a light, sun-bleached sample; city asphalt reads darker
          mat.color.set(b.style.color === 0x4a4b4d ? 0x8a8a8a : 0x6e6e6e);
          mat.needsUpdate = true;
        })
        .catch(() => {});
    }
    if (b.style.dashed || b.style.stripes) {
      mat.alphaMap = b.style.dashed ? dashTexture() : zebraTexture();
      mat.transparent = true;
      mat.alphaTest = 0.5;
      mat.depthWrite = false;
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = b.style.order;
    group.add(mesh);
  }
  return group;
}

function dashTexture() {
  // 3 m paint, 3 m gap; uv.y is metres along the line
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, 4, 64);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 4, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1 / 6);
  return t;
}
function zebraTexture() {
  // zebra bars run ACROSS the drawn line (perpendicular to it), stacked along it:
  // uv.y is metres along the line, so one 1 m tile = 0.5 m bar + 0.5 m gap
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, 4, 64);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 4, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  return t;
}
