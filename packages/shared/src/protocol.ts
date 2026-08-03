import type { MapKind } from './grid.js';
import type { Vec2 } from './math.js';
import type {
  Carrying,
  CreatureState,
  FireTier,
  InputFrame,
  Outcome,
  Player,
  PlayerId,
  WorldItem,
} from './types.js';

export const PROTOCOL_VERSION = 6;

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

/**
 * A creature, as a player who can see it is allowed to know it.
 *
 * Position and posture only. Everything the creature actually knows — what it
 * last saw, what it last heard, what it has been ordered to do — stays on the
 * server. The state is here because it is legible from looking at the thing:
 * a creature that has noticed you moves differently from one that has not, and
 * that read is the tell the whole hunt is played against.
 *
 * There is no sound channel in this protocol. Sound events carry positions and
 * sending them would hand over exactly what the culling refuses to (Q122); the
 * player's side of hearing is Q68's angle-and-confidence blip, computed
 * server-side in Step 7.
 */
export interface CreatureView {
  id: string;
  pos: Vec2;
  state: CreatureState;
}

/**
 * A lantern burning on the ground, as someone who can see it may know it (Q41).
 *
 * Culled like everything else, but it is its own light source, so the test is
 * whether YOU can see IT rather than whether it falls inside something else's
 * beam. A lit lantern across the wood is exactly as visible as Q45 says a
 * teammate's is — which is what lets a decoy work on players as well as
 * creatures.
 */
export interface DroppedLanternView {
  id: string;
  pos: Vec2;
  radiusM: number;
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
      /**
       * Creatures this player can see, culled exactly like players (Q122). A
       * hunter in the dark is not on the wire at all — which is what makes the
       * dark worth being afraid of.
       */
      creatures: CreatureView[];
      /** Lanterns burning on the ground that this player can see (Q41). */
      lanterns: DroppedLanternView[];
      /** The camp woodpile's contents. Only sent while you can see the pile. */
      woodpile: Carrying | null;
      fire: FireView;
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
