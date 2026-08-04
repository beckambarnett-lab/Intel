import { SOUND_CHOP_PERIOD_TICKS, SOUND_RADIUS_M } from '../constants.js';
import type { Vec2 } from '../math.js';
import type { Player, WorldState } from '../types.js';
import { canSprint } from './weight.js';

/**
 * Sound (§9, Q58).
 *
 * The second half of the game's information economy. Light is how you see and
 * how you are seen; sound is what is left when the light is gone, and it is the
 * only channel that works in both directions through solid rock.
 *
 * The rule that makes it a game rather than a stat: **standing still is
 * genuinely silent** (Q58). Not quiet, not hard to hear — zero. A player who
 * stops moving emits nothing, and a creature hunting by ear has nothing to
 * hunt. That is the whole counterplay to being tracked, and every other number
 * in this file is calibrated around making stillness worth the seconds it costs.
 */

export type SoundKind = 'footfall' | 'chop' | 'gunshot' | 'call' | 'creature';

/**
 * One thing that made a noise, this tick and only this tick.
 *
 * Sounds do not linger in the world. Either something was in earshot as it
 * happened or it was not; what persists afterwards is the *memory* a creature
 * formed, which lives on the creature. Keeping the world's list ephemeral is
 * what stops "somebody chopped here four minutes ago" from being a fact the
 * simulation still knows.
 */
export interface SoundEvent {
  id: string;
  pos: Vec2;
  /** Audible radius in metres. Past this edge it did not happen. */
  loudness: number;
  kind: SoundKind;
  tick: number;
  /** Player or creature id, so a listener can ignore its own noise. */
  sourceId: string;
  /**
   * Whether a player made it. Creatures hunt player noise; their own footfalls
   * and calls travel the same system but are never something to investigate.
   */
  fromPlayer: boolean;
}

/** Below this speed a body counts as stationary, and stationary is silent. */
const MOVING_EPSILON = 0.01;

/**
 * How loud this player's movement is, in metres, before load is applied.
 *
 * Read off `vel` rather than off intent, which makes overload silent: past
 * capacity `speedMul` is zero, so a player who has picked up more than they can
 * bear is not walking and does not sound like it.
 *
 * A player shoving into a rock still registers, because `vel` is assigned
 * before collision resolves. That is the right answer rather than a leak in the
 * test: leaning on a trunk holding a direction is scuffling about, not standing
 * still, and the property the duel actually rests on is that *choosing* to stop
 * is silent — which it is, exactly and absolutely.
 */
export function movementSoundRadius(player: Player): number {
  const moving = Math.hypot(player.vel.x, player.vel.y) > MOVING_EPSILON;
  if (!moving) return SOUND_RADIUS_M.still;
  if (player.intent.creep) return SOUND_RADIUS_M.creep;
  if (player.intent.sprint && canSprint(player.loadKg)) return SOUND_RADIUS_M.sprint;
  return SOUND_RADIUS_M.walk;
}

/**
 * Append a sound to this tick's list.
 *
 * Ids come from the world counter rather than a random source: the client
 * replays `step()` to predict, and a random id would differ between the two
 * runs of the identical function.
 */
export function emitSound(
  world: WorldState,
  sound: Omit<SoundEvent, 'id' | 'tick'>,
): SoundEvent {
  const event: SoundEvent = {
    ...sound,
    id: `s${world.nextSoundId++}`,
    tick: world.tick,
  };
  world.sounds.push(event);
  return event;
}

/**
 * Tick stage 4 — emit this tick's sounds.
 *
 * Runs immediately after movement so a footfall is reported from where the foot
 * actually landed, and well before creature sensing at stage 9 so everything
 * audible this tick is on the list by the time anything listens.
 *
 * The list is cleared here rather than at the end of the tick: stages 9 and 10
 * are the consumers, and clearing after them would mean the server's perception
 * log and the client's audio never saw the same frame.
 */
export function emitSounds(world: WorldState): void {
  world.sounds.length = 0;

  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player || !player.alive) continue;

    const radius = movementSoundRadius(player) * player.noiseMul;
    if (radius > 0) {
      emitSound(world, {
        pos: { ...player.pos },
        loudness: radius,
        kind: 'footfall',
        sourceId: id,
        fromPlayer: true,
      });
    }

    // Chopping is the loudest thing you routinely do (Q17) — 20m, and the near
    // wood is only worth stripping because of it. Throttled to roughly one
    // report per swing rather than one per tick, so that a two-second chop is
    // two events in the perception log instead of forty.
    if (player.chop && world.tick % SOUND_CHOP_PERIOD_TICKS === 0) {
      emitSound(world, {
        pos: { ...player.pos },
        loudness: SOUND_RADIUS_M.chop,
        kind: 'chop',
        sourceId: id,
        fromPlayer: true,
      });
    }
  }
}

/** Was this sound audible at `listener`? Sound does not need line of sight. */
export function heard(sound: SoundEvent, listener: Vec2): boolean {
  if (sound.loudness <= 0) return false;
  const dx = sound.pos.x - listener.x;
  const dy = sound.pos.y - listener.y;
  return dx * dx + dy * dy <= sound.loudness * sound.loudness;
}
