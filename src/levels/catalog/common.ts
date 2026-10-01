import { linePoints, local, type Cursor } from '../../track/frames';
import type { Layout } from '../types';

export const TAU = Math.PI * 2;
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Layout of a straight flat road of `length` (most obstacle segments are straight). */
export function straightLayout(start: Cursor, length: number, halfWidth: number, height: number): Layout {
  return {
    exit: { p: local(start, 0, 0, length), yaw: start.yaw },
    path: linePoints(start, 0, length, 4),
    halfWidth,
    height,
  };
}

/** Evenly spaced obstacle positions along a straight obstacle road (after the speed gate). */
export const GATE_LEN = 24;
export const obstacleZ = (i: number, spacing: number) => GATE_LEN + spacing * (i + 0.5);
export const obstacleRoadLength = (n: number, spacing: number, tail = 10) => GATE_LEN + n * spacing + tail;
