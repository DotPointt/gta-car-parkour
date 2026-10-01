import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as TX from '../gfx/textures';

/** Sky, sun, ocean, a city far below and clouds. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly sunDir = new THREE.Vector3();
  private ocean: THREE.Mesh;
  private oceanNormal: THREE.Texture;
  private clouds: THREE.Sprite[] = [];
  /** City + clouds live in groups so they can follow the course of each level. */
  private city = new THREE.Group();
  private cloudGroup = new THREE.Group();

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, center: THREE.Vector3, highQuality: boolean) {
    // --- sky + environment map
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    const elevation = 38;
    const azimuth = 135;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(10000);
    Object.assign(envSky.material.uniforms.sunPosition.value, this.sunDir);
    envSky.material.uniforms.turbidity.value = 4;
    envSky.material.uniforms.rayleigh.value = 1.4;
    envScene.add(envSky);
    // a ground-ish hemisphere so reflections are not black below the horizon
    const floor = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3a4a58, side: THREE.BackSide }),
    );
    envScene.add(floor);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    scene.environmentIntensity = 0.6;

    scene.fog = new THREE.Fog(0xb7c9d9, 600, 4200);

    // --- lights
    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4d5a4a, 0.9);
    scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
    this.sun.position.copy(this.sunDir).multiplyScalar(120);
    this.sun.castShadow = true;
    const sm = highQuality ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const s = 45;
    const cam = this.sun.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 1;
    cam.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // --- ocean
    this.oceanNormal = TX.waterNormalTexture();
    this.oceanNormal.repeat.set(90, 90);
    this.ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000),
      new THREE.MeshStandardMaterial({
        color: 0x174b69,
        roughness: 0.22,
        metalness: 0.2,
        normalMap: this.oceanNormal,
        normalScale: new THREE.Vector2(0.45, 0.45),
      }),
    );
    this.ocean.rotation.x = -Math.PI / 2;
    scene.add(this.ocean);

    this.buildCity(new THREE.Vector3(), highQuality);
    this.buildClouds(new THREE.Vector3(), highQuality ? 70 : 35);
    scene.add(this.city, this.cloudGroup);
    this.relocate(center);
  }

  /** Move the city, ocean and clouds under a new course. */
  relocate(center: THREE.Vector3) {
    this.city.position.set(center.x, 0, center.z);
    this.cloudGroup.position.set(center.x, 0, center.z);
    this.ocean.position.set(center.x, 0, center.z);
  }

  private buildCity(center: THREE.Vector3, hq: boolean) {
    // island
    const islandR = 1100;
    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(islandR, islandR + 60, 6, 64),
      new THREE.MeshStandardMaterial({ map: (() => {
        const t = TX.groundTexture();
        t.repeat.set(60, 60);
        return t;
      })(), roughness: 0.95 }),
    );
    island.position.set(center.x + 150, 1, center.z + 250);
    island.receiveShadow = false;
    this.city.add(island);
    const beach = new THREE.Mesh(
      new THREE.CylinderGeometry(islandR + 60, islandR + 110, 2, 64),
      new THREE.MeshStandardMaterial({ color: 0xd8c79a, roughness: 1 }),
    );
    beach.position.set(island.position.x, 0.2, island.position.z);
    this.city.add(beach);

    // buildings: one instanced mesh, window pattern computed in the shader from world position
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.25 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vObjN;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvObjN = normal;\n#ifdef USE_INSTANCING\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;\n#else\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\n#endif',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vObjN;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (abs(vObjN.y) < 0.5) {
            float h = fract(vWPos.y / 3.6);
            float w = fract((abs(vObjN.x) > 0.5 ? vWPos.z : vWPos.x) / 3.2);
            float win = step(0.25, h) * step(h, 0.8) * step(0.18, w) * step(w, 0.82);
            vec3 glass = vec3(0.16, 0.22, 0.3) + 0.25 * vec3(fract(sin(dot(floor(vWPos.xy / 3.2), vec2(12.9898, 78.233))) * 43758.5453));
            diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.85);
          } else {
            diffuseColor.rgb *= 0.55;
          }`,
        );
    };
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const count = hq ? 1400 : 700;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const palette = [0xd9d4c7, 0xbfc7cf, 0x9aa5b1, 0xe6dfd0, 0x7f8c99, 0xc9b79c, 0x8fa3b8, 0xf0ece4];
    const cx = island.position.x;
    const cz = island.position.z;
    let i = 0;
    let guard = 0;
    while (i < count && guard++ < count * 10) {
      const bx = Math.round((Math.random() * 2 - 1) * 950 / 40) * 40;
      const bz = Math.round((Math.random() * 2 - 1) * 950 / 40) * 40;
      const dist = Math.hypot(bx, bz);
      if (dist > 980) continue;
      const downtown = Math.exp(-(((bx - 150) ** 2 + (bz + 100) ** 2) / (2 * 260 * 260)));
      // skyline stays below MIN_TRACK_ALTITUDE (~185 m)
      const h = 8 + Math.random() * 20 + downtown * (30 + Math.random() * 90);
      const w = 14 + Math.random() * 16;
      const d = 14 + Math.random() * 16;
      m.compose(
        new THREE.Vector3(cx + bx + (Math.random() - 0.5) * 8, 4, cz + bz + (Math.random() - 0.5) * 8),
        new THREE.Quaternion(),
        new THREE.Vector3(w, h, d),
      );
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, col.setHex(palette[(Math.random() * palette.length) | 0]));
      i++;
    }
    inst.count = i;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.frustumCulled = false;
    this.city.add(inst);

    // roads grid on the island (simple dark stripes)
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.9 });
    const roads = new THREE.Group();
    for (let k = -960; k <= 960; k += 160) {
      const len = 2 * Math.sqrt(Math.max(0, 1000 * 1000 - k * k));
      if (len < 10) continue;
      const a = new THREE.Mesh(new THREE.PlaneGeometry(12, len), roadMat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(cx + k - 20, 4.05, cz);
      roads.add(a);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(len, 12), roadMat);
      b.rotation.x = -Math.PI / 2;
      b.position.set(cx, 4.06, cz + k - 20);
      roads.add(b);
    }
    this.city.add(roads);
  }

  private buildClouds(center: THREE.Vector3, n: number) {
    const tex = TX.cloudTexture();
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5 + Math.random() * 0.4, fog: true, toneMapped: false, color: 0xf4f7fb });
      const s = new THREE.Sprite(mat);
      const r = 250 + Math.random() * 1800;
      const a = Math.random() * Math.PI * 2;
      s.position.set(center.x + Math.cos(a) * r, 90 + Math.random() * 260, center.z + Math.sin(a) * r);
      const size = 120 + Math.random() * 260;
      s.scale.set(size, size * 0.45, 1);
      this.cloudGroup.add(s);
      this.clouds.push(s);
    }
  }

  /** Keep the sun's shadow frustum centred on the player. */
  update(dt: number, focus: THREE.Vector3) {
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 150);
    this.sun.target.position.copy(focus);
    this.oceanNormal.offset.x += dt * 0.004;
    this.oceanNormal.offset.y += dt * 0.0025;
    for (const c of this.clouds) c.position.x += dt * 2.5;
  }
}
