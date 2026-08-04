import {
  CREATURE_HEALTH,
  CREATURE_RADIUS,
  CREATURE_SNIFF_MAX_SEC,
  CREATURE_SOUND_RADIUS_M,
  CREATURE_STANCE_SPEED,
  CREATURE_VOCAL_COOLDOWN_SEC,
  CREATURE_VOCAL_RANGE_M,
  PLAYER_WALK_SPEED,
} from '../constants.js';
import { bodyBlocked } from '../grid.js';
import { clamp } from '../math.js';
import type { Vec2 } from '../math.js';
import type { WorldState } from '../types.js';
import { emitSound } from './sound.js';

/**
 * Creatures (§8) — the body.
 *
 * This file is tier zero of the creature stack: what a creature *is* and how it
 * moves. It contains no decisions. Where to go is chosen a layer up, on the
 * server, by the instinct tier and whatever the director has told it; this
 * module only ever carries out a goal that has already been picked.
 *
 * The split matters because tier zero is the only part the player perceives
 * directly. A creature's stance is legible in a two-second glimpse — a stalk
 * moves smoothly and purposefully, a sweep arcs and doubles back, a hold does
 * not move at all — and in a game played this dark, two seconds is usually all
 * you get. Everything clever that happens above this layer reaches the player
 * only through how a body moves and what it calls out.
 */

export type CreatureId = string;

/**
 * What a creature is doing with its body.
 *
 * Deliberately a small closed set. These are not behaviours in the sense of
 * "what is my plan" — they are postures, and the tiers above compose plans out
 * of them. A trap is a `hold` with a trigger attached, not a `TRAP` stance.
 */
export type Stance = 'hold' | 'stalk' | 'sweep' | 'charge' | 'withdraw' | 'sabotage';

/**
 * A call. The player's only direct window onto what the pack is doing.
 *
 * `summon` is the load-bearing one: it carries furthest, and every creature
 * that hears it inherits the caller's belief about where you are. Hearing one
 * answered from three directions is the pack agreeing on your position, and it
 * is meant to be the worst sound in the game.
 */
export type Vocalization = 'summon' | 'converge' | 'contact' | 'lost';

/**
 * Something a creature sensed, at the moment it sensed it.
 *
 * `pos` is a true position — a creature that sees your lantern genuinely knows
 * where the lantern was. What keeps this honest is that it can only ever be
 * written by the sensing stage, in response to a real light or sound event, and
 * that it decays. It is a memory of an observation, never a live feed.
 */
export interface Contact {
  pos: Vec2;
  /** How it was sensed. Light is sharp; sound is a direction and a guess. */
  via: 'light' | 'sound';
  /** Tick it was sensed, for ageing. */
  tick: number;
  /** 0..1. Drives how tightly the creature commits to the position. */
  confidence: number;
}

export interface Creature {
  id: CreatureId;
  pos: Vec2;
  vel: Vec2;
  /**
   * Where this creature calls home: the centre of its patrol when it has
   * nothing to chase, and where it returns from the lair after being killed
   * (Q57). Spread across the tube at spawn so the four of them are a territory
   * rather than a pack that always arrives together.
   */
  anchor: Vec2;
  /** Radians. Drives the sweep tell and positional audio. */
  facing: number;
  stance: Stance;
  /** Hits remaining (Q66). */
  health: number;
  alive: boolean;
  /** Seconds until it returns from the lair (Q57). */
  respawnSecLeft: number;
  /** Where the body is currently heading. Null means nowhere in particular. */
  goal: Vec2 | null;
  /** The most recent thing it sensed; the seed the belief field grows from. */
  contact: Contact | null;
  /** Seconds until it may call again. */
  vocalCooldown: number;
  /**
   * Set by the act stage, cleared at the top of the next one. One tick wide,
   * because a call is an event and the client renders it as one.
   */
  vocalizing: Vocalization | null;
  /** Seconds until the next sniff while hunting (Q69). */
  sniffIn: number;
  /**
   * Hits taken this life. Drives the desperation escalation in Step 7 (Q70) —
   * a wounded creature gets louder and more erratic, not weaker.
   */
  damageTaken: number;
}

export function createCreature(id: CreatureId, pos: Vec2): Creature {
  return {
    id,
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    anchor: { ...pos },
    facing: 0,
    stance: 'sweep',
    health: CREATURE_HEALTH,
    alive: true,
    respawnSecLeft: 0,
    goal: null,
    contact: null,
    vocalCooldown: 0,
    vocalizing: null,
    sniffIn: CREATURE_SNIFF_MAX_SEC,
    damageTaken: 0,
  };
}

/** Movement speed for a stance, in metres per second (Q61). */
export function creatureSpeed(stance: Stance): number {
  return PLAYER_WALK_SPEED * CREATURE_STANCE_SPEED[stance];
}

/** How far this creature's movement carries, in metres. */
export function creatureSoundRadius(creature: Creature): number {
  if (!creature.alive) return 0;
  const moving = Math.hypot(creature.vel.x, creature.vel.y) > 0.01;
  return moving ? CREATURE_SOUND_RADIUS_M[creature.stance] : 0;
}

/**
 * How old a contact is, in seconds. Infinite when there has never been one.
 */
export function contactAgeSec(creature: Creature, world: WorldState, dt: number): number {
  if (!creature.contact) return Infinity;
  return (world.tick - creature.contact.tick) * dt;
}

/**
 * Make a call, if the cooldown allows it.
 *
 * Returns whether it actually sounded. Callers must not assume — a creature
 * spamming `summon` every tick would flatten the one signal the player has, so
 * the cooldown is a gameplay constraint rather than a performance one.
 *
 * `force` exists for state changes that the player must never miss. Losing the
 * trail is the clearest example: it happens moments after the creature called
 * out that it had you, so an ordinary cooldown swallows it exactly when it
 * matters most, and the player never hears that going dark worked. A forced
 * call cannot be spammed because the transitions that use it clear the state
 * that produced them.
 */
export function vocalize(
  world: WorldState,
  creature: Creature,
  kind: Vocalization,
  force = false,
): boolean {
  if (!creature.alive) return false;
  if (creature.vocalCooldown > 0 && !force) return false;

  creature.vocalizing = kind;
  creature.vocalCooldown = CREATURE_VOCAL_COOLDOWN_SEC;

  emitSound(world, {
    pos: { ...creature.pos },
    loudness: CREATURE_VOCAL_RANGE_M[kind],
    kind: 'call',
    sourceId: creature.id,
    fromPlayer: false,
  });

  return true;
}

/**
 * Advance one creature's body toward its goal.
 *
 * Axes resolve separately, exactly as they do for players, so a creature taking
 * a corner at an angle slides along it rather than stopping dead. A hunter that
 * catches on geometry stops being frightening the moment you notice you can
 * farm it, and in the dark you will notice.
 */
export function moveCreature(world: WorldState, creature: Creature, dt: number): void {
  if (!creature.alive) {
    creature.vel.x = 0;
    creature.vel.y = 0;
    return;
  }

  const speed = creatureSpeed(creature.stance);
  const goal = creature.goal;

  if (!goal || speed <= 0) {
    creature.vel.x = 0;
    creature.vel.y = 0;
    return;
  }

  const dx = goal.x - creature.pos.x;
  const dy = goal.y - creature.pos.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 1e-4) {
    creature.vel.x = 0;
    creature.vel.y = 0;
    return;
  }

  creature.facing = Math.atan2(dy, dx);
  creature.vel.x = (dx / dist) * speed;
  creature.vel.y = (dy / dist) * speed;

  const maxX = world.bounds.w - CREATURE_RADIUS;
  const maxY = world.bounds.h - CREATURE_RADIUS;

  const wantX = clamp(creature.pos.x + creature.vel.x * dt, CREATURE_RADIUS, maxX);
  const wantY = clamp(creature.pos.y + creature.vel.y * dt, CREATURE_RADIUS, maxY);

  if (!blocked(world, wantX, creature.pos.y)) creature.pos.x = wantX;
  if (!blocked(world, creature.pos.x, wantY)) creature.pos.y = wantY;
}

/**
 * Solid rock, or the fire's defended perimeter (Q7).
 *
 * The perimeter is treated as geometry rather than as a decision so that no
 * amount of cleverness in the tiers above can talk a creature across it. While
 * the fire is at Low or better, camp is simply somewhere a creature cannot go;
 * `safeRadiusM` collapses to zero underneath that, and then it can.
 */
function blocked(world: WorldState, x: number, y: number): boolean {
  if (bodyBlocked(world.grid, x, y, CREATURE_RADIUS)) return true;

  const safe = world.fire.safeRadiusM;
  if (safe <= 0) return false;

  const dx = x - world.fire.pos.x;
  const dy = y - world.fire.pos.y;
  return dx * dx + dy * dy < safe * safe;
}

/**
 * Tick stage 10b — the body half of the act stage.
 *
 * Runs after the server has chosen goals and stances. Emits the creature's own
 * movement noise as it goes, which is what makes listen mode (Step 7) able to
 * hear the thing hunting you before you can see it.
 */
export function moveCreatures(world: WorldState, dt: number): void {
  for (const id of Object.keys(world.creatures)) {
    const creature = world.creatures[id];
    if (!creature) continue;

    if (creature.vocalCooldown > 0) {
      creature.vocalCooldown = Math.max(0, creature.vocalCooldown - dt);
    }

    if (!creature.alive) {
      creature.respawnSecLeft = Math.max(0, creature.respawnSecLeft - dt);
      continue;
    }

    moveCreature(world, creature, dt);

    const radius = creatureSoundRadius(creature);
    if (radius > 0) {
      emitSound(world, {
        pos: { ...creature.pos },
        loudness: radius,
        kind: 'creature',
        sourceId: creature.id,
        fromPlayer: false,
      });
    }
  }
}
