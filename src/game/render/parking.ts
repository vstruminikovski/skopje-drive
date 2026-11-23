// Parked cars in occupied bays: a body, a glass cabin and four wheels, drawn as instanced meshes
// (one draw call each, however many cars there are).

import * as THREE from 'three';
import type { Bay } from '../import/parkingLayout';

// real-world car colours: silver, white, graphite, black, grey, beige, deep blue, deep red
const PAINT = [0xd8d4cc, 0x2b3a55, 0x8c1c13, 0x3d5a40, 0x111111, 0xb0b5b9, 0x6b4e2e, 0xe8e8e8, 0x4a4f57, 0x1f3f6e];
// wheel positions relative to the car centre: front/back (x) and left/right (z), metres
const WHEELS: [number, number][] = [[1.3, 0.85], [1.3, -0.85], [-1.3, 0.85], [-1.3, -0.85]];

export function buildParkedCars(bays: Bay[]) {
  const g = new THREE.Group();
  g.name = 'parked-cars';
  const n = Math.max(1, bays.length);
  const body = new THREE.InstancedMesh(
    new THREE.BoxGeometry(4.1, 0.62, 1.78).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ metalness: 0.35, roughness: 0.45 }),
    n,
  );
  const cabin = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.0, 0.56, 1.6).translate(-0.2, 1.1, 0),
    new THREE.MeshStandardMaterial({ color: 0x1b2630, metalness: 0.2, roughness: 0.15 }),
    n,
  );
  const wheels = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    n * WHEELS.length,
  );
  const o = new THREE.Object3D();
  const m = new THREE.Matrix4();
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
    WHEELS.forEach(([x, z], k) => {
      m.copy(o.matrix).multiply(new THREE.Matrix4().makeTranslation(x, 0.34, z));
      wheels.setMatrixAt(i * WHEELS.length + k, m);
    });
  });
  body.count = cabin.count = bays.length;
  wheels.count = bays.length * WHEELS.length;
  for (const mesh of [body, cabin, wheels]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}
