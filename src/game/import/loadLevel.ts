// Browser side of the map import: fetch the converted level and expose it
// with a terrain height sampler. World (BeamNG) axes: x east, y north, z up.
// Three.js axes: X = x, Y = z, Z = -y  (see toThree).

import type { RoadNetwork } from './network';
import type { ImportedRoad, LevelIndex, LevelObjects, RouteDef, TerrainMeta } from './types';

export interface Terrain extends TerrainMeta {
  heights: Float32Array; // metres, row-major, row j = south→north
  heightAt(x: number, y: number): number;
}

export interface LevelData {
  base: string;
  index: LevelIndex;
  terrain: Terrain;
  roads: ImportedRoad[];
  network: RoadNetwork;
  objects: LevelObjects;
  route: RouteDef;
}

export function toThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

export function makeTerrain(meta: TerrainMeta, raw: ArrayBuffer): Terrain {
  const n = meta.size;
  const u16 = new Uint16Array(raw);
  if (u16.length !== n * n) throw new Error(`terrain: expected ${n * n} samples, got ${u16.length}`);
  const heights = new Float32Array(n * n);
  for (let i = 0; i < u16.length; i++) heights[i] = (u16[i] / 65535) * meta.maxHeight;
  const s = meta.squareSize;
  const heightAt = (x: number, y: number) => {
    const fx = Math.max(0, Math.min(n - 1.001, (x - meta.origin[0]) / s));
    const fy = Math.max(0, Math.min(n - 1.001, (y - meta.origin[1]) / s));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const h = (a: number, b: number) => heights[b * n + a];
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - ty) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * ty;
  };
  return { ...meta, heights, heightAt };
}

export async function loadLevel(base: string, onProgress?: (msg: string) => void): Promise<LevelData> {
  const get = async (f: string) => {
    const r = await fetch(`${base}/${f}`);
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}. Run "npm run mapng:import" first.`);
    return r;
  };
  onProgress?.('level index');
  const index: LevelIndex = await (await get('level.json')).json();
  onProgress?.('terrain, roads, objects');
  const [raw, roads, network, objects, route] = await Promise.all([
    get(index.terrain.file).then((r) => r.arrayBuffer()),
    get(index.files.roads).then((r) => r.json()),
    get(index.files.network).then((r) => r.json()),
    get(index.files.objects).then((r) => r.json()),
    get(index.files.route).then((r) => r.json()),
  ]);
  return { base, index, terrain: makeTerrain(index.terrain, raw), roads: roads.roads, network, objects, route };
}
