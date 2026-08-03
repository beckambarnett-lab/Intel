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
import type { ZoneName } from './constants.js';
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
   * channel: releasing it is what interrupts the stoke (Q8) or the chop (Q16).
   */
  interact: boolean;
  /**
   * `Q` pressed (Q35). Edge-triggered — it dumps everything you carry in one
   * tick, and a held key would re-dump every frame you kept it down.
   */
  panicDrop: boolean;
  /**
   * `F` held (Q39). Held rather than an edge because refuelling is a channel:
   * the same key's *press* cycles the shutter, and only sustained pressure
   * starts putting wood in.
   */
  refuel: boolean;
  /**
   * `G` pressed — put the lantern down, or pick one back up (Q41).
   *
   * Separate from the panic drop on purpose. Q35's key dumps everything you are
   * carrying in one tick precisely so it can be mashed under pressure, and
   * having that also throw away your only light source would make it unusable
   * in the situation it exists for.
   */
  dropLantern: boolean;
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
    refuel: false,
    dropLantern: false,
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
  /** Seconds `F` has been held. Wood starts flowing past the wind-up (Q39). */
  refuelProgress: number;
  /** Units left of the log currently going into the lantern. */
  refuelPartial: number;
  /**
   * Q41: you can put the lantern down as a decoy and walk away from it.
   *
   * While false, `lantern` is a dry placeholder — which is what makes every
   * radius and detection-range call site keep working without knowing this flag
   * exists. The real state lives on the DroppedLantern until you pick it up.
   */
  hasLantern: boolean;
  /**
   * Q62: contact with a creature kills you. There is no downed state — the
   * ghost is the second chance (L16), and it arrives in Step 8.
   *
   * Until then a dead player simply stands inert: they stop moving, stop making
   * noise, and stop being hunted. The run still ends the way it always has,
   * when the embers die, so death has a consequence without needing a system
   * that does not exist yet.
   */
  alive: boolean;
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
    intent: { x: 0, y: 0, sprint: false, creep: false },
    stokeProgress: 0,
    depositProgress: 0,
    chop: null,
    refuelProgress: 0,
    refuelPartial: 0,
    hasLantern: true,
    alive: true,
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
  /** The hunters (§8). Four of them (Q56), simulated only on the server. */
  creatures: Record<string, Creature>;
  /**
   * Lanterns lying on the ground, still burning (Q41).
   *
   * They keep drawing creatures exactly as a held one does, which is the whole
   * point of putting one down: it is the cheapest way to move a hunter off a
   * route, and it costs you the light you were using to see by.
   */
  droppedLanterns: Record<string, DroppedLantern>;
  /**
   * Noises made this tick, and only this tick (§21 tick order, stage 4).
   *
   * Never sent to a client. A sound event carries a position, and handing one
   * over would tell a client exactly where a creature is standing — the same
   * leak the visibility culling exists to prevent (Q122). What a player is
   * allowed to receive is the angle-and-confidence blip of Q68, which is
   * computed server-side in Step 7.
   */
  sounds: SoundEvent[];
  /** Monotonic source of item ids. Server-authoritative. */
  nextItemId: number;
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
    droppedLanterns: {},
    sounds: [],
    nextItemId: 1,
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

// ---------------------------------------------------------------------------
// Sound (§9, Q58) — see sim/sound.ts
// ---------------------------------------------------------------------------

export type SoundKind = 'footfall' | 'chop' | 'scatter' | 'sniff' | 'growl';

/**
 * One noise, alive for one tick.
 *
 * `loudnessM` is the radius it carries, not an amplitude: Q58 is written as a
 * table of distances, and keeping the unit as metres means the range table is
 * the tuning surface rather than something derived from it.
 */
export interface SoundEvent {
  pos: Vec2;
  loudnessM: number;
  kind: SoundKind;
  tick: number;
}

// ---------------------------------------------------------------------------
// Creatures (§8) — see sim/creatures.ts
// ---------------------------------------------------------------------------

/**
 * Q60's eight states, as a closed union.
 *
 * Implemented as a priority switch over the blackboard below rather than as a
 * behaviour-tree library (§21 Step 6.2). At this size a switch is smaller, is
 * debuggable by reading it, and makes the precedence — which is the actual
 * design — visible in one place instead of distributed across nodes.
 */
export type CreatureState =
  | 'patrol'
  | 'investigate'
  | 'pursue'
  | 'hunt'
  | 'siege'
  | 'sabotage'
  | 'desperate'
  | 'return';

/**
 * An order from whoever is commanding (L17).
 *
 * The scripted director issues these today (Q117); the LLM issues the same
 * shape in Step 10, which is why the verb is a tagged field rather than
 * implied. Only the one verb Step 6 needs exists so far — Q115's full closed
 * set widens this union when the director that speaks it is built.
 */
export interface CreatureOrder {
  verb: 'PATROL';
  zone: ZoneName;
}

/**
 * One hunter.
 *
 * Everything a creature knows is on this struct, which is the blackboard the
 * state switch reads. Note what is *not* here: any direct reference to a
 * player. It works from remembered positions of light and sound, so cutting
 * your light genuinely cuts the link (L12) rather than degrading a lock it
 * still holds.
 */
export interface Creature {
  id: string;
  pos: Vec2;
  vel: Vec2;
  state: CreatureState;
  /** Where it is currently heading, in world metres. */
  target: Vec2 | null;

  /** Last place it saw a light, and how long that memory has left (L12). */
  lastLight: Vec2 | null;
  lightMemorySec: number;

  /** Last place it heard something, and how long it will keep searching. */
  lastSound: Vec2 | null;
  soundMemorySec: number;

  /** Seconds left casting about before it gives up and goes back to patrol. */
  investigateSec: number;
  /** Seconds accumulated into scattering the woodpile (Q24). */
  sabotageSec: number;
  /** Seconds until the next sniff (Q69). */
  sniffSec: number;
  /** Seconds until it repicks a wander point. */
  patrolSec: number;

  /**
   * Shots taken. Q70 escalates behaviour with this; nothing raises it until
   * the gun exists in Step 7.
   */
  hits: number;

  /** False while dead. Q57 returns it from the lair after CREATURE_RESPAWN_SEC. */
  alive: boolean;
  respawnSec: number;

  /** The standing order from the director. */
  order: CreatureOrder;
}


/**
 * A lantern on the ground, still lit (Q41).
 *
 * It burns its tank down at the stage it was set to and goes dark when it runs
 * out, so a decoy has a lifetime and leaving one behind is a real cost rather
 * than a free distraction.
 */
export interface DroppedLantern {
  id: string;
  pos: Vec2;
  lantern: LanternState;
}

/** A lantern with nothing in it. What a player holds after putting theirs down. */
export function emptyLantern(): LanternState {
  const ls = createLantern();
  ls.fuel = 0;
  ls.bloom = 0;
  ls.transition = 0;
  ls.cycleRequested = false;
  return ls;
}
