import * as THREE from 'three';
import { createWorld, PHYS_DT, RAPIER, WHEEL_RAY_GROUPS } from '../core/physics';
import { Input } from '../core/input';
import { GameAudio } from '../core/audio';
import { Vehicle, REDLINE } from '../car/vehicle';
import { CAR, type CarPart } from '../car/carModel';
import { Course, type Section } from '../track/course';
import { yawQuat, createMaterials, type Materials } from '../track/builder';
import { LevelLibrary, difficultyLabel, obstacleTitles } from '../levels/generator';
import { Environment } from '../world/environment';
import { ChaseCamera } from './camera';
import { Hud, formatTime } from './hud';
import { Particles } from '../fx/particles';
import { Debris } from '../fx/debris';
import { setMaxAnisotropy, softDotTexture } from '../gfx/textures';

type State = 'menu' | 'countdown' | 'racing' | 'falling' | 'finished';
type RespawnMode = 'start' | 'checkpoint';

export const CAR_COLORS = ['#c8102e', '#ff7a00', '#f5c400', '#1faa4b', '#1f5fd6', '#7a2fd0', '#eeeeee', '#1a1a1a'];

const BEST_KEY = 'car-parkour-best';
const bestKey = (level: number) => `${BEST_KEY}-${level}`;
const MAX_LEVEL = 999;
const SETTINGS_KEY = 'car-parkour-settings';

interface Settings {
  color: string;
  respawn: RespawnMode;
  quality: 'low' | 'high';
  level: number;
}

function loadSettings(): Settings {
  const def: Settings = { color: CAR_COLORS[0], respawn: 'start', quality: 'high', level: 1 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return def;
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const GREY = new THREE.Color(0.82, 0.82, 0.84);
const DARK_SMOKE = new THREE.Color(0.18, 0.18, 0.19);
const SPARK = new THREE.Color(1.0, 0.62, 0.2);
const GLASS = new THREE.Color(0.75, 0.88, 1.0);

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  readonly audio = new GameAudio();
  readonly hud = new Hud();
  readonly cam: ChaseCamera;
  readonly world: RAPIER.World;
  course!: Course;
  readonly levels = new LevelLibrary();
  readonly mats: Materials;
  readonly car: Vehicle;
  readonly env: Environment;
  readonly debris: Debris;
  readonly smoke: Particles;
  readonly sparks: Particles;

  settings = loadSettings();
  state: State = 'menu';
  paused = false;
  private simTime = 0;
  private acc = 0;
  private last = performance.now();
  raceTime = 0;
  falls = 0;
  private countdown = 0;
  private countdownShown = 0;
  private fallTimer = 0;
  private sectionIdx = 0;
  private checkpoint: Section | null = null;
  private best = Infinity;
  private boostActive = new Set<number>();
  private menuTime = 0;
  private finishConfetti = 0;
  private lowFpsFrames = 0;

  constructor(canvas: HTMLCanvasElement, world: RAPIER.World) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    this.applyQuality();

    this.input = new Input(canvas);
    this.cam = new ChaseCamera(window.innerWidth / window.innerHeight);

    this.mats = createMaterials();
    this.env = new Environment(this.scene, this.renderer, new THREE.Vector3(0, 200, 800), this.settings.quality === 'high');

    this.debris = new Debris(world, this.scene);
    const dot = softDotTexture();
    this.smoke = new Particles(700, dot, false);
    this.sparks = new Particles(900, dot, true);
    this.scene.add(this.smoke.points, this.sparks.points);

    this.car = new Vehicle(world, this.settings.color, {
      onImpact: (e) => {
        const I = Math.min(1, (e.speed - 3) / 18);
        this.audio.crash(I);
        this.cam.addShake(I * 0.9);
        for (let i = 0; i < 6 + I * 30; i++) {
          _v2.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(6 + I * 8).addScaledVector(e.normal, -3);
          this.sparks.emit(e.point, _v2, { life: 0.3 + Math.random() * 0.4, size0: 0.14, size1: 0.02, color: SPARK, alpha: 1, gravity: 9, drag: 1.5 });
        }
      },
      onPartDetached: (p) => this.detachPart(p),
      onGlass: (p, shattered) => {
        if (shattered) {
          this.audio.glass();
          this.car.toWorld(p.center, _v);
          for (let i = 0; i < 60; i++) {
            _v2.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(5).add(this.car.v);
            this.sparks.emit(_v, _v2, { life: 0.6 + Math.random() * 0.6, size0: 0.07, size1: 0.05, color: GLASS, alpha: 0.9, gravity: 9.8, drag: 0.5 });
          }
        } else this.audio.glass();
      },
      onLightBroken: () => this.audio.glass(),
    });
    this.scene.add(this.car.model.root);

    // migrate the single pre-levels record to level 1
    try {
      const old = localStorage.getItem(BEST_KEY);
      if (old && !localStorage.getItem(bestKey(1))) localStorage.setItem(bestKey(1), old);
    } catch {
      /* ignore */
    }

    this.loadLevel(this.settings.level);
    this.setupUI();
    window.addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  // ------------------------------------------------------------------------------ UI / flow
  private setupUI() {
    const colors = document.getElementById('colors')!;
    for (const c of CAR_COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c === this.settings.color ? ' active' : '');
      b.style.background = c;
      b.title = c;
      b.onclick = () => {
        colors.querySelectorAll('.swatch').forEach((s) => s.classList.remove('active'));
        b.classList.add('active');
        this.settings.color = c;
        this.car.model.setColor(c);
        this.saveSettings();
      };
      colors.appendChild(b);
    }
    const toggle = (id: string, attr: string, get: () => string, set: (v: string) => void) => {
      const el = document.getElementById(id)!;
      el.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute(attr) === get());
        btn.onclick = () => {
          el.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
          btn.classList.add('active');
          set(btn.getAttribute(attr)!);
          this.saveSettings();
        };
      });
    };
    toggle('respawn-mode', 'data-mode', () => this.settings.respawn, (v) => (this.settings.respawn = v as RespawnMode));
    toggle('quality', 'data-q', () => this.settings.quality, (v) => {
      this.settings.quality = v as 'low' | 'high';
      this.applyQuality();
    });

    const play = document.getElementById('btn-play') as HTMLButtonElement;
    play.disabled = false;
    document.getElementById('loading')!.classList.add('hidden');
    play.onclick = () => this.startRace();
    document.getElementById('btn-resume')!.onclick = () => this.setPaused(false);
    document.getElementById('btn-restart')!.onclick = () => {
      this.setPaused(false);
      this.startRace();
    };
    document.getElementById('btn-menu')!.onclick = () => {
      this.setPaused(false);
      this.toMenu();
    };
    document.getElementById('btn-again')!.onclick = () => this.startRace();
    document.getElementById('btn-finish-menu')!.onclick = () => this.toMenu();
    document.getElementById('btn-next')!.onclick = () => {
      this.loadLevel(this.course.plan.index + 1);
      this.startRace();
    };
    const input = document.getElementById('level-input') as HTMLInputElement;
    const go = (n: number) => {
      if (!Number.isFinite(n)) return;
      this.loadLevel(Math.max(1, Math.min(MAX_LEVEL, Math.round(n))));
    };
    document.getElementById('level-prev')!.onclick = () => go(this.course.plan.index - 1);
    document.getElementById('level-next')!.onclick = () => go(this.course.plan.index + 1);
    input.onchange = () => go(Number(input.value));
    this.updateMenuBest();
  }

  /** Build level N (generated on demand, deterministic) and put the car on its start. */
  loadLevel(index: number) {
    const plan = this.levels.get(index);
    if (this.course) this.course.dispose();
    this.debris.clear();
    this.course = new Course(this.world, this.mats, plan);
    this.scene.add(this.course.group);
    this.env.relocate(this.course.center());
    this.settings.level = plan.index;
    this.saveSettings();
    this.best = Number(localStorage.getItem(bestKey(plan.index))) || Infinity;
    this.hud.setBest(this.best);
    this.hud.setLevel(plan.index);
    this.sectionIdx = 0;
    this.checkpoint = null;
    this.resetCarToStart();
    this.updateMenuBest();
  }

  private saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  private updateMenuBest() {
    const plan = this.course?.plan;
    if (!plan) return;
    (document.getElementById('level-input') as HTMLInputElement).value = String(plan.index);
    document.getElementById('level-name')!.textContent = plan.name;
    const diff = document.getElementById('level-diff')!;
    diff.textContent = difficultyLabel(plan.difficulty);
    diff.dataset.level = String(Math.min(3, Math.floor(plan.difficulty / 0.25)));
    document.getElementById('level-obstacles')!.textContent = obstacleTitles(plan).join(' → ');
    document.getElementById('menu-best')!.textContent = isFinite(this.best) ? `Рекорд уровня: ${formatTime(this.best)}` : 'Рекорда пока нет';
  }

  private applyQuality() {
    const hq = this.settings.quality === 'high';
    this.renderer.setPixelRatio(hq ? Math.min(window.devicePixelRatio, 1.75) : 1);
    if (this.env) {
      const s = hq ? 2048 : 1024;
      this.env.sun.shadow.mapSize.set(s, s);
      this.env.sun.shadow.map?.dispose();
      (this.env.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.onResize();
  }

  private onResize() {
    if (!this.cam) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    const ph = h * this.renderer.getPixelRatio();
    this.smoke?.setViewportHeight(ph);
    this.sparks?.setViewportHeight(ph);
  }

  private show(id: string, v: boolean) {
    document.getElementById(id)!.classList.toggle('hidden', !v);
  }

  private resetCarToStart() {
    this.car.reset(this.course.spawnPos, yawQuat(this.course.spawnYaw));
    this.cam.snap();
    this.cam.frozen = false;
  }

  startRace() {
    this.audio.init();
    this.show('menu', false);
    this.show('finish', false);
    this.show('pause', false);
    this.hud.show(true);
    this.hud.clearBig();
    this.hud.setFade(false);
    this.debris.clear();
    this.smoke.clear();
    this.sparks.clear();
    this.resetCarToStart();
    this.falls = 0;
    this.raceTime = 0;
    this.sectionIdx = 0;
    this.checkpoint = null;
    this.hud.setFalls(0);
    this.hud.setTime(0);
    this.hud.setSection(this.course.sections[0].name);
    this.state = 'countdown';
    this.countdown = 3.0;
    this.countdownShown = 4;
    this.boostActive.clear();
  }

  toMenu() {
    this.state = 'menu';
    this.show('finish', false);
    this.show('pause', false);
    this.show('menu', true);
    this.hud.show(false);
    this.hud.clearBig();
    this.hud.hideBanner();
    this.hud.setFade(false);
    this.updateMenuBest();
    this.resetCarToStart();
  }

  setPaused(p: boolean) {
    if (p && (this.state === 'menu' || this.state === 'finished')) return;
    this.paused = p;
    this.show('pause', p);
    if (this.audio.ctx) p ? this.audio.ctx.suspend() : this.audio.ctx.resume();
    this.last = performance.now();
  }

  private finishRace() {
    this.state = 'finished';
    const t = this.raceTime;
    const record = t < this.best;
    if (record) {
      this.best = t;
      try {
        localStorage.setItem(bestKey(this.course.plan.index), String(t));
      } catch {
        /* ignore */
      }
      this.hud.setBest(t);
    }
    this.audio.fanfare();
    this.hud.bigMessage('ФИНИШ!', 'gold');
    this.finishConfetti = 2.5;
    window.setTimeout(() => {
      if (this.state !== 'finished') return;
      document.getElementById('finish-time')!.textContent = formatTime(t);
      document.getElementById('finish-falls')!.textContent = String(this.falls);
      document.getElementById('finish-best')!.textContent = formatTime(this.best);
      this.show('finish-record', record);
      this.show('finish', true);
    }, 1600);
  }

  private fellOff() {
    this.state = 'falling';
    this.fallTimer = 1.7;
    this.falls++;
    this.hud.setFalls(this.falls);
    this.hud.bigMessage('ВЫ УПАЛИ', 'red', true);
    this.cam.frozen = true;
  }

  private respawn() {
    const cp = this.settings.respawn === 'checkpoint' ? this.checkpoint : null;
    if (cp) {
      this.car.reset(cp.spawnPos, yawQuat(cp.yaw));
    } else {
      this.resetCarToStart();
      this.sectionIdx = 0;
      this.hud.setSection(this.course.sections[0].name);
    }
    this.cam.snap();
    this.cam.frozen = false;
    this.boostActive.clear();
  }

  private detachPart(p: CarPart) {
    const kick = _v.set((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3).clone();
    this.debris.spawn(p.mesh, this.car.currPos, this.car.currQuat, this.car.v, this.car.w, kick);
    this.audio.crash(0.6);
  }

  // ------------------------------------------------------------------------------ main loop
  start() {
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    requestAnimationFrame(frame);
  }

  private tick(dt: number) {
    const input = this.input;
    input.poll();

    if (input.wasPressed('pause')) {
      if (this.paused) this.setPaused(false);
      else if (this.state === 'countdown' || this.state === 'racing' || this.state === 'falling') this.setPaused(true);
    }
    if (input.wasPressed('mute')) this.audio.toggleMute();
    if (input.wasPressed('camera')) this.cam.cycle();
    if (input.wasPressed('confirm') && this.state === 'menu') this.startRace();

    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 12) {
        this.fixedStep(PHYS_DT);
        this.acc -= PHYS_DT;
        steps++;
      }
      if (steps >= 12) this.acc = 0;
      this.update(dt);
    }
    this.render(this.paused ? 0 : dt, this.paused ? 1 : this.acc / PHYS_DT);
    input.endFrame();
  }

  private fixedStep(dt: number) {
    const car = this.car;
    const driving = this.state === 'racing' || this.state === 'finished';
    this.course.prepareStep(this.simTime, dt);
    car.step(dt, this.input.drive, driving);
    this.world.step(this.events, car.hooks); // Rapier runs physics hooks only together with an event queue
    this.simTime += dt;
    car.afterStep();
    this.debris.afterStep(dt);

    // boost pads
    for (let i = 0; i < this.course.boosts.length; i++) {
      const bp = this.course.boosts[i];
      if (bp.trigger.contains(car.currPos)) {
        const vAlong = car.v.dot(bp.dir);
        if (bp.mode === 'exact' ? Math.abs(vAlong - bp.speed) > 0.05 : vAlong < bp.speed) {
          _v.copy(car.v).addScaledVector(bp.dir, (bp.speed - vAlong) * Math.min(1, dt * 12));
          car.body.setLinvel(_v, true);
          car.v.copy(_v);
        }
        if (!this.boostActive.has(i)) {
          this.boostActive.add(i);
          this.audio.whoosh();
          this.cam.addShake(0.15);
        }
      } else this.boostActive.delete(i);
    }

    if (this.state === 'racing') {
      if (this.course.finish.contains(car.currPos)) this.finishRace();
      else if (this.isOffTrack()) this.fellOff();
    }
  }

  private downRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private events = new RAPIER.EventQueue(true);

  /** Fell off: far below the last road contact with no track underneath (long jumps are fine). */
  private isOffTrack() {
    const car = this.car;
    const p = car.currPos;
    if (p.y < this.course.minY - 12 || p.y < car.lastGroundY - 45) return true;
    if (p.y > car.lastGroundY - 9) return false;
    this.downRay.origin = { x: p.x, y: p.y, z: p.z };
    const hit = this.world.castRay(this.downRay, 60, true, undefined, WHEEL_RAY_GROUPS, undefined, car.body);
    return !hit;
  }

  private update(dt: number) {
    const input = this.input;
    const car = this.car;
    switch (this.state) {
      case 'countdown': {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        if (n < this.countdownShown && n > 0) {
          this.countdownShown = n;
          this.hud.bigMessage(String(n));
          this.audio.beep(false);
        }
        if (this.countdown <= 0) {
          this.state = 'racing';
          this.raceTime = 0;
          this.hud.bigMessage('ВПЕРЁД!', 'gold');
          this.audio.beep(true);
          this.hud.showBanner(this.course.sections[0].name, this.course.sections[0].sub);
        }
        break;
      }
      case 'racing':
        this.raceTime += dt;
        if (input.wasPressed('respawn')) {
          this.hud.setFade(true);
          window.setTimeout(() => this.hud.setFade(false), 250);
          this.respawn();
        }
        this.checkSections();
        break;
      case 'falling':
        this.raceTime += dt;
        this.fallTimer -= dt;
        if (this.fallTimer < 0.35) this.hud.setFade(true);
        if (this.fallTimer <= 0) {
          this.respawn();
          this.state = 'racing';
          this.hud.clearBig();
          window.setTimeout(() => this.hud.setFade(false), 80);
        }
        break;
      case 'finished':
        if (input.wasPressed('respawn')) this.startRace();
        break;
      case 'menu':
        this.menuTime += dt;
        break;
    }
    if (this.state !== 'menu') this.hud.setTime(this.raceTime);
    this.hud.setCar(Math.abs(car.fwdSpeed) * 3.6, car.gear, car.rpm, REDLINE);
  }

  private checkSections() {
    const secs = this.course.sections;
    const p = this.car.currPos;
    for (let i = this.sectionIdx + 1; i < Math.min(secs.length, this.sectionIdx + 3); i++) {
      const s = secs[i];
      const dh = Math.hypot(p.x - s.point.x, p.z - s.point.z);
      if (dh < 14 && Math.abs(p.y - s.point.y) < 20) {
        this.sectionIdx = i;
        this.hud.showBanner(s.name, s.sub);
        this.hud.setSection(s.name);
        if (s.checkpoint) this.checkpoint = s;
        break;
      }
    }
  }

  // ------------------------------------------------------------------------------ render
  private render(dt: number, alpha: number) {
    const car = this.car;
    const renderT = this.simTime - PHYS_DT + alpha * PHYS_DT;
    this.course.render(renderT, dt);
    car.render(alpha, dt);
    this.debris.render(alpha);
    const root = car.model.root;

    if (dt > 0) this.emitEffects(dt);
    this.smoke.update(dt);
    this.sparks.update(dt);

    // camera
    if (this.state === 'menu') {
      const t = this.menuTime * 0.25;
      const cam = this.cam.camera;
      cam.position.copy(root.position).add(_v.set(Math.sin(t) * 8.5, 2.6, Math.cos(t) * 8.5));
      cam.lookAt(_v2.copy(root.position).add(new THREE.Vector3(0, 0.4, 0)));
      cam.fov = 50;
      cam.updateProjectionMatrix();
    } else {
      const { dx, dy } = this.input.consumeMouse();
      this.cam.orbit(dx, dy);
      this.cam.update(dt, root.position, root.quaternion, car.v, car.groundedCount === 0);
    }
    this.input.consumeMouse();
    this.env.update(dt, root.position);

    // audio
    let slip = 0;
    for (const w of car.wheels) slip = Math.max(slip, w.slip);
    this.audio.update({
      rpm: car.rpm,
      throttle: car.throttleOut,
      speed: car.speed,
      slip,
      scrape: car.scrape,
      horn: this.input.horn() && this.state !== 'menu',
      active: !this.paused,
    });

    this.renderer.render(this.scene, this.cam.camera);

    // adaptive quality: drop to low if we are consistently slow
    if (dt > 1 / 28) this.lowFpsFrames++;
    else this.lowFpsFrames = Math.max(0, this.lowFpsFrames - 1);
  }

  private emitEffects(dt: number) {
    const car = this.car;
    // tyre smoke
    for (const w of car.wheels) {
      if (!w.grounded || w.slip < 4.5) continue;
      const rate = Math.min(60, (w.slip - 4.5) * 8);
      if (Math.random() < rate * dt) {
        _v2.copy(car.v).multiplyScalar(0.25).add(_v.set((Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5));
        this.smoke.emit(w.point, _v2, { life: 1.2 + Math.random() * 1.2, size0: 0.6, size1: 3.2, color: GREY, alpha: 0.35, gravity: -0.4, drag: 1.2 });
      }
    }
    // scraping sparks
    if (car.scrape > 0.25) {
      const n = Math.floor(car.scrape * 60 * dt * 10);
      for (let i = 0; i < n; i++) {
        _v2.copy(car.v).multiplyScalar(-0.2).add(_v.set((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4));
        this.sparks.emit(car.scrapePoint, _v2, { life: 0.25 + Math.random() * 0.3, size0: 0.12, size1: 0.02, color: SPARK, alpha: 1, gravity: 9, drag: 1 });
      }
    }
    // engine smoke when badly damaged
    const eh = car.damage.engineHealth;
    if (eh < 55 && Math.random() < ((55 - eh) / 55) * 40 * dt) {
      car.toWorld(_v.set(0, 0.45, 1.45), _v);
      _v2.set((Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6).add(car.v.clone().multiplyScalar(0.6));
      this.smoke.emit(_v, _v2, { life: 1.8, size0: 0.5, size1: 2.8, color: eh < 25 ? DARK_SMOKE : GREY, alpha: 0.45, gravity: -0.6, drag: 0.8 });
    }
    // confetti at the finish
    if (this.finishConfetti > 0) {
      this.finishConfetti -= dt;
      const c = new THREE.Color();
      for (let i = 0; i < 6; i++) {
        c.setHSL(Math.random(), 0.9, 0.6);
        _v.copy(this.course.finishPoint).add(_v2.set((Math.random() - 0.5) * 24, 4 + Math.random() * 3, (Math.random() - 0.5) * 3));
        this.sparks.emit(_v, _v2.set((Math.random() - 0.5) * 6, 6 + Math.random() * 6, (Math.random() - 0.5) * 6), {
          life: 2 + Math.random(),
          size0: 0.25,
          size1: 0.2,
          color: c.clone(),
          alpha: 1,
          gravity: 6,
          drag: 0.8,
        });
      }
    }
  }
}

export async function createGame(canvas: HTMLCanvasElement) {
  const world = await createWorld();
  const game = new Game(canvas, world);
  void CAR;
  return game;
}
