import {
  BELIEF_MASS_LIGHT,
  BELIEF_MASS_SOUND,
  BELIEF_SPREAD_LIGHT,
  BELIEF_SPREAD_SOUND,
  BELIEF_SUMMON_TRANSFER,
  CREATURE_THINK_PERIOD_TICKS,
  CREATURE_VOCAL_RANGE_M,
  TICK_DT,
  moveCreatures,
  raycastLOS,
} from '@ember/shared';
import type { CreatureId, SimHooks, WorldState } from '@ember/shared';
import { PerceptionLog } from '../director/perception.js';
import type { CreatureReport } from '../director/perception.js';
import {
  ageBelief,
  bestSearchTarget,
  blendBelief,
  createBelief,
  injectBelief,
  markChecked,
} from './belief.js';
import { decide, resolveContact, respawn } from './instinct.js';
import type { Mind } from './instinct.js';
import { personalityFor } from './personality.js';
import { creatureSense } from './senses.js';

/**
 * Everything the creatures know, and the only place it lives.
 *
 * Belief fields and personalities are deliberately held here rather than on
 * `WorldState`. The world is `structuredClone`d for snapshots and for
 * prediction rollback, and a creature's belief is both bulky and precisely the
 * category of thing that must never drift toward a wire — it is derived from
 * real player positions, and shipping it would be a worse leak than the one
 * per-player culling exists to prevent. Keeping it off the world means there is
 * no code path that could serialise it by accident.
 *
 * This class is also where Step 10's director will attach. The tiers above will
 * write goals and stances into the same creature fields `decide` does, and read
 * the same belief fields, so nothing below has to change when they arrive.
 */
export class CreatureMind {
  private minds = new Map<CreatureId, Mind>();
  private readonly perception = new PerceptionLog();

  constructor(private readonly runSeed: number) {}

  /** Fresh minds for a fresh run. Belief must never survive a reset. */
  reset(): void {
    this.minds.clear();
    this.perception.clear();
  }

  private mindFor(world: WorldState, id: CreatureId): Mind {
    let mind = this.minds.get(id);
    if (!mind) {
      mind = {
        belief: createBelief(world.bounds.w, world.bounds.h),
        personality: personalityFor(id, this.runSeed),
      };
      this.minds.set(id, mind);
    }
    return mind;
  }

  /** Read-only access for tests and, later, the director's context builder. */
  peek(id: CreatureId): Mind | undefined {
    return this.minds.get(id);
  }

  /**
   * Tick stage 9 — sense, then fold what was sensed into belief.
   *
   * Sensing runs every tick because it is cheap and because missing the one
   * frame a lantern was open would be badly unfair. Belief is updated at the
   * tactical rate instead: it is the expensive half, and a distribution that
   * ages twenty times a second is no better a model than one that ages four.
   */
  sense(world: WorldState, dt: number): void {
    creatureSense(world, dt);

    if (world.tick % CREATURE_THINK_PERIOD_TICKS !== 0) return;
    const thinkDt = CREATURE_THINK_PERIOD_TICKS * TICK_DT;

    for (const id of Object.keys(world.creatures)) {
      const creature = world.creatures[id];
      if (!creature || !creature.alive) continue;

      const mind = this.mindFor(world, id);

      // Order is load-bearing. Age first, so an observation made this tick is
      // not immediately decayed. Clear the ground underfoot next, because a
      // creature standing somewhere knows you are not there. Inject last, so
      // that if it *is* sensing you right here, that survives the clearing.
      ageBelief(mind.belief, thinkDt);
      markChecked(mind.belief, creature.pos, world.tick);

      const contact = creature.contact;
      if (contact && contact.tick === world.tick) {
        const light = contact.via === 'light';
        injectBelief(
          mind.belief,
          contact.pos,
          (light ? BELIEF_MASS_LIGHT : BELIEF_MASS_SOUND) * contact.confidence,
          light ? BELIEF_SPREAD_LIGHT : BELIEF_SPREAD_SOUND,
        );

        // The director's log is written here, at the moment of sensing, and
        // nowhere else (Q113). Everything the commander will ever know enters
        // the system on this line — which is what makes the boundary a property
        // of the code's shape rather than a rule somebody has to remember.
        const observation = {
          pos: { ...contact.pos },
          tick: world.tick,
          by: creature.id,
        };
        if (light) {
          this.perception.recordLight({ ...observation, brightness: contact.confidence });
        } else {
          this.perception.recordSound({
            ...observation,
            loudness: contact.confidence * 60,
            kind: 'footfall',
          });
        }
      }
    }
  }

  /**
   * Tick stage 15 — assemble the per-tick digest.
   *
   * Observations were written as they were sensed; this records the settled
   * state around them: who is left, what they believe, and whether anybody can
   * currently see the fire.
   */
  writePerception(world: WorldState, _dt: number): void {
    const reports: CreatureReport[] = [];

    for (const id of Object.keys(world.creatures)) {
      const creature = world.creatures[id];
      if (!creature) continue;

      const mind = this.mindFor(world, id);
      const peak = creature.alive
        ? bestSearchTarget(mind.belief, creature.pos, world.tick)
        : null;

      reports.push({
        id,
        pos: { ...creature.pos },
        health: creature.health,
        stance: creature.stance,
        alive: creature.alive,
        believes: peak ? { pos: { ...peak.pos }, mass: peak.mass } : null,
      });
    }

    this.perception.setCreatures(reports);
    this.perception.setClock(world.tick, world.runSec);

    // The fire's tier is worth a great deal — it is the run's clock — so it has
    // to be earned by having something standing where it can see the flame
    // (Q113), not read off the simulation.
    const canSeeCamp = Object.keys(world.creatures).some((id) => {
      const creature = world.creatures[id];
      return !!creature && creature.alive && raycastLOS(world.grid, creature.pos, world.fire.pos);
    });
    this.perception.setFireTier(canSeeCamp ? world.fire.tier : null);

    this.perception.prune();
  }

  /** The director's view. Read-only, and the only thing Step 10 may consume. */
  get log(): PerceptionLog {
    return this.perception;
  }

  /**
   * Tick stage 10 — decide, propagate calls, then move every body.
   *
   * Three passes rather than one, and the separation matters: no creature gets
   * to react to another creature's movement inside the same stage, which would
   * make the pack's behaviour depend on the iteration order of a hash map.
   */
  act(world: WorldState, dt: number): void {
    const thinking = world.tick % CREATURE_THINK_PERIOD_TICKS === 0;

    for (const id of Object.keys(world.creatures)) {
      const creature = world.creatures[id];
      if (!creature) continue;

      // Cleared at the top rather than the bottom: the snapshot is built after
      // the tick, and a call has to survive long enough to be sent.
      creature.vocalizing = null;

      if (!creature.alive) {
        respawn(creature);
        continue;
      }

      if (thinking) decide(world, creature, this.mindFor(world, id));
    }

    this.propagateCalls(world);
    moveCreatures(world, dt);
    resolveContact(world);
  }

  /**
   * A summon hands the caller's picture of you to everything in earshot.
   *
   * This is what makes calling a mechanic instead of a sound effect. Three
   * creatures converging on you from different angles is not scripted
   * coordination — it is three belief fields that now agree, because one of
   * them shouted. It is also why calling costs something: the call that gathers
   * the pack is the same call that tells you where all of them are about to be.
   *
   * Resolved inside the tick that produced it. Sounds are cleared at stage 4,
   * so a call emitted at stage 10 is gone before the next tick's sensing runs.
   */
  private propagateCalls(world: WorldState): void {
    for (const callerId of Object.keys(world.creatures)) {
      const caller = world.creatures[callerId];
      if (!caller || caller.vocalizing !== 'summon') continue;

      const source = this.minds.get(callerId);
      if (!source) continue;

      for (const hearerId of Object.keys(world.creatures)) {
        if (hearerId === callerId) continue;
        const hearer = world.creatures[hearerId];
        if (!hearer || !hearer.alive) continue;

        const d = Math.hypot(hearer.pos.x - caller.pos.x, hearer.pos.y - caller.pos.y);
        if (d > CREATURE_VOCAL_RANGE_M.summon) continue;

        blendBelief(this.mindFor(world, hearerId).belief, source.belief, BELIEF_SUMMON_TRANSFER);
      }
    }
  }

  /** The three server-only stages, bound to this instance. */
  hooks(): SimHooks {
    return {
      creatureSense: (world, dt) => this.sense(world, dt),
      creatureAct: (world, dt) => this.act(world, dt),
      writePerception: (world, dt) => this.writePerception(world, dt),
    };
  }
}
