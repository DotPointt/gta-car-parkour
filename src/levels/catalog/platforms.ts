import * as THREE from 'three';
import { WIDE_W } from '../../core/constants';
import { linePoints, local, type Cursor } from '../../track/frames';
import type { SegmentDef } from '../types';
import { q } from '../rng';

export interface PlatformsParams extends Record<string, unknown> {
  n: number;
  width: number;
  /** lateral travel, m */
  amp: number;
  period: number;
  phaseStep: number;
  /** some platforms bob up and down instead of sliding */
  vertical: boolean[];
}

const PAD_IN = 18;
const PAD_OUT = 16;
const LEN = 10;
const GAP = 0.4;

const total = (p: PlatformsParams) => PAD_IN + GAP + p.n * (LEN + GAP) + PAD_OUT;

/** Platforms sliding across the course: wait for them to line up. They carry the car. */
export const platforms: SegmentDef<PlatformsParams> = {
  type: 'platforms',
  kind: 'obstacle',
  title: 'ДВИЖУЩИЕСЯ ПЛАТФОРМЫ',
  summary: '3–6 платформ 12–16 м ездят поперёк трассы (±5–8 м) или вверх-вниз; машина едет вместе с платформой',
  minDifficulty: 0,
  weight: () => 0.9,
  randomize(rng, d) {
    const n = Math.max(3, Math.min(6, Math.round(3 + 3 * d + rng.range(-0.5, 0.5))));
    const vertical: boolean[] = [];
    for (let i = 0; i < n; i++) vertical.push(d > 0.45 && rng.chance(0.25));
    return {
      n,
      width: 16 - 4 * d + rng.range(-1, 1),
      amp: 5 + 3 * d + rng.range(-0.5, 0.5),
      period: 9 - 2 * d + rng.range(-0.5, 0.5),
      phaseStep: rng.range(0.8, 1.4),
      vertical,
    };
  },
  layout(s, p) {
    const L = total(p);
    return { exit: { p: local(s, 0, 0, L), yaw: s.yaw }, path: linePoints(s, 0, L, 4), halfWidth: WIDE_W / 2 + 2, height: 3 };
  },
  build(kit, s, p) {
    kit.section('ДВИЖУЩИЕСЯ ПЛАТФОРМЫ', 'Лови момент — платформа везёт машину', s, 2);
    let c: Cursor = kit.pad(s, WIDE_W, PAD_IN);
    for (let i = 0; i < p.n; i++) {
      const z = GAP + LEN / 2 + i * (LEN + GAP);
      kit.path.push(local(c, 0, 0, z));
      const vert = p.vertical[i];
      kit.movingPlatform(
        local(c, 0, -0.5, z),
        c.yaw,
        new THREE.Vector3(p.width, 1, LEN),
        vert ? 1.2 : p.amp,
        vert ? p.period * 0.6 : p.period,
        i * p.phaseStep,
        vert,
      );
    }
    c = { p: local(c, 0, 0, GAP + p.n * (LEN + GAP)), yaw: c.yaw };
    return kit.pad(c, WIDE_W, PAD_OUT);
  },
  signature: (p) => `M${p.n}w${q(p.width, 2)}${p.vertical.map((v) => (v ? 'v' : 'h')).join('')}`,
};
