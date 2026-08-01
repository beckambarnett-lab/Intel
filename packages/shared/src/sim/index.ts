import { TICK_DT } from '../constants.js';
import type { TickInputs, WorldState } from '../types.js';
import { lantern } from './lantern.js';
import { applyInputs, integrate } from './movement.js';

export * from './lantern.js';
export * from './movement.js';

/**
 * THE tick order. It never varies, and every future system slots into a numbered
 * stage below rather than being appended wherever it happens to fit. Reordering
 * these is how a game like this acquires bugs that only reproduce under latency.
 *
 *   1  applyInputs        intent only, no movement yet          [Step 1] DONE
 *   2  weight             load -> speedMul, noiseMul            [Step 4]
 *   3  movement           integrate, collide                    [Step 1] DONE
 *   4  emitSounds         movement/chop/gun -> SoundEvent[]     [Step 6]
 *   5  lantern            drain fuel by shutter stage           [Step 2] DONE
 *   6  fire               drain fuel, tier, radii, embers       [Step 3]
 *   7  chopping           swings, fell trees, spawn logs        [Step 4]
 *   8  items              pickup, drop, deposit, stoke          [Step 4]
 *   9  creatureSense      light checks, then sound checks       [Step 6]
 *   10 creatureAct        behaviour tree over the blackboard    [Step 6]
 *   11 combat             shots, hits, desperation, deaths      [Step 7]
 *   12 ghosts             corpse decay, sacrifice ritual        [Step 8]
 *   13 crafting           station progress                     [Step 9]
 *   14 winLose            amulet home / embers dead / all dead  [Step 12]
 *   15 writePerception    append to PerceptionLog (server only) [Step 10]
 *
 * Stage 2 is folded into applyInputs for now because load is the only weight
 * input that exists; it becomes its own stage in Step 4.
 *
 * MUST be deterministic: no Math.random, no Date.now, no iteration over
 * insertion-ordered structures that differ between client and server. The client
 * replays this function to predict, and any divergence shows up as rubber-banding
 * that is extremely hard to diagnose after the fact.
 */
export function step(world: WorldState, inputs: TickInputs, dt: number = TICK_DT): void {
  applyInputs(world, inputs); // 1
  integrate(world, dt); // 3
  lantern(world, dt); // 5
  world.tick++;
}

/** Deep copy for network snapshots and for prediction rollback. */
export function cloneWorld(world: WorldState): WorldState {
  return structuredClone(world);
}
