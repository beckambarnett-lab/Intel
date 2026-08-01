import type { InputFrame, Player, PlayerId, WorldState } from './types.js';

export const PROTOCOL_VERSION = 1;

export type ClientMsg =
  | { t: 'join'; name: string; protocol: number }
  | { t: 'input'; frame: InputFrame };

export type ServerMsg =
  | { t: 'welcome'; playerId: PlayerId; tickRate: number; world: WorldState }
  | { t: 'reject'; reason: string }
  | {
      t: 'snapshot';
      tick: number;
      /**
       * Entities this player may see. From Step 2 onward this is culled
       * server-side (Q122) — a client is never sent what it cannot see, so
       * reading the socket must never reveal more than the screen does.
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
