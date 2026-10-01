import { ROAD_W } from '../../core/constants';
import { endCursor, lineFrames, local, samplePath, smooth, splineFrames, type Cursor } from '../../track/frames';
import { q } from '../rng';
import type { SegmentDef } from '../types';
import { TAU } from './common';

export interface DownhillParams extends Record<string, unknown> {
  length: number;
  drop: number;
  /** number of S-bends (multiple of 0.5: 0.5 = one swing, 1 = S, 1.5 = S+swing) */
  k: number;
  /** lateral amplitude, m (sign = side of the first bend) */
  amp: number;
}

const RUNOUT = 60;
const RUNOUT_RISE = 6;

function chute(s: Cursor, p: DownhillParams) {
  const N = 14;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // x(t) = A sin(2πkt) sin(πt): zero offset and zero slope at both ends, S-bends in between
    const x = p.k === 0.5 ? p.amp * Math.sin(Math.PI * t) ** 2 : p.amp * Math.sin(TAU * p.k * t) * Math.sin(Math.PI * t);
    pts.push([x, -p.drop * smooth(0, 1, t), p.length * t]);
  }
  const f = splineFrames(s, pts, 2, 10, 0.3);
  const e = endCursor(f);
  const rf = lineFrames(e, RUNOUT, 2, (z) => RUNOUT_RISE * smooth(0, RUNOUT, z));
  // flat tail with a red limiter pad so the next segment is entered at a sane speed
  const tail = lineFrames(endCursor(rf), 20, 2);
  return { f, rf, tail, e };
}

/** Walled chute that dives down with banked S-bends, then climbs a little to bleed speed. */
export const downhill: SegmentDef<DownhillParams> = {
  type: 'downhill',
  kind: 'obstacle',
  title: 'СПУСК',
  summary: 'Желоб с бортами: спуск 25–60 м с банкованными S-виражами, в конце тормозной подъём',
  minDifficulty: 0,
  weight: () => 1,
  randomize(rng, d) {
    const length = rng.range(220, 320);
    const drop = Math.min(60, rng.range(25, 35) + 25 * d);
    const k = rng.pick([0.5, 1, 1.5]);
    // curvature radius stays >= ~45 m: amp <= 0.022 * (L / 2πk)^2
    const bound = 0.022 * (length / (TAU * k)) ** 2;
    const amp = Math.min(rng.range(12, 40), bound) * rng.sign();
    return { length, drop, k, amp };
  },
  layout(s, p) {
    const { f, rf, tail } = chute(s, p);
    return { exit: endCursor(tail), path: [...samplePath(f), ...samplePath(rf), ...samplePath(tail)], halfWidth: ROAD_W / 2 + 1, height: 3 };
  },
  build(kit, s, p) {
    const { f, rf, tail, e } = chute(s, p);
    kit.section('СПУСК', 'Крутой желоб вниз', s);
    kit.extrudeRoad(f, ROAD_W, 1.8);
    kit.extrudeRoad(rf, ROAD_W, 1.8);
    kit.extrudeRoad(tail, ROAD_W, 1.8);
    kit.sign(local(e, 0, 7, 40), e.yaw, ['ТОРМОЗИ!', 'ВПЕРЕДИ ПРЕПЯТСТВИЯ'], 14, 7, '#e2362f', '#ffffff');
    kit.boostPad(endCursor(rf), 4, 12, ROAD_W - 2, 28, 'down');
    return endCursor(tail);
  },
  signature: (p) => `D${q(p.drop, 10)}k${p.k}${p.amp > 0 ? 'r' : 'l'}`,
};
