import * as THREE from 'three';
import type { Game } from '../game/game';
import { yawQuat } from '../track/frames';

/**
 * Dev-only console helpers (installed in `npm run dev`): window.__dev
 *   __dev.level(7)                 load level 7
 *   __dev.goto('ПРЕССЫ')          put the car at the start of a section and race
 *   __dev.bot(30, { speed: 20 })   drive the course centre line for 30 s (simulated, no rendering)
 *   __dev.info()                   short JSON state
 * `sim()` advances the game deterministically without requestAnimationFrame, so it also works
 * in a hidden/background tab.
 */
export function installDevtools(game: Game) {
  const g = game as unknown as {
    tick(dt: number): void;
    fixedStep(dt: number): void;
    update(dt: number): void;
    render(dt: number, a: number): void;
    acc: number;
    sectionIdx: number;
  };
  const bot = { idx: 0, speed: 25, lat: 0, steer: true };

  const sim = (sec: number, each?: () => void) => {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(sec * 60); i++) {
      game.input.poll();
      each?.();
      g.acc += dt;
      while (g.acc >= 1 / 120) {
        g.fixedStep(1 / 120);
        g.acc -= 1 / 120;
      }
      g.update(dt);
      game.input.endFrame();
    }
    g.render(1 / 60, 1);
  };

  /** Follow the course centre line (optionally offset sideways), hold a target speed. */
  const autopilot = () => {
    const c = game.car;
    const P = game.course.path;
    const d = game.input.drive;
    let best = bot.idx;
    let bd = Infinity;
    for (let i = Math.max(0, bot.idx - 8); i < Math.min(P.length, bot.idx + 40); i++) {
      const dd = P[i].distanceTo(c.currPos);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    if (bd > 25) P.forEach((p, k) => {
      const dd = p.distanceTo(c.currPos);
      if (dd < bd) {
        bd = dd;
        best = k;
      }
    });
    bot.idx = best;
    let ti = best;
    const look = Math.max(8, c.speed * 0.7);
    while (ti < P.length - 1 && P[ti].distanceTo(c.currPos) < look) ti++;
    const tgt = P[ti].clone();
    if (bot.lat) {
      const dir = P[Math.min(P.length - 1, ti + 1)].clone().sub(P[Math.max(0, ti - 1)]).setY(0).normalize();
      tgt.add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(bot.lat));
    }
    const T = tgt.sub(c.currPos).applyQuaternion(c.currQuat.clone().invert());
    const ang = Math.atan2(T.x, T.z);
    d.steer = bot.steer ? Math.max(-1, Math.min(1, -ang * 2.5)) : 0;
    d.throttle = c.fwdSpeed < bot.speed ? 1 : 0;
    d.brake = c.fwdSpeed > bot.speed + 3 ? 1 : 0;
    d.handbrake = false;
    d.pitch = 0;
  };

  const info = () => {
    const c = game.car;
    return {
      state: game.state,
      level: game.course.plan.index,
      t: +game.raceTime.toFixed(1),
      kmh: Math.round(c.fwdSpeed * 3.6),
      pos: c.currPos.toArray().map((v) => +v.toFixed(1)),
      upY: +c.up.y.toFixed(2),
      cond: Math.round(c.damage.condition),
      falls: game.falls,
      section: game.course.sections[g.sectionIdx]?.name,
    };
  };

  const api = {
    game,
    botState: bot,
    sim,
    info,
    level(n: number) {
      game.loadLevel(n);
      return game.course.plan;
    },
    goto(name: string) {
      const secs = game.course.sections;
      const i = secs.findIndex((s) => s.name === name);
      if (i < 0) return `no section "${name}"; have: ${secs.map((s) => s.name).join(', ')}`;
      const s = secs[i];
      game.startRace();
      game.state = 'racing';
      game.car.reset(s.spawnPos, yawQuat(s.yaw));
      g.sectionIdx = i;
      let bi = 0;
      let bd = Infinity;
      game.course.path.forEach((p, k) => {
        const d = p.distanceTo(s.spawnPos);
        if (d < bd) {
          bd = d;
          bi = k;
        }
      });
      bot.idx = bi;
      return info();
    },
    /** Drive with the autopilot for `seconds`, logging a line every second. */
    bot(seconds: number, opts: Partial<typeof bot> = {}) {
      Object.assign(bot, opts);
      const log: string[] = [];
      for (let t = 0; t < seconds; t++) {
        sim(1, autopilot);
        log.push(JSON.stringify(info()));
        if (game.state === 'finished') break;
      }
      return log.join('\n');
    },
  };
  (window as unknown as { __dev: typeof api }).__dev = api;
}
