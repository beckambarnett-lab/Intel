import {
  CREATURE_ARRIVE_M,
  CREATURE_CHARGE_RANGE_M,
  CREATURE_HEALTH,
  CREATURE_KILL_RANGE_M,
  CREATURE_RADIUS,
  CREATURE_RESPAWN_SEC,
  bodyBlocked,
  moveCreatures,
  mulberry32,
  vocalize,
} from '@ember/shared';
import type { Creature, Vec2, WorldState } from '@ember/shared';

/**
 * Tick stage 10 — tier one, instinct.
 *
 * What a creature does when nothing smarter is telling it anything. This is the
 * layer that has to carry the game on its own: the director can be slow, can be
 * rate-limited, can be switched off entirely with the API key removed, and the
 * creatures still have to be frightening. DESIGN.md Step 6 is blunt about it —
 * if they are not frightening on a script, no language model will save them.
 *
 * Right now this is deliberately thin: seek the last thing you sensed, sweep
 * when you have nothing. That is enough to make hooding your lantern and
 * standing still the correct play, which is the behaviour Step 6's gate asks
 * for, and it is the seam the belief field and utility scoring drop into next.
 * The tiers above will write goals and stances into the same fields this does,
 * so nothing downstream has to change when they arrive.
 */

/** Stable per-creature seed. Never Math.random — the sim must be replayable. */
function seedFor(creature: Creature, world: WorldState): number {
  let h = 2166136261;
  for (let i = 0; i < creature.id.length; i++) {
    h ^= creature.id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Only changes when a new wander is actually needed, so a creature commits to
  // a direction instead of jittering a fresh one every tick.
  return (h ^ Math.imul(world.tick, 2654435761)) >>> 0;
}

/** How far a sweep casts about from the anchor, in metres. */
const SWEEP_RADIUS_M = 26;
const SWEEP_ATTEMPTS = 10;

/**
 * Somewhere plausible to look next.
 *
 * Biased around the creature's anchor rather than its current position, so a
 * creature that has drifted a long way chasing something works its way back
 * instead of wandering off the end of the map.
 */
function wanderGoal(world: WorldState, creature: Creature): Vec2 {
  const rand = mulberry32(seedFor(creature, world));

  for (let i = 0; i < SWEEP_ATTEMPTS; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = SWEEP_RADIUS_M * Math.sqrt(rand());
    const p = {
      x: creature.anchor.x + Math.cos(angle) * radius,
      y: creature.anchor.y + Math.sin(angle) * radius,
    };

    if (p.x < CREATURE_RADIUS || p.y < CREATURE_RADIUS) continue;
    if (p.x > world.bounds.w - CREATURE_RADIUS) continue;
    if (p.y > world.bounds.h - CREATURE_RADIUS) continue;
    if (bodyBlocked(world.grid, p.x, p.y, CREATURE_RADIUS)) continue;

    return p;
  }

  return { ...creature.anchor };
}

function distanceTo(creature: Creature, p: Vec2): number {
  return Math.hypot(p.x - creature.pos.x, p.y - creature.pos.y);
}

/**
 * Choose this creature's stance and goal for the tick.
 *
 * The stance is what the player actually reads — a stalk moves smoothly and
 * purposefully, a sweep arcs and doubles back — so the choice here is as much
 * a communication decision as a tactical one.
 */
function decide(world: WorldState, creature: Creature): void {
  const contact = creature.contact;

  if (contact) {
    const range = distanceTo(creature, contact.pos);

    /**
     * Whether the creature is still sensing this, as opposed to walking to a
     * memory of it. The distinction is the whole of giving up: "I arrived and
     * found nothing" is only true if there is, in fact, nothing there now.
     *
     * Without it, arriving on top of a player it can plainly sense counts as
     * losing them — the creature stops a few centimetres outside its own kill
     * range, shrugs, and wanders off while they stand in front of it.
     */
    const sensingNow = contact.tick === world.tick;

    // Arrival is tested FIRST, and the order is load-bearing. Checking the
    // charge condition ahead of it lets a creature that has reached the last
    // known position keep satisfying "close enough to charge" forever: it
    // re-commits to a point it is already standing on, never gives up, never
    // calls, and the counterplay quietly stops existing.
    if (!sensingNow && range <= CREATURE_ARRIVE_M) {
      // Got there and found nothing. The trail is cold — say so, out loud, and
      // go back to searching. This beat is what the player earns by killing
      // their light and going somewhere else, and it has to be audible or they
      // never learn that it worked.
      creature.contact = null;
      creature.goal = null;
      // Forced: this fires seconds after the `contact` call, so the ordinary
      // cooldown would eat the one sound that tells the player they got away.
      vocalize(world, creature, 'lost', true);
    } else if (range <= CREATURE_CHARGE_RANGE_M && contact.via === 'light') {
      // Close enough, and sure enough, to commit. Committing is loud (Q69), and
      // that is the trade: the moment it decides to take you, you can hear it.
      creature.stance = 'charge';
      creature.goal = { ...contact.pos };
      vocalize(world, creature, 'contact');
      return;
    } else {
      creature.stance = 'stalk';
      creature.goal = { ...contact.pos };
      return;
    }
  }

  creature.stance = 'sweep';
  if (!creature.goal || distanceTo(creature, creature.goal) <= CREATURE_ARRIVE_M) {
    creature.goal = wanderGoal(world, creature);
  }
}

/**
 * Contact kills (Q62).
 *
 * No downed state and no wrestling free — reaching you is the whole threat, and
 * softening it would make every other system in the game less sharp. The ghost
 * that follows is Step 8; until then this just stops you.
 */
function resolveContact(world: WorldState): void {
  for (const cid of Object.keys(world.creatures)) {
    const creature = world.creatures[cid];
    if (!creature || !creature.alive) continue;

    for (const pid of Object.keys(world.players)) {
      const player = world.players[pid];
      if (!player || !player.alive) continue;

      if (distanceTo(creature, player.pos) <= CREATURE_KILL_RANGE_M) {
        player.alive = false;
        player.vel.x = 0;
        player.vel.y = 0;
      }
    }
  }
}

/** A killed creature walks back out of the lair after five minutes (Q57). */
function respawn(creature: Creature): void {
  if (creature.alive || creature.respawnSecLeft > 0) return;

  creature.alive = true;
  creature.health = CREATURE_HEALTH;
  creature.damageTaken = 0;
  creature.contact = null;
  creature.goal = null;
  creature.stance = 'sweep';
  creature.pos = { ...creature.anchor };
}

/**
 * Tick stage 10.
 *
 * Decisions first for every creature, then all the bodies move together. Doing
 * it in two passes rather than one keeps the tick order honest: no creature
 * gets to react to another creature's movement inside the same stage, which
 * would make behaviour depend on the iteration order of a hash map.
 */
export function creatureAct(world: WorldState, dt: number): void {
  for (const id of Object.keys(world.creatures)) {
    const creature = world.creatures[id];
    if (!creature) continue;

    // Cleared at the top of the stage rather than the bottom: the snapshot is
    // built after the tick, and a call has to survive long enough to be sent.
    creature.vocalizing = null;

    if (!creature.alive) {
      respawn(creature);
      continue;
    }

    decide(world, creature);
  }

  moveCreatures(world, dt);
  resolveContact(world);
}

/** Kill a creature. Step 7 calls this from combat; exposed here for tests. */
export function killCreature(creature: Creature): void {
  creature.alive = false;
  creature.health = 0;
  creature.goal = null;
  creature.contact = null;
  creature.vel = { x: 0, y: 0 };
  creature.respawnSecLeft = CREATURE_RESPAWN_SEC;
}
