// Manual field-survey override layer (GeoJSON, WGS84) for traffic control.
//
// File: public/survey/<level>.geojson, loaded at runtime. It never
// touches levels/. Every feature must carry its own surveyed facts; anything
// missing is REJECTED with a reason — nothing is defaulted or guessed.
//
// Feature properties (all required unless marked optional):
//   kind        "sign" | "light" (Point), "line" (LineString), "area" (Polygon)
//   code        official Rulebook code, e.g. "II-2", "III-3", "VI-4.1", "V-1", "V-4"
//   source      who/what produced the record, e.g. "field survey" or a document ref
//   surveyor    name or initials
//   surveyDate  "YYYY-MM-DD"
//   verified    true once the record has been checked on site (false = draft)
//   facing      Point only: compass bearing in degrees, clockwise from true north,
//               of the direction the sign/lens FACE points (towards approaching drivers)
//   roadSide    Point only: "left" | "right" | "centre" | "overhead"
//   widthM      optional, line width in metres (lines only; else per code)
//   note        optional free text
//
// Coordinates go through the same linear MapNG transform as the importer
// (WGS84 → world x east / y north over the export bounds).

import type { RoadNetwork } from './network';
import type { ImportedRoad, LevelIndex, LevelObjects, PropInstance, SignalInstance, Vec3 } from './types';
import {
  latLngToWorld,
  mergeLights,
  mergeMarkings,
  mergeSigns,
  signTypeFor,
  yawFromRotation,
  type GeoFrame,
  type Marking,
  type Provenance,
  type TrafficLight,
  type TrafficSign,
} from './cityGis';

/** Lives outside public/mapng/<level>/ because the importer rebuilds that folder. */
export const surveyPath = (level: string) => `survey/${level}.geojson`;

type Pos = [number, number] | [number, number, number];
export interface SurveyFeature {
  type: 'Feature';
  id?: string | number;
  geometry: { type: 'Point'; coordinates: Pos } | { type: 'LineString'; coordinates: Pos[] } | { type: 'Polygon'; coordinates: Pos[][] };
  properties: Record<string, unknown>;
}
export interface SurveyCollection {
  type: 'FeatureCollection';
  features: SurveyFeature[];
}

export interface Rejected {
  id: string;
  reason: string;
}
export interface SurveyLayer {
  signs: TrafficSign[];
  lights: TrafficLight[];
  markings: Marking[];
  rejected: Rejected[];
}

/** Game sign types that have a dedicated sign mesh; others are placed with a plain coded plate. */
export const MODELLED_SIGN_TYPES = new Set(['give_way', 'noentry', 'one_way', 'priorityroad']);

const ROAD_SIDES = new Set(['left', 'right', 'centre', 'overhead']);
const CODE_RE = /^(I|II|III|IV|V|VI|VII)-\d+(\.\d+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function check(f: SurveyFeature, i: number): { ok: true; p: Record<string, unknown>; id: string } | { ok: false; r: Rejected } {
  const id = String(f.id ?? f.properties?.id ?? `feature-${i}`);
  const p = f.properties ?? {};
  const fail = (reason: string) => ({ ok: false as const, r: { id, reason } });
  const kind = p.kind;
  const g = f.geometry?.type;
  const want: Record<string, string> = { sign: 'Point', light: 'Point', line: 'LineString', area: 'Polygon' };
  if (typeof kind !== 'string' || !want[kind]) return fail('kind must be sign, light, line or area');
  if (g !== want[kind]) return fail(`kind "${kind}" needs a ${want[kind]} geometry, got ${g}`);
  if (typeof p.code !== 'string' || !CODE_RE.test(p.code.trim())) return fail('missing or malformed Rulebook code (e.g. II-2, V-4)');
  if (typeof p.source !== 'string' || !p.source.trim()) return fail('missing source');
  if (typeof p.surveyor !== 'string' || !p.surveyor.trim()) return fail('missing surveyor');
  if (typeof p.surveyDate !== 'string' || !DATE_RE.test(p.surveyDate) || Number.isNaN(Date.parse(p.surveyDate))) return fail('missing or malformed surveyDate (YYYY-MM-DD)');
  if (typeof p.verified !== 'boolean') return fail('verified must be true or false');
  if (kind === 'sign' || kind === 'light') {
    if (typeof p.facing !== 'number' || !Number.isFinite(p.facing) || p.facing < 0 || p.facing >= 360) return fail('facing must be a compass bearing 0–359.9°');
    if (typeof p.roadSide !== 'string' || !ROAD_SIDES.has(p.roadSide)) return fail('roadSide must be left, right, centre or overhead');
  }
  const coords: Pos[] = g === 'Point' ? [f.geometry.coordinates as Pos] : g === 'LineString' ? (f.geometry.coordinates as Pos[]) : (f.geometry.coordinates as Pos[][])[0] ?? [];
  if (!coords.length || coords.some((c) => !Array.isArray(c) || c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90))
    return fail('coordinates must be WGS84 [lon, lat]');
  if (g === 'LineString' && coords.length < 2) return fail('a line needs at least 2 points');
  if (g === 'Polygon' && coords.length < 4) return fail('a polygon ring needs at least 4 points');
  return { ok: true, p, id };
}

function prov(p: Record<string, unknown>, id: string): Provenance {
  return {
    source: 'manual-survey',
    verified: p.verified as boolean,
    featureId: id,
    code: (p.code as string).trim(),
    surveyDate: p.surveyDate as string,
    surveyor: p.surveyor as string,
    roadSide: p.roadSide as 'left' | 'right' | 'centre' | 'overhead' | undefined,
    note: typeof p.note === 'string' ? p.note : undefined,
  };
}

/** Default painted widths per Rulebook marking family when the survey gives none. */
function lineWidth(code: string, p: Record<string, unknown>) {
  if (typeof p.widthM === 'number' && p.widthM > 0) return p.widthM;
  if (/^V-1/.test(code)) return 0.5; // stop line
  return 0.12; // longitudinal lines
}

/** Convert and validate a survey collection into game traffic objects. */
export function convertSurvey(
  fc: SurveyCollection | null | undefined,
  frame: GeoFrame,
  heightAt: (x: number, y: number) => number,
): SurveyLayer {
  const out: SurveyLayer = { signs: [], lights: [], markings: [], rejected: [] };
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return out;
  const W = (c: Pos) => {
    const w = latLngToWorld(frame, c[1], c[0]);
    return [w.x, w.y, heightAt(w.x, w.y)] as Vec3;
  };
  const half = frame.sizeMeters / 2;
  fc.features.forEach((f, i) => {
    const v = check(f, i);
    if (!v.ok) return out.rejected.push(v.r);
    const { p, id } = v;
    const code = (p.code as string).trim();
    const pv = prov(p, id);
    const inside = (q: Vec3) => Math.abs(q[0]) <= half && Math.abs(q[1]) <= half;
    if (p.kind === 'sign' || p.kind === 'light') {
      const pos = W(f.geometry.coordinates as Pos);
      if (!inside(pos)) return out.rejected.push({ id, reason: 'outside the map area' });
      const bearing = p.facing as number;
      if (p.kind === 'sign') {
        // renderer: plate normal = (sin yaw, −cos yaw) in world x/y, so a face bearing b needs yaw = π − b
        out.signs.push({ type: signTypeFor(code), pos, yaw: Math.PI - (bearing * Math.PI) / 180, scale: 1, provenance: pv, yawVerified: pv.verified });
      } else {
        const a = yawFromRotation(bearing, 'geographic');
        out.lights.push({ id: 200000 + i, pos, dir: [Math.cos(a), Math.sin(a), 0], controllerId: null, sequenceId: null, provenance: pv, timing: 'simulated' });
      }
      return;
    }
    let pts = (p.kind === 'line' ? (f.geometry.coordinates as Pos[]) : (f.geometry.coordinates as Pos[][])[0]).map(W);
    if (pts.some((q) => !inside(q))) return out.rejected.push({ id, reason: 'outside the map area' });
    let width = lineWidth(code, p);
    if (p.kind === 'area') {
      const axis = areaAxis(pts);
      pts = axis.line;
      width = axis.width;
    }
    const isZebra = /^V-(4|5|6)/.test(code);
    out.markings.push({
      id: `survey-${id}`,
      group: 'manual_survey',
      kind: isZebra ? 'zebra' : 'marking',
      material: 'm_line_white',
      oneWay: false,
      lanesLeft: 0,
      lanesRight: 0,
      points: pts.map((q) => [q[0], q[1], q[2], width] as [number, number, number, number]),
      provenance: pv,
    });
  });
  return out;
}

/** Long axis and width of a painted area (rectangle-ish ring). */
function areaAxis(ring: Vec3[]) {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  const d = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const [p0, p1, p2, p3] = pts;
  if (!p3) return { line: pts, width: 0.5 };
  return d(p0, p1) >= d(p1, p2) ? { line: [mid(p0, p3), mid(p1, p2)], width: d(p1, p2) } : { line: [mid(p0, p1), mid(p3, p2)], width: d(p0, p1) };
}

export interface MergedTraffic {
  objects: LevelObjects; // signs/signals replaced by the merged sets (game-compatible)
  roads: ImportedRoad[]; // markings merged; carriageways untouched
  signs: TrafficSign[];
  lights: TrafficLight[];
  markings: Marking[];
  summary: {
    signs: { survey: number; osm: number; replaced: number };
    lights: { survey: number; osm: number; replaced: number; noSimProgram: number };
    markings: { survey: number; osm: number; replaced: number };
    rejected: Rejected[];
    unmodelledSigns: { featureId: string; code: string; type: string }[];
  };
}

/**
 * Survey layer first, OSM/MapNG as labelled fallback. Lights from the survey keep
 * SIM timing: they inherit the simulated programme of the OSM light they replace;
 * a surveyed light with no OSM counterpart has no programme and shows dark.
 */
export function mergeSurvey(level: { objects: LevelObjects; roads: ImportedRoad[] }, layer: SurveyLayer): MergedTraffic {
  const signs = mergeSigns(layer.signs, level.objects.signs);
  const osmLights = level.objects.signals.instances;
  const lightsWithProgram = layer.lights.map((l) => {
    let best: SignalInstance | null = null, bd = 12; // survey position is accurate to a few metres; a 12 m match is the same junction
    for (const o of osmLights) {
      const d = Math.hypot(o.pos[0] - l.pos[0], o.pos[1] - l.pos[1]);
      if (d <= bd) {
        bd = d;
        best = o;
      }
    }
    return best ? { ...l, controllerId: best.controllerId, sequenceId: best.sequenceId } : l;
  });
  const lights = mergeLights(lightsWithProgram, osmLights);
  const osmMarkings = level.roads.filter((r) => r.kind === 'marking' || r.kind === 'zebra');
  const markings = mergeMarkings(layer.markings, osmMarkings);
  const markingIds = new Set(osmMarkings.map((r) => r.id));

  const instances: SignalInstance[] = lights.items
    .filter((l) => l.controllerId !== null && l.sequenceId !== null)
    .map((l) => ({ id: l.id, pos: l.pos, dir: l.dir, controllerId: l.controllerId!, sequenceId: l.sequenceId! }));
  // a sign surveyed at the same spot as a traffic light is mounted above that light
  const lightPos = layer.lights.map((l) => l.pos);
  const asProps: PropInstance[] = signs.items.map((s) => {
    const above = lightPos.some((p) => Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1]) < 1.5);
    return { type: s.type, pos: s.pos, yaw: s.yaw, scale: s.scale, ...(above ? { mount: 4.6 } : {}) };
  });
  return {
    objects: { ...level.objects, signs: asProps, signals: { ...level.objects.signals, instances } },
    roads: [...level.roads.filter((r) => !markingIds.has(r.id)), ...markings.items],
    signs: signs.items,
    lights: lights.items,
    markings: markings.items,
    summary: {
      signs: { survey: signs.city, osm: signs.osmKept, replaced: signs.osmReplaced },
      lights: { survey: lights.city, osm: lights.osmKept, replaced: lights.osmReplaced, noSimProgram: lightsWithProgram.filter((l) => l.controllerId === null).length },
      markings: { survey: markings.city, osm: markings.osmKept, replaced: markings.osmReplaced },
      rejected: layer.rejected,
      unmodelledSigns: layer.signs
        .filter((s) => !MODELLED_SIGN_TYPES.has(s.type))
        .map((s) => ({ featureId: s.provenance.source === 'manual-survey' ? s.provenance.featureId : '?', code: s.provenance.source === 'manual-survey' ? s.provenance.code : '?', type: s.type })),
    },
  };
}

export function frameOf(index: Pick<LevelIndex, 'bounds' | 'sizeMeters'>): GeoFrame {
  return { bounds: index.bounds, sizeMeters: index.sizeMeters };
}
export type { RoadNetwork };
