import { describe, expect, it } from 'vitest';
import {
  DIRECTOR_MAX_FAILURES,
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emptyInput,
  step,
} from '@ember/shared';
import { CreatureMind } from '../creature/mind.js';
import { CallBudget } from './budget.js';
import { Tactician } from './tactician.js';

const config = {
  maxCalls: 3,
  minSpacingMs: 1000,
  maxConsecutiveFailures: DIRECTOR_MAX_FAILURES,
};

describe('call budget', () => {
  it('refuses a second call while one is in flight', () => {
    const budget = new CallBudget(config);
    expect(budget.mayCall(10_000)).toBe(true);
    budget.start(10_000);

    // Two requests racing would install contradictory orders onto the same
    // creatures, and the loser would be whichever happened to resolve second.
    expect(budget.mayCall(20_000)).toBe(false);
    budget.succeeded();
    expect(budget.mayCall(20_000)).toBe(true);
  });

  it('enforces a spacing floor', () => {
    const budget = new CallBudget(config);
    budget.start(10_000);
    budget.succeeded();

    expect(budget.mayCall(10_500)).toBe(false);
    expect(budget.mayCall(11_000)).toBe(true);
  });

  it('stops for the run once the cap is reached', () => {
    const budget = new CallBudget(config);
    for (let i = 0; i < config.maxCalls; i++) {
      expect(budget.mayCall(i * 5000)).toBe(true);
      budget.start(i * 5000);
      budget.succeeded();
    }

    expect(budget.mayCall(999_999)).toBe(false);
    expect(budget.disabled).toBe(true);
  });

  it('disables itself permanently after consecutive failures (Q117)', () => {
    const budget = new CallBudget({ ...config, maxCalls: 100 });

    for (let i = 0; i < DIRECTOR_MAX_FAILURES; i++) {
      budget.start(i * 5000);
      budget.failed('timeout');
    }

    // Permanent rather than retried: a director that flickers in and out means
    // half a run behaves one way and half another, and no playtest of that
    // tells you anything.
    expect(budget.disabled).toBe(true);
    expect(budget.mayCall(999_999)).toBe(false);
  });

  it('forgives an isolated failure', () => {
    const budget = new CallBudget({ ...config, maxCalls: 100 });

    budget.start(0);
    budget.failed('blip');
    budget.start(5000);
    budget.succeeded();
    budget.start(10_000);
    budget.failed('blip');

    expect(budget.disabled).toBe(false);
  });
});

describe('the no-key guarantee (Q117)', () => {
  it('disables itself when there is no API key, without throwing', () => {
    const tactician = new Tactician(new CallBudget(config), undefined);
    expect(tactician.budget.disabled).toBe(true);
    expect(tactician.budget.reason).toContain('no ANTHROPIC_API_KEY');
  });

  it('plays a full stretch of game on instinct alone', () => {
    // Exactly how a run behaves with the key removed: the tactician exists, is
    // disabled, and never gets in the way.
    const tactician = new Tactician(new CallBudget(config), undefined);
    const mind = new CreatureMind(5, tactician);

    const w = createWorld(240, 80, createGrid(240, 80));
    w.fire.pos = { x: 5, y: 5 };
    w.creatures['c1'] = createCreature('c1', { x: 100, y: 40 });
    w.players['p1'] = createPlayer('p1', 'p1', { x: 150, y: 40 });
    w.players['p1']!.lantern.stage = 'full';
    w.players['p1']!.lantern.target = 'full';
    w.players['p1']!.lantern.fuel = 999;

    const hooks = mind.hooks();
    const start = { ...w.creatures['c1']!.pos };
    for (let i = 0; i < Math.round(30 / TICK_DT); i++) {
      step(w, { p1: emptyInput(i + 1) }, TICK_DT, hooks);
    }

    // The pack still hunts. This is the whole contract: losing the director
    // costs the creatures their inventiveness and nothing else.
    expect(tactician.budget.spent).toBe(0);
    const moved = Math.hypot(
      w.creatures['c1']!.pos.x - start.x,
      w.creatures['c1']!.pos.y - start.y,
    );
    expect(moved).toBeGreaterThan(5);
    expect(w.players['p1']!.alive).toBe(false);
  });
});
