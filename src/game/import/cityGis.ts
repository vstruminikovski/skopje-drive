// City of Skopje GIS adapter: converts records from the official traffic
// signalling service (ArcGIS REST, INFRA/Soobrakjaj) into the game's traffic
// objects, and merges them with the MapNG/OSM objects:
//   - City features are the primary source (verified: true, with survey metadata).
//   - An OSM object is dropped when a City object of the same category lies
//     within the duplicate radius; otherwise it stays, labelled unverified.
//   - Nothing is invented: categories with no City record keep only what OSM had.
// Traffic-light *locations* come from the City; light *timing* stays simulated
// unless a City signal programme is supplied (the service has no timing fields).
//
// Pure functions only (no fetching): tools/mapng-import/cityGis.ts does the I/O.

import type { ImportedRoad, PropInstance, SignalInstance, Vec3 } from './types';

/** The level's geographic frame (from mapng.json): world x,y map linearly onto these bounds. */
export interface GeoFrame {
  bounds: { north: number; south: number; east: number; west: number };
  sizeMeters: number;
}

export const CITY_GIS_SERVICE = 'https://gisportal.skopje.gov.mk/arcgis/rest/services/INFRA/Soobrakjaj/MapServer';
export const CITY_LAYERS = {
  signs: 69,
  signSupports: 70,
  lights: 71,
  lightSupports: 72,
  gantries: 73,
  symbols: 74, // other horizontal markings (BUS, STOP, arrows, symbols)
  longitudinal: 75, // edge / lane / centre lines
  transverse: 76, // stop lines, crossings, give-way teeth
} as const;
export type CityLayer = keyof typeof CITY_LAYERS;

/** ArcGIS JSON feature as returned with f=json. */
export interface ArcFeature {
  attributes: Record<string, string | number | null>;
  geometry?: { x?: number; y?: number; paths?: number[][][]; rings?: number[][][] };
}
export interface ArcQueryResult {
  features?: ArcFeature[];
  spatialReference?: { wkid?: number; latestWkid?: number };
  error?: { code: number; message: string };
}

export type Provenance =
  | { source: 'city-gis'; verified: true; layer: number; objectId: number; code?: string; name?: string; surveyDate?: string; condition?: string; authority?: string; street?: string }
  | {
      source: 'manual-survey';
      verified: boolean;
      featureId: string;
      code: string;
      surveyDate: string;
      surveyor: string;
      roadSide?: 'left' | 'right' | 'centre' | 'overhead';
      note?: string;
    }
  | { source: 'osm-mapng'; verified: false };

export type TrafficSign = PropInstance & { provenance: Provenance; yawVerified: boolean };
export type TrafficLight = Omit<SignalInstance, 'controllerId' | 'sequenceId'> & {
  controllerId: number | null;
  sequenceId: number | null;
  provenance: Provenance;
  /** City control mode (fixed / adaptive / coordinated); timing is not in the service. */
  controlMode?: string;
  timing: 'simulated';
};
export type Marking = ImportedRoad & { provenance: Provenance };

// ---------- coordinates ----------
const R = 6378137;
/** Web Mercator (EPSG:3857 / ESRI 102100) metres → WGS84 degrees. */
export function mercatorToLatLng(x: number, y: number) {
  return { lat: (Math.atan(Math.sinh(y / R)) * 180) / Math.PI, lng: (x / R) * (180 / Math.PI) };
}
/** WGS84 → game world (x east, y north, metres), the same linear mapping the importer uses. */
export function latLngToWorld(index: GeoFrame, lat: number, lng: number) {
  const b = index.bounds, s = index.sizeMeters;
  return { x: ((lng - b.west) / (b.east - b.west)) * s - s / 2, y: ((lat - b.south) / (b.north - b.south)) * s - s / 2 };
}
function toWorldPoint(index: GeoFrame, wkid: number, x: number, y: number) {
  const ll = wkid === 4326 ? { lat: y, lng: x } : wkid === 102100 || wkid === 3857 ? mercatorToLatLng(x, y) : null;
  if (!ll) throw new Error(`unsupported spatial reference ${wkid}; query with outSR=4326`);
  return latLngToWorld(index, ll.lat, ll.lng);
}

// ---------- attribute helpers ----------
const str = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v));
/** ArcGIS dates are epoch milliseconds. */
const date = (v: unknown) => (typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : str(v));
function provenance(layer: number, a: ArcFeature['attributes'], codeField: string, nameField?: string): Provenance {
  const code = str(a[codeField]);
  return {
    source: 'city-gis',
    verified: true,
    layer,
    objectId: Number(a.OBJECTID),
    code: code?.split(/[: ]/)[0],
    name: str(nameField ? a[nameField] : undefined) ?? code,
    surveyDate: date(a.datum_snimanja ?? a.datum_snim),
    condition: str(a.stanje_znaka ?? a.stanje),
    authority: str(a.nadleznost),
    street: str(a.ulica),
  };
}

/**
 * Official sign code (Rulebook, Сл. весник 174/2020, as coded in the City layer)
 * → the game's sign type. Unknown codes keep their official code as the type.
 */
export function signTypeFor(code: string | undefined): string {
  if (!code) return 'unknown';
  const c = code.toUpperCase();
  const table: [RegExp, string][] = [
    [/^II-1$/, 'give_way'],
    [/^II-2$/, 'stop'],
    [/^II-4$/, 'noentry'],
    [/^II-30$/, 'speed_limit'],
    [/^II-34$/, 'no_stopping'],
    [/^II-35$/, 'no_parking'],
    [/^III-2(\.1)?$/, 'one_way'],
    [/^III-3$/, 'priorityroad'],
    [/^III-3\.1$/, 'priorityroad_end'],
    [/^III-6$/, 'pedestrian_crossing'],
    [/^I-14$/, 'pedestrian_crossing_ahead'],
    [/^I-20(\.1)?$/, 'signals_ahead'],
  ];
  return table.find(([re]) => re.test(c))?.[1] ?? c;
}

/**
 * Sign/marking rotation. ArcGIS symbol rotation is either "geographic" (clockwise
 * from north) or "arithmetic" (counter-clockwise from east); the service does not
 * say which, so the caller states it and the result is flagged until checked on site.
 */
export function yawFromRotation(deg: number, convention: 'geographic' | 'arithmetic') {
  const math = convention === 'geographic' ? 90 - deg : deg; // → CCW from east
  return (math * Math.PI) / 180;
}

// ---------- converters ----------
export interface ConvertOptions {
  index: GeoFrame;
  heightAt: (x: number, y: number) => number;
  rotation?: 'geographic' | 'arithmetic';
}

export function convertSigns(res: ArcQueryResult, o: ConvertOptions): TrafficSign[] {
  const wkid = res.spatialReference?.latestWkid ?? res.spatialReference?.wkid ?? 4326;
  return (res.features ?? []).flatMap((f) => {
    const g = f.geometry;
    if (g?.x === undefined || g.y === undefined) return [];
    const p = toWorldPoint(o.index, wkid, g.x, g.y);
    const prov = provenance(CITY_LAYERS.signs, f.attributes, 'sifra_znak', 'naziv_znak');
    const rot = Number(f.attributes.rotacija ?? f.attributes.gm_rotation);
    return [
      {
        type: signTypeFor(prov.source === 'city-gis' ? prov.code : undefined),
        pos: [p.x, p.y, o.heightAt(p.x, p.y)] as Vec3,
        yaw: Number.isFinite(rot) ? yawFromRotation(rot, o.rotation ?? 'geographic') : 0,
        scale: 1,
        provenance: prov,
        yawVerified: false,
      },
    ];
  });
}

export function convertLights(res: ArcQueryResult, o: ConvertOptions): TrafficLight[] {
  const wkid = res.spatialReference?.latestWkid ?? res.spatialReference?.wkid ?? 4326;
  return (res.features ?? []).flatMap((f, k) => {
    const g = f.geometry;
    if (g?.x === undefined || g.y === undefined) return [];
    const p = toWorldPoint(o.index, wkid, g.x, g.y);
    const rot = Number(f.attributes.rotacija);
    const yaw = Number.isFinite(rot) ? yawFromRotation(rot, o.rotation ?? 'geographic') : 0;
    return [
      {
        id: 100000 + (Number(f.attributes.OBJECTID) || k),
        pos: [p.x, p.y, o.heightAt(p.x, p.y)] as Vec3,
        dir: [Math.cos(yaw), Math.sin(yaw), 0] as Vec3,
        controllerId: null,
        sequenceId: null,
        provenance: provenance(CITY_LAYERS.lights, f.attributes, 'sifra_znak', 'naziv_znak'),
        controlMode: str(f.attributes.nacin_upravljanja),
        timing: 'simulated' as const,
      },
    ];
  });
}

/** Longitudinal lines (75) as polylines; transverse (76) polygons as their long axis. */
export function convertMarkings(res: ArcQueryResult, layer: 'longitudinal' | 'transverse', o: ConvertOptions): Marking[] {
  const wkid = res.spatialReference?.latestWkid ?? res.spatialReference?.wkid ?? 4326;
  const id = CITY_LAYERS[layer];
  return (res.features ?? []).flatMap((f) => {
    const parts = f.geometry?.paths ?? f.geometry?.rings ?? [];
    const a = f.attributes;
    const code = str(a.sifra_i_naziv) ?? '';
    const widthM = Number(a.sirina) > 0 ? Number(a.sirina) : layer === 'transverse' ? 0.5 : 0.12;
    const kind = /V-4|V-5|V-6|пешачки/i.test(code) ? 'zebra' : 'marking';
    return parts.map((part, i) => {
      let pts = part.map(([x, y]) => toWorldPoint(o.index, wkid, x, y));
      if (f.geometry?.rings) pts = longAxis(pts); // polygon → centre line along its length
      return {
        id: `city-${id}-${a.OBJECTID}-${i}`,
        group: `city_gis_${layer}`,
        kind,
        material: /испрекинат/i.test(code) ? 'm_line_white_discontinue' : 'm_line_white',
        oneWay: false,
        lanesLeft: 0,
        lanesRight: 0,
        points: pts.map((p) => [p.x, p.y, o.heightAt(p.x, p.y), widthM] as [number, number, number, number]),
        provenance: provenance(id, a, 'sifra_i_naziv'),
      } satisfies Marking;
    });
  });
}

/** Centre line along the longer side of a (roughly rectangular) polygon. */
function longAxis(ring: { x: number; y: number }[]) {
  const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : ring;
  if (pts.length < 4) return pts;
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const [p0, p1, p2, p3] = pts;
  return d(p0, p1) >= d(p1, p2) ? [mid(p0, p3), mid(p1, p2)] : [mid(p0, p1), mid(p3, p2)];
}

// ---------- merge ----------
export interface MergeResult<T> {
  items: T[];
  city: number;
  osmKept: number;
  osmReplaced: number;
}

/** City objects first; OSM objects within `radius` m of a City object of the same category are dropped as duplicates. */
export function mergeByProximity<C extends { provenance: Provenance }, O>(
  city: C[],
  osm: O[],
  posOf: (x: C | O) => [number, number],
  categoryOf: (x: C | O) => string,
  wrapOsm: (o: O) => C,
  radius = 6,
): MergeResult<C> {
  const kept: C[] = [];
  let replaced = 0;
  for (const o of osm) {
    const [ox, oy] = posOf(o);
    const dup = city.some((c) => categoryOf(c) === categoryOf(o) && Math.hypot(posOf(c)[0] - ox, posOf(c)[1] - oy) <= radius);
    if (dup) replaced++;
    else kept.push(wrapOsm(o));
  }
  return { items: [...city, ...kept], city: city.length, osmKept: kept.length, osmReplaced: replaced };
}

export const UNVERIFIED: Provenance = { source: 'osm-mapng', verified: false };

/** Signs: same category = same game sign type. */
export function mergeSigns(city: TrafficSign[], osm: PropInstance[], radius = 6) {
  return mergeByProximity<TrafficSign, PropInstance>(
    city,
    osm,
    (s) => [s.pos[0], s.pos[1]],
    (s) => s.type,
    (o) => ({ ...o, provenance: UNVERIFIED, yawVerified: false }),
    radius,
  );
}

/** Lights: any City signal head near an OSM/MapNG one replaces it. */
export function mergeLights(city: TrafficLight[], osm: SignalInstance[], radius = 8) {
  return mergeByProximity<TrafficLight, SignalInstance>(
    city,
    osm,
    (s) => [s.pos[0], s.pos[1]],
    () => 'light',
    (o) => ({ ...o, provenance: UNVERIFIED, timing: 'simulated' }),
    radius,
  );
}

/** Markings: an OSM marking is a duplicate when most of its points lie within `radius` of City markings of the same kind. */
export function mergeMarkings(city: Marking[], osm: ImportedRoad[], radius = 1.5) {
  const near = (o: ImportedRoad) => {
    const same = city.filter((c) => c.kind === o.kind);
    if (!same.length) return false;
    const hits = o.points.filter((p) => same.some((c) => distToPolyline(p, c.points) <= radius)).length;
    return hits / o.points.length >= 0.6;
  };
  const kept: Marking[] = [];
  let replaced = 0;
  for (const o of osm) {
    if (near(o)) replaced++;
    else kept.push({ ...o, provenance: UNVERIFIED });
  }
  return { items: [...city, ...kept], city: city.length, osmKept: kept.length, osmReplaced: replaced };
}

function distToPolyline(p: number[], pts: number[][]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  }
  if (pts.length === 1) best = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  return best;
}
