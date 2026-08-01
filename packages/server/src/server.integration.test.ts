import { PROTOCOL_VERSION, TICK_MS, decode, emptyInput, encode } from '@ember/shared';
import type { ServerMsg } from '@ember/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createServer } from './server.js';
import type { EmberServer } from './server.js';

/**
 * Bound to an ephemeral port so this suite can never collide with a dev server
 * you happen to have running, nor with a parallel copy of itself.
 */
let server: EmberServer;
let PORT = 0;

/** A minimal real client: connects over a real socket and records snapshots. */
class TestClient {
  socket: WebSocket;
  playerId: string | null = null;
  snapshots: Extract<ServerMsg, { t: 'snapshot' }>[] = [];
  private seq = 0;

  private failure: Error | null = null;

  constructor(private name: string) {
    this.socket = new WebSocket(`ws://localhost:${PORT}`);
    this.socket.on('error', (err) => {
      this.failure = err;
    });
    this.socket.on('message', (raw) => {
      const msg = decode<ServerMsg>(raw.toString());
      if (!msg) return;
      if (msg.t === 'welcome') this.playerId = msg.playerId;
      if (msg.t === 'snapshot') this.snapshots.push(msg);
    });
  }

  async ready(): Promise<void> {
    // Both clients are constructed together, so this socket may already be open
    // by the time we await it — listening for 'open' unconditionally would wait
    // forever for an event that has already fired.
    if (this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        this.socket.once('open', resolve);
        this.socket.once('error', reject);
      });
    }
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw this.failure ?? new Error(`socket not open (state ${this.socket.readyState})`);
    }
    this.socket.send(encode({ t: 'join', name: this.name, protocol: PROTOCOL_VERSION }));
    await waitFor(() => this.playerId !== null || this.failure !== null);
    if (this.failure) throw this.failure;
  }

  moveRight(): void {
    this.socket.send(
      encode({ t: 'input', frame: { ...emptyInput(++this.seq), moveX: 1, moveY: 0 } }),
    );
  }

  get latest(): Extract<ServerMsg, { t: 'snapshot' }> | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  close(): void {
    this.socket.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(10);
  }
}

beforeAll(async () => {
  server = createServer(0);
  await server.ready;
  PORT = server.port;
});

afterAll(async () => {
  await server.close();
});

describe('server end to end', () => {
  it('runs the full loop for two real clients', async () => {
    const a = new TestClient('alice');
    const b = new TestClient('bob');
    await a.ready();
    await b.ready();

    expect(a.playerId).not.toBeNull();
    expect(b.playerId).not.toBeNull();
    expect(a.playerId).not.toEqual(b.playerId);

    // Both clients should be receiving snapshots.
    await waitFor(() => a.snapshots.length > 3 && b.snapshots.length > 3);

    // Each sees both players (no culling until Step 2).
    expect(a.latest!.players).toHaveLength(2);
    expect(b.latest!.players).toHaveLength(2);

    // Drive alice to the right for ~1 second of ticks.
    const startX = a.latest!.players.find((p) => p.id === a.playerId)!.pos.x;
    for (let i = 0; i < 20; i++) {
      a.moveRight();
      await sleep(TICK_MS);
    }
    await sleep(200);

    const endX = a.latest!.players.find((p) => p.id === a.playerId)!.pos.x;
    expect(endX).toBeGreaterThan(startX + 1);

    // The server acknowledges alice's inputs so she can retire them.
    expect(a.latest!.ack).toBeGreaterThan(0);

    // Bob never sent input, so he must not have drifted.
    const bob = a.latest!.players.find((p) => p.id === b.playerId)!;
    const bobStart = a.snapshots[0]!.players.find((p) => p.id === b.playerId);
    if (bobStart) expect(bob.pos.x).toBeCloseTo(bobStart.pos.x, 6);

    // Bob observes alice's movement too — snapshots are not per-client fiction.
    const aliceViaBob = b.latest!.players.find((p) => p.id === a.playerId)!;
    expect(aliceViaBob.pos.x).toBeCloseTo(endX, 3);

    a.close();
    b.close();
    await waitFor(() => server.room.playerCount === 0);
  }, 20000);

  it('rejects a protocol mismatch instead of silently misbehaving', async () => {
    const socket = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise<void>((resolve) => socket.once('open', resolve));

    const rejection = new Promise<string>((resolve) => {
      socket.on('message', (raw) => {
        const msg = decode<ServerMsg>(raw.toString());
        if (msg?.t === 'reject') resolve(msg.reason);
      });
    });

    socket.send(encode({ t: 'join', name: 'stale', protocol: PROTOCOL_VERSION + 1 }));
    await expect(rejection).resolves.toContain('Protocol mismatch');
    socket.close();
  }, 10000);
});
