import {
  CREATURE_CONTACT_MEMORY_SEC,
  CREATURE_LIT_FIGURE_M,
  CREATURE_PROXIMITY_SENSE_M,
  LANTERN_STAGES,
  canSee,
  heard,
  lanternRadius,
  raycastLOS,
} from '@ember/shared';
import type { Contact, Creature, Player, WorldState } from '@ember/shared';

/**
 * Tick stage 9 — what the creatures can sense.
 *
 * This is the single most important file for fairness in the project. Every
 * fact any tier above this one is ever allowed to act on enters the simulation
 * here, in response to a real light or sound event. The instinct tier, the
 * belief field, and eventually both language models read downstream of this and
 * nowhere else — so if this file is correct, the enemy cannot cheat, and if it
 * is ever loosened, nothing downstream can detect that it was.
 *
 * The order is fixed by L12: **light first, and sound only when there is no
 * light to go on.** Creatures hunt your lantern. Kill the light and they lose
 * you entirely and fall back to their ears, which is the moment standing
 * perfectly still becomes the correct and terrifying answer (Q58).
 */

/**
 * How far off a lit lantern can be spotted (Q37).
 *
 * Keyed on the stage the shutter is travelling *toward*, matching how the
 * lantern burns fuel: opening up gives you away immediately, not once the
 * shutter finishes moving. A dry lantern throws no light and so cannot be seen
 * at all, which is what `lanternRadius` returning zero already encodes.
 */
function lanternSeenAtM(player: Player): number {
  if (lanternRadius(player.lantern) <= 0) return 0;
  return LANTERN_STAGES[player.lantern.target].seenAtM;
}

/**
 * The best light contact this creature has right now, or null.
 *
 * Two ways to be seen, and both need an unobstructed line — full shadowcasting
 * occlusion (Q44) is the whole tactical texture, and a creature that could see
 * your lantern through a trunk would delete it.
 */
function senseLight(world: WorldState, creature: Creature): Contact | null {
  let best: Contact | null = null;

  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player || !player.alive) continue;

    // 0. Close enough to simply find you. Silence is not invisibility, and a
    //    creature standing next to you in the dark has you regardless of what
    //    your shutter is doing.
    if (canSee(world.grid, creature.pos, CREATURE_PROXIMITY_SENSE_M, player.pos)) {
      return { pos: { ...player.pos }, via: 'light', tick: world.tick, confidence: 1 };
    }

    // 1. Their own lantern, at its stage's detection range.
    const seenAt = lanternSeenAtM(player);
    if (seenAt > 0 && canSee(world.grid, creature.pos, seenAt, player.pos)) {
      const dist = Math.hypot(player.pos.x - creature.pos.x, player.pos.y - creature.pos.y);
      // Nearer is sharper, but any lantern sighting is a good one.
      const confidence = 0.85 + 0.15 * (1 - Math.min(1, dist / seenAt));
      if (!best || confidence > best.confidence) {
        best = { pos: { ...player.pos }, via: 'light', tick: world.tick, confidence };
      }
      continue;
    }

    // 2. Standing in the firelight. Mirrors the rule players are held to for
    //    seeing each other (Q45) — being lit by the bonfire is exactly as
    //    revealing to a creature as it is to a teammate across the clearing.
    const fire = world.fire;
    const litByFire =
      canSee(world.grid, fire.pos, fire.lightRadiusM, player.pos) &&
      canSee(world.grid, creature.pos, CREATURE_LIT_FIGURE_M, player.pos);

    if (litByFire && (!best || best.confidence < 0.8)) {
      best = { pos: { ...player.pos }, via: 'light', tick: world.tick, confidence: 0.8 };
    }
  }

  return best;
}

/**
 * The loudest player noise in earshot, or null.
 *
 * Sound does not need line of sight — that asymmetry is the point of the whole
 * duel. You can break a creature's vision by stepping behind a rock, but not
 * its hearing, and the only way to beat its hearing is to stop moving.
 *
 * Confidence falls off across the audible radius. A footfall at the very edge
 * of earshot is a direction and little more, which is what makes a creature
 * arriving at roughly the right place feel like an animal rather than a homing
 * missile.
 */
function senseSound(world: WorldState, creature: Creature): Contact | null {
  let best: Contact | null = null;
  let bestScore = -1;

  for (const sound of world.sounds) {
    if (!sound.fromPlayer) continue;
    if (!heard(sound, creature.pos)) continue;

    const dist = Math.hypot(sound.pos.x - creature.pos.x, sound.pos.y - creature.pos.y);
    const closeness = 1 - Math.min(1, dist / sound.loudness);

    // Loud and close beats faint and close. A gunshot at 55m should pull harder
    // than a footfall at 9m, because it should — that is Q73 working.
    const score = sound.loudness * (0.35 + 0.65 * closeness);
    if (score <= bestScore) continue;

    bestScore = score;
    best = {
      pos: { ...sound.pos },
      via: 'sound',
      tick: world.tick,
      confidence: 0.2 + 0.55 * closeness,
    };
  }

  return best;
}

/** Has this contact aged past the point the creature still acts on it? */
function stale(contact: Contact, world: WorldState, dt: number): boolean {
  return (world.tick - contact.tick) * dt > CREATURE_CONTACT_MEMORY_SEC;
}

/**
 * Tick stage 9.
 *
 * A fresh contact always replaces an old one. A creature that has just seen
 * your light does not keep walking to where it heard you ten seconds ago.
 */
export function creatureSense(world: WorldState, dt: number): void {
  for (const id of Object.keys(world.creatures)) {
    const creature = world.creatures[id];
    if (!creature || !creature.alive) continue;

    const light = senseLight(world, creature);
    if (light) {
      creature.contact = light;
      continue;
    }

    const sound = senseSound(world, creature);
    if (sound) {
      creature.contact = sound;
      continue;
    }

    if (creature.contact && stale(creature.contact, world, dt)) {
      creature.contact = null;
    }
  }
}

/**
 * Can this creature currently see that point? Exposed for the instinct tier,
 * which needs it to know whether it has actually arrived at something or is
 * still walking toward an empty patch of wood.
 */
export function creatureCanSee(world: WorldState, creature: Creature, at: { x: number; y: number }): boolean {
  return raycastLOS(world.grid, creature.pos, at);
}
