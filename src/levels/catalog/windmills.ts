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

/**
 * The hubs hang lower than the blades are long, so every blade dives through a slot in the road and
 * sweeps across the whole road at car height (no safe lane: time the gap between blades).
 * Single: one rotor over the centre line. Twin: one smaller rotor over each half, staggered along the road.
 */
const SINGLE = { x: 0, hubH: 7.2, R: 11 };
const TWIN = { x: 5.2, dz: 1.75, hubH: 6, R: 9 };
/** Slot in the road for the blades (blade depth 0.9 m + clearance). */
const SLOT = 1.4;

/** Fewer blades spin faster, so the gap between two blades stays about as long. */
const baseOmega = (blades: number) => (blades <= 2 ? 2.1 : blades === 3 ? 1.6 : 1.25);

/** Fast low windmills: blades come down on the car, crush it and knock it off the road. */
export const windmills: SegmentDef<WindmillsParams> = {
  type: 'windmills',
  kind: 'obstacle',
  title: 'ВИНТЫ',
  summary: '2–5 быстрых «мельниц» (1.2–2.6 рад/с, одиночные или парные встречного вращения); ось ниже длины лопасти — лопасти ныряют в прорезь и метут всю дорогу',
  minDifficulty: 0.05,
  weight: () => 1,
  randomize(rng, d) {
    const n = Math.max(2, Math.min(5, Math.round(2 + 3 * d + rng.range(-0.5, 0.5))));
    const units: Unit[] = [];
    for (let i = 0; i < n; i++) {
      const twin = rng.chance(0.3 + 0.4 * d);
      const blades = twin ? 2 : rng.int(2, d > 0.45 ? 4 : 3);
      units.push({ twin, omega: rng.sign() * baseOmega(blades) * rng.range(0.95, 1.05 + 0.2 * d), phase: rng.range(0, TAU), blades });
    }
    return { spacing: rng.range(38, 46), units };
  },
  layout: (s, p) => straightLayout(s, obstacleRoadLength(p.units.length, p.spacing), ROAD_W / 2 + 6, SINGLE.hubH + SINGLE.R + 2),
  build(kit, s, p) {
    kit.section('ВИНТЫ', 'Лопасти метут всю дорогу — лови просвет', s, 2);
    const slots: number[] = [];
    const units = p.units.map((u, i) => {
      const z = obstacleZ(i, p.spacing);
      if (u.twin) slots.push(z - TWIN.dz, z + TWIN.dz);
      else slots.push(z);
      return { u, z };
    });
    const out = kit.slottedRoad(s, obstacleRoadLength(p.units.length, p.spacing), ROAD_W, slots, SLOT);
    kit.speedGate(s, 24);
    for (const { u, z } of units) {
      if (u.twin) {
        kit.windmill(s, -TWIN.x, z - TWIN.dz, u.omega, u.phase, u.blades, TWIN.R, TWIN.hubH);
        kit.windmill(s, TWIN.x, z + TWIN.dz, -u.omega, u.phase + 0.5, u.blades, TWIN.R, TWIN.hubH);
      } else kit.windmill(s, SINGLE.x, z, u.omega, u.phase, u.blades, SINGLE.R, SINGLE.hubH);
    }
    return out;
  },
  signature: (p) => `W${p.units.map((u) => (u.twin ? 't' : u.blades) + (u.omega > 0 ? '+' : '-') + q(Math.abs(u.omega), 0.25).toFixed(2)).join(',')}${q(p.spacing, 4)}`,
};
