// Stand-ins for props whose BeamNG meshes are not in the archive (.link files):
// trees, lamps, signs and traffic lights placed at their exported positions.

import * as THREE from 'three';
import type { LevelObjects, PropInstance } from '../import/types';
import type { Lamp } from '../traffic/signals';

/** True where a prop makes no sense: inside a building or on a drivable road. */
export type Blocked = (x: number, y: number, z: number) => boolean;

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: PropInstance[], place: (o: THREE.Object3D, p: PropInstance) => void) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const o = new THREE.Object3D();
  items.forEach((p, i) => {
    o.position.set(p.pos[0], p.pos[2], -p.pos[1]);
    o.rotation.set(0, p.yaw, 0);
    o.scale.setScalar(1);
    place(o, p);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  });
  m.count = items.length;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Leaf clusters on a transparent canvas: gaps in the foliage show the sky behind. */
const foliageCache = new Map<number, THREE.CanvasTexture>();
function foliageTexture(hue: number): THREE.CanvasTexture {
  const key = Math.round(hue * 1000);
  const cached = foliageCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  let seed = key;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const cx = 20 + r() * 216, cy = 20 + r() * 216, rad = 10 + r() * 22;
    x.fillStyle = `hsl(${hue * 360 + (r() - 0.5) * 16}, ${34 + r() * 14}%, ${24 + r() * 16}%)`;
    x.beginPath();
    x.arc(cx, cy, rad, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  foliageCache.set(key, t);
  return t;
}

export function buildProps(objects: LevelObjects, blocked: Blocked = () => false) {
  const g = new THREE.Group();
  g.name = 'props';
  const ok = (p: PropInstance) => !blocked(p.pos[0], p.pos[1], p.pos[2]);
  const dropped: Record<string, number> = {};
  const keep = (kind: string, items: PropInstance[]) =>
    items.filter((p) => ok(p) || ((dropped[kind] = (dropped[kind] ?? 0) + 1), false));

  const trees = keep('trees', objects.trees);
  // Trees: a cylinder trunk and foliage cards (leaf clusters with gaps you can see
  // through), three crossed cards per tree, one draw call per species.
  const sz = (t: PropInstance) => (/small|sml|bush/.test(t.type) ? 0.6 : /large|huge/.test(t.type) ? 1.35 : 1) * t.scale;
  const species = (t: string) => (/aspen/.test(t) ? 'aspen' : /holm/.test(t) ? 'holm' : /beech/.test(t) ? 'beech' : 'oak');
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6).translate(0, 1.5, 0);
  g.add(instanced(trunk, new THREE.MeshStandardMaterial({ color: 0x5a4330 }), trees, (o, t) => o.scale.setScalar(sz(t))));
  const shapes: Record<string, { w: number; h: number; base: number; hue: number }> = {
    aspen: { w: 2.4, h: 5.0, base: 2.0, hue: 0.26 },
    beech: { w: 5.0, h: 4.4, base: 2.4, hue: 0.25 },
    oak: { w: 5.2, h: 4.6, base: 2.2, hue: 0.24 },
    holm: { w: 4.4, h: 3.6, base: 2.6, hue: 0.27 },
  };
  for (const kind of Object.keys(shapes)) {
    const items = trees.filter((t) => species(t.type) === kind);
    if (!items.length) continue;
    const sh = shapes[kind];
    const mat = new THREE.MeshStandardMaterial({ map: foliageTexture(sh.hue), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    const card = new THREE.PlaneGeometry(sh.w, sh.h).translate(0, sh.base + sh.h / 2, 0);
    for (const k of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
      g.add(instanced(card, mat, items, (o, t) => {
        o.scale.setScalar(sz(t));
        o.rotation.y = t.yaw + k;
      }));
    }
  }

  // Lamp posts only. 'mapng_lamp_glow' entries are the light halos (~2.4 m from each
  // post, 7 m up), not posts, and stadium floodlights have no stand-in mesh.
  const lamps = keep('lamps', objects.lamps.filter((l) => !/stadium|glow/.test(l.type)));
  // Street lamp: a tapered pole with a curved-looking arm and a flat luminaire head, from
  // the data positions (the lamp arm reaches along the lamp's local +x, the road side).
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.6, roughness: 0.4 });
  const pole = new THREE.CylinderGeometry(0.06, 0.1, 7.2, 8).translate(0, 3.6, 0);
  const arm = new THREE.BoxGeometry(1.5, 0.08, 0.08).translate(0.7, 7.1, 0);
  const head = new THREE.BoxGeometry(0.7, 0.1, 0.28).translate(1.4, 7.05, 0);
  g.add(instanced(pole, steel, lamps, () => {}));
  g.add(instanced(arm, steel, lamps, () => {}));
  g.add(instanced(head, new THREE.MeshStandardMaterial({ color: 0xd9d4c4, roughness: 0.5 }), lamps, () => {}));

  // Pedestrian rails: 2 m panels along the model's local y; the exported point is the
  // top rail (~0.87 m above the pavement), so the panel hangs down from it.
  // no fences or walls: railings and garden walls are removed from the scene
  const fences: PropInstance[] = [];
  // metal railing: a top bar and a bottom bar, with posts at both ends of each 2 m panel
  const bars = new THREE.BoxGeometry(2, 0.04, 0.04).translate(0, -0.05, 0);
  const bar2 = new THREE.BoxGeometry(2, 0.04, 0.04).translate(0, -0.6, 0);
  const post = new THREE.BoxGeometry(0.05, 0.9, 0.05).translate(0, -0.45, 0);
  const rail = new THREE.MeshStandardMaterial({ color: 0x6f757b, metalness: 0.5, roughness: 0.5 });
  g.add(instanced(bars, rail, fences, () => {}));
  g.add(instanced(bar2, rail, fences, () => {}));
  g.add(instanced(post, rail, fences, (o) => o.translateX(-1)));
  g.add(instanced(post, rail, fences, (o) => o.translateX(1)));

  // Garden / boundary walls: ~3.1 m segments (the measured spacing) along local x, on the ground.
  const wall = new THREE.BoxGeometry(3.1, 1.2, 0.3).translate(0, 0.6, 0);
  const coping = new THREE.BoxGeometry(3.2, 0.08, 0.42).translate(0, 1.24, 0); // stone cap
  const stone: PropInstance[] = [];
  const concrete: PropInstance[] = [];
  g.add(instanced(wall, new THREE.MeshStandardMaterial({ color: 0x9a8f7e, roughness: 1 }), stone, () => {}));
  g.add(instanced(coping, new THREE.MeshStandardMaterial({ color: 0xc9c2b2, roughness: 0.9 }), stone, () => {}));
  g.add(instanced(wall, new THREE.MeshStandardMaterial({ color: 0xb4b2ab, roughness: 0.95 }), concrete, () => {}));
  g.userData.dropped = dropped;
  g.userData.walls = [...stone, ...concrete]; // for physics: solid, unlike the rails

  const signs = objects.signs;
  const signColor: Record<string, number> = { give_way: 0xd8261f, noentry: 0xc71f1a, one_way: 0x1f5fb8, priorityroad: 0xf1c41a };
  for (const s of signs) {
    const grp = new THREE.Group();
    const post = s.mount ?? 2.4;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, post, 6), new THREE.MeshStandardMaterial({ color: 0x777777 }));
    stick.position.y = post / 2;
    // signs with a drawn face: flat shapes facing the road, plate centred on the top of the pole
    const layers = signLayers(s.type);
    let plate: THREE.Object3D;
    if (layers) {
      plate = signFace(layers);
      plate.position.y = post;
    } else {
      const modelled = s.type in signColor;
      const face = osmFace(s.type);
      const mesh = new THREE.Mesh(
        face ? new THREE.CylinderGeometry(0.33, 0.33, 0.04, 24) : !modelled ? new THREE.BoxGeometry(0.6, 0.04, 0.6) : new THREE.CylinderGeometry(0.33, 0.33, 0.04, 20),
        face ?? (modelled ? new THREE.MeshStandardMaterial({ color: signColor[s.type] }) : codePlate(s.type)),
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = post + 0.1;
      plate = mesh;
    }
    if (s.floating) grp.add(plate); else grp.add(stick, plate);
    grp.position.set(s.pos[0], s.pos[2], -s.pos[1]);
    grp.rotation.y = s.yaw;
    g.add(grp);
  }
  return g;
}

/**
 * Traffic light heads; call update() each frame with lamp states. `dark` heads are
 * surveyed lights with no simulated programme: drawn unlit, never given a made-up cycle.
 */
export function buildSignals(
  objects: LevelObjects,
  dark: { pos: number[]; dir: number[] }[] = [],
  /** where to stand the pole of an OSM/MapNG head (its point marks the stop position on the road centre) */
  poleAt: (pos: number[], dir: number[]) => number[] = (p) => p,
  /** pole: false when the head is glued to a pole the player built (the builder) */
  opts: { pole?: boolean } = {},
) {
  const g = new THREE.Group();
  g.name = 'signals';
  const heads = new Map<number, THREE.MeshStandardMaterial[]>();
  const pedHeads = new Map<number, { red: THREE.MeshStandardMaterial; green: THREE.MeshStandardMaterial }>();
  const housing = new THREE.MeshStandardMaterial({ color: 0x1d1f22 });
  // the head itself is a normal grey housing; lenses show their colour when off, brighter when lit
  const headHousing = new THREE.MeshStandardMaterial({ color: 0x5c626b, roughness: 0.55 });
  const list = [...objects.signals.instances.map((s) => ({ ...s, lit: true })), ...dark.map((d, k) => ({ id: -1 - k, pos: d.pos, dir: d.dir, lit: false }))];
  for (const s of list) {
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), housing);
    pole.position.y = 1.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.95, 0.3), headHousing);
    box.position.y = 3.5;
    if (opts.pole !== false) grp.add(pole, box);
    else grp.add(box);
    const mats = [0xff2a1a, 0xffb000, 0x2bd94a].map((c) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c).multiplyScalar(0.4), emissive: c, emissiveIntensity: 0 }));
    mats.forEach((m, k) => {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), m);
      lens.position.set(0, 3.8 - k * 0.3, 0.16);
      grp.add(lens);
    });
    if (s.lit) heads.set(s.id, mats);
    if (s.lit) {
      // pedestrian signal on the pole side: red man / green man, opposite the vehicle signal
      const ped = new THREE.Group();
      const hous = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.1), headHousing);
      ped.add(hous);
      const red = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xff2a1a).multiplyScalar(0.4), emissive: 0xff2a1a, emissiveIntensity: 0 });
      const green = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2bd94a).multiplyScalar(0.4), emissive: 0x2bd94a, emissiveIntensity: 0 });
      const rl = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), red);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), green);
      rl.position.set(0, 0.12, 0.051);
      gl.position.set(0, -0.12, 0.051);
      ped.add(rl, gl);
      ped.position.set(0.32, 2.3, 0);
      grp.add(ped);
      pedHeads.set(s.id, { red, green });
    }
    // surveyed heads (ids ≥ 200000, and all dark ones) are already at the pole position
    const at = s.lit && s.id < 200000 ? poleAt(s.pos, s.dir) : s.pos;
    grp.position.set(at[0], at[2], -at[1]);
    // lenses (+Z local) face along the instance dir
    grp.rotation.y = Math.atan2(s.dir[0], -s.dir[1]);
    g.add(grp);
  }
  return {
    group: g,
    update(state: (id: number) => Lamp) {
      for (const [id, mats] of heads) {
        const st = state(id);
        mats[0].emissiveIntensity = st === 'red' ? 2.5 : 0;
        mats[1].emissiveIntensity = st === 'yellow' ? 2.5 : 0;
        mats[2].emissiveIntensity = st === 'green' ? 2.5 : 0;
        // pedestrians cross on red, wait on green/yellow
        const p = pedHeads.get(id);
        if (p) {
          p.red.emissiveIntensity = st === 'red' ? 0 : 2.5;
          p.green.emissiveIntensity = st === 'red' ? 2.5 : 0;
        }
      }
    },
  };
}

// Sign faces as flat shapes in the plate plane (x right, y up), facing +Z. Colours follow the Vienna
// convention the Rulebook uses: red border for warning and prohibition, blue for mandatory and one-way.
type Layer = { shape: THREE.Shape; color: number; z?: number } | { text: string; size: number };
function polygonShape(points: [number, number][]) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}
function discShape(r: number) { const s = new THREE.Shape(); s.absarc(0, 0, r, 0, Math.PI * 2, false); return s; }
function regular(n: number, r: number, rot = 0): [number, number][] {
  return Array.from({ length: n }, (_, k) => [r * Math.cos(rot + (2 * Math.PI * k) / n), r * Math.sin(rot + (2 * Math.PI * k) / n)] as [number, number]);
}
function signLayers(type: string): Layer[] | null {
  const speed = /^speed_(\d+)$/.exec(type)?.[1];
  if (speed) return [{ shape: discShape(0.33), color: 0xd42a20 }, { shape: discShape(0.26), color: 0xffffff, z: 0.01 }, { text: speed, size: 0.36 }];
  if (type === 'give_way') {
    const side = 0.9;
    const tri = (sd: number) => { const hh = (sd * Math.sqrt(3)) / 2, t = hh / 3; return polygonShape([[-sd / 2, t], [sd / 2, t], [0, t - hh]]); };
    return [{ shape: tri(side), color: 0xd8261f }, { shape: tri(0.62), color: 0xffffff, z: 0.01 }];
  }
  if (type === 'noentry') {
    return [{ shape: discShape(0.36), color: 0xc71f1a }, { shape: polygonShape([[-0.22, -0.06], [0.22, -0.06], [0.22, 0.06], [-0.22, 0.06]]), color: 0xffffff, z: 0.01 }];
  }
  if (type === 'one_way') {
    // arrow pointing UP the page, as on the Rulebook sign
    return [{ shape: polygonShape([[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]), color: 0x1f5fb8 },
      { shape: polygonShape([[-0.05, -0.22], [0.05, -0.22], [0.05, 0.1], [-0.05, 0.1]]), color: 0xffffff, z: 0.01 },
      { shape: polygonShape([[-0.15, 0.08], [0.15, 0.08], [0, 0.24]]), color: 0xffffff, z: 0.01 }];
  }
  if (type === 'priorityroad') {
    return [{ shape: polygonShape(regular(4, 0.45)), color: 0xffffff }, { shape: polygonShape(regular(4, 0.36)), color: 0xf1c41a, z: 0.01 }];
  }
  if (type === 'arrow_right') {
    // arrow pointing RIGHT on a blue disc
    return [{ shape: discShape(0.33), color: 0x1f5fb8 }, { shape: polygonShape([[-0.2, -0.05], [0.1, -0.05], [0.1, -0.12], [0.25, 0], [0.1, 0.12], [0.1, 0.05], [-0.2, 0.05]]), color: 0xffffff, z: 0.01 }];
  }
  return null;
}
function signFace(layers: Layer[]) {
  const g = new THREE.Group();
  let z = 0.02;
  for (const l of layers) {
    if ('shape' in l) {
      const m = new THREE.Mesh(new THREE.ShapeGeometry(l.shape), new THREE.MeshStandardMaterial({ color: l.color, side: THREE.DoubleSide, roughness: 0.6 }));
      m.position.z = z + (l.z ?? 0);
      g.add(m);
    } else {
      // number on an upright plane: reads correctly from the front
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d')!;
      x.fillStyle = '#111';
      x.font = 'bold 60px system-ui, sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(l.text, 64, 68);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(l.size, l.size), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide }));
      m.position.z = z + 0.02;
      g.add(m);
    }
    z += 0.005;
  }
  return g;
}

/** Plain plate showing the official code: a sign that is placed but has no dedicated 3D model yet. */
const plateCache = new Map<string, THREE.MeshStandardMaterial>();
function codePlate(code: string) {
  let m = plateCache.get(code);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f2f2f2';
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#555';
  x.lineWidth = 6;
  x.strokeRect(3, 3, 122, 122);
  x.fillStyle = '#222';
  x.font = 'bold 30px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(code.toUpperCase(), 64, 56);
  x.font = '15px system-ui, sans-serif';
  x.fillText('no model', 64, 92);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: t });
  plateCache.set(code, m);
  return m;
}

/**
 * Faces for the OSM sign types that are a standard disc: speed limit (red ring,
 * number from the OSM tag) and mandatory direction (blue disc, white arrow).
 */
const faceCache = new Map<string, THREE.MeshStandardMaterial>();
function osmFace(type: string): THREE.MeshStandardMaterial | null {
  const speed = /^speed_(\d+)$/.exec(type)?.[1];
  if (!speed && type !== 'arrow_right') return null;
  let m = faceCache.get(type);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.beginPath();
  x.arc(64, 64, 63, 0, Math.PI * 2);
  if (speed) {
    x.fillStyle = '#d42a20';
    x.fill();
    x.beginPath();
    x.arc(64, 64, 47, 0, Math.PI * 2);
    x.fillStyle = '#fff';
    x.fill();
    x.fillStyle = '#111';
    x.font = 'bold 48px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(speed, 64, 68);
  } else {
    x.fillStyle = '#1f5fb8';
    x.fill();
    x.strokeStyle = x.fillStyle = '#fff';
    x.lineWidth = 14;
    x.beginPath();
    x.moveTo(30, 64);
    x.lineTo(80, 64);
    x.stroke();
    x.beginPath();
    x.moveTo(100, 64);
    x.lineTo(72, 38);
    x.lineTo(72, 90);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // the disc's top cap maps UV around the circle centre; flip so text reads from the front
  t.center.set(0.5, 0.5);
  m = new THREE.MeshStandardMaterial({ map: t });
  faceCache.set(type, m);
  return m;
}
