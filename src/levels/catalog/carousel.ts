import { ROAD_W } from '../../core/constants';
import { linePoints, local } from '../../track/frames';
import type { SegmentDef } from '../types';
import { q } from '../rng';
import { TAU } from './common';

export interface CarouselParams extends Record<string, unknown> {
  radius: number;
  omega: number;
  /** pillars riding on the disc (polar coords relative to its centre) */
  pillars: { r: number; a: number }[];
}

const APPROACH = 26;
const EXIT = 22;
const GAP = 0.3;

const across = (p: CarouselParams) => APPROACH + GAP + 2 * p.radius + GAP;

/** A huge spinning disc between two roads: the surface drags the car sideways. */
export const carousel: SegmentDef<CarouselParams> = {
  type: 'carousel',
  kind: 'obstacle',
  title: 'КАРУСЕЛЬ',
  summary: 'Вращающийся диск радиусом 16–24 м между дорогами, тянет машину вбок; на сложных уровнях с тумбами на диске',
  minDifficulty: 0.15,
  weight: () => 0.8,
  randomize(rng, d) {
    const radius = rng.range(16, 24);
    const count = d < 0.3 ? 0 : rng.int(1, 1 + Math.round(3 * d));
    const pillars = [];
    for (let i = 0; i < count; i++) pillars.push({ r: radius * rng.range(0.4, 0.75), a: rng.range(0, TAU) });
    return { radius, omega: rng.sign() * rng.range(0.15, 0.2 + 0.2 * d), pillars };
  },
  layout(s, p) {
    const L = across(p) + EXIT;
    return { exit: { p: local(s, 0, 0, L), yaw: s.yaw }, path: linePoints(s, 0, L, 4), halfWidth: Math.max(ROAD_W / 2, p.radius) + 1, height: 4 };
  },
  build(kit, s, p) {
    kit.section('КАРУСЕЛЬ', 'Диск крутится — держи руль', s, 2);
    kit.road(s, APPROACH, ROAD_W);
    const center = local(s, 0, 0, APPROACH + GAP + p.radius);
    kit.carousel(center, p.radius, p.omega, p.pillars);
    for (const pt of linePoints(s, APPROACH + 2, across(p) - 2, 4)) kit.path.push(pt);
    return kit.road({ p: local(s, 0, 0, across(p)), yaw: s.yaw }, EXIT, ROAD_W);
  },
  signature: (p) => `R${q(p.radius, 4)}p${p.pillars.length}${p.omega > 0 ? '+' : '-'}`,
};
