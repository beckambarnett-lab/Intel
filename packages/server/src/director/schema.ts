import { z } from 'zod';

/**
 * The wire contract with the tactician.
 *
 * DESIGN.md Step 10.4 is explicit that malformed orders are **rejected, not
 * coerced**, and the reasoning is worth keeping in view: a coerced order is a
 * silent behaviour change. Clamping an out-of-range coordinate or defaulting a
 * missing stance produces a creature doing something nobody asked for, and it
 * looks exactly like a tuning problem rather than a parsing one. A rejected
 * order simply falls through to instinct, which is a path that is already
 * tested and already good.
 *
 * The schema is also the honest limit of what a commander may say. Anything not
 * expressible here cannot be ordered — which is why the vocabulary is built
 * from primitives rather than named tactics (see `orders.ts`).
 */

const stance = z.enum(['hold', 'stalk', 'sweep', 'charge', 'withdraw', 'sabotage']);
const vocalization = z.enum(['summon', 'converge', 'contact', 'lost']);

/** Positions are metres in world space, and are always bounded by the caller. */
const point = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const trigger = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sound'),
    minLoudness: z.number().min(0).max(100),
    withinM: z.number().min(0).max(200),
  }),
  z.object({
    kind: z.literal('light'),
    withinM: z.number().min(0).max(200),
  }),
  z.object({
    kind: z.literal('call'),
    from: z.string().min(1).max(16),
  }),
  z.object({
    kind: z.literal('beliefWithin'),
    m: z.number().min(0).max(200),
  }),
  z.object({
    kind: z.literal('timer'),
    ticks: z.number().int().min(0).max(2400),
  }),
]);

export const orderSchema = z.object({
  creatureId: z.string().min(1).max(16),
  goto: point.optional(),
  stance,
  trigger: trigger.optional(),
  onTrigger: stance.optional(),
  vocalize: vocalization.optional(),
  /** One tick is 50ms, so this caps a standing order at two minutes. */
  ttlTicks: z.number().int().min(1).max(2400),
});

export const orderSetSchema = z.object({
  /**
   * Free text, for the developer log and the post-run enemy diary (Q116).
   *
   * Never parsed, never acted on. It exists so that a run can be replayed with
   * the pack's reasoning beside it, which is the cheapest way to tell a genuine
   * plan apart from four creatures that happened to converge.
   */
  intent: z.string().max(400).optional(),
  orders: z.array(orderSchema).min(0).max(8),
});

export type ValidatedOrder = z.infer<typeof orderSchema>;
export type ValidatedOrderSet = z.infer<typeof orderSetSchema>;

/** The JSON Schema handed to the model, derived from the same source of truth. */
export function orderSetJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(orderSetSchema, { io: 'output' }) as Record<string, unknown>;
}

/**
 * The strategist's output.
 *
 * Deliberately not orders. The strategic tier decides *posture* — how the pack
 * should be behaving, who is doing what, and when to stop pressing — and leaves
 * placement to the tactician. Handing this tier waypoints would make it a slow,
 * expensive version of the fast tier; handing it posture makes it the only
 * layer in the stack that can decide the run needs a quiet ninety seconds.
 */
const role = z.enum(['stalker', 'sentinel', 'flanker', 'saboteur']);

export const planSchema = z.object({
  /**
   * The commander's reasoning, in its own words (Q116).
   *
   * Surfaced to players after a run as the enemy's diary, which is the only
   * channel this tier has for reaching them directly — everything else it does
   * arrives filtered through four bodies moving in the dark.
   */
  intent: z.string().min(1).max(400),
  /**
   * How the pack should be carrying itself.
   *
   * `withdraw` is the one that matters and the reason this tier exists: a
   * utility function will never choose to stop hunting in order to make the
   * next contact frightening, because nothing in a score function represents
   * dread. A commander can.
   */
  posture: z.enum(['hunt', 'press', 'encircle', 'siege', 'withdraw']),
  /** Q120's difficulty lever — never more information, only more pressure. */
  aggression: z.number().min(0).max(1),
  /** Who is doing what. Creatures left unassigned keep their own instincts. */
  roles: z
    .array(z.object({ creatureId: z.string().min(1).max(16), role }))
    .max(8),
  /** Free text handed to the tactician as its standing plan. */
  guidance: z.string().max(600),
  /**
   * Seconds to hold this posture before reconsidering.
   *
   * The mechanism behind a deliberate lull: a commander that decides to back
   * off needs the decision to survive the next contact edge, or the fast tier
   * simply re-engages and the pause never happens.
   */
  holdSec: z.number().min(0).max(240),
});

export type ValidatedPlan = z.infer<typeof planSchema>;
export type CreatureRole = z.infer<typeof role>;

export function planJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(planSchema, { io: 'output' }) as Record<string, unknown>;
}
