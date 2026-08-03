import {
  CREATURE_COUNT,
  DIRECTOR_PATROL_ZONES,
  DIRECTOR_REASSIGN_SEC,
  TUBE_ZONES,
  createCreature,
  isBlockedAt,
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

  /**
   * Populate the world with its hunters (Q56). Idempotent.
   *
   * They start IN their assigned zone, not at the lair. Spawning the whole
   * roster at the far end meant every creature opened the run with a walk of up
   * to 900m before it reached the ground it was supposed to be patrolling, so
   * for the first several minutes the map was simply empty.
   *
   * Q57 governs *respawn* — a killed creature does come back from the lair, and
   * that is untouched. This is only where they begin.
   */
  spawn(world: WorldState): void {
    if (Object.keys(world.creatures).length > 0) return;

    for (let i = 0; i < CREATURE_COUNT; i++) {
      const id = `c${i + 1}`;
      const zoneName = this.zoneFor(i);
      const zone = TUBE_ZONES.find((z) => z.name === zoneName);
      const from = zone?.from ?? 0;
      const to = zone?.to ?? 0;

      // Toward the FAR edge of the zone, offset per creature so two sharing a
      // zone are not stacked. Far rather than centred because the camp zone
      // reaches to x=0 and the bonfire sits at x=40 — a centred spawn there
      // would put a hunter ten metres from the fire on the first tick, which is
      // not an opening, it is an ambush.
      const t = 0.7 + 0.25 * (i / Math.max(1, CREATURE_COUNT));
      const x = from + t * (to - from);
      world.creatures[id] = createCreature(id, { x, y: this.clearY(world, x) }, zoneName);
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

  /**
   * A walkable y at this x, searched outward from the tube's centre line.
   *
   * The centre is nearly always clear, but rock is placed procedurally (Q107)
   * and a creature that spawns inside a boulder is stuck against it for the
   * whole run.
   */
  private clearY(world: WorldState, x: number): number {
    const mid = world.bounds.h / 2;
    if (!isBlockedAt(world.grid, x, mid)) return mid;

    for (let offset = 1; offset < world.bounds.h / 2; offset += 1) {
      if (!isBlockedAt(world.grid, x, mid + offset)) return mid + offset;
      if (!isBlockedAt(world.grid, x, mid - offset)) return mid - offset;
    }

    return mid;
  }

  private zoneFor(index: number): ZoneName {
    const zones = DIRECTOR_PATROL_ZONES;
    return zones[((index % zones.length) + zones.length) % zones.length] ?? 'nearWood';
  }
}
