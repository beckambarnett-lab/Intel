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
