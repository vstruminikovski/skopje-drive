// Parked cars in occupied bays: two instanced meshes (body, glass), static colliders.

import * as THREE from 'three';
import type { Bay } from '../import/parkingLayout';

// real-world car colours: silver, white, graphite, black, grey, beige, deep blue, deep red
const PAINT = [0xd8d4cc, 0x2b3a55, 0x8c1c13, 0x3d5a40, 0x111111, 0xb0b5b9, 0x6b4e2e, 0xe8e8e8, 0x4a4f57, 0x1f3f6e];

export function buildParkedCars(bays: Bay[]) {
  const g = new THREE.Group();
  g.name = 'parked-cars';
  const body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.1, 0.7, 1.75).translate(0, 0.6, 0),
    new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.45 }),
    Math.max(1, bays.length),
  );
  const cabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.1, 0.55, 1.58).translate(-0.25, 1.22, 0),
    new THREE.MeshStandardMaterial({ color: 0x1b2630, metalness: 0.2, roughness: 0.15 }),
    Math.max(1, bays.length),
  );
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  bays.forEach((b, i) => {
    // nose in or out at random-but-fixed; long axis along the bay depth
    const flip = (i * 7919) % 3 === 0 ? Math.PI : 0;
    o.position.set(b.x, b.z, -b.y);
    o.rotation.set(0, b.heading + flip, 0);
    o.updateMatrix();
    body.setMatrixAt(i, o.matrix);
    cabin.setMatrixAt(i, o.matrix);
    body.setColorAt(i, c.setHex(PAINT[(i * 31) % PAINT.length]));
  });
  body.count = cabin.count = bays.length;
  for (const m of [body, cabin]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
