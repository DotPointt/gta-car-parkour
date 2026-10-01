/** Dependency-free constants shared by physics, rendering and the (node-testable) level generator. */

export const GRAVITY = 9.81;
/** Extra gravity on the car only: makes it feel heavy and keeps it glued to the road. */
export const CAR_GRAVITY_SCALE = 1.35;
/** Effective gravity acting on the car. */
export const CAR_G = GRAVITY * CAR_GRAVITY_SCALE;

/** Standard road width and the wide variant used for landings / pads. No narrow roads by design. */
export const ROAD_W = 20;
export const WIDE_W = 24;

/** Lowest allowed track altitude (the city skyline stays below it). */
export const MIN_TRACK_ALTITUDE = 185;
