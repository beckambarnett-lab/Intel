import { describe, expect, it } from 'vitest';
import {
  FIRE_CAPACITY,
  TICK_DT,
  createCreature,
  createGrid,
  createPlayer,
  createWorld,
  emptyInput,
  refreshFire,
  step,
} from '@ember/shared';
import type { LanternStage, WorldState } from '@ember/shared';
import { CreatureMind } from '../creature/mind.js';
import { DEFAULT_DIRECTIVE } from '../creature/instinct.js';
import type { Directive } from '../creature/instinct.js';
import { CallBudget } from './budget.js';
import { planSchema } from './schema.js';
import { Strategist } from './strategist.js';

const budgetConfig = { maxCalls: 5, minSpacingMs: 1000, maxConsecutiveFailures: 3 };

let mind: CreatureMind;

function world(): WorldState {
  mind = new CreatureMind(23);
  const w = createWorld(240, 80, createGrid(240, 80));
  w.fire.pos = { x: 5, y: 5 };
  w.creatures['c1'] = createCreature('c1', { x: 100, y: 40 });
  w.players['p1'] = createPlayer('p1', 'p1', { x: 130, y: 40 });
  return w;
}

function setLantern(w: WorldState, stage: LanternStage): void {
  const ls = w.players['p1']!.lantern;
  ls.stage = stage;
  ls.target = stage;
  ls.transition = 0;
  ls.bloom = 0;
  ls.fuel = 999;
}

/**
 * Run with a plan installed, exactly as a run with a live commander would.
 *
 * Goes through `setPlan` rather than poking `decide` directly: a plan from a
 * fixture and a plan from Sonnet are indistinguishable to everything below the
 * director, which is the property actually worth testing.
 */
function runUnder(w: WorldState, seconds: number, directive: Directive, roles: {creatureId: string; role: 'stalker'|'sentinel'|'flanker'|'saboteur'}[] = []): void {
  mind.setPlan({
    intent: 'test',
    posture: directive.posture,
    aggression: directive.aggression,
    roles,
    guidance: '',
    holdSec: 240,
  });
  const hooks = mind.hooks();
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) {
    step(w, { p1: emptyInput(i + 1) }, TICK_DT, hooks);
  }
}

const gap = (w: WorldState) =>
  Math.hypot(w.players['p1']!.pos.x - w.creatures['c1']!.pos.x, w.players['p1']!.pos.y - w.creatures['c1']!.pos.y);

describe('plan schema', () => {
  it('accepts a well-formed plan', () => {
    expect(
      planSchema.safeParse({
        intent: 'They have been hunted hard for four minutes. Back off and let it go quiet.',
        posture: 'withdraw',
        aggression: 0.2,
        roles: [{ creatureId: 'c1', role: 'sentinel' }],
        guidance: 'Hold the ruins approach. Do not press.',
        holdSec: 90,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown posture and an out-of-range aggression', () => {
    expect(
      planSchema.safeParse({
        intent: 'x',
        posture: 'terrify',
        aggression: 0.5,
        roles: [],
        guidance: '',
        holdSec: 10,
      }).success,
    ).toBe(false);

    expect(
      planSchema.safeParse({
        intent: 'x',
        posture: 'hunt',
        aggression: 4,
        roles: [],
        guidance: '',
        holdSec: 10,
      }).success,
    ).toBe(false);
  });

  it('requires an intent — the diary is not optional', () => {
    expect(
      planSchema.safeParse({
        posture: 'hunt',
        aggression: 0.5,
        roles: [],
        guidance: '',
        holdSec: 10,
      }).success,
    ).toBe(false);
  });
});

describe('posture', () => {
  it('withdraw makes the pack let go of a player it can see', () => {
    const w = world();
    setLantern(w, 'full');

    runUnder(w, 12, { posture: 'withdraw', aggression: 0.2 });

    // Not a rout — patrol and search simply outscore chasing, so the pack
    // drifts off and goes quiet. That lull is the one move nothing else in the
    // system can make, and it is the whole argument for this tier.
    expect(w.players['p1']!.alive).toBe(true);
    expect(w.creatures['c1']!.stance).not.toBe('charge');
  });

  it('press closes harder than withdraw on the same situation', () => {
    const pressed = world();
    setLantern(pressed, 'full');
    runUnder(pressed, 6, { posture: 'press', aggression: 0.9 });
    const pressedGap = pressed.players['p1']!.alive ? gap(pressed) : 0;

    const held = world();
    setLantern(held, 'full');
    runUnder(held, 6, { posture: 'withdraw', aggression: 0.2 });
    const heldGap = gap(held);

    expect(pressedGap).toBeLessThan(heldGap);
  });

  it('hunt is the default, and is what a keyless run uses throughout', () => {
    expect(DEFAULT_DIRECTIVE).toEqual({ posture: 'hunt', aggression: 0.5 });
  });
});

describe('roles', () => {
  function driftUnderRole(role: 'sentinel' | 'stalker'): number {
    const w = world();
    setLantern(w, 'low');
    // Far enough that pursuit is a choice rather than a reflex.
    w.players['p1']!.pos = { x: 118, y: 40 };
    const anchor = { ...w.creatures['c1']!.anchor };
    runUnder(w, 20, DEFAULT_DIRECTIVE, [{ creatureId: 'c1', role }]);
    return Math.hypot(w.creatures['c1']!.pos.x - anchor.x, w.creatures['c1']!.pos.y - anchor.y);
  }

  it('a sentinel holds its ground more than a stalker does', () => {
    // A sentinel is told to watch an area; a stalker is told to go and get
    // them. Same situation, same instincts underneath, different jobs.
    expect(driftUnderRole('sentinel')).toBeLessThan(driftUnderRole('stalker'));
  });

  it('a saboteur goes for the woodpile sooner than an unassigned creature', () => {
    function pileLoss(role: 'saboteur' | null): number {
      const w = createWorld(160, 120, createGrid(160, 120));
      mind = new CreatureMind(31);
      w.fire.pos = { x: 60, y: 60 };
      w.fire.fuel = FIRE_CAPACITY * 0.2;
      refreshFire(w.fire);
      w.woodpile.pos = { x: 60, y: 64 };
      w.woodpile.contents = { log: 20, branch: 0 };
      w.creatures['c1'] = createCreature('c1', { x: 60, y: 84 });
      w.players['p1'] = createPlayer('p1', 'p1', { x: 150, y: 110 });

      mind.setPlan({
        intent: 'test',
        posture: 'hunt',
        aggression: 0.5,
        roles: role ? [{ creatureId: 'c1', role }] : [],
        guidance: '',
        holdSec: 240,
      });

      const hooks = mind.hooks();
      for (let i = 0; i < Math.round(18 / TICK_DT); i++) {
        step(w, { p1: emptyInput(i + 1) }, TICK_DT, hooks);
      }
      return 20 - w.woodpile.contents.log;
    }

    expect(pileLoss('saboteur')).toBeGreaterThanOrEqual(pileLoss(null));
  });
});

describe('the no-key guarantee, strategic tier (Q117)', () => {
  it('disables itself with no key and never blocks a run', () => {
    const strategist = new Strategist(new CallBudget(budgetConfig), undefined);
    expect(strategist.budget.disabled).toBe(true);

    const w = world();
    setLantern(w, 'full');
    const m = new CreatureMind(1, null, strategist);
    const hooks = m.hooks();
    for (let i = 0; i < Math.round(20 / TICK_DT); i++) {
      step(w, { p1: emptyInput(i + 1) }, TICK_DT, hooks);
    }

    expect(strategist.budget.spent).toBe(0);
    expect(m.planNow).toBeNull();
    // Still hunts, still kills, entirely on instinct.
    expect(w.players['p1']!.alive).toBe(false);
  });
});
