import { PROTOCOL_VERSION, decode, encode } from '@ember/shared';
import type { ClientMsg, PlayerId } from '@ember/shared';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import type { MapKind } from '@ember/shared';

export interface EmberServer {
  room: Room;
  wss: WebSocketServer;
  /** Resolves once the port is actually bound and accepting connections. */
  ready: Promise<void>;
  /** The bound port. Differs from the requested one when passed 0. */
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Wire a Room to a WebSocket server. Extracted from the entrypoint so tests can
 * stand up a real server on an ephemeral port and drive it with real clients —
 * netcode that is only ever tested by hand is netcode that breaks silently.
 */
export function createServer(
  port: number,
  mapSeed?: number,
  mapKind: MapKind = 'tube',
): EmberServer {
  const room = new Room(mapSeed, mapKind);
  room.start();

  const wss = new WebSocketServer({ port });

  const ready = new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });

  wss.on('connection', (socket) => {
    let playerId: PlayerId | null = null;

    socket.on('message', (raw) => {
      const msg = decode<ClientMsg>(raw.toString());
      if (!msg) return;

      switch (msg.t) {
        case 'join': {
          if (playerId) return;
          if (msg.protocol !== PROTOCOL_VERSION) {
            socket.send(
              encode({
                t: 'reject',
                reason: `Protocol mismatch: server ${PROTOCOL_VERSION}, client ${msg.protocol}. Hard-refresh the page.`,
              }),
            );
            socket.close();
            return;
          }
          playerId = room.join(socket, msg.name);
          break;
        }

        case 'input': {
          if (!playerId) return;
          room.receiveInput(playerId, msg.frame);
          break;
        }
      }
    });

    socket.on('close', () => {
      if (playerId) room.leave(playerId);
    });

    socket.on('error', (err) => {
      console.error('[ws] socket error', err.message);
    });
  });

  return {
    room,
    wss,
    ready,
    get port(): number {
      const addr = wss.address();
      return typeof addr === 'object' && addr ? addr.port : port;
    },
    close(): Promise<void> {
      room.stop();
      // Terminate rather than close: a lingering client socket would otherwise
      // keep the server handle open and hang process exit.
      for (const client of wss.clients) client.terminate();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
