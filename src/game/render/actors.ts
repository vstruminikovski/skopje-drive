// Meshes for the player car, AI cars and pedestrians.

import * as THREE from 'three';
import type { Pose } from '../traffic/traffic';

export function carMesh(color: number, withWheels = true) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2630, metalness: 0.2, roughness: 0.15 });
  // local +X forward
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.62, 1.72), paint);
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 1.56), glass);
  cabin.position.set(-0.25, 1.12, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 1.5), paint);
  roof.position.set(-0.3, 1.42, 0);
  const lightF = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 0.6 });
  const lightR = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2200, emissiveIntensity: 0.4 });
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.32), lightF);
    f.position.set(2.0, 0.66, s * 0.62);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.32), lightR);
    r.position.set(-2.0, 0.7, s * 0.62);
    g.add(f, r);
  }
  g.add(body, cabin, roof);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  g.userData.brake = lightR;
  const wheels: THREE.Object3D[] = [];
  if (withWheels) {
    const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const geo = new THREE.CylinderGeometry(0.31, 0.31, 0.22, 18).rotateX(Math.PI / 2);
    for (const [x, z] of [
      [1.28, -0.78],
      [1.28, 0.78],
      [-1.28, -0.78],
      [-1.28, 0.78],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.31, z);
      const w = new THREE.Mesh(geo, tire);
      w.castShadow = true;
      pivot.add(w);
      g.add(pivot);
      wheels.push(pivot);
    }
  }
  g.userData.wheels = wheels;
  return g;
}

export function pedMesh(hue: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.22, 0.95, 4, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue, 0.45, 0.42) }),
  );
  body.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc89a7a }));
  head.position.y = 1.58;
  g.add(body, head);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/** Place a mesh at a world pose, pitched to follow the terrain. */
export function placeOnPose(obj: THREE.Object3D, p: Pose, heightAt?: (x: number, y: number) => number) {
  const z = heightAt ? Math.max(p.z, heightAt(p.x, p.y)) : p.z;
  obj.position.set(p.x, z, -p.y);
  obj.rotation.set(0, p.heading, 0);
}
