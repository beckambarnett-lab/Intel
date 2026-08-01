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

/** How often the burn rate steps up, in seconds (Q4). */
export const FIRE_ESCALATION_PERIOD_SEC = 600;

/**
 * Light radius as a smooth curve over fuel fraction (Q5).
 *
 * Q5 gives one radius per tier and then says the radius interpolates smoothly,
 * which cannot both be literally true — a smooth curve has to disagree with a
 * flat per-tier value somewhere in the band. Each tier's stated radius is
 * therefore anchored at the CENTRE of its band, which is the only choice that
 * does not bias the curve toward one end, and interpolated linearly between
 * anchors. Tiers still drive audio and VFX state as written; only the radius
 * is continuous.
 *
 * Derived from FIRE_TIERS rather than restated, so retuning the tiers retunes
 * the curve and the two cannot drift apart.
 */
export const FIRE_RADIUS_ANCHORS = FIRE_TIERS.map((tier, i) => {
  const upper = i === 0 ? 1 : (FIRE_TIERS[i - 1]?.minFrac ?? 1);
  return { frac: (tier.minFrac + upper) / 2, radiusM: tier.radiusM };
})
  .slice()
  .reverse();

/**
 * Logs each player starts the run holding.
 *
 * Step 3 stand-in. There is no way to acquire wood until Step 4 builds
 * chopping, the woodpile and real inventory; without a starting stock the
 * ember scramble cannot be played at all, which is this step's gate. Delete
 * this when items land.
 */
export const STARTING_LOGS = 12;

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

/** Shutter cycle order. `F` steps forward through this and wraps (Q126). */
export const LANTERN_STAGE_ORDER = ['hooded', 'low', 'full'] as const;

/** What you start a run holding. */
export const LANTERN_START_STAGE = 'low';

/**
 * The opening bloom (Q40): for a moment after the shutter opens the flame
 * flares past its settled radius. It is deliberately a tell — it is what gets
 * you seen when you open up at the wrong moment.
 */
export const LANTERN_BLOOM_MULT = 1.7;
export const LANTERN_BLOOM_SEC = 0.25;

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
 * The sandbox: a small slice of world used to build and verify the systems
 * before the real zone generator exists (Q107). Replaced in Step 11–12.
 */
export const SANDBOX_WIDTH_M = 60;
export const SANDBOX_HEIGHT_M = 40;

/**
 * Seed for the sandbox map. Client and server both build the occluder grid
 * from this rather than shipping the grid over the wire, so the geometry
 * cannot disagree between the two.
 */
export const SANDBOX_MAP_SEED = 0x1337;

/** Scattered 1m trunks in the sandbox — the things that cast the shadows. */
export const SANDBOX_TREE_COUNT = 110;

/** Where the sandbox bonfire sits, and the clearing kept free around it. */
export const SANDBOX_FIRE_POS = { x: 12, y: 20 } as const;
export const SANDBOX_FIRE_CLEARING_M = 7;

// ---------------------------------------------------------------------------
// Occluder grid (§21 Step 2)
// ---------------------------------------------------------------------------

/** Tile size in metres. The grid is 1m per DESIGN.md §21 Step 2.1. */
export const TILE_M = 1;

/** Opacity at or above which a tile blocks both sight and movement. */
export const OCCLUDER_OPAQUE = 255;
export const OCCLUDER_BLOCK_THRESHOLD = 128;

// ---------------------------------------------------------------------------
// Line of sight (§21 Step 2.2)
// ---------------------------------------------------------------------------

/**
 * Angular nudge applied either side of an occluder corner. The pair of rays
 * straddles the corner so one runs past it and one stops on it — that is what
 * produces the shadow edge. Too small and float error merges them back.
 */
export const LOS_CORNER_EPSILON = 0.0001;

/** Rays cast on a uniform ring, so unobstructed light reads as a circle. */
export const VIS_POLY_RING_RAYS = 72;

/** Hard bound on DDA iterations. A ray can never traverse more tiles than this. */
export const LOS_MAX_STEPS = 4096;

// ---------------------------------------------------------------------------
// Visibility culling (Q122, §21 Step 2.5)
// ---------------------------------------------------------------------------

/**
 * How long an entity keeps being sent after it stops being visible. Without
 * this, anything walking the edge of your light flickers in and out every tick.
 * It only ever extends something you legitimately saw — it never reveals
 * anything early.
 */
export const VISIBILITY_HYSTERESIS_MS = 300;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Screen pixels per world metre at default zoom. */
export const PIXELS_PER_METRE = 16;

/**
 * Light falloff. The gradient texture is generated once at this resolution and
 * stretched per light; STOPS is its radial profile (offset, alpha).
 */
export const LIGHT_GRADIENT_PX = 256;
export const LIGHT_FALLOFF_STOPS = [
  { at: 0, alpha: 1 },
  { at: 0.55, alpha: 0.72 },
  { at: 0.85, alpha: 0.22 },
  { at: 1, alpha: 0 },
] as const;

/**
 * Floor on the light mask. Not ambient light — you genuinely cannot see
 * unlit ground (Q128) — this only keeps the darkness from being a dead black
 * rectangle on OLED panels.
 */
export const DARKNESS_FLOOR_ALPHA = 0.02;

// ---------------------------------------------------------------------------
// Horizon bloom (Q13)
// ---------------------------------------------------------------------------

/**
 * The fire's glow seen from far away, drawn at the screen edge in the fire's
 * direction. This is the entire navigation system — there is no minimap and no
 * compass (Q127), so these values decide whether the game is playable at range.
 */

/** Distance at which the bloom has faded to nothing, metres. */
export const BLOOM_MAX_RANGE_M = 900;

/** Inside this distance the fire is simply on screen and the bloom is not drawn. */
export const BLOOM_MIN_RANGE_M = 18;

/** Alpha of the bloom at its brightest: close, and roaring. */
export const BLOOM_MAX_ALPHA = 0.5;

/** Size of the glow at the screen edge, as a fraction of the smaller screen axis. */
export const BLOOM_SIZE_NEAR = 0.85;
export const BLOOM_SIZE_FAR = 0.3;

/** How far the glow's centre sits outside the screen edge, in pixels. */
export const BLOOM_EDGE_OFFSET_PX = 40;

/**
 * Brightness by tier, multiplying the distance falloff (Q13: "brightness tied
 * to tier"). A guttering fire is genuinely hard to find, which is the point.
 */
export const BLOOM_TIER_BRIGHTNESS = {
  roaring: 1,
  burning: 0.72,
  low: 0.45,
  guttering: 0.24,
  embers: 0.1,
} as const;
