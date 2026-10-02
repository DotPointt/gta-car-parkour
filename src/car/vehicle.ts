import * as THREE from 'three';
import { RAPIER, CAR_GROUPS, WHEEL_RAY_GROUPS, GRAVITY, movingSurfaces, v3, q4 } from '../core/physics';
import type { DriveInput } from '../core/input';
import { CAR, CarModel, type CarPart } from './carModel';
import { CarDamage, type DamageListener } from './damage';

// ---------------- tuning -------------------------------------------------------------------
const TORQUE_RPM = [800, 1500, 2500, 3500, 4500, 5500, 6500, 7200, 7600];
const TORQUE_NM = [290, 365, 430, 470, 490, 485, 445, 395, 0];
const GEARS = [3.3, 2.25, 1.65, 1.3, 1.08, 0.93];
const REVERSE = 3.1;
const FINAL = 3.9;
const DRIVE_EFF = 0.88;
export const IDLE_RPM = 850;
export const REDLINE = 7250;
const FRONT_DRIVE = 0.4; // AWD split

const SPRING = 52000;
const DAMP_BUMP = 4800;
const DAMP_REBOUND = 6500;
const BUMP_K = 800000;
const ANTIROLL_F = 26000;
const ANTIROLL_R = 18000;

const MU = 1.3;
const G_CAR = GRAVITY * CAR.gravityScale;
const NOMINAL_LOAD = (CAR.mass * G_CAR) / 4;
const BRAKE_TOTAL = 21000;
const BRAKE_FRONT = 0.62;
const HANDBRAKE = 8500;
const ROLL_RES = 55;

const DRAG = 0.46;
const DOWNFORCE = 3.6;
// W/S in the air only nudges the nose (slow and rate-limited); A/D roll stays strong
const AIR_PITCH = 0.4;
const AIR_PITCH_MAX_RATE = 0.3;
const AIR_ROLL = 3.2;
const AIR_MAX_RATE = 3.0;

// arcade drift: the handbrake at speed starts it, throttle + steering hold it
const DRIFT_MIN_SPEED = 12;
/** Below this speed a drift is over (the car has settled). */
const DRIFT_EXIT_SPEED = 8;
/** A drift ends after the car has run straight (small angle, no fast rotation) this long. */
const DRIFT_SETTLE_TIME = 0.3;
/** How fast the steering swings the nose against the direction of travel (rad/s at full lock). */
const DRIFT_SWING = 1.8;
/** Largest slide angle (rad, ~57°): no spinning out. */
const DRIFT_MAX_ANGLE = 1.0;
/** How hard the path bends towards the nose (rad/s per rad of slide angle, full throttle): low = momentum. */
const DRIFT_PULL = 0.8;

const INERTIA = new THREE.Vector3(3000, 3400, 800); // pitch, yaw, roll
/** A blade that cut through the car stays a ghost this many steps after the last contact. */
const GHOST_STEPS = 8;
const COM = new THREE.Vector3(0, -0.2, 0.05);
const WHEELBASE = CAR.frontZ - CAR.rearZ;
const TRACK = CAR.wheelX * 2;

function pacejka(a: number) {
  const B = 10, C = 1.9, E = 0.97;
  const x = B * a;
  return Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
}
function interp(xs: number[], ys: number[], x: number) {
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x <= xs[i + 1]) return ys[i] + ((ys[i + 1] - ys[i]) * (x - xs[i])) / (xs[i + 1] - xs[i]);
  }
  return ys[ys.length - 1];
}
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
function moveTowards(cur: number, target: number, maxDelta: number) {
  if (Math.abs(target - cur) <= maxDelta) return target;
  return cur + Math.sign(target - cur) * maxDelta;
}

interface Wheel {
  local: THREE.Vector3;
  front: boolean;
  left: boolean;
  ray: RAPIER.Ray;
  grounded: boolean;
  dist: number;
  compression: number;
  load: number;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  groundVel: THREE.Vector3;
  // friction solver scratch
  fwd: THREE.Vector3;
  side: THREE.Vector3;
  r: THREE.Vector3;
  mLong: number;
  mLat: number;
  maxImp: number;
  latFactor: number;
  driveImp: number;
  brakeMax: number;
  accLong: number;
  accLat: number;
  wheelspin: number;
  locked: boolean;
  // visuals / fx
  steer: number;
  spinAngle: number;
  spinVel: number;
  slip: number;
  visualY: number;
}

export interface ImpactEvent {
  point: THREE.Vector3; // world
  normal: THREE.Vector3; // world, into the car
  speed: number;
}

export interface VehicleEvents {
  onImpact(e: ImpactEvent): void;
  onPartDetached(part: CarPart): void;
  onGlass(part: CarPart, shattered: boolean): void;
  onLightBroken(part: CarPart): void;
}

// scratch
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _postV = new THREE.Vector3();
const _postW = new THREE.Vector3();
const _postCom = new THREE.Vector3();

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly model: CarModel;
  readonly damage: CarDamage;
  readonly wheels: Wheel[] = [];

  // state
  gear = 1;
  rpm = IDLE_RPM;
  steerAngle = 0;
  private shiftTimer = 0;
  private reverseTimer = 0;
  airTime = 0;
  groundedCount = 0;
  lastGroundY = 0;
  speed = 0;
  fwdSpeed = 0;
  throttleOut = 0;
  braking = false;
  scrape = 0;
  scrapePoint = new THREE.Vector3();
  /** Speed at which a moving obstacle is currently pressing into the car (0 = none). */
  crushing = 0;
  /** 0..1, how much the car is in an (assisted) drift. */
  drift = 0;
  /** Is a drift running (started by the handbrake, ends when the car settles). */
  drifting = false;
  /** How long the car has been running straight and calm during a drift. */
  private driftSettled = 0;
  /** Body slip angle (rad, + = sliding to the left of the nose). */
  slip = 0;
  /** Average velocity of the surface under the wheels (moving platforms, carousel). */
  private groundV = new THREE.Vector3();
  /**
   * Kinematic bodies that currently cut through the car instead of pushing it: body handle -> steps
   * left. Pass `hooks` to world.step() so the solver skips their impulses (contacts are still reported).
   */
  private ghosts = new Map<number, number>();
  readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (_c1, _c2, b1, b2) =>
      this.ghosts.has(b1) || this.ghosts.has(b2) ? RAPIER.SolverFlags.EMPTY : RAPIER.SolverFlags.COMPUTE_IMPULSE,
    filterIntersectionPair: () => true,
  };
  private engineBrake = 0;

  // kinematics (world)
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly v = new THREE.Vector3();
  readonly w = new THREE.Vector3();
  readonly com = new THREE.Vector3();
  readonly up = new THREE.Vector3();
  readonly fwd = new THREE.Vector3();
  readonly left = new THREE.Vector3();

  // pre-step copies for impact speed evaluation
  private preV = new THREE.Vector3();
  private preW = new THREE.Vector3();
  private preCom = new THREE.Vector3();

  // interpolation
  readonly prevPos = new THREE.Vector3();
  readonly currPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly currQuat = new THREE.Quaternion();

  constructor(private world: RAPIER.World, color: THREE.ColorRepresentation, private events: VehicleEvents) {
    this.model = new CarModel(color);
    this.damage = new CarDamage(this.model);
    const listener: DamageListener = {
      onPartDetached: (p) => this.events.onPartDetached(p),
      onGlassCracked: (p) => this.events.onGlass(p, false),
      onGlassShattered: (p) => this.events.onGlass(p, true),
      onLightBroken: (p) => this.events.onLightBroken(p),
    };
    this.damage.listener = listener;

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(CAR.mass, COM, INERTIA, { x: 0, y: 0, z: 0, w: 1 })
        .setCanSleep(false)
        .setGravityScale(CAR.gravityScale)
        .setCcdEnabled(true)
        .setLinearDamping(0)
        .setAngularDamping(0.05),
    );
    const hull = RAPIER.ColliderDesc.convexHull(this.model.hullPoints)!;
    this.collider = world.createCollider(
      hull.setDensity(0).setFriction(0.35).setRestitution(0.0).setCollisionGroups(CAR_GROUPS).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS),
      this.body,
    );

    for (const front of [true, false])
      for (const left of [true, false]) {
        const local = new THREE.Vector3(left ? CAR.wheelX : -CAR.wheelX, CAR.mountY, front ? CAR.frontZ : CAR.rearZ);
        this.wheels.push({
          local,
          front,
          left,
          ray: new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
          grounded: false,
          dist: 0,
          compression: 0,
          load: 0,
          point: new THREE.Vector3(),
          normal: new THREE.Vector3(0, 1, 0),
          groundVel: new THREE.Vector3(),
          fwd: new THREE.Vector3(),
          side: new THREE.Vector3(),
          r: new THREE.Vector3(),
          mLong: 0,
          mLat: 0,
          maxImp: 0,
          latFactor: 1,
          driveImp: 0,
          brakeMax: 0,
          accLong: 0,
          accLat: 0,
          wheelspin: 0,
          locked: false,
          steer: 0,
          spinAngle: 0,
          spinVel: 0,
          slip: 0,
          visualY: CAR.mountY - CAR.travel * 0.7,
        });
      }
  }

  // ---------------------------------------------------------------------------------------
  reset(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.body.setTranslation(pos, true);
    this.body.setRotation(quat, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.prevPos.copy(pos);
    this.currPos.copy(pos);
    this.prevQuat.copy(quat);
    this.currQuat.copy(quat);
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.steerAngle = 0;
    this.shiftTimer = 0;
    this.airTime = 0;
    this.lastGroundY = pos.y;
    this.speed = 0;
    this.fwdSpeed = 0;
    for (const w of this.wheels) {
      w.spinVel = 0;
      w.slip = 0;
      w.grounded = false;
    }
    this.damage.reset();
    this.ghosts.clear();
    this.drifting = false;
    this.drift = 0;
    this.model.root.position.copy(pos);
    this.model.root.quaternion.copy(quat);
  }

  // ---------------------------------------------------------------------------------------
  private invInertiaMul(x: THREE.Vector3, out: THREE.Vector3) {
    // I^-1 (world) * x  =  R * diag(1/I) * R^T * x
    _invQ.copy(this.quat).invert();
    out.copy(x).applyQuaternion(_invQ);
    out.set(out.x / INERTIA.x, out.y / INERTIA.y, out.z / INERTIA.z);
    return out.applyQuaternion(this.quat);
  }

  private effMass(n: THREE.Vector3, r: THREE.Vector3) {
    _a.crossVectors(r, n);
    this.invInertiaMul(_a, _b);
    return 1 / (1 / CAR.mass + _a.dot(_b));
  }

  /** Apply impulse J at offset r (from COM) to the local velocity copies. */
  private applyImpulse(J: THREE.Vector3, r: THREE.Vector3) {
    this.v.addScaledVector(J, 1 / CAR.mass);
    _a.crossVectors(r, J);
    this.invInertiaMul(_a, _b);
    this.w.add(_b);
  }

  private pointVel(r: THREE.Vector3, ground: THREE.Vector3, out: THREE.Vector3) {
    return out.crossVectors(this.w, r).add(this.v).sub(ground);
  }

  private readState() {
    const b = this.body;
    v3(b.translation(), this.pos);
    q4(b.rotation(), this.quat);
    v3(b.linvel(), this.v);
    v3(b.angvel(), this.w);
    v3(b.worldCom(), this.com);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
  }

  // ---------------------------------------------------------------------------------------
  /** Called before world.step(). */
  step(dt: number, input: DriveInput, controls: boolean) {
    this.readState();
    const { up, fwd, left } = this;
    const R = CAR.wheelRadius;
    const fwdSpeed = this.v.dot(fwd);
    this.fwdSpeed = fwdSpeed;
    this.speed = this.v.length();

    const tIn = controls ? input.throttle : 0;
    const bIn = controls ? input.brake : 0;
    const sIn = controls ? input.steer : 0;
    const handbrake = controls ? input.handbrake : false;

    // ---- gear selection (automatic with reverse on brake at standstill). "Back" only reverses once
    // the car has (almost) stopped: while it is still moving - a drift included - it is the brake.
    if (this.gear > 0 && bIn > 0.1 && tIn < 0.1 && fwdSpeed < 0.7 && this.speed < 1.5) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.25) {
        this.gear = -1;
        this.reverseTimer = 0;
      }
    } else if (this.gear === -1 && tIn > 0.1 && fwdSpeed > -0.7) {
      this.gear = 1;
      this.reverseTimer = 0;
    } else this.reverseTimer = 0;
    const throttle = this.gear === -1 ? bIn : tIn;
    const brake = this.gear === -1 ? tIn : bIn;
    this.throttleOut = throttle;

    // ---- drift state
    // relative to the surface: riding a carousel or a moving platform is not a slide
    const vFwd = this.v.dot(fwd) - this.groundV.dot(fwd);
    const vLeft = this.v.dot(left) - this.groundV.dot(left);
    const planar = Math.hypot(vFwd, vLeft);
    this.slip = planar > 2 ? Math.atan2(vLeft, Math.max(Math.abs(vFwd), 0.1)) : 0;
    const onGround = this.groundedCount >= 3;
    // the handbrake at speed starts a drift; it ends once the car has settled: slow, or running straight
    // without spinning for a moment (a fast swing through straight to the other side keeps it going)
    if (!this.drifting && handbrake && bIn < 0.1 && onGround && this.gear > 0 && planar > DRIFT_MIN_SPEED) {
      this.drifting = true;
      this.driftSettled = 0;
    }
    if (this.drifting) {
      const calm = Math.abs(this.slip) < 0.1 && Math.abs(this.w.dot(up)) < 0.9;
      this.driftSettled = calm ? this.driftSettled + dt : 0;
      if (this.driftSettled > DRIFT_SETTLE_TIME || planar < DRIFT_EXIT_SPEED || this.gear <= 0 || this.airTime > 0.4) this.drifting = false;
    }
    const wantDrift = this.drifting;
    this.drift = moveTowards(this.drift, wantDrift ? 1 : 0, (wantDrift ? 4 : 2.5) * dt);

    // ---- steering (speed sensitive, rate limited) + Ackermann; drifting allows a full counter-steer
    const maxSteer = Math.max(0.58 / (1 + Math.abs(fwdSpeed) / 13), 0.45 * this.drift);
    this.steerAngle = moveTowards(this.steerAngle, -sIn * maxSteer, (2.8 + 2 * this.drift) * dt);
    const sa = this.steerAngle;
    let steerL = sa;
    let steerR = sa;
    if (Math.abs(sa) > 1e-3) {
      const turnR = WHEELBASE / Math.tan(Math.abs(sa));
      const inner = Math.atan(WHEELBASE / (turnR - TRACK / 2)) * Math.sign(sa);
      const outer = Math.atan(WHEELBASE / (turnR + TRACK / 2)) * Math.sign(sa);
      if (sa > 0) {
        steerL = inner;
        steerR = outer;
      } else {
        steerL = outer;
        steerR = inner;
      }
    }

    // ---- suspension ray casts
    const maxLen = CAR.travel + R;
    let grounded = 0;
    for (const wh of this.wheels) {
      // drifting: the assist steers the slide, the front tyres only follow (no counter-steer kick)
      wh.steer = wh.front ? (wh.left ? steerL : steerR) * (1 - 0.75 * this.drift) : 0;
      _a.copy(wh.local).applyQuaternion(this.quat).add(this.pos);
      wh.ray.origin = { x: _a.x, y: _a.y, z: _a.z };
      wh.ray.dir = { x: -up.x, y: -up.y, z: -up.z };
      const hit = this.world.castRayAndGetNormal(wh.ray, maxLen, true, undefined, WHEEL_RAY_GROUPS, undefined, this.body);
      if (hit) {
        grounded++;
        wh.grounded = true;
        wh.dist = hit.timeOfImpact;
        wh.compression = maxLen - wh.dist;
        wh.point.copy(_a).addScaledVector(up, -wh.dist);
        wh.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        wh.groundVel.set(0, 0, 0);
        const pb = hit.collider.parent();
        if (pb && !pb.isFixed()) movingSurfaces.get(pb.handle)?.velocityAt(wh.point, wh.groundVel);
      } else {
        wh.grounded = false;
        wh.dist = maxLen;
        wh.compression = 0;
        wh.load = 0;
      }
    }
    this.groundedCount = grounded;
    this.groundV.set(0, 0, 0);
    for (const wh of this.wheels) if (wh.grounded) this.groundV.addScaledVector(wh.groundVel, 1 / grounded);
    if (grounded > 0) {
      this.airTime = 0;
      this.lastGroundY = this.pos.y;
    } else this.airTime += dt;

    // ---- engine / gearbox
    const driveForce = this.updateEngine(dt, throttle, fwdSpeed, grounded);

    // ---- suspension forces (spring, damper, bump stop, anti-roll bars)
    const [FL, FR, RL, RR] = this.wheels;
    const arF = (FL.compression - FR.compression) * ANTIROLL_F;
    const arR = (RL.compression - RR.compression) * ANTIROLL_R;
    const bumpStart = CAR.travel * 0.72;
    for (const wh of this.wheels) {
      if (!wh.grounded) continue;
      _c.subVectors(wh.point, this.com);
      this.pointVel(_c, wh.groundVel, _pv);
      const compVel = -_pv.dot(up);
      let F = SPRING * wh.compression + (compVel > 0 ? DAMP_BUMP : DAMP_REBOUND) * compVel;
      if (wh.compression > bumpStart) F += BUMP_K * (wh.compression - bumpStart) + 2500 * Math.max(0, compVel);
      const ar = wh.front ? arF : arR;
      F += wh.left ? ar : -ar;
      F = Math.max(0, F);
      wh.load = F * clamp(wh.normal.dot(up), 0.3, 1);
      _b.copy(up).multiplyScalar(F * dt);
      this.applyImpulse(_b, _c);
    }

    // ---- tyre contact setup
    const autoHold = Math.abs(fwdSpeed) < 0.4 && throttle < 0.05;
    for (const wh of this.wheels) {
      if (!wh.grounded) continue;
      const n = wh.normal;
      const cs = Math.cos(wh.steer);
      const sn = Math.sin(wh.steer);
      wh.fwd.copy(fwd).multiplyScalar(cs).addScaledVector(left, sn);
      wh.fwd.addScaledVector(n, -wh.fwd.dot(n)).normalize();
      wh.side.crossVectors(n, wh.fwd).normalize();
      _a.copy(wh.point).addScaledVector(up, 0.12);
      wh.r.subVectors(_a, this.com);
      wh.mLong = this.effMass(wh.fwd, wh.r);
      wh.mLat = this.effMass(wh.side, wh.r);
      const lr = wh.load / NOMINAL_LOAD;
      const mu = MU * (1 - 0.08 * clamp(lr - 1, -0.5, 2));
      wh.maxImp = mu * wh.load * dt;

      this.pointVel(wh.r, wh.groundVel, _pv);
      const vx = _pv.dot(wh.fwd);
      const vy = _pv.dot(wh.side);
      const alpha = Math.atan2(Math.abs(vy), Math.max(Math.abs(vx), 1.5));
      let lat = Math.max(pacejka(alpha), 1 - smoothstep(2, 6, Math.abs(vx)));
      // a locked rear axle slides, but at walking pace the tyres still hold the car
      if (!wh.front && handbrake) lat *= 1 - 0.58 * smoothstep(4, 12, Math.abs(vx));
      // drifting: the rear steps out easily, the assist below keeps the slide under control
      lat *= 1 - (wh.front ? 0.85 : 0.9) * this.drift;
      wh.latFactor = lat;

      // drive
      const share = wh.front ? FRONT_DRIVE / 2 : (1 - FRONT_DRIVE) / 2;
      // drifting: the engine's push goes along the path (drift assist below), not along the nose
      let dI = driveForce * share * dt * (1 - 0.85 * this.drift);
      const cap = wh.maxImp * 0.96;
      wh.wheelspin = 0;
      if (Math.abs(dI) > cap) {
        wh.wheelspin = (Math.abs(dI) - cap) / (cap + 1e-6);
        dI = Math.sign(dI) * cap;
      }
      wh.driveImp = dI;
      _b.copy(wh.fwd).multiplyScalar(dI);
      this.applyImpulse(_b, wh.r);

      // brakes / resistance
      let bf = (brake * BRAKE_TOTAL * (wh.front ? BRAKE_FRONT : 1 - BRAKE_FRONT)) / 2;
      if (!wh.front && handbrake) bf += HANDBRAKE;
      bf += ROLL_RES + this.engineBrake / 4;
      if (autoHold) bf += 4000;
      wh.brakeMax = bf * dt;
      wh.accLong = 0;
      wh.accLat = 0;
    }

    // ---- sequential-impulse tyre friction (friction circle, static friction, gravity aware)
    const gdt = -G_CAR * dt;
    for (let it = 0; it < 4; it++) {
      for (const wh of this.wheels) {
        if (!wh.grounded) continue;
        // longitudinal (brakes)
        this.pointVel(wh.r, wh.groundVel, _pv);
        const vx = _pv.dot(wh.fwd) + wh.fwd.y * gdt;
        const longRoom = Math.sqrt(Math.max(0, wh.maxImp * wh.maxImp - wh.driveImp * wh.driveImp));
        const lim = Math.min(wh.brakeMax, longRoom);
        let old = wh.accLong;
        wh.accLong = clamp(old - vx * wh.mLong, -lim, lim);
        _b.copy(wh.fwd).multiplyScalar(wh.accLong - old);
        this.applyImpulse(_b, wh.r);
        // lateral
        this.pointVel(wh.r, wh.groundVel, _pv);
        const vy = _pv.dot(wh.side) + wh.side.y * gdt;
        const used = wh.driveImp + wh.accLong;
        const latMax = Math.sqrt(Math.max(0, wh.maxImp * wh.maxImp - used * used)) * wh.latFactor;
        old = wh.accLat;
        wh.accLat = clamp(old - vy * wh.mLat, -latMax, latMax);
        _b.copy(wh.side).multiplyScalar(wh.accLat - old);
        this.applyImpulse(_b, wh.r);
      }
    }

    // ---- wheel spin (visual) & slip (fx)
    this.braking = brake > 0.1 || (handbrake && controls);
    for (const wh of this.wheels) {
      if (wh.grounded) {
        this.pointVel(wh.r, wh.groundVel, _pv);
        const vx = _pv.dot(wh.fwd);
        const vy = _pv.dot(wh.side);
        wh.locked = Math.abs(vx) > 1.5 && wh.brakeMax > 0 && Math.abs(wh.accLong) >= wh.brakeMax * 0.98 && (brake > 0.5 || (handbrake && !wh.front));
        const spinTarget = wh.locked ? 0 : vx / R + Math.sign(wh.driveImp || 1) * wh.wheelspin * 20;
        wh.spinVel += (spinTarget - wh.spinVel) * Math.min(1, dt * 30);
        wh.slip = Math.abs(vy) + wh.wheelspin * 10 + (wh.locked ? Math.abs(vx) : 0);
      } else {
        const driven = throttle * (this.gear === -1 ? -1 : 1) * 60;
        wh.spinVel += (driven - wh.spinVel) * Math.min(1, dt * (throttle > 0.1 ? 1.5 : 0.4));
        wh.slip = 0;
      }
      wh.spinAngle = (wh.spinAngle + wh.spinVel * dt) % (Math.PI * 2);
    }

    // ---- arcade drift assist. The car keeps its momentum: the path bends only gently towards the nose
    // (more on throttle). The steering swings the nose against the path - into the drift widens the
    // angle, counter-steering narrows it and, held on, swings the car through straight into a drift
    // the other way. Off throttle or braking the angle relaxes and the car straightens up.
    if (this.drift > 0.01 && onGround) {
      const k = this.drift;
      const g = this.groundV;
      const vf = this.v.dot(fwd) - g.dot(fwd);
      const vl = this.v.dot(left) - g.dot(left);
      const vUp = this.v.dot(up);
      const sp = Math.hypot(vf, vl);
      // nose angle relative to the path: + = nose left of where the car is going
      const angle = -Math.atan2(vl, Math.max(Math.abs(vf), 0.1));
      // steering left swings the nose left - on throttle or with the handbrake pulled (handbrake turn)
      let swing = -sIn * DRIFT_SWING;
      if (bIn > 0.1 || (throttle < 0.1 && !handbrake)) swing = -angle * 2.5; // relax towards straight
      // at a shallow angle with the wheel straight the tyres bite again and line the car up
      else if (sIn === 0 && !handbrake && Math.abs(angle) < 0.25) swing = -angle * 2;
      if (Math.abs(angle) > DRIFT_MAX_ANGLE && Math.sign(swing) === Math.sign(angle)) swing = 0;
      const pull = DRIFT_PULL * (0.35 + 0.65 * throttle) * Math.min(1, sp / 15);
      const pathRate = pull * clamp(angle, -0.8, 0.8);
      this.w.addScaledVector(up, (pathRate + swing - this.w.dot(up)) * Math.min(1, dt * 14) * k);
      // rotate the planar velocity by the path rate, keep (on throttle even gain a little) speed
      const turn = pathRate * dt * k;
      // speed: throttle keeps it, a sideways slide on the handbrake scrubs it off
      const scrub = handbrake ? 3 + 4 * Math.min(1, Math.abs(angle)) : 0.6;
      const keep = Math.max(0, sp + (throttle * 2.2 - scrub) * dt * k) / Math.max(sp, 1e-3);
      const c = Math.cos(turn) * keep;
      const sn = Math.sin(turn) * keep;
      // in the (fwd, left) basis a left turn (+) rotates fwd towards left
      const nf = vf * c - vl * sn;
      const nl = vf * sn + vl * c;
      this.v
        .copy(fwd)
        .multiplyScalar(nf)
        .addScaledVector(left, nl)
        .addScaledVector(up, vUp)
        .add(_c.copy(g).addScaledVector(up, -g.dot(up)));
    }

    // ---- aerodynamics
    const sp = this.v.length();
    if (sp > 0.1) this.v.addScaledVector(this.v, (-DRAG * sp * dt) / CAR.mass);
    if (grounded > 0) this.v.addScaledVector(up, (-DOWNFORCE * fwdSpeed * fwdSpeed * dt) / CAR.mass);

    // ---- air control (GTA style: pitch with throttle/brake, roll with steering)
    if (this.airTime > 0.12 && controls) {
      const pitchIn = controls ? input.pitch : 0;
      const rollIn = sIn;
      const pr = this.w.dot(left);
      if (Math.abs(pr) < AIR_PITCH_MAX_RATE || Math.sign(pr) !== Math.sign(pitchIn)) this.w.addScaledVector(left, pitchIn * AIR_PITCH * dt);
      const rr = this.w.dot(fwd);
      if (Math.abs(rr) < AIR_MAX_RATE || Math.sign(rr) !== Math.sign(rollIn)) this.w.addScaledVector(fwd, rollIn * AIR_ROLL * dt);
    }

    this.body.setLinvel(this.v, true);
    this.body.setAngvel(this.w, true);
    this.preV.copy(this.v);
    this.preW.copy(this.w);
    this.preCom.copy(this.com);
  }

  private updateEngine(dt: number, throttle: number, fwdSpeed: number, grounded: number) {
    const R = CAR.wheelRadius;
    const ratio = this.gear === -1 ? -REVERSE : GEARS[this.gear - 1];
    const wheelRpm = ((Math.abs(fwdSpeed) / R) * 60) / (2 * Math.PI);
    let target = wheelRpm * Math.abs(ratio) * FINAL;
    if (this.gear === 1 || this.gear === -1) target = Math.max(target, IDLE_RPM + throttle * 2700);
    if (grounded === 0) target = IDLE_RPM + throttle * (REDLINE + 150 - IDLE_RPM);
    target = Math.max(target, IDLE_RPM);
    this.rpm += (target - this.rpm) * Math.min(1, dt * (grounded ? 14 : 5));

    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (this.gear >= 1 && grounded >= 2) {
      if (this.rpm > 6950 && this.gear < GEARS.length) {
        this.gear++;
        this.shiftTimer = 0.22;
      } else if (this.gear > 1) {
        const lowerRpm = wheelRpm * GEARS[this.gear - 2] * FINAL;
        if (this.rpm < 3300 && lowerRpm < 5400) {
          this.gear--;
          this.shiftTimer = 0.14;
        }
      }
    }

    let T = interp(TORQUE_RPM, TORQUE_NM, this.rpm) * throttle;
    if (this.rpm > REDLINE) T = 0;
    if (this.shiftTimer > 0) T *= 0.08;
    T *= 0.88 + 0.12 * (this.damage.engineHealth / 100);
    this.engineBrake = throttle < 0.05 ? 250 + this.rpm * 0.07 : 0;
    return (T * ratio * FINAL * DRIVE_EFF) / R;
  }

  // ---------------------------------------------------------------------------------------
  /** Called after world.step(): interpolation bookkeeping + contact-driven damage. */
  afterStep() {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    v3(this.body.translation(), this.currPos);
    q4(this.body.rotation(), this.currQuat);

    // Contact impulses are not exposed for trimesh sub-shapes, so collisions are measured the way
    // a crash sensor would: the velocity change of the body at the contact point during the step.
    const b = this.body;
    const postV = v3(b.linvel(), _postV);
    const postW = v3(b.angvel(), _postW);
    const postCom = v3(b.worldCom(), _postCom);
    const dt = this.world.timestep;
    this.scrape *= 0.85;
    this.crushing = 0;
    const impacts: ImpactEvent[] = [];
    const vo = new THREE.Vector3();
    let supported = this.groundedCount > 0;
    const squeeze = { body: -1, press: 1.5, vo: new THREE.Vector3() };
    for (const [h, n] of this.ghosts) {
      if (n <= 1) this.ghosts.delete(h);
      else this.ghosts.set(h, n - 1);
    }
    this.world.contactPairsWith(this.collider, (other) => {
      this.world.contactPair(this.collider, other, (manifold, flipped) => {
        const nc = manifold.numContacts();
        if (nc === 0) return;
        const localPt = new THREE.Vector3();
        let cnt = 0;
        for (let i = 0; i < nc; i++) {
          if (manifold.contactDist(i) > 0.03) continue;
          const lp = flipped ? manifold.localContactPoint2(i) : manifold.localContactPoint1(i);
          if (!lp) continue;
          localPt.add(_a.set(lp.x, lp.y, lp.z));
          cnt++;
        }
        if (cnt === 0) return;
        localPt.multiplyScalar(1 / cnt);
        const n = manifold.normal();
        const dir = new THREE.Vector3(n.x, n.y, n.z);
        if (!flipped) dir.negate(); // now points from the obstacle into the car
        const pt = localPt.clone().applyQuaternion(this.currQuat).add(this.currPos);

        vo.set(0, 0, 0);
        const ob = other.parent();
        if (ob && ob.isKinematic()) movingSurfaces.get(ob.handle)?.velocityAt(pt, vo);
        _c.subVectors(pt, this.preCom);
        const vPre = _pv.crossVectors(this.preW, _c).add(this.preV).sub(vo);
        _c.subVectors(pt, postCom);
        const vPost = _b.crossVectors(postW, _c).add(postV).sub(vo);
        const approach = -vPre.dot(dir);
        const pushed = vPost.dot(dir) - vPre.dot(dir) + G_CAR * dt * dir.y;
        const tangential = _a.copy(vPost).addScaledVector(dir, -vPost.dot(dir)).length();
        if (tangential > 2.5) {
          const s = Math.min(1, (tangential - 2.5) / 10);
          if (s > this.scrape) {
            this.scrape = s;
            this.scrapePoint.copy(pt);
          }
        }
        // underbody touches (landings, loops) need a much harder hit to dent
        const fromBelow = dir.dot(this.up) > 0.7;
        const minApproach = fromBelow ? 5.0 : 2.5;
        if (approach > minApproach && pushed > Math.max(0.6, approach * 0.25)) impacts.push({ point: pt, normal: dir, speed: fromBelow ? approach - 3 : approach });
        // a moving obstacle (propeller blade) pressing into the car keeps crushing it
        if (ob && ob.isKinematic()) {
          const ghost = this.ghosts.has(ob.handle);
          // a blade that cuts through the car stays a ghost while they overlap
          if (ghost) this.ghosts.set(ob.handle, GHOST_STEPS);
          const press = vo.dot(dir);
          if (press > 1.0) {
            _invQ.copy(this.currQuat).invert();
            this.damage.crush(localPt, dir.clone().applyQuaternion(_invQ), (press - 1.0) * dt * 0.38);
            this.crushing = Math.max(this.crushing, press);
            // a low windmill blade swinging down onto the car
            if (!ghost && movingSurfaces.get(ob.handle)?.cutsThrough && dir.y < -0.35 && press > squeeze.press) {
              squeeze.body = ob.handle;
              squeeze.press = press;
              squeeze.vo.copy(vo);
            }
          }
        } else if (dir.y > 0.5) supported = true;
      });
    });

    // A blade swinging down onto a car that stands on the road cannot be resolved by the rigid solver:
    // the car is pinned between an unstoppable kinematic body and the track and gets pushed through
    // the road. Instead the blade cuts through the (crushed) car and sweeps it along its swing.
    // Only for bodies marked cutsThrough: every other obstacle keeps plain rigid contacts.
    if (squeeze.body >= 0 && supported) {
      const sweep = _a.set(squeeze.vo.x, 0, squeeze.vo.z);
      const sp = sweep.length();
      if (sp > 2) {
        this.ghosts.set(squeeze.body, GHOST_STEPS);
        sweep.multiplyScalar(1 / sp);
        const along = postV.dot(sweep);
        if (along < sp) postV.addScaledVector(sweep, sp - along);
        postV.y = Math.max(postV.y, 1.5);
        b.setLinvel(postV, true);
      }
    }

    if (impacts.length) {
      impacts.sort((a, b) => b.speed - a.speed);
      const used: THREE.Vector3[] = [];
      _invQ.copy(this.currQuat).invert();
      for (const e of impacts) {
        if (used.length >= 2) break;
        if (used.some((u) => u.distanceTo(e.point) < 0.8)) continue;
        used.push(e.point);
        const lp = e.point.clone().sub(this.currPos).applyQuaternion(_invQ);
        const ld = e.normal.clone().applyQuaternion(_invQ);
        this.damage.impact(lp, ld, e.speed);
        this.events.onImpact(e);
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  render(alpha: number, dt: number) {
    const root = this.model.root;
    root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const R = CAR.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i];
      const vis = this.model.wheels[i];
      const targetY = CAR.mountY - (wh.grounded ? Math.max(0, wh.dist - R) : CAR.travel);
      wh.visualY += (targetY - wh.visualY) * Math.min(1, dt * 30);
      vis.pivot.position.y = wh.visualY;
      vis.pivot.rotation.y = wh.steer;
      vis.spin.rotation.x = wh.spinAngle;
    }
    this.model.setBrakeLights(this.braking);
    this.damage.flush();
  }

  /** World-space transform of a body-space point (interpolated pose). */
  toWorld(local: THREE.Vector3, out: THREE.Vector3) {
    return out.copy(local).applyQuaternion(this.model.root.quaternion).add(this.model.root.position);
  }

  isUpsideDown() {
    return this.up.y < -0.2;
  }
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
