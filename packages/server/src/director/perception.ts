import { PERCEPTION_RETENTION_SEC, TICK_DT } from '@ember/shared';
import type { CreatureId, SoundKind, Stance, Vec2 } from '@ember/shared';

/**
 * Everything the pack has actually perceived — and the only thing the director
 * is ever allowed to read.
 *
 * This file and `context.ts` together are the fairness boundary (Q114), the
 * single most important structural rule in the project. The reasoning is worth
 * stating plainly, because the failure it prevents is invisible from the
 * outside: an enemy that is handed live player positions does not look like a
 * cheating enemy, it looks like a *brilliant* one. Playtesting cannot
 * distinguish the two. Nobody files a bug. The game simply stops being fair and
 * nobody can say why.
 *
 * So the boundary is structural rather than behavioural. Not "the prompt asks
 * the model not to use positions it should not have" — the model is never given
 * them. Every fact reaching the director passes through this log, and the only
 * code that writes to this log is the creature sensing path, which can only
 * record what a creature genuinely saw or heard.
 *
 * The log is deliberately the *digested* form. `context.ts` imports this module
 * and nothing else — no world, no types, no shared package — so the set of
 * facts the director can possibly see is exactly the set of fields below. A
 * future edit cannot quietly widen it without adding an import, which is
 * exactly what the boundary test and the lint rule watch for.
 */

/** A light one of the creatures actually saw. */
export interface LightObservation {
  /** Where the light was, when it was seen. Never a live position. */
  pos: Vec2;
  /** How bright, 0..1 — a hooded lantern and a bonfire are not the same news. */
  brightness: number;
  tick: number;
  by: CreatureId;
}

/** A noise one of the creatures actually heard. */
export interface SoundObservation {
  pos: Vec2;
  /** Audible radius in metres, which is the only measure of "how loud". */
  loudness: number;
  kind: SoundKind;
  tick: number;
  by: CreatureId;
}

/** A creature reporting on itself. Its own position is its own business. */
export interface CreatureReport {
  id: CreatureId;
  pos: Vec2;
  health: number;
  stance: Stance;
  alive: boolean;
  /**
   * Where this creature currently thinks somebody is, and how strongly.
   *
   * This is a *belief*, derived by decay and diffusion from observations the
   * creature earned — never a lookup. It is the only spatial claim about a
   * player that the director ever receives, and it is wrong in exactly the ways
   * the creature's own information is wrong.
   */
  believes: { pos: Vec2; mass: number } | null;
}

/** The world as the pack has managed to observe it. */
export interface PerceptionSnapshot {
  tick: number;
  elapsedSec: number;
  lights: LightObservation[];
  sounds: SoundObservation[];
  creatures: CreatureReport[];
  /**
   * The bonfire's tier, and only when a creature currently has line of sight to
   * camp (Q113). Knowing the fire is guttering is enormously valuable — it is
   * the whole clock — and it must be earned by having something standing where
   * it can see the flame, not read off the simulation.
   */
  fireTier: string | null;
}

/**
 * The log. Append-only within a retention window, cleared between runs.
 *
 * Held server-side and never placed on `WorldState`: the world is
 * `structuredClone`d for snapshots and prediction, and this contains real
 * positions. It must have no route toward a wire.
 */
export class PerceptionLog {
  private lights: LightObservation[] = [];
  private sounds: SoundObservation[] = [];
  private creatures: CreatureReport[] = [];
  private fireTier: string | null = null;
  private tick = 0;
  private elapsedSec = 0;

  clear(): void {
    this.lights = [];
    this.sounds = [];
    this.creatures = [];
    this.fireTier = null;
    this.tick = 0;
    this.elapsedSec = 0;
  }

  recordLight(observation: LightObservation): void {
    this.lights.push(observation);
  }

  recordSound(observation: SoundObservation): void {
    this.sounds.push(observation);
  }

  /** Replaced wholesale each tick — the roster is a state, not a history. */
  setCreatures(reports: CreatureReport[]): void {
    this.creatures = reports;
  }

  /** Null unless a creature can currently see the camp. */
  setFireTier(tier: string | null): void {
    this.fireTier = tier;
  }

  setClock(tick: number, elapsedSec: number): void {
    this.tick = tick;
    this.elapsedSec = elapsedSec;
  }

  /** Drop observations older than the retention window. */
  prune(): void {
    const cutoff = this.tick - PERCEPTION_RETENTION_SEC / TICK_DT;
    this.lights = this.lights.filter((o) => o.tick >= cutoff);
    this.sounds = this.sounds.filter((o) => o.tick >= cutoff);
  }

  snapshot(): PerceptionSnapshot {
    return {
      tick: this.tick,
      elapsedSec: this.elapsedSec,
      lights: this.lights.map((o) => ({ ...o, pos: { ...o.pos } })),
      sounds: this.sounds.map((o) => ({ ...o, pos: { ...o.pos } })),
      creatures: this.creatures.map((c) => ({
        ...c,
        pos: { ...c.pos },
        believes: c.believes ? { ...c.believes, pos: { ...c.believes.pos } } : null,
      })),
      fireTier: this.fireTier,
    };
  }
}
