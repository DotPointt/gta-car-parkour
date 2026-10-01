import type { SegmentDef } from '../types';
import { q } from '../rng';
import { TAU, obstacleRoadLength, obstacleZ, straightLayout } from './common';

interface Unit {
  omega: number;
  phase: number;
  blades: number;
}
export interface PropellersParams extends Record<string, unknown> {
  spacing: number;
  units: Unit[];
}

const W = 22;
/**
 * Free strip between the swept circle and each road edge. The car is 1.9 m wide, so it squeezes
 * past without waiting, but drifting ~0.3 m towards the post means a blade tip hits it.
 */
export const PROP_LANE = 2.5;

/**
 * Fast horizontal propellers at car height on a wide road. The blades sweep everything except a
 * narrow strip along each edge: hug the edge and keep the line, or get knocked off the track.
 */
export const propellers: SegmentDef<PropellersParams> = {
  type: 'propellers',
  kind: 'obstacle',
  title: 'ПРОПЕЛЛЕРЫ',
  summary: `2–5 быстрых горизонтальных винтов (2–4 лопасти, 1.5–2.8 рад/с) на уровне машины; стойка посередине дороги 22 м, у краёв — полоса ${PROP_LANE} м впритирку к лопастям`,
  minDifficulty: 0,
  weight: () => 1,
  randomize(rng, d) {
    const n = Math.max(2, Math.min(5, Math.round(2 + 3 * d + rng.range(-0.5, 0.5))));
    const units: Unit[] = [];
    for (let i = 0; i < n; i++)
      units.push({ omega: rng.sign() * rng.range(1.5 + 0.3 * d, 2.0 + 0.8 * d), phase: rng.range(0, TAU), blades: rng.int(2, d > 0.5 ? 4 : 3) });
    return { spacing: rng.range(30, 38), units };
  },
  layout: (s, p) => straightLayout(s, obstacleRoadLength(p.units.length, p.spacing), W / 2 + 1, 3),
  build(kit, s, p) {
    kit.section('ПРОПЕЛЛЕРЫ', 'Жмись к краю — лопасти проходят впритирку', s, 2);
    const out = kit.road(s, obstacleRoadLength(p.units.length, p.spacing), W);
    kit.speedGate(s, 22, undefined, W);
    p.units.forEach((u, i) => kit.propeller(s, obstacleZ(i, p.spacing), u.omega, u.phase, u.blades, W / 2 - PROP_LANE));
    return out;
  },
  signature: (p) => `P${p.units.map((u) => u.blades + (u.omega > 0 ? '+' : '-') + q(Math.abs(u.omega), 0.2).toFixed(1)).join(',')}`,
};
