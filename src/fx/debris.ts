import * as THREE from 'three';
import { RAPIER, DEBRIS_GROUPS, q4, v3 } from '../core/physics';

interface Piece {
  body: RAPIER.RigidBody;
  group: THREE.Group;
  age: number;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currQuat: THREE.Quaternion;
}

const LIFETIME = 14;
const MAX_PIECES = 16;

/** Car parts that got torn off: real rigid bodies that bounce around the track. */
export class Debris {
  private pieces: Piece[] = [];
  constructor(private world: RAPIER.World, private scene: THREE.Scene) {}

  /** `mesh` geometry is in the car body frame; spawn it at the car's current transform. */
  spawn(mesh: THREE.Mesh, carPos: THREE.Vector3, carQuat: THREE.Quaternion, linvel: THREE.Vector3, angvel: THREE.Vector3, kick: THREE.Vector3) {
    const geo = mesh.geometry.clone();
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const step = Math.max(1, Math.floor(posAttr.count / 120));
    const pts: number[] = [];
    for (let i = 0; i < posAttr.count; i += step) pts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(pts));
    if (!hull) {
      geo.dispose();
      return;
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(carPos.x, carPos.y, carPos.z)
        .setRotation(carQuat)
        .setLinvel(linvel.x + kick.x, linvel.y + kick.y, linvel.z + kick.z)
        .setAngvel({ x: angvel.x + (Math.random() - 0.5) * 6, y: angvel.y + (Math.random() - 0.5) * 6, z: angvel.z + (Math.random() - 0.5) * 6 })
        .setLinearDamping(0.05)
        .setAngularDamping(0.2)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      hull.setMass(14).setFriction(0.6).setRestitution(0.25).setCollisionGroups(DEBRIS_GROUPS),
      body,
    );
    const m = new THREE.Mesh(geo, mesh.material);
    m.castShadow = true;
    m.receiveShadow = true;
    const group = new THREE.Group();
    group.add(m);
    group.position.copy(carPos);
    group.quaternion.copy(carQuat);
    this.scene.add(group);
    this.pieces.push({
      body,
      group,
      age: 0,
      prevPos: carPos.clone(),
      currPos: carPos.clone(),
      prevQuat: carQuat.clone(),
      currQuat: carQuat.clone(),
    });
    if (this.pieces.length > MAX_PIECES) this.remove(this.pieces[0]);
  }

  afterStep(dt: number) {
    for (const p of [...this.pieces]) {
      p.age += dt;
      p.prevPos.copy(p.currPos);
      p.prevQuat.copy(p.currQuat);
      v3(p.body.translation(), p.currPos);
      q4(p.body.rotation(), p.currQuat);
      if (p.age > LIFETIME || p.currPos.y < -50) this.remove(p);
    }
  }

  render(alpha: number) {
    for (const p of this.pieces) {
      p.group.position.lerpVectors(p.prevPos, p.currPos, alpha);
      p.group.quaternion.slerpQuaternions(p.prevQuat, p.currQuat, alpha);
    }
  }

  private remove(p: Piece) {
    this.world.removeRigidBody(p.body);
    this.scene.remove(p.group);
    (p.group.children[0] as THREE.Mesh).geometry.dispose();
    this.pieces.splice(this.pieces.indexOf(p), 1);
  }

  clear() {
    while (this.pieces.length) this.remove(this.pieces[0]);
  }
}
