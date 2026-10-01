import * as THREE from 'three';

/**
 * Pure track geometry (no rendering, no physics). Used both by the level generator (to lay out
 * and validate a level without building it) and by the builders (to extrude the real meshes),
 * so the planned centre line and the built road are always identical.
 *
 * Conventions: Y up. A cursor heading `yaw` drives along dirOf(yaw) = (sin yaw, 0, cos yaw);
 * yaw 0 = +Z. Increasing yaw turns LEFT, a right turn decreases yaw.
 * Local coordinates relative to a cursor: x = right, y = up, z = forward.
 */

export interface Frame {
  p: THREE.Vector3;
  t: THREE.Vector3; // forward
  u: THREE.Vector3; // up
  r: THREE.Vector3; // right
  d: number; // distance along path
}

/** Where a segment starts / ends: point on the road surface (centre line) + heading. */
export interface Cursor {
  p: THREE.Vector3;
  yaw: number;
}

export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const dirOf = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
export const rightOf = (yaw: number) => new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));

/** Local (x right, y up, z forward) -> world, relative to a cursor. */
export function local(c: Cursor, x: number, y: number, z: number) {
  return c.p.clone().addScaledVector(rightOf(c.yaw), x).add(new THREE.Vector3(0, y, 0)).addScaledVector(dirOf(c.yaw), z);
}

export function yawQuat(yaw: number) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

/** Build frames from sampled points and up vectors (tangents by finite differences). */
export function framesFromPoints(ps: THREE.Vector3[], ups: THREE.Vector3[]): Frame[] {
  const out: Frame[] = [];
  let d = 0;
  for (let i = 0; i < ps.length; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.subVectors(ps[1], ps[0]);
    else if (i === ps.length - 1) t.subVectors(ps[i], ps[i - 1]);
    else t.subVectors(ps[i + 1], ps[i - 1]);
    t.normalize();
    const r = new THREE.Vector3().crossVectors(t, ups[i]).normalize();
    const u = new THREE.Vector3().crossVectors(r, t).normalize();
    if (i > 0) d += ps[i].distanceTo(ps[i - 1]);
    out.push({ p: ps[i].clone(), t, u, r, d });
  }
  return out;
}

/** Straight (optionally height-profiled) path. heightFn(z) gives y offset. */
export function lineFrames(c: Cursor, length: number, step = 2, heightFn?: (z: number) => number, lateralFn?: (z: number) => number) {
  const n = Math.max(1, Math.ceil(length / step));
  const ps: THREE.Vector3[] = [];
  const ups: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const z = (i / n) * length;
    ps.push(local(c, lateralFn ? lateralFn(z) : 0, heightFn ? heightFn(z) : 0, z));
    ups.push(new THREE.Vector3(0, 1, 0));
  }
  return framesFromPoints(ps, ups);
}

/** Smooth spline path with automatic banking in turns. Points are in cursor-local coords. */
export function splineFrames(c: Cursor, localPts: [number, number, number][], spacing = 2, bankGain = 9, maxBank = 0.3) {
  const pts = localPts.map(([x, y, z]) => local(c, x, y, z));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const n = Math.ceil(len / spacing);
  const ps: THREE.Vector3[] = [];
  const yaws: number[] = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    const t = curve.getTangentAt(i / n);
    ps.push(p);
    yaws.push(Math.atan2(t.x, t.z));
  }
  const banks: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = yaws[Math.max(0, i - 2)];
    const b = yaws[Math.min(n, i + 2)];
    let dy = b - a;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const ds = (Math.min(n, i + 2) - Math.max(0, i - 2)) * (len / n);
    banks.push(THREE.MathUtils.clamp((-dy / ds) * bankGain, -maxBank, maxBank));
  }
  const sm: number[] = [];
  for (let i = 0; i <= n; i++) {
    let s = 0;
    let cnt = 0;
    for (let j = -6; j <= 6; j++) {
      const k = i + j;
      if (k < 0 || k > n) continue;
      s += banks[k];
      cnt++;
    }
    const edge = Math.min(1, i / 6, (n - i) / 6);
    sm.push((s / cnt) * edge);
  }
  const ups = ps.map((_, i) => {
    const t = curve.getTangentAt(i / n);
    const u = new THREE.Vector3(0, 1, 0).addScaledVector(t, -t.y).normalize();
    return u.applyAxisAngle(t, sm[i]);
  });
  return framesFromPoints(ps, ups);
}

export function endCursor(frames: Frame[]): Cursor {
  const f = frames[frames.length - 1];
  return { p: f.p.clone(), yaw: Math.atan2(f.t.x, f.t.z) };
}

/** Sample points of frames for footprints / autopilot paths. */
export function samplePath(frames: Frame[], every = 2) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < frames.length; i += every) out.push(frames[i].p.clone());
  if ((frames.length - 1) % every !== 0) out.push(frames[frames.length - 1].p.clone());
  return out;
}

/** Straight line of points (for pads / gaps where no frames exist). */
export function linePoints(c: Cursor, z0: number, z1: number, step = 4, y = 0) {
  const out: THREE.Vector3[] = [];
  const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / step));
  for (let i = 0; i <= n; i++) out.push(local(c, 0, y, z0 + ((z1 - z0) * i) / n));
  return out;
}

/**
 * Teardrop helix loop frames (pure). r(phi) = a + b*cos(phi): large radius at the bottom, small at
 * the top. The lateral offset grows linearly with arc length (a geodesic of the generalised
 * cylinder) and the loop plane is turned by atan(k) against the approach, so the car goes round
 * without steering. `side` = +1 shifts to the right, -1 to the left.
 */
export function loopFrames(c: Cursor, a: number, b: number, side: 1 | -1, k = 0.26) {
  const yawL = c.yaw + side * Math.atan(k);
  const L: Cursor = { p: c.p, yaw: yawL };
  const N = 240;
  const ps: THREE.Vector3[] = [];
  const ups: THREE.Vector3[] = [];
  const dir = dirOf(yawL);
  let z = 0;
  let y = 0;
  let s = 0;
  const dphi = (Math.PI * 2) / N;
  for (let i = 0; i <= N; i++) {
    const phi = i * dphi;
    if (i > 0) {
      const pm = phi - dphi / 2;
      const r = a + b * Math.cos(pm);
      z += r * Math.cos(pm) * dphi;
      y += r * Math.sin(pm) * dphi;
      s += r * dphi;
    }
    ps.push(local(L, side * k * s, y, z));
    ups.push(new THREE.Vector3(0, Math.cos(phi), 0).addScaledVector(dir, -Math.sin(phi)).normalize());
  }
  const frames = framesFromPoints(ps, ups);
  const exit: Cursor = { p: local(L, side * k * s, 0, z), yaw: c.yaw };
  return { frames, exit };
}
