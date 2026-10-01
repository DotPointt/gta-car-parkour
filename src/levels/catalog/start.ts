import * as THREE from 'three';
import { local } from '../../track/frames';
import type { SegmentDef } from '../types';
import { straightLayout } from './common';

type P = Record<string, never>;

/** Start platform with the gate. Always the first segment. */
export const start: SegmentDef<P> = {
  type: 'start',
  kind: 'fixed',
  title: 'СТАРТ',
  summary: 'Стартовая площадка 30×44 м с воротами',
  minDifficulty: 0,
  weight: () => 0,
  randomize: () => ({}),
  layout: (s) => straightLayout(s, 44, 15, 9),
  build(kit, s) {
    kit.b.addBox(local(s, 0, -1, 22), new THREE.Vector3(30, 2, 44), s.yaw, 'plate', 'hazard');
    kit.setSpawn(s, 12);
    kit.section('СТАРТ', 'Доберись до финиша и не упади', s, 12);
    for (let z = 12; z <= 44; z += 4) kit.path.push(local(s, 0, 0, z));
    kit.gate(s, 20, 27, 'СТАРТ', false);
    kit.sign(local(s, 0, 9, -2), s.yaw + Math.PI, [`УРОВЕНЬ ${kit.level.index}`, kit.level.name.toUpperCase()], 14, 7);
    return { p: local(s, 0, 0, 44), yaw: s.yaw };
  },
  signature: () => 'S',
};
