import { CAR_G } from '../core/constants';

export { CAR_G };

export interface JumpGeometry {
  /** kicker length / height (parabolic ramp y = kickH * (z / kickLen)^2) */
  kickLen: number;
  kickH: number;
  /** horizontal gap from kicker end to the landing ramp */
  gap: number;
  /** landing ramp start height relative to the kicker base */
  landY: number;
  /** landing ramp slope (drop per metre) and length (last 20 m flatten out) */
  slope: number;
  rampLen: number;
  /** total drop of the landing ramp */
  rampDrop: number;
  /** nominal flight: apex and the distance where the car lands at nominal speed */
  landX: number;
}

/** Height of the flight path (relative to kicker base) at distance x after the kicker. */
export function flightY(v: number, angleRad: number, kickH: number, x: number) {
  const c = Math.cos(angleRad);
  return kickH + Math.tan(angleRad) * x - (CAR_G * x * x) / (2 * v * v * c * c);
}

/** Landing ramp height at distance x (x >= gap). */
export function rampY(g: Pick<JumpGeometry, 'gap' | 'landY' | 'slope' | 'rampLen'>, x: number) {
  const u = x - g.gap;
  const L = g.rampLen;
  const f = 20;
  if (u <= L - f) return g.landY - g.slope * u;
  const w = Math.min(u, L) - (L - f);
  return g.landY - g.slope * (L - f) - g.slope * w + (g.slope * w * w) / (2 * f);
}

function landingX(v: number, a: number, kickH: number, g: Pick<JumpGeometry, 'gap' | 'landY' | 'slope' | 'rampLen'>) {
  // first x beyond the gap where the car is below the ramp surface
  let x = g.gap;
  const maxX = g.gap + 400;
  while (x < maxX) {
    const yr = x - g.gap <= g.rampLen ? rampY(g, x) : rampY(g, g.gap + g.rampLen);
    if (flightY(v, a, kickH, x) <= yr) return x;
    x += 0.5;
  }
  return maxX;
}

/**
 * Physically sized jump: the car launched at `v` (m/s) must clear the gap even ~4 m/s slower and
 * still land on the ramp ~8 m/s faster. Speed on the kicker is fixed by the pads before it.
 */
export function designJump(v: number, angleDeg: number, wantedGap: number): JumpGeometry {
  const a = (angleDeg * Math.PI) / 180;
  const kickLen = 16;
  const kickH = (kickLen * Math.tan(a)) / 2;
  const landY = -2.5;
  // clearance at the slow end of the speed window
  let gap = wantedGap;
  while (gap > 6 && flightY(v - 4, a, kickH, gap) < landY + 1.2) gap -= 0.5;
  // match the ramp slope to the flight path at nominal speed
  let slope = 0.14;
  let geo = { gap, landY, slope, rampLen: 200 };
  for (let i = 0; i < 3; i++) {
    const x = landingX(v, a, kickH, geo);
    const c = Math.cos(a);
    const fall = -(Math.tan(a) - (CAR_G * x) / (v * v * c * c)); // flight slope (positive = down)
    slope = Math.min(0.26, Math.max(0.1, fall * 0.55));
    geo = { gap, landY, slope, rampLen: 200 };
  }
  const xFast = landingX(v + 8, a, kickH, geo);
  const rampLen = Math.min(170, Math.max(50, xFast - gap + 22));
  geo = { gap, landY, slope, rampLen };
  const landX = landingX(v, a, kickH, geo);
  const rampDrop = -(rampY(geo, gap + rampLen) - landY);
  return { kickLen, kickH, gap, landY, slope, rampLen, rampDrop, landX };
}
