// Approximate lane arrows at the surveyed crossing, placed by eye from a photo of the
// junction. NOT verified on site: positions are about ±2 m. Replace with surveyed values
// when measured. World metres (x east, y north); bearing in degrees from north.

import * as THREE from 'three';

export const APPROX_ARROWS = [
  { id: 'straight-right-lane', x: 339.61, y: 229.48, bearing: 125.2, shape: 'straight' as const },
  { id: 'turn-left-lane', x: 341.68, y: 232.42, bearing: 125.2, shape: 'left' as const },
];

function arrowShape(kind: 'straight' | 'left'): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  // local: +x forward (direction of travel), +y left; metres
  if (kind === 'straight') {
    s.moveTo(-2.2, -0.2);
    s.lineTo(0.8, -0.2);
    s.lineTo(0.8, -0.6);
    s.lineTo(2.2, 0);
    s.lineTo(0.8, 0.6);
    s.lineTo(0.8, 0.2);
    s.lineTo(-2.2, 0.2);
  } else {
    // turn-left arrow: shaft bends left, head points left
    s.moveTo(-2.0, -0.2);
    s.lineTo(0.6, -0.2);
    s.lineTo(0.6, 0.0);
    s.lineTo(1.6, 0.0);
    s.lineTo(1.6, -0.6);
    s.lineTo(2.2, 0.0);
    s.lineTo(1.6, 0.6);
    s.lineTo(1.6, 0.2);
    s.lineTo(0.2, 0.2);
    s.lineTo(0.2, 1.0);
    s.lineTo(-2.0, 1.0);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

/** Painted arrows on the road surface (flat, white), one mesh each. */
export function buildApproxArrows(groundAt: (x: number, y: number) => number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'approx-arrows';
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4 });
  for (const a of APPROX_ARROWS) {
    const m = new THREE.Mesh(arrowShape(a.shape), mat);
    const yaw = (a.bearing * Math.PI) / 180;
    // a rotation of the flat shape: local +x → bearing direction (x east, y north → three x, −z)
    m.position.set(a.x, groundAt(a.x, a.y) + 0.07, -a.y);
    m.rotation.y = Math.PI / 2 - yaw; // local +x → direction of travel
    m.name = a.id;
    m.userData.approximate = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
