// Behaviour models taken from SUMO (https://sumo.dlr.de/docs/), reimplemented
// for a per-frame browser sim. Parameter names and defaults follow SUMO's
// vType attributes so they can be compared with a SUMO run.

/** SUMO vType defaults for a passenger car (Definition_of_Vehicles...#vehicle_types). */
export interface VType {
  accel: number; // m/s²
  decel: number; // m/s²  comfortable
  emergencyDecel: number;
  sigma: number; // driver imperfection 0..1 (Krauss)
  tau: number; // desired time headway, s
  minGap: number; // m, standstill gap
  length: number; // m
  maxSpeed: number; // m/s
  speedFactor: number; // multiplier on the lane speed limit
}
export const PASSENGER: VType = {
  accel: 2.6,
  decel: 4.5,
  emergencyDecel: 9,
  sigma: 0.5,
  tau: 1.0,
  minGap: 2.5,
  length: 4.5,
  maxSpeed: 55.55,
  speedFactor: 1.0,
};

/**
 * Krauss car-following (SUMO's default carFollowModel="Krauss").
 * v_safe = v_l + (g − v_l·τ) / ((v + v_l)/(2b) + τ)
 * v_next = max(0, min(v + a·dt, v_safe, v_max) − σ·a·dt·rand)
 */
export function kraussSpeed(
  t: VType,
  v: number,
  gap: number, // bumper-to-bumper minus minGap, m (Infinity if free)
  vLeader: number,
  vMax: number, // lane limit × speedFactor
  dt: number,
  rand: number, // 0..1
) {
  const b = t.decel;
  const vSafe = gap === Infinity ? Infinity : vLeader + (gap - vLeader * t.tau) / ((v + vLeader) / (2 * b) + t.tau);
  const vDes = Math.min(v + t.accel * dt, vSafe, vMax);
  const dawdle = t.sigma * t.accel * dt * rand;
  // SUMO never lets dawdling or braking exceed emergency decel in one step
  return Math.max(0, Math.max(v - t.emergencyDecel * dt, vDes - dawdle));
}

/** Speed that stops a vehicle within `dist` at comfortable decel (SUMO stopSpeed). */
export function stopSpeed(t: VType, v: number, dist: number, dt: number) {
  if (dist <= 0) return 0;
  // largest v_next with v_next·dt + v_next²/(2b) ≤ dist
  const b = t.decel;
  const vNext = -b * dt + Math.sqrt(b * b * dt * dt + 2 * b * dist);
  return Math.max(0, Math.min(v + t.accel * dt, vNext));
}

/**
 * SUMO junction model, simplified: a vehicle on a minor approach may enter
 * only if every conflicting vehicle reaches the conflict point later than
 * our arrival + `impatience`-reduced safety time (SUMO's junction gap acceptance).
 */
export function acceptsGap(ourArrival: number, otherArrivals: number[], safety = 2.0) {
  return otherArrivals.every((t) => t > ourArrival + safety || t < ourArrival - safety);
}

/** SUMO pedestrian defaults (pedestrian model "striping"). */
export const PEDESTRIAN = {
  speed: 1.39, // SUMO default walking speed, m/s
  speedDev: 0.1,
  stripeWidth: 0.64, // SUMO striping.stripe-width
  dawdling: 0.2, // striping.dawdling
  jamTime: 300,
  length: 0.25,
  width: 0.48,
};
