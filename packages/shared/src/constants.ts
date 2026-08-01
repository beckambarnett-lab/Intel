/**
 * Every tunable in EMBER lives here. See DESIGN.md; the Q-numbers below point at
 * the question each value answers.
 *
 * These are first guesses and will be wrong (DESIGN.md Step 13). Tune here, never
 * inline at a call site.
 */

// ---------------------------------------------------------------------------
// Simulation timing (Q121)
// ---------------------------------------------------------------------------

/** Server tick rate in Hz. Client sends inputs at this rate too. */
export const TICK_RATE = 20;

/** Fixed timestep in milliseconds. The sim NEVER runs at a variable dt. */
export const TICK_MS = 1000 / TICK_RATE;

/** Fixed timestep in seconds, for integration. */
export const TICK_DT = TICK_MS / 1000;

/**
 * How far behind the newest snapshot remote entities are rendered, in ms.
 * Buys one snapshot of jitter tolerance so interpolation never runs dry.
 */
export const INTERP_DELAY_MS = 100;

/** A client further behind than this is snapped rather than interpolated. */
export const INTERP_MAX_EXTRAPOLATION_MS = 250;

// ---------------------------------------------------------------------------
// Movement (§5, Q31, Q32, Q61)
// ---------------------------------------------------------------------------

/** Unloaded walk speed, metres/second. */
export const PLAYER_WALK_SPEED = 4.2;

/** Sprint multiplier. Only available under 50% load (Q32). */
export const PLAYER_SPRINT_MULT = 1.6;

/** Crouch-creep multiplier. Near-silent movement (Q58). */
export const PLAYER_CREEP_MULT = 0.45;

/** Collision radius of a player, metres. */
export const PLAYER_RADIUS = 0.35;

// ---------------------------------------------------------------------------
// Weight (§5)
// ---------------------------------------------------------------------------

/** Base carry capacity in kg (Q30). */
export const CARRY_CAPACITY_KG = 40;

/** Speed curve exponent and depth: speed = 1 - DEPTH * (load/cap)^EXP (Q31). */
export const WEIGHT_SPEED_DEPTH = 0.6;
export const WEIGHT_SPEED_EXP = 1.5;

/** Sprint is locked above this fraction of capacity (Q32). */
export const SPRINT_LOAD_LIMIT = 0.5;

/** Movement noise multiplier at full load (Q36). */
export const WEIGHT_NOISE_MULT_AT_FULL = 1.5;

/** Item masses in kg (Q33). */
export const MASS_KG = {
  branch: 1.5,
  log: 4,
  scrapLight: 6,
  scrapHeavy: 15,
  gun: 3,
  ammo: 0.1,
  corpse: 25,
  amulet: 15,
} as const;

// ---------------------------------------------------------------------------
// Fire (§2)
// ---------------------------------------------------------------------------

export const FIRE_CAPACITY = 300; // Q1
export const FIRE_BASE_BURN_PER_SEC = 1.0; // Q2
export const FIRE_BURN_PER_EXTRA_PLAYER = 0.08; // Q3
export const FIRE_ESCALATION_PER_10_MIN = 0.1; // Q4
export const FIRE_EMBER_GRACE_SEC = 60; // Q7 / L15
export const FIRE_STOKE_SEC = 1.2; // Q8
export const FIRE_STOKE_RANGE_M = 1.5; // Q8
export const FUEL_VALUE = { log: 25, branch: 8 } as const; // Q10

/** Fire tiers by fuel fraction, with light radius in metres (Q5). */
export const FIRE_TIERS = [
  { name: 'roaring', minFrac: 0.75, radiusM: 14 },
  { name: 'burning', minFrac: 0.4, radiusM: 10 },
  { name: 'low', minFrac: 0.15, radiusM: 6 },
  { name: 'guttering', minFrac: 0.001, radiusM: 3 },
  { name: 'embers', minFrac: 0, radiusM: 1.5 },
] as const;

/** Creatures cannot cross this fraction of the fire's light radius (Q6). */
export const FIRE_SAFE_RADIUS_FRAC = 0.7;

/** Below this fuel fraction the camp perimeter fails entirely (Q7). */
export const FIRE_PERIMETER_MIN_FRAC = 0.15;

// ---------------------------------------------------------------------------
// Lantern (§6)
// ---------------------------------------------------------------------------

/** Shutter stages: light radius, fuel burn per second, and range seen at (Q37). */
export const LANTERN_STAGES = {
  hooded: { radiusM: 1.2, burnPerSec: 0.01, seenAtM: 4 },
  low: { radiusM: 4, burnPerSec: 0.08, seenAtM: 18 },
  full: { radiusM: 9, burnPerSec: 0.25, seenAtM: 45 },
} as const;

export const LANTERN_TANK = 50; // Q38
export const LANTERN_REFUEL_SEC = 1.5; // Q39
export const LANTERN_SHUTTER_SEC = 0.3; // Q40

// ---------------------------------------------------------------------------
// Memory rot (§7)
// ---------------------------------------------------------------------------

export const MEMORY_ROT_START_SEC = 30; // Q46
export const MEMORY_ROT_FULL_SEC = 240; // Q46
export const PHANTOM_SPAWN_INTERVAL_SEC = 20; // Q49

// ---------------------------------------------------------------------------
// Sound (§9, Q58)
// ---------------------------------------------------------------------------

export const SOUND_RADIUS_M = {
  still: 0,
  creep: 3,
  walk: 10,
  sprint: 25,
  chop: 20,
  gunshot: 60,
} as const;

// ---------------------------------------------------------------------------
// World (§14)
// ---------------------------------------------------------------------------

/** The tube: camp at one end, the lair at the other (L19, Q105). */
export const WORLD_LENGTH_M = 1200;
export const WORLD_WIDTH_M = 250;

/**
 * Step 1 only: a small lit rectangle to validate movement and netcode before
 * the real map generator exists. Replaced in Step 2.
 */
export const SANDBOX_WIDTH_M = 60;
export const SANDBOX_HEIGHT_M = 40;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Screen pixels per world metre at default zoom. */
export const PIXELS_PER_METRE = 16;
