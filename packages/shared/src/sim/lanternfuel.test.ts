import { describe, expect, it } from 'vitest';
import {
  LANTERN_PICKUP_RANGE_M,
  LANTERN_REFUEL_HOLD_SEC,
  LANTERN_REFUEL_PER_LOG,
  LANTERN_REFUEL_RATE,
  LANTERN_TANK,
  TICK_DT,
} from '../constants.js';
import { createPlayer, createWorld, emptyInput } from '../types.js';
import type { InputFrame, WorldState } from '../types.js';
import { items } from './items.js';
import { lantern } from './lantern.js';

function scene() {
  const world = createWorld(60, 40);
  const player = createPlayer('p1', 'p1', { x: 30, y: 30 });
  world.players['p1'] = player;
  return { world, player };
}

/** One tick of the item stage with the given intent. */
function tick(world: WorldState, frame: Partial<InputFrame>): void {
  items(world, { p1: { ...emptyInput(1), ...frame } }, TICK_DT);
}

function hold(world: WorldState, frame: Partial<InputFrame>, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) tick(world, frame);
}

describe('refuelling the lantern (Q39)', () => {
  it('puts nothing in during the wind-up, so a shutter tap is free', () => {
    const { world, player } = scene();
    player.lantern.fuel = 10;
    player.carrying.log = 3;

    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC - TICK_DT * 2);

    expect(player.carrying.log).toBe(3);
    expect(player.lantern.fuel).toBe(10);
  });

  it('pours wood in continuously once it gets going', () => {
    const { world, player } = scene();
    player.lantern.fuel = 0;
    player.carrying.log = 4;

    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC + 1);

    expect(player.lantern.fuel).toBeGreaterThan(0);
    expect(player.lantern.fuel).toBeCloseTo(LANTERN_REFUEL_RATE * 1, 0);
  });

  it('is worth 25 units to the log (Q39)', () => {
    const { world, player } = scene();
    player.lantern.fuel = 0;
    player.carrying.log = 1;

    // Long enough to drain the single log entirely.
    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC + 5);

    expect(player.carrying.log).toBe(0);
    expect(player.lantern.fuel).toBeCloseTo(LANTERN_REFUEL_PER_LOG, 5);
  });

  it('has no ceiling — you can overfill it', () => {
    const { world, player } = scene();
    player.lantern.fuel = LANTERN_TANK;
    player.carrying.log = 4;

    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC + 6);

    expect(player.lantern.fuel).toBeGreaterThan(LANTERN_TANK);
  });

  it('costs the time and not the wood when interrupted', () => {
    const { world, player } = scene();
    player.lantern.fuel = 0;
    player.carrying.log = 2;

    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC + 0.4);
    const partway = player.lantern.fuel;
    tick(world, { refuel: false });

    // The remainder of the log in hand is kept, not spilled.
    expect(partway).toBeGreaterThan(0);
    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC + 5);
    expect(player.lantern.fuel).toBeCloseTo(LANTERN_REFUEL_PER_LOG * 2, 5);
  });

  it('does nothing with no wood', () => {
    const { world, player } = scene();
    player.lantern.fuel = 5;
    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC + 2);
    expect(player.lantern.fuel).toBe(5);
  });
});

describe('setting the lantern down (Q41)', () => {
  it('leaves it burning where you stood, and you dark', () => {
    const { world, player } = scene();
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    player.lantern.fuel = 40;

    tick(world, { dropLantern: true });

    const dropped = Object.values(world.droppedLanterns);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.lantern.fuel).toBe(40);
    expect(dropped[0]?.lantern.stage).toBe('full');
    expect(player.hasLantern).toBe(false);
    // Q41 costs you the light you were using — that is the price of the decoy.
    expect(player.lantern.fuel).toBe(0);
  });

  it('keeps burning down while it lies there', () => {
    const { world, player } = scene();
    player.lantern.stage = 'full';
    player.lantern.target = 'full';
    player.lantern.fuel = 40;
    tick(world, { dropLantern: true });

    const dl = Object.values(world.droppedLanterns)[0]!;
    for (let i = 0; i < 200; i++) lantern(world, TICK_DT);

    expect(dl.lantern.fuel).toBeLessThan(40);
  });

  it('can be picked back up, fuel and all', () => {
    const { world, player } = scene();
    player.lantern.fuel = 30;
    tick(world, { dropLantern: true });
    expect(player.hasLantern).toBe(false);

    tick(world, { dropLantern: true });

    expect(player.hasLantern).toBe(true);
    expect(player.lantern.fuel).toBeCloseTo(30, 5);
    expect(Object.keys(world.droppedLanterns)).toHaveLength(0);
  });

  it('cannot be retrieved from across the clearing', () => {
    const { world, player } = scene();
    tick(world, { dropLantern: true });

    player.pos.x += LANTERN_PICKUP_RANGE_M * 3;
    tick(world, { dropLantern: true });

    expect(player.hasLantern).toBe(false);
    expect(Object.keys(world.droppedLanterns)).toHaveLength(1);
  });

  it('cannot be refuelled while you are not holding it', () => {
    const { world, player } = scene();
    player.carrying.log = 3;
    tick(world, { dropLantern: true });

    hold(world, { refuel: true }, LANTERN_REFUEL_HOLD_SEC + 2);
    expect(player.carrying.log).toBe(3);
  });
});
