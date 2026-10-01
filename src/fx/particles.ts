import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

export interface EmitOptions {
  life: number;
  size0: number;
  size1: number;
  color: THREE.Color;
  alpha: number;
  gravity?: number;
  drag?: number;
}

/** CPU particle pool rendered as a single THREE.Points draw call. */
export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private size: Float32Array; // size0,size1
  private alpha0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private aSize: Float32Array;
  private aAlpha: Float32Array;
  private aColor: Float32Array;
  private cursor = 0;
  private geo: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;

  constructor(max: number, map: THREE.Texture, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(1e9);
    this.life = new Float32Array(max).fill(1);
    this.size = new Float32Array(max * 2);
    this.alpha0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.aSize = new Float32Array(max);
    this.aAlpha = new Float32Array(max);
    this.aColor = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewportHeight(h: number) {
    this.material.uniforms.uScale.value = h * 0.9;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, o: EmitOptions) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.size[i * 2] = o.size0;
    this.size[i * 2 + 1] = o.size1;
    this.alpha0[i] = o.alpha;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.aColor[i * 3] = o.color.r;
    this.aColor[i * 3 + 1] = o.color.g;
    this.aColor[i * 3 + 2] = o.color.b;
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      const a = (this.age[i] += dt);
      const L = this.life[i];
      if (a >= L) {
        this.aAlpha[i] = 0;
        this.aSize[i] = 0;
        continue;
      }
      const t = a / L;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.aSize[i] = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      this.aAlpha[i] = this.alpha0[i] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  clear() {
    this.age.fill(1e9);
  }
}
