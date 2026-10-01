import type { SegmentPlan } from './types';

/**
 * Level 1 "Классика": the original hand-tuned course, written as plain plan data.
 * Shows that levels can also be authored by hand in the same format the generator produces.
 */
export const CLASSIC_SEGMENTS: SegmentPlan[] = [
  { type: 'start', params: {} },
  { type: 'jump', params: { v: 30, angle: 10, gap: 18, prop: false, propOmega: 0.6, propBlades: 3 } },
  { type: 'downhill', params: { length: 300, drop: 52, k: 1, amp: 30 } },
  {
    type: 'propellers',
    params: {
      spacing: 38,
      units: [
        { omega: 0.65, phase: 0, blades: 2 },
        { omega: -0.7, phase: 0.8, blades: 3 },
        { omega: 0.55, phase: 1.6, blades: 3 },
        { omega: -0.9, phase: 0.3, blades: 2 },
        { omega: 0.7, phase: 2.2, blades: 3 },
      ],
    },
  },
  { type: 'platforms', params: { n: 5, width: 14, amp: 7, period: 8, phaseStep: 1.1, vertical: [false, false, false, false, false] } },
  {
    type: 'windmills',
    params: {
      spacing: 42,
      units: [
        { twin: true, omega: 0.7, phase: 0, blades: 3 },
        { twin: false, omega: 0.9, phase: 1, blades: 4 },
        { twin: true, omega: -0.6, phase: 2, blades: 3 },
        { twin: false, omega: -1, phase: 0.7, blades: 2 },
      ],
    },
  },
  { type: 'loop', params: { a: 14, b: 4, side: 1 } },
  { type: 'finish', params: { jump: true, v: 30, angle: 16, gap: 34, prop: true, propOmega: 0.6, propBlades: 3 } },
];
