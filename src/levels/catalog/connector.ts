import { ROAD_W } from '../../core/constants';
import { endCursor, samplePath, splineFrames, type Cursor } from '../../track/frames';
import { q } from '../rng';
import type { SegmentDef } from '../types';
import { clamp } from './common';

export interface ConnectorParams extends Record<string, unknown> {
  length: number;
  /** heading change, radians; + = right turn */
  turn: number;
  /** height change, m */
  dy: number;
  walls: boolean;
}

/** Max |heading| of the whole course relative to +Z: keeps it progressing forward (no U-turns). */
const MAX_HEADING = 1.05;

function frames(s: Cursor, p: ConnectorParams) {
  const N = 10;
  const pts: [number, number, number][] = [[0, 0, 0]];
  let x = 0;
  let z = 0;
  const ds = p.length / N;
  const sm = (t: number) => t * t * (3 - 2 * t);
  const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  for (let i = 1; i <= N; i++) {
    const h = p.turn * sm((i - 0.5) / N); // heading at the middle of the step
    x += Math.sin(h) * ds;
    z += Math.cos(h) * ds;
    pts.push([x, p.dy * smoother(i / N), z]);
  }
  return splineFrames(s, pts, 2, 9, 0.22);
}

/** Silent link between obstacles: a banked curve that also climbs or descends. */
export const connector: SegmentDef<ConnectorParams> = {
  type: 'connector',
  kind: 'connector',
  title: '',
  summary: 'Связка: вираж 15–50° с набором или потерей высоты, иногда с бортами',
  minDifficulty: 0,
  weight: () => 0,
  randomize(rng, _d, ctx) {
    let turn = rng.range(0.25, 0.85) * rng.sign();
    // stay within the heading corridor (the course never folds back onto itself)
    if (Math.abs(ctx.yaw - turn) > MAX_HEADING) turn = -turn;
    turn = clamp(turn, ctx.yaw - MAX_HEADING, ctx.yaw + MAX_HEADING);
    // curves are gentle enough for ~110 km/h: average radius >= 90 m
    const length = Math.max(rng.range(45, 95), Math.abs(turn) * 90);
    // steer the altitude back into a comfortable band
    let dy = ctx.altitude < -70 ? rng.range(5, 12) : ctx.altitude > -5 ? rng.range(-8, 1) : rng.range(-6, 8);
    dy = clamp(dy, -0.12 * length, 0.12 * length);
    return { length, turn, dy, walls: Math.abs(turn) > 0.35 || rng.chance(0.3) };
  },
  layout(s, p) {
    const f = frames(s, p);
    return { exit: endCursor(f), path: samplePath(f), halfWidth: ROAD_W / 2 + 1, height: 2 };
  },
  build(kit, s, p) {
    const f = frames(s, p);
    kit.extrudeRoad(f, ROAD_W, p.walls ? 1.2 : false);
    return endCursor(f);
  },
  signature: (p) => `c${p.turn >= 0 ? 'r' : 'l'}${q(Math.abs(p.turn), 0.2).toFixed(1)}`,
};

