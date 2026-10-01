import * as THREE from 'three';
import { MIN_TRACK_ALTITUDE } from '../core/constants';
import type { Cursor } from '../track/frames';
import { CATALOG, OBSTACLES, segmentDef } from './catalog';
import { CLASSIC_SEGMENTS } from './classic';
import { createRng, hashSeed, type Rng } from './rng';
import type { AnySegmentDef, Layout, LevelPlan, PlanContext, SegmentPlan } from './types';

/** 0 for level 1, ~0.07 at level 2, ~0.47 at level 10, ~0.74 at level 20, ~0.95 at level 45 -> 1. */
export function difficultyFor(index: number) {
  return index <= 1 ? 0 : Math.min(1, 1 - Math.exp(-(index - 1) / 14));
}

export function difficultyLabel(d: number) {
  return d < 0.2 ? 'Лёгкий' : d < 0.45 ? 'Средний' : d < 0.7 ? 'Сложный' : 'Экстрим';
}

const ADJ = ['Небесный', 'Стальной', 'Безумный', 'Ревущий', 'Ледяной', 'Огненный', 'Бешеный', 'Золотой', 'Ночной', 'Грозовой', 'Штормовой', 'Дикий', 'Хромовый', 'Неоновый', 'Крутой', 'Адский'];
const NOUN = ['маршрут', 'вираж', 'каньон', 'рубеж', 'серпантин', 'полигон', 'трамплин', 'перевал', 'лабиринт', 'марафон', 'спуск', 'круг', 'штурм', 'рывок', 'разгон', 'заезд'];

interface Placed {
  layout: Layout;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

function bounds(l: Layout): Placed {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of l.path) {
    min.min(p);
    max.max(p);
  }
  return { layout: l, min, max };
}

/** The new segment must keep clear of everything except the segment it is attached to. */
function footprintOk(nw: Placed, placed: Placed[]) {
  const a = nw.layout;
  const start = a.path[0];
  for (let i = 0; i < placed.length - 1; i++) {
    const o = placed[i];
    const b = o.layout;
    const r = a.halfWidth + b.halfWidth + 4;
    const vy = Math.max(a.height, b.height) + 8;
    if (nw.min.x - r > o.max.x || nw.max.x + r < o.min.x || nw.min.z - r > o.max.z || nw.max.z + r < o.min.z) continue;
    if (nw.min.y - vy > o.max.y || nw.max.y + vy < o.min.y) continue;
    // the neighbour of our neighbour is legitimately close to our first metres
    const skipNear = i === placed.length - 2 ? 50 : 0;
    for (const p of a.path) {
      if (skipNear && p.distanceTo(start) < skipNear) continue;
      for (const q of b.path) {
        const dx = p.x - q.x;
        const dz = p.z - q.z;
        if (dx * dx + dz * dz < r * r && Math.abs(p.y - q.y) < vy) return false;
      }
    }
  }
  return true;
}

function layoutAll(segments: SegmentPlan[]) {
  let c: Cursor = { p: new THREE.Vector3(0, 0, 0), yaw: 0 };
  const layouts: Layout[] = [];
  for (const s of segments) {
    const l = segmentDef(s.type).layout(c, s.params);
    layouts.push(l);
    c = l.exit;
  }
  return layouts;
}

function lowestPoint(layouts: Layout[]) {
  let y = Infinity;
  for (const l of layouts) for (const p of l.path) y = Math.min(y, p.y);
  return y;
}

function signatureOf(segments: SegmentPlan[]) {
  return segments
    .filter((s) => s.type !== 'start')
    .map((s) => segmentDef(s.type).signature(s.params))
    .join('|');
}

/** Try to build one level from a seed; null if the constraints could not be met. */
function generate(index: number, attempt: number): LevelPlan | null {
  const seed = hashSeed('car-parkour', index, attempt);
  const rng: Rng = createRng(seed);
  const d = Math.min(1, Math.max(0, difficultyFor(index) + rng.range(-0.03, 0.03)));
  const nObstacles = Math.max(4, Math.min(10, 4 + Math.floor(d * 5.5 + rng.next())));

  const segments: SegmentPlan[] = [];
  const placed: Placed[] = [];
  let cursor: Cursor = { p: new THREE.Vector3(0, 0, 0), yaw: 0 };
  let prevType: string | null = null;
  const used = new Map<string, number>();

  const place = (def: AnySegmentDef, params: Record<string, unknown>) => {
    const pl = bounds(def.layout(cursor, params));
    if (!footprintOk(pl, placed)) return false;
    placed.push(pl);
    segments.push({ type: def.type, params });
    cursor = pl.layout.exit;
    return true;
  };
  const ctx = (order: number): PlanContext => ({ yaw: cursor.yaw, altitude: cursor.p.y, prevType, order });
  const connector = segmentDef('connector');

  place(segmentDef('start'), {});
  for (let i = 0; i < nObstacles; i++) {
    if (i > 0 && rng.chance(0.7)) {
      for (let t = 0; t < 4; t++) if (place(connector, connector.randomize(rng, d, ctx(i + 1)))) break;
    }
    let ok = false;
    for (let t = 0; t < 10 && !ok; t++) {
      // at most 2 of the same obstacle per level, never twice in a row
      const pool = OBSTACLES.filter((o) => o.minDifficulty <= d && o.type !== prevType && o.weight(d) > 0 && (used.get(o.type) ?? 0) < 2);
      // novelty: every repeat of a type inside the level makes it 3x less likely
      const def = rng.weighted(pool.map((o) => ({ item: o, w: o.weight(d) * Math.pow(0.3, used.get(o.type) ?? 0) })));
      ok = place(def, def.randomize(rng, d, ctx(i + 1)));
      if (ok) {
        used.set(def.type, (used.get(def.type) ?? 0) + 1);
        prevType = def.type;
      } else if (t === 4) {
        // blocked ahead: bend the course with an extra connector and try again
        place(connector, connector.randomize(rng, d, ctx(i + 1)));
      }
    }
    if (!ok) return null;
  }
  const fin = segmentDef('finish');
  let finished = false;
  for (let t = 0; t < 6 && !finished; t++) finished = place(fin, fin.randomize(rng, d, ctx(nObstacles + 1)));
  if (!finished) return null;

  // variety: at least 4 different obstacle types (or all of them for short levels)
  if (used.size < Math.min(4, nObstacles)) return null;

  const minY = lowestPoint(placed.map((p) => p.layout));
  const startAltitude = Math.max(260, MIN_TRACK_ALTITUDE - minY);
  if (startAltitude > 560) return null;

  return {
    index,
    seed,
    difficulty: d,
    name: `${rng.pick(ADJ)} ${rng.pick(NOUN)}`,
    startAltitude,
    segments,
    signature: signatureOf(segments),
  };
}

function classicPlan(): LevelPlan {
  const segments = CLASSIC_SEGMENTS;
  const minY = lowestPoint(layoutAll(segments));
  return {
    index: 1,
    seed: 0,
    difficulty: 0,
    name: 'Классика',
    startAltitude: Math.max(260, MIN_TRACK_ALTITUDE - minY),
    segments,
    signature: signatureOf(segments),
  };
}

/**
 * Infinite, deterministic level list. Level N is always the same on every machine, and no two
 * levels share a signature: plans are produced in order and a duplicate is re-rolled.
 */
export class LevelLibrary {
  private plans: LevelPlan[] = [];
  private signatures = new Set<string>();
  /** obstacle order alone must differ too, so levels also *feel* different */
  private sequences = new Set<string>();

  get(index: number): LevelPlan {
    if (index < 1) index = 1;
    while (this.plans.length < index) this.plans.push(this.next(this.plans.length + 1));
    return this.plans[index - 1];
  }

  private next(index: number): LevelPlan {
    if (index === 1) return this.accept(classicPlan());
    for (let attempt = 0; attempt < 200; attempt++) {
      const plan = generate(index, attempt);
      if (plan && !this.signatures.has(plan.signature) && !this.sequences.has(sequenceOf(plan))) return this.accept(plan);
    }
    throw new Error(`Could not generate level ${index}`);
  }

  private accept(p: LevelPlan) {
    this.signatures.add(p.signature);
    this.sequences.add(sequenceOf(p));
    return p;
  }
}

const sequenceOf = (p: LevelPlan) => obstacleTitles(p).join('>');

/** Obstacle titles of a plan, for previews. */
export function obstacleTitles(plan: LevelPlan) {
  return plan.segments.filter((s) => segmentDef(s.type).kind === 'obstacle').map((s) => segmentDef(s.type).title);
}

export { CATALOG, layoutAll };
