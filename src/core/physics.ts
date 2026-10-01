import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

// Collision groups: upper 16 bits = membership, lower 16 bits = filter.
export const G_TRACK = 1 << 0;
export const G_CAR = 1 << 1;
export const G_DEBRIS = 1 << 2;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const TRACK_GROUPS = groups(G_TRACK, G_CAR | G_DEBRIS);
export const CAR_GROUPS = groups(G_CAR, G_TRACK);
export const DEBRIS_GROUPS = groups(G_DEBRIS, G_TRACK | G_DEBRIS);
export const WHEEL_RAY_GROUPS = groups(G_CAR, G_TRACK);

export const PHYS_DT = 1 / 120;
export { GRAVITY } from './constants';
import { GRAVITY } from './constants';

/** Anything the car can stand on that moves (platforms, rotating bridges...). */
export interface MovingSurface {
  /** Velocity of the surface at a world-space point during the current physics step. */
  velocityAt(point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  /**
   * Swings down through the road (low windmill blades): when it pins the car against the track it
   * cuts through the car instead of pushing it through the road (see Vehicle.afterStep).
   */
  readonly cutsThrough?: boolean;
}

/** Rigid body handle -> moving surface (used by the tyre model to get relative velocity). */
export const movingSurfaces = new Map<number, MovingSurface>();

export async function createWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  world.timestep = PHYS_DT;
  world.integrationParameters.numSolverIterations = 6;
  return world;
}

export const v3 = (v: { x: number; y: number; z: number }, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const q4 = (q: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) =>
  out.set(q.x, q.y, q.z, q.w);
