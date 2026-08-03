import {
  CREATURE_ARRIVE_M,
  CREATURE_CONTACT_M,
  CREATURE_DESPERATE_HITS,
  CREATURE_DESPERATE_NOISE_MULT,
  CREATURE_DESPERATE_SPEED_MULT,
  CREATURE_INVESTIGATE_SEC,
  CREATURE_LIGHT_MEMORY_SEC,
  CREATURE_PATROL_REPICK_SEC,
  CREATURE_PATROL_SPEED_MULT,
  CREATURE_PURSUE_SPEED_MULT,
  CREATURE_RADIUS,
  CREATURE_RESPAWN_SEC,
  CREATURE_RNG_SEED,
  CREATURE_SABOTAGE_SEC,
  CREATURE_SABOTAGE_TAKE,
  CREATURE_SABOTAGE_THROW_M,
  CREATURE_SEES_FIRELIT_M,
  CREATURE_SIEGE_RANGE_M,
  CREATURE_SNIFF_MAX_SEC,
  CREATURE_SNIFF_MIN_SEC,
  CREATURE_SOUND_MEMORY_SEC,
  CREATURE_ZONE_SLACK_M,
  FIRE_PERIMETER_MIN_FRAC,
  PLAYER_WALK_SPEED,
  SOUND_RADIUS_GROWL_M,
  SOUND_RADIUS_SNIFF_M,
  TUBE_ZONES,
} from '../constants.js';
import type { ZoneName } from '../constants.js';
import { isBlockedAt } from '../grid.js';
import { canSee, raycastLOS } from '../los.js';
import { clamp, mulberry32 } from '../math.js';
import type { Vec2 } from '../math.js';
import { fuelFraction } from './fire.js';
import { spawnItem } from './items.js';
import { lanternSeenAt } from './lantern.js';
import { emit, loudestAudibleAt } from './sound.js';
import { ITEM_KINDS } from '../types.js';
import type { Creature, CreatureState, ItemKind, WorldState } from '../types.js';

/**
 * The hunters (§8, §21 Step 6.2).
 *
 * Two stages, deliberately separated by the tick order: stage 9 decides what
 * each creature knows, stage 10 decides what it does about it. Nothing in
 * stage 10 may consult a player directly — it reads only the remembered light
 * and sound written in stage 9. That is the mechanism behind L12: kill your
 * light and the link is genuinely severed, because there was never a pointer
 * to you, only a memory of where your light was.
 *
 * All of this is deterministic. `step()` is replayed by every client for
 * prediction, so there is no Math.random here — the wander is a seeded PRNG
 * keyed on the tick and the creature's own id.
 */

// ---------------------------------------------------------------------------
// Stage 9 — creatureSense
// ---------------------------------------------------------------------------

/**
 * Light first, then sound, and only when there is no light (L12).
 *
 * The ordering is the whole design. A creature that could hear you while it
 * could also see your lantern would never give you the moment where cutting
 * the light changes what it is doing, and that moment is the game.
 */
export function creatureSense(world: WorldState, dt: number): void {
  const fireFrac = fuelFraction(world.fire);

  for (const id of Object.keys(world.creatures)) {
    const c = world.creatures[id];
    if (!c || !c.alive) continue;

    // Memories decay whether or not anything refreshes them this tick.
    c.lightMemorySec = Math.max(0, c.lightMemorySec - dt);
    c.soundMemorySec = Math.max(0, c.soundMemorySec - dt);

    const lit = brightestVisiblePlayer(world, c, fireFrac);
    if (lit) {
      c.lastLight = { x: lit.x, y: lit.y };
      c.lightMemorySec = CREATURE_LIGHT_MEMORY_SEC;
      // A creature locked onto a light is not listening (L12). Dropping the
      // sound memory here rather than merely ignoring it means that when the
      // light does go out, it starts from the light's last position — not from
      // a footstep it banked ten seconds ago.
      c.lastSound = null;
      c.soundMemorySec = 0;
      continue;
    }

    // Its own noise must not be its own quarry.
    const heard = loudestAudibleAt(world, c.pos, (s) => s.kind === 'sniff' || s.kind === 'growl');
    if (heard) {
      c.lastSound = { x: heard.pos.x, y: heard.pos.y };
      c.soundMemorySec = CREATURE_SOUND_MEMORY_SEC;
    }
  }
}

/**
 * The nearest player whose light this creature can actually see.
 *
 * Detection range comes from the lantern itself (Q37/Q59) — hooded is 4m, full
 * is 45m, wider still mid-bloom — plus line of sight through the true grid. A player standing in
 * firelight is visible much further (CREATURE_SEES_FIRELIT_M) whatever their
 * shutter is doing, because a fire lights bodies and hiding at the bonfire by
 * closing a lantern would be nonsense.
 */
function brightestVisiblePlayer(world: WorldState, c: Creature, fireFrac: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDist = Infinity;

  const fire = world.fire;
  const firelit = !fire.dead && fireFrac > 0;

  for (const id of Object.keys(world.players)) {
    const p = world.players[id];
    if (!p || !p.alive) continue;

    // Asks the lantern how far it can be seen rather than reading the stage
    // off the struct: mid-shutter and mid-bloom are real states a player can be
    // caught in, and a creature must see the light that is actually there.
    let range = lanternSeenAt(p.lantern);
    if (firelit && canSee(world.grid, fire.pos, fire.lightRadiusM, p.pos)) {
      range = Math.max(range, CREATURE_SEES_FIRELIT_M);
    }

    const d = Math.hypot(p.pos.x - c.pos.x, p.pos.y - c.pos.y);
    if (d > range || d >= bestDist) continue;
    if (!raycastLOS(world.grid, c.pos, p.pos)) continue;

    best = p.pos;
    bestDist = d;
  }

  return best;
}

// ---------------------------------------------------------------------------
// Stage 10 — creatureAct
// ---------------------------------------------------------------------------

/**
 * The priority switch (§21 Step 6.2).
 *
 * Read top to bottom, this list *is* the creature design: being shot outranks
 * seeing you, seeing you outranks having just seen you, having just seen you
 * outranks hearing you, and everything outranks the standing order. Adding a
 * behaviour means adding a line at the right height, which is the property a
 * behaviour-tree library would have cost.
 */
export function creatureAct(world: WorldState, dt: number): void {
  const fireFrac = fuelFraction(world.fire);
  const perimeterHolds = !world.fire.dead && fireFrac >= FIRE_PERIMETER_MIN_FRAC;

  for (const id of Object.keys(world.creatures)) {
    const c = world.creatures[id];
    if (!c) continue;

    if (!c.alive) {
      // Q57: killed creatures come back from the lair. Bodies have to be
      // renewable or revival (L16) becomes impossible to sustain.
      c.respawnSec -= dt;
      if (c.respawnSec <= 0) revive(world, c);
      continue;
    }

    const previous = c.state;
    c.state = decideState(world, c, perimeterHolds);

    // Q69: a growl on every state change. It is the only tell you get that a
    // creature has noticed something, and it is deliberately the loudest thing
    // it does that is not a chase.
    if (c.state !== previous) emit(world, c.pos, SOUND_RADIUS_GROWL_M, 'growl');

    act(world, c, dt, perimeterHolds);
  }

  contact(world);
}

function decideState(world: WorldState, c: Creature, perimeterHolds: boolean): CreatureState {
  // Wounded past the threshold it stops being methodical (Q70). Outranks
  // everything: a desperate creature is not taking orders.
  if (c.hits >= CREATURE_DESPERATE_HITS) return 'desperate';

  // Seeing a light beats everything else it could be doing (L12).
  if (c.lightMemorySec >= CREATURE_LIGHT_MEMORY_SEC - 1e-6 && c.lastLight) return 'pursue';

  // The light went out but it has not forgotten yet.
  if (c.lightMemorySec > 0 && c.lastLight) return 'investigate';

  if (c.soundMemorySec > 0 && c.lastSound) return 'hunt';

  if (c.investigateSec > 0) return 'investigate';

  // Nothing to chase: fall through to the standing order. Camp is worth
  // pressing only when the fire has stopped holding the perimeter (Q7);
  // otherwise it takes the woodpile instead, which is the real attack (Q24).
  const dCamp = Math.hypot(world.fire.pos.x - c.pos.x, world.fire.pos.y - c.pos.y);
  if (dCamp < CREATURE_SIEGE_RANGE_M) {
    if (!perimeterHolds) return 'siege';
    if (pileHasWood(world)) return 'sabotage';
  }

  if (!inAssignedZone(c, CREATURE_ZONE_SLACK_M)) return 'return';

  return 'patrol';
}

function act(world: WorldState, c: Creature, dt: number, perimeterHolds: boolean): void {
  let speedMult = CREATURE_PATROL_SPEED_MULT;
  let noiseMult = 1;

  switch (c.state) {
    case 'desperate': {
      // Q70: frenzied, pouncing blind, very loud and very fast. It no longer
      // waits for a reason to move — it goes at the last thing it knew about.
      speedMult = CREATURE_DESPERATE_SPEED_MULT;
      noiseMult = CREATURE_DESPERATE_NOISE_MULT;
      c.target = c.lastLight ?? c.lastSound ?? wanderPoint(world, c);
      break;
    }

    case 'pursue': {
      speedMult = CREATURE_PURSUE_SPEED_MULT;
      c.target = c.lastLight;
      break;
    }

    case 'investigate': {
      // Arriving at the last known position and finding nothing is what starts
      // the search — it casts about for a few seconds before giving up, which
      // is the window you have to be somewhere else.
      c.target = c.lastLight ?? c.lastSound;
      if (c.target && distanceTo(c, c.target) < CREATURE_ARRIVE_M) {
        if (c.investigateSec <= 0) c.investigateSec = CREATURE_INVESTIGATE_SEC;
        c.lastLight = null;
        c.target = wanderPoint(world, c);
      }
      c.investigateSec = Math.max(0, c.investigateSec - dt);
      break;
    }

    case 'hunt': {
      c.target = c.lastSound;
      sniff(world, c, dt);
      if (c.target && distanceTo(c, c.target) < CREATURE_ARRIVE_M) {
        // Reached the noise. Nothing here, so let the memory lapse rather than
        // standing on the spot forever.
        c.lastSound = null;
        c.soundMemorySec = 0;
        c.investigateSec = CREATURE_INVESTIGATE_SEC;
      }
      break;
    }

    case 'siege': {
      // The perimeter has failed (Q7), so the fire itself is the destination.
      c.target = { ...world.fire.pos };
      break;
    }

    case 'sabotage': {
      c.target = { ...world.woodpile.pos };
      if (distanceTo(c, c.target) < CREATURE_ARRIVE_M) {
        c.sabotageSec += dt;
        if (c.sabotageSec >= CREATURE_SABOTAGE_SEC) {
          scatterPile(world, c);
          c.sabotageSec = 0;
        }
      } else {
        c.sabotageSec = 0;
      }
      break;
    }

    case 'return': {
      c.target = zoneCentre(world, c.order.zone);
      break;
    }

    case 'patrol':
    default: {
      c.patrolSec -= dt;
      if (!c.target || c.patrolSec <= 0 || distanceTo(c, c.target) < CREATURE_ARRIVE_M) {
        c.target = wanderPoint(world, c);
        c.patrolSec = CREATURE_PATROL_REPICK_SEC;
      }
      break;
    }
  }

  move(world, c, dt, speedMult, perimeterHolds);

  // A moving creature makes noise like anything else does. Q69 gives it
  // footfalls; the multiplier is what makes a desperate one audible from a
  // long way off, which is the tell Q70 is built around.
  const speed = Math.hypot(c.vel.x, c.vel.y);
  if (speed > 0) emit(world, c.pos, footfallRange(speed) * noiseMult, 'footfall');
}

/** Q69: a sniff every 2–4 seconds while hunting. */
function sniff(world: WorldState, c: Creature, dt: number): void {
  c.sniffSec -= dt;
  if (c.sniffSec > 0) return;

  emit(world, c.pos, SOUND_RADIUS_SNIFF_M, 'sniff');
  const r = rng(world, c);
  c.sniffSec = CREATURE_SNIFF_MIN_SEC + r() * (CREATURE_SNIFF_MAX_SEC - CREATURE_SNIFF_MIN_SEC);
}

/**
 * Steer at the target and collide against the TRUE occluder grid (Q48).
 *
 * Axes resolve separately so a creature running at a trunk slides along it
 * rather than sticking — the same treatment players get, for the same reason.
 */
function move(
  world: WorldState,
  c: Creature,
  dt: number,
  speedMult: number,
  perimeterHolds: boolean,
): void {
  const target = c.target;
  if (!target) {
    c.vel.x = 0;
    c.vel.y = 0;
    return;
  }

  const dx = target.x - c.pos.x;
  const dy = target.y - c.pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) {
    c.vel.x = 0;
    c.vel.y = 0;
    return;
  }

  const speed = PLAYER_WALK_SPEED * speedMult;
  c.vel.x = (dx / dist) * speed;
  c.vel.y = (dy / dist) * speed;

  const wantX = clamp(c.pos.x + c.vel.x * dt, CREATURE_RADIUS, world.bounds.w - CREATURE_RADIUS);
  const wantY = clamp(c.pos.y + c.vel.y * dt, CREATURE_RADIUS, world.bounds.h - CREATURE_RADIUS);

  if (!blocked(world, wantX, c.pos.y) && allowed(world, wantX, c.pos.y, perimeterHolds)) {
    c.pos.x = wantX;
  }
  if (!blocked(world, c.pos.x, wantY) && allowed(world, c.pos.x, wantY, perimeterHolds)) {
    c.pos.y = wantY;
  }
}

/**
 * Q7: creatures may never cross the safe radius while the fire is at Low or
 * better. This is the only thing that makes camp a place rather than a
 * location, and it is checked on the destination rather than the origin so a
 * creature can always walk back out of a perimeter that just came up.
 */
function allowed(world: WorldState, x: number, y: number, perimeterHolds: boolean): boolean {
  if (!perimeterHolds) return true;
  const f = world.fire;
  const d = Math.hypot(x - f.pos.x, y - f.pos.y);
  if (d >= f.safeRadiusM) return true;
  // Already inside — the fire was relit around it. Let it leave.
  return false;
}

function blocked(world: WorldState, x: number, y: number): boolean {
  const r = CREATURE_RADIUS;
  return (
    isBlockedAt(world.grid, x - r, y - r) ||
    isBlockedAt(world.grid, x + r, y - r) ||
    isBlockedAt(world.grid, x - r, y + r) ||
    isBlockedAt(world.grid, x + r, y + r)
  );
}

/**
 * Q62: contact kills. No downed state, no grace — the ghost is the second
 * chance (L16) and it is wired up in Step 8.
 */
function contact(world: WorldState): void {
  for (const cid of Object.keys(world.creatures)) {
    const c = world.creatures[cid];
    if (!c || !c.alive) continue;

    for (const pid of Object.keys(world.players)) {
      const p = world.players[pid];
      if (!p || !p.alive) continue;
      if (Math.hypot(p.pos.x - c.pos.x, p.pos.y - c.pos.y) > CREATURE_CONTACT_M) continue;

      p.alive = false;
      p.vel.x = 0;
      p.vel.y = 0;
      p.chop = null;
      p.stokeProgress = 0;
      p.depositProgress = 0;
    }
  }
}

/**
 * Q24: three seconds to scatter the pile, hurling logs into the dark beyond
 * the safe radius. This is their primary sabotage and it is deliberately not
 * destruction — the wood is still out there, and going to get it is the cost.
 */
function scatterPile(world: WorldState, c: Creature): void {
  const r = rng(world, c);
  let thrown = 0;

  for (const kind of ITEM_KINDS) {
    while (world.woodpile.contents[kind] > 0 && thrown < CREATURE_SABOTAGE_TAKE) {
      world.woodpile.contents[kind]--;
      thrown++;
      hurl(world, kind, r);
    }
  }

  if (thrown > 0) emit(world, world.woodpile.pos, SOUND_RADIUS_GROWL_M, 'scatter');
}

/** Throw one item to a random open spot outside the fire's safe radius. */
function hurl(world: WorldState, kind: ItemKind, r: () => number): void {
  const origin = world.woodpile.pos;
  const minR = Math.max(world.fire.safeRadiusM, CREATURE_SABOTAGE_THROW_M);

  for (let attempt = 0; attempt < 10; attempt++) {
    const angle = r() * Math.PI * 2;
    const range = minR + r() * CREATURE_SABOTAGE_THROW_M;
    const x = clamp(origin.x + Math.cos(angle) * range, 1, world.bounds.w - 1);
    const y = clamp(origin.y + Math.sin(angle) * range, 1, world.bounds.h - 1);
    if (isBlockedAt(world.grid, x, y)) continue;
    spawnItem(world, kind, { x, y });
    return;
  }

  // Every direction blocked: drop it at the pile rather than deleting wood.
  spawnItem(world, kind, { x: origin.x, y: origin.y });
}

function pileHasWood(world: WorldState): boolean {
  return ITEM_KINDS.some((k) => world.woodpile.contents[k] > 0);
}

// ---------------------------------------------------------------------------
// Zones, wandering, and the deterministic PRNG
// ---------------------------------------------------------------------------

function zoneFor(name: ZoneName): { from: number; to: number } {
  const found = TUBE_ZONES.find((z) => z.name === name);
  // TUBE_ZONES is a non-empty literal tuple, but the index signature is still
  // widened by noUncheckedIndexedAccess; the fallback is unreachable in practice.
  return found ?? { from: 0, to: 0 };
}

/** The middle of a zone, across the tube's full width. */
export function zoneCentre(world: WorldState, name: ZoneName): Vec2 {
  const z = zoneFor(name);
  return { x: (z.from + z.to) / 2, y: world.bounds.h / 2 };
}

function inAssignedZone(c: Creature, slackM: number): boolean {
  const z = zoneFor(c.order.zone);
  return c.pos.x >= z.from - slackM && c.pos.x <= z.to + slackM;
}

/**
 * A point to drift toward inside the assigned zone.
 *
 * Rejection-sampled against the true grid so a patrol never picks a
 * destination inside rock and grinds against it for seven seconds.
 */
function wanderPoint(world: WorldState, c: Creature): Vec2 {
  const z = zoneFor(c.order.zone);
  const r = rng(world, c);

  for (let attempt = 0; attempt < 12; attempt++) {
    const x = z.from + r() * (z.to - z.from);
    const y = r() * world.bounds.h;
    if (!isBlockedAt(world.grid, x, y)) return { x, y };
  }

  return { x: c.pos.x, y: c.pos.y };
}

/**
 * Deterministic randomness.
 *
 * Seeded on the tick and the creature's id, so the same world state always
 * produces the same wander. The sim is replayed by every client for prediction
 * and a Math.random here would desync it — quietly, and only under movement.
 */
function rng(world: WorldState, c: Creature): () => number {
  let h = CREATURE_RNG_SEED ^ world.tick;
  for (let i = 0; i < c.id.length; i++) h = (Math.imul(h, 31) + c.id.charCodeAt(i)) | 0;
  return mulberry32(h >>> 0);
}

/**
 * How far a creature's footfalls carry at a given speed.
 *
 * Scaled off the player's own walk/sprint table (Q58) rather than given its own
 * numbers, so retuning what a player can hear retunes both sides together.
 */
function footfallRange(speedMps: number): number {
  const walk = PLAYER_WALK_SPEED;
  return (speedMps / walk) * 10;
}

function distanceTo(c: Creature, to: Vec2): number {
  return Math.hypot(to.x - c.pos.x, to.y - c.pos.y);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** A creature at the lair end of the tube, on its standing order. */
export function createCreature(id: string, pos: Vec2, zone: ZoneName): Creature {
  return {
    id,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    state: 'patrol',
    target: null,
    lastLight: null,
    lightMemorySec: 0,
    lastSound: null,
    soundMemorySec: 0,
    investigateSec: 0,
    sabotageSec: 0,
    sniffSec: CREATURE_SNIFF_MIN_SEC,
    patrolSec: 0,
    hits: 0,
    alive: true,
    respawnSec: 0,
    order: { verb: 'PATROL', zone },
  };
}

/** Q65: a kill buys about five quiet minutes, never a permanent thinning. */
export function killCreature(c: Creature): void {
  c.alive = false;
  c.respawnSec = CREATURE_RESPAWN_SEC;
  c.vel.x = 0;
  c.vel.y = 0;
}

function revive(world: WorldState, c: Creature): void {
  const lair = zoneFor('lair');
  c.alive = true;
  c.hits = 0;
  c.state = 'patrol';
  c.target = null;
  c.lastLight = null;
  c.lastSound = null;
  c.lightMemorySec = 0;
  c.soundMemorySec = 0;
  c.pos = { x: (lair.from + lair.to) / 2, y: world.bounds.h / 2 };
}
