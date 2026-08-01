import {
  PROTOCOL_VERSION,
  TICK_MS,
  decode,
  emptyInput,
  encode,
  isOpaqueTile,
  sandboxGrid,
} from '@ember/shared';
import type { Player, ServerMsg } from '@ember/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  welcome: Extract<ServerMsg, { t: 'welcome' }> | null = null;
  snapshots: Extract<ServerMsg, { t: 'snapshot' }>[] = [];
  /** Every entity id this client has EVER been told about, over the whole run. */
  everSeen = new Set<string>();
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
      if (msg.t === 'welcome') {
        this.playerId = msg.playerId;
        this.welcome = msg;
      }
      if (msg.t === 'snapshot') {
        this.snapshots.push(msg);
        for (const p of msg.players) this.everSeen.add(p.id);
      }
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

  move(dx: number, dy: number): void {
    this.socket.send(
      encode({ t: 'input', frame: { ...emptyInput(++this.seq), moveX: dx, moveY: dy } }),
    );
  }

  moveRight(): void {
    this.move(1, 0);
  }

  /** Hold a direction for a while, one input per tick as a real client would. */
  async walk(dx: number, dy: number, ticks: number): Promise<void> {
    for (let i = 0; i < ticks; i++) {
      this.move(dx, dy);
      await sleep(TICK_MS);
    }
    await sleep(200);
  }

  see(id: string | null): Player | undefined {
    return this.latest?.players.find((p) => p.id === id);
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

/**
 * The sandbox scatters trunks at random, so a player told to walk east may
 * simply stop against one and the test would prove nothing. Rather than hoping,
 * pick a seed whose map has a clear lane along the row the test walks down.
 * Deterministic, and it fails loudly if no such map exists.
 */
const WALK_ROW_Y = 20;
const WALK_FROM_X = 14;
const WALK_TO_X = 55;

function findClearLaneSeed(): number {
  for (let seed = 1; seed < 5000; seed++) {
    const grid = sandboxGrid(seed);
    let clear = true;
    for (let x = WALK_FROM_X; x <= WALK_TO_X && clear; x++) {
      // The body spans a little either side of the centre line.
      if (isOpaqueTile(grid, x, WALK_ROW_Y) || isOpaqueTile(grid, x, WALK_ROW_Y - 1)) {
        clear = false;
      }
    }
    if (clear) return seed;
  }
  throw new Error('no sandbox seed with a clear walking lane');
}

/** Chosen once — the scan is deterministic, so this is the same map every run. */
const LANE_SEED = findClearLaneSeed();

/**
 * A server per test rather than per file. Spawn positions are assigned by join
 * order, so a shared server would place the second test's players somewhere
 * different from the first test's — and the walking lane is chosen for a
 * specific spawn row. Fresh state also stops one failing test from leaving
 * connected sockets that break the next one.
 */
beforeEach(async () => {
  server = createServer(0, LANE_SEED);
  await server.ready;
  PORT = server.port;
});

afterEach(async () => {
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

    // Both spawn in the firelight, so they can see each other to begin with.
    expect(a.see(b.playerId)).toBeDefined();
    expect(b.see(a.playerId)).toBeDefined();

    // Drive alice to the right for ~1 second of ticks.
    const startX = a.see(a.playerId)!.pos.x;
    await a.walk(1, 0, 20);

    const midX = a.see(a.playerId)!.pos.x;
    expect(midX).toBeGreaterThan(startX + 1);

    // The server acknowledges alice's inputs so she can retire them.
    expect(a.latest!.ack).toBeGreaterThan(0);

    // Bob never sent input, so he must not have drifted.
    const bobStart = a.snapshots[0]!.players.find((p) => p.id === b.playerId);
    if (bobStart) expect(a.see(b.playerId)!.pos.x).toBeCloseTo(bobStart.pos.x, 6);

    // Bob observes alice's movement too — snapshots are not per-client fiction.
    expect(b.see(a.playerId)!.pos.x).toBeCloseTo(midX, 3);

    a.close();
    b.close();
    await waitFor(() => server.room.playerCount === 0);
  }, 20000);

  /**
   * The Step 2 gate, as a test rather than as a thing someone remembers to
   * check in devtools. A client that logs every inbound message must never find
   * an entity it cannot see — so walking out of the light has to remove alice
   * from bob's wire traffic entirely, not merely from his screen.
   */
  it('stops sending a player once they walk out of the light', async () => {
    const a = new TestClient('alice');
    const b = new TestClient('bob');
    await a.ready();
    await b.ready();
    await waitFor(() => a.snapshots.length > 3 && b.snapshots.length > 3);

    expect(b.see(a.playerId)).toBeDefined();

    // East, out of the firelight and well beyond either lantern.
    await a.walk(1, 0, 140);

    const alice = a.see(a.playerId)!;
    expect(alice.pos.x).toBeGreaterThan(WALK_TO_X - 12);

    // Neither can see the other, and — the part that matters — neither is
    // being sent the other at all.
    expect(b.see(a.playerId)).toBeUndefined();
    expect(a.see(b.playerId)).toBeUndefined();

    // Nothing arrives in the tail of the run either, hysteresis included.
    const tail = b.snapshots.slice(-10);
    for (const snap of tail) {
      expect(snap.players.map((p) => p.id)).toEqual([b.playerId]);
    }

    a.close();
    b.close();
    await waitFor(() => server.room.playerCount === 0);
  }, 30000);

  it('does not leak other players in the welcome message', async () => {
    const a = new TestClient('alice');
    await a.ready();
    await waitFor(() => a.snapshots.length > 2);

    // Bob joins while alice is already in the world, far from him.
    const b = new TestClient('bob');
    await b.ready();

    // Bob's welcome describes bob and the map — never anyone else's position.
    expect(b.welcome).not.toBeNull();
    expect(b.welcome!.you.id).toBe(b.playerId);
    expect(JSON.stringify(b.welcome)).not.toContain('alice');

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
