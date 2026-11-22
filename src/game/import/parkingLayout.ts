// Parking bays laid out from map geometry only: standard perpendicular bays
// (2.5 m × 5.0 m) along each OSM parking aisle, kept where the whole bay lies
// inside an OSM parking-area polygon and clear of roads and existing MapNG spots.
// Nothing here comes from imagery.

import type { ImportedRoad, LevelObjects, Vec3 } from './types';

export const BAY_W = 2.5;
export const BAY_D = 5.0;

export interface Bay {
  /** centre, world metres */
  x: number;
  y: number;
  z: number;
  /** direction from the aisle into the bay (radians, world x/y) */
  heading: number;
  source: 'osm-layout' | 'mapng';
}

type Pt = [number, number];

function inside(p: Pt, poly: number[][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Inside the polygon, or within `slack` metres of its outline (OSM outlines are approximate). */
function nearlyInside(p: Pt, poly: number[][], slack = 1.0) {
  if (inside(p, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    if (Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) < slack) return true;
  }
  return false;
}

function distToRoad(roads: ImportedRoad[], x: number, y: number, skip?: ImportedRoad) {
  let best = Infinity;
  for (const r of roads) {
    if (r === skip) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i], b = r.points[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
      best = Math.min(best, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t) - Math.max(a[3], b[3]) / 2);
    }
  }
  return best;
}

/** Bays for every parking aisle, plus the MapNG spots that already exist. */
export function layoutParking(
  objects: Pick<LevelObjects, 'parkingAreas' | 'parkingSpots'>,
  roads: ImportedRoad[],
  heightAt: (x: number, y: number) => number,
): Bay[] {
  const polys = objects.parkingAreas.map((a) => a.polygon);
  const drivable = roads.filter((r) => r.kind === 'carriageway' || r.kind === 'service');
  const aisles = drivable.filter((r) => /parking_aisle/.test(r.id));
  const bays: Bay[] = objects.parkingSpots.map((s) => ({
    x: s.pos[0],
    y: s.pos[1],
    z: s.pos[2],
    // MapNG spots are 2.5 × 5.5 boxes whose depth is local y; the stored yaw has the
    // same mirrored sign as the other props, so local y points at π/2 − yaw.
    heading: Math.PI / 2 - s.yaw,
    source: 'mapng' as const,
  }));
  const taken = (x: number, y: number) => bays.some((b) => Math.hypot(b.x - x, b.y - y) < BAY_W * 0.9);

  for (const aisle of aisles) {
    const pts = aisle.points;
    // walk the aisle every bay width
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let seg = 0;
    for (let s = BAY_W / 2; s < cum[cum.length - 1] - BAY_W / 2; s += BAY_W) {
      while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
      const a = pts[seg], b = pts[seg + 1];
      const L = cum[seg + 1] - cum[seg] || 1e-6;
      const t = (s - cum[seg]) / L;
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const hw = a[3] / 2;
      for (const side of [1, -1]) {
        const nx = -uy * side, ny = ux * side; // left / right of travel
        const cx = px + nx * (hw + BAY_D / 2), cy = py + ny * (hw + BAY_D / 2);
        const corners: Pt[] = [
          [px + nx * hw + ux * (BAY_W / 2), py + ny * hw + uy * (BAY_W / 2)],
          [px + nx * hw - ux * (BAY_W / 2), py + ny * hw - uy * (BAY_W / 2)],
          [px + nx * (hw + BAY_D) + ux * (BAY_W / 2), py + ny * (hw + BAY_D) + uy * (BAY_W / 2)],
          [px + nx * (hw + BAY_D) - ux * (BAY_W / 2), py + ny * (hw + BAY_D) - uy * (BAY_W / 2)],
        ];
        if (!polys.some((poly) => inside([cx, cy], poly) && corners.every((c) => nearlyInside(c, poly)))) continue;
        // the far half of the bay must be clear of every other drivable surface
        if (distToRoad(drivable, cx + nx * 1.2, cy + ny * 1.2, aisle) < 0.2) continue;
        if (distToRoad(drivable, cx, cy, aisle) < 0) continue;
        if (taken(cx, cy)) continue;
        bays.push({ x: cx, y: cy, z: heightAt(cx, cy), heading: Math.atan2(ny, nx), source: 'osm-layout' });
      }
    }
  }
  return bays;
}

/** Painted side lines (0.12 m) for the laid-out bays, as road markings the ribbon renderer draws. */
export function bayLines(bays: Bay[]): ImportedRoad[] {
  const out: ImportedRoad[] = [];
  bays.forEach((b, k) => {
    if (b.source !== 'osm-layout') return; // MapNG spots already have their own markings
    const nx = Math.cos(b.heading), ny = Math.sin(b.heading);
    const ux = -ny, uy = nx;
    for (const side of [1, -1]) {
      const ox = b.x + ux * side * (BAY_W / 2), oy = b.y + uy * side * (BAY_W / 2);
      const p = (d: number): [number, number, number, number] => [ox + nx * d, oy + ny * d, b.z, 0.12];
      if (side === 1)
        // asphalt under the bay, so the lines are never painted on grass
        out.push({ id: `bay_${k}_surface`, group: 'parking_layout', kind: 'other', material: 'road_asphalt_2lane', oneWay: false, lanesLeft: 0, lanesRight: 0, points: [[b.x - nx * BAY_D / 2, b.y - ny * BAY_D / 2, b.z, BAY_W + 0.1], [b.x + nx * BAY_D / 2, b.y + ny * BAY_D / 2, b.z, BAY_W + 0.1]] });
      out.push({ id: `bay_${k}_${side}`, group: 'parking_layout', kind: 'marking', material: 'm_line_white', oneWay: false, lanesLeft: 0, lanesRight: 0, points: [p(-BAY_D / 2), p(BAY_D / 2)] });
    }
  });
  return out;
}

/** Deterministic occupancy (~70 %) so the same bays are full on every load. */
export function occupied(bays: Bay[], keepClear: Vec3[] = [], rate = 0.7): Bay[] {
  let seed = 12345;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return bays.filter((b) => rand() < rate && keepClear.every((p) => Math.hypot(p[0] - b.x, p[1] - b.y) > 4));
}
