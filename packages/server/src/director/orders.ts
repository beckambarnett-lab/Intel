import { CREATURE_VOCAL_RANGE_M, heard, vocalize } from '@ember/shared';
import type { Creature, Stance, Vec2, Vocalization, WorldState } from '@ember/shared';
import { bestSearchTarget } from '../creature/belief.js';
import type { BeliefField } from '../creature/belief.js';

/**
 * What a commander is allowed to say to a creature.
 *
 * This vocabulary is the most important design decision in the director stack,
 * and it is deliberately a set of *primitives* rather than a menu of named
 * behaviours. There is no `AMBUSH` verb, no `PINCER`, no `FLANK`.
 *
 * The reason is that a named-behaviour verb set can only ever produce the plans
 * somebody already thought of. If the model's entire action space is a list of
 * tactics a developer enumerated, then a three-line utility function can pick
 * from that same list about as well, and the expensive layer has nothing to
 * offer — it cannot demonstrate an idea nobody wrote down.
 *
 * Position, stance, a trigger to wait on, and what to become when it fires are
 * enough to *compose* an ambush: stand here, hold still, wait until you believe
 * they are within eight metres, then charge. Nothing in this file knows what an
 * ambush is. The same four fields compose a pincer, a decoy, a picket line, a
 * deliberate withdrawal to bait someone into the open — and, more to the point,
 * whatever the model comes up with that none of us considered.
 */

/** What wakes a creature out of a standing order. */
export type Trigger =
  /** A player noise of at least this loudness, within this range. */
  | { kind: 'sound'; minLoudness: number; withinM: number }
  /** Any light sensed within range. */
  | { kind: 'light'; withinM: number }
  /** Another creature called. This is how one springs a trap for the others. */
  | { kind: 'call'; from: 'any' | string }
  /** This creature's own belief puts somebody within range of it. */
  | { kind: 'beliefWithin'; m: number }
  /** Simply time — for staged movements and deliberate pauses. */
  | { kind: 'timer'; ticks: number };

export interface CreatureOrder {
  creatureId: string;
  /** Where to be. Always a map position or a belief-derived point. */
  goto?: Vec2;
  stance: Stance;
  /** What to wait for, if anything. */
  trigger?: Trigger;
  /** What to become when the trigger fires. */
  onTrigger?: Stance;
  /** A call to make on arrival — how a plan is signalled to the rest. */
  vocalize?: Vocalization;
  /**
   * Ticks this order remains binding.
   *
   * Every order expires. A creature whose orders have run out falls back to its
   * own instinct rather than standing there waiting for instructions, which is
   * what keeps a slow, rate-limited, or entirely absent director from ever
   * producing a pack of statues.
   */
  ttlTicks: number;
}

/** An order plus the bookkeeping needed to run it. */
export interface StandingOrder {
  order: CreatureOrder;
  /** Tick the order was issued, for timer triggers and expiry. */
  issuedTick: number;
  /** Set once the trigger has fired; a trigger fires at most once. */
  sprung: boolean;
  /** Set once the arrival call has been made, so it is not repeated. */
  called: boolean;
}

/** How close counts as having taken up an ordered position. */
const POST_ARRIVE_M = 3;

export function isExpired(standing: StandingOrder, tick: number): boolean {
  return tick - standing.issuedTick >= standing.order.ttlTicks;
}

/**
 * Has this order's trigger fired?
 *
 * Evaluated against what the creature itself can perceive — its own senses and
 * its own belief. A trigger cannot consult the world directly, so a commander
 * cannot use one to smuggle in knowledge the pack has not earned.
 */
export function triggerFired(
  world: WorldState,
  creature: Creature,
  belief: BeliefField,
  standing: StandingOrder,
): boolean {
  const trigger = standing.order.trigger;
  if (!trigger || standing.sprung) return false;

  switch (trigger.kind) {
    case 'timer':
      return world.tick - standing.issuedTick >= trigger.ticks;

    case 'light': {
      const contact = creature.contact;
      return (
        !!contact &&
        contact.via === 'light' &&
        contact.tick === world.tick &&
        distance(creature.pos, contact.pos) <= trigger.withinM
      );
    }

    case 'sound': {
      for (const sound of world.sounds) {
        if (!sound.fromPlayer) continue;
        if (sound.loudness < trigger.minLoudness) continue;
        if (distance(creature.pos, sound.pos) > trigger.withinM) continue;
        if (heard(sound, creature.pos)) return true;
      }
      return false;
    }

    case 'call': {
      // Another creature calling is what lets one spring a trap for the rest.
      for (const id of Object.keys(world.creatures)) {
        if (id === creature.id) continue;
        if (trigger.from !== 'any' && trigger.from !== id) continue;

        const other = world.creatures[id];
        if (!other?.vocalizing) continue;

        const range = CREATURE_VOCAL_RANGE_M[other.vocalizing];
        if (distance(creature.pos, other.pos) <= range) return true;
      }
      return false;
    }

    case 'beliefWithin': {
      const peak = bestSearchTarget(belief, creature.pos, world.tick);
      return !!peak && distance(creature.pos, peak.pos) <= trigger.m;
    }
  }
}

/**
 * Drive a creature from its standing order.
 *
 * Returns false when the order has run out, which is the caller's signal to
 * fall back to instinct.
 *
 * Orders take precedence over instinct while they last — including over a live
 * sighting — and that is deliberate rather than an oversight. A creature that
 * broke cover the instant it sensed anything could not lie in wait, and if it
 * cannot lie in wait then no trap is expressible and the whole vocabulary
 * collapses back into "chase the player". Holding position while it can sense
 * someone is exactly the discipline that makes an ambush an ambush; the
 * `trigger` is how a commander says when to stop holding.
 */
export function followOrder(
  world: WorldState,
  creature: Creature,
  belief: BeliefField,
  standing: StandingOrder,
): boolean {
  if (isExpired(standing, world.tick)) return false;

  const { order } = standing;

  if (!standing.sprung && triggerFired(world, creature, belief, standing)) {
    standing.sprung = true;
  }

  /**
   * A creature must travel to its post before it adopts the posture it was
   * given there.
   *
   * Without this, "go to (150, 40) and hold" is self-defeating: `hold` has a
   * speed of zero, so the creature holds wherever it already happens to be and
   * the ambush is set up in the wrong place. Every trap in the vocabulary would
   * silently misfire, and the symptom — creatures loitering somewhere
   * inexplicable — reads as bad AI rather than as a bug.
   *
   * The approach is a stalk rather than a sweep: something moving into position
   * for an ambush should arrive quietly, and stalk is the quiet gait.
   */
  const atPost = !order.goto || distance(creature.pos, order.goto) <= POST_ARRIVE_M;
  const travelling: Stance = order.stance === 'hold' ? 'stalk' : order.stance;

  creature.stance = standing.sprung && order.onTrigger
    ? order.onTrigger
    : atPost
      ? order.stance
      : travelling;

  if (standing.sprung && order.onTrigger) {
    // Once sprung, chase what it actually believes rather than the waypoint it
    // was sent to — the point of springing is that the plan is now in motion.
    const peak = bestSearchTarget(belief, creature.pos, world.tick);
    creature.goal = creature.contact ? { ...creature.contact.pos } : (peak?.pos ?? order.goto ?? null);
  } else {
    creature.goal = order.goto ? { ...order.goto } : null;
  }

  if (order.vocalize && !standing.called && atPost) {
    if (vocalize(world, creature, order.vocalize)) standing.called = true;
  }

  return true;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
