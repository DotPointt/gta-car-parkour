import { CAR_G, ROAD_W } from '../../core/constants';
import { endCursor, lineFrames, local, loopFrames, samplePath, type Cursor } from '../../track/frames';
import type { SegmentDef } from '../types';

export interface LoopParams extends Record<string, unknown> {
  /** teardrop radius r(phi) = a + b cos(phi): bottom a+b, top a-b */
  a: number;
  b: number;
  /** lateral shift direction: +1 right, -1 left */
  side: 1 | -1;
}

const APPROACH = 72;
const EXIT = 40;
const LOOP_W = 14;

/** Entry speed that carries the car over the top with a safety margin (plus engine help). */
export function loopSpeed(p: LoopParams) {
  const top = p.a - p.b;
  return Math.sqrt(CAR_G * top * 1.3 + 2 * CAR_G * 2 * p.a) + 6;
}

function parts(s: Cursor, p: LoopParams) {
  const approach = lineFrames(s, APPROACH, 2);
  const { frames, exit } = loopFrames(endCursor(approach), p.a, p.b, p.side);
  const out = lineFrames(exit, EXIT, 2);
  return { approach, frames, out };
}

/** Teardrop helix loop: hit it fast and don't steer. */
export const loop: SegmentDef<LoopParams> = {
  type: 'loop',
  kind: 'obstacle',
  title: 'ПЕТЛЯ',
  summary: 'Каплевидная спираль (радиус внизу 16–19 м, вверху 9–11 м); зелёный пад даёт нужную скорость, руль не нужен',
  minDifficulty: 0.1,
  weight: () => 0.8,
  randomize(rng) {
    const a = rng.range(13, 15);
    const b = Math.min(a - 9.5, rng.range(3, 5));
    return { a, b, side: rng.sign() };
  },
  layout(s, p) {
    const { approach, frames, out } = parts(s, p);
    return {
      exit: endCursor(out),
      path: [...samplePath(approach), ...samplePath(frames, 6), ...samplePath(out)],
      halfWidth: ROAD_W / 2 + 1,
      height: 2 * p.a + 2,
    };
  },
  build(kit, s, p) {
    const { approach, frames, out } = parts(s, p);
    const v = loopSpeed(p);
    kit.section('ПЕТЛЯ', 'Нужна скорость — жми газ и не рули!', s, 3);
    kit.extrudeRoad(approach, ROAD_W);
    kit.speedGate(s, v, v);
    kit.sign(local(s, 0, 8.5, 52), s.yaw, ['ПЕТЛЯ', 'НЕ РУЛИ!'], 12, 6);
    kit.extrudeRoad(frames, LOOP_W, 0.9, false);
    kit.extrudeRoad(out, ROAD_W);
    kit.boostPad({ p: out[0].p.clone(), yaw: s.yaw }, 14, 12, ROAD_W - 2, 30, 'down');
    return endCursor(out);
  },
  signature: (p) => `L${Math.round(p.a)}${Math.round(p.b)}${p.side > 0 ? 'r' : 'l'}`,
};
