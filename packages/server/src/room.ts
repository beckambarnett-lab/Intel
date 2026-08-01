import {
  PLAYER_RADIUS,
  SANDBOX_HEIGHT_M,
  SANDBOX_MAP_SEED,
  SANDBOX_WIDTH_M,
  TICK_DT,
  TICK_MS,
  TICK_RATE,
  createPlayer,
  createWorld,
  encode,
  isBlockedAt,
  sandboxGrid,
  step,
} from '@ember/shared';
import type { InputFrame, Player, PlayerId, TickInputs, WorldState } from '@ember/shared';
import type { WebSocket } from 'ws';
import { VisibilityIndex, fireViewFor } from './visibility.js';

/**
 * Bound on how many unconsumed inputs we hold per client. One tick is consumed
 * per tick, so this caps added latency at ~300ms; beyond that we drop the oldest
 * rather than let a lagging or hostile client build an unbounded backlog.
 */
const MAX_INPUT_BACKLOG = 6;

/** Spawn ring around the bonfire: distinct slots, and a nudge outward per retry. */
const SPAWN_RING_SLOTS = 6;
const SPAWN_RING_M = 3;
const SPAWN_RING_ATTEMPTS = 12;

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
  private visibility = new VisibilityIndex();
  private readonly mapSeed: number;

  constructor(mapSeed?: number) {
    this.mapSeed = mapSeed ?? SANDBOX_MAP_SEED;
    const seed = this.mapSeed;
    this.world = createWorld(SANDBOX_WIDTH_M, SANDBOX_HEIGHT_M, sandboxGrid(seed));
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

    const player: Player = createPlayer(
      playerId,
      name.slice(0, 24) || playerId,
      this.spawnPoint(this.nextPlayerNumber - 1),
    );

    this.world.players[playerId] = player;
    this.connections.set(playerId, { socket, playerId, queue: [], ack: 0 });

    // Only this player's own state. Sending the world here would hand over
    // every other spawn position before culling ever got a chance (Q122) —
    // the leak would be one message wide and permanent.
    socket.send(
      encode({
        t: 'welcome',
        playerId,
        tickRate: TICK_RATE,
        tick: this.world.tick,
        bounds: { ...this.world.bounds },
        mapSeed: this.mapSeed,
        fire: fireViewFor(this.world, playerId),
        you: structuredClone(player),
      }),
    );

    console.log(`[room] ${player.name} joined as ${playerId} (${this.connections.size} online)`);
    return playerId;
  }

  /**
   * Spawn on a ring around the bonfire, one step round per player, so nobody
   * lands stacked and everybody starts inside the firelight.
   */
  private spawnPoint(index: number): { x: number; y: number } {
    const fire = this.world.fire.pos;
    const angle = (index * Math.PI * 2) / SPAWN_RING_SLOTS;

    for (let ring = 0; ring < SPAWN_RING_ATTEMPTS; ring++) {
      const r = SPAWN_RING_M + ring * PLAYER_RADIUS * 2;
      const p = { x: fire.x + Math.cos(angle) * r, y: fire.y + Math.sin(angle) * r };
      if (!isBlockedAt(this.world.grid, p.x, p.y)) return p;
    }

    return { x: fire.x, y: fire.y };
  }

  leave(playerId: PlayerId): void {
    this.connections.delete(playerId);
    delete this.world.players[playerId];
    this.visibility.forget(playerId);
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

  /**
   * One snapshot per client, each containing only what that client can see.
   *
   * There is deliberately no "everyone" payload here to accidentally reach for
   * — the culled set is computed per connection or not at all (Q122).
   */
  private broadcast(): void {
    const now = performance.now();

    for (const conn of this.connections.values()) {
      if (conn.socket.readyState !== conn.socket.OPEN) continue;

      const players = this.visibility.visibleTo(this.world, conn.playerId, now);

      conn.socket.send(
        encode({
          t: 'snapshot',
          tick: this.world.tick,
          players,
          ack: conn.ack,
          fire: fireViewFor(this.world, conn.playerId),
          outcome: this.world.outcome,
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
