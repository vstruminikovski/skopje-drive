// Rapier physics: terrain heightfield, static meshes from the map, and the
// player's ray-cast vehicle (Rapier DynamicRayCastVehicleController).

import RAPIER from '@dimforge/rapier3d-compat';
import type { Terrain } from '../import/loadLevel';

export type Rapier = typeof RAPIER;
let ready: Promise<Rapier> | null = null;
export function initRapier(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

/**
 * Terrain as a Rapier heightfield in three.js axes. Rapier's heightfield is a
 * column-major (nrows+1)×(ncols+1) matrix: rows run along +Z, columns along +X,
 * centred on the collider origin. Three Z = −world y, so row r is world row n−1−r.
 */
export function heightfieldDesc(R: Rapier, t: Terrain, step = 1) {
  const n = t.size;
  const m = Math.floor((n - 1) / step); // subdivisions
  const heights = new Float32Array((m + 1) * (m + 1));
  for (let c = 0; c <= m; c++)
    for (let r = 0; r <= m; r++) {
      const i = c * step;
      const j = n - 1 - r * step;
      heights[c * (m + 1) + r] = t.heights[j * n + i];
    }
  const ext = m * step * t.squareSize;
  const desc = R.ColliderDesc.heightfield(m, m, heights, { x: ext, y: 1, z: ext });
  // world x of column 0 = origin x; three Z of row 0 = −(origin y + (n−1))
  const x0 = t.origin[0], z0 = -(t.origin[1] + (n - 1) * t.squareSize);
  desc.setTranslation(x0 + ext / 2, 0, z0 + ext / 2);
  desc.setFriction(1.0);
  return desc;
}

export interface PhysicsWorld {
  R: Rapier;
  world: RAPIER.World;
  addTrimesh(vertices: Float32Array, indices: Uint32Array): void;
  addBoundary(t: Terrain): void;
  addBox(x: number, y: number, z: number, yaw: number, half: [number, number, number]): void;
  step(dt: number): void;
}

export function createWorld(R: Rapier, terrain: Terrain): PhysicsWorld {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(heightfieldDesc(R, terrain));
  return {
    R,
    world,
    addTrimesh(vertices, indices) {
      if (!indices.length) return;
      world.createCollider(R.ColliderDesc.trimesh(vertices, indices).setFriction(0.8));
    },
    addBoundary(t) {
      // four tall walls just inside the terrain edge so the car can't drive off the map
      const size = (t.size - 1) * t.squareSize;
      const x0 = t.origin[0], y0 = t.origin[1], h = 40, th = 1;
      const cx = x0 + size / 2, cy = y0 + size / 2;
      const walls: [number, number, number, number][] = [
        [cx, y0 + 1, size / 2, th], [cx, y0 + size - 1, size / 2, th],
        [x0 + 1, cy, th, size / 2], [x0 + size - 1, cy, th, size / 2],
      ];
      for (const [x, y, hx, hy] of walls) world.createCollider(R.ColliderDesc.cuboid(hx, h, hy).setTranslation(x, 0, -y));
    },
    addBox(x, y, z, yaw, [hx, hy, hz]) {
      // world (x east, y north, z up) → three (x, z, −y); yaw about the vertical axis
      const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      world.createCollider(R.ColliderDesc.cuboid(hx, hz, hy).setTranslation(x, z + hz, -y).setRotation(q));
    },
    step(dt) {
      world.timestep = dt;
      world.step();
    },
  };
}
