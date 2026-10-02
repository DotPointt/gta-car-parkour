import { WIDE_W } from '../../core/constants';
import { endCursor, lineFrames, samplePath } from '../../track/frames';
import { q } from '../rng';
import type { SegmentDef } from '../types';
import { buildJump, jumpHeight, jumpLayout, jumpPath, randomJump, type JumpParams } from './jumpShared';

const RUNOUT = 34;

/** Ramp jump over a gap, sized by the flight physics; at higher difficulty through a spinning propeller. */
export const jump: SegmentDef<JumpParams> = {
  type: 'jump',
  kind: 'obstacle',
  title: 'ПРЫЖОК',
  summary: 'Трамплин 8–13° над пропастью 12–30 м; скорость задаёт зелёный пад; на сложных уровнях — пролёт сквозь винт',
  minDifficulty: 0,
  weight: () => 1.1,
  randomize: (rng, d) => randomJump(rng, d, d > 0.35 ? 0.25 + 0.4 * d : 0),
  layout(s, p) {
    const l = jumpLayout(s, p);
    const run = lineFrames(l.rampEnd, RUNOUT, 2);
    return { exit: endCursor(run), path: [...jumpPath(l), ...samplePath(run)], halfWidth: WIDE_W / 2 + 1, height: jumpHeight(p) };
  },
  build(kit, s, p) {
    kit.section(p.prop ? 'ПРЫЖОК СКВОЗЬ ВИНТ' : 'ПРЫЖОК', 'Держи газ до трамплина!', s, 2);
    const l = buildJump(kit, s, p);
    const run = lineFrames(l.rampEnd, RUNOUT, 2);
    kit.extrudeRoad(run, WIDE_W);
    return endCursor(run);
  },
  signature: (p) => `J${q(p.gap, 4)}a${q(p.angle, 2)}${p.prop ? 'p' + p.propBlades : ''}`,
};
