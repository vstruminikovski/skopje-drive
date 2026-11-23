import '../shared/ui.css';
import './builder.css';
import { fixLinks } from '../shared/links';
fixLinks();
// Builder: the game itself (src/mapng/boot.ts) with a free camera and placement tools.
// Signs, traffic lights and markings are created with the game's own renderers, so what you
// place looks exactly like it will in the game. Export writes the survey file the game reads.

import * as THREE from 'three';
import { startGame, type BuilderContext } from '../game/boot';
import * as cloud from '../shared/cloud';
import { loadItems, type ItemsFile } from '../game/items';
import { initCloudPanel } from './cloud-panel';
import { buildUserItems, POLE_W, POLE_L, poleBox, poleRotY, strokesOf, markPoints, lampOf, surfaceOnScene, type UserItem } from '../game/render/userItems';
import type { Lamp } from '../game/traffic/signals';
import { writeSession, readSession, type Session } from './store';
import { kvDel } from '../shared/db';
import { clock } from '../shared/dates';
import { drawItemIcon } from './icons';
import { infoButton, initTips } from '../shared/tips';

// ---------- desktop only ----------
// A mouse-and-keyboard screen at least 900 px wide. Phones and touch tablets never get the builder.
const isDesktop = innerWidth >= 900 && matchMedia('(pointer: fine) and (hover: hover)').matches;
if (!isDesktop) {
  document.getElementById('loading')?.remove();
  document.getElementById('gate')!.innerHTML = `<div class="sheet"><h2>Само на компјутер</h2><p>Градителот бара глушец и тастатура. На телефон можеш да ја играш играта.</p><a class="btn btn-primary btn-lg" href="${import.meta.env.BASE_URL}">Играј ја играта</a></div>`;
  throw new Error('builder: desktop only');
}

const BASE = import.meta.env.BASE_URL;
/** Whose work this is, for the exports: your account name. */
const surveyor = () => cloud.account()?.username || 'builder';
const SURVEY_URL = `${BASE}survey/prviot_krug.geojson`.replace(/\/+/g, '/');

// ---------- inventory: the city's own sign and marking types ----------
// Signs: the four with a dedicated game model export to the survey file with their Rulebook code.
// The rest are placed as the game draws them, but not exported until their code is confirmed.
interface SignItem { type: string; code: string | null; wiki: string; name: string; exportable: boolean }
const SIGNS: SignItem[] = [
  { type: 'give_way', code: 'II-1', wiki: '201', name: 'Отстапи предност', exportable: true },
  { type: 'noentry', code: 'II-4', wiki: '205', name: 'Забрането влегување', exportable: true },
  { type: 'one_way', code: 'III-2', wiki: '305', name: 'Еднонасочна улица', exportable: true },
  { type: 'priorityroad', code: 'III-3', wiki: '306', name: 'Пат со првенство', exportable: true },
  { type: 'speed_50', code: null, wiki: '235-50', name: 'Ограничување 50 km/h', exportable: false },
  { type: 'speed_30', code: null, wiki: 'not on list', name: 'Ограничување 30 km/h', exportable: false },
  { type: 'arrow_right', code: null, wiki: '245.4', name: 'Задолжително надесно', exportable: false },
];
interface MarkItem { key: string; name: string; kind: 'marking' | 'zebra'; material: string; width: number; code: string | null; poly?: boolean }
// Placeholders: drawn once at the cursor and turned with Q / E. Local strokes: x right, y forward (metres).
// Shapes are approximate, not drawn to the Rulebook; check them on site before using them for anything official.
const TEMPLATES: { key: string; name: string; width: number; strokes: [number, number][][]; material?: string }[] = [
  { key: 'arrow_straight', name: 'Право', width: 0.5, strokes: [[[0, -2], [0, 1.4]], [[-0.6, 0.8], [0, 1.6], [0.6, 0.8]]] },
  { key: 'arrow_right', name: 'Десно', width: 0.5, strokes: [[[0, -2], [0, 0.2], [0.9, 0.2]], [[0.6, -0.3], [1.3, 0.2], [0.6, 0.7]]] },
  { key: 'arrow_left', name: 'Лево', width: 0.5, strokes: [[[0, -2], [0, 0.2], [-0.9, 0.2]], [[-0.6, -0.3], [-1.3, 0.2], [-0.6, 0.7]]] },
  { key: 'arrow_straight_right', name: 'Право или десно', width: 0.5, strokes: [[[0, -2], [0, 1.4]], [[-0.5, 0.9], [0, 1.5], [0.5, 0.9]], [[0, -0.6], [0.2, 0.2], [0.9, 0.8]], [[0.6, 0.6], [0.9, 0.8], [0.8, 0.4]]] },
  { key: 'arrow_straight_left', name: 'Право или лево', width: 0.5, strokes: [[[0, -2], [0, 1.4]], [[-0.5, 0.9], [0, 1.5], [0.5, 0.9]], [[0, -0.6], [-0.2, 0.2], [-0.9, 0.8]], [[-0.6, 0.6], [-0.9, 0.8], [-0.8, 0.4]]] },
  { key: 'arrow_uturn', name: 'Пресврт', width: 0.5, strokes: [[[0, -2], [0, 0.8], [-0.7, 1.3], [-0.7, 0.4]], [[-1.1, 0.7], [-0.7, 0.2], [-0.3, 0.7]]] },
  // European bus stop: yellow box with the word BUS painted inside (letters 1 m tall, 0.5 m wide). Sizes vary by country: check on site.
  // give-way triangle: a white outline, apex towards the traffic. Drivers wait here, before the stop line, at the pedestrian crossing
  { key: 'give_way_triangle', name: 'Триаголник за отстапување', width: 0.12, strokes: [[[-0.5, -0.433], [0.5, -0.433], [0, 0.433], [-0.5, -0.433]]] },
  { key: 'bus_stop', name: 'Автобуска стојалка', width: 0.12, material: 'm_line_yellow', strokes: [
    [[-1.5, -1], [1.5, -1], [1.5, 1], [-1.5, 1], [-1.5, -1]],
    // B
    [[-1.15, -0.5], [-1.15, 0.5], [-0.85, 0.5], [-0.75, 0.35], [-0.85, 0.05], [-1.15, 0.05]],
    [[-1.15, 0.05], [-0.8, 0.05], [-0.7, -0.1], [-0.8, -0.5], [-1.15, -0.5]],
    // U
    [[-0.55, 0.5], [-0.55, -0.5], [-0.25, -0.5], [-0.25, 0.5]],
    // S
    [[0.45, 0.5], [-0.05, 0.5], [-0.05, 0.05], [0.45, 0.05], [0.45, -0.5], [-0.05, -0.5]],
  ] },
];
const markDef = (key: string) => (MARKS.find((m) => m.key === key) ?? TEMPLATES.find((t) => t.key === key)) as { name: string; code: string | null; width: number };
const MARKS: MarkItem[] = [
  { key: 'solid', name: 'Полна линија', kind: 'marking', material: 'm_line_white', width: 0.12, code: null, poly: true },
  { key: 'dashed', name: 'Испрекината линија', kind: 'marking', material: 'm_line_white_discontinue', width: 0.12, code: null, poly: true },
  { key: 'double', name: 'Двојна полна линија', kind: 'marking', material: 'm_line_white', width: 0.12, code: null, poly: true },
  { key: 'stop', name: 'Линија за запирање', kind: 'marking', material: 'm_line_white', width: 0.5, code: 'V-1', poly: false },
  { key: 'zebra', name: 'Пешачки премин', kind: 'zebra', material: 'italy_road_markings_zebra', width: 3, code: 'V-4', poly: false },
];
// Trees and street lamps: the game's own asset types (taken from the map export).
const TREES = [
  { key: 'mapng_tree_tree_oak_sml_b', name: 'Даб, мал' },
  { key: 'mapng_tree_tree_oak_large_a', name: 'Даб, голем' },
  { key: 'mapng_tree_tree_beech_large_c', name: 'Бука, голема' },
  { key: 'mapng_tree_tree_aspen_small_a', name: 'Трепетлика, мала' },
  { key: 'holm_oak_city_small', name: 'Зимзелен даб' },
];
const LAMPS = [{ key: 'eca_lamppost', name: 'Улична светилка' }];
// Pole block: a 0.3 m square block, stacked or set sideways against another block (builder only, for later)
// Pole: the sign post is 0.08 m thick and 2.4 m long. This pole is 3x thicker and 3x shorter.
// Pole block: one 1 x 1 x 1 m cube, one material. Blocks snap to a 1 m grid, like Minecraft: click the ground to put one down,
// click a face of a block to glue the next one on that side. Right-click removes it.
const POLE_ITEMS = [
  { key: 'block', name: 'Столбче-коцка', sub: 'кликни на земјата или на страна од коцка за да залепиш нова' },
];
type Cat = 'sign' | 'sfloat' | 'light' | 'mark' | 'tree' | 'lamp' | 'pole' | 'tpl' | 'axe';
// traffic light kinds: glued to a pole block you built, with its own pole, or floating with no pole
const LIGHT_ITEMS = [
  { key: 'glue', name: 'На столбче-коцка', sub: 'насочи кон коцка и кликни' },
  { key: 'pole', name: 'Со свој столб', sub: 'стави каде било' },
];
const ITEMS: { cat: Cat; key: string }[] = [
  ...SIGNS.map((s) => ({ cat: 'sign' as const, key: s.type })),
  ...LIGHT_ITEMS.map((l) => ({ cat: 'light' as const, key: l.key })),
  ...SIGNS.map((s) => ({ cat: 'sfloat' as const, key: s.type })),
  ...MARKS.map((m) => ({ cat: 'mark' as const, key: m.key })),
  ...TEMPLATES.map((t) => ({ cat: 'tpl' as const, key: t.key })),
  ...TREES.map((t) => ({ cat: 'tree' as const, key: t.key })),
  ...LAMPS.map((l) => ({ cat: 'lamp' as const, key: l.key })),
  ...POLE_ITEMS.map((p) => ({ cat: 'pole' as const, key: p.key })),
  { cat: 'axe', key: 'axe' },
];

// ---------- records ----------
type Rec = UserItem;
let recs: Rec[] = [];
// undo / redo: every saved change is one step; the last 10 are kept
const HISTORY_MAX = 10;
let undoStack: string[] = [];
let redoStack: string[] = [];
let lastState = '';
let nextId = 1;
let hand = ITEMS[0];
let selectedId: number | null = null;
let pending: [number, number] | null = null;
let poly: [number, number][] = []; // points of a solid or dashed line being drawn
let tplRot = 0; // bearing (degrees) of the placeholder being placed
let poleTurn = 0; // degrees: Q / E turn the pole block you are about to place
let propTurn = 0; // extra turn (degrees) for trees and lamps, set with Q / E before spawning
let snap = 0.1; // fine snap by default, so placeholders land exactly where you aim
let compassStep = 15; // degrees; 0 = free angle
let moveSpeed = 4.8; // 20% slower than before
let ctx: BuilderContext | null = null;
let lightUpdaters: { update: (state: (id: number) => Lamp) => void; recs: UserItem[] }[] = [];
const clockStart = performance.now();
let surveyRaw: { features: any[] } = { features: [] };
const groups: Record<'signs' | 'lights' | 'lights2' | 'marks' | 'props' | 'poles', THREE.Object3D | null> = { signs: null, lights: null, lights2: null, marks: null, props: null, poles: null };


// ---------- free camera ----------
const keys = new Set<string>();
let yaw = Math.PI, pitch = -0.2;
const pos = new THREE.Vector3(0, 60, 60);
let locked = false;
const lookBtn = document.getElementById('lookBtn')!;
const canvas = (): HTMLCanvasElement | null => document.querySelector('#app canvas');

// Fly mode: a slow, steady camera (holding a key ramps up to 2×; Ctrl doubles it).
// Walk mode (V): you stand on the ground at eye height, walk at a normal pace, jump with Space.
let vel = new THREE.Vector3();
let held = 0; // seconds the movement keys have been held
let walkMode = false;
let mouseSens = 0.0015; // radians per pixel; set in the controls panel
let rightDrag: { x: number; y: number } | null = null;
const WALK = 3.44, EYE = 1.7, GRAVITY = 24, JUMP = 8; // walk 20% slower than 4.3
function freeCamera(camera: THREE.PerspectiveCamera, dt: number) {
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const dir = new THREE.Vector3();
  if (keys.has('KeyW')) dir.add(fwd);
  if (keys.has('KeyS')) dir.sub(fwd);
  if (keys.has('KeyD')) dir.add(right);
  if (keys.has('KeyA')) dir.sub(right);
  const sprint = keys.has('ControlLeft') || keys.has('ControlRight');
  const groundY = ctx ? ctx.heightAt(pos.x, -pos.z) : 0;
  if (walkMode) {
    const onGround = pos.y <= groundY + EYE + 0.01;
    if (onGround && keys.has('Space')) vel.y = JUMP;
    vel.y -= GRAVITY * dt;
    const pace = WALK * (sprint ? 1.8 : 1);
    const want = dir.lengthSq() > 0 ? dir.normalize().multiplyScalar(pace) : new THREE.Vector3();
    vel.x += (want.x - vel.x) * (1 - Math.exp(-(onGround ? 12 : 3) * dt));
    vel.z += (want.z - vel.z) * (1 - Math.exp(-(onGround ? 12 : 3) * dt));
    pos.addScaledVector(vel, dt);
    const floor = groundY + EYE;
    if (pos.y < floor) { pos.y = floor; if (vel.y < 0) vel.y = 0; }
  } else {
    if (keys.has('Space')) dir.add(new THREE.Vector3(0, 1, 0));
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) dir.sub(new THREE.Vector3(0, 1, 0));
    const moving = dir.lengthSq() > 0;
    held = moving ? held + dt : 0;
    const ramp = 1 + Math.min(1, held / 4);
    const target = moving ? dir.normalize().multiplyScalar(moveSpeed * ramp * (sprint ? 2 : 1)) : new THREE.Vector3();
    vel.lerp(target, 1 - Math.exp(-(moving ? 4 : 3) * dt));
    pos.addScaledVector(vel, dt);
    const ground = groundY + 0.5;
    if (pos.y < ground) { pos.y = ground; if (vel.y < 0) vel.y = 0; }
  }
  pos.x = Math.max(-512, Math.min(512, pos.x));
  pos.z = Math.max(-512, Math.min(512, pos.z));
  camera.position.copy(pos);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

// ---------- aiming: march the view ray until it meets the ground ----------
function aimPoint(camera: THREE.PerspectiveCamera, ndc = new THREE.Vector2(0, 0)): [number, number] | null {
  if (!ctx) return null;
  const rc0 = new THREE.Raycaster(); rc0.setFromCamera(ndc, camera);
  const dir = rc0.ray.direction.clone();
  const p = rc0.ray.origin.clone();
  const above = (q: THREE.Vector3) => q.y > ctx!.heightAt(q.x, -q.z);
  let prev = p.clone();
  for (let t = 0; t < 900; t += 0.5) {
    p.addScaledVector(dir, 0.5);
    if (Math.abs(p.x) > 512 || Math.abs(p.z) > 512) return null;
    if (!above(p)) {
      // the ray has just crossed the ground between prev and p: refine the crossing to about 1 cm
      let lo = prev.clone(), hi = p.clone();
      for (let i = 0; i < 12; i++) {
        const mid = lo.clone().add(hi).multiplyScalar(0.5);
        if (above(mid)) lo = mid; else hi = mid;
      }
      return snapPt(hi.x, -hi.z);
    }
    prev = p.clone();
  }
  return null;
}
/** Compass snapper: the end point keeps its distance and turns to the nearest compass step. */
function snapBearing(from: [number, number], to: [number, number]): [number, number] {
  if (compassStep <= 0) return to;
  const dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy);
  const step = (compassStep * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dx, dy) / step) * step; // bearing: 0 = north, clockwise
  return [from[0] + Math.sin(ang) * L, from[1] + Math.cos(ang) * L];
}
function bearingOf(from: [number, number], to: [number, number]) {
  return (((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI) + 360) % 360;
}
const COMPASS = ['С', 'СИ', 'И', 'ЈИ', 'Ј', 'ЈЗ', 'З', 'СЗ'];
const compassName = (deg: number) => `${COMPASS[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
function snapPt(x: number, y: number): [number, number] {
  return [Math.round(x / snap) * snap, Math.round(y / snap) * snap];
}
let aim: [number, number] | null = null;
/** Where you aim: the mouse pointer when the mouse is free, the crosshair when it is locked. */
const aimNdc = () => (locked ? new THREE.Vector2(0, 0) : pointerNdc);
let aimCam: THREE.PerspectiveCamera | null = null;

// ---------- records to game objects ----------
function heightOf(x: number, y: number) { return ctx ? ctx.heightAt(x, y) : 0; }

/** Snap a cursor point to any point of an existing line within 0.8 m (lines join up exactly). */
function snapLines(p: [number, number]): [number, number] {
  for (const r of recs) if (r.cat === 'mark') for (const q of markPoints(r)) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.8) return q;
  return p;
}
/** Placeholder strokes turned to tplRot and set at point at. */
function templateStrokes(key: string, at: [number, number]): [number, number][][] {
  const t = TEMPLATES.find((q) => q.key === key)!;
  const th = (tplRot * Math.PI) / 180;
  const fwd = [Math.sin(th), Math.cos(th)], right = [Math.cos(th), -Math.sin(th)];
  return t.strokes.map((st) => st.map(([lx, ly]) => [at[0] + right[0] * lx + fwd[0] * ly, at[1] + right[1] * lx + fwd[1] * ly] as [number, number]));
}
/** Smooth a drawn path into a curve, sampled every 0.5 m. */
function smoothPath(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, 0, -y)), false, 'centripetal');
  const n = Math.max(2, Math.ceil(curve.getLength() / 0.5));
  return curve.getSpacedPoints(n).map((v) => [v.x, -v.z] as [number, number]);
}
function finishPoly() {
  if (poly.length < 2) { msg('Линијата бара најмалку две точки.'); return; }
  const m = MARKS.find((q) => q.key === hand.key)!;
  const pts = smoothPath(poly);
  const id = nextId++;
  if (m.key === 'double') {
    // two solid lines, one either side of the drawn path: the gap between them is the centre-to-centre offset less one line width
    const off = 0.18;
    const side = (sign: number) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
      return [p[0] + (-ty / L) * off * sign, p[1] + (tx / L) * off * sign] as [number, number];
    });
    recs.push({ id, cat: 'mark', key: m.key, pts, strokes: [side(1), side(-1)], width: m.width, kind: m.kind, material: m.material, verified: false, note: '' });
  } else {
    recs.push({ id, cat: 'mark', key: m.key, pts, width: m.width, kind: m.kind, material: m.material, verified: false, note: '' });
  }
  poly = []; select(id); rebuild(); save();
}

function rebuild() {
  if (!ctx) return;
  const scene = ctx.scene;
  const set = (slot: 'signs' | 'lights' | 'lights2' | 'marks' | 'props' | 'poles', obj: THREE.Object3D) => {
    if (groups[slot]) scene.remove(groups[slot]!);
    groups[slot] = obj; scene.add(obj);
  };
  // the surface you see: roads and parking are drawn above the terrain formula, so drop items onto the top of what is drawn
  const surfaceOf = surfaceOnScene(ctx.scene, heightOf);
  const built = buildUserItems(recs, surfaceOf, ctx.poleAt);
  set('signs', built.signs);
  set('lights', built.lights);
  set('lights2', built.lights2);
  set('props', built.props);
  set('poles', built.poles);
  set('marks', built.marks);
  lightUpdaters = built.lightUpdaters;
  buildAxeProxies();
  buildSignTargets();
}

// ---------- placing ----------
/** Half-extent of a pole along a world normal w (three.js axes), so a neighbour can sit flush against it. */
/** Half-extent of a block along a world normal w (three.js axes): a neighbour glued on that face sits flush against it. */
function poleSupport(_orient: string, _yaw: number, w: THREE.Vector3, len = POLE_L, thick = POLE_W) {
  // a pole stands up: its length is along y, its thickness along x and z
  return (Math.abs(w.y) * len) / 2 + ((Math.abs(w.x) + Math.abs(w.z)) * thick) / 2;
}
// Poles snap to a 1 m block grid, like Minecraft: a click puts the pole where the mouse points (or the crosshair when the mouse is locked),
// and a pole aimed at the face of another pole stacks exactly one block further out on that face.
let pointerNdc = new THREE.Vector2(0, 0);
function placePoleBlock(camera: THREE.PerspectiveCamera) {
  const ndc = locked ? new THREE.Vector2(0, 0) : pointerNdc;
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const poles = groups.poles ? groups.poles.children : [];
  const hit = rc.intersectObjects(poles, false)[0];
  let cx: number, cy: number, cz: number;
  if (hit && hit.distance < 60) {
    // the face you point at: the new block is glued on that side, one block out on the 1 m grid
    const r = recs.find((q) => q.id === hit.object.userData.id);
    if (!r || r.cat !== 'pole') return;
    const n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);
    const off = poleSupport('vert', 0, n, r.len, r.thick) + poleSupport('vert', 0, n, POLE_L, POLE_W);
    cx = r.x + n.x * off; cy = r.y - n.z * off; cz = r.z + n.y * off;
  } else {
    // the ground: the block cell under the pointer, standing on the ground
    const a = aimPoint(camera, ndc);
    if (!a || !ctx) return;
    cx = Math.floor(a[0] / POLE_W) * POLE_W + POLE_W / 2;
    cy = Math.floor(a[1] / POLE_W) * POLE_W + POLE_W / 2;
    cz = heightOf(cx, cy) + POLE_L / 2;
  }
  cx = Math.round(cx * 1000) / 1000; cy = Math.round(cy * 1000) / 1000; cz = Math.round(cz * 1000) / 1000;
  if (recs.some((q) => q.cat === 'pole' && Math.abs(q.x - cx) < 0.01 && Math.abs(q.y - cy) < 0.01 && Math.abs(q.z - cz) < 0.01)) return;
  const id = nextId++;
  recs.push({ id, cat: 'pole', orient: 'vert', yaw: poleTurn, len: POLE_L, thick: POLE_W, x: cx, y: cy, z: cz, facing: 0, verified: false, note: '' });
  select(id); rebuild(); save();
}
window.addEventListener('mousemove', (e) => {
  const cv = canvas();
  if (!cv) return;
  const b = cv.getBoundingClientRect();
  pointerNdc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
});

function placeAtAim(shift: boolean, camera: THREE.PerspectiveCamera, at?: [number, number] | null) {
  if (!ctx) return;
  if (hand.cat === 'pole') { placePoleBlock(camera); return; }
  const a = at ?? aimPoint(camera, aimNdc());
  if (!a) return;
  if (hand.cat === 'tree' || hand.cat === 'lamp') {
    const id = nextId++;
    // like a sign: it faces you as you spawn it, plus any turn you set with Q / E
    const dx = camera.position.x - a[0], dy = -camera.position.z - a[1];
    const facing = (((Math.atan2(dx, dy) * 180) / Math.PI + propTurn) % 360 + 360) % 360;
    recs.push({ id, cat: 'prop', kind: hand.cat === 'tree' ? 'tree' : 'lamp', type: hand.key, x: a[0], y: a[1], z: heightOf(a[0], a[1]), facing, verified: false, note: '' });
    select(id); rebuild(); save();
    return;
  }
  if (hand.cat === 'light' && hand.key !== 'glue') {
    // with its own pole, or floating: placed where you aim, facing the player
    const dx = camera.position.x - a[0], dy = -camera.position.z - a[1];
    const facing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const id = nextId++;
    recs.push({ id, cat: 'light', mode: hand.key, x: a[0], y: a[1], z: heightOf(a[0], a[1]), facing, green: 10, yellow: 3, red: 12, offset: 0, verified: false, note: '' });
    select(id); rebuild(); save();
    return;
  }
  if (hand.cat === 'sfloat') {
    // glue: aim at a pole block (vertical or horizontal) or at a traffic light with its own pole, and the plate goes on that face
    const rc = new THREE.Raycaster();
    rc.setFromCamera(aimNdc(), camera);
    const hit = rc.intersectObjects(signTargets ? signTargets.children : [], false)[0];
    const r = hit && hit.distance < 40 ? recs.find((q) => q.id === hit.object.userData.id) : undefined;
    if (hit && r && (r.cat === 'pole' || r.cat === 'light')) {
      const n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld); // three.js: x east, y up, z = -north
      const plate = 0.12; // half the plate's thickness
      const off = r.cat === 'pole' ? poleSupport(r.orient ?? 'vert', r.yaw ?? 0, n, r.len, r.thick) + plate : 0.15 + plate;
      const cx = r.x + n.x * off, cy = r.y - n.z * off;
      const plateY = hit.point.y; // the plate sits at the height you aimed at
      const facing = ((Math.atan2(n.x, -n.z) * 180) / Math.PI + 360) % 360;
      const id = nextId++;
      // a floating sign's plate sits 2.4 m above its origin, so the origin is set to put the plate at plateY
      recs.push({ id, cat: 'sign', type: hand.key, floating: true, x: cx, y: cy, z: plateY - 2.4, facing, verified: false, note: '' });
      select(id); rebuild(); save();
      return;
    }
    // not on a pole: the plate floats, facing the player
    const dx = camera.position.x - a[0], dy = -camera.position.z - a[1];
    const facing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const id = nextId++;
    recs.push({ id, cat: 'sign', type: hand.key, floating: true, x: a[0], y: a[1], z: heightOf(a[0], a[1]), facing, verified: false, note: '' });
    select(id); rebuild(); save();
    return;
  }
  if (hand.cat === 'light') {
    // glued: a light is glued to a pole block you built: aim at one and click
    const rc = new THREE.Raycaster();
    rc.setFromCamera(aimNdc(), camera);
    const hit = rc.intersectObjects(groups.poles ? groups.poles.children : [], false)[0];
    if (!hit || hit.distance > 60) { msg('Овој семафор оди на столбче-коцка: насочи кон неа и кликни.'); return; }
    const r = recs.find((q) => q.id === hit.object.userData.id);
    if (!r || r.cat !== 'pole') return;
    const n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld); // three.js: x east, y up, z = -north
    const off = poleSupport(r.orient ?? 'vert', r.yaw ?? 0, n, r.len, r.thick) + 0.2;
    const facing = ((Math.atan2(n.x, -n.z) * 180) / Math.PI + 360) % 360;
    const id = nextId++;
    // the head's housing sits 3.5 m above its group origin, so the origin is set to put the head at the block's height
    // the head's centre sits 3.5 m above the group origin: on a side face it is at the height you aimed at, on the top it sits above the block
    const headY = n.y > 0.5 ? r.z + off : hit.point.y;
    recs.push({ id, cat: 'light', mode: 'glue', x: r.x + n.x * off, y: r.y - n.z * off, z: headY - 3.5, facing, green: 10, yellow: 3, red: 12, offset: 0, verified: false, note: '' });
    select(id); rebuild(); save();
    return;
  }
  if (hand.cat === 'sign') {
    // a sign faces the player: drivers come from where you stand
    const dx = camera.position.x - a[0], dy = -camera.position.z - a[1];
    const facing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const id = nextId++;
    recs.push(hand.cat === 'sign'
      ? { id, cat: 'sign', type: hand.key, x: a[0], y: a[1], z: heightOf(a[0], a[1]), facing, verified: false, note: '' }
      : { id, cat: 'light', mode: 'pole', x: a[0], y: a[1], z: heightOf(a[0], a[1]), facing, green: 10, yellow: 3, red: 12, offset: 0, verified: false, note: '' });
    select(id); rebuild(); save();
    return;
  }
  if (hand.cat === 'tpl') {
    const t = TEMPLATES.find((q) => q.key === hand.key)!;
    const strokes = templateStrokes(hand.key, snapLines(a));
    const id = nextId++;
    recs.push({ id, cat: 'mark', key: t.key, pts: strokes[0], strokes, width: t.width, kind: 'marking', material: t.material ?? 'm_line_white', verified: false, note: '' });
    select(id); rebuild(); save();
    return;
  }
  const m = MARKS.find((q) => q.key === hand.key)!;
  if (m.poly) {
    // solid and dashed: add points; Enter finishes the curve
    const p = snapLines(a);
    const last = poly.length ? poly[poly.length - 1] : null;
    const q = last ? snapBearing(last, p) : p;
    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.2) return;
    poly.push(q);
    return;
  }
  // stop lines and zebras: two clicks
  if (!pending) { pending = snapLines(a); return; }
  const c = snapBearing(pending, snapLines(a));
  if (Math.hypot(c[0] - pending[0], c[1] - pending[1]) < 0.3) return;
  const id = nextId++;
  recs.push({ id, cat: 'mark', key: m.key, pts: [pending, c], width: m.width, kind: m.kind, material: m.material, verified: false, note: '' });
  pending = null; select(id); rebuild(); save();
}
/** [ ] turn the selected item by one degree, for every kind of item (signs, lights, trees, lamps, poles, lines and zebras). */
function turnRec(r: Rec, deg: number) {
  const norm = (a: number) => ((a % 360) + 360) % 360;
  if (r.cat === 'pole') r.yaw = norm((r.yaw ?? 0) + deg);
  else if (r.cat === 'sign' || r.cat === 'light' || r.cat === 'prop') r.facing = norm((r.facing ?? 0) + deg);
  else if (r.cat === 'mark') {
    // turn the line or zebra about its middle: every point of every stroke
    const all = [r.pts, ...(r.strokes ?? [])].flat();
    const cx = all.reduce((s, p) => s + p[0], 0) / all.length, cy = all.reduce((s, p) => s + p[1], 0) / all.length;
    const t = (deg * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    const rot = (p: [number, number]): [number, number] => { const x = p[0] - cx, y = p[1] - cy; return [cx + x * c - y * sn, cy + x * sn + y * c]; };
    r.pts = r.pts.map(rot) as [number, number][];
    if (r.strokes) r.strokes = r.strokes.map((st) => st.map(rot));
  }
}
function removeRec(id: number) {
  recs = recs.filter((r) => r.id !== id);
  if (selectedId === id) select(null);
  rebuild(); save();
}
function nearestRec(p: [number, number], maxM: number): number | null {
  let best: number | null = null, bd = maxM;
  for (const r of recs) {
    const d = r.cat === 'mark' ? Math.min(...markPoints(r).map(([x, y]) => Math.hypot(x - p[0], y - p[1]))) : Math.hypot(r.x - p[0], r.y - p[1]);
    if (d <= bd) { bd = d; best = r.id; }
  }
  return best;
}

// ---------- inventory panel ----------
/** Signs go on a post by default; the switch in the signs header places the plate alone. */
let signsFloat = false;
const TIPS: Record<string, string> = {
  'Знаци': 'Сообраќајни знаци. „Со столб“ стои на земја; „Без столб“ се лепи на столбче-коцка или семафор.',
  'Семафори': '„На столбче-коцка“: насочи кон коцка и кликни. „Со свој столб“: стави каде било. Времињата ги менуваш кога ќе го избереш.',
  'Линии на коловоз': 'Полна, испрекината и двојна линија се цртаат точка по точка, Enter завршува. Линијата за запирање и пешачкиот премин имаат почеток и крај.',
  'Стрелки и симболи': 'Се ставаат со еден клик. Q и E ги вртат пред поставување.',
  'Столбчиња': 'Коцки од 0,2 м. Кликни на земјата или на страна од коцка за да надоградиш. На нив се лепат знаци и семафори.',
  'Дрвја и светилки': 'Кликни за да поставиш. Q и E вртат пред поставување.',
  'Алатки': 'Секирата (K) брише само ставки што ти си ги поставил. ⌘Z враќа.',
};
function buildInventory() {
  const inv = document.getElementById('inv')!;
  inv.innerHTML = '';
  type Row = { cat: Cat; key: string; name: string; sub?: string };
  const section = (title: string, rows: Row[], extra?: HTMLElement) => {
    const h = document.createElement('div'); h.className = 'inv-sec';
    const l = document.createElement('span'); l.className = 'label'; l.textContent = title; h.appendChild(l);
    if (TIPS[title]) l.appendChild(infoButton(TIPS[title]));
    if (extra) h.appendChild(extra);
    inv.appendChild(h);
    for (const row of rows) {
      const el = document.createElement('div'); el.className = 'item'; el.dataset.cat = row.cat; el.dataset.key = row.key;
      el.dataset.find = `${title} ${row.name} ${row.sub ?? ''}`.toLowerCase();
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d')!; g.translate(32, 32); drawItemIcon(g, row.cat, row.key); el.appendChild(cv);
      const t = document.createElement('div'); t.className = 'n'; t.textContent = row.name;
      if (row.sub) { const sm = document.createElement('small'); sm.textContent = row.sub; t.appendChild(sm); }
      el.appendChild(t);
      el.onclick = () => { hand = { cat: row.cat === 'sign' && signsFloat ? 'sfloat' : row.cat, key: row.key }; pending = null; markActive(); };
      inv.appendChild(el);
    }
  };
  // signs: one list, with or without a post
  const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'tablist');
  seg.innerHTML = '<button type="button" data-f="0">Со столб</button><button type="button" data-f="1">Без столб</button>';
  const paint = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String((b.dataset.f === '1') === signsFloat)));
  seg.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    signsFloat = b.dataset.f === '1'; paint();
    if (hand.cat === 'sign' || hand.cat === 'sfloat') { hand = { cat: signsFloat ? 'sfloat' : 'sign', key: hand.key }; markActive(); }
  };
  paint();
  section('Знаци', SIGNS.map((s) => ({ cat: 'sign' as const, key: s.type, name: s.name })), seg);
  section('Семафори', LIGHT_ITEMS.map((l) => ({ cat: 'light' as const, key: l.key, name: l.name })));
  section('Линии на коловоз', MARKS.map((m) => ({ cat: 'mark' as const, key: m.key, name: m.name })));
  section('Стрелки и симболи', TEMPLATES.map((t) => ({ cat: 'tpl' as const, key: t.key, name: t.name })));
  section('Столбчиња', POLE_ITEMS.map((p) => ({ cat: 'pole' as const, key: p.key, name: p.name })));
  section('Дрвја и светилки', [
    ...TREES.map((t) => ({ cat: 'tree' as const, key: t.key, name: t.name })),
    ...LAMPS.map((l) => ({ cat: 'lamp' as const, key: l.key, name: l.name })),
  ]);
  section('Алатки', [{ cat: 'axe' as const, key: 'axe', name: 'Секира' }]);
  const empty = document.createElement('p'); empty.className = 'inv-empty'; empty.textContent = 'Нема такви ставки'; empty.hidden = true; inv.appendChild(empty);
  markActive();
}
// search: filters the library as you type
document.getElementById('libSearch')!.addEventListener('input', (e) => {
  const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
  const inv = document.getElementById('inv')!;
  let shown = 0;
  inv.querySelectorAll<HTMLElement>('.item').forEach((el) => { const on = !q || el.dataset.find!.includes(q); el.hidden = !on; if (on) shown++; });
  inv.querySelectorAll<HTMLElement>('.inv-sec').forEach((h) => { h.hidden = !!q; });
  (inv.querySelector('.inv-empty') as HTMLElement).hidden = shown > 0;
});
// ---------- axe: destroys only the items placed in this builder ----------
const AXE_REACH = 12; // metres
let axeHover: number | null = null;   // id of the record under the crosshair
let proxyGroup: THREE.Group | null = null;
const axeHi = new THREE.Group();      // the red paint shown on the targeted item
const axeHiBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.35, depthWrite: false }));
const axeHiEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xff2020 }));
axeHi.add(axeHiBox, axeHiEdges);
axeHi.visible = false;
let axeHiAdded = false;
/** Invisible box for each placed item, so the axe can only hit what you placed. */
function axeBoxOf(r: Rec): { c: THREE.Vector3; size: THREE.Vector3; rotY: number } | null {
  if (r.cat === 'sign') return r.floating ? { c: new THREE.Vector3(r.x, r.z + 2.4, -r.y), size: new THREE.Vector3(1, 1, 0.3), rotY: Math.PI - (r.facing * Math.PI) / 180 } : { c: new THREE.Vector3(r.x, r.z + 1.3, -r.y), size: new THREE.Vector3(1, 2.6, 0.3), rotY: Math.PI - (r.facing * Math.PI) / 180 };
  if (r.cat === 'light') return r.mode === 'pole' ? { c: new THREE.Vector3(r.x, r.z + 2.5, -r.y), size: new THREE.Vector3(0.6, 5.2, 0.6), rotY: 0 } : { c: new THREE.Vector3(r.x, r.z + 3.5, -r.y), size: new THREE.Vector3(0.6, 1.2, 0.6), rotY: 0 };
  if (r.cat === 'pole') {
    const o = r.orient ?? 'vert', L = r.len ?? POLE_L, T = r.thick ?? POLE_W;
    return { c: new THREE.Vector3(r.x, r.z, -r.y), size: o === 'vert' ? new THREE.Vector3(T, L, T) : new THREE.Vector3(L, T, T), rotY: poleRotY({ orient: o, yaw: r.yaw ?? 0 }) };
  }
  if (r.cat === 'prop') return r.kind === 'tree' ? { c: new THREE.Vector3(r.x, r.z + 2, -r.y), size: new THREE.Vector3(2.5, 4.5, 2.5), rotY: 0 } : { c: new THREE.Vector3(r.x, r.z + 2.5, -r.y), size: new THREE.Vector3(0.6, 5, 0.6), rotY: 0 };
  if (r.cat === 'mark') {
    const pts = markPoints(r);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    return { c: new THREE.Vector3((x0 + x1) / 2, heightOf((x0 + x1) / 2, (y0 + y1) / 2) + 0.2, -(y0 + y1) / 2), size: new THREE.Vector3(Math.max(0.6, x1 - x0 + 0.6), 0.6, Math.max(0.6, y1 - y0 + 0.6)), rotY: 0 };
  }
  return null;
}
function buildAxeProxies() {
  if (proxyGroup && ctx) ctx.scene.remove(proxyGroup);
  proxyGroup = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  for (const r of recs) {
    const b = axeBoxOf(r);
    if (!b) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.size.x, b.size.y, b.size.z), mat);
    m.position.copy(b.c); m.rotation.y = b.rotY;
    m.userData.id = r.id;
    proxyGroup.add(m);
  }
  if (ctx) ctx.scene.add(proxyGroup);
}
/** While the axe is in hand: find the placed item under the crosshair and paint it red. */
function updateAxe(camera: THREE.PerspectiveCamera) {
  if (!ctx) return;
  if (!axeHiAdded) { ctx.scene.add(axeHi); axeHiAdded = true; }
  axeHover = null;
  if (hand.cat === 'axe' && proxyGroup) {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = rc.intersectObjects(proxyGroup.children, false)[0];
    if (hit && hit.distance <= AXE_REACH) {
      axeHover = hit.object.userData.id as number;
      const b = axeBoxOf(recs.find((q) => q.id === axeHover)!);
      if (b) {
        axeHi.position.copy(b.c); axeHi.rotation.y = b.rotY; axeHi.scale.copy(b.size);
        axeHi.visible = true;
      }
    }
  }
  if (axeHover === null) axeHi.visible = false;
}
function axeChop() {
  if (axeHover === null) { msg('Насочи кон твоја ставка (се црвени) и кликни.'); return; }
  removeRec(axeHover);
  axeHover = null; axeHi.visible = false;
  msg('Избришано · ⌘Z враќа');
}

/** Draw resolution of the builder: 1 = fast (default), 2 = sharp. The game itself is not changed. */
function applyQuality(r: THREE.WebGLRenderer, value: string) {
  r.setPixelRatio(Math.min(parseFloat(value) || 1, window.devicePixelRatio));
  r.setSize(innerWidth, innerHeight);
  const sel = document.getElementById('qualitySel') as HTMLSelectElement | null;
  if (sel) sel.value = value;
  try { localStorage.setItem('builder.quality', value); } catch (e) {}
}
document.getElementById('qualitySel')!.addEventListener('change', (e) => { if (ctx) applyQuality(ctx.renderer, (e.target as HTMLSelectElement).value); });

// Invisible targets for gluing: each pole block, and each traffic light that has its own pole
let signTargets: THREE.Group | null = null;
function buildSignTargets() {
  if (signTargets && ctx) ctx.scene.remove(signTargets);
  signTargets = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  for (const r of recs) {
    if (r.cat === 'pole') {
      const o = r.orient ?? 'vert';
      const m = new THREE.Mesh(poleBox(o, r.len, r.thick), mat);
      m.position.set(r.x, r.z, -r.y); m.rotation.y = poleRotY({ orient: o, yaw: r.yaw ?? 0 });
      m.userData.id = r.id; signTargets.add(m);
    } else if (r.cat === 'light' && r.mode === 'pole') {
      // the light's own pole is 5.2 m tall (from its origin up): a sign can glue to any side of it, above or below the head
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.2, 0.3), mat);
      m.position.set(r.x, r.z + 2.6, -r.y);
      m.userData.id = r.id; signTargets.add(m);
    }
  }
  if (ctx) ctx.scene.add(signTargets);
}

function markActive() { poly = []; pending = null; const cat = hand.cat === 'sfloat' ? 'sign' : hand.cat; document.querySelectorAll<HTMLElement>('#inv .item').forEach((el) => el.classList.toggle('active', el.dataset.cat === cat && el.dataset.key === hand.key)); }

// ---------- inspector ----------
function select(id: number | null) {
  selectedId = id;
  const side = document.getElementById('side')!;
  const r = recs.find((q) => q.id === id);
  if (!r) { side.classList.remove('show'); return; }
  side.classList.add('show');
  const sign = r.cat === 'sign' ? SIGNS.find((s) => s.type === r.type) : null;
  const title = r.cat === 'sign' ? sign!.name : r.cat === 'light' ? 'Семафор' : r.cat === 'pole' ? 'Столбче-коцка' : r.cat === 'prop' ? (r.kind === 'tree' ? (TREES.find((t) => t.key === r.type)?.name ?? 'Дрво') : 'Улична светилка') : markDef(r.key).name;
  document.getElementById('ins-title')!.textContent = title;
  const signLike = r.cat === 'sign' || r.cat === 'light';
  (document.getElementById('ins-facing')!.closest('.irow') as HTMLElement).style.display = r.cat === 'mark' ? 'none' : 'flex';
  (document.getElementById('ins-verified')!.closest('.irow') as HTMLElement).style.display = signLike ? 'flex' : 'none';
  (document.getElementById('ins-width')!.closest('.irow') as HTMLElement).style.display = r.cat === 'mark' ? 'flex' : 'none';
  const isPole = r.cat === 'pole'; // pole blocks have a fixed size: only their turn can change
  const isLight = r.cat === 'light';
  (document.getElementById('row-timer') as HTMLElement).style.display = isLight ? 'flex' : 'none';
  (document.getElementById('row-offset') as HTMLElement).style.display = isLight ? 'flex' : 'none';
  if (isLight) {
    (document.getElementById('ins-g') as HTMLInputElement).value = String(r.green);
    (document.getElementById('ins-y') as HTMLInputElement).value = String(r.yellow);
    (document.getElementById('ins-r') as HTMLInputElement).value = String(r.red);
    (document.getElementById('ins-off') as HTMLInputElement).value = String(r.offset);
  }
  (document.getElementById('ins-width') as HTMLInputElement).value = r.cat === 'mark' ? String(r.width) : '';
  (document.getElementById('ins-facing') as HTMLInputElement).value = String(Math.round((isPole ? (r.yaw ?? 0) : r.cat === 'mark' ? 0 : (r.facing ?? 0)) * 10) / 10);
  (document.getElementById('ins-verified') as HTMLInputElement).checked = r.verified;
  (document.getElementById('ins-note') as HTMLTextAreaElement).value = r.note;
}
document.getElementById('ins-facing')!.addEventListener('input', (e) => {
  const r = recs.find((q) => q.id === selectedId);
  if (!r || r.cat === 'mark') return;
  const deg = (((parseFloat((e.target as HTMLInputElement).value) || 0) % 360) + 360) % 360;
  if (r.cat === 'pole') r.yaw = deg; else r.facing = deg;
  rebuild(); save();
});
// timer panel: type the green, yellow and red times (seconds) and the start offset
for (const [id, field] of [['ins-g', 'green'], ['ins-y', 'yellow'], ['ins-r', 'red'], ['ins-off', 'offset']] as const) {
  document.getElementById(id)!.addEventListener('input', (e) => {
    const r = recs.find((q) => q.id === selectedId);
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!r || r.cat !== 'light' || !(v >= 0) || (field !== 'offset' && field !== 'yellow' && v <= 0)) return;
    r[field] = v; save();
  });
}
document.getElementById('ins-width')!.addEventListener('input', (e) => {
  const r = recs.find((q) => q.id === selectedId);
  const w = parseFloat((e.target as HTMLInputElement).value);
  if (!r || r.cat !== 'mark' || !(w > 0)) return;
  r.width = w; rebuild(); save();
});
document.getElementById('ins-verified')!.addEventListener('change', (e) => { const r = recs.find((q) => q.id === selectedId); if (r) { r.verified = (e.target as HTMLInputElement).checked; save(); } });
document.getElementById('ins-note')!.addEventListener('input', (e) => { const r = recs.find((q) => q.id === selectedId); if (r) { r.note = (e.target as HTMLTextAreaElement).value; save(); } });
document.getElementById('delBtn')!.addEventListener('click', () => { if (selectedId !== null) removeRec(selectedId); });

// ---------- survey export (the file the game reads) ----------
function surveyFeatures(list: Rec[] = recs): any[] {
  const date = new Date().toISOString().slice(0, 10);
  const who = surveyor();
  const out: any[] = [];
  let k = 1;
  const id = () => `B-${String(k++).padStart(3, '0')}`;
  for (const r of list) {
    if (r.cat === 'prop' || r.cat === 'pole') continue;
    const base = { source: 'builder (placed in the game with a free camera, not verified on site)', surveyor: who, surveyDate: date, verified: r.verified, ...(r.note ? { note: r.note } : {}) };
    if (r.cat === 'sign') {
      const s = SIGNS.find((q) => q.type === r.type)!;
      if (!s.exportable || !s.code) continue;
      out.push({ type: 'Feature', id: id(), geometry: { type: 'Point', coordinates: lonLat(r.x, r.y) }, properties: { kind: 'sign', code: s.code, facing: r.facing, roadSide: 'right', ...base } });
    } else if (r.cat === 'light') {
      out.push({ type: 'Feature', id: id(), geometry: { type: 'Point', coordinates: lonLat(r.x, r.y) }, properties: { kind: 'light', code: 'VI-4.1', facing: r.facing, roadSide: 'right', ...base } });
    } else {
      const m = markDef(r.key);
      if (!m.code) continue; // solid and dashed lines go to the markings file until their code is confirmed
      if (r.kind === 'zebra') {
        // the game's survey zebra is a polygon: the crossing depth is the width across the path
        const [a, c] = r.pts; const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const nx = (-dy / L) * r.width, ny = (dx / L) * r.width;
        const ring = [a, c, [c[0] + nx, c[1] + ny], [a[0] + nx, a[1] + ny], a].map(([x, y]) => lonLat(x, y));
        out.push({ type: 'Feature', id: id(), geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'area', code: m.code, ...base } });
      } else {
        out.push({ type: 'Feature', id: id(), geometry: { type: 'LineString', coordinates: r.pts.map(([x, y]) => lonLat(x, y)) }, properties: { kind: 'line', code: m.code, widthM: r.width, ...base } });
      }
    }
  }
  return out;
}
function markingsFile(list: Rec[] = recs) {
  const who = surveyor();
  return list.filter((r): r is Rec & { cat: 'mark' } => r.cat === 'mark' && !markDef(r.key).code).map((r, i) => ({
    type: 'Feature', id: `M-${String(i + 1).padStart(3, '0')}`,
    geometry: { type: 'MultiLineString', coordinates: strokesOf(r).map((st) => st.map(([x, y]) => lonLat(x, y))) },
    properties: { pattern: (r as any).key, width: (r as any).width, surveyor: who, verified: r.verified, note: r.note },
  }));
}
function lonLat(x: number, y: number): [number, number] {
  const B = { north: 42.0081198283681, south: 41.998828670911365, west: 21.406403607562424, east: 21.41886132316271 };
  return [B.west + ((x + 512) / 1024) * (B.east - B.west), B.south + ((y + 512) / 1024) * (B.north - B.south)];
}
function download(name: string, obj: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/geo+json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.getElementById('exportBtn')!.addEventListener('click', () => {
  // the survey file keeps everything already in it, and appends what you placed
  download('prviot_krug.geojson', { ...surveyRaw, type: 'FeatureCollection', features: [...surveyRaw.features, ...surveyFeatures()] });
  const mk = markingsFile();
  if (mk.length) download('markings.geojson', { type: 'FeatureCollection', features: mk });
});
document.getElementById('clearBtn')!.addEventListener('click', () => { if (confirm('Да ги избришам ставките што си ги додал? Резерва останува во Верзии.')) { backupBeforeReplace('бришење'); recs = []; select(null); rebuild(); save(); } });

// ---------- mod export: a file the game applies (public/mods/active.json) ----------
interface Version { id: number; name: string; savedAt: string; recs: Rec[]; nextId: number }
/** The mod file (version 2): every item exactly as the builder has it. The game draws the same items. */
function modOf(list: Rec[], name: string) {
  const who = surveyor();
  return {
    format: 'mapng-mod', version: 2, name, label: `${list.length} items`, createdAt: new Date().toISOString(),
    surveyor: who,
    items: JSON.parse(JSON.stringify(list)) as UserItem[],
  };
}
let versionList: Version[] = [];
function versions(): Version[] { return versionList; }
function setVersions(v: Version[]) { versionList = v; persistSoon(); }
function refreshVersions(keep?: number) {
  const sel = document.getElementById('verSel') as HTMLSelectElement;
  const list = versions();
  sel.innerHTML = list.length ? '' : '<option value="">Нема верзии</option>';
  list.forEach((v) => { const o = document.createElement('option'); o.value = String(v.id); o.textContent = `${v.name} · ${v.recs.length}`; sel.appendChild(o); });
  if (keep !== undefined) sel.value = String(keep);
}
function selectedVersion(): Version | null { const id = Number((document.getElementById('verSel') as HTMLSelectElement).value); return versions().find((v) => v.id === id) ?? null; }
document.getElementById('saveVer')!.addEventListener('click', () => {
  const list = versions();
  const name = prompt('Име на верзијата', `Верзија ${list.length + 1}`);
  if (!name) return;
  const v: Version = { id: Date.now(), name, savedAt: new Date().toISOString(), recs: JSON.parse(JSON.stringify(recs)), nextId };
  setVersions([...list, v]); refreshVersions(v.id); msg(`Зачувана е „${name}“`);
});
document.getElementById('loadVer')!.addEventListener('click', () => {
  const v = selectedVersion(); if (!v) return;
  if (!confirm(`Да ја вратам „${v.name}“? Сегашната работа останува како резерва.`)) return;
  backupBeforeReplace('вчитување верзија');
  recs = JSON.parse(JSON.stringify(v.recs)); nextId = v.nextId; select(null); rebuild(); save(); msg(`Вратена е „${v.name}“`);
});
document.getElementById('delVer')!.addEventListener('click', () => {
  const v = selectedVersion(); if (!v) return;
  if (!confirm(`Да ја избришам верзијата „${v.name}“?`)) return;
  setVersions(versions().filter((q) => q.id !== v.id)); refreshVersions();
});
document.getElementById('saveProj')!.addEventListener('click', () => {
  const s = sessionOf();
  const who = (s.surveyor || 'project').replace(/\W+/g, '_');
  download(`krug_project_${who}_${new Date().toISOString().slice(0, 10)}.json`, s);
  msg('Проектот е зачуван. Се отвора во било кој прелистувач.');
});
document.getElementById('openProjBtn')!.addEventListener('click', () => (document.getElementById('openProj') as HTMLInputElement).click());
document.getElementById('openProj')!.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  let d: any;
  try { d = JSON.parse(await file.text()); } catch (err) { msg('Датотеката не е валидна.'); return; }
  let s: Session | null = null;
  if (d && d.format === SESSION_FORMAT && Array.isArray(d.recs)) s = d as Session;
  else if (d && d.format === 'mapng-mod' && Array.isArray(d.items)) s = { format: SESSION_FORMAT, version: 1, savedAt: new Date().toISOString(), surveyor: d.surveyor || '', nextId: 1, recs: d.items, versions: [] };
  if (!s) { msg('Датотеката не е проект ниту извоз.'); return; }
  if (!confirm(`Да се отвори „${file.name}“ со ${s.recs.length} ставки? Твоите сегашни ставки остануваат како резерва во Верзии.`)) return;
  backupBeforeReplace('отворање датотека');
  applySession(s, true);
  void persistNow();
  msg(`Отворено: ${file.name} · ${recs.length} ставки.`);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) void persistNow(); });
/** Saves the work to your account (admin: publishes it for everyone). Returns true when it is saved. */
async function saveToAccount(): Promise<boolean> {
  const a = cloud.account();
  if (!a) { msg('Најави се за да зачуваш.'); return false; }
  let admin = false;
  try { admin = (await cloud.me()).admin; } catch { /* the server checks again on save */ }
  // your game lives on your account (any device); the admin's game is the published one everyone plays
  const target = admin ? 'published' : a.username;
  if (admin && !confirm(`Ова ќе ја промени играта за сите играчи. Да ги објавам ${recs.length} ставки?`)) return false;
  try {
    await persistNow();
    const current = await cloud.loadWorkspace(target).catch(() => null);
    const data = { format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: a.username, items: JSON.parse(JSON.stringify(recs)) };
    await cloud.saveWorkspace(target, data, current?.version ?? 0);
    unsaved = false;
    onAccount = true;
    setStatus();
    msg(admin ? `Објавено за сите · ${recs.length} ставки` : `Зачувано на профилот · ${recs.length} ставки`);
    return true;
  } catch (e) {
    if (e instanceof cloud.CloudError && e.status === 401) msg('Најави се повторно за да зачуваш.');
    else if (e instanceof cloud.CloudError && e.status === 409) msg('Некој зачувал меѓувреме. Вчитај ја најновата верзија и пробај повторно.');
    else msg(e instanceof cloud.CloudError ? e.message : 'Не успеав да зачувам.');
    return false;
  }
}
document.getElementById('saveGame')!.addEventListener('click', () => { void saveToAccount(); });
// ⌘S saves too
window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') { e.preventDefault(); void saveToAccount(); } });
/** The save button says what it does for this account: the admin publishes, everyone else saves. */
function labelSave() {
  const b = document.getElementById('saveGame')!;
  b.textContent = 'Зачувај';
  const admin = (on: boolean) => {
    document.querySelectorAll<HTMLElement>('.admin-only').forEach((el) => (el.hidden = !on));
    document.querySelectorAll<HTMLElement>('.player-only').forEach((el) => (el.hidden = on));
  };
  admin(false);
  if (cloud.account()) cloud.me().then((r) => {
    b.textContent = r.admin ? 'Објави' : 'Зачувај';
    b.title = r.admin ? 'Ја менува играта за сите играчи (⌘S)' : 'Зачувај на твојот профил (⌘S)';
    admin(r.admin);
  }).catch(() => {});
}
labelSave();
initTips();

// ---------- leaving: unsaved work asks first (buttons, the exit link, the back button, closing the tab) ----------
const leaveDlg = document.getElementById('leaveDlg')!;
let leaveTo: string | null = null;
function askLeave(to: string) {
  leaveTo = to;
  leaveDlg.hidden = false;
}
function goNow(to: string) {
  unsaved = false; // the copy on this computer is already kept
  location.replace(to);
}
document.getElementById('dlgStay')!.addEventListener('click', () => { leaveDlg.hidden = true; leaveTo = null; });
document.getElementById('dlgLeave')!.addEventListener('click', () => { if (leaveTo) goNow(leaveTo); });
document.getElementById('dlgSave')!.addEventListener('click', async () => {
  const ok = await saveToAccount();
  if (ok && leaveTo) goNow(leaveTo);
});
// links out of the builder
window.addEventListener('click', (e) => {
  const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-go]');
  if (!link || !unsaved) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  askLeave(link.href);
}, true);
// closing the tab, reloading or the power going off: the browser shows its own prompt
window.addEventListener('beforeunload', (e) => { if (unsaved) { e.preventDefault(); e.returnValue = ''; } });
// the browser back button: keep this page, and ask first
history.pushState({ builder: true }, '');
window.addEventListener('popstate', () => {
  if (!unsaved) return;
  history.pushState({ builder: true }, '');
  askLeave(`${import.meta.env.BASE_URL}play/`);
});

// autosave: every change is already kept on this computer; every 10 minutes a snapshot goes into Versions
setInterval(() => {
  if (!restored || !recs.length) return;
  const snap = JSON.stringify(recs);
  if (snap === lastSnapshot) return;
  lastSnapshot = snap;
  const v: Version = { id: Date.now(), name: `автозачувување ${clock()}`, savedAt: new Date().toISOString(), recs: JSON.parse(snap), nextId };
  const auto = versionList.filter((q) => q.name.startsWith('автозачувување '));
  let list = [...versionList, v];
  if (auto.length >= 6) { const drop = new Set(auto.slice(0, auto.length - 5).map((q) => q.id)); list = list.filter((q) => !drop.has(q.id)); }
  setVersions(list);
}, 10 * 60 * 1000);
let lastSnapshot = '';

document.getElementById('loadGame')!.addEventListener('click', async () => {
  const f = await loadItems();
  if (!f) { msg('Играта нема ставки за вчитување.'); return; }
  if (!confirm(`Да ги вчитам ${f.items.length} ставки што ги покажува играта? Твоите сегашни ставки остануваат како резерва во Верзии.`)) return;
  backupBeforeReplace('вчитување од играта');
  applySession(gameSession(f), true);
  void persistNow();
  msg(`Вчитани се ${recs.length} ставки од играта.`);
});
document.getElementById('modBtn')!.addEventListener('click', () => {
  const v = selectedVersion();
  const mod = v ? modOf(v.recs, v.name) : modOf(recs, 'current');
  // the published default for everyone: commit it as public/items/default.json
  download('default.json', mod);
  msg('Датотеката default.json е готова. Стави ја во public/items/ за да ја видат сите.');
});

// ---------- your work: kept in this browser, and as a project file you can save and open ----------
const SESSION_FORMAT = 'krug-builder-session';
let persistTimer: number | undefined;
let restored = false; // nothing is written until the saved session has been read: an empty start must never overwrite it
let unsaved = false; // changed since the last save to your account
let emergencyRestored = false; // you chose the emergency copy: do not replace it with the account's game
let accountLoaded = false;
/** Opens the signed-in account's saved game (the admin: the published game). Waits until the map is ready. */
async function loadAccountGame() {
  const a = cloud.account();
  if (!a || accountLoaded || emergencyRestored) return;
  if (!ctx || !restored) { pendingAccountLoad = true; return; }
  accountLoaded = true;
  let admin = false;
  try { admin = (await cloud.me()).admin; } catch { /* not reachable: keep what is open */ }
  const w = await cloud.loadWorkspace(admin ? 'published' : a.username).catch(() => null);
  const f = w?.data as { items?: Rec[] } | null;
  if (!w || !f || !Array.isArray(f.items)) return; // nothing saved yet: start from what the game shows
  backupBeforeReplace('вчитување од профилот');
  applySession({ format: 'krug-builder-session', version: 1, savedAt: w.savedAt, surveyor: a.username, nextId: 1, recs: f.items, versions: [] }, true);
  unsaved = false;
  onAccount = true;
  setStatus();
  void persistNow();
  msg(`Твојата игра е отворена · ${recs.length} ставки`);
}
let pendingAccountLoad = false;
function save() {
  const cur = JSON.stringify({ recs, nextId });
  if (lastState && cur !== lastState) {
    unsaved = true;
    undoStack.push(lastState);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
  }
  lastState = cur;
  updateHistoryButtons();
  setStatus(statusError, !!statusError);
  persistSoon();
}
function persistSoon() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => void persistNow(), 300);
}
function sessionOf(): Session {
  return {
    format: SESSION_FORMAT, version: 1, savedAt: new Date().toISOString(),
    surveyor: surveyor(),
    nextId, recs: JSON.parse(JSON.stringify(recs)), versions: JSON.parse(JSON.stringify(versionList)),
  };
}
let statusError = '';
let onAccount = false; // what is open is exactly what your account has (opened from it, or saved to it)
/** The toolbar status: an error, unsaved changes, or saved. Every change is also kept on this computer. */
function setStatus(text = '', bad = false) {
  statusError = bad ? text : '';
  const el = document.getElementById('saveStatus')!;
  el.classList.toggle('bad', !!statusError);
  el.classList.toggle('dirty', !statusError && unsaved);
  el.textContent = statusError || (unsaved ? 'Незачувано' : onAccount ? 'Зачувано' : '');
  el.title = statusError ? '' : unsaved ? 'Промените се на овој компјутер. Притисни „Зачувај“ за профилот.' : '';
}
async function persistNow() {
  window.clearTimeout(persistTimer);
  if (!restored) return;
  const s = sessionOf();
  try {
    await writeSession(s);
    setStatus();
  } catch (e) {
    setStatus('Не се чува локално', true);
    msg('Прелистувачот не дозволува чување. Зачувај на профилот или сними проект.');
  }
}
/** Puts a session's items (and, when merging, its versions) back in the builder. */
function applySession(s: Session, mergeVersions: boolean) {
  recs = (s.recs as Rec[]).filter((q) => q && typeof q.id === 'number' && typeof q.cat === 'string').map((q) => {
    if (q.cat === 'pole') { q.orient = 'vert'; q.yaw = q.yaw ?? 0; q.len = POLE_L; q.thick = POLE_W; }
    return q;
  });
  nextId = Math.max(Number(s.nextId) || 1, ...recs.map((q) => q.id + 1));
  const incoming = Array.isArray(s.versions) ? (s.versions as Version[]) : [];
  const seen = new Set<number>();
  versionList = (mergeVersions ? [...versionList, ...incoming] : incoming).filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
  undoStack = []; redoStack = [];
  select(null); rebuild(); refreshVersions();
  lastState = JSON.stringify({ recs, nextId });
  updateHistoryButtons();
}
/** The game's items as a builder session (so the builder starts from what the game shows). */
function gameSession(f: ItemsFile): Session {
  return { format: 'krug-builder-session', version: 1, savedAt: f.savedAt, surveyor: f.surveyor, nextId: 1, recs: f.items, versions: [] };
}
/** Opens the newest session saved in this browser. If it cannot be read, nothing is written over it. */
async function restoreSession() {
  let s: Session | null = null;
  try {
    s = await readSession();
  } catch (e) {
    setStatus('Не може да се прочита зачуваното', true);
    refreshVersions();
    return;
  }
  restored = true;
  // an emergency copy from a session that did not close properly: offer it back, do not load it silently
  if (s && s.recs.length && !(emergencyRestored = confirm(`Пронајдена е незачувана работа од прекинатa сесија (${s.recs.length} ставки). Да ја вратам?`))) {
    s = null;
    await kvDel('session').catch(() => undefined);
  }
  if (!s) {
    const f = await loadItems();
    if (f) s = gameSession(f);
  }
  if (!s) {
    refreshVersions();
    lastState = JSON.stringify({ recs, nextId });
    updateHistoryButtons();
    setStatus();
    return;
  }
  applySession(s, false);
  if (emergencyRestored) unsaved = true; // a rescued copy is not on your account yet
  setStatus();
  persistSoon();
}
/** Before a non-empty map is replaced, keep it as a backup in Versions (the 20 newest backups are kept). */
function backupBeforeReplace(why: string) {
  if (!recs.length) return;
  const v: Version = { id: Date.now(), name: `резерва ${clock()} · ${why}`, savedAt: new Date().toISOString(), recs: JSON.parse(JSON.stringify(recs)), nextId };
  let list = [...versionList, v];
  const auto = list.filter((q) => q.name.startsWith('резерва '));
  if (auto.length > 20) { const drop = new Set(auto.slice(0, auto.length - 20).map((q) => q.id)); list = list.filter((q) => !drop.has(q.id)); }
  setVersions(list); refreshVersions(v.id);
}
function applyState(json: string) {
  const d = JSON.parse(json);
  recs = d.recs; nextId = d.nextId;
  lastState = json;
  select(null); rebuild();
  persistSoon();
  updateHistoryButtons();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) { msg('Нема што да се врати'); return; }
  redoStack.push(lastState);
  applyState(prev);
}
function redo() {
  const next = redoStack.pop();
  if (!next) { msg('Нема што да се повтори'); return; }
  undoStack.push(lastState);
  applyState(next);
}
function updateHistoryButtons() {
  (document.getElementById('undoBtn') as HTMLButtonElement).disabled = undoStack.length === 0;
  (document.getElementById('redoBtn') as HTMLButtonElement).disabled = redoStack.length === 0;
  (document.getElementById('undoBtn') as HTMLButtonElement).title = `Врати (⌘Z) · ${undoStack.length} од ${HISTORY_MAX}`;
}

// ---------- UI ----------
let msgTimer = 0;
function msg(text: string) {
  const el = document.getElementById('msg')!;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
}
function info(camera: THREE.PerspectiveCamera) {
  const it = hand;
  const label = it.cat === 'pole' ? POLE_ITEMS.find((p) => p.key === it.key)!.name : it.cat === 'sign' ? SIGNS.find((s) => s.type === it.key)!.name : it.cat === 'sfloat' ? `${SIGNS.find((s) => s.type === it.key)!.name}, без столб` : it.cat === 'light' ? `Семафор ${LIGHT_ITEMS.find((l) => l.key === it.key)!.name.toLowerCase()}` : it.cat === 'tree' ? TREES.find((t) => t.key === it.key)!.name : it.cat === 'lamp' ? 'Улична светилка' : it.cat === 'axe' ? 'Секира' : markDef(it.key).name;
  const how = it.cat === 'axe' ? 'кликни на твоја ставка'
    : it.cat === 'tpl' ? 'кликни за да поставиш · Q / E сврти'
    : it.cat === 'mark' && MARKS.find((m) => m.key === it.key)!.poly ? (poly.length ? 'кликни следна точка · Enter заврши · X откажи' : 'кликни за почеток на линијата')
    : it.cat === 'mark' ? (pending ? 'кликни крајна точка · X откажи' : 'кликни почетна точка')
    : it.cat === 'pole' || it.cat === 'tree' || it.cat === 'lamp' ? 'кликни за да поставиш · Q / E сврти'
    : 'кликни за да поставиш';
  const el = document.getElementById('info')!;
  const html = `<b>${label}</b> · ${aim ? how : 'насочи кон земјата'}`;
  if (el.innerHTML !== html) el.innerHTML = html;
  void camera;
}

// ---------- the "more" panel ----------
const drawer = document.getElementById('drawer')!;
const menuToggle = document.getElementById('menuToggle')!;
function setDrawer(open: boolean) {
  drawer.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  document.getElementById('bld')!.classList.toggle('drawer-open', open);
}
menuToggle.addEventListener('click', () => setDrawer(drawer.hidden));

// ---------- controls and keys ----------
// A clicked button or menu keeps keyboard focus, so Space would click it again. Clicks drop the focus,
// and Space is kept for flying up or jumping while no control has it.
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'BUTTON' || t.tagName === 'SELECT')) t.blur();
}, true);
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (e.code === 'Space' && t && (t.tagName === 'BUTTON' || t.tagName === 'SELECT')) { e.preventDefault(); t.blur(); }
}, true);

// ---------- start ----------
const gate = document.getElementById('gate')!;
// start with the mouse free, so the top bar and the exit button can always be clicked (C locks the view)
document.getElementById('startBtn')!.addEventListener('click', () => { gate.style.display = 'none'; });
function lockView() {
  // Browsers refuse the mouse lock for a moment after Esc, and need a click after that: say so instead of failing silently
  const c = canvas();
  if (!c) return;
  const p = c.requestPointerLock() as unknown as Promise<void> | undefined;
  if (p && typeof p.catch === 'function') p.catch(() => msg('Прелистувачот го блокира глушецот: притисни C повторно.'));
}
document.addEventListener('pointerlockerror', () => msg('Прелистувачот го блокира глушецот: притисни C повторно.'));
// the button is the switch: one click turns mouse look on, the next frees the mouse
// the top-bar label only shows the mode; switching is done with C (look and free) and Esc (free)
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas();
  lookBtn.textContent = locked ? 'Гледање · C' : 'Слободен глушец · C';
  lookBtn.classList.toggle('on', locked);
});
window.addEventListener('mousemove', (e) => {
  // without the locked mouse, right-drag turns the camera too (same sensitivity)
  if (!locked && rightDrag) {
    yaw -= (e.clientX - rightDrag.x) * mouseSens; pitch -= (e.clientY - rightDrag.y) * mouseSens;
    pitch = Math.max(-1.5, Math.min(1.5, pitch));
    rightDrag = { x: e.clientX, y: e.clientY };
    return;
  }
  if (!locked) return;
  yaw -= e.movementX * mouseSens; pitch -= e.movementY * mouseSens;
  pitch = Math.max(-1.5, Math.min(1.5, pitch));
});
window.addEventListener('wheel', (e) => { if (locked) moveSpeed = Math.max(2, Math.min(120, moveSpeed * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); }, { passive: true });
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
  // Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo
  if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyZ' || e.code === 'KeyY')) {
    e.preventDefault();
    if (e.code === 'KeyY' || e.shiftKey) redo(); else undo();
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyX') { pending = null; poly = []; msg('Линијата е откажана'); }
  else if (e.code === 'KeyK') { const it = ITEMS.find((q) => q.cat === 'axe')!; hand = it; markActive(); msg('Секира: насочи кон твоја ставка и кликни'); }
  else if (e.code === 'KeyC') { if (locked) document.exitPointerLock(); else lockView(); } // C: mouse look on / free
  else if (e.code === 'Enter') { if (poly.length) finishPoly(); }
  else if (e.code === 'Backspace') { if (poly.length) poly.pop(); }  // only undoes the last point of a line being drawn
  else if (e.code === 'Delete') { if (selectedId !== null) removeRec(selectedId); }
  else if (e.code === 'KeyQ' || e.code === 'KeyE') {
    const d = e.code === 'KeyE' ? 1 : -1; // one degree per press
    if (hand.cat === 'tpl') tplRot = (((tplRot + d) % 360) + 360) % 360;
    if (hand.cat === 'tree' || hand.cat === 'lamp') propTurn = (((propTurn + d) % 360) + 360) % 360;
    if (hand.cat === 'pole') poleTurn = (((poleTurn + d) % 360) + 360) % 360;
  }
  else if (e.code === 'KeyV') { walkMode = !walkMode; vel.set(0, 0, 0); msg(walkMode ? 'Одење · Space скока' : 'Летање · Space и Shift за горе и долу'); }
  else if (e.code === 'KeyF') { const id = aim ? nearestRec(aim, 3) : null; select(id); }
  else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    const r = recs.find((q) => q.id === selectedId);
    if (r) { turnRec(r, e.code === 'BracketRight' ? 1 : -1); rebuild(); select(r.id); save(); }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas()?.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => { if (e.target instanceof HTMLCanvasElement && e.button === 2 && !locked) rightDrag = { x: e.clientX, y: e.clientY }; });
window.addEventListener('mouseup', () => { rightDrag = null; });
(document.getElementById('sensSel') as HTMLSelectElement).addEventListener('change', (e) => (mouseSens = parseFloat((e.target as HTMLSelectElement).value)));
window.addEventListener('mousedown', (e) => {
  // only clicks on the 3D view place, lock or remove: clicks on the menus and the sign list are left to those controls
  if (!(e.target instanceof HTMLCanvasElement)) return;
  if (gate.style.display !== 'none' || !ctx || !aimCam) return;
  // clicks place at the pointer when the mouse is free, and at the crosshair when it is locked (C switches)
  if (e.button === 0) { if (hand.cat === 'axe') axeChop(); else placeAtAim(e.shiftKey, aimCam); }
  if (e.button === 2 && aim) { const id = nearestRec(aim, 3); if (id !== null) removeRec(id); }
});
(document.getElementById('snap') as HTMLSelectElement).addEventListener('change', (e) => (snap = parseFloat((e.target as HTMLSelectElement).value)));
(document.getElementById('compassSel') as HTMLSelectElement).addEventListener('change', (e) => (compassStep = parseFloat((e.target as HTMLSelectElement).value)));
(document.getElementById('speedSel') as HTMLSelectElement).addEventListener('change', (e) => (moveSpeed = parseFloat((e.target as HTMLSelectElement).value)));
document.getElementById('undoBtn')!.addEventListener('click', undo);
document.getElementById('redoBtn')!.addEventListener('click', redo);

// ---------- hooks into the game boot ----------
startGame({
  drive(camera, dt) {
    freeCamera(camera, dt);
    // depth precision: the near plane follows the altitude, so thin markings stay visible from high up
    const alt = ctx ? camera.position.y - ctx.heightAt(camera.position.x, -camera.position.z) : 2;
    const near = Math.min(4, Math.max(0.2, alt / 150));
    if (Math.abs(camera.near - near) > 0.01) { camera.near = near; camera.updateProjectionMatrix(); }
    aimCam = camera;
    aim = aimPoint(camera, aimNdc());
    updateMarkers(camera);
    updateGuide();
    updateAxe(camera);
    {
      const t = (performance.now() - clockStart) / 1000;
      for (const u of lightUpdaters) u.update((id) => { const r = u.recs[-1 - id]; return r && r.cat === 'light' ? lampOf(r, t) : 'off'; });
    }
    info(camera);
  },
  focus(camera) { return [camera.position.x, -camera.position.z]; },
  async ready(c) {
    ctx = c;
    // the builder draws at normal resolution by default: on high-density screens the full resolution is 4× the pixels
    applyQuality(c.renderer, (localStorage.getItem('builder.quality') as string) || '1');
    await restoreSession();
    if (cloud.account() || pendingAccountLoad) void loadAccountGame();
    buildInventory();
    // start where the game starts: the parking at the spawn point
    const sp = c.level.route.start.p;
    pos.set(sp[0], c.heightAt(sp[0], sp[1]) + 12, -sp[1]);
    yaw = c.level.route.start.heading + Math.PI; pitch = -0.6;
    // existing survey file: kept as it is, the new items are appended on export
    try { const fc = await (await fetch(SURVEY_URL)).json(); surveyRaw = fc; } catch (e) { surveyRaw = { features: [] }; }
    rebuild();
  },
});

// ghost: the placeholder or line being placed, drawn in yellow; the compass readout follows the bearing
const ghost = new THREE.Group();
let ghostAdded = false;
function updateGuide() {
  const compass = document.getElementById('compass')!;
  const text = document.getElementById('compassText')!;
  if (!ctx) return;
  if (!ghostAdded) { ctx.scene.add(ghost); ghostAdded = true; }
  while (ghost.children.length) { const o = ghost.children.pop() as THREE.Line; o.geometry.dispose(); }
  const tip = aim ? snapLines(aim) : null;
  // pointer for the items you place by point: a yellow square where it lands, and an arrow for the way it turns (Q / E)
  if (aimCam && (hand.cat === 'pole' || hand.cat === 'tree' || hand.cat === 'lamp')) {
    const pa = aimPoint(aimCam, aimNdc());
    if (pa) {
      const isPole = hand.cat === 'pole';
      const cx = isPole ? Math.floor(pa[0] / POLE_W) * POLE_W + POLE_W / 2 : pa[0];
      const cy = isPole ? Math.floor(pa[1] / POLE_W) * POLE_W + POLE_W / 2 : pa[1];
      const y = heightOf(cx, cy) + 0.12;
      // the pole turns with poleTurn; a tree or lamp faces you as you spawn it, plus the turn set with Q / E
      const bearing = isPole ? poleTurn : (Math.atan2(aimCam.position.x - cx, -aimCam.position.z - cy) * 180) / Math.PI + propTurn;
      const t = (bearing * Math.PI) / 180;
      const fx = Math.sin(t), fy = Math.cos(t); // forward: bearing 0 = north, clockwise
      const rx = Math.cos(t), ry = -Math.sin(t); // right of forward
      const half = isPole ? POLE_W / 2 : 0.3;
      const at = (u: number, v: number): [number, number] => [cx + u * rx + v * fx, cy + u * ry + v * fy];
      const sq = [at(-half, -half), at(half, -half), at(half, half), at(-half, half), at(-half, -half)];
      const reach = isPole ? 0.25 : 1.2;
      const tip = at(0, reach);
      const hw = isPole ? 0.05 : 0.35, hb = isPole ? 0.08 : 0.3; // arrow head: half width and length
      const head1 = at(hw, reach - hb), head2 = at(-hw, reach - hb);
      const P = (q: [number, number]) => new THREE.Vector3(q[0], y, -q[1]);
      const pts: THREE.Vector3[] = sq.map(P);
      pts.push(P([cx, cy]), P(tip), P(tip), P(head1), P(tip), P(head2));
      ghost.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf2b84b })));
    }
  }
  let strokes: [number, number][][] = [];
  let from: [number, number] | null = null;
  if (hand.cat === 'tpl' && tip) strokes = templateStrokes(hand.key, tip);
  else if (poly.length && tip) { const last = poly[poly.length - 1]; from = last; strokes = [[...poly, snapBearing(last, tip)]]; }
  else if (pending && tip) { from = pending; strokes = [[pending, snapBearing(pending, tip)]]; }
  for (const st of strokes) {
    const g = new THREE.BufferGeometry().setFromPoints(st.map(([x, y]) => new THREE.Vector3(x, heightOf(x, y) + 0.12, -y)));
    ghost.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf2b84b })));
  }
  if (from && tip) {
    const snapped = snapBearing(from, tip);
    const b = bearingOf(from, tip), sb = bearingOf(from, snapped);
    (document.getElementById('needle') as HTMLElement).style.transform = `rotate(${sb}deg)`;
    compass.classList.add('on');
    void b;
    text.textContent = `${compassName(sb)} · ${Math.hypot(snapped[0] - from[0], snapped[1] - from[1]).toFixed(1).replace('.', ',')} м`;
  } else if (hand.cat === 'tpl') {
    (document.getElementById('needle') as HTMLElement).style.transform = `rotate(${tplRot}deg)`;
    compass.classList.add('on');
    text.textContent = compassName(tplRot);
  } else {
    compass.classList.remove('on');
  }
}

// aim marker: a ring on the ground at the aim point
const marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2b84b, side: THREE.DoubleSide, depthTest: false }));
marker.renderOrder = 999;
let markerAdded = false;
function updateMarkers(camera: THREE.PerspectiveCamera) {
  if (!ctx) return;
  if (!markerAdded) { ctx.scene.add(marker); markerAdded = true; }
  marker.visible = !!aim;
  if (aim) marker.position.set(aim[0], heightOf(aim[0], aim[1]) + 0.05, -aim[1]);
  void camera;
}

// test hook for the browser check (no effect on use)
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__bld = {
  get recs() { return recs; },
  hand(cat: 'sign' | 'light' | 'mark', key: string) { hand = { cat, key }; pending = null; markActive(); },
  view(x: number, y: number, yawDeg: number, pitchDeg: number, h?: number) { pos.set(x, h ?? ((ctx ? ctx.heightAt(x, y) : 0) + 1.7), -y); yaw = (yawDeg * Math.PI) / 180; pitch = (pitchDeg * Math.PI) / 180; },
  placeAt(x: number, y: number) { if (aimCam) placeAtAim(false, aimCam, [x, y]); return recs.at(-1); },
  exportFeatures() { return surveyFeatures(); },
  axeTarget() { return axeHover; },
  markings() { return markingsFile(); },
  mod() { return modOf(recs, 'test'); },
  select(id: number | null) { select(id); },
};

// the cloud panel: shared workspaces with their own logins
initCloudPanel({
  onSignedIn: () => { labelSave(); void loadAccountGame(); },
  getItems: () => JSON.parse(JSON.stringify(recs)) as Rec[],
  getSurveyor: () => surveyor(),
  msg,
  onLoad: (items) => {
    backupBeforeReplace('вчитување од облакот');
    applySession(gameSession({ format: 'mapng-mod', version: 2, savedAt: new Date().toISOString(), surveyor: '', items } as ItemsFile), true);
    void persistNow();
  },
});

