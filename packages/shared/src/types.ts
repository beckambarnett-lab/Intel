import {
  LANTERN_START_STAGE,
  LANTERN_TANK,
  SANDBOX_FIRE_POS,
  TILE_M,
  FIRE_STATIC_RADIUS_M,
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
}

export function emptyInput(seq: number): InputFrame {
  return { seq, moveX: 0, moveY: 0, sprint: false, creep: false, shutter: false };
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
}

/**
 * The bonfire as a light source.
 *
 * Step 2 needs somewhere the darkness is already pushed back, to cull against
 * and to walk out of. Step 3 gives it fuel, tiers and a countdown; the radius
 * stops being a constant then.
 */
export interface Campfire {
  pos: Vec2;
  radiusM: number;
}

export interface WorldState {
  tick: number;
  /** Playable rectangle in metres. Kept in step with `grid`. */
  bounds: { w: number; h: number };
  /** True geometry. Collision and line of sight read this and only this (Q48). */
  grid: OccluderGrid;
  campfire: Campfire;
  players: Record<PlayerId, Player>;
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
    campfire: { pos: { ...SANDBOX_FIRE_POS }, radiusM: FIRE_STATIC_RADIUS_M },
    players: {},
  };
}
