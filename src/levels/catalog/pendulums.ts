import type { SegmentDef } from '../types';
import { q } from '../rng';
import { TAU, obstacleRoadLength, obstacleZ, straightLayout } from './common';

interface Unit {
  period: number;
  phase: number;
  /** swing amplitude, rad */
  amp: number;
}
export interface PendulumsParams extends Record<string, unknown> {
  spacing: number;
  units: Unit[];
}

const W = 22;

/** Heavy pendulums (wrecking balls) swinging across the road. */
export const pendulums: SegmentDef<PendulumsParams> = {
  type: 'pendulums',
  kind: 'obstacle',
  title: 'МАЯТНИКИ',
  summary: '2–5 маятников-молотов на 14-метровой штанге качаются поперёк дороги; удар в бок сбрасывает машину',
  minDifficulty: 0.1,
  weight: () => 1,
  randomize(rng, d) {
    const n = Math.max(2, Math.min(5, Math.round(2 + 3 * d + rng.range(-0.5, 0.5))));
    const units: Unit[] = [];
    for (let i = 0; i < n; i++) units.push({ period: rng.range(4.8 - 1.2 * d, 5.6 - 0.8 * d), phase: rng.range(0, TAU), amp: rng.range(0.85, 1.0) });
    return { spacing: rng.range(26, 34), units };
  },
  layout: (s, p) => straightLayout(s, obstacleRoadLength(p.units.length, p.spacing), W / 2 + 4, 18),
  build(kit, s, p) {
    kit.section('МАЯТНИКИ', 'Проскочи, пока молот на краю', s, 2);
    const out = kit.road(s, obstacleRoadLength(p.units.length, p.spacing), W);
    kit.speedGate(s, 20, undefined, W);
    p.units.forEach((u, i) => kit.pendulum(s, obstacleZ(i, p.spacing), u.period, u.phase, u.amp));
    return out;
  },
  signature: (p) => `H${p.units.length}s${q(p.spacing, 4)}t${q(p.units[0].period, 0.5)}`,
};
