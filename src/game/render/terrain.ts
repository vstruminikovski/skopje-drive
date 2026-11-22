// Terrain mesh from the imported heightmap, draped with the MapNG colour texture.

import * as THREE from 'three';
import type { Terrain } from '../import/loadLevel';

export function buildTerrain(t: Terrain, textureUrl: string, step = 2): THREE.Mesh {
  const n = t.size;
  const m = Math.floor((n - 1) / step) + 1;
  const pos = new Float32Array(m * m * 3);
  const uv = new Float32Array(m * m * 2);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const si = Math.min(n - 1, i * step), sj = Math.min(n - 1, j * step);
      const k = j * m + i;
      const x = t.origin[0] + si * t.squareSize;
      const y = t.origin[1] + sj * t.squareSize;
      pos[k * 3] = x;
      pos[k * 3 + 1] = t.heights[sj * n + si] - 0.04; // sit just under decals and slabs
      pos[k * 3 + 2] = -y;
      uv[k * 2] = si / (n - 1);
      uv[k * 2 + 1] = sj / (n - 1); // image top = north
    }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let o = 0;
  for (let j = 0; j < m - 1; j++)
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
      idx.set([a, b, c, b, d, c], o);
      o += 6;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();

  const tex = new THREE.TextureLoader().load(textureUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/**
 * Plain ground running 1.5 km out from every map edge at the edge height, so the
 * horizon is land under the fog instead of empty sky. Not drivable (the map edge is walled).
 */
export function buildSkirt(t: Terrain, out = 1500, step = 16): THREE.Mesh {
  const n = t.size;
  const size = (n - 1) * t.squareSize;
  const x0 = t.origin[0], y0 = t.origin[1];
  const h = (i: number, j: number) => t.heights[Math.min(n - 1, j) * n + Math.min(n - 1, i)] - 0.15;
  // walk the border anticlockwise: (i, j) samples and outward normals
  const ring: { x: number; y: number; z: number; nx: number; ny: number }[] = [];
  for (let i = 0; i < n - 1; i += step) ring.push({ x: x0 + i, y: y0, z: h(i, 0), nx: 0, ny: -1 });
  for (let j = 0; j < n - 1; j += step) ring.push({ x: x0 + size, y: y0 + j, z: h(n - 1, j), nx: 1, ny: 0 });
  for (let i = n - 1; i > 0; i -= step) ring.push({ x: x0 + i, y: y0 + size, z: h(i, n - 1), nx: 0, ny: 1 });
  for (let j = n - 1; j > 0; j -= step) ring.push({ x: x0, y: y0 + j, z: h(0, j), nx: -1, ny: 0 });
  const pos: number[] = [];
  const inset = 3; // start under the terrain edge so no sky shows through the seam
  for (const p of ring) {
    pos.push(p.x - p.nx * inset, p.z, -(p.y - p.ny * inset));
    // corners fan out diagonally so neighbouring quads don't overlap
    const ox = p.x + p.nx * out + (p.nx ? 0 : (p.x - (x0 + size / 2)) / (size / 2)) * out;
    const oy = p.y + p.ny * out + (p.ny ? 0 : (p.y - (y0 + size / 2)) / (size / 2)) * out;
    pos.push(ox, p.z - 1, -oy);
  }
  const idx: number[] = [];
  const m = ring.length;
  for (let k = 0; k < m; k++) {
    const a = k * 2, b = a + 1, c = ((k + 1) % m) * 2, d = c + 1;
    idx.push(a, b, c, c, b, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6d7150, roughness: 1, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain-skirt';
  return mesh;
}

/** One chunk of the terrain at a given sample step (LOD). Coordinates are sample indices. */
function patch(t: Terrain, i0: number, j0: number, n: number, step: number, tex: THREE.Texture): THREE.Mesh {
  const N = t.size;
  const m = Math.floor(n / step) + 1; // vertices per side
  const pos = new Float32Array(m * m * 3);
  const uv = new Float32Array(m * m * 2);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const si = Math.min(N - 1, i0 + i * step), sj = Math.min(N - 1, j0 + j * step);
      const k = j * m + i;
      pos[k * 3] = t.origin[0] + si * t.squareSize;
      pos[k * 3 + 1] = t.heights[sj * N + si] - 0.04; // sit just under decals and slabs
      pos[k * 3 + 2] = -(t.origin[1] + sj * t.squareSize);
      uv[k * 2] = si / (N - 1);
      uv[k * 2 + 1] = sj / (N - 1); // image top = north
    }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let o = 0;
  for (let j = 0; j < m - 1; j++)
    for (let i = 0; i < m - 1; i++) {
      const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
      idx.set([a, b, c, b, d, c], o);
      o += 6;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 }));
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Terrain as square chunks, each with a near (fine) and a far (coarse) mesh. The caller
 * shows the right one per chunk by distance (see `chunks` in userData), so only the
 * ground around the car is drawn at full detail.
 */
export function buildTerrainChunks(t: Terrain, tex: THREE.Texture, chunk = 128, near = 2, far = 8): THREE.Group {
  const g = new THREE.Group();
  g.name = 'terrain';
  const chunks: { cx: number; cy: number; near: THREE.Mesh; far: THREE.Mesh }[] = [];
  const N = t.size;
  for (let j0 = 0; j0 < N - 1; j0 += chunk)
    for (let i0 = 0; i0 < N - 1; i0 += chunk) {
      const n = Math.min(chunk, N - 1 - i0, N - 1 - j0);
      const cx = t.origin[0] + (i0 + n / 2) * t.squareSize;
      const cy = t.origin[1] + (j0 + n / 2) * t.squareSize;
      const a = patch(t, i0, j0, n, near, tex), b = patch(t, i0, j0, n, far, tex);
      a.name = b.name = 'terrain-chunk';
      g.add(a, b);
      chunks.push({ cx, cy, near: a, far: b });
    }
  g.userData.chunks = chunks;
  return g;
}

/** The map's colour image as a texture (no added detail). */
export function loadTerrainTexture(url: string): Promise<THREE.Texture> {
  return new Promise((res, rej) => {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      res(tex);
    }, undefined, () => rej(new Error('terrain texture failed to load')));
  });
}
