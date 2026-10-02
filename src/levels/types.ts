import type * as THREE from 'three';
import type { Cursor } from '../track/frames';
import type { Rng } from './rng';
import type { Kit } from '../track/kit';

/** One placed piece of a level: a catalog type + its concrete (already randomized) parameters. */
export interface SegmentPlan {
  type: string;
  params: Record<string, unknown>;
}

/**
 * Pure data description of a whole level. It fully determines the built course, can be logged,
 * saved, diffed or written by hand (see levels/classic.ts).
 */
export interface LevelPlan {
  index: number;
  seed: number;
  /** 0 (easy) .. 1 (extreme) */
  difficulty: number;
  name: string;
  /** World Y of the start platform (chosen so the lowest point of the course stays above the city). */
  startAltitude: number;
  segments: SegmentPlan[];
  /** Canonical description used to guarantee that no two levels are the same. */
  signature: string;
}

/** Result of laying a segment out without building it (used for validation and planning). */
export interface Layout {
  exit: Cursor;
  /** Centre-line samples (world, relative to the level origin) - footprint for overlap checks. */
  path: THREE.Vector3[];
  /** Half width of the footprint around `path` (road half width + margin for moving parts). */
  halfWidth: number;
  /** Highest point above the road any part of the segment reaches (loops, windmills...). */
  height: number;
}

export interface PlanContext {
  /** Current heading of the course (0 = main direction +Z). */
  yaw: number;
  /** Current altitude relative to the start platform. */
  altitude: number;
  /** Type of the previous obstacle (not connector). */
  prevType: string | null;
  /** 1-based position of this obstacle inside the level. */
  order: number;
}

export type SegmentKind = 'fixed' | 'connector' | 'obstacle';

/**
 * A catalog entry. Adding a new obstacle = adding one SegmentDef (see AGENTS.md).
 * Contract:
 *  - randomize() must be deterministic for a given rng state;
 *  - layout() must be pure and return the SAME exit/path that build() creates;
 *  - build() creates geometry through the Kit and returns the exit cursor;
 *  - speed-critical obstacles (jumps, loops) start with a green pad that sets the entry speed exactly,
 *    so any order of segments works; there are no red limiter pads (the player controls the speed).
 */
export interface SegmentDef<P extends Record<string, unknown> = Record<string, unknown>> {
  type: string;
  kind: SegmentKind;
  /** Banner title (RU); '' for silent connectors. */
  title: string;
  /** Short RU description for the level preview / docs. */
  summary: string;
  /** Obstacle is available from this difficulty on. */
  minDifficulty: number;
  /** Selection weight at difficulty d (0 = never). */
  weight(d: number): number;
  randomize(rng: Rng, d: number, ctx: PlanContext): P;
  layout(start: Cursor, p: P): Layout;
  build(kit: Kit, start: Cursor, p: P): Cursor;
  /** Coarse, quantized description of the parameters that change gameplay. */
  signature(p: P): string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySegmentDef = SegmentDef<any>;
