import { ROAD_W } from '../../core/constants';
import type { SegmentDef } from '../types';
import { q } from '../rng';
import { TAU, obstacleRoadLength, obstacleZ, straightLayout } from './common';

interface Unit {
  /** two counter-rotating windmills side by side */
  twin: boolean;
  omega: number;
  phase: number;
  blades: number;
}
export interface WindmillsParams extends Record<string, unknown> {
  spacing: number;
  units: Unit[];
}

/** Windmills hanging over the road: blades come down onto the car, crush it and knock it off. */
export const windmills: SegmentDef<WindmillsParams> = {
  type: 'windmills',
  kind: 'obstacle',
  title: 'ВИНТЫ',
  summary: '2–5 «мельниц» над дорогой (одиночные или парные встречного вращения); лопасти давят и сбивают машину',
  minDifficulty: 0.05,
  weight: () => 1,
  randomize(rng, d) {
    const n = Math.max(2, Math.min(5, Math.round(2 + 3 * d + rng.range(-0.5, 0.5))));
    const units: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const twin = rng.chance(0.3 + 0.4 * d);
      units.push({ twin, omega: rng.sign() * rng.range(0.5, 0.65 + 0.45 * d), phase: rng.range(0, TAU), blades: twin ? 3 : rng.int(2, 4) });
    }
    return { spacing: rng.range(38, 46), units };
  },
  layout: (s, p) => straightLayout(s, obstacleRoadLength(p.units.length, p.spacing), ROAD_W / 2 + 6, 25),
  build(kit, s, p) {
    kit.section('ВИНТЫ', 'Лопасти давят и сбивают машину', s, 2);
    const out = kit.road(s, obstacleRoadLength(p.units.length, p.spacing), ROAD_W);
    kit.speedGate(s, 24);
    p.units.forEach((u, i) => {
      const z = obstacleZ(i, p.spacing);
      if (u.twin) {
        kit.windmill(s, -5.2, z - 1.75, u.omega, u.phase, u.blades);
        kit.windmill(s, 5.2, z + 1.75, -u.omega, u.phase + 0.5, u.blades);
      } else kit.windmill(s, 0, z, u.omega, u.phase, u.blades);
    });
    return out;
  },
  signature: (p) => `W${p.units.map((u) => (u.twin ? 't' : u.blades) + (u.omega > 0 ? '+' : '-')).join(',')}${q(p.spacing, 4)}`,
};
