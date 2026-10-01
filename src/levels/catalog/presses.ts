import type { SegmentDef } from '../types';
import { q } from '../rng';
import { obstacleRoadLength, obstacleZ, straightLayout } from './common';

interface Unit {
  period: number;
  /** 0..1 fraction of the cycle */
  phase: number;
  /** two half-width blocks in opposite phase */
  split: boolean;
}
export interface PressesParams extends Record<string, unknown> {
  spacing: number;
  units: Unit[];
}

const W = 22;

/** Hydraulic presses slamming down onto the road: they flatten the car. */
export const presses: SegmentDef<PressesParams> = {
  type: 'presses',
  kind: 'obstacle',
  title: 'ПРЕССЫ',
  summary: '2–5 гидравлических прессов опускаются на дорогу и сплющивают машину; «раздельные» — две половины в противофазе',
  minDifficulty: 0.25,
  weight: () => 1,
  randomize(rng, d) {
    const n = Math.max(2, Math.min(5, Math.round(2 + 3 * d + rng.range(-0.5, 0.5))));
    const units: Unit[] = [];
    for (let i = 0; i < n; i++) units.push({ period: rng.range(4.2 - 0.8 * d, 5.2 - 0.6 * d), phase: rng.next(), split: d > 0.4 && rng.chance(0.45) });
    return { spacing: rng.range(20, 28), units };
  },
  layout: (s, p) => straightLayout(s, obstacleRoadLength(p.units.length, p.spacing), W / 2 + 3, 12),
  build(kit, s, p) {
    kit.section('ПРЕССЫ', 'Не стой под прессом!', s, 2);
    const out = kit.road(s, obstacleRoadLength(p.units.length, p.spacing), W);
    kit.speedGate(s, 18, undefined, W);
    p.units.forEach((u, i) => kit.press(s, obstacleZ(i, p.spacing), u.period, u.phase, u.split));
    return out;
  },
  signature: (p) => `X${p.units.map((u) => (u.split ? 's' : 'f')).join('')}${q(p.spacing, 4)}`,
};
