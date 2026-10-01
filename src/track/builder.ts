import * as THREE from 'three';
import { RAPIER, TRACK_GROUPS, movingSurfaces, type MovingSurface } from '../core/physics';
import * as TX from '../gfx/textures';
import { yawQuat, type Frame } from './frames';

export * from './frames';

export type MatKey = 'road' | 'wall' | 'hazard' | 'dark' | 'light' | 'beam' | 'plate' | 'checker' | 'danger' | 'boost' | 'orange' | 'blue';

/** Texture tiling per material: across (0 = stretch 0..1 over the edge) and along (metres per repeat). */
const TILE: Record<MatKey, { across: number; along: number }> = {
  road: { across: 0, along: 12 },
  beam: { across: 0, along: 6 },
  wall: { across: 0, along: 3.2 },
  hazard: { across: 1.2, along: 1.2 },
  dark: { across: 4, along: 4 },
  light: { across: 4, along: 4 },
  plate: { across: 4, along: 4 },
  checker: { across: 2, along: 2 },
  danger: { across: 3, along: 3 },
  boost: { across: 0, along: 6 },
  orange: { across: 4, along: 4 },
  blue: { across: 4, along: 4 },
};

/** Shared materials: created once per game and reused by every level. */
export function createMaterials() {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05, ...o });
  const m: Record<MatKey, THREE.MeshStandardMaterial> = {
    road: std({ map: TX.roadTexture(), roughness: 0.85 }),
    wall: std({ map: TX.chevronTexture(), roughness: 0.6 }),
    hazard: std({ map: TX.hazardTexture(), roughness: 0.6 }),
    dark: std({ color: 0x2c3036, roughness: 0.7, metalness: 0.3 }),
    light: std({ color: 0xe6e8eb, roughness: 0.55 }),
    beam: std({ map: TX.beamTexture(), roughness: 0.75 }),
    plate: std({ map: TX.plateTexture(), roughness: 0.6, metalness: 0.4 }),
    checker: std({ map: TX.checkerTexture(), roughness: 0.6 }),
    danger: std({ map: TX.dangerTexture(), roughness: 0.45, metalness: 0.2 }),
    boost: std({ map: TX.boostTexture(), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.0, roughness: 0.4 }),
    orange: std({ color: 0xff6a00, roughness: 0.5 }),
    blue: std({ color: 0x1d6fe0, roughness: 0.5 }),
  };
  m.boost.emissiveMap = m.boost.map;
  m.boost.emissiveIntensity = 1.4;
  return m;
}
export type Materials = ReturnType<typeof createMaterials>;

export interface ProfileVertex {
  x: number; // along frame.r
  y: number; // along frame.u
  mat: MatKey; // material of the edge starting at this vertex
}

// ---------------------------------------------------------------------------------------------
/** A moving track part driven by an analytic pose(t). The tyre model reads its surface velocity. */
export class Kinematic implements MovingSurface {
  readonly body: RAPIER.RigidBody;
  private p0 = new THREE.Vector3();
  private q0 = new THREE.Quaternion();
  private p1 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private lin = new THREE.Vector3();
  private ang = new THREE.Vector3();

  constructor(
    world: RAPIER.World,
    readonly object: THREE.Object3D,
    readonly pose: (t: number, p: THREE.Vector3, q: THREE.Quaternion) => void,
    colliders: RAPIER.ColliderDesc[],
    readonly cutsThrough = false,
  ) {
    pose(0, this.p0, this.q0);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.p0.x, this.p0.y, this.p0.z).setRotation(this.q0),
    );
    for (const cd of colliders) world.createCollider(cd.setCollisionGroups(TRACK_GROUPS).setFriction(0.9), this.body);
    movingSurfaces.set(this.body.handle, this);
    object.position.copy(this.p0);
    object.quaternion.copy(this.q0);
  }

  /** Set pose for the step [t, t+dt]. */
  prepare(t: number, dt: number) {
    this.pose(t, this.p0, this.q0);
    this.pose(t + dt, this.p1, this.q1);
    this.body.setNextKinematicTranslation(this.p1);
    this.body.setNextKinematicRotation(this.q1);
    this.lin.subVectors(this.p1, this.p0).divideScalar(dt);
    const dq = this.q1.clone().multiply(this.q0.clone().invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const angle = 2 * Math.acos(Math.min(1, dq.w));
    const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    if (s < 1e-6) this.ang.set(0, 0, 0);
    else this.ang.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
  }

  velocityAt(point: THREE.Vector3, out: THREE.Vector3) {
    const r = new THREE.Vector3().subVectors(point, this.p0);
    return out.crossVectors(this.ang, r).add(this.lin);
  }

  renderAt(t: number) {
    this.pose(t, this.object.position, this.object.quaternion);
  }

  dispose(world: RAPIER.World) {
    movingSurfaces.delete(this.body.handle);
    world.removeRigidBody(this.body);
  }
}

/** Oriented box volume for triggers. */
export class BoxTrigger {
  private inv: THREE.Quaternion;
  constructor(readonly center: THREE.Vector3, readonly half: THREE.Vector3, yaw: number) {
    this.inv = yawQuat(yaw).invert();
  }
  contains(p: THREE.Vector3) {
    const l = p.clone().sub(this.center).applyQuaternion(this.inv);
    return Math.abs(l.x) <= this.half.x && Math.abs(l.y) <= this.half.y && Math.abs(l.z) <= this.half.z;
  }
}

// ---------------------------------------------------------------------------------------------
interface Accum {
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}

/**
 * Low-level track construction: meshes + colliders. Everything it creates is tracked so a whole
 * level can be removed with dispose() when another level is loaded.
 */
export class TrackBuilder {
  readonly group = new THREE.Group();
  readonly kinematics: Kinematic[] = [];
  minY = Infinity;
  private colliders: RAPIER.Collider[] = [];
  private owned: THREE.Material[] = [];

  constructor(readonly world: RAPIER.World, readonly mats: Materials) {}

  /** Static collider tracked for disposal. */
  collider(desc: RAPIER.ColliderDesc) {
    const c = this.world.createCollider(desc.setCollisionGroups(TRACK_GROUPS));
    this.colliders.push(c);
    return c;
  }

  /** Mark a per-level material (and its maps) for disposal. */
  own<M extends THREE.Material>(m: M): M {
    this.owned.push(m);
    return m;
  }

  private addTrimesh(pos: Float32Array, idx: Uint32Array) {
    // FIX_INTERNAL_EDGES removes "ghost" contacts on shared triangle edges (cars snagging on walls)
    this.collider(RAPIER.ColliderDesc.trimesh(pos, idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.9).setRestitution(0.05));
    for (let i = 1; i < pos.length; i += 3) this.minY = Math.min(this.minY, pos[i]);
  }

  /** Extrude a closed CCW polygon (in r/u coords) along frames. Returns created meshes (none if mesh: false). */
  extrude(frames: Frame[], profile: ProfileVertex[], opts: { collider?: boolean; mesh?: boolean; caps?: boolean; shadow?: boolean } = {}) {
    const collider = opts.collider ?? true;
    const caps = opts.caps ?? true;
    const byMat = new Map<MatKey, Accum>();
    const colPos: number[] = [];
    const colIdx: number[] = [];
    const acc = (k: MatKey) => {
      let a = byMat.get(k);
      if (!a) byMat.set(k, (a = { pos: [], nor: [], uv: [], idx: [] }));
      return a;
    };
    const tmp = new THREE.Vector3();
    const n = frames.length;
    for (let e = 0; e < profile.length; e++) {
      const P0 = profile[e];
      const P1 = profile[(e + 1) % profile.length];
      const edgeLen = Math.hypot(P1.x - P0.x, P1.y - P0.y);
      if (edgeLen < 1e-5) continue;
      const tile = TILE[P0.mat];
      const u1 = tile.across === 0 ? 1 : edgeLen / tile.across;
      const a = acc(P0.mat);
      const base = a.pos.length / 3;
      const colBase = colPos.length / 3;
      for (let i = 0; i < n; i++) {
        const f = frames[i];
        for (const [P, u] of [
          [P0, 0],
          [P1, u1],
        ] as [ProfileVertex, number][]) {
          tmp.copy(f.p).addScaledVector(f.r, P.x).addScaledVector(f.u, P.y);
          a.pos.push(tmp.x, tmp.y, tmp.z);
          a.nor.push(0, 0, 0);
          a.uv.push(u, f.d / tile.along);
          colPos.push(tmp.x, tmp.y, tmp.z);
        }
      }
      for (let i = 0; i < n - 1; i++) {
        const A = i * 2, B = (i + 1) * 2, C = i * 2 + 1, D = (i + 1) * 2 + 1;
        a.idx.push(base + A, base + B, base + C, base + B, base + D, base + C);
        colIdx.push(colBase + A, colBase + B, colBase + C, colBase + B, colBase + D, colBase + C);
      }
    }
    if (caps) {
      const contour = profile.map((v) => new THREE.Vector2(v.x, v.y));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const [fi, dirSign] of [
        [0, -1],
        [n - 1, 1],
      ] as [number, number][]) {
        const f = frames[fi];
        const a = acc('dark');
        const base = a.pos.length / 3;
        const colBase = colPos.length / 3;
        for (const v of profile) {
          tmp.copy(f.p).addScaledVector(f.r, v.x).addScaledVector(f.u, v.y);
          a.pos.push(tmp.x, tmp.y, tmp.z);
          a.nor.push(0, 0, 0);
          a.uv.push(v.x / 4, v.y / 4);
          colPos.push(tmp.x, tmp.y, tmp.z);
        }
        for (const t of tris) {
          // CCW triangle in (r,u) has world normal r x u = -t; flip to face dirSign * t
          const pa = profile[t[0]], pb = profile[t[1]], pc = profile[t[2]];
          const ccw = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) > 0;
          const flip = (dirSign < 0) !== ccw;
          const tri = flip ? [t[0], t[2], t[1]] : [t[0], t[1], t[2]];
          a.idx.push(base + tri[0], base + tri[1], base + tri[2]);
          colIdx.push(colBase + tri[0], colBase + tri[1], colBase + tri[2]);
        }
      }
    }
    const meshes: THREE.Mesh[] = [];
    if (opts.mesh === false) byMat.clear();
    for (const [k, a] of byMat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      g.setIndex(a.idx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.mats[k]);
      mesh.receiveShadow = true;
      mesh.castShadow = opts.shadow ?? true;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    if (collider) this.addTrimesh(new Float32Array(colPos), new Uint32Array(colIdx));
    return meshes;
  }

  /** Box with tiled UVs. size: x = width (right), y = height, z = length (forward). */
  boxGeometry(size: THREE.Vector3, top: MatKey, side: MatKey, bottom: MatKey = 'dark') {
    const g = new THREE.BoxGeometry(size.x, size.y, size.z);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    // face order: px, nx, py, ny, pz, nz (4 verts each)
    const spans: [number, number, MatKey][] = [
      [size.z, size.y, side],
      [size.z, size.y, side],
      [size.x, size.z, top],
      [size.x, size.z, bottom],
      [size.x, size.y, side],
      [size.x, size.y, side],
    ];
    for (let f = 0; f < 6; f++) {
      const [su, sv, mk] = spans[f];
      const tile = TILE[mk];
      const ku = tile.across === 0 ? 1 : su / tile.across;
      const kv = sv / tile.along;
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        uv.setXY(k, uv.getX(k) * ku, uv.getY(k) * kv);
      }
    }
    const m = this.mats;
    return { geo: g, materials: [m[side], m[side], m[top], m[bottom], m[side], m[side]] };
  }

  /** Cylinder (axis Y) with tiled UVs: materials [side, top, bottom]. */
  cylinderGeometry(radius: number, height: number, topMat: MatKey = 'plate', sideMat: MatKey = 'hazard') {
    const g = new THREE.CylinderGeometry(radius, radius, height, 56, 1);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const circ = Math.PI * 2 * radius;
    const groups = g.groups;
    const sideT = TILE[sideMat];
    const topT = TILE[topMat];
    const seen = new Set<number>();
    for (let gi = 0; gi < 3; gi++) {
      for (let i = groups[gi].start; i < groups[gi].start + groups[gi].count; i++) {
        const vi = (g.index!.array as ArrayLike<number>)[i];
        if (seen.has(vi)) continue;
        seen.add(vi);
        if (gi === 0) uv.setXY(vi, (uv.getX(vi) * circ) / sideT.along, (uv.getY(vi) * height) / sideT.along);
        else uv.setXY(vi, (uv.getX(vi) * 2 * radius) / topT.along, (uv.getY(vi) * 2 * radius) / topT.along);
      }
    }
    const m = this.mats;
    return { geo: g, materials: [m[sideMat], m[topMat], m.dark] };
  }

  addBox(center: THREE.Vector3, size: THREE.Vector3, yaw: number, top: MatKey, side: MatKey, bottom: MatKey = 'dark', collider = true) {
    const { geo, materials } = this.boxGeometry(size, top, side, bottom);
    const mesh = new THREE.Mesh(geo, materials);
    mesh.position.copy(center);
    mesh.quaternion.copy(yawQuat(yaw));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collider) {
      this.collider(
        RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
          .setTranslation(center.x, center.y, center.z)
          .setRotation(yawQuat(yaw))
          .setFriction(0.9),
      );
      this.minY = Math.min(this.minY, center.y - size.y / 2);
    }
    return mesh;
  }

  addKinematic(
    object: THREE.Object3D,
    pose: (t: number, p: THREE.Vector3, q: THREE.Quaternion) => void,
    colliders: RAPIER.ColliderDesc[],
    opts: { cutsThrough?: boolean } = {},
  ) {
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.group.add(object);
    const k = new Kinematic(this.world, object, pose, colliders, opts.cutsThrough);
    this.kinematics.push(k);
    return k;
  }

  addDecor(obj: THREE.Object3D) {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(obj);
    return obj;
  }

  /** Remove every mesh, collider, moving body and per-level material of this level. */
  dispose() {
    for (const k of this.kinematics) k.dispose(this.world);
    this.kinematics.length = 0;
    for (const c of this.colliders) this.world.removeCollider(c, false);
    this.colliders.length = 0;
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const m of this.owned) {
      const mm = m as THREE.MeshStandardMaterial;
      mm.map?.dispose();
      m.dispose();
    }
    this.owned.length = 0;
  }
}
