// Road graph built from MapNG DecalRoad centre lines, plus shortest-route search.
// Pure functions: used by the Node importer and safe to use in the browser.

import type { GraphEdge, GraphNode, ImportedRoad, RouteDef, Vec3 } from './types';

interface Cut {
  seg: number; // segment index
  t: number; // 0..1 along that segment
  node: number;
}

const d2 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function projectOnPolyline(p: number[], pts: number[][]) {
  let best = { dist: Infinity, seg: 0, t: 0, q: [0, 0, 0] as Vec3 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    const q: Vec3 = [a[0] + dx * t, a[1] + dy * t, a[2] + (b[2] - a[2]) * t];
    const dist = d2(p, q);
    if (dist < best.dist) best = { dist, seg: i, t, q };
  }
  return best;
}

function segIntersect(a: number[], b: number[], c: number[], d: number[]) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { t, u };
}

export interface RoadNetwork {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildNetwork(roads: ImportedRoad[]): RoadNetwork {
  const drivable = roads.filter((r) => (r.kind === 'carriageway' || r.kind === 'service') && r.points.length >= 2);
  const nodes: GraphNode[] = [];
  const cuts: Cut[][] = drivable.map(() => []);

  const nodeAt = (p: Vec3, merge = 2.0) => {
    for (const n of nodes) if (d2(n.p, p) < merge && Math.abs(n.p[2] - p[2]) < 3) return n.id;
    nodes.push({ id: nodes.length, p: [p[0], p[1], p[2]], junction: false });
    return nodes.length - 1;
  };
  const halfWidth = (r: ImportedRoad) => r.points.reduce((s, p) => s + p[3], 0) / r.points.length / 2;

  // 1) Endpoints: snap onto any other drivable line they touch (T-junctions and joins).
  drivable.forEach((r, ri) => {
    const ends = [
      { p: r.points[0], seg: 0, t: 0 },
      { p: r.points[r.points.length - 1], seg: r.points.length - 2, t: 1 },
    ];
    for (const e of ends) {
      let bestNode = -1;
      for (let oi = 0; oi < drivable.length; oi++) {
        if (oi === ri) continue;
        const o = drivable[oi];
        const pr = projectOnPolyline(e.p, o.points);
        const tol = halfWidth(o) + (r.kind === 'service' ? 3 : 1.5);
        if (pr.dist <= tol && Math.abs(pr.q[2] - e.p[2]) < 2.5) {
          const id = bestNode >= 0 ? bestNode : nodeAt(pr.dist < 2 ? pr.q : (e.p.slice(0, 3) as Vec3));
          bestNode = id;
          cuts[oi].push({ seg: pr.seg, t: pr.t, node: id });
        }
      }
      const id = bestNode >= 0 ? bestNode : nodeAt(e.p.slice(0, 3) as Vec3);
      cuts[ri].push({ seg: e.seg, t: e.t, node: id });
    }
  });

  // 2) Interior crossings between carriageways (X junctions drawn as two through roads).
  for (let a = 0; a < drivable.length; a++)
    for (let b = a + 1; b < drivable.length; b++) {
      const A = drivable[a].points, B = drivable[b].points;
      for (let i = 0; i < A.length - 1; i++)
        for (let j = 0; j < B.length - 1; j++) {
          const hit = segIntersect(A[i], A[i + 1], B[j], B[j + 1]);
          if (!hit) continue;
          const z = A[i][2] + (A[i + 1][2] - A[i][2]) * hit.t;
          const zb = B[j][2] + (B[j + 1][2] - B[j][2]) * hit.u;
          if (Math.abs(z - zb) > 2.5) continue; // bridge over road
          const p: Vec3 = [A[i][0] + (A[i + 1][0] - A[i][0]) * hit.t, A[i][1] + (A[i + 1][1] - A[i][1]) * hit.t, z];
          const id = nodeAt(p);
          cuts[a].push({ seg: i, t: hit.t, node: id });
          cuts[b].push({ seg: j, t: hit.u, node: id });
        }
    }

  // 3) Split each line at its cuts into edges.
  const edges: GraphEdge[] = [];
  drivable.forEach((r, ri) => {
    const cs = cuts[ri].sort((x, y) => x.seg + x.t - (y.seg + y.t));
    for (let k = 0; k < cs.length - 1; k++) {
      const c0 = cs[k], c1 = cs[k + 1];
      if (c0.node === c1.node) continue;
      const lerp = (seg: number, t: number): Vec3 => {
        const a = r.points[seg], b = r.points[Math.min(seg + 1, r.points.length - 1)];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      };
      const pts: Vec3[] = [lerp(c0.seg, c0.t)];
      for (let i = c0.seg + 1; i <= c1.seg; i++) pts.push(r.points[i].slice(0, 3) as Vec3);
      pts.push(lerp(c1.seg, c1.t));
      let length = 0;
      for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (length < 0.5) continue;
      edges.push({
        id: edges.length,
        from: c0.node,
        to: c1.node,
        road: r.id,
        kind: r.kind as 'carriageway' | 'service',
        oneWay: r.oneWay,
        lanes: Math.max(1, r.lanesLeft + r.lanesRight),
        width: halfWidth(r) * 2,
        length,
        points: pts,
      });
    }
  });

  // 4) A junction is where three or more public carriageway ends meet.
  const deg = new Map<number, number>();
  for (const e of edges) {
    if (e.kind !== 'carriageway') continue;
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  for (const n of nodes) n.junction = (deg.get(n.id) ?? 0) >= 3;
  return { nodes, edges };
}

/** Neighbours reachable from a node, respecting one-way direction. */
export function adjacency(net: RoadNetwork) {
  const adj = new Map<number, { edge: GraphEdge; to: number; forward: boolean }[]>();
  const add = (n: number, v: { edge: GraphEdge; to: number; forward: boolean }) => {
    if (!adj.has(n)) adj.set(n, []);
    adj.get(n)!.push(v);
  };
  for (const e of net.edges) {
    add(e.from, { edge: e, to: e.to, forward: true });
    if (!e.oneWay) add(e.to, { edge: e, to: e.from, forward: false });
  }
  return adj;
}

/**
 * Shortest drive from a point to the nearest public-road junction, then on
 * through it for `runOut` metres along the straightest exit.
 */
export function routeToNearestJunction(
  net: RoadNetwork,
  start: Vec3,
  label: string,
  name: string,
  runOut = 45,
): RouteDef | null {
  // Attach the start to the nearest service edge (a parking aisle), else any edge.
  let best: { e: GraphEdge; pr: ReturnType<typeof projectOnPolyline> } | null = null;
  for (const kind of ['service', 'carriageway'] as const) {
    for (const e of net.edges) {
      if (e.kind !== kind) continue;
      const pr = projectOnPolyline(start, e.points);
      if (!best || pr.dist < best.pr.dist) best = { e, pr };
    }
    if (best && best.pr.dist < 25) break;
  }
  if (!best) return null;
  const { e: e0, pr } = best;
  const headPts = e0.points.slice(0, pr.seg + 1).concat([pr.q]);
  const tailPts = [pr.q as Vec3].concat(e0.points.slice(pr.seg + 1));
  const plen = (ps: Vec3[]) => ps.reduce((s, p, i) => (i ? s + d2(p, ps[i - 1]) : 0), 0);

  const adj = adjacency(net);
  const dist = new Map<number, number>();
  const prev = new Map<number, { node: number; edge: GraphEdge; forward: boolean } | null>();
  const queue: [number, number][] = [];
  // Virtual start: leave along the aisle in either allowed direction.
  dist.set(e0.to, plen(tailPts));
  prev.set(e0.to, null);
  queue.push([plen(tailPts), e0.to]);
  if (!e0.oneWay) {
    dist.set(e0.from, plen(headPts));
    prev.set(e0.from, null);
    queue.push([plen(headPts), e0.from]);
  }
  const firstLeg = new Map<number, Vec3[]>([
    [e0.to, tailPts],
    [e0.from, headPts.slice().reverse()],
  ]);

  let goal = -1;
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [du, u] = queue.shift()!;
    if (du > (dist.get(u) ?? Infinity)) continue;
    if (net.nodes[u].junction) {
      goal = u;
      break;
    }
    for (const nb of adj.get(u) ?? []) {
      const nd = du + nb.edge.length;
      if (nd < (dist.get(nb.to) ?? Infinity)) {
        dist.set(nb.to, nd);
        prev.set(nb.to, { node: u, edge: nb.edge, forward: nb.forward });
        queue.push([nd, nb.to]);
      }
    }
  }
  if (goal < 0) return null;

  // Reconstruct.
  const legs: { edge: GraphEdge; forward: boolean }[] = [];
  let cur = goal;
  while (prev.get(cur)) {
    const p = prev.get(cur)!;
    legs.unshift({ edge: p.edge, forward: p.forward });
    cur = p.node;
  }
  const points: Vec3[] = [...firstLeg.get(cur)!];
  for (const l of legs) {
    const ps = l.forward ? l.edge.points : l.edge.points.slice().reverse();
    points.push(...ps.slice(1));
  }

  // Run out through the junction: pick the exit closest to straight ahead.
  const n = points.length;
  const inDir = Math.atan2(points[n - 1][1] - points[n - 2][1], points[n - 1][0] - points[n - 2][0]);
  let exit: Vec3[] | null = null;
  let bestTurn = Infinity;
  const lastEdge = legs.length ? legs[legs.length - 1].edge.id : e0.id;
  for (const nb of adj.get(goal) ?? []) {
    if (nb.edge.id === lastEdge || nb.edge.kind !== 'carriageway') continue;
    const ps = nb.forward ? nb.edge.points : nb.edge.points.slice().reverse();
    const k = Math.min(3, ps.length - 1);
    const dir = Math.atan2(ps[k][1] - ps[0][1], ps[k][0] - ps[0][0]);
    const turn = Math.abs(Math.atan2(Math.sin(dir - inDir), Math.cos(dir - inDir)));
    if (turn < bestTurn) {
      bestTurn = turn;
      exit = ps;
    }
  }
  if (exit) {
    let acc = 0;
    for (let i = 1; i < exit.length && acc < runOut; i++) {
      acc += d2(exit[i], exit[i - 1]);
      points.push(exit[i]);
    }
  }

  const heading = Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]);
  return {
    name,
    start: { p: points[0], heading, label },
    end: { p: net.nodes[goal].p, label: 'junction', nodeId: goal },
    points,
    length: plen(points),
    edgeIds: [e0.id, ...legs.map((l) => l.edge.id)],
  };
}
