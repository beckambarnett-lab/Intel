import { PERSONALITY_SPREAD, mulberry32 } from '@ember/shared';
import type { CreatureId } from '@ember/shared';

/**
 * Small hidden differences between the four hunters.
 *
 * Every trait sits near 0.5 and varies by `PERSONALITY_SPREAD`. That narrowness
 * is the design: these are meant to make a creature *recognisable* over a run,
 * not to make one of them harmless. A player should end a session with the
 * sense that the thing in the deep wood does not give up the way the one near
 * the ruins does, without ever being told there was a difference — and should
 * never be able to win by finding the weak one, because there isn't one.
 *
 * None of this is sent to a client, and none of it is shown. It reaches the
 * player only through where creatures go and how long they keep looking.
 *
 * The director gets to nudge these in Step 10, which is where the pack stops
 * being four temperaments and starts being four assigned roles.
 */
export interface Personality {
  /** Willingness to keep working a cold trail rather than drifting home. */
  patience: number;
  /** How early it commits to a charge, and how far it will chase. */
  aggression: number;
  /** How strongly it keeps its distance from the rest of the pack. */
  independence: number;
  /** How readily it calls out — and so how much it gives away. */
  vocality: number;
}

/**
 * Deterministic per creature and per run.
 *
 * Seeded from the creature id and the map seed rather than from a clock, so a
 * given run is reproducible: a headless pacing harness that produced different
 * personalities on every pass would be measuring noise.
 */
export function personalityFor(id: CreatureId, runSeed: number): Personality {
  let h = 2166136261 ^ runSeed;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const rand = mulberry32(h >>> 0);
  const trait = (): number => 0.5 + (rand() * 2 - 1) * PERSONALITY_SPREAD;

  return {
    patience: trait(),
    aggression: trait(),
    independence: trait(),
    vocality: trait(),
  };
}
