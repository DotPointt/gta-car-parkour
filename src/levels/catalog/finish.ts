import * as THREE from 'three';
import { ROAD_W } from '../../core/constants';
import { lineFrames, linePoints, local, samplePath, type Cursor } from '../../track/frames';
import type { SegmentDef } from '../types';
import { buildJump, jumpHeight, jumpLayout, jumpPath, randomJump, type JumpParams } from './jumpShared';

export interface FinishParams extends JumpParams {
  /** false = drive straight onto the finish platform */
  jump: boolean;
}

const PAD_W = 34;
const PAD_L = 50;

function padStart(s: Cursor, p: FinishParams): Cursor {
  if (p.jump) return jumpLayout(s, p).rampEnd;
  return { p: local(s, 0, 0, 30), yaw: s.yaw };
}

/** Last segment: finish platform with the arch, usually after a final jump. */
export const finish: SegmentDef<FinishParams> = {
  type: 'finish',
  kind: 'fixed',
  title: 'ФИНИШ',
  summary: 'Финишная площадка 34×50 м с аркой; чаще всего после финального прыжка',
  minDifficulty: 0,
  weight: () => 0,
  randomize(rng, d) {
    return { ...randomJump(rng, d, d > 0.25 ? 0.35 + 0.5 * d : 0), jump: d < 0.08 ? rng.chance(0.5) : rng.chance(0.85) };
  },
  layout(s, p) {
    const ps = padStart(s, p);
    const path = p.jump ? jumpPath(jumpLayout(s, p)) : samplePath(lineFrames(s, 30, 2));
    path.push(...linePoints(ps, 0, PAD_L, 4));
    return { exit: { p: local(ps, 0, 0, PAD_L), yaw: s.yaw }, path, halfWidth: PAD_W / 2, height: p.jump ? jumpHeight(p) : 10 };
  },
  build(kit, s, p) {
    let ps: Cursor;
    if (p.jump) {
      kit.section(p.prop ? 'ФИНАЛЬНЫЙ ПРЫЖОК' : 'ФИНИШНАЯ ПРЯМАЯ', p.prop ? 'Пролети сквозь винт!' : 'Последний прыжок!', s, 2);
      ps = buildJump(kit, s, p).rampEnd;
    } else {
      kit.section('ФИНИШНАЯ ПРЯМАЯ', 'Доезжай!', s, 2);
      ps = kit.road(s, 30, ROAD_W);
    }
    kit.b.addBox(local(ps, 0, -1, PAD_L / 2), new THREE.Vector3(PAD_W, 2, PAD_L), ps.yaw, 'plate', 'hazard');
    for (let z = 4; z <= 30; z += 4) kit.path.push(local(ps, 0, 0, z));
    kit.finishLine(ps, 18, PAD_W - 4);
    return { p: local(ps, 0, 0, PAD_L), yaw: s.yaw };
  },
  signature: (p) => `F${p.jump ? 'j' : 'f'}${p.prop ? 'p' : ''}`,
};
