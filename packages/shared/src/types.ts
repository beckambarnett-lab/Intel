import {
  FIRE_CAPACITY,
  FIRE_EMBER_GRACE_SEC,
  LANTERN_START_STAGE,
  LANTERN_TANK,
  SANDBOX_FIRE_POS,
  STARTING_LOGS,
  TICK_DT,
  TILE_M,
} from './constants.js';
import { createGrid } from './grid.js';
import type { OccluderGrid } from './grid.js';
import type { Vec2 } from './math.js';

export type PlayerId = string;

/**
 * One tick of intent from a client. The client stamps `seq` monotonically and
 * keeps every unacknowledged frame so it can replay them after a correction.
 *
 * Intent only — never positions. The server decides where you actually are.
 */
export interface InputFrame {
  seq: number;
  /** Desired movement axis, each -1..1. Magnitude is clamped to 1 by the sim. */
  moveX: number;
  moveY: number;
  sprint: boolean;
  creep: boolean;
  /**
   * Edge-triggered: true only on the tick `F` went down (Q126). An edge rather
   * than a held state because the sim replays frames during reconciliation, and
   * a held flag would cycle the shutter once per replayed tick.
   */
  shutter: boolean;
  /**
   * `E` held (Q126). Held rather than edge-triggered because it drives a
   * channel: releasing it is what interrupts the stoke (Q8).
   */
  interact: boolean;
}

export function emptyInput(seq: number): InputFrame {
  return {
    seq,
    moveX: 0,
    moveY: 0,
    sprint: false,
    creep: false,
    shutter: false,
    interact: false,
  };
}

export type LanternStage = 'hooded' | 'low' | 'full';

/**
 * The lantern (§6). Radius, burn rate and how far off you can be seen all come
 * from the stage (Q37) — one dial that trades sight against being found.
 */
export interface LanternState {
  /** The stage the shutter has settled on. */
  stage: LanternStage;
  /** Where it is heading. Equal to `stage` when at rest. */
  target: LanternStage;
  /** Seconds left in the shutter movement (Q40). Zero when at rest. */
  transition: number;
  /** Seconds left of the opening bloom (Q40). */
  bloom: number;
  /** Fuel remaining, 0..LANTERN_TANK (Q38). */
  fuel: number;
  /**
   * Set by applyInputs (stage 1), consumed by the lantern stage (stage 5).
   * Intent is captured in stage 1 and acted on in its own stage, so that every
   * system in between sees one consistent world.
   */
  cycleRequested: boolean;
}

export function createLantern(): LanternState {
  return {
    stage: LANTERN_START_STAGE,
    target: LANTERN_START_STAGE,
    transition: 0,
    bloom: 0,
    fuel: LANTERN_TANK,
    cycleRequested: false,
  };
}

export interface Player {
  id: PlayerId;
  name: string;
  pos: Vec2;
  vel: Vec2;
  /**
   * Carried mass in kg. Step 4 fills this from real inventory; movement already
   * honours it, so weight lands without touching the movement system again.
   */
  loadKg: number;
  lantern: LanternState;
  /**
   * Logs in hand. Step 4 replaces this with real inventory and weight; for now
   * it is the only wood in the world, so that stoking can be built and the
   * ember scramble can be played.
   */
  carriedLogs: number;
  /** Seconds accumulated into the current stoke channel (Q8). Zero when idle. */
  stokeProgress: number;
}

/** A player at spawn. One place to add fields as later steps grow the struct. */
export function createPlayer(id: PlayerId, name: string, pos: Vec2): Player {
  return {
    id,
    name,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    loadKg: 0,
    lantern: createLantern(),
    carriedLogs: STARTING_LOGS,
    stokeProgress: 0,
  };
}

/** Tier names from Q5. These drive audio and VFX state, never the radius. */
export type FireTier = 'roaring' | 'burning' | 'low' | 'guttering' | 'embers';

/**
 * The bonfire (§2). Wood is the only clock in the game, and this is the clock.
 *
 * `fuel` is the whole run: it drains faster with more players (Q3) and faster
 * the longer you survive (Q4), and when it reaches zero you get sixty seconds
 * to find wood before the run ends (L15).
 */
export interface Fire {
  pos: Vec2;
  /** 0..FIRE_CAPACITY (Q1). */
  fuel: number;
  /** Derived from fuel each tick (Q5). */
  tier: FireTier;
  /** Interpolated smoothly, never stepped per tier (Q5). */
  lightRadiusM: number;
  /**
   * How close creatures may come (Q6). Collapses to nothing once the fire
   * drops below Low, which is when the camp perimeter fails (Q7). Nothing
   * reads this until creatures exist in Step 6.
   */
  safeRadiusM: number;
  /**
   * Seconds of ember grace left (L15). Full while there is fuel; counts down
   * only once the fire is out. Reaching zero ends the run.
   */
  emberSecLeft: number;
  /** The run is over and this fire will not come back. */
  dead: boolean;
}

/**
 * How the run ended. Q135 has two failure states; only the embers dying exists
 * yet — the amulet and the all-ghosts case arrive with Steps 12 and 8.
 */
export type Outcome = 'embersDied';

export interface WorldState {
  tick: number;
  /** Playable rectangle in metres. Kept in step with `grid`. */
  bounds: { w: number; h: number };
  /** True geometry. Collision and line of sight read this and only this (Q48). */
  grid: OccluderGrid;
  fire: Fire;
  players: Record<PlayerId, Player>;
  /** Null while the run is live. */
  outcome: Outcome | null;
}

/** Seconds of run elapsed. Derived from the tick count so replay cannot drift. */
export function elapsedSec(world: WorldState): number {
  return world.tick * TICK_DT;
}

/** Inputs for a single tick, keyed by player. A missing entry means idle. */
export type TickInputs = Record<PlayerId, InputFrame | undefined>;

/**
 * An empty world of the given size. Callers that want real geometry pass a
 * grid built from a map definition; the default is open ground, which keeps
 * movement tests independent of whatever the sandbox map happens to look like.
 */
export function createWorld(w: number, h: number, grid?: OccluderGrid): WorldState {
  return {
    tick: 0,
    bounds: { w, h },
    grid: grid ?? createGrid(Math.ceil(w / TILE_M), Math.ceil(h / TILE_M)),
    fire: createFire(),
    players: {},
    outcome: null,
  };
}

/** A fire at full. Tier and radii are filled in by the first tick. */
export function createFire(): Fire {
  return {
    pos: { ...SANDBOX_FIRE_POS },
    fuel: FIRE_CAPACITY,
    tier: 'roaring',
    lightRadiusM: 0,
    safeRadiusM: 0,
    emberSecLeft: FIRE_EMBER_GRACE_SEC,
    dead: false,
  };
}
