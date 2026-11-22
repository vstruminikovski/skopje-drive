// MapNG building and sidewalk tiles (Collada exported by three.js).
// Visual meshes are shown; the "Colmesh" nodes become Rapier trimeshes.

import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import type { PlacedModel } from '../import/types';
import { materialFor } from './materials';

export interface LoadedModel {
  model: PlacedModel;
  object: THREE.Object3D;
  collision: { vertices: Float32Array; indices: Uint32Array };
}


export async function loadModel(
  base: string,
  model: PlacedModel,
  /** world (BeamNG) x,y → terrain height; anchors facade textures to the ground */
  heightAt?: (x: number, y: number) => number,
): Promise<LoadedModel> {
  const loader = new ColladaLoader();
  const collada = await loader.loadAsync(`${base}/${model.file}`);
  const root = new THREE.Group();
  root.name = model.name;
  root.add(collada.scene); // the loader already turns Z_UP into three's Y_UP
  const [x, y, z] = model.position;
  root.position.set(x, z, -y);
  root.updateMatrixWorld(true);

  const verts: number[] = [];
  const idx: number[] = [];
  const hide: THREE.Object3D[] = [];
  collada.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const isCol = /colmesh/i.test(mesh.name) || /colmesh/i.test(mesh.parent?.name ?? '');
    if (isCol) {
      appendWorld(mesh, verts, idx);
      hide.push(mesh);
      return;
    }
    const g = mesh.geometry as THREE.BufferGeometry;
    // keep MapNG's per-face material slots, swapping each for a real-scale textured one
    const vc = !!g.getAttribute('color');
    if (heightAt && model.role === 'buildings') anchorWallsToGround(mesh, heightAt);
    const swap = (m: THREE.Material) => materialFor(m.name || (model.role === 'sidewalks' ? 'mapng_sidewalk' : 'mapng_bld_plaster'), vc);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    mesh.castShadow = model.role === 'buildings';
    mesh.receiveShadow = true;
  });
  hide.forEach((m) => m.removeFromParent());
  // no explicit collision mesh: collide with the visual one
  if (!idx.length)
    collada.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) appendWorld(o as THREE.Mesh, verts, idx);
    });
  return { model, object: root, collision: { vertices: new Float32Array(verts), indices: new Uint32Array(idx) } };
}

function appendWorld(mesh: THREE.Mesh, verts: number[], idx: number[]) {
  const g = mesh.geometry as THREE.BufferGeometry;
  const p = g.getAttribute('position');
  if (!p) return;
  mesh.updateWorldMatrix(true, false);
  const base = verts.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
    verts.push(v.x, v.y, v.z);
  }
  const index = g.getIndex();
  if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
  else for (let i = 0; i < p.count; i++) idx.push(base + i);
}

/**
 * MapNG wall UVs are metres, but v starts at an arbitrary offset per wall, so
 * window rows can float near the top of tall walls. Re-base v on height above
 * the terrain under each vertex: storey 1 then always starts at the ground line.
 * Roof faces keep their own UVs.
 */
function anchorWallsToGround(mesh: THREE.Mesh, heightAt: (x: number, y: number) => number) {
  const g = mesh.geometry as THREE.BufferGeometry;
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const index = g.getIndex();
  if (!pos || !uv || !index) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.updateWorldMatrix(true, false);
  const v = new THREE.Vector3();
  const done = new Uint8Array(pos.count);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: index.count, materialIndex: 0 }];
  for (const grp of groups) {
    const name = mats[grp.materialIndex ?? 0]?.name ?? '';
    if (/roof|sidewalk|curb|pavers|sett|asphalt|sport/.test(name)) continue;
    for (let k = grp.start; k < grp.start + grp.count; k++) {
      const i = index.getX(k);
      if (done[i]) continue;
      done[i] = 1;
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); // three axes: x, up, -north
      uv.setY(i, Math.max(0, v.y - heightAt(v.x, -v.z)));
    }
  }
  uv.needsUpdate = true;
}
