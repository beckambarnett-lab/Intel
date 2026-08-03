import {
  SOUND_MOVING_EPSILON_MPS,
  SOUND_RADIUS_M,
} from '../constants.js';
import type { SoundEvent, SoundKind, WorldState } from '../types.js';
import type { Vec2 } from '../math.js';

/**
 * Tick stage 4 — what the world just made a noise doing.
 *
 * Sounds live for exactly one tick. The list is cleared and rebuilt here, so a
 * creature sensing at stage 9 is reacting to this tick's noise and nothing
 * older; persistence is the creature's memory (`soundMemorySec`), not the
 * event's. That split is what makes standing still work — the moment you stop,
 * there is nothing in the list, and there is no decaying trail to follow.
 *
 * Q58 is the range table and it is absolute: standing still is 0m, which is
 * genuinely inaudible rather than quiet. The whole duel rests on that being
 * literally true.
 */
export function emitSounds(world: WorldState): void {
  world.sounds.length = 0;

  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player || !player.alive) continue;

    // Chopping is the loudest thing you routinely do (Q17), and it is loud
    // whether or not you are also moving.
    if (player.chop) {
      emit(world, player.pos, SOUND_RADIUS_M.chop * player.noiseMul, 'chop');
    }

    const speed = Math.hypot(player.vel.x, player.vel.y);
    if (speed <= SOUND_MOVING_EPSILON_MPS) continue;

    // Which gait, by what they asked for rather than by measured speed: a
    // heavily loaded sprint is slower than an empty walk, and it should still
    // be the louder of the two.
    const base = player.intent.creep
      ? SOUND_RADIUS_M.creep
      : player.intent.sprint
        ? SOUND_RADIUS_M.sprint
        : SOUND_RADIUS_M.walk;

    // Load makes you louder (Q36). Stage 2 already worked out by how much.
    emit(world, player.pos, base * player.noiseMul, 'footfall');
  }
}

/**
 * Add a sound to this tick's list.
 *
 * Exported because creatures make noise too (Q69) and they act at stage 10,
 * after this stage has run. Those land in the list and are heard on the next
 * tick, which is correct: nothing hears a sound before it is made.
 */
export function emit(world: WorldState, pos: Vec2, loudnessM: number, kind: SoundKind): void {
  if (loudnessM <= 0) return;
  world.sounds.push({ pos: { x: pos.x, y: pos.y }, loudnessM, kind, tick: world.tick });
}

/**
 * The loudest thing audible from `at`, or null in real silence.
 *
 * "Audible" is the event's own radius, not a fixed listening range — a gunshot
 * carries 60m and a crouch-creep 3m (Q58), so the emitter decides who hears it.
 * Ties break on the lower index, which is emission order and therefore stable.
 */
export function loudestAudibleAt(
  world: WorldState,
  at: Vec2,
  ignore?: (s: SoundEvent) => boolean,
): SoundEvent | null {
  let best: SoundEvent | null = null;
  let bestLoudness = 0;

  for (const s of world.sounds) {
    if (ignore?.(s)) continue;
    const d = Math.hypot(s.pos.x - at.x, s.pos.y - at.y);
    if (d > s.loudnessM) continue;
    if (s.loudnessM > bestLoudness) {
      best = s;
      bestLoudness = s.loudnessM;
    }
  }

  return best;
}
