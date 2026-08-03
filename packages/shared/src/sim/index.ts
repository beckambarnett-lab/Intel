import { TICK_DT } from '../constants.js';
import type { TickInputs, WorldState } from '../types.js';
import { chopping } from './chopping.js';
import { creatureAct, creatureSense } from './creatures.js';
import { fire, winLose } from './fire.js';
import { items } from './items.js';
import { lantern } from './lantern.js';
import { applyInputs, integrate } from './movement.js';
import { emitSounds } from './sound.js';
import { weight } from './weight.js';

export * from './chopping.js';
export * from './creatures.js';
export * from './fire.js';
export * from './items.js';
export * from './lantern.js';
export * from './movement.js';
export * from './sound.js';
export * from './weight.js';

/**
 * THE tick order. It never varies, and every future system slots into a numbered
 * stage below rather than being appended wherever it happens to fit. Reordering
 * these is how a game like this acquires bugs that only reproduce under latency.
 *
 *   1  applyInputs        intent only, no movement yet          [Step 1] DONE
 *   2  weight             load -> speedMul, noiseMul            [Step 4] DONE
 *   3  movement           integrate, collide                    [Step 1] DONE
 *   4  emitSounds         movement/chop -> SoundEvent[]         [Step 6] DONE
 *   5  lantern            drain fuel by shutter stage           [Step 2] DONE
 *   6  fire               drain fuel, tier, radii, embers       [Step 3] DONE
 *   7  chopping           swings, fell trees, spawn logs        [Step 4] DONE
 *   8  items              pickup, drop, deposit, stoke          [Step 4] DONE
 *   9  creatureSense      light checks, then sound checks       [Step 6] DONE
 *   10 creatureAct        priority switch over the blackboard   [Step 6] DONE
 *   11 combat             shots, hits, desperation, deaths      [Step 7]
 *   12 ghosts             corpse decay, sacrifice ritual        [Step 8]
 *   13 crafting           station progress                     [Step 9]
 *   14 winLose            amulet home / embers dead / all dead  [Step 3] embers only
 *   15 writePerception    append to PerceptionLog (server only) [Step 10]
 *
 * MUST be deterministic: no Math.random, no Date.now, no iteration over
 * insertion-ordered structures that differ between client and server. The client
 * replays this function to predict, and any divergence shows up as rubber-banding
 * that is extremely hard to diagnose after the fact.
 */
export function step(world: WorldState, inputs: TickInputs, dt: number = TICK_DT): void {
  applyInputs(world, inputs); // 1
  weight(world); // 2
  integrate(world, dt); // 3
  emitSounds(world); // 4
  lantern(world, dt); // 5
  fire(world, dt); // 6
  chopping(world, inputs, dt); // 7
  items(world, inputs, dt); // 8
  creatureSense(world, dt); // 9
  creatureAct(world, dt); // 10
  winLose(world); // 14
  world.tick++;
}

/** Deep copy for network snapshots and for prediction rollback. */
export function cloneWorld(world: WorldState): WorldState {
  return structuredClone(world);
}
