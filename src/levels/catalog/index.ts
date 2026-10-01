import type { AnySegmentDef } from '../types';
import { start } from './start';
import { finish } from './finish';
import { connector } from './connector';
import { downhill } from './downhill';
import { jump } from './jump';
import { propellers } from './propellers';
import { windmills } from './windmills';
import { platforms } from './platforms';
import { pendulums } from './pendulums';
import { presses } from './presses';
import { carousel } from './carousel';
import { loop } from './loop';

/**
 * The obstacle catalog. To add an obstacle: create a SegmentDef in this folder and list it here.
 * The generator picks from every `kind: 'obstacle'` entry whose minDifficulty is reached.
 */
export const CATALOG: AnySegmentDef[] = [start, finish, connector, downhill, jump, propellers, windmills, platforms, pendulums, presses, carousel, loop];

export const OBSTACLES = CATALOG.filter((d) => d.kind === 'obstacle');

const byType = new Map(CATALOG.map((d) => [d.type, d]));

export function segmentDef(type: string): AnySegmentDef {
  const d = byType.get(type);
  if (!d) throw new Error(`Unknown segment type "${type}"`);
  return d;
}
