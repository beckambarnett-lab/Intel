import {
  PLAYER_RADIUS,
  SANDBOX_HEIGHT_M,
  SANDBOX_WIDTH_M,
  TICK_DT,
  TICK_MS,
  TICK_RATE,
  cloneWorld,
  createWorld,
  encode,
  step,
} from '@ember/shared';
import type { InputFrame, Player, PlayerId, TickInputs, WorldState } from '@ember/shared';
import type { WebSocket } from 'ws';

/**
 * Bound on how many unconsumed inputs we hold per client. One tick is consumed
 * per tick, so this caps added latency at ~300ms; beyond that we drop the oldest
 * rather than let a lagging or hostile client build an unbounded backlog.
 */
const MAX_INPUT_BACKLOG = 6;

interface Connection {
  socket: WebSocket;
  playerId: PlayerId;
  queue: InputFrame[];
  /** Highest input seq actually consumed by the sim. */
  ack: number;
}

/**
 * One run. Owns the authoritative world and the only clock that matters.
 *
 * Everything a client believes is a prediction of what happens here; on any
 * disagreement, this state wins.
 */
export class Room {
  private world: WorldState;
  private connections = new Map<PlayerId, Connection>();
  private nextPlayerNumber = 0;
  private timer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;

  constructor() {
    this.world = createWorld(SANDBOX_WIDTH_M, SANDBOX_HEIGHT_M);
  }

  start(): void {
    this.nextTickAt = performance.now();
    this.scheduleNext();
    console.log(`[room] running at ${TICK_RATE}Hz (${TICK_MS.toFixed(1)}ms per tick)`);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  join(socket: WebSocket, name: string): PlayerId {
    const playerId = `p${++this.nextPlayerNumber}`;

    // Spread spawns along the sandbox so two players are never stacked.
    const spawnX = 6 + ((this.nextPlayerNumber - 1) % 5) * 4;
    const spawnY = SANDBOX_HEIGHT_M / 2;

    const player: Player = {
      id: playerId,
      name: name.slice(0, 24) || playerId,
      pos: { x: spawnX, y: spawnY },
      vel: { x: 0, y: 0 },
      loadKg: 0,
    };

    this.world.players[playerId] = player;
    this.connections.set(playerId, { socket, playerId, queue: [], ack: 0 });

    socket.send(
      encode({
        t: 'welcome',
        playerId,
        tickRate: TICK_RATE,
        world: cloneWorld(this.world),
      }),
    );

    console.log(`[room] ${player.name} joined as ${playerId} (${this.connections.size} online)`);
    return playerId;
  }

  leave(playerId: PlayerId): void {
    this.connections.delete(playerId);
    delete this.world.players[playerId];
    console.log(`[room] ${playerId} left (${this.connections.size} online)`);
  }

  receiveInput(playerId: PlayerId, frame: InputFrame): void {
    const conn = this.connections.get(playerId);
    if (!conn) return;

    // Ignore replays and out-of-order stragglers; seq must strictly advance.
    const newest = conn.queue[conn.queue.length - 1];
    const highest = newest ? newest.seq : conn.ack;
    if (frame.seq <= highest) return;

    conn.queue.push(frame);
    while (conn.queue.length > MAX_INPUT_BACKLOG) conn.queue.shift();
  }

  // -------------------------------------------------------------------------
  // The clock
  // -------------------------------------------------------------------------

  /**
   * Drift-corrected loop. A plain setInterval accumulates error and the fire
   * clock in Step 3 is the whole game, so the tick must not quietly run slow.
   */
  private scheduleNext(): void {
    const delay = Math.max(0, this.nextTickAt - performance.now());
    this.timer = setTimeout(() => {
      const now = performance.now();

      // If we fell badly behind (debugger pause, GC), resync instead of trying
      // to catch up with a burst of ticks the clients never saw.
      if (now - this.nextTickAt > TICK_MS * 10) {
        this.nextTickAt = now;
      }

      while (performance.now() >= this.nextTickAt) {
        this.tick();
        this.nextTickAt += TICK_MS;
      }

      this.scheduleNext();
    }, delay);
  }

  private tick(): void {
    // Exactly one input per player per tick. Consuming two would integrate one
    // of them for zero time and desync every predicting client.
    const inputs: TickInputs = {};
    for (const conn of this.connections.values()) {
      const frame = conn.queue.shift();
      if (frame) {
        conn.ack = frame.seq;
        inputs[conn.playerId] = frame;
      }
    }

    step(this.world, inputs, TICK_DT);
    this.broadcast();
  }

  private broadcast(): void {
    // Step 1 sends every player to everyone. Step 2 replaces this with
    // per-player visibility culling (Q122) — the client must never receive an
    // entity it cannot see, because that is the whole anti-cheat story.
    const players = Object.values(this.world.players);

    for (const conn of this.connections.values()) {
      if (conn.socket.readyState !== conn.socket.OPEN) continue;
      conn.socket.send(
        encode({
          t: 'snapshot',
          tick: this.world.tick,
          players,
          ack: conn.ack,
        }),
      );
    }
  }

  get playerCount(): number {
    return this.connections.size;
  }

  /** Exposed for the headless harness in Step 13. */
  get state(): Readonly<WorldState> {
    return this.world;
  }
}

export { PLAYER_RADIUS };
