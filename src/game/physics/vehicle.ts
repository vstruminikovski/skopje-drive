// Player car on Rapier's ray-cast vehicle controller.
// Local axes: +X forward, +Y up, +Z right-hand axle (Rapier's default forward axis 0).

import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from './world';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 left .. 1 right
  handbrake: boolean;
  reverse: boolean;
}

export const CAR = {
  mass: 1150,
  half: { x: 2.0, y: 0.45, z: 0.85 },
  wheelBase: 1.28, // ±x of axles
  track: 0.78, // ±z of wheels
  radius: 0.31,
  restLength: 0.3,
  maxSteer: 0.6,
  engineForce: 2600,
  brakeForce: 32,
  topSpeed: 16.7, // 60 km/h
  reverseTop: 4,
};

export interface PlayerVehicle {
  body: RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  update(input: DriveInput, dt: number): void;
  speed(): number; // m/s, signed forward
  steerAngle(): number;
  wheel(i: number): { suspension: number; spin: number };
  reset(pos: { x: number; y: number; z: number }, yaw: number): void;
}

export function createVehicle(pw: PhysicsWorld, pos: { x: number; y: number; z: number }, yaw: number): PlayerVehicle {
  const { R, world } = pw;
  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(yawQuat(yaw))
      .setLinearDamping(0.05)
      .setAngularDamping(0.6)
      .setCanSleep(false),
  );
  const vol = 8 * CAR.half.x * CAR.half.y * CAR.half.z;
  world.createCollider(
    R.ColliderDesc.cuboid(CAR.half.x, CAR.half.y, CAR.half.z)
      .setTranslation(0, 0.25, 0)
      .setDensity(CAR.mass / vol)
      .setFriction(0.4),
    body,
  );
  const controller = world.createVehicleController(body);
  const wheels = [
    [CAR.wheelBase, -CAR.track], // front left (−z is left when +x forward, +y up)
    [CAR.wheelBase, CAR.track],
    [-CAR.wheelBase, -CAR.track],
    [-CAR.wheelBase, CAR.track],
  ];
  wheels.forEach(([x, z], i) => {
    controller.addWheel({ x, y: -0.05, z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, CAR.restLength, CAR.radius);
    controller.setWheelSuspensionStiffness(i, 28);
    controller.setWheelSuspensionCompression(i, 2.6);
    controller.setWheelSuspensionRelaxation(i, 3.2);
    controller.setWheelMaxSuspensionForce(i, 12000);
    controller.setWheelFrictionSlip(i, 2.4);
    controller.setWheelSideFrictionStiffness(i, 1.0);
  });

  let steer = 0;
  const v = {
    body,
    controller,
    speed: () => controller.currentVehicleSpeed(),
    steerAngle: () => steer,
    wheel: (i: number) => ({
      suspension: controller.wheelSuspensionLength(i) ?? CAR.restLength,
      spin: controller.wheelRotation(i) ?? 0,
    }),
    update(input: DriveInput, dt: number) {
      const sp = controller.currentVehicleSpeed();
      // steering eases in and narrows with speed
      const target = input.steer * CAR.maxSteer * (1 / (1 + Math.abs(sp) * 0.06));
      steer += (target - steer) * Math.min(1, dt * 6);
      controller.setWheelSteering(0, -steer);
      controller.setWheelSteering(1, -steer);

      let force = 0;
      if (input.reverse) force = sp > -CAR.reverseTop ? -input.throttle * CAR.engineForce * 0.6 : 0;
      else force = sp < CAR.topSpeed ? input.throttle * CAR.engineForce * (1 - Math.max(0, sp) / (CAR.topSpeed * 1.4)) : 0;
      for (const i of [2, 3]) controller.setWheelEngineForce(i, force);

      const brake = input.brake * CAR.brakeForce + (input.throttle === 0 && Math.abs(sp) < 0.6 ? 6 : 0.4);
      for (let i = 0; i < 4; i++) controller.setWheelBrake(i, i >= 2 && input.handbrake ? CAR.brakeForce * 2 : brake);
      controller.updateVehicle(dt);
    },
    reset(p: { x: number; y: number; z: number }, yawR: number) {
      body.setTranslation(p, true);
      body.setRotation(yawQuat(yawR), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },
  };
  return v;
}

/** Rotation about +Y so local +X points along three.js heading `yaw` (atan2(-dz, dx)). */
export function yawQuat(yaw: number) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
