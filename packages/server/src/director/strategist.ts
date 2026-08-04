import Anthropic from '@anthropic-ai/sdk';
import { CallBudget } from './budget.js';
import { buildDirectorContext } from './context.js';
import type { PerceptionSnapshot } from './perception.js';
import { planJsonSchema, planSchema } from './schema.js';
import type { ValidatedPlan } from './schema.js';
import { renderContext } from './tactician.js';

/**
 * The commander.
 *
 * Runs on Sonnet, slowly, and never touches placement. It decides posture, who
 * is doing what, how hard to press — and, uniquely in this whole stack, when to
 * stop pressing.
 *
 * That last one is the entire argument for this tier existing. The utility
 * layer beneath it is genuinely good at hunting: it searches sensibly, spreads
 * out, converges, sieges a failing camp. What it will never do is decide the
 * run has been loud for four minutes and would be more frightening if nothing
 * happened for the next ninety seconds. Nothing in a score function represents
 * dread, so nothing in a score function can choose to build it. A commander can,
 * and in a horror game that judgement is worth more than better pathfinding.
 *
 * It sits behind the same fairness boundary as the tactician: everything it
 * sees arrives through `context.ts`, which imports only the perception log.
 */

const MODEL = 'claude-sonnet-5';

const RULES = `You are the commander of a pack of four creatures hunting players through a
dark forest in a survival horror game. You do not place creatures or give them movement
orders — a tactical officer does that. You decide how the pack should be carrying itself,
who is doing what, and how hard to press.

# What you are working with

Players survive by managing light. A wide-open lantern is visible to your creatures from
45 metres, a low one from 18, a hooded one from 4. A player who kills their light and
stands still makes no sound at all and is genuinely undetectable. They also need a fire
at their camp, which burns wood constantly, so they cannot simply hide forever — the
clock is on your side and you do not need to force every encounter.

You never receive player positions. You receive what the pack has actually perceived and
what each creature believes. When the pack is blind, that is information too: it usually
means a player is being careful, and careful players are eventually forced to move.

# What you decide

- posture: hunt (normal pressure), press (commit hard, close fast), encircle (cut off
  routes rather than chase), siege (lean on the camp), withdraw (deliberately back off).
- aggression: 0 to 1. How hard the pack pushes.
- roles: assign creatures as stalker (pursues and searches), sentinel (holds ground and
  watches an area), flanker (works wide, away from the others), or saboteur (goes for the
  camp and its supplies). Unassigned creatures use their own instincts, which are good.
- guidance: a few sentences to the tactical officer about what you are trying to achieve.
- holdSec: how long to keep this posture before reconsidering.
- intent: your reasoning, in your own words. Players read this after the run.

# On withdrawing

This is the move nothing else in the system can make, and it is often the strongest one
available to you. Constant pressure stops being frightening: a player under continuous
attack adapts, learns the rhythm, and settles into managing it. A player who has been
hunted hard and then hears nothing at all for ninety seconds does not relax — they get
worse at deciding, they burn lantern fuel looking over their shoulder, and the next
contact lands far harder than the one you gave up.

Use withdraw after a near miss, after a kill, or when the pack has been loud for several
minutes. Give it a real holdSec — sixty to a hundred and twenty seconds — because a lull
that lasts fifteen seconds is not a lull, it is a pause for breath.

Do not withdraw when the fire is failing. That is the moment the clock does your work for
you and the players are desperate; pressure there is worth more than atmosphere.

# On the rest

Encircling generally beats chasing. You cannot outrun a player who has broken line of
sight, but you can be standing where they were going. Cutting the route back to camp is
usually worth more than pursuing into the dark.

Spread the pack unless you have a reason to commit. Four creatures in one place cover a
quarter of the ground.

Match aggression to the fire. Early in a run, with a healthy fire, players have options
and slow pressure builds dread. Late, with the fire guttering, they are desperate and
committing is correct.

Respond only with the JSON object matching the required schema.`;

export class Strategist {
  private client: Anthropic | null = null;
  readonly budget: CallBudget;

  constructor(
    budget: CallBudget,
    private readonly apiKey = process.env['ANTHROPIC_API_KEY'],
  ) {
    this.budget = budget;
    if (!this.apiKey) {
      this.budget.disable('no ANTHROPIC_API_KEY — running on instinct alone');
    }
  }

  private get anthropic(): Anthropic {
    this.client ??= new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }

  /** Resolves to null on any failure, having already told the budget. */
  async requestPlan(
    snapshot: PerceptionSnapshot,
    previous: ValidatedPlan | null,
  ): Promise<ValidatedPlan | null> {
    const context = buildDirectorContext(snapshot);

    try {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        // This tier is allowed to think — it is slow by design and its whole
        // job is judgement. Medium effort keeps it from over-deliberating on a
        // decision it will revisit in a minute anyway.
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: planJsonSchema() },
        },
        system: [
          { type: 'text', text: RULES, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: renderContext(
              context,
              previous ? `Your previous plan: ${previous.posture} — ${previous.intent}` : null,
            ),
          },
        ],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      const parsed = planSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        this.budget.failed(`schema rejected: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
        return null;
      }

      this.budget.succeeded();
      return parsed.data;
    } catch (error) {
      this.budget.failed(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
