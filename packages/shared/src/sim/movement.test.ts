import { describe, expect, it } from 'vitest';
import {
  CARRY_CAPACITY_KG,
  PLAYER_RADIUS,
  PLAYER_WALK_SPEED,
  TICK_DT,
} from '../constants.js';
import { createWorld, emptyInput } from '../types.js';
import type { InputFrame, Player, WorldState } from '../types.js';
import { cloneWorld, step } from './index.js';
import { canSprint, speedMultiplierForLoad } from './movement.js';

function worldWith(player: Partial<Player> = {}): WorldState {
  const world = createWorld(60, 40);
  world.players['p1'] = {
    id: 'p1',
    name: 'test',
    pos: { x: 10, y: 10 },
    vel: { x: 0, y: 0 },
    loadKg: 0,
    ...player,
  };
  return world;
}

function move(seq: number, x: number, y: number, extra: Partial<InputFrame> = {}): InputFrame {
  return { ...emptyInput(seq), moveX: x, moveY: y, ...extra };
}

describe('weight speed curve (Q31)', () => {
  it('matches the documented reference points', () => {
    expect(speedMultiplierForLoad(0)).toBeCloseTo(1.0, 3);
    expect(speedMultiplierForLoad(CARRY_CAPACITY_KG * 0.5)).toBeCloseTo(0.788, 2);
    expect(speedMultiplierForLoad(CARRY_CAPACITY_KG)).toBe(0);
  });

  it('stops you dead at or over capacity rather than slowing you', () => {
    expect(speedMultiplierForLoad(CARRY_CAPACITY_KG)).toBe(0);
    expect(speedMultiplierForLoad(CARRY_CAPACITY_KG + 10)).toBe(0);
  });

  it('gates sprint at half load (Q32)', () => {
    expect(canSprint(0)).toBe(true);
    expect(canSprint(CARRY_CAPACITY_KG * 0.49)).toBe(true);
    expect(canSprint(CARRY_CAPACITY_KG * 0.5)).toBe(false);
  });
});

describe('movement', () => {
  it('does not grant extra speed on the diagonal', () => {
    const straight = worldWith();
    const diagonal = worldWith();

    for (let i = 1; i <= 20; i++) {
      step(straight, { p1: move(i, 1, 0) }, TICK_DT);
      step(diagonal, { p1: move(i, 1, 1) }, TICK_DT);
    }

    const a = straight.players['p1']!;
    const b = diagonal.players['p1']!;
    const distA = Math.hypot(a.pos.x - 10, a.pos.y - 10);
    const distB = Math.hypot(b.pos.x - 10, b.pos.y - 10);
    expect(distB).toBeCloseTo(distA, 6);
  });

  it('walks at the documented speed', () => {
    const world = worldWith();
    for (let i = 1; i <= 20; i++) step(world, { p1: move(i, 1, 0) }, TICK_DT);
    // 20 ticks at 50ms = exactly one second.
    expect(world.players['p1']!.pos.x - 10).toBeCloseTo(PLAYER_WALK_SPEED, 5);
  });

  it('clamps to the world bounds', () => {
    const world = worldWith();
    for (let i = 1; i <= 400; i++) step(world, { p1: move(i, -1, -1) }, TICK_DT);
    const p = world.players['p1']!;
    expect(p.pos.x).toBeCloseTo(PLAYER_RADIUS, 6);
    expect(p.pos.y).toBeCloseTo(PLAYER_RADIUS, 6);
  });

  it('halts a player with no input', () => {
    const world = worldWith();
    step(world, { p1: move(1, 1, 0) }, TICK_DT);
    step(world, {}, TICK_DT);
    const p = world.players['p1']!;
    expect(p.vel.x).toBe(0);
    expect(p.vel.y).toBe(0);
  });
});

describe('determinism', () => {
  it('produces identical state from identical inputs', () => {
    const inputs = Array.from({ length: 50 }, (_, i) =>
      move(i + 1, Math.sin(i) > 0 ? 1 : -1, Math.cos(i) > 0 ? 1 : -1, { sprint: i % 3 === 0 }),
    );

    const a = worldWith();
    const b = worldWith();
    for (const frame of inputs) {
      step(a, { p1: frame }, TICK_DT);
      step(b, { p1: frame }, TICK_DT);
    }

    expect(a).toEqual(b);
  });
});

/**
 * The Step 1 invariant. The client predicts forward, the server confirms later,
 * and the client replays whatever the server has not yet acknowledged. If this
 * ever fails, players see rubber-banding under latency — so this test guards the
 * single most expensive-to-debug property in the netcode.
 */
describe('prediction and reconciliation', () => {
  it('replaying unacknowledged inputs lands exactly where the server will', () => {
    const inputs = Array.from({ length: 30 }, (_, i) => move(i + 1, 1, i % 2 === 0 ? 1 : -1));

    // The server consumes every input, one per tick.
    const server = worldWith();
    for (const frame of inputs) step(server, { p1: frame }, TICK_DT);

    // The client predicted all 30, but has only been acknowledged up to 18.
    const client = worldWith();
    for (const frame of inputs) step(client, { p1: frame }, TICK_DT);

    const ACK = 18;
    const authoritative = cloneWorld(worldWith());
    for (const frame of inputs.filter((f) => f.seq <= ACK)) {
      step(authoritative, { p1: frame }, TICK_DT);
    }

    // Reconcile: snap to authority, then replay the pending tail.
    const me = client.players['p1']!;
    const auth = authoritative.players['p1']!;
    me.pos = { ...auth.pos };
    me.vel = { ...auth.vel };
    for (const frame of inputs.filter((f) => f.seq > ACK)) {
      step(client, { p1: frame }, TICK_DT);
    }

    expect(me.pos.x).toBeCloseTo(server.players['p1']!.pos.x, 9);
    expect(me.pos.y).toBeCloseTo(server.players['p1']!.pos.y, 9);
  });
});
