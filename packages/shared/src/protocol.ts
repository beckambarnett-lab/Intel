import type { MapKind } from './grid.js';
import type { Vec2 } from './math.js';
import type { Stance, Vocalization } from './sim/creatures.js';
import type {
  Carrying,
  FireTier,
  InputFrame,
  Outcome,
  Player,
  PlayerId,
  WorldItem,
} from './types.js';

export const PROTOCOL_VERSION = 5;

/**
 * A creature as a client is permitted to know it.
 *
 * Emphatically **not** a `Creature`. The full struct carries `contact` — where
 * this creature last sensed a player — which is a true position belonging to
 * somebody else. Shipping the whole object would hand every client a live feed
 * of wherever any creature has recently seen anyone, which is a worse leak than
 * the one visibility culling exists to prevent.
 *
 * What survives is what you could work out by looking at it: where it is, which
 * way it faces, and what it is doing. `stance` is included deliberately — the
 * difference between a creature stalking with purpose and one sweeping because
 * it has lost you is the game's main readable tell, and it has to reach the
 * renderer to be read.
 */
export interface CreatureView {
  id: string;
  pos: Vec2;
  facing: number;
  stance: Stance;
  alive: boolean;
}

/**
 * A call you were in earshot of this tick.
 *
 * Position rather than a bearing, and that is the design rather than an
 * oversight: a call is loud and echoing, it carries far past what you can see,
 * and locating the caller is exactly the gift it hands you. That gift is what
 * makes calling a real cost for the pack instead of free coordination — the
 * summon that gathers three others onto you also tells you where all four are
 * about to be. The vaguer, harder-won sound picture is listen mode in Step 7.
 */
export interface CallEvent {
  kind: Vocalization;
  pos: Vec2;
}

/**
 * What a client is told about the fire.
 *
 * The glow carries down the whole tube (Q13), so its tier and radius are
 * public — that is the navigation system and hiding it would break it. The
 * exact fuel number is not: Q127 says fire fuel is only legible when you are
 * near the fire, so `fuel` and `emberSecLeft` are omitted unless you are close
 * enough to read them off the flame. From 800m you can see how bright it is,
 * not how many seconds are left.
 */
export interface FireView {
  pos: Vec2;
  tier: FireTier;
  lightRadiusM: number;
  safeRadiusM: number;
  dead: boolean;
  /** Present only within the firelight. */
  fuel?: number;
  emberSecLeft?: number;
}

export type ClientMsg =
  | { t: 'join'; name: string; protocol: number }
  | { t: 'input'; frame: InputFrame };

export type ServerMsg =
  | {
      t: 'welcome';
      playerId: PlayerId;
      tickRate: number;
      tick: number;
      bounds: { w: number; h: number };
      /**
       * The map is sent as a seed, not as tiles. The client rebuilds identical
       * geometry from it with the same shared code the server used.
       *
       * Static geometry is not secret — you are meant to learn the wood, and
       * Step 5's memory rot is about how you *remember* terrain you have seen,
       * not about hiding where it is. What must never be sent is where the
       * other entities are; that is what `snapshot` culls (Q122).
       */
      mapSeed: number;
      /**
       * Which generator built the world. The seed alone is not enough — the
       * client rebuilds geometry locally for prediction and lighting, and if it
       * picks a different generator it will disagree with the server about
       * collision. That shows up as constant reconciliation corrections rather
       * than as an obvious error.
       */
      mapKind: MapKind;
      fire: FireView;
      /**
       * Your own player, and only yours. Sending the full world here would leak
       * every spawn position before the first snapshot ever culls anything.
       */
      you: Player;
    }
  | { t: 'reject'; reason: string }
  | {
      t: 'snapshot';
      tick: number;
      /**
       * Entities this player may see, culled server-side (Q122). A client is
       * never sent what it cannot see, so reading the socket in devtools must
       * never reveal more than the screen already does.
       */
      players: Player[];
      /**
       * Highest input seq the server has consumed from THIS client. Everything
       * after it is still pending and gets replayed during reconciliation.
       */
      ack: number;
      /**
       * Items on the ground this player can see. Culled exactly like players:
       * wood in the dark is invisible to everyone including whoever put it
       * there (Q21).
       */
      items: WorldItem[];
      /**
       * Occluder tiles this player can see to have been cleared by felling
       * (Q20). The client applies them to its own grid, which is what makes
       * the new sightline open on its side too.
       */
      felled: { x: number; y: number }[];
      /** The camp woodpile's contents. Only sent while you can see the pile. */
      woodpile: Carrying | null;
      fire: FireView;
      /**
       * Creatures this player can currently see, culled by exactly the same
       * test as players are (Q122). In the dark this list is empty far more
       * often than not, which is the intended experience.
       */
      creatures: CreatureView[];
      /**
       * Calls made within earshot this tick. Not gated on sight — hearing one
       * you cannot see is the entire point of them.
       */
      calls: CallEvent[];
      /** Non-null once the run has ended. */
      outcome: Outcome | null;
    };

export function encode(msg: ClientMsg | ServerMsg): string {
  return JSON.stringify(msg);
}

export function decode<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
