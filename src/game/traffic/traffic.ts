// AI traffic and pedestrians on the imported road graph, with SUMO's Krauss
// car-following, signal stops and pedestrian crossings.
// Pure simulation in world axes (x east, y north); rendering lives in render/.

import type { RoadNetwork } from '../import/network';
import type { GraphEdge, ImportedRoad, Vec3 } from '../import/types';
import { PASSENGER, PEDESTRIAN, kraussSpeed, stopSpeed, type VType } from './sumoModels';
import type { SignalSystem } from './signals';

const URBAN_LIMIT = 50 / 3.6;
const STOP_BACK = 7; // stop line distance before the node, m

export interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number; // radians, atan2(dy, dx)
}

interface Path {
  pts: Vec3[];
  cum: number[];
  length: number;
}
function makePath(pts: Vec3[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length: cum[cum.length - 1] };
}
function sample(p: Path, s: number, lateral = 0): Pose {
  s = Math.max(0, Math.min(p.length, s));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < s) i++;
  const a = p.pts[i - 1], b = p.pts[i];
  const seg = p.cum[i] - p.cum[i - 1] || 1e-6;
  const t = (s - p.cum[i - 1]) / seg;
  const heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  // lateral > 0 is to the right of travel
  return {
    x: a[0] + (b[0] - a[0]) * t + Math.sin(heading) * lateral,
    y: a[1] + (b[1] - a[1]) * t - Math.cos(heading) * lateral,
    z: a[2] + (b[2] - a[2]) * t,
    heading,
  };
}

interface Lane {
  edge: GraphEdge;
  forward: boolean;
  path: Path;
  toNode: number;
  lateral: number;
  limit: number;
  signal: number | null;
}

export interface AICar {
  id: number;
  lane: Lane;
  s: number;
  v: number;
  type: VType;
  pose: Pose;
  color: number;
  waiting: number;
}
export interface Pedestrian {
  id: number;
  path: Path;
  s: number;
  dir: 1 | -1;
  v: number;
  stripe: number;
  pose: Pose;
  onCrossing: boolean;
  pause: number;
}

export interface TrafficOptions {
  center: [number, number];
  radius: number;
  cars: number;
  pedestrians: number;
  seed?: number;
}

export class Traffic {
  cars: AICar[] = [];
  peds: Pedestrian[] = [];
  private lanes: Lane[] = [];
  private out = new Map<number, Lane[]>();
  private rand: () => number;
  private time = 0;

  constructor(
    net: RoadNetwork,
    roads: ImportedRoad[],
    private signals: SignalSystem,
    opts: TrafficOptions,
  ) {
    let seed = opts.seed ?? 7;
    this.rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const near = (p: Vec3) => Math.hypot(p[0] - opts.center[0], p[1] - opts.center[1]) < opts.radius;

    for (const e of net.edges) {
      if (e.kind !== 'carriageway' || !e.points.some(near)) continue;
      const dirs = e.oneWay ? [true] : [true, false];
      for (const forward of dirs) {
        const pts = forward ? e.points : e.points.slice().reverse();
        // right-hand traffic: two-way roads put each direction half a lane right of centre
        const lateral = e.oneWay ? 0 : Math.min(e.width / 4, 2.2);
        const lane: Lane = {
          edge: e,
          forward,
          path: makePath(pts),
          toNode: forward ? e.to : e.from,
          lateral,
          limit: URBAN_LIMIT,
          signal: null,
        };
        lane.signal = this.findSignal(lane);
        this.lanes.push(lane);
        const from = forward ? e.from : e.to;
        if (!this.out.has(from)) this.out.set(from, []);
        this.out.get(from)!.push(lane);
      }
    }
    const palette = [0xd8d4cc, 0x2b3a55, 0x8c1c13, 0x3d5a40, 0x111111, 0xb0b5b9, 0x6b4e2e, 0xe0b31a];
    const usable = this.lanes.filter((l) => l.path.length > 25);
    for (let i = 0; i < opts.cars && usable.length; i++) {
      const lane = usable[Math.floor(this.rand() * usable.length)];
      const s = 5 + this.rand() * (lane.path.length - 10);
      if (this.cars.some((c) => c.lane === lane && Math.abs(c.s - s) < 12)) continue;
      const type = { ...PASSENGER, speedFactor: 0.9 + this.rand() * 0.2 };
      this.cars.push({ id: i, lane, s, v: 0, type, pose: sample(lane.path, s, lane.lateral), color: palette[i % palette.length], waiting: 0 });
    }

    // Pedestrians walk footways and, now and then, the zebra crossings.
    const walk = roads.filter((r) => (r.kind === 'path' || r.kind === 'zebra') && r.points.some((p) => near([p[0], p[1], p[2]])));
    const walkPaths = walk.map((r) => ({ zebra: r.kind === 'zebra', path: makePath(r.points.map((p) => [p[0], p[1], p[2]] as Vec3)) }));
    const pool = walkPaths.filter((w) => w.path.length > 3);
    for (let i = 0; i < opts.pedestrians && pool.length; i++) {
      const w = pool[Math.floor(this.rand() * pool.length)];
      const dir = this.rand() < 0.5 ? 1 : -1;
      const s = this.rand() * w.path.length;
      this.peds.push({
        id: i,
        path: w.path,
        s,
        dir,
        v: PEDESTRIAN.speed * (1 + (this.rand() * 2 - 1) * PEDESTRIAN.speedDev),
        stripe: (Math.floor(this.rand() * 3) - 1) * PEDESTRIAN.stripeWidth,
        pose: sample(w.path, s),
        onCrossing: w.zebra,
        pause: 0,
      });
    }
  }

  private findSignal(lane: Lane): number | null {
    const end = lane.path.pts[lane.path.pts.length - 1];
    const prev = lane.path.pts[Math.max(0, lane.path.pts.length - 3)];
    const hx = end[0] - prev[0], hy = end[1] - prev[1];
    const hl = Math.hypot(hx, hy) || 1;
    let best: number | null = null, bestD = 28;
    for (const s of this.signals.instances) {
      const d = Math.hypot(s.pos[0] - end[0], s.pos[1] - end[1]);
      // a head faces the drivers it controls: its dir points against our travel
      const facing = (s.dir[0] * hx + s.dir[1] * hy) / hl;
      if (d < bestD && facing < -0.5) {
        best = s.id;
        bestD = d;
      }
    }
    return best;
  }

  /** Signal lamp the player would face approaching a node, if any (for the HUD). */
  signalAt(id: number) {
    return this.signals.state(id, this.time);
  }
  get clock() {
    return this.time;
  }

  update(dt: number, player: Pose & { speed: number }) {
    this.time += dt;

    for (const car of this.cars) {
      const lane = car.lane;
      const vMax = Math.min(car.type.maxSpeed, lane.limit * car.type.speedFactor);
      // leader: nearest car ahead on this lane, or on the lane it will enter
      let gap = Infinity, vLead = 0;
      for (const o of this.cars) {
        if (o === car || o.lane !== lane || o.s <= car.s) continue;
        const g = o.s - car.s - o.type.length - car.type.minGap;
        if (g < gap) {
          gap = g;
          vLead = o.v;
        }
      }
      // the player counts as a leader when in our lane ahead
      const pp = this.relative(car.pose, player);
      if (pp.ahead > 0 && pp.ahead < 40 && Math.abs(pp.side) < 2.0) {
        const g = pp.ahead - 4.5 - car.type.minGap;
        if (g < gap) {
          gap = g;
          vLead = Math.max(0, player.speed);
        }
      }
      // pedestrians on a crossing ahead: yield
      for (const p of this.peds) {
        if (!p.onCrossing) continue;
        const r = this.relative(car.pose, p.pose);
        if (r.ahead > 0 && r.ahead < 25 && Math.abs(r.side) < 3) gap = Math.min(gap, r.ahead - 3);
      }
      let v = kraussSpeed(car.type, car.v, gap, vLead, vMax, dt, this.rand());

      // stop line: red/yellow signal only (no junction priority rules)
      const toEnd = lane.path.length - car.s;
      let mustStop = false;
      if (lane.signal !== null) {
        const st = this.signals.state(lane.signal, this.time);
        const stopDist = toEnd - STOP_BACK;
        if (st === 'red' || (st === 'yellow' && stopDist > (car.v * car.v) / (2 * car.type.decel))) mustStop = stopDist > -1;
      }
      if (mustStop) v = Math.min(v, stopSpeed(car.type, car.v, toEnd - STOP_BACK, dt));

      car.waiting = v < 0.1 ? car.waiting + dt : 0;
      car.v = v;
      car.s += v * dt;
      if (car.s >= lane.path.length) this.advance(car);
      car.pose = sample(car.lane.path, car.s, car.lane.lateral);
    }

    for (const p of this.peds) {
      if (p.pause > 0) {
        p.pause -= dt;
        continue;
      }
      // SUMO striping: dawdle a little, stop for the player car on a crossing
      const blocked = p.onCrossing && (() => {
        const r = this.relative(p.pose, player);
        return Math.hypot(r.ahead, r.side) < 6 && Math.abs(player.speed) > 0.5;
      })();
      const v = blocked ? 0 : p.v * (1 - PEDESTRIAN.dawdling * this.rand() * 0.5);
      p.s += p.dir * v * dt;
      if (p.s > p.path.length || p.s < 0) {
        p.dir = (p.dir * -1) as 1 | -1;
        p.s = Math.max(0, Math.min(p.path.length, p.s));
        p.pause = 1 + this.rand() * 4;
      }
      const pose = sample(p.path, p.s, p.stripe);
      p.pose = { ...pose, heading: p.dir > 0 ? pose.heading : pose.heading + Math.PI };
    }
  }

  private advance(car: AICar) {
    const over = car.s - car.lane.path.length;
    const options = (this.out.get(car.lane.toNode) ?? []).filter((l) => l.edge !== car.lane.edge);
    let next: Lane | undefined;
    if (options.length) next = options[Math.floor(this.rand() * options.length)];
    else {
      // dead end or edge of the simulated area: turn back if the road allows
      next = this.lanes.find((l) => l.edge === car.lane.edge && l.forward !== car.lane.forward);
    }
    if (!next) {
      // respawn somewhere else
      next = this.lanes[Math.floor(this.rand() * this.lanes.length)];
      car.s = 0;
      car.v = 0;
    } else car.s = Math.max(0, over);
    car.lane = next;
  }

  private relative(from: Pose, to: { x: number; y: number }) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const c = Math.cos(from.heading), s = Math.sin(from.heading);
    return { ahead: dx * c + dy * s, side: dx * s - dy * c };
  }
}
