import {
  FIRE_CAPACITY,
  FIRE_EMBER_GRACE_SEC,
  LANTERN_START_STAGE,
  LANTERN_TANK,
  MASS_KG,
  PLAYERS_START_WITH_AXE,
  SANDBOX_FIRE_POS,
  SANDBOX_WOODPILE_POS,
  TILE_M,
} from './constants.js';
import { createGrid } from './grid.js';
import type { OccluderGrid } from './grid.js';
import type { Vec2 } from './math.js';
import type { Creature, CreatureId } from './sim/creatures.js';
import type { SoundEvent } from './sim/sound.js';

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
   * channel: releasing it is what interrupts the stoke (Q8) or the chop (Q16).
   */
  interact: boolean;
  /**
   * `Q` pressed (Q35). Edge-triggered — it dumps everything you carry in one
   * tick, and a held key would re-dump every frame you kept it down.
   */
  panicDrop: boolean;
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
    panicDrop: false,
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
  /** Carried mass in kg, recomputed from `carrying` every tick by stage 2. */
  loadKg: number;
  /** Speed multiplier from load (Q31). Stage 2 writes it, stage 3 reads it. */
  speedMul: number;
  /** Sound radius multiplier from load (Q36). Nothing reads it until Step 6. */
  noiseMul: number;
  lantern: LanternState;
  /**
   * What you are carrying, by kind and count. Weight only — no grid, no slots
   * (Q34). You carry what you can bear and nothing tells you to stop.
   */
  carrying: Carrying;
  /** Q15: standing trees need an axe. See PLAYERS_START_WITH_AXE. */
  hasAxe: boolean;
  /**
   * False once a creature has reached you (Q62). There is no downed state — the
   * ghost is the second chance — but the ghost itself is Step 8. Until then a
   * dead player simply stops: no movement, no sound, and nothing senses them.
   *
   * Kept as a flag on Player rather than by deleting the entry so the socket
   * stays open and the client keeps receiving snapshots. Step 8 turns this into
   * a real ghost with true sight and voice; nothing else needs to change here.
   */
  alive: boolean;
  /**
   * Movement intent for this tick, set by stage 1 and consumed by stage 3.
   * Intent is separated from velocity so that weight (stage 2) gets to act on
   * the load in between — which is the whole point of the tick order.
   */
  intent: MoveIntent;
  /** Seconds accumulated into the current stoke channel (Q8). Zero when idle. */
  stokeProgress: number;
  /** Seconds accumulated into the current woodpile deposit (Q22). */
  depositProgress: number;
  /** Chopping state (Q16). Null when not swinging at anything. */
  chop: ChopState | null;
}

/**
 * Things that exist in the world and can be carried.
 *
 * Step 9 adds scrap, Step 7 the gun, Step 8 corpses and Step 12 the amulet;
 * their masses are already in MASS_KG but nothing spawns them yet.
 */
export type ItemKind = 'branch' | 'log';

export const ITEM_KINDS: ItemKind[] = ['log', 'branch'];

export type Carrying = Record<ItemKind, number>;

export function emptyCarrying(): Carrying {
  return { branch: 0, log: 0 };
}

/** Total mass of a load in kg, from the Q33 mass table. */
export function carriedMassKg(carrying: Carrying): number {
  let kg = 0;
  for (const kind of ITEM_KINDS) kg += carrying[kind] * MASS_KG[kind];
  return kg;
}

/** How many items in total, regardless of kind. */
export function carriedCount(carrying: Carrying): number {
  let n = 0;
  for (const kind of ITEM_KINDS) n += carrying[kind];
  return n;
}

export interface MoveIntent {
  x: number;
  y: number;
  sprint: boolean;
  creep: boolean;
}

export interface ChopState {
  /** Which trunk, by tile. */
  treeId: string;
  /** Seconds into the current swing. Lost if you are interrupted. */
  swingProgress: number;
  /**
   * Swings this *trunk* has taken, not this session. Damage persists across
   * interruptions, so the count is a property of the tree — it is mirrored
   * here because the client is never sent tree entities and still has to
   * show you how far along you are.
   */
  swings: number;
}

/**
 * An item lying on the ground.
 *
 * Q21: dropped logs persist indefinitely and are visible to nobody in the dark
 * — including whoever dropped them. That makes items subject to exactly the
 * same per-player culling as players are, and it is why a stash you cannot
 * find again is a real way to lose wood.
 */
export interface WorldItem {
  id: string;
  kind: ItemKind;
  pos: Vec2;
}

/**
 * A standing tree. Felling one clears its occluder tile permanently (Q20),
 * which makes clearing a lane home a real strategy, and permanent depletion
 * (Q18) is the engine that eventually forces you down the tube.
 */
export interface Tree {
  id: string;
  /** Occluder tile this trunk occupies. */
  tx: number;
  ty: number;
  /** Centre of that tile, for range checks and rendering. */
  pos: Vec2;
  swingsLeft: number;
  felled: boolean;
}

/** The camp woodpile. Unlimited (Q22), and the fire can be fed from it (Q23). */
export interface Woodpile {
  pos: Vec2;
  contents: Carrying;
}

/** A player at spawn. One place to add fields as later steps grow the struct. */
export function createPlayer(id: PlayerId, name: string, pos: Vec2): Player {
  return {
    id,
    name,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    loadKg: 0,
    speedMul: 1,
    noiseMul: 1,
    lantern: createLantern(),
    carrying: emptyCarrying(),
    hasAxe: PLAYERS_START_WITH_AXE,
    alive: true,
    intent: { x: 0, y: 0, sprint: false, creep: false },
    stokeProgress: 0,
    depositProgress: 0,
    chop: null,
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
  woodpile: Woodpile;
  players: Record<PlayerId, Player>;
  /** Items on the ground, by id. Persist indefinitely (Q21). */
  items: Record<string, WorldItem>;
  /** Standing and felled trees, by id. Never respawn (Q18). */
  trees: Record<string, Tree>;
  /**
   * The hunters (Q56). Empty on a client: creature sensing and decisions are
   * server-only, and a client is sent only the ones it can currently see.
   */
  creatures: Record<CreatureId, Creature>;
  /**
   * Sounds made this tick, and only this tick (§9). Cleared and refilled by
   * stage 4; creature sensing at stage 9 is the consumer. Nothing here
   * survives into the next tick — what persists is what a creature remembers.
   */
  sounds: SoundEvent[];
  /** Monotonic source of item ids. Server-authoritative. */
  nextItemId: number;
  /** Monotonic source of sound ids. Never Math.random — the client replays this. */
  nextSoundId: number;
  /** Null while the run is live. */
  outcome: Outcome | null;
  /**
   * Seconds of *run*, which is not the same as seconds of uptime.
   *
   * Advanced by the fire stage only while somebody is in the camp. A server
   * process sitting empty is not a run in progress (Q124: no drop-in), and if
   * this were derived from the tick count instead, a dev server left running
   * would burn the fire down to nothing before anyone opened a tab.
   */
  runSec: number;
}

/** Seconds of run elapsed — drives the burn escalation (Q4). */
export function elapsedSec(world: WorldState): number {
  return world.runSec;
}

/** Inputs for a single tick, keyed by player. A missing entry means idle. */
export type TickInputs = Record<PlayerId, InputFrame | undefined>;

/**
 * An empty world of the given size. Callers that want real geometry pass a
 * grid built from a map definition; the default is open ground, which keeps
 * movement tests independent of whatever the sandbox map happens to look like.
 */
export function createWorld(
  w: number,
  h: number,
  grid?: OccluderGrid,
  campPos?: { x: number; y: number },
): WorldState {
  // Camp defaults to the sandbox position so movement and economy tests need no
  // knowledge of whichever map the room happens to be running.
  const fire = createFire();
  if (campPos) fire.pos = { x: campPos.x, y: campPos.y };
  const woodpilePos = campPos
    ? { x: campPos.x + (SANDBOX_WOODPILE_POS.x - SANDBOX_FIRE_POS.x), y: campPos.y + (SANDBOX_WOODPILE_POS.y - SANDBOX_FIRE_POS.y) }
    : { ...SANDBOX_WOODPILE_POS };

  return {
    tick: 0,
    bounds: { w, h },
    grid: grid ?? createGrid(Math.ceil(w / TILE_M), Math.ceil(h / TILE_M)),
    fire,
    woodpile: { pos: woodpilePos, contents: emptyCarrying() },
    players: {},
    items: {},
    trees: {},
    creatures: {},
    sounds: [],
    nextItemId: 1,
    nextSoundId: 1,
    outcome: null,
    runSec: 0,
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
