import * as THREE from 'three';
import { crackTexture } from '../gfx/textures';
import { CAR_GRAVITY_SCALE } from '../core/constants';

/**
 * Procedural sports coupe. Everything is built in "body space" (the chassis rigid body frame):
 * +Z forward, +Y up, +X left. Every visual part that can dent is a direct child of `root`
 * with identity transform, so the deformation code can work purely in body space.
 */
export const CAR = {
  mass: 1650,
  /** Extra gravity on the car only (see core/constants). */
  gravityScale: CAR_GRAVITY_SCALE,
  wheelRadius: 0.34,
  wheelWidth: 0.25,
  wheelX: 0.8,
  frontZ: 1.3,
  rearZ: -1.3,
  mountY: -0.03,
  travel: 0.3,
  /** Height of the body origin above flat ground when the car rests on its wheels. */
  restHeight: 0.6,
  colliderMinY: -0.28,
};

const ZF = 2.08;
const ZR = -2.08;
const CAP = 0.2;
const S_CAP = 0.045;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smooth(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Monotone cubic interpolation (no overshoot). */
function pchip(xs: number[], ys: number[]) {
  const n = xs.length;
  const h: number[] = [];
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h[i] * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h[i] * m[i + 1]
    );
  };
}

// Side silhouette: top of the body along the length.
const yTopF = pchip(
  [-2.08, -1.96, -1.62, -1.18, -0.5, 0.12, 0.92, 1.5, 1.92, 2.08],
  [0.22, 0.37, 0.43, 0.46, 0.78, 0.8, 0.41, 0.32, 0.23, 0.13],
);

interface Slice {
  hw: number;
  yb: number;
  sb: number;
  shoulderY: number;
  hwShoulder: number;
  yTop: number;
  hwTop: number;
  crown: number;
  yc: number;
}

function slice(z: number): Slice {
  const ft = smooth(1.2, 2.08, z);
  const rt = smooth(-1.45, -2.08, z);
  const hw = 0.95 - 0.13 * ft * ft - 0.07 * rt * rt + 0.02 * Math.exp(-(((z + 1.25) / 0.45) ** 2));
  const yb = -0.4 + 0.1 * smooth(1.6, 2.08, z) + 0.09 * smooth(-1.65, -2.08, z);
  const yTop = yTopF(z);
  const belt = 0.37 + 0.04 * smooth(0.3, -1.6, z);
  const shoulderY = Math.min(belt, yTop - 0.025);
  let arch = -Infinity;
  for (const wz of [CAR.frontZ, CAR.rearZ]) {
    const dz = z - wz;
    const Ra = 0.5;
    if (Math.abs(dz) < Ra) arch = Math.max(arch, -0.3 + Math.sqrt(Ra * Ra - dz * dz));
  }
  let sb = Math.max(yb + 0.1, arch);
  sb = Math.min(sb, shoulderY - 0.07);
  const cabin = smooth(-1.35, -1.05, z) * (1 - smooth(0.75, 1.05, z));
  const hwShoulder = hw - 0.035;
  const hwTop = lerp(hwShoulder - 0.03, hwShoulder * 0.72, cabin);
  const crown = 0.025 + 0.02 * cabin;
  const yc = (yb + yTop) * 0.5 - 0.03;
  return { hw, yb, sb, shoulderY, hwShoulder, yTop, hwTop, crown, yc };
}

/** Half cross-section: u=0 bottom centre -> u=1 roof centre. */
function profile(sl: Slice, u: number, out: { x: number; y: number }) {
  const inner = sl.hw - 0.28;
  if (u <= 0.16) {
    const k = u / 0.16;
    out.x = inner * k;
    out.y = sl.yb;
  } else if (u <= 0.26) {
    const k = (u - 0.16) / 0.1;
    if (k < 0.6) {
      out.x = inner;
      out.y = lerp(sl.yb, sl.sb - 0.03, k / 0.6);
    } else {
      const a = ((k - 0.6) / 0.4) * Math.PI * 0.5;
      out.x = inner + 0.28 * Math.sin(a);
      out.y = sl.sb - 0.03 + 0.03 * (1 - Math.cos(a));
    }
  } else if (u <= 0.5) {
    const k = (u - 0.26) / 0.24;
    out.x = lerp(sl.hw, sl.hwShoulder, k) + 0.03 * Math.sin(Math.PI * k);
    out.y = lerp(sl.sb, sl.shoulderY, k);
  } else if (u <= 0.7) {
    const k = (u - 0.5) / 0.2;
    out.x = lerp(sl.hwShoulder, sl.hwTop, k) + 0.012 * Math.sin(Math.PI * k);
    out.y = lerp(sl.shoulderY, sl.yTop, k);
  } else {
    const k = (u - 0.7) / 0.3;
    out.x = sl.hwTop * (1 - k);
    out.y = sl.yTop + sl.crown * Math.sin((k * Math.PI) / 2);
  }
}

const _p = { x: 0, y: 0 };
/** Body surface point. s: 0 (rear tip) .. 1 (front tip). side: +1 left, -1 right. */
export function surf(s: number, u: number, side: number, out: THREE.Vector3) {
  let z: number;
  let zb: number;
  let sc = 1;
  if (s < S_CAP) {
    const phi = (1 - s / S_CAP) * Math.PI * 0.5;
    zb = ZR;
    z = ZR - CAP * Math.sin(phi);
    sc = Math.pow(Math.max(0, Math.cos(phi)), 0.7);
  } else if (s > 1 - S_CAP) {
    const phi = ((s - (1 - S_CAP)) / S_CAP) * Math.PI * 0.5;
    zb = ZF;
    z = ZF + CAP * Math.sin(phi);
    sc = Math.pow(Math.max(0, Math.cos(phi)), 0.7);
  } else {
    zb = z = ZR + ((s - S_CAP) / (1 - 2 * S_CAP)) * (ZF - ZR);
  }
  const sl = slice(zb);
  profile(sl, u, _p);
  if (sc < 1) {
    _p.x *= sc;
    _p.y = sl.yc + (_p.y - sl.yc) * sc;
  }
  return out.set(_p.x * side, _p.y, z);
}

export const sOfZ = (z: number) => S_CAP + ((z - ZR) / (ZF - ZR)) * (1 - 2 * S_CAP);
const sCapF = (deg: number) => 1 - S_CAP + (deg / 90) * S_CAP;
const sCapR = (deg: number) => S_CAP - (deg / 90) * S_CAP;

function makeSList() {
  const list: number[] = [];
  for (let k = 0; k <= 8; k++) list.push((S_CAP * k) / 8);
  for (let k = 1; k <= 84; k++) list.push(S_CAP + ((1 - 2 * S_CAP) * k) / 84);
  for (let k = 1; k <= 8; k++) list.push(1 - S_CAP + (S_CAP * k) / 8);
  return list;
}

const M = 48; // half-ring resolution

function buildBodyGeometry() {
  const sList = makeSList();
  const ring = 2 * M;
  const rows = sList.length;
  const pos = new Float32Array(rows * ring * 3);
  const uv = new Float32Array(rows * ring * 2);
  const v = new THREE.Vector3();
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < ring; j++) {
      let u: number;
      let side: number;
      if (j <= M) {
        u = j / M;
        side = 1;
      } else {
        u = (ring - j) / M;
        side = -1;
      }
      surf(sList[i], u, side, v);
      const k = i * ring + j;
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = v.y;
      pos[k * 3 + 2] = v.z;
      uv[k * 2] = u;
      uv[k * 2 + 1] = sList[i];
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < ring; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = i * ring + ((j + 1) % ring);
      const d = (i + 1) * ring + ((j + 1) % ring);
      idx.push(a, c, b, c, d, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface PatchDef {
  s0: number;
  s1: number;
  u0: number;
  u1: number;
  mode: 'top' | 'bottom' | 'side';
}

/** A sub-patch of the body surface, pushed out along its normals (windows, lights, panels). */
function buildPatch(def: PatchDef, side: number, nS: number, nU: number, offset: number, bodyUV: boolean) {
  const pos: number[] = [];
  const uv: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= nS; i++) {
    const s = lerp(def.s0, def.s1, i / nS);
    for (let j = 0; j <= nU; j++) {
      const c = j / nU;
      let u: number;
      let sd: number;
      if (def.mode === 'top') {
        if (c < 0.5) {
          sd = 1;
          u = def.u0 + (1 - def.u0) * (c / 0.5);
        } else {
          sd = -1;
          u = 1 - (1 - def.u0) * ((c - 0.5) / 0.5);
        }
      } else if (def.mode === 'bottom') {
        if (c < 0.5) {
          sd = -1;
          u = def.u1 * (1 - c / 0.5);
        } else {
          sd = 1;
          u = def.u1 * ((c - 0.5) / 0.5);
        }
      } else {
        sd = side;
        u = side > 0 ? lerp(def.u0, def.u1, c) : lerp(def.u1, def.u0, c);
      }
      surf(s, u, sd, v);
      pos.push(v.x, v.y, v.z);
      if (bodyUV) uv.push(u, s);
      else uv.push(c, i / nS);
    }
  }
  const idx: number[] = [];
  const W = nU + 1;
  for (let i = 0; i < nS; i++)
    for (let j = 0; j < nU; j++) {
      const a = i * W + j;
      const b = (i + 1) * W + j;
      const c = i * W + j + 1;
      const d = (i + 1) * W + j + 1;
      idx.push(a, c, b, c, d, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * offset, p.getY(i) + n.getY(i) * offset, p.getZ(i) + n.getZ(i) * offset);
  }
  g.computeVertexNormals();
  return g;
}

// ---- regions -------------------------------------------------------------------------------
const WINDSHIELD: PatchDef = { s0: sOfZ(0.2), s1: sOfZ(0.9), u0: 0.735, u1: 1, mode: 'top' };
const REAR_WINDOW: PatchDef = { s0: sOfZ(-1.12), s1: sOfZ(-0.52), u0: 0.735, u1: 1, mode: 'top' };
const SIDE_FRONT: PatchDef = { s0: sOfZ(-0.2), s1: sOfZ(0.8), u0: 0.535, u1: 0.685, mode: 'side' };
const SIDE_REAR: PatchDef = { s0: sOfZ(-1.0), s1: sOfZ(-0.32), u0: 0.535, u1: 0.685, mode: 'side' };
const HEADLIGHT: PatchDef = { s0: sOfZ(1.8), s1: sCapF(42), u0: 0.42, u1: 0.73, mode: 'side' };
const TAILLIGHT: PatchDef = { s0: sCapR(42), s1: sOfZ(-1.88), u0: 0.42, u1: 0.73, mode: 'side' };
const FRONT_BUMPER: PatchDef = { s0: sOfZ(1.62), s1: sCapF(86), u0: 0, u1: 0.415, mode: 'bottom' };
const REAR_BUMPER: PatchDef = { s0: sCapR(86), s1: sOfZ(-1.62), u0: 0, u1: 0.415, mode: 'bottom' };
const HOOD: PatchDef = { s0: sOfZ(0.98), s1: sOfZ(1.9), u0: 0.66, u1: 1, mode: 'top' };

// ---- textures ------------------------------------------------------------------------------
const TW = 512;
const TH = 1024;

function rectUV(g: CanvasRenderingContext2D, d: PatchDef, inset = 0) {
  const u0 = d.mode === 'bottom' ? 0 : d.u0;
  const u1 = d.mode === 'top' ? 1 : d.u1;
  const x0 = (u0 + inset) * TW;
  const x1 = (u1 - (d.mode === 'top' ? 0 : inset)) * TW;
  const y0 = (1 - d.s1 + inset * 0.3) * TH;
  const y1 = (1 - d.s0 - inset * 0.3) * TH;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
}

function drawPaint(g: CanvasRenderingContext2D, color: THREE.Color) {
  const hex = '#' + color.getHexString();
  g.fillStyle = hex;
  g.fillRect(0, 0, TW, TH);
  // subtle vertical gradient for "metallic flake" feel
  const grd = g.createLinearGradient(0, 0, TW, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0.25)');
  grd.addColorStop(0.35, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = grd;
  g.fillRect(0, 0, TW, TH);
  // racing stripes
  const lum = color.r * 0.3 + color.g * 0.59 + color.b * 0.11;
  g.fillStyle = lum > 0.55 ? '#16181c' : '#f2f2f2';
  g.fillRect(0.85 * TW, 0, 0.075 * TW, TH);
  // underbody & sills
  g.fillStyle = '#17181b';
  g.fillRect(0, 0, 0.265 * TW, TH);
  g.fillStyle = '#0e0f11';
  g.fillRect(0.265 * TW, 0, 0.02 * TW, TH);
}

function makeCanvasTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

class PaintTextures {
  bodyCanvas = document.createElement('canvas');
  panelCanvas = document.createElement('canvas');
  body: THREE.CanvasTexture;
  panel: THREE.CanvasTexture;
  constructor() {
    this.bodyCanvas.width = this.panelCanvas.width = TW;
    this.bodyCanvas.height = this.panelCanvas.height = TH;
    this.body = makeCanvasTexture(this.bodyCanvas);
    this.panel = makeCanvasTexture(this.panelCanvas);
  }
  paint(color: THREE.Color) {
    const gb = this.bodyCanvas.getContext('2d')!;
    const gp = this.panelCanvas.getContext('2d')!;
    drawPaint(gb, color);
    drawPaint(gp, color);
    // door shut lines
    gb.fillStyle = 'rgba(0,0,0,0.55)';
    for (const z of [0.86, -0.28]) {
      const y = (1 - sOfZ(z)) * TH;
      gb.fillRect(0.28 * TW, y - 1, 0.42 * TW, 2);
    }
    // door handle
    gb.fillStyle = 'rgba(0,0,0,0.45)';
    gb.fillRect(0.45 * TW, (1 - sOfZ(-0.12)) * TH, 0.04 * TW, 10);
    // dark areas under windows / lights (visible when glass breaks)
    gb.fillStyle = '#050607';
    for (const d of [WINDSHIELD, REAR_WINDOW, SIDE_FRONT, SIDE_REAR]) rectUV(gb, d, 0.004);
    gb.fillStyle = '#141414';
    for (const d of [HEADLIGHT, TAILLIGHT]) rectUV(gb, d, 0.004);
    // exposed structure under bumpers / hood
    gb.fillStyle = '#2a2c30';
    for (const d of [FRONT_BUMPER, REAR_BUMPER]) rectUV(gb, d, 0.004);
    gb.fillStyle = '#303338';
    rectUV(gb, HOOD, 0.004);
    gb.fillStyle = '#1c1d20';
    const hy0 = (1 - HOOD.s1) * TH;
    const hy1 = (1 - HOOD.s0) * TH;
    for (let i = 0; i < 4; i++) gb.fillRect(0.72 * TW + i * 34, hy0 + 30, 20, hy1 - hy0 - 60);
    // grille / diffuser on bumper panels
    gp.fillStyle = '#0c0d0f';
    const gy0 = (1 - sCapF(78)) * TH;
    const gy1 = (1 - sCapF(12)) * TH;
    gp.fillRect(0.02 * TW, gy0, 0.3 * TW, gy1 - gy0);
    gp.strokeStyle = 'rgba(120,120,120,0.5)';
    gp.lineWidth = 2;
    for (let x = 0.02 * TW; x < 0.32 * TW; x += 10) {
      gp.beginPath();
      gp.moveTo(x, gy0);
      gp.lineTo(x, gy1);
      gp.stroke();
    }
    const ry0 = (1 - sCapR(12)) * TH;
    const ry1 = (1 - sCapR(78)) * TH;
    gp.fillStyle = '#0c0d0f';
    gp.fillRect(0.02 * TW, ry0, 0.3 * TW, ry1 - ry0);
    this.body.needsUpdate = true;
    this.panel.needsUpdate = true;
  }
}

// ---- parts ---------------------------------------------------------------------------------
export type PartKind = 'window' | 'light' | 'panel' | 'trim';

export interface CarPart {
  name: string;
  kind: PartKind;
  mesh: THREE.Mesh;
  center: THREE.Vector3;
  radius: number;
  detachable: boolean;
  maxHealth: number;
  health: number;
  broken: boolean; // window cracked / light smashed
  gone: boolean; // window shattered / panel detached
  baseMaterial: THREE.Material;
  brokenMaterial?: THREE.Material;
  isBrake?: boolean;
}

export interface WheelVisual {
  pivot: THREE.Group; // steering
  spin: THREE.Group; // rolling
  left: boolean;
  front: boolean;
}

function bakeBox(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d, 2, 1, 2);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

function mergeGeos(geos: THREE.BufferGeometry[]) {
  // tiny merge (positions/normals/uvs/index) to avoid pulling BufferGeometryUtils for 3 boxes
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, vo * 3);
    nor.set(g.attributes.normal.array as Float32Array, vo * 3);
    uv.set(g.attributes.uv.array as Float32Array, vo * 2);
    const gi = g.index!.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function buildWheel(left: boolean, tyreMat: THREE.Material, rimMat: THREE.Material, discMat: THREE.Material, caliperMat: THREE.Material) {
  const R = CAR.wheelRadius;
  const W = CAR.wheelWidth;
  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  pivot.add(spin);
  const holder = new THREE.Group();
  spin.add(holder);
  if (!left) holder.rotation.y = Math.PI; // outer face always points away from the car

  // tyre (lathe around Y, then rotated so the axle is X)
  const hw = W / 2;
  const pts = [
    new THREE.Vector2(R * 0.66, -hw),
    new THREE.Vector2(R * 0.9, -hw),
    new THREE.Vector2(R * 0.97, -hw * 0.9),
    new THREE.Vector2(R, -hw * 0.62),
    new THREE.Vector2(R, hw * 0.62),
    new THREE.Vector2(R * 0.97, hw * 0.9),
    new THREE.Vector2(R * 0.9, hw),
    new THREE.Vector2(R * 0.66, hw),
  ];
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(pts, 36), tyreMat);
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  holder.add(tyre);

  // rim barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.67, R * 0.67, W * 0.86, 28, 1, true), rimMat);
  barrel.rotation.z = Math.PI / 2;
  holder.add(barrel);
  // brake disc (inside)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.03, 28), discMat);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = -0.02;
  holder.add(disc);
  // spokes on the outer face (+X)
  const spokeGeo = new THREE.BoxGeometry(0.035, R * 0.62, 0.06);
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(spokeGeo, rimMat);
    const a = (i / 5) * Math.PI * 2;
    s.position.set(W * 0.38, Math.cos(a) * R * 0.33, Math.sin(a) * R * 0.33);
    s.rotation.x = a;
    holder.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.06, 12), rimMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = W * 0.4;
  holder.add(hub);

  // caliper does not spin: attach to pivot
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.12), caliperMat);
  caliper.position.set(left ? 0.02 : -0.02, R * 0.3, -R * 0.35);
  pivot.add(caliper);
  return { pivot, spin };
}

export class CarModel {
  root = new THREE.Group();
  body: THREE.Mesh;
  parts: CarPart[] = [];
  deformables: THREE.Mesh[] = [];
  wheels: WheelVisual[] = [];
  hullPoints: Float32Array;
  private paint = new PaintTextures();
  private bodyMat: THREE.MeshPhysicalMaterial;
  private panelMat: THREE.MeshPhysicalMaterial;

  constructor(color: THREE.ColorRepresentation) {
    const col = new THREE.Color(color);
    this.paint.paint(col);
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      map: this.paint.body,
      metalness: 0.45,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    this.panelMat = this.bodyMat.clone();
    this.panelMat.map = this.paint.panel;

    const bodyGeo = buildBodyGeometry();
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.addDeformable(this.body);

    // glass
    const crack = crackTexture();
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b0f14,
      metalness: 0.1,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.4,
    });
    const glassCracked = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: crack,
      metalness: 0.1,
      roughness: 0.25,
      envMapIntensity: 0.8,
    });
    const windows: [string, PatchDef, number][] = [
      ['лобовое стекло', WINDSHIELD, 1],
      ['заднее стекло', REAR_WINDOW, 1],
      ['стекло ЛП', SIDE_FRONT, 1],
      ['стекло ПП', SIDE_FRONT, -1],
      ['стекло ЛЗ', SIDE_REAR, 1],
      ['стекло ПЗ', SIDE_REAR, -1],
    ];
    for (const [name, def, side] of windows) {
      const geo = buildPatch(def, side, 14, def.mode === 'top' ? 20 : 6, 0.007, false);
      const mesh = new THREE.Mesh(geo, glassMat);
      this.addPart(name, 'window', mesh, false, 24, glassCracked);
    }

    // lights
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.2 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.8, roughness: 0.2 });
    const brokenLight = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    for (const side of [1, -1]) {
      this.addPart('фара', 'light', new THREE.Mesh(buildPatch(HEADLIGHT, side, 6, 8, 0.006, false), headMat), false, 11, brokenLight);
      const tail = new THREE.Mesh(buildPatch(TAILLIGHT, side, 6, 8, 0.006, false), tailMat.clone());
      const p = this.addPart('стоп-сигнал', 'light', tail, false, 11, brokenLight);
      p.isBrake = true;
    }

    // detachable panels
    this.addPart('передний бампер', 'panel', new THREE.Mesh(buildPatch(FRONT_BUMPER, 1, 12, 36, 0.02, true), this.panelMat), true, 60);
    this.addPart('задний бампер', 'panel', new THREE.Mesh(buildPatch(REAR_BUMPER, 1, 12, 36, 0.02, true), this.panelMat), true, 60);
    this.addPart('капот', 'panel', new THREE.Mesh(buildPatch(HOOD, 1, 16, 24, 0.012, true), this.panelMat), true, 105);

    // spoiler
    const trunkY = yTopF(-1.9);
    const spoilerGeo = mergeGeos([
      bakeBox(1.72, 0.035, 0.3, 0, trunkY + 0.22, -1.93, -0.08),
      bakeBox(0.04, 0.2, 0.12, 0.55, trunkY + 0.1, -1.9),
      bakeBox(0.04, 0.2, 0.12, -0.55, trunkY + 0.1, -1.9),
      bakeBox(0.03, 0.12, 0.34, 0.86, trunkY + 0.22, -1.93),
      bakeBox(0.03, 0.12, 0.34, -0.86, trunkY + 0.22, -1.93),
    ]);
    const carbon = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.4 });
    this.addPart('спойлер', 'panel', new THREE.Mesh(spoilerGeo, carbon), true, 40);

    // mirrors
    for (const side of [1, -1]) {
      const z = 0.7;
      const sl = slice(z);
      const x = (sl.hwShoulder + 0.09) * side;
      const geo = mergeGeos([
        bakeBox(0.14, 0.11, 0.2, x, sl.shoulderY + 0.1, z, 0, 0, 0),
        bakeBox(0.1, 0.03, 0.06, x - 0.07 * side, sl.shoulderY + 0.06, z + 0.02),
      ]);
      this.addPart('зеркало', 'panel', new THREE.Mesh(geo, this.panelMat), true, 14);
    }

    // exhausts
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.18 });
    const exGeos: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      const g = new THREE.CylinderGeometry(0.05, 0.05, 0.22, 14, 1, true);
      g.rotateX(Math.PI / 2);
      g.translate(0.42 * side, -0.28, -2.2);
      exGeos.push(g);
    }
    const exhaust = new THREE.Mesh(mergeGeos(exGeos), chrome);
    exhaust.material.side = THREE.DoubleSide;
    this.addPart('выхлоп', 'trim', exhaust, false, 1000);

    // wheels
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.95, roughness: 0.22 });
    const discMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.8, roughness: 0.45 });
    const caliperMat = new THREE.MeshStandardMaterial({ color: 0xd11f1f, roughness: 0.4 });
    for (const front of [true, false])
      for (const left of [true, false]) {
        const w = buildWheel(left, tyreMat, rimMat, discMat, caliperMat);
        w.pivot.position.set(left ? CAR.wheelX : -CAR.wheelX, CAR.mountY - CAR.travel * 0.7, front ? CAR.frontZ : CAR.rearZ);
        this.root.add(w.pivot);
        this.wheels.push({ pivot: w.pivot, spin: w.spin, left, front });
      }

    // convex hull points for the physics collider (subsampled body vertices)
    const bp = bodyGeo.attributes.position as THREE.BufferAttribute;
    const hull: number[] = [];
    for (let i = 0; i < bp.count; i += 3) {
      // raised floor + overhangs (approach/departure angles) so ramps and loops do not scrape
      const z = bp.getZ(i);
      const floor = CAR.colliderMinY + 0.2 * smooth(1.35, 2.2, Math.abs(z));
      hull.push(bp.getX(i) * 0.985, Math.max(floor, bp.getY(i)), z * 0.99);
    }
    this.hullPoints = new Float32Array(hull);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
  }

  private addDeformable(mesh: THREE.Mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.deformables.push(mesh);
  }

  private addPart(name: string, kind: PartKind, mesh: THREE.Mesh, detachable: boolean, health: number, brokenMaterial?: THREE.Material) {
    mesh.geometry.computeBoundingSphere();
    const bs = mesh.geometry.boundingSphere!;
    this.addDeformable(mesh);
    const part: CarPart = {
      name,
      kind,
      mesh,
      center: bs.center.clone(),
      radius: bs.radius,
      detachable,
      maxHealth: health,
      health,
      broken: false,
      gone: false,
      baseMaterial: mesh.material as THREE.Material,
      brokenMaterial,
    };
    this.parts.push(part);
    return part;
  }

  setColor(color: THREE.ColorRepresentation) {
    this.paint.paint(new THREE.Color(color));
  }

  setBrakeLights(on: boolean) {
    for (const p of this.parts)
      if (p.isBrake && !p.broken) {
        const m = p.mesh.material as THREE.MeshStandardMaterial;
        m.emissiveIntensity = on ? 3.2 : 0.8;
      }
  }
}
