import type { Campfire, InputFrame, Player, PlayerId } from './types.js';

export const PROTOCOL_VERSION = 2;

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
      campfire: Campfire;
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
