import {
  INTERP_DELAY_MS,
  PROTOCOL_VERSION,
  TICK_DT,
  createWorld,
  decode,
  distance,
  encode,
  gridFromMap,
  isOpaqueTile,
  lanternRadius,
  mapFor,
  setTile,
  step,
} from '@ember/shared';
import type {
  Carrying,
  ClientMsg,
  CreatureView,
  FireView,
  InputFrame,
  LanternState,
  OccluderGrid,
  Outcome,
  Player,
  PlayerId,
  ServerMsg,
  Vec2,
  WorldItem,
  WorldState,
} from '@ember/shared';

interface RemoteSample {
  t: number;
  x: number;
  y: number;
}

interface RemoteTrack {
  name: string;
  samples: RemoteSample[];
  lantern: LanternState;
}

interface CreatureTrack {
  state: CreatureView['state'];
  samples: RemoteSample[];
}

/** A creature to draw this frame, interpolated from snapshots. */
export interface RenderedCreature {
  id: string;
  x: number;
  y: number;
  state: CreatureView['state'];
}

export interface RenderedPlayer {
  id: PlayerId;
  name: string;
  x: number;
  y: number;
  isLocal: boolean;
  /**
   * The light this player is carrying, in metres. Remote players get theirs
   * from the snapshot, which the server only sends while you can see them —
   * so a light you can see is a light that is genuinely there.
   */
  lightRadiusM: number;
}

export interface NetStats {
  connected: boolean;
  playerId: string;
  serverTick: number;
  ack: number;
  pending: number;
  corrections: number;
  lastCorrectionM: number;
  rttMs: number;
  simulatedLagMs: number;
  peers: number;
  creatures: number;
}

/**
 * Client networking, prediction, and reconciliation.
 *
 * The local player is simulated immediately so input feels instant; every other
 * entity is rendered INTERP_DELAY_MS in the past and interpolated, because
 * guessing about other people's movement looks far worse than showing it late.
 *
 * Prediction runs the exact `step` from @ember/shared. If this ever diverges
 * from the server's copy, the symptom is rubber-banding that only appears under
 * latency and is miserable to diagnose — hence the correction metrics below,
 * which make divergence visible immediately rather than eventually.
 */
export class NetClient {
  playerId: PlayerId | null = null;
  connected = false;
  /** Null once the run has ended. */
  outcome: Outcome | null = null;

  /**
   * Set when a felled tree has cleared a tile in our grid, so the renderer
   * knows to rebuild the static geometry. The lighting mask needs no such
   * signal — it reads the grid live every frame, which is what makes the new
   * sightline open the same frame the tree comes down (Q20).
   */
  gridDirty = false;

  /** The woodpile's contents, or null when we cannot see the pile. */
  woodpileContents: Carrying | null = null;

  private fireView: FireView | null = null;

  private socket: WebSocket | null = null;
  private url: string;
  private name: string;

  /** Predicted world. Contains ONLY the local player. */
  private predicted: WorldState = createWorld(1, 1);
  private pending: InputFrame[] = [];
  private seq = 0;

  private remote = new Map<PlayerId, RemoteTrack>();

  /**
   * Creatures are interpolated and NEVER predicted.
   *
   * `step()` runs its creature stages on our predicted world exactly as the
   * server's does — rule 4 is not negotiable — but we deliberately never put a
   * creature into that world, so those stages iterate an empty map and do
   * nothing. Predicting a hunter from the fragments we are allowed to see would
   * be guessing about the one thing in the game we must not guess about.
   */
  private creatureTracks = new Map<string, CreatureTrack>();

  /** Half of the simulated round trip, applied to each direction. */
  private lagHalfMs: number;

  private sentAt = new Map<number, number>();
  private stats = {
    serverTick: 0,
    ack: 0,
    corrections: 0,
    lastCorrectionM: 0,
    rttMs: 0,
  };

  /**
   * When set, every inbound snapshot's entity list is logged. This is the
   * instrument for the Step 2 gate: with it on, nothing you cannot see on
   * screen may ever appear in the log.
   */
  private netlog: boolean;

  constructor(url: string, name: string, simulatedLagMs = 0, netlog = false) {
    this.url = url;
    this.name = name;
    this.lagHalfMs = simulatedLagMs / 2;
    this.netlog = netlog;
  }

  connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.connected = true;
      this.send({ t: 'join', name: this.name, protocol: PROTOCOL_VERSION });
    });

    socket.addEventListener('message', (ev) => {
      const msg = decode<ServerMsg>(String(ev.data));
      if (!msg) return;
      this.withInboundLag(() => this.handle(msg));
    });

    socket.addEventListener('close', () => {
      this.connected = false;
      // Retry rather than leaving a dead tab; the dev server restarts often.
      setTimeout(() => this.connect(), 1000);
    });

    socket.addEventListener('error', () => socket.close());
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  /** Called once per fixed sim tick. Predicts locally, then sends the intent. */
  tick(sample: (seq: number) => InputFrame): void {
    if (!this.playerId) return;

    const frame = sample(++this.seq);
    this.pending.push(frame);
    this.sentAt.set(frame.seq, performance.now());

    // Predict immediately — this is what makes movement feel instant.
    step(this.predicted, { [this.playerId]: frame }, TICK_DT);

    this.send({ t: 'input', frame });
  }

  private send(msg: ClientMsg): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const payload = encode(msg);
    if (this.lagHalfMs > 0) {
      setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }, this.lagHalfMs);
    } else {
      socket.send(payload);
    }
  }

  private withInboundLag(fn: () => void): void {
    if (this.lagHalfMs > 0) setTimeout(fn, this.lagHalfMs);
    else fn();
  }

  // -------------------------------------------------------------------------
  // Inbound
  // -------------------------------------------------------------------------

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome': {
        this.playerId = msg.playerId;
        this.fireView = msg.fire;

        // Rebuild the map from the seed with the same shared code the server
        // ran. Prediction collides against this grid, so it has to be the same
        // geometry byte for byte — deriving it beats shipping it.
        this.predicted = createWorld(msg.bounds.w, msg.bounds.h, gridFromMap(mapFor(msg.mapKind, msg.mapSeed)));
        this.predicted.players[msg.playerId] = structuredClone(msg.you);
        this.predicted.tick = msg.tick;
        this.applyFireView(msg.fire);
        break;
      }

      case 'reject': {
        console.error('[net] rejected:', msg.reason);
        this.socket?.close();
        break;
      }

      case 'snapshot': {
        if (this.netlog) {
          // Deliberately logs the whole entity list, not a summary: the gate is
          // that an observer reading this can find nothing they cannot see.
          console.log(
            `[netlog] tick ${msg.tick} entities:`,
            msg.players.map((p) => `${p.id}@${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)}`),
          );
        }

        this.reconcile(msg.players, msg.ack);
        this.applyCreatures(msg.creatures);
        this.applyFireView(msg.fire);
        this.applyWorldItems(msg.items, msg.felled);
        this.woodpileContents = msg.woodpile;
        this.outcome = msg.outcome;
        this.stats.serverTick = msg.tick;
        this.stats.ack = msg.ack;

        const sent = this.sentAt.get(msg.ack);
        if (sent !== undefined) {
          this.stats.rttMs = performance.now() - sent;
          for (const seq of this.sentAt.keys()) {
            if (seq <= msg.ack) this.sentAt.delete(seq);
          }
        }
        break;
      }
    }
  }

  /**
   * Snap to authority, then replay everything the server has not yet consumed.
   *
   * If prediction is correct this lands exactly where we already were and the
   * player sees nothing at all — which is the entire point.
   */
  private reconcile(players: Player[], ack: number): void {
    const now = performance.now();
    const localId = this.playerId;

    for (const p of players) {
      if (p.id === localId) {
        const mine = this.predicted.players[p.id];
        if (!mine) {
          this.predicted.players[p.id] = structuredClone(p);
          continue;
        }

        const before = { x: mine.pos.x, y: mine.pos.y };

        mine.pos.x = p.pos.x;
        mine.pos.y = p.pos.y;
        mine.vel.x = p.vel.x;
        mine.vel.y = p.vel.y;
        mine.loadKg = p.loadKg;
        mine.speedMul = p.speedMul;
        mine.noiseMul = p.noiseMul;
        // Inventory is authoritative — we do not predict picking things up,
        // because guessing wrong makes wood flicker in and out of your hands.
        mine.carrying = { ...p.carrying };
        mine.chop = p.chop ? { ...p.chop } : null;
        mine.stokeProgress = p.stokeProgress;
        mine.depositProgress = p.depositProgress;
        // The shutter is authoritative too. Replaying the pending inputs below
        // re-applies any cycle the server has not consumed yet, so a press is
        // never lost and never applied twice.
        mine.lantern = structuredClone(p.lantern);

        this.pending = this.pending.filter((f) => f.seq > ack);
        for (const frame of this.pending) {
          step(this.predicted, { [p.id]: frame }, TICK_DT);
        }

        const drift = distance(before, mine.pos);
        // Sub-millimetre drift is float noise, not a real correction.
        if (drift > 0.001) {
          this.stats.corrections++;
          this.stats.lastCorrectionM = drift;
        }
      } else {
        let track = this.remote.get(p.id);
        if (!track) {
          track = { name: p.name, samples: [], lantern: structuredClone(p.lantern) };
          this.remote.set(p.id, track);
        }
        track.name = p.name;
        track.lantern = structuredClone(p.lantern);
        track.samples.push({ t: now, x: p.pos.x, y: p.pos.y });
        // Keep a little more than the interpolation window.
        while (track.samples.length > 40) track.samples.shift();
      }
    }

    // Drop anyone who vanished from the snapshot. From Step 2 this also covers
    // players who simply moved out of sight, which is correct: if we cannot see
    // them, we should not be drawing them.
    const present = new Set(players.map((p) => p.id));
    for (const id of this.remote.keys()) {
      if (!present.has(id)) this.remote.delete(id);
    }
  }

  // -------------------------------------------------------------------------
  // Read models for rendering
  // -------------------------------------------------------------------------

  /**
   * Track the creatures in this snapshot and drop the ones that left it.
   *
   * A creature vanishing from the snapshot means it walked out of our light,
   * and it has to leave the screen with it. There is no last-known-position
   * marker: the server stopped telling us where it is, and inventing a ghost of
   * it on the client would put back exactly the information the culling
   * removed.
   */
  private applyCreatures(creatures: CreatureView[]): void {
    const now = performance.now();

    for (const c of creatures) {
      let track = this.creatureTracks.get(c.id);
      if (!track) {
        track = { state: c.state, samples: [] };
        this.creatureTracks.set(c.id, track);
      }
      track.state = c.state;
      track.samples.push({ t: now, x: c.pos.x, y: c.pos.y });
      while (track.samples.length > 40) track.samples.shift();
    }

    const present = new Set(creatures.map((c) => c.id));
    for (const id of this.creatureTracks.keys()) {
      if (!present.has(id)) this.creatureTracks.delete(id);
    }
  }

  /** Creatures to draw this frame, rendered INTERP_DELAY_MS in the past. */
  renderedCreatures(now: number): RenderedCreature[] {
    const out: RenderedCreature[] = [];
    const renderTime = now - INTERP_DELAY_MS;

    for (const [id, track] of this.creatureTracks) {
      const pos = sampleAt(track.samples, renderTime);
      if (pos) out.push({ id, x: pos.x, y: pos.y, state: track.state });
    }

    return out;
  }

  /** All players to draw this frame: local predicted, remote interpolated. */
  renderedPlayers(now: number): RenderedPlayer[] {
    const out: RenderedPlayer[] = [];

    const localId = this.playerId;
    if (localId) {
      const me = this.predicted.players[localId];
      if (me) {
        out.push({
          id: localId,
          name: me.name,
          x: me.pos.x,
          y: me.pos.y,
          isLocal: true,
          lightRadiusM: lanternRadius(me.lantern),
        });
      }
    }

    const renderTime = now - INTERP_DELAY_MS;
    for (const [id, track] of this.remote) {
      const pos = sampleAt(track.samples, renderTime);
      if (pos) {
        out.push({
          id,
          name: track.name,
          x: pos.x,
          y: pos.y,
          isLocal: false,
          lightRadiusM: lanternRadius(track.lantern),
        });
      }
    }

    return out;
  }

  get bounds(): { w: number; h: number } {
    return this.predicted.bounds;
  }

  /** The true geometry, for collision-free rendering and the light polygons. */
  get grid(): OccluderGrid {
    return this.predicted.grid;
  }

  get woodpilePos(): Vec2 {
    return this.predicted.woodpile.pos;
  }

  /** Items we can currently see. Everything else is out there in the dark. */
  get visibleItems(): WorldItem[] {
    return Object.values(this.predicted.items);
  }


  /** The local lantern, for the debug HUD. */
  get lantern(): LanternState | null {
    const id = this.playerId;
    return id ? (this.predicted.players[id]?.lantern ?? null) : null;
  }

  /** The local player, for the debug HUD. */
  get me(): Player | null {
    const id = this.playerId;
    return id ? (this.predicted.players[id] ?? null) : null;
  }

  /** The fire as the server last described it, not as we predicted it. */
  get fire(): FireView | null {
    return this.fireView;
  }

  /**
   * The fire is authoritative, never predicted.
   *
   * `step()` does run the fire stage on our predicted world — client and server
   * must run the identical tick — but its burn rate scales with player count
   * (Q3), and we deliberately do not know how many players there are. So the
   * prediction is discarded and the server's view wins, exactly as it does for
   * our own position.
   */
  /**
   * Items and geometry are authoritative, like the fire.
   *
   * The whole item map is replaced rather than merged: a snapshot contains
   * exactly what we can see, so anything missing from it is something we can
   * no longer see, and it has to leave the screen (Q21).
   *
   * Felled tiles are applied to our own grid and never un-applied — trees do
   * not come back (Q18), and clearing the tile is what opens the sightline on
   * our side. `gridDirty` tells the renderer to redraw the static geometry.
   */
  private applyWorldItems(items: WorldItem[], felled: { x: number; y: number }[]): void {
    this.predicted.items = {};
    for (const item of items) this.predicted.items[item.id] = item;

    for (const tile of felled) {
      if (!isOpaqueTile(this.predicted.grid, tile.x, tile.y)) continue;
      setTile(this.predicted.grid, tile.x, tile.y, 0);
      this.gridDirty = true;
    }
  }

  private applyFireView(view: FireView): void {
    this.fireView = view;

    const f = this.predicted.fire;
    f.pos = { ...view.pos };
    f.tier = view.tier;
    f.lightRadiusM = view.lightRadiusM;
    f.safeRadiusM = view.safeRadiusM;
    f.dead = view.dead;
    // Only sent when we are close enough to read them (Q127).
    if (view.fuel !== undefined) f.fuel = view.fuel;
    if (view.emberSecLeft !== undefined) f.emberSecLeft = view.emberSecLeft;
  }

  getStats(): NetStats {
    return {
      connected: this.connected,
      playerId: this.playerId ?? '—',
      serverTick: this.stats.serverTick,
      ack: this.stats.ack,
      pending: this.pending.length,
      corrections: this.stats.corrections,
      lastCorrectionM: this.stats.lastCorrectionM,
      rttMs: this.stats.rttMs,
      simulatedLagMs: this.lagHalfMs * 2,
      peers: this.remote.size,
      creatures: this.creatureTracks.size,
    };
  }
}

/** Linear interpolation between the two samples bracketing `t`. */
function sampleAt(samples: RemoteSample[], t: number): { x: number; y: number } | null {
  if (samples.length === 0) return null;

  const newest = samples[samples.length - 1];
  const oldest = samples[0];
  if (!newest || !oldest) return null;

  // Not enough history yet, or we have fallen behind: clamp rather than guess.
  if (t >= newest.t) return { x: newest.x, y: newest.y };
  if (t <= oldest.t) return { x: oldest.x, y: oldest.y };

  for (let i = samples.length - 1; i > 0; i--) {
    const b = samples[i];
    const a = samples[i - 1];
    if (!a || !b) continue;
    if (a.t <= t && t <= b.t) {
      const span = b.t - a.t;
      const alpha = span > 0 ? (t - a.t) / span : 0;
      return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha };
    }
  }

  return { x: newest.x, y: newest.y };
}
