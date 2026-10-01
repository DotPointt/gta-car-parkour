import * as THREE from 'three';
import type { RAPIER } from '../core/physics';
import { segmentDef } from '../levels/catalog';
import type { LevelPlan } from '../levels/types';
import { TrackBuilder, type Materials } from './builder';
import type { Cursor } from './frames';
import { Kit } from './kit';

export type { Section, BoostPad } from './kit';

/** A built level: geometry, colliders, moving parts and the runtime registries the game reads. */
export class Course {
  readonly b: TrackBuilder;
  readonly kit: Kit;
  private boostTime = 0;

  constructor(world: RAPIER.World, mats: Materials, readonly plan: LevelPlan) {
    this.b = new TrackBuilder(world, mats);
    this.kit = new Kit(this.b, mats, { index: plan.index, name: plan.name });
    let c: Cursor = { p: new THREE.Vector3(0, plan.startAltitude, 0), yaw: 0 };
    for (const seg of plan.segments) c = segmentDef(seg.type).build(this.kit, c, seg.params);
    if (!this.kit.finish) throw new Error('Level plan has no finish segment');
  }

  get group() {
    return this.b.group;
  }
  get minY() {
    return this.b.minY;
  }
  get sections() {
    return this.kit.sections;
  }
  get boosts() {
    return this.kit.boosts;
  }
  get path() {
    return this.kit.path;
  }
  get spawnPos() {
    return this.kit.spawnPos;
  }
  get spawnYaw() {
    return this.kit.spawnYaw;
  }
  get finish() {
    return this.kit.finish!;
  }
  get finishPoint() {
    return this.kit.finishPoint;
  }

  /** Middle of the course footprint (used to place the city and the ocean). */
  center() {
    const box = new THREE.Box3().setFromPoints(this.path);
    return box.getCenter(new THREE.Vector3());
  }

  /** Physics step preparation for all moving parts (pose at t..t+dt). */
  prepareStep(t: number, dt: number) {
    for (const k of this.b.kinematics) k.prepare(t, dt);
  }

  render(t: number, dt: number) {
    for (const k of this.b.kinematics) k.renderAt(t);
    this.boostTime += dt;
    for (const bp of this.boosts) bp.mat.map!.offset.y = -this.boostTime * 1.5;
  }

  dispose() {
    this.b.dispose();
  }
}
