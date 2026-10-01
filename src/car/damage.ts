import * as THREE from 'three';
import type { CarModel, CarPart } from './carModel';

interface DeformData {
  mesh: THREE.Mesh;
  pos: THREE.BufferAttribute;
  orig: Float32Array;
  noise: Float32Array; // per vertex: strength scale + crumple direction (xyz)
  center: THREE.Vector3;
  radius: number;
  dirty: boolean;
  part?: CarPart;
}

function hash(x: number, y: number, z: number, k: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + k * 19.19) * 43758.5453;
  return s - Math.floor(s);
}

/** Max distance a vertex may travel from its factory position. */
const MAX_DEFORM = 0.62;

export interface DamageListener {
  onPartDetached(part: CarPart): void;
  onGlassShattered(part: CarPart): void;
  onGlassCracked(part: CarPart): void;
  onLightBroken(part: CarPart): void;
}

/**
 * Soft-body-ish damage: vertices around an impact are pushed along the impact direction with a
 * smooth falloff plus per-vertex noise (crumpled metal). Because the displacement is a pure
 * function of vertex position, coincident vertices of different meshes stay welded together.
 */
export class CarDamage {
  private data: DeformData[] = [];
  condition = 100; // shown on HUD
  engineHealth = 100;
  listener?: DamageListener;

  constructor(private model: CarModel) {
    for (const mesh of model.deformables) {
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const orig = new Float32Array(pos.array as Float32Array);
      const noise = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) {
        const x = orig[i * 3], y = orig[i * 3 + 1], z = orig[i * 3 + 2];
        const qx = Math.round(x * 1000) / 1000, qy = Math.round(y * 1000) / 1000, qz = Math.round(z * 1000) / 1000;
        noise[i * 4] = 0.65 + hash(qx, qy, qz, 0) * 0.7;
        noise[i * 4 + 1] = hash(qx, qy, qz, 1) * 2 - 1;
        noise[i * 4 + 2] = hash(qx, qy, qz, 2) * 2 - 1;
        noise[i * 4 + 3] = hash(qx, qy, qz, 3) * 2 - 1;
      }
      mesh.geometry.computeBoundingSphere();
      const bs = mesh.geometry.boundingSphere!;
      (pos as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      this.data.push({
        mesh,
        pos,
        orig,
        noise,
        center: bs.center.clone(),
        radius: bs.radius,
        dirty: false,
        part: model.parts.find((p) => p.mesh === mesh),
      });
    }
  }

  /**
   * Apply an impact in body space.
   * @param p contact point (body space)
   * @param dir unit direction pointing INTO the car (body space)
   * @param speed closing speed along the normal, m/s
   * @returns damage points dealt
   */
  impact(p: THREE.Vector3, dir: THREE.Vector3, speed: number): number {
    const excess = speed - 2.5;
    if (excess <= 0) return 0;
    let depth = Math.min(0.42, excess * 0.042);
    if (dir.y > 0.75) depth *= 0.5; // landings mostly load the suspension/underbody
    const radius = 0.45 + Math.min(0.85, excess * 0.065);
    this.deform(p, dir, depth, radius);
    this.damageParts(p, radius, excess * 8.5);
    const pts = excess * 2.2;
    this.condition = Math.max(0, this.condition - pts);
    if (p.z > 0.9) this.engineHealth = Math.max(0, this.engineHealth - excess * 1.6);
    return pts;
  }

  /** Continuous crushing (e.g. a propeller blade pressing the car): depth in metres for this step. */
  crush(p: THREE.Vector3, dir: THREE.Vector3, depth: number) {
    if (depth <= 0) return;
    this.deform(p, dir, Math.min(0.08, depth), 0.95);
    this.damageParts(p, 0.95, depth * 340);
    this.condition = Math.max(0, this.condition - depth * 40);
    this.engineHealth = Math.max(0, this.engineHealth - depth * 25);
  }

  private deform(p: THREE.Vector3, dir: THREE.Vector3, depth: number, radius: number) {
    const r2 = radius * radius;

    for (const d of this.data) {
      if (d.part?.gone) continue;
      if (d.center.distanceTo(p) > d.radius + radius) continue;
      const arr = d.pos.array as Float32Array;
      const { orig, noise } = d;
      let touched = false;
      for (let i = 0, n = d.pos.count; i < n; i++) {
        const i3 = i * 3;
        const cx = arr[i3], cy = arr[i3 + 1], cz = arr[i3 + 2];
        const dx = cx - p.x, dy = cy - p.y, dz = cz - p.z;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd >= r2) continue;
        const f = 1 - Math.sqrt(dd) / radius;
        const w = f * f * (3 - 2 * f);
        const i4 = i * 4;
        const amt = depth * w * noise[i4];
        let nx = cx + (dir.x + noise[i4 + 1] * 0.35) * amt;
        let ny = cy + (dir.y + noise[i4 + 2] * 0.35) * amt;
        let nz = cz + (dir.z + noise[i4 + 3] * 0.35) * amt;
        const ox = nx - orig[i3], oy = ny - orig[i3 + 1], oz = nz - orig[i3 + 2];
        const ol = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (ol > MAX_DEFORM) {
          const s = MAX_DEFORM / ol;
          nx = orig[i3] + ox * s;
          ny = orig[i3 + 1] + oy * s;
          nz = orig[i3 + 2] + oz * s;
        }
        arr[i3] = nx;
        arr[i3 + 1] = ny;
        arr[i3 + 2] = nz;
        touched = true;
      }
      if (touched) d.dirty = true;
    }
  }

  private damageParts(p: THREE.Vector3, radius: number, amount: number) {
    for (const part of this.model.parts) {
      if (part.gone) continue;
      const eff = Math.max(0, part.center.distanceTo(p) - part.radius * 0.7);
      const reach = radius + 0.3;
      if (eff > reach) continue;
      const dmg = amount * (1 - eff / reach);
      part.health -= dmg;
      if (part.kind === 'window') {
        if (!part.broken && part.health < part.maxHealth * 0.6) {
          part.broken = true;
          part.mesh.material = part.brokenMaterial!;
          this.listener?.onGlassCracked(part);
        }
        if (part.health <= 0) {
          part.gone = true;
          part.mesh.visible = false;
          this.listener?.onGlassShattered(part);
        }
      } else if (part.kind === 'light') {
        if (!part.broken && part.health <= 0) {
          part.broken = true;
          part.mesh.material = part.brokenMaterial!;
          this.listener?.onLightBroken(part);
        }
      } else if (part.kind === 'panel' && part.detachable && part.health <= 0) {
        part.gone = true;
        part.mesh.visible = false;
        this.listener?.onPartDetached(part);
      }
    }
  }

  /** Recompute normals of dented meshes (once per rendered frame). */
  flush() {
    for (const d of this.data) {
      if (!d.dirty) continue;
      d.pos.needsUpdate = true;
      d.mesh.geometry.computeVertexNormals();
      d.dirty = false;
    }
  }

  reset() {
    for (const d of this.data) {
      (d.pos.array as Float32Array).set(d.orig);
      d.pos.needsUpdate = true;
      d.mesh.geometry.computeVertexNormals();
      d.dirty = false;
    }
    for (const p of this.model.parts) {
      p.health = p.maxHealth;
      p.broken = false;
      p.gone = false;
      p.mesh.visible = true;
      p.mesh.material = p.baseMaterial;
    }
    this.condition = 100;
    this.engineHealth = 100;
  }
}
