import Anthropic from '@anthropic-ai/sdk';
import { CallBudget } from './budget.js';
import { buildDirectorContext } from './context.js';
import type { DirectorContext } from './context.js';
import type { PerceptionSnapshot } from './perception.js';
import { orderSetJsonSchema, orderSetSchema } from './schema.js';
import type { ValidatedOrderSet } from './schema.js';

/**
 * The tactical officer.
 *
 * Turns a plan and a perception snapshot into concrete per-creature orders:
 * where to stand, what posture to hold, what to wait for, and what to do when
 * it happens. It is the fast tier, so it runs on Haiku with thinking disabled —
 * latency is the entire point, since a creature waiting on orders is a creature
 * standing still.
 *
 * Two properties this file must never lose:
 *
 *   1. **It is never on the tick path.** The call is fired and forgotten; the
 *      simulation carries on driven by instinct, and orders are picked up
 *      whenever they arrive. A slow model must cost the pack cleverness, never
 *      frames.
 *   2. **It sees only `DirectorContext`.** Everything it knows comes through
 *      the digest built by `context.ts`, which imports nothing but the
 *      perception log. That is the fairness boundary (Q114), and this file sits
 *      on the safe side of it by construction.
 */

const MODEL = 'claude-haiku-4-5';

/**
 * The static half of the prompt, hoisted so it can be cached.
 *
 * Deliberately long. Haiku's minimum cacheable prefix is 4096 tokens — four
 * times Sonnet's — and a block that falls under it silently fails to cache with
 * no error and no signal beyond a `cache_read_input_tokens` of zero. At a few
 * hundred calls a run that is the difference between pennies and most of a
 * dollar, so the rules block is written to clear the bar comfortably rather
 * than being trimmed for elegance.
 */
const RULES = `You are the tactical officer for a pack of four creatures hunting players
through a dark forest in a survival horror game. You translate a strategic plan into
concrete orders for individual creatures.

# What you are working with

The creatures hunt by light and by sound. Players carry lanterns with three shutter
settings; a wide-open lantern is visible to a creature from 45 metres, a low one from
18, and a hooded one only from 4. Players who stand completely still make no sound at
all. This means a player who kills their light and stops moving is genuinely
undetectable, and the only counter is to have already guessed where they went.

You never receive player positions. You receive what the pack has actually perceived:
lights seen, sounds heard, and each creature's own belief about where somebody is.
Beliefs decay and spread over time, so an old one describes an area rather than a
point. If the pack has perceived nothing, you will be told it is blind, and the
correct response to that is usually to spread out and cover ground rather than to
invent a target.

# The orders you can give

Each order is built from primitives, not from named tactics. There is no "ambush"
command; you compose one.

- goto: a map position to move to.
- stance: hold (motionless and silent), stalk (slow, quiet, purposeful), sweep
  (searching, covers ground, fairly loud), charge (committed sprint, very loud),
  withdraw (pull back), sabotage (attack the camp woodpile).
- trigger: what the creature waits for before changing behaviour. One of:
  sound (a player noise of at least some loudness within a range), light (a light
  sensed within a range), call (another creature calls out), beliefWithin (this
  creature's own belief puts somebody within a range of it), or timer (a number of
  ticks; one tick is 50 milliseconds, so 20 ticks is one second).
- onTrigger: the stance to switch to when the trigger fires.
- vocalize: a call to make on arrival. summon carries 80 metres and gathers the pack;
  converge carries 45; contact carries 35; lost carries 25.
- ttlTicks: how long the order binds before the creature reverts to its own instinct.

# Composing plans

An ambush is: goto a position, stance hold, trigger beliefWithin 8, onTrigger charge.
A pincer is several creatures given different goto positions and a shared trigger of
call, so that one springing the trap releases the others. A picket line is several
creatures holding at spaced positions with light triggers. A deliberate withdrawal is
stance withdraw with a timer trigger and onTrigger stalk.

None of these are built in. Any of them, or anything else the primitives allow, is
available to you.

# How to use the pack well

Holding still is powerful and underused. A creature in hold makes no sound and is
effectively invisible, so a held creature covering a route is a genuine trap. Charging
is loud enough that it announces itself, so it should follow a trigger rather than
open a plan.

Spreading out beats converging in most situations. Four creatures on one point cover a
quarter of the ground, and players survive by moving through gaps. Cutting off likely
routes is usually worth more than chasing directly, because you cannot outrun a player
who has broken line of sight — but you can be standing where they were going.

Calls are loud and locate the caller. A summon gathers the pack and hands them the
caller's belief, which is powerful, but it also tells the player where all four
creatures are about to be. Use it when you actually want to commit.

Give short ttlTicks (200 to 600) when the situation is developing and longer ones
(600 to 1200) for patient positioning. An order that outlives its usefulness wastes a
creature, because the creature will follow it rather than think for itself.

Only issue orders for creatures listed in the context. Only issue orders you actually
want; creatures with no order fall back on competent instinct of their own, which is
frequently the right answer. Returning an empty orders array is a valid and sometimes
correct response.

Respond only with the JSON object matching the required schema.`;

export interface TacticianResult {
  orderSet: ValidatedOrderSet;
  /** Rough token accounting, for the cost log. */
  usage?: { input: number; output: number; cacheRead: number };
}

export class Tactician {
  private client: Anthropic | null = null;
  readonly budget: CallBudget;

  constructor(
    budget: CallBudget,
    private readonly apiKey = process.env['ANTHROPIC_API_KEY'],
  ) {
    this.budget = budget;
    if (!this.apiKey) {
      // Not an error. Q117 requires the game play correctly with no key at all,
      // so this is simply a run in which the pack relies on its own instincts.
      this.budget.disable('no ANTHROPIC_API_KEY — running on instinct alone');
    }
  }

  private get anthropic(): Anthropic {
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  /**
   * Ask for orders. Resolves to null on any failure, having already told the
   * budget about it — callers are expected to carry on regardless.
   */
  async requestOrders(
    snapshot: PerceptionSnapshot,
    plan: string | null,
  ): Promise<TacticianResult | null> {
    const context = buildDirectorContext(snapshot);

    try {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        // Latency is the whole point of this tier, and Haiku 4.5 does not
        // support the effort parameter, so thinking is simply off.
        thinking: { type: 'disabled' },
        system: [
          {
            type: 'text',
            text: RULES,
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: {
          format: {
            type: 'json_schema',
            schema: orderSetJsonSchema(),
          },
        },
        messages: [{ role: 'user', content: renderContext(context, plan) }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      // Validate, never coerce (Step 10.4). A malformed order falls through to
      // instinct, which is a path that is already good.
      const parsed = orderSetSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        this.budget.failed(`schema rejected: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
        return null;
      }

      this.budget.succeeded();
      return {
        orderSet: parsed.data,
        usage: {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens,
          cacheRead: response.usage.cache_read_input_tokens ?? 0,
        },
      };
    } catch (error) {
      this.budget.failed(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}

/**
 * The dynamic half of the prompt.
 *
 * Kept small and kept *after* the cached rules block, so that nothing here can
 * invalidate the prefix. Everything in it comes from `DirectorContext` and
 * therefore from perception.
 */
export function renderContext(context: DirectorContext, plan: string | null): string {
  const lines: string[] = [];

  if (plan) lines.push(`# Standing plan\n${plan}\n`);

  lines.push(`# Situation`);
  lines.push(`Elapsed: ${context.elapsedSec}s`);
  lines.push(context.fireTier ? `Camp fire: ${context.fireTier}` : 'Camp fire: not in sight');

  if (context.blind) {
    lines.push('\nThe pack has perceived nothing recently. You are blind.');
  }

  lines.push('\n# Your creatures');
  for (const c of context.creatures) {
    const believes = c.believes
      ? `believes somebody near (${c.believes.pos.x}, ${c.believes.pos.y}) at confidence ${c.believes.confidence}`
      : 'believes nothing';
    lines.push(`- ${c.id}: at (${c.pos.x}, ${c.pos.y}), ${c.stance}, health ${c.health}, ${believes}`);
  }

  if (context.events.length > 0) {
    lines.push('\n# Perceived recently (newest first)');
    for (const e of context.events) {
      lines.push(
        `- ${e.kind} at (${e.pos.x}, ${e.pos.y}), ${e.ageSec}s ago, strength ${e.strength}, by ${e.by}`,
      );
    }
  }

  lines.push('\nIssue orders.');
  return lines.join('\n');
}
