import * as THREE from 'three';

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export type CamMode = 0 | 1 | 2; // chase, far chase, bonnet

/** GTA-like chase camera with mouse orbit, speed FOV and impact shake. */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 0;
  private yaw = 0;
  private pitch = 0.18;
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbitIdle = 10;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private shake = 0;
  private initialized = false;
  frozen = false; // stop following (falling off the track)

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 12000);
  }

  cycle() {
    this.mode = ((this.mode + 1) % 3) as CamMode;
    this.initialized = false;
  }

  addShake(a: number) {
    this.shake = Math.min(1.2, this.shake + a);
  }

  orbit(dx: number, dy: number) {
    if (dx === 0 && dy === 0) return;
    this.orbitYaw -= dx * 0.005;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.004, -0.25, 1.0);
    this.orbitIdle = 0;
  }

  snap() {
    this.initialized = false;
  }

  update(dt: number, carPos: THREE.Vector3, carQuat: THREE.Quaternion, vel: THREE.Vector3, airborne: boolean) {
    const cam = this.camera;
    const speed = vel.length();
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(carQuat);

    if (this.frozen) {
      this.look.lerp(carPos, 1 - Math.exp(-dt * 6));
      cam.lookAt(this.look);
      return;
    }

    if (this.mode === 2) {
      // bonnet cam
      const p = new THREE.Vector3(0, 0.62, 0.35).applyQuaternion(carQuat).add(carPos);
      cam.position.copy(p);
      const target = p.clone().add(fwd.clone().multiplyScalar(10));
      cam.up.copy(up);
      cam.lookAt(target);
      cam.up.set(0, 1, 0);
      this.setFov(dt, speed, 72);
      return;
    }

    // heading: car forward on the ground plane; in the air (or tumbling) prefer velocity direction
    let heading = Math.atan2(fwd.x, fwd.z);
    const flatVel = new THREE.Vector3(vel.x, 0, vel.z);
    if ((airborne || up.y < 0.3) && flatVel.length() > 6) heading = Math.atan2(flatVel.x, flatVel.z);
    // reversing: keep looking forward of the car (GTA-like)
    if (!this.initialized) {
      this.yaw = heading;
      this.initialized = true;
      this.pos.set(Infinity, 0, 0);
    }
    this.yaw = lerpAngle(this.yaw, heading, 1 - Math.exp(-dt * (airborne ? 1.8 : 3.2)));

    this.orbitIdle += dt;
    if (this.orbitIdle > 1.6) {
      this.orbitYaw = lerpAngle(this.orbitYaw, 0, 1 - Math.exp(-dt * 2.5));
      this.orbitPitch += (0 - this.orbitPitch) * (1 - Math.exp(-dt * 2.5));
    }

    const far = this.mode === 1;
    const dist = (far ? 9.5 : 6.4) + Math.min(2.5, speed * 0.03);
    const height = far ? 3.2 : 2.1;
    const yaw = this.yaw + this.orbitYaw;
    const pitch = this.pitch + this.orbitPitch;
    const back = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const desired = carPos.clone().addScaledVector(back, dist).add(new THREE.Vector3(0, height - Math.sin(pitch) * dist * 0.5, 0));
    if (!isFinite(this.pos.x)) this.pos.copy(desired);
    // stiff follow (keeps up at high speed) but smooth vertically
    const k = 1 - Math.exp(-dt * 10);
    this.pos.x += (desired.x - this.pos.x) * k;
    this.pos.z += (desired.z - this.pos.z) * k;
    this.pos.y += (desired.y - this.pos.y) * (1 - Math.exp(-dt * 6));
    // never lag too far behind
    const off = this.pos.clone().sub(carPos);
    const maxD = dist * 1.6;
    if (off.length() > maxD) this.pos.copy(carPos).addScaledVector(off.normalize(), maxD);

    const lookTarget = carPos.clone().add(new THREE.Vector3(0, 0.9, 0)).addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 2.5);
    this.look.copy(lookTarget);

    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shake *= Math.exp(-dt * 7);
    }
    cam.lookAt(this.look);
    this.setFov(dt, speed, 60);
  }

  /** 0..1 nitro kick: widens the view a little more. */
  boost = 0;

  private setFov(dt: number, speed: number, base: number) {
    const target = base + Math.min(22, speed * 0.28) + 9 * this.boost;
    this.camera.fov += (target - this.camera.fov) * (1 - Math.exp(-dt * 3));
    this.camera.updateProjectionMatrix();
  }
}
