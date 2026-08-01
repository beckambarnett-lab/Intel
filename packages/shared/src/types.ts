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
}

export function emptyInput(seq: number): InputFrame {
  return { seq, moveX: 0, moveY: 0, sprint: false, creep: false };
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
}

export interface WorldState {
  tick: number;
  /** Playable rectangle in metres. Step 2 replaces this with an OccluderGrid. */
  bounds: { w: number; h: number };
  players: Record<PlayerId, Player>;
}

/** Inputs for a single tick, keyed by player. A missing entry means idle. */
export type TickInputs = Record<PlayerId, InputFrame | undefined>;

export function createWorld(w: number, h: number): WorldState {
  return { tick: 0, bounds: { w, h }, players: {} };
}
