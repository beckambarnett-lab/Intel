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

// ---------------------------------------------------------------------------
// Wood & chopping (§3)
// ---------------------------------------------------------------------------

/** Swings to fell a standing tree, and how long each one takes (Q16). */
export const CHOP_SWINGS = 6;
export const CHOP_SWING_SEC = 0.7;

/** Logs a felled tree yields (Q16). */
export const CHOP_YIELD_LOGS = 4;

/** How close you must be to a trunk to swing at it. */
export const CHOP_RANGE_M = 1.6;

/**
 * ASSUMPTION — players start with an axe.
 *
 * Q15 says standing trees need an axe, but Q88 makes the axe a *craftable*
 * (2 scrap + 3 wood) and crafting is Step 9. Step 4's gate is that a solo
 * player keeps the fire alive for fifteen minutes by chopping, which is
 * impossible if the only axe is five steps away. Read alongside "Second
 * lantern" being a recipe — that phrasing implies you start with the first
 * one — the axe recipe most likely covers a spare, not your only tool.
 *
 * Q33 gives no mass for an axe, so it is carried weightlessly for now.
 */
export const PLAYERS_START_WITH_AXE = true;

/** Deadfall is picked up by hand, no tool, instantly (Q15). */
export const PICKUP_RANGE_M = 1.2;

/** Panic drop scatters your load rather than stacking it in one spot (Q35). */
export const PANIC_DROP_SCATTER_M = 0.7;

/** Woodpile: unlimited capacity, 0.25s per log to deposit (Q22). */
export const DEPOSIT_SEC_PER_ITEM = 0.25;
export const DEPOSIT_RANGE_M = 1.5;

/** Where the sandbox woodpile sits — far enough from the fire that `E` is unambiguous. */
export const SANDBOX_WOODPILE_POS = { x: 12, y: 24 } as const;

/** Deadfall branches scattered across the sandbox (Q15). Never respawns (Q19). */
export const SANDBOX_DEADFALL_COUNT = 70;

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
// Memory rot (§7, Q46–Q55)
//
// Everything below is presentation. The rotting map lies about how the world
// LOOKS and never about where anything IS (Q48) — collision and line of sight
// read `grid.ts` and have no access to any of this.
// ---------------------------------------------------------------------------

export const MEMORY_ROT_START_SEC = 30; // Q46
export const MEMORY_ROT_FULL_SEC = 240; // Q46

/** Resolution of the last-seen buffer (§21 Step 5.1). One texel per metre. */
export const MEMORY_TEXELS_PER_METRE = 1;

/**
 * The span the last-seen texture can encode, in seconds.
 *
 * Times are stored as a 16-bit value across two 8-bit channels, so this is the
 * whole clock: 4096s is roughly twice the longest plausible run (Q136 targets
 * 25–35 minutes) and still leaves 0.06s of precision, which is far finer than
 * a rot curve measured in tens of seconds needs.
 */
export const MEMORY_TIME_RANGE_SEC = 4096;

/**
 * Lights further than this outside the viewport do not refresh memory.
 *
 * Q53 makes memory a record of what YOU saw. Without this gate the bonfire's
 * own light polygon would keep camp permanently fresh in your memory from 800m
 * away, which is a lie of exactly the kind this system exists to avoid.
 */
export const MEMORY_WRITE_MARGIN_M = 12;

/**
 * Brightness of remembered ground, fresh and fully rotten (Q46/Q47).
 *
 * Well under 1 at both ends: memory is never as legible as light, or the
 * lantern stops being the thing you make decisions about. Fully rotten is
 * deliberately near the floor of visibility rather than at zero — the dark is
 * not empty, it is a lie you remember.
 */
export const MEMORY_BRIGHTNESS_FRESH = 0.22;
export const MEMORY_BRIGHTNESS_ROTTEN = 0.05;

/** Saturation retained, fresh and rotten. Q47: "saturation to near-zero". */
export const MEMORY_SATURATION_FRESH = 0.55;
export const MEMORY_SATURATION_ROTTEN = 0.04;

/** Domain-warp amplitude in screen pixels, fresh and fully rotten (Q47). */
export const MEMORY_WARP_FRESH_PX = 0.6;
export const MEMORY_WARP_ROTTEN_PX = 9;

/**
 * Wavelength of the warp field in metres, and how much harder it pulls along
 * one axis than the other — the anisotropy is what makes shapes *lean* rather
 * than simply wobble (Q47).
 */
export const MEMORY_WARP_SCALE_M = 7;
export const MEMORY_WARP_LEAN = 2.2;

/**
 * Speed the warp field drifts, in Hz. Very slow on purpose: a static warp reads
 * as "the renderer is broken", a fast one as a screensaver. At this rate the
 * world is breathing and you are not sure it is.
 */
export const MEMORY_WARP_HZ = 0.05;

/** Unsharp-mask strength at full rot, and its tap distance in pixels (Q47). */
export const MEMORY_EDGE_GAIN = 1.6;
export const MEMORY_EDGE_TAP_PX = 1.4;

/**
 * Light luminance at which a pixel counts as fully, truly lit.
 *
 * Below it the composite crossfades toward memory, so the outer edge of your
 * lantern is where seeing stops and remembering starts. Above it the render is
 * bit-for-bit what Steps 2–4 produced.
 */
export const MEMORY_LIT_REFERENCE = 0.3;

/**
 * Fraction of a light's radius that is "properly lit" (Q55).
 *
 * You only remember ground you saw *well*. Only this inner part of a light is
 * committed to memory; the outer ring illuminates without recording, so ground
 * you have merely grazed with the edge of your beam still counts as unseen.
 *
 * This is what makes Q55 observable rather than theoretical. Without it, the
 * instant any light touches new ground it is already remembered, and
 * "distorted until properly lit" describes a state lasting one frame. There is
 * no seam at the boundary: MEMORY_LIT_REFERENCE saturates well inside it, so
 * the distortion has already faded out by the time the recorded area ends.
 */
export const MEMORY_PROPERLY_LIT_FRAC = 0.6;

/**
 * How hard first-sight distortion pulls (Q55) — the leading edge of your beam
 * over new territory crawls, and settles as you put real light on it.
 */
export const MEMORY_FIRST_SIGHT_WARP_PX = 5;
export const MEMORY_FIRST_SIGHT_DESAT = 0.8;

// ---------------------------------------------------------------------------
// Phantoms (Q49–Q52)
//
// Client-only. They are hallucinations of your own memory, so they are never
// simulated, never networked, and never touch the sim.
// ---------------------------------------------------------------------------

/** Roughly one per this many seconds in fully-rotten memory in view (Q49). */
export const PHANTOM_SPAWN_INTERVAL_SEC = 20;

/**
 * ASSUMPTION — Q49 gives a spawn rate and Q50 a behaviour, but nothing bounds
 * the population or its lifetime. Left unbounded a long run accumulates a crowd
 * and the ambiguity that makes them work (Q52) collapses into noise. Three at
 * once, each short-lived, keeps a sighting rare enough to be worth reacting to.
 */
export const PHANTOM_MAX_CONCURRENT = 3;
export const PHANTOM_LIFETIME_SEC = 45;

/** Q50: they move, slowly, toward you. Well under a walking player. */
export const PHANTOM_SPEED_MPS = 0.7;

/**
 * Where one may appear, relative to you. The near bound keeps them from
 * blinking into existence in your face; the far bound keeps them inside the
 * "within view" of Q49.
 */
export const PHANTOM_SPAWN_MIN_M = 9;
export const PHANTOM_SPAWN_MAX_M = 26;

/** Beyond this they are forgotten rather than followed home. */
export const PHANTOM_DESPAWN_M = 40;

/** Candidate points tried per spawn roll before giving up for this frame. */
export const PHANTOM_SPAWN_ATTEMPTS = 12;

/** Below this rot the memory is too fresh to be lying to you yet (Q49). */
export const PHANTOM_MIN_ROT = 0.35;

/**
 * The figure. Same silhouette a dimly-lit creature will use in Step 6 — Q52
 * turns on the two being indistinguishable, so they share one renderer.
 */
export const SILHOUETTE_BODY_M = 0.42;
export const SILHOUETTE_HEAD_M = 0.2;
export const SILHOUETTE_LIMB_M = 0.55;
export const SILHOUETTE_ALBEDO = 0xbcb3a6;

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

/**
 * Below this the movement is not movement. Guards against a hair of residual
 * velocity, or a player pinned against rock, registering as footfalls — Q58
 * makes standing still *truly* inaudible, and "almost silent" is a different
 * and much worse mechanic.
 */
export const SOUND_MOVING_EPSILON_MPS = 0.05;

/** A creature's sniff while hunting, and its growl on a state change (Q69). */
export const SOUND_RADIUS_SNIFF_M = 12;
export const SOUND_RADIUS_GROWL_M = 20;

// ---------------------------------------------------------------------------
// Creatures (§8, Q56–Q65)
// ---------------------------------------------------------------------------

export const CREATURE_COUNT = 4; // Q56
export const CREATURE_RESPAWN_SEC = 300; // Q57 — killed creatures return from the lair

/** Speed as a multiple of an unloaded player's walk (Q61). */
export const CREATURE_PATROL_SPEED_MULT = 0.9;
export const CREATURE_PURSUE_SPEED_MULT = 1.15;

/** Body radius for collision. Slightly wider than a player. */
export const CREATURE_RADIUS = 0.4;

/** Close enough to kill you (Q62). */
export const CREATURE_CONTACT_M = 0.9;

/** Close enough to consider a destination reached. */
export const CREATURE_ARRIVE_M = 1.2;

/**
 * How long it keeps coming after your light goes out (Q60: Investigate).
 *
 * This number is the whole "kill your light and they lose you" mechanic (L12).
 * Too short and hooding is a get-out-of-jail button; too long and it is not a
 * counter at all. It should feel like it takes nerve to hold still.
 */
export const CREATURE_LIGHT_MEMORY_SEC = 6;

/** How long it will search a sound before giving up on it (Q60: Hunt). */
export const CREATURE_SOUND_MEMORY_SEC = 8;

/** Seconds spent casting about at a lost trail before returning to patrol. */
export const CREATURE_INVESTIGATE_SEC = 5;

/**
 * How far off a player counts as seen when they are standing in firelight.
 *
 * Q59 keys light detection to the lantern stage (Q37), which alone would make
 * standing at the bonfire with a hooded lantern nearly invisible — the exact
 * opposite of what a fire is. A body lit by a fire is a body you can see.
 */
export const CREATURE_SEES_FIRELIT_M = 30;

/** Sabotage (Q24): seconds to scatter the pile, and how far the logs fly. */
export const CREATURE_SABOTAGE_SEC = 3;
export const CREATURE_SABOTAGE_THROW_M = 6;

/** Logs and branches hurled per scatter. */
export const CREATURE_SABOTAGE_TAKE = 4;

/** Seconds between sniffs while hunting (Q69). */
export const CREATURE_SNIFF_MIN_SEC = 2;
export const CREATURE_SNIFF_MAX_SEC = 4;

/**
 * Hits before it turns Desperate (Q70: 3–4 is frenzied).
 *
 * Nothing raises `hits` yet — the gun arrives in Step 7. The state is here
 * because Q60's list is the state machine's contract, and a switch missing one
 * of its arms is a switch that gets bolted on badly later.
 */
export const CREATURE_DESPERATE_HITS = 3;

/** Desperate is faster and much louder than anything else it does (Q70). */
export const CREATURE_DESPERATE_SPEED_MULT = 1.35;
export const CREATURE_DESPERATE_NOISE_MULT = 2.5;

/** How far outside its assigned zone it will drift before heading back (Q60: Return). */
export const CREATURE_ZONE_SLACK_M = 60;

/** How close to camp it has to be to consider sieging it (Q60: Siege). */
export const CREATURE_SIEGE_RANGE_M = 40;

/** Seconds a patrol holds one wander point before picking another. */
export const CREATURE_PATROL_REPICK_SEC = 7;

/** Seed for creature behaviour. Deterministic — the sim never calls Math.random. */
export const CREATURE_RNG_SEED = 0x5eed;

// ---------------------------------------------------------------------------
// The scripted director (§21 Step 6.5, Q117)
//
// Ships permanently as the LLM failure path. The game must play correctly with
// the API key removed entirely, which means this is not a placeholder.
// ---------------------------------------------------------------------------

/** How often it reconsiders assignments, in seconds. Q111 puts the LLM at 12. */
export const DIRECTOR_REASSIGN_SEC = 12;

/**
 * Zones the scripted director will send creatures to, in the order it fills
 * them. Weighted toward the near wood because that is where players are for
 * most of a run — a patrol in the lair menaces nobody.
 */
export const DIRECTOR_PATROL_ZONES = ['nearWood', 'ruins', 'nearWood', 'deepWood'] as const;

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

// ---------------------------------------------------------------------------
// Light colour and response (§24.4)
//
// Colour temperature separation is what makes two light sources read as
// physically real rather than as two copies of the same white circle. The fire
// is warm and shifts cooler and dimmer as it dies; the lantern is paler and
// flatter, so a lantern in the distance never reads as a campfire.
// ---------------------------------------------------------------------------

/** Emitted colour per fire tier. Warmth drops with the fuel. */
export const FIRE_LIGHT_COLOUR = {
  roaring: 0xff9d4d,
  burning: 0xff8a33,
  low: 0xf06f1f,
  guttering: 0xd4551a,
  embers: 0x8f3410,
} as const;

/** Light intensity per tier, before tone-mapping. Over 1 is deliberate. */
export const FIRE_LIGHT_INTENSITY = {
  roaring: 1.0,
  burning: 0.88,
  low: 0.72,
  guttering: 0.55,
  embers: 0.35,
} as const;

/** The flame body itself, drawn into the albedo so the fire reads as a shape. */
export const FIRE_CORE_COLOUR = {
  roaring: 0xffd9a0,
  burning: 0xffc27a,
  low: 0xffa855,
  guttering: 0xe8813a,
  embers: 0xb35520,
} as const;

/** Flame body radius in metres per tier — the fire visibly shrinks as it dies. */
export const FIRE_CORE_RADIUS_M = {
  roaring: 0.85,
  burning: 0.7,
  low: 0.55,
  guttering: 0.4,
  embers: 0.28,
} as const;

/** Flicker depth and speed. Subtle — a strobing fire reads as a bug. */
export const FIRE_FLICKER_AMPLITUDE = 0.06;
export const FIRE_FLICKER_HZ = 7.3;

/** The lantern: paler and cooler than any fire tier. */
export const LANTERN_LIGHT_COLOUR = 0xffe3b8;
export const LANTERN_LIGHT_INTENSITY = 0.85;
export const LANTERN_FLICKER_AMPLITUDE = 0.025;
export const LANTERN_FLICKER_HZ = 5.1;

/** Filmic rolloff strength in the composite pass. Higher lifts the midtones. */
export const COMPOSITE_EXPOSURE = 2.1;

/** Ambient floor so unlit ground has texture rather than being a void. */
export const COMPOSITE_AMBIENT = 0.018;

// ---------------------------------------------------------------------------
// Horizon bloom gating (§21 Step 4A.2)
//
// The bloom exists to point you home when you cannot see camp (Q13). Showing it
// while the fire is on screen is noise, and trains players to ignore the one
// navigation aid the game has. Gate on the viewport, not on a fixed distance.
// ---------------------------------------------------------------------------

/** Extra margin past the screen edge before the bloom is allowed to appear, in metres. */
export const BLOOM_OFFSCREEN_MARGIN_M = 6;

/** Fade in/out seconds, so it does not pop as the fire crosses the screen edge. */
export const BLOOM_FADE_SEC = 0.5;

// ---------------------------------------------------------------------------
// The tube (§14, Q105-Q109) — the real map
//
// Camp at one end, the lair at the other. The sandbox above is kept only for
// tests: a 1200m map to assert that two clients can see each other is waste.
// ---------------------------------------------------------------------------

/** Camp sits this far in from the near end. */
export const TUBE_CAMP_X = 40;

/** Zone boundaries along the tube's length, in metres (Q106). */
export const TUBE_ZONES = [
  { name: 'camp', from: 0, to: 150 },
  { name: 'nearWood', from: 150, to: 400 },
  { name: 'ruins', from: 400, to: 700 },
  { name: 'deepWood', from: 700, to: 1000 },
  { name: 'lair', from: 1000, to: 1200 },
] as const;

export type ZoneName = (typeof TUBE_ZONES)[number]['name'];

/**
 * Trees per 1000m² by zone.
 *
 * Rising with distance is deliberate (Q18/§14): the near wood is thin to begin
 * with and strips out fast, so the pressure to range further is structural
 * rather than scripted. Nothing respawns.
 */
export const TUBE_TREE_DENSITY: Record<ZoneName, number> = {
  camp: 3,
  nearWood: 7,
  ruins: 4,
  deepWood: 11,
  lair: 8,
};

/** Deadfall per 1000m² by zone. Richest near camp — the calm opening minutes. */
export const TUBE_DEADFALL_DENSITY: Record<ZoneName, number> = {
  camp: 6,
  nearWood: 4,
  ruins: 2,
  deepWood: 2,
  lair: 1,
};

/** Rock blocks per zone. Hard cover is what makes going dark survivable. */
export const TUBE_ROCK_COUNT: Record<ZoneName, number> = {
  camp: 4,
  nearWood: 10,
  ruins: 26,
  deepWood: 14,
  lair: 12,
};

/** Cliff thickness bounding the tube's long sides (Q105). */
export const TUBE_CLIFF_M = 3;

/** Walkable clearing kept around camp so the opening is not a thicket. */
export const TUBE_CAMP_CLEARING_M = 11;

export const TUBE_MAP_SEED = 0x1337;

/**
 * How far a figure standing in firelight can be made out across open ground.
 *
 * Previously unbounded, which was defensible on a 60m sandbox where trees broke
 * every long sightline. On the 1200m tube it meant a lit player was visible from
 * arbitrarily far away down an open corridor, which both leaks position and
 * contradicts Q45's "at full detection range". Generous enough that standing in
 * the firelight is still a real tactical fact.
 */
export const LIT_FIGURE_VISIBLE_M = 70;
