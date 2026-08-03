import {
  CREATURE_COUNT,
  DIRECTOR_PATROL_ZONES,
  DIRECTOR_REASSIGN_SEC,
  TUBE_ZONES,
  createCreature,
} from '@ember/shared';
import type { WorldState, ZoneName } from '@ember/shared';

/**
 * The scripted director (§21 Step 6.5, Q117).
 *
 * **This ships and stays forever.** It is not scaffolding for the LLM — it is
 * the failure path the LLM falls back to after three consecutive errors, and
 * the thing that makes "the game plays correctly with the API key removed
 * entirely" true rather than aspirational. Step 10 adds a commander above it;
 * it does not replace this.
 *
 * What it does is deliberately modest: hand every creature a zone to patrol and
 * rotate the assignments occasionally so the wood does not settle into a fixed,
 * learnable pattern. It has no idea where the players are and it never asks —
 * the creatures' own senses (stage 9) are the only thing that finds anybody.
 * That constraint is not a limitation of the fallback, it is the same fairness
 * boundary Q114 puts on the LLM, and having the scripted director obey it too
 * means the two are genuinely interchangeable.
 */
export class ScriptedDirector {
  private sinceReassignSec = 0;
  private rotation = 0;

  /** Populate the world with its hunters (Q56). Idempotent. */
  spawn(world: WorldState): void {
    if (Object.keys(world.creatures).length > 0) return;

    const lair = TUBE_ZONES.find((z) => z.name === 'lair');
    const from = lair?.from ?? 0;
    const to = lair?.to ?? 0;

    for (let i = 0; i < CREATURE_COUNT; i++) {
      const id = `c${i + 1}`;
      // Spread along the lair end rather than stacked on one point, so the
      // opening minutes are not four creatures walking in single file.
      const x = from + ((i + 1) / (CREATURE_COUNT + 1)) * (to - from);
      const y = world.bounds.h / 2;
      world.creatures[id] = createCreature(id, { x, y }, this.zoneFor(i));
    }
  }

  /**
   * Reconsider assignments. Called every tick; acts every
   * DIRECTOR_REASSIGN_SEC, which is the same cadence Q111 gives the LLM so
   * that swapping one for the other does not change how twitchy the wood feels.
   */
  update(world: WorldState, dt: number): void {
    this.sinceReassignSec += dt;
    if (this.sinceReassignSec < DIRECTOR_REASSIGN_SEC) return;
    this.sinceReassignSec = 0;
    this.rotation++;

    const ids = Object.keys(world.creatures).sort();
    for (let i = 0; i < ids.length; i++) {
      const c = world.creatures[ids[i] ?? ''];
      if (!c) continue;
      c.order = { verb: 'PATROL', zone: this.zoneFor(i + this.rotation) };
    }
  }

  private zoneFor(index: number): ZoneName {
    const zones = DIRECTOR_PATROL_ZONES;
    return zones[((index % zones.length) + zones.length) % zones.length] ?? 'nearWood';
  }
}
