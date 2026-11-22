// Shared shapes of the converted MapNG level. The importer (Node) writes these,
// the browser game reads them. World axes follow the BeamNG export: x east,
// y north, z up, metres, origin at the map centre.

export type Vec3 = [number, number, number];

export type RoadKind =
  | 'carriageway' // public road, in the AI road graph
  | 'service' // parking aisle, driveway, service road
  | 'path' // footway, cycleway, pedestrian street
  | 'marking' // painted lines
  | 'zebra'
  | 'gutter'
  | 'other';

export interface ImportedRoad {
  id: string;
  group: string;
  kind: RoadKind;
  material: string;
  oneWay: boolean;
  lanesLeft: number;
  lanesRight: number;
  /** points: x, y, z, width */
  points: [number, number, number, number][];
}

export interface GraphNode {
  id: number;
  p: Vec3;
  junction: boolean;
}
export interface GraphEdge {
  id: number;
  from: number;
  to: number;
  road: string;
  kind: 'carriageway' | 'service';
  oneWay: boolean;
  lanes: number;
  width: number;
  length: number;
  points: Vec3[];
}

export interface RouteDef {
  name: string;
  start: { p: Vec3; heading: number; label: string };
  end: { p: Vec3; label: string; nodeId: number };
  points: Vec3[];
  length: number;
  edgeIds: number[];
}

export interface PlacedModel {
  name: string;
  file: string; // relative to the level output dir
  position: Vec3;
  rotation?: number[]; // 3x3 row-major
  scale?: Vec3;
  role: 'buildings' | 'sidewalks' | 'flag';
}

export interface SignalInstance {
  id: number;
  pos: Vec3;
  dir: Vec3;
  controllerId: number;
  sequenceId: number;
}
export interface SignalController {
  id: number;
  name: string;
  states: { state: string; duration: number }[];
}
export interface SignalSequence {
  id: number;
  name: string;
  phases: { startTime: number; controllerIds: number[]; totalDuration: number }[];
}

export interface PropInstance {
  type: string;
  pos: Vec3;
  yaw: number;
  scale: number;
  /** sign post height in metres (default 2.4); a sign above a traffic light is mounted higher */
  mount?: number;
  /** sign plate only, no post (the builder's floating signs) */
  floating?: boolean;
}

export interface LevelObjects {
  spawn: { p: Vec3; heading: number };
  parkingSpots: { name: string; pos: Vec3; yaw: number; size: Vec3 }[];
  parkingAreas: { id: string; name: string; polygon: [number, number][] }[];
  signals: { instances: SignalInstance[]; controllers: SignalController[]; sequences: SignalSequence[] };
  signs: PropInstance[];
  lamps: PropInstance[];
  trees: PropInstance[];
  fences: PropInstance[];
  pois: { name: string; p: Vec3 }[];
}

export interface TerrainMeta {
  file: string;
  size: number;
  squareSize: number;
  maxHeight: number;
  origin: [number, number]; // world x,y of sample (0,0)
  baseTexture: string;
  /** Row j = y index from south, column i = x index from west, uint16 LE. */
  layout: 'row-major-south-up-uint16';
}

export interface LevelIndex {
  name: string;
  center: { lat: number; lng: number };
  /** WGS84 extent of the export; world x,y map linearly onto it (±sizeMeters/2) */
  bounds: { north: number; south: number; east: number; west: number };
  sizeMeters: number;
  terrain: TerrainMeta;
  models: PlacedModel[];
  files: { roads: string; network: string; objects: string; route: string };
}

export type ManifestStatus = 'converted' | 'copied' | 'unreadable' | 'not-needed';
export interface ManifestEntry {
  source: string; // path under levels/
  output?: string; // path under the output dir
  status: ManifestStatus;
  kind: string;
  note?: string;
}
