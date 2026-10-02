import * as THREE from 'three';
import { RAPIER } from '../core/physics';
import { CAR } from '../car/carModel';
import * as TX from '../gfx/textures';
import { TrackBuilder, BoxTrigger, type Materials, type ProfileVertex } from './builder';
import { dirOf, endCursor, lineFrames, local, rightOf, samplePath, yawQuat, type Cursor, type Frame } from './frames';

import { ROAD_W, WIDE_W } from '../core/constants';
export { ROAD_W, WIDE_W };

export interface Section {
  name: string;
  sub: string;
  point: THREE.Vector3;
  spawnPos: THREE.Vector3;
  yaw: number;
  /** Can the player respawn here (checkpoint mode)? */
  checkpoint: boolean;
}

export interface BoostPad {
  trigger: BoxTrigger;
  dir: THREE.Vector3;
  speed: number;
  /** up = speed boost only; exact = sets the speed both ways (jumps and loops need a precise entry speed) */
  mode: 'up' | 'exact';
  mat: THREE.MeshStandardMaterial;
}

// ---- cross-section profiles (CCW in right/up coordinates) --------------------------------
export function roadProfile(w: number, t = 1.2): ProfileVertex[] {
  return [
    { x: -w / 2, y: -t, mat: 'dark' },
    { x: w / 2, y: -t, mat: 'hazard' },
    { x: w / 2, y: 0, mat: 'road' },
    { x: -w / 2, y: 0, mat: 'hazard' },
  ];
}
export function wallProfile(w: number, h: number, t = 1.2, wall = 0.6, inner: 'wall' | 'hazard' = 'wall'): ProfileVertex[] {
  const a = w / 2;
  const b = a + wall;
  return [
    { x: -b, y: -t, mat: 'dark' },
    { x: b, y: -t, mat: 'orange' },
    { x: b, y: h, mat: 'light' },
    { x: a, y: h, mat: inner },
    { x: a, y: 0, mat: 'road' },
    { x: -a, y: 0, mat: inner },
    { x: -a, y: h, mat: 'light' },
    { x: -b, y: h, mat: 'orange' },
  ];
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);

/**
 * High-level building blocks used by the segment catalog (levels/catalog/*). Owns the per-level
 * runtime registries (sections, speed pads, finish, autopilot path).
 */
export class Kit {
  readonly sections: Section[] = [];
  readonly boosts: BoostPad[] = [];
  readonly path: THREE.Vector3[] = [];
  spawnPos = new THREE.Vector3();
  spawnYaw = 0;
  finish: BoxTrigger | null = null;
  finishPoint = new THREE.Vector3();

  constructor(readonly b: TrackBuilder, readonly mats: Materials, readonly level: { index: number; name: string }) {}

  // ---- registries --------------------------------------------------------------------------
  section(name: string, sub: string, c: Cursor, spawnAhead = 6, checkpoint = true) {
    const spawn = local(c, 0, CAR.restHeight + 0.05, spawnAhead);
    this.sections.push({ name, sub, point: c.p.clone(), spawnPos: spawn, yaw: c.yaw, checkpoint });
  }

  setSpawn(c: Cursor, ahead: number) {
    this.spawnPos = local(c, 0, CAR.restHeight + 0.05, ahead);
    this.spawnYaw = c.yaw;
  }

  trace(frames: Frame[] | THREE.Vector3[]) {
    if (frames.length === 0) return;
    const pts = (frames[0] as Frame).t ? samplePath(frames as Frame[], 2) : (frames as THREE.Vector3[]);
    for (const p of pts) this.path.push(p.clone());
  }

  // ---- roads -------------------------------------------------------------------------------
  extrudeRoad(frames: Frame[], w: number, walls: number | false = false, caps = true) {
    this.b.extrude(frames, walls ? wallProfile(w, walls) : roadProfile(w), { caps });
    this.trace(frames);
  }

  road(c: Cursor, length: number, w = ROAD_W, heightFn?: (z: number) => number, walls: number | false = false) {
    const f = lineFrames(c, length, 2, heightFn);
    this.extrudeRoad(f, w, walls);
    return endCursor(f);
  }

  /**
   * Straight road with open transverse slots at the given z (low windmill blades dive through them).
   * Only the meshes are cut: the collider stays continuous, so the wheels roll over a slot without
   * dropping in (blades are kinematic and never collide with the static road anyway).
   */
  slottedRoad(c: Cursor, length: number, w: number, slots: number[], gap: number) {
    const f = lineFrames(c, length, 2);
    this.b.extrude(f, roadProfile(w), { mesh: false });
    this.trace(f);
    let z0 = 0;
    for (const z of [...slots].sort((a, b) => a - b).concat(Infinity)) {
      const z1 = Math.min(length, z - gap / 2);
      if (z1 - z0 > 0.5) {
        const piece = lineFrames({ p: local(c, 0, 0, z0), yaw: c.yaw }, z1 - z0, 2);
        for (const fr of piece) fr.d += z0; // keeps the road texture continuous across the slots
        this.b.extrude(piece, roadProfile(w), { collider: false });
      }
      if (z === Infinity) break;
      // hazard stripes along both lips of the slot
      for (const s of [-1, 1])
        this.b.addBox(local(c, 0, 0.01, z + s * (gap / 2 + 0.3)), new THREE.Vector3(w, 0.02, 0.6), c.yaw, 'hazard', 'hazard', 'dark', false);
      z0 = z + gap / 2;
    }
    return endCursor(f);
  }

  pad(c: Cursor, w: number, len: number) {
    this.b.addBox(local(c, 0, -0.75, len / 2), new THREE.Vector3(w, 1.5, len), c.yaw, 'plate', 'hazard');
    for (let z = 2; z <= len; z += 4) this.path.push(local(c, 0, 0, z));
    return { p: local(c, 0, 0, len), yaw: c.yaw };
  }

  /** Green speed pad on the road, z..z+len ahead of the cursor. */
  boostPad(c: Cursor, z: number, len: number, w: number, speed: number, mode: 'up' | 'exact' = 'up') {
    const mat = this.b.own(this.mats.boost.clone());
    mat.map = this.mats.boost.map!.clone();
    mat.map.needsUpdate = true;
    mat.emissiveMap = mat.map;
    mat.map.repeat.set(1, len / 6);
    const geo = new THREE.PlaneGeometry(w, len);
    geo.rotateX(-Math.PI / 2);
    geo.rotateY(Math.PI);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(local(c, 0, 0.03, z + len / 2));
    m.quaternion.copy(yawQuat(c.yaw));
    m.receiveShadow = true;
    this.b.group.add(m);
    this.boosts.push({
      trigger: new BoxTrigger(local(c, 0, 1.5, z + len / 2), new THREE.Vector3(w / 2 + 0.5, 2.5, len / 2), c.yaw),
      dir: dirOf(c.yaw),
      speed,
      mode,
      mat,
    });
  }

  /**
   * Green pad on a jump/loop approach that sets the entry speed exactly (speeds the car up or reins it
   * in), so the jump math holds whatever came before. There are no red limiter pads in the game.
   */
  speedGate(c: Cursor, speed: number, w = ROAD_W) {
    this.boostPad(c, 26, 14, w - 6, speed, 'exact');
  }

  // ---- decor ---------------------------------------------------------------------------------
  sign(pos: THREE.Vector3, yaw: number, lines: string[], w = 8, h = 4, bg = '#f5b50a', fg = '#111') {
    const mat = this.b.own(new THREE.MeshStandardMaterial({ map: TX.signTexture(lines, bg, fg), roughness: 0.6, side: THREE.DoubleSide }));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    board.position.copy(pos);
    board.quaternion.copy(yawQuat(yaw + Math.PI));
    this.b.addDecor(board);
  }

  ring(pos: THREE.Vector3, yaw: number, radius: number, color = 0xff6a00) {
    const mat = this.b.own(new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 }));
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.6, 12, 64), mat);
    m.position.copy(pos);
    m.quaternion.copy(yawQuat(yaw));
    this.b.addDecor(m);
    return m;
  }

  /** Two pillars + banner across the road at z. */
  gate(c: Cursor, z: number, width: number, text: string, finish: boolean) {
    const half = width / 2;
    for (const x of [-half, half]) this.b.addBox(local(c, x, 4.5, z), new THREE.Vector3(1.4, 9, 1.4), c.yaw, 'dark', finish ? 'checker' : 'hazard');
    const mat = this.b.own(
      new THREE.MeshStandardMaterial({
        map: finish ? TX.bannerTexture(text, '#111', '#ffffff') : TX.bannerTexture(text),
        roughness: 0.5,
      }),
    );
    const banner = new THREE.Mesh(new THREE.BoxGeometry(width + 1.4, 2.5, 0.5), mat);
    banner.position.copy(local(c, 0, 8.2, z));
    banner.quaternion.copy(yawQuat(c.yaw + Math.PI));
    this.b.addDecor(banner);
  }

  // ---- moving obstacles ------------------------------------------------------------------
  /**
   * Horizontal propeller at car height, rotating around a post in the middle of the road.
   * `reach` = radius of the swept circle (outer edge of the blade tips, colliders included).
   */
  propeller(c: Cursor, z: number, omega: number, phase: number, blades: number, reach: number) {
    const pivot = local(c, 0, 0, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 3.2, 20), this.mats.dark);
    post.position.copy(pivot).add(new THREE.Vector3(0, 1.6, 0));
    this.b.addDecor(post);
    this.b.collider(RAPIER.ColliderDesc.cylinder(1.6, 1.25).setTranslation(post.position.x, post.position.y, post.position.z).setFriction(0.8));
    const group = new THREE.Group();
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.9, 24), this.mats.danger);
    cap.position.y = 1.0;
    group.add(cap);
    const colliders: RAPIER.ColliderDesc[] = [];
    const tipR = 0.9;
    const len = reach - tipR - 1.4;
    for (let k = 0; k < blades; k++) {
      const a = (k / blades) * Math.PI * 2;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0.3, 'YXZ'));
      const off = new THREE.Vector3(0, 0, 1.4 + len / 2).applyAxisAngle(Y, a).setY(0.95);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, len), this.mats.danger);
      blade.position.copy(off);
      blade.quaternion.copy(q);
      group.add(blade);
      // rounded tip: it is what grazes a car squeezing past along the road edge, so it has a collider too
      const tipPos = new THREE.Vector3(0, 0, 1.4 + len).applyAxisAngle(Y, a).setY(0.95);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(tipR, tipR, 0.7, 16), this.mats.danger);
      tip.position.copy(tipPos);
      tip.quaternion.copy(q);
      group.add(tip);
      colliders.push(RAPIER.ColliderDesc.cuboid(0.9, 0.35, len / 2).setTranslation(off.x, off.y, off.z).setRotation(q));
      colliders.push(RAPIER.ColliderDesc.cylinder(0.35, tipR).setTranslation(tipPos.x, tipPos.y, tipPos.z).setRotation(q));
    }
    this.b.addKinematic(
      group,
      (t, p, q) => {
        p.copy(pivot);
        q.setFromAxisAngle(Y, c.yaw + omega * t + phase);
      },
      colliders,
    );
  }

  /**
   * Windmill over the road (axis = road direction). With hubH < R the lower blades dive through the
   * road (build it with slottedRoad) and sweep across its whole width at car height.
   */
  windmill(c: Cursor, x: number, z: number, omega: number, phase: number, blades: number, R: number, hubH: number) {
    const hub = local(c, x, hubH, z);
    const base = yawQuat(c.yaw);
    const group = new THREE.Group();
    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 1.8, 24), this.mats.danger);
    hubMesh.rotation.x = Math.PI / 2;
    group.add(hubMesh);
    const colliders: RAPIER.ColliderDesc[] = [];
    const len = R - 1.4;
    for (let k = 0; k < blades; k++) {
      const a = (k / blades) * Math.PI * 2;
      const rq = new THREE.Quaternion().setFromAxisAngle(Z, a);
      const off = new THREE.Vector3(0, 1.4 + len / 2, 0).applyQuaternion(rq);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(2.6, len, 0.9), this.mats.danger);
      blade.position.copy(off);
      blade.quaternion.copy(rq);
      group.add(blade);
      colliders.push(RAPIER.ColliderDesc.cuboid(1.3, len / 2, 0.45).setTranslation(off.x, off.y, off.z).setRotation(rq));
    }
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4, 12), this.mats.dark);
    axle.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    axle.position.copy(hub).addScaledVector(dirOf(c.yaw), 2.2);
    this.b.addDecor(axle);
    const spin = new THREE.Quaternion();
    this.b.addKinematic(
      group,
      (t, p, q) => {
        p.copy(hub);
        spin.setFromAxisAngle(Z, omega * t + phase);
        q.copy(base).multiply(spin);
      },
      colliders,
      { cutsThrough: hubH < R },
    );
  }

  /** Wrecking-ball style pendulum swinging across the road. */
  pendulum(c: Cursor, z: number, period: number, phase: number, amp: number) {
    const pivotH = 16;
    const arm = 14;
    const pivot = local(c, 0, pivotH, z);
    const base = yawQuat(c.yaw);
    // frame (decor): two towers outside the road + cross beam
    for (const x of [-14.5, 14.5]) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, pivotH + 1.5, 1.2), this.mats.dark);
      tower.position.copy(local(c, x, (pivotH + 1.5) / 2 - 1.2, z));
      tower.quaternion.copy(base);
      this.b.addDecor(tower);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(30.2, 1.2, 1.4), this.mats.hazard);
    beam.position.copy(local(c, 0, pivotH + 0.6, z));
    beam.quaternion.copy(base);
    this.b.addDecor(beam);

    const group = new THREE.Group();
    const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, arm, 0.6), this.mats.dark);
    armMesh.position.y = -arm / 2;
    group.add(armMesh);
    const bob = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.0, 4.6), this.mats.danger);
    bob.position.y = -arm;
    group.add(bob);
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.2, 1.6, 4), this.mats.dark);
    spike.position.y = -arm - 2.2;
    spike.rotation.x = Math.PI;
    group.add(spike);
    const colliders = [
      RAPIER.ColliderDesc.cuboid(1.6, 1.5, 2.3).setTranslation(0, -arm, 0),
      RAPIER.ColliderDesc.cuboid(0.3, arm / 2, 0.3).setTranslation(0, -arm / 2, 0),
    ];
    const swing = new THREE.Quaternion();
    const w = (Math.PI * 2) / period;
    this.b.addKinematic(
      group,
      (t, p, q) => {
        p.copy(pivot);
        swing.setFromAxisAngle(Z, amp * Math.sin(w * t + phase));
        q.copy(base).multiply(swing);
      },
      colliders,
    );
  }

  /**
   * Hydraulic press: a heavy block that slams down onto the road and rises again.
   * split = two half-width blocks working in opposite phase (drive through the open half).
   */
  press(c: Cursor, z: number, period: number, phase: number, split: boolean) {
    const top = 8;
    const bottom = 1.2; // stops above the road: the car gets squashed, not pushed through the road
    const blockH = 2.4;
    const depth = 7;
    const base = yawQuat(c.yaw);
    for (const x of [-12.2, 12.2]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.6, top + blockH + 1.6, 1.6), this.mats.dark);
      pillar.position.copy(local(c, x, (top + blockH + 1.6) / 2 - 1.2, z));
      pillar.quaternion.copy(base);
      this.b.addDecor(pillar);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 1.4, 2), this.mats.hazard);
    beam.position.copy(local(c, 0, top + blockH + 0.9, z));
    beam.quaternion.copy(base);
    this.b.addDecor(beam);

    const blocks = split ? [{ x: -5.5, w: 10.8, ph: 0 }, { x: 5.5, w: 10.8, ph: 0.5 }] : [{ x: 0, w: 22, ph: 0 }];
    for (const bl of blocks) {
      const { geo, materials } = this.b.boxGeometry(new THREE.Vector3(bl.w, blockH, depth), 'dark', 'danger', 'hazard');
      const mesh = new THREE.Mesh(geo, materials);
      // cycle: up (45%) -> slam down (12%) -> hold (15%) -> rise (28%)
      const heightAt = (t: number) => {
        let u = ((t / period + phase + bl.ph) % 1 + 1) % 1;
        if (u < 0.45) return top;
        u -= 0.45;
        if (u < 0.12) {
          const k = u / 0.12;
          return top - (top - bottom) * k * k;
        }
        u -= 0.12;
        if (u < 0.15) return bottom;
        u -= 0.15;
        const k = u / 0.28;
        return bottom + (top - bottom) * k * k * (3 - 2 * k);
      };
      this.b.addKinematic(
        mesh,
        (t, p, q) => {
          p.copy(local(c, bl.x, heightAt(t) + blockH / 2, z));
          q.copy(base);
        },
        [RAPIER.ColliderDesc.cuboid(bl.w / 2, blockH / 2, depth / 2)],
      );
    }
  }

  /** Platform sliding sideways (or up/down) across a gap. */
  movingPlatform(base: THREE.Vector3, yaw: number, size: THREE.Vector3, amp: number, period: number, phase: number, vertical: boolean) {
    const { geo, materials } = this.b.boxGeometry(size, 'plate', 'hazard');
    const mesh = new THREE.Mesh(geo, materials);
    const axis = vertical ? Y : rightOf(yaw);
    const q = yawQuat(yaw);
    const w = (Math.PI * 2) / period;
    this.b.addKinematic(
      mesh,
      (t, p, qq) => {
        p.copy(base).addScaledVector(axis, amp * Math.sin(w * t + phase));
        qq.copy(q);
      },
      [RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)],
    );
  }

  /** Big rotating disc ("spinner") with optional pillars riding on it. */
  carousel(center: THREE.Vector3, radius: number, omega: number, pillars: { r: number; a: number }[]) {
    const H = 1.5;
    const group = new THREE.Group();
    const { geo, materials } = this.b.cylinderGeometry(radius, H, 'plate', 'hazard');
    const disc = new THREE.Mesh(geo, materials);
    disc.position.y = -H / 2;
    group.add(disc);
    // radial stripes make the rotation readable
    for (let k = 0; k < 6; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, radius - 2.5), this.mats.orange);
      const a = (k / 6) * Math.PI * 2;
      s.position.set(Math.sin(a) * (radius / 2 + 0.8), 0.02, Math.cos(a) * (radius / 2 + 0.8));
      s.rotation.y = a;
      group.add(s);
    }
    const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.1, 24), this.mats.danger);
    hubCap.position.y = 0.05;
    group.add(hubCap);
    const colliders: RAPIER.ColliderDesc[] = [RAPIER.ColliderDesc.cylinder(H / 2, radius).setTranslation(0, -H / 2, 0)];
    for (const pl of pillars) {
      const x = Math.sin(pl.a) * pl.r;
      const zz = Math.cos(pl.a) * pl.r;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.6, 16), this.mats.danger);
      m.position.set(x, 1.3, zz);
      group.add(m);
      colliders.push(RAPIER.ColliderDesc.cylinder(1.3, 1.1).setTranslation(x, 1.3, zz));
    }
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 18, 16), this.mats.dark);
    column.position.copy(center).add(new THREE.Vector3(0, -10, 0));
    this.b.addDecor(column);
    this.b.addKinematic(
      group,
      (t, p, q) => {
        p.copy(center);
        q.setFromAxisAngle(Y, omega * t);
      },
      colliders,
    );
  }

  /** Propeller spinning inside a ring in a jump's flight path. */
  ringPropeller(center: THREE.Vector3, yaw: number, omega: number, blades: number) {
    this.ring(center, yaw, 11.5, 0x1d6fe0);
    const group = new THREE.Group();
    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.2, 20), this.mats.danger);
    hubMesh.rotation.x = Math.PI / 2;
    group.add(hubMesh);
    const colliders: RAPIER.ColliderDesc[] = [];
    for (let k = 0; k < blades; k++) {
      const a = (k / blades) * Math.PI * 2;
      const rq = new THREE.Quaternion().setFromAxisAngle(Z, a);
      const off = new THREE.Vector3(0, 5.6, 0).applyQuaternion(rq);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9.2, 0.5), this.mats.danger);
      blade.position.copy(off);
      blade.quaternion.copy(rq);
      group.add(blade);
      colliders.push(RAPIER.ColliderDesc.cuboid(0.6, 4.6, 0.25).setTranslation(off.x, off.y, off.z).setRotation(rq));
    }
    const base = yawQuat(yaw);
    const spin = new THREE.Quaternion();
    this.b.addKinematic(
      group,
      (t, p, q) => {
        p.copy(center);
        spin.setFromAxisAngle(Z, omega * t);
        q.copy(base).multiply(spin);
      },
      colliders,
    );
  }

  finishLine(c: Cursor, z: number, width: number) {
    this.gate(c, z, width, 'ФИНИШ', true);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(width, 2.4), this.mats.checker);
    line.rotation.x = -Math.PI / 2;
    const lineGroup = new THREE.Group();
    lineGroup.add(line);
    lineGroup.position.copy(local(c, 0, 0.03, z));
    lineGroup.quaternion.copy(yawQuat(c.yaw));
    this.b.addDecor(lineGroup);
    this.finish = new BoxTrigger(local(c, 0, 3, z), new THREE.Vector3(width / 2, 5, 1.8), c.yaw);
    this.finishPoint = local(c, 0, 3, z);
  }
}

