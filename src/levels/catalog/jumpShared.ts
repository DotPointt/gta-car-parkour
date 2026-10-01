import { ROAD_W, WIDE_W } from '../../core/constants';
import { endCursor, lineFrames, linePoints, local, samplePath, type Cursor } from '../../track/frames';
import type { Kit } from '../../track/kit';
import { designJump, flightY, rampY, type JumpGeometry } from '../jumpMath';
import type { Rng } from '../rng';


export interface JumpParams extends Record<string, unknown> {
  /** take-off speed set by the pads, m/s */
  v: number;
  angle: number;
  gap: number;
  /** spinning propeller inside a ring in the flight path */
  prop: boolean;
  propOmega: number;
  propBlades: number;
}

export const APPROACH = 60;

export function randomJump(rng: Rng, d: number, propChance: number): JumpParams {
  return {
    v: rng.range(27, 33),
    angle: rng.range(8, 13),
    gap: rng.range(12, 16) + 14 * d,
    prop: rng.chance(propChance),
    propOmega: rng.sign() * rng.range(0.45, 0.6 + 0.3 * d),
    propBlades: rng.int(2, 3),
  };
}

export interface JumpLayout {
  geo: JumpGeometry;
  approach: ReturnType<typeof lineFrames>;
  kicker: ReturnType<typeof lineFrames>;
  ramp: ReturnType<typeof lineFrames>;
  base: Cursor; // kicker base level at the kicker end
  land: Cursor;
  rampEnd: Cursor;
}

export function jumpLayout(s: Cursor, p: JumpParams): JumpLayout {
  const geo = designJump(p.v, p.angle, p.gap);
  const approach = lineFrames(s, APPROACH, 2);
  const a = endCursor(approach);
  const kicker = lineFrames(a, geo.kickLen, 1, (z) => geo.kickH * (z / geo.kickLen) ** 2);
  const base: Cursor = { p: local(a, 0, 0, geo.kickLen), yaw: s.yaw };
  const land: Cursor = { p: local(base, 0, geo.landY, geo.gap), yaw: s.yaw };
  const ramp = lineFrames(land, geo.rampLen, 2, (z) => rampY(geo, geo.gap + z) - geo.landY);
  return { geo, approach, kicker, ramp, base, land, rampEnd: { p: ramp[ramp.length - 1].p.clone(), yaw: s.yaw } };
}

export function jumpPath(l: JumpLayout) {
  return [
    ...samplePath(l.approach),
    ...samplePath(l.kicker),
    ...linePoints(l.base, 0, l.geo.gap, 4, l.geo.landY),
    ...samplePath(l.ramp),
  ];
}

/** Approach with speed gate, kicker, gap (+ optional ring propeller), landing ramp. Returns ramp end. */
export function buildJump(kit: Kit, s: Cursor, p: JumpParams) {
  const l = jumpLayout(s, p);
  kit.extrudeRoad(l.approach, ROAD_W);
  kit.speedGate(s, p.v, p.v);
  kit.extrudeRoad(l.kicker, ROAD_W);
  kit.extrudeRoad(l.ramp, WIDE_W);
  const a = (p.angle * Math.PI) / 180;
  const xc = l.geo.gap / 2;
  if (p.prop) {
    const hub = local(l.base, 0, flightY(p.v + 1.5, a, l.geo.kickH, xc) + 4.7, xc);
    kit.ringPropeller(hub, s.yaw, p.propOmega, p.propBlades);
  } else {
    kit.ring(local(l.base, 0, 7.5, xc), s.yaw, 11);
  }
  return l;
}

export const jumpHeight = (p: JumpParams) => (p.prop ? 24 : 18);
