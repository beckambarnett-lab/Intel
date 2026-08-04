import {
  BELIEF_SUMMON_THRESHOLD,
  CREATURE_ARRIVE_M,
  CREATURE_CHARGE_RANGE_M,
  CREATURE_HEALTH,
  CREATURE_KILL_RANGE_M,
  CREATURE_RADIUS,
  CREATURE_RESPAWN_SEC,
  CREATURE_SABOTAGE_BATCH,
  CREATURE_SABOTAGE_RANGE_M,
  CREATURE_SABOTAGE_SEC,
  FIRE_CAPACITY,
  FIRE_PERIMETER_MIN_FRAC,
  SABOTAGE_SCATTER_MAX_M,
  SABOTAGE_SCATTER_MIN_M,
  UTILITY_PATROL,
  UTILITY_PURSUE,
  UTILITY_SABOTAGE,
  UTILITY_SEARCH,
  UTILITY_SIEGE,
  UTILITY_SPACING_M,
  UTILITY_SPACING_WEIGHT,
  bodyBlocked,
  mulberry32,
  spawnItem,
  vocalize,
} from '@ember/shared';
import type { Creature, ItemKind, Stance, Vec2, WorldState } from '@ember/shared';
import { bestSearchTarget, markChecked, totalBelief } from './belief.js';
import type { BeliefField } from './belief.js';
import type { Personality } from './personality.js';

/**
 * Tier one — instinct.
 *
 * What a creature does when nothing smarter is telling it anything, which has
 * to include the case where nothing smarter ever will. The director can be
 * slow, rate-limited, or absent entirely with the API key removed, and the game
 * still has to work; DESIGN.md Step 6 is blunt that creatures which are not
 * frightening on their own will not be rescued by a language model.
 *
 * The shape is utility scoring rather than a state machine, and that choice is
 * the point. An eight-state priority switch flips on thresholds, and threshold
 * flipping is what produces the twitchy snapping that reads as a video game
 * enemy from twenty years ago. Scoring a handful of options and taking the best
 * gives behaviour that shades between intentions instead of jumping between
 * them: a creature drifts off a cold trail rather than abandoning it on a
 * frame, and leans toward a failing camp rather than switching to Siege Mode.
 *
 * Every option is scored against the creature's own belief field, so nothing
 * here can consult a truth the creature has not earned.
 */

export interface Mind {
  belief: BeliefField;
  personality: Personality;
}

type OptionKind = 'pursue' | 'search' | 'patrol' | 'siege' | 'sabotage';

interface Option {
  kind: OptionKind;
  goal: Vec2;
  stance: Stance;
  score: number;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * How crowded a destination is.
 *
 * Applied to every option so that four creatures never converge on one point
 * unless the pull there is overwhelming. Without it they clump, cover a quarter
 * of the ground, and read as a single animal with four bodies; with it they
 * spread out and the wood feels occupied. Independence scales how much a
 * particular creature minds the company.
 */
function crowding(world: WorldState, self: Creature, goal: Vec2, independence: number): number {
  let penalty = 0;

  for (const id of Object.keys(world.creatures)) {
    if (id === self.id) continue;
    const other = world.creatures[id];
    if (!other || !other.alive) continue;

    const d = dist(goal, other.pos);
    if (d >= UTILITY_SPACING_M) continue;
    penalty += (1 - d / UTILITY_SPACING_M) * UTILITY_SPACING_WEIGHT * independence;
  }

  return penalty;
}

/** Chasing something it can currently sense, or recently could. */
function pursueOption(world: WorldState, creature: Creature, mind: Mind): Option | null {
  const contact = creature.contact;
  if (!contact) return null;

  const range = dist(creature.pos, contact.pos);
  const sensingNow = contact.tick === world.tick;

  // Arrived at a memory and found nothing there. Handled by the caller as a
  // state change; here it simply stops being an option worth scoring.
  if (!sensingNow && range <= CREATURE_ARRIVE_M) return null;

  const { aggression } = mind.personality;

  // Committing is loud (Q69), and that is the trade: the moment it decides to
  // take you, you can hear it decide. A more aggressive creature commits from
  // further out.
  const chargeRange = CREATURE_CHARGE_RANGE_M * (0.6 + 0.8 * aggression);
  const stance: Stance =
    range <= chargeRange && contact.via === 'light' ? 'charge' : 'stalk';

  const score = UTILITY_PURSUE * contact.confidence * (0.7 + 0.6 * aggression);

  return { kind: 'pursue', goal: { ...contact.pos }, stance, score };
}

/** Working the belief field — the behaviour that reads as searching. */
function searchOption(world: WorldState, creature: Creature, mind: Mind): Option | null {
  const target = bestSearchTarget(mind.belief, creature.pos, world.tick);
  if (!target) return null;

  const { patience } = mind.personality;
  const score = UTILITY_SEARCH * Math.min(1, target.mass) * (0.6 + 0.8 * patience);

  return { kind: 'search', goal: target.pos, stance: 'sweep', score };
}

const SWEEP_RADIUS_M = 26;
const SWEEP_ATTEMPTS = 10;

/** Casting about near home, for when the creature knows nothing at all. */
function patrolOption(world: WorldState, creature: Creature): Option {
  // Only reroll on arrival, so a creature commits to a direction instead of
  // picking a fresh one every time it thinks.
  if (creature.goal && dist(creature.pos, creature.goal) > CREATURE_ARRIVE_M) {
    return { kind: 'patrol', goal: creature.goal, stance: 'sweep', score: UTILITY_PATROL };
  }

  let h = 2166136261;
  for (let i = 0; i < creature.id.length; i++) {
    h ^= creature.id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = mulberry32((h ^ Math.imul(world.tick, 2654435761)) >>> 0);

  for (let i = 0; i < SWEEP_ATTEMPTS; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = SWEEP_RADIUS_M * Math.sqrt(rand());
    const p = {
      x: creature.anchor.x + Math.cos(angle) * radius,
      y: creature.anchor.y + Math.sin(angle) * radius,
    };

    if (p.x < CREATURE_RADIUS || p.y < CREATURE_RADIUS) continue;
    if (p.x > world.bounds.w - CREATURE_RADIUS) continue;
    if (p.y > world.bounds.h - CREATURE_RADIUS) continue;
    if (bodyBlocked(world.grid, p.x, p.y, CREATURE_RADIUS)) continue;

    return { kind: 'patrol', goal: p, stance: 'sweep', score: UTILITY_PATROL };
  }

  return {
    kind: 'patrol',
    goal: { ...creature.anchor },
    stance: 'sweep',
    score: UTILITY_PATROL,
  };
}

/**
 * Leaning on a failing camp.
 *
 * Scored rather than switched, which is what stops this from being a Siege Mode
 * that snaps on at a threshold. While the fire is healthy the pull is zero —
 * the perimeter holds regardless (Q7), so crowding it would just park four
 * creatures at the edge of the light looking foolish. As the fuel drops they
 * start to drift in, and by the time the perimeter actually fails they are
 * already there. Nothing scripts the siege; it arrives because the numbers move.
 */
function siegeOption(world: WorldState, creature: Creature): Option | null {
  const frac = world.fire.fuel / FIRE_CAPACITY;
  // Twice the failure threshold: they start closing in well before it breaks.
  const onset = FIRE_PERIMETER_MIN_FRAC * 2;
  if (frac >= onset) return null;

  const urgency = 1 - frac / onset;
  const fire = world.fire.pos;

  // Stand off at the perimeter while it holds; walk in once it does not.
  const standoff = world.fire.safeRadiusM > 0 ? world.fire.safeRadiusM + 2 : 0;
  const away = dist(creature.pos, fire) || 1;
  const goal =
    standoff > 0
      ? {
          x: fire.x + ((creature.pos.x - fire.x) / away) * standoff,
          y: fire.y + ((creature.pos.y - fire.y) / away) * standoff,
        }
      : { ...fire };

  return { kind: 'siege', goal, stance: 'stalk', score: UTILITY_SIEGE * urgency };
}

/**
 * Going for the woodpile (Q24).
 *
 * Their primary sabotage, and it needs no permission system of its own: a
 * creature can only work the pile if it can stand within reach of it, and the
 * fire's own safe radius already decides where it may stand. A healthy fire
 * keeps the wood untouchable; a failing one exposes it. So the threat arrives
 * precisely when it hurts most — they start taking the fuel at the moment you
 * most need it — without a single line deciding that it should.
 *
 * They do not destroy it. Scattered wood is still yours if you are willing to
 * go out into the dark and find it, which is the same bargain Q29 makes for
 * dragged scrap.
 */
function sabotageOption(world: WorldState, creature: Creature): Option | null {
  const pile = world.woodpile;
  const stock = pile.contents.log + pile.contents.branch;
  if (stock <= 0) return null;

  const fire = world.fire;
  const pileToFire = dist(pile.pos, fire.pos);
  const reach = CREATURE_SABOTAGE_RANGE_M;

  // Can a creature stand anywhere close enough to work it? The perimeter is a
  // hard wall (see `blocked` in creatures.ts), so this is pure geometry.
  if (fire.safeRadiusM > 0 && fire.safeRadiusM > pileToFire + reach) return null;

  // Stand off the pile on the side away from the fire, the only side it can
  // legally approach from while any perimeter remains.
  const away = pileToFire || 1;
  const standoff = Math.max(fire.safeRadiusM, pileToFire) + 0.2;
  const goal =
    fire.safeRadiusM > 0
      ? {
          x: fire.pos.x + ((pile.pos.x - fire.pos.x) / away) * standoff,
          y: fire.pos.y + ((pile.pos.y - fire.pos.y) / away) * standoff,
        }
      : { ...pile.pos };

  // A big pile is worth more than a nearly empty one — there is no point
  // standing in the open for three seconds to hurl two branches.
  const worth = Math.min(1, stock / 10);

  return { kind: 'sabotage', goal, stance: 'sabotage', score: UTILITY_SABOTAGE * worth };
}

/**
 * Advance a sabotage channel, and scatter a batch when it completes.
 *
 * Runs every tick after the bodies have moved, so progress reflects where the
 * creature actually ended up rather than where it intended to go.
 */
export function progressSabotage(world: WorldState, dt: number): void {
  const pile = world.woodpile;

  for (const id of Object.keys(world.creatures)) {
    const creature = world.creatures[id];
    if (!creature || !creature.alive) continue;

    const working =
      creature.stance === 'sabotage' &&
      dist(creature.pos, pile.pos) <= CREATURE_SABOTAGE_RANGE_M &&
      pile.contents.log + pile.contents.branch > 0;

    if (!working) {
      // Interrupted, exactly like a player's stoke: walking away costs you the
      // seconds you had put in.
      creature.sabotageProgress = 0;
      continue;
    }

    creature.sabotageProgress += dt;
    if (creature.sabotageProgress < CREATURE_SABOTAGE_SEC) continue;

    creature.sabotageProgress = 0;
    scatter(world, creature);
  }
}

/** Hurl a batch of wood out past the firelight, where it is very hard to find. */
function scatter(world: WorldState, creature: Creature): void {
  const pile = world.woodpile;
  const rand = mulberry32(
    (Math.imul(world.tick, 2654435761) ^ creature.id.charCodeAt(creature.id.length - 1)) >>> 0,
  );

  for (let i = 0; i < CREATURE_SABOTAGE_BATCH; i++) {
    // Logs first: they are the fuel that matters, and losing them hurts most.
    const kind: ItemKind = pile.contents.log > 0 ? 'log' : 'branch';
    if (pile.contents[kind] <= 0) break;
    pile.contents[kind] -= 1;

    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = rand() * Math.PI * 2;
      const radius =
        world.fire.safeRadiusM +
        SABOTAGE_SCATTER_MIN_M +
        rand() * (SABOTAGE_SCATTER_MAX_M - SABOTAGE_SCATTER_MIN_M);

      const p = {
        x: world.fire.pos.x + Math.cos(angle) * radius,
        y: world.fire.pos.y + Math.sin(angle) * radius,
      };

      if (p.x < 1 || p.y < 1 || p.x > world.bounds.w - 1 || p.y > world.bounds.h - 1) continue;
      if (bodyBlocked(world.grid, p.x, p.y, CREATURE_RADIUS)) continue;

      spawnItem(world, kind, p);
      break;
    }
  }
}

/**
 * Choose a stance and a goal.
 *
 * Called at the tactical rate, not every tick — see CREATURE_THINK_PERIOD_TICKS
 * for why re-deciding twenty times a second is worse than doing it four.
 */
export function decide(world: WorldState, creature: Creature, mind: Mind): void {
  // Losing the trail is a state change, and it is the one the player most needs
  // to hear: it is the sound of going dark having worked. Handled before
  // scoring because it changes what there is to score.
  const contact = creature.contact;
  if (contact && contact.tick !== world.tick) {
    if (dist(creature.pos, contact.pos) <= CREATURE_ARRIVE_M) {
      creature.contact = null;
      // Forced past the cooldown: this fires seconds after the `contact` call,
      // and an ordinary cooldown would eat exactly the sound that matters.
      vocalize(world, creature, 'lost', true);
    }
  }

  const options: Option[] = [];
  const pursue = pursueOption(world, creature, mind);
  if (pursue) options.push(pursue);

  const search = searchOption(world, creature, mind);
  if (search) options.push(search);

  const siege = siegeOption(world, creature);
  if (siege) options.push(siege);

  const sabotage = sabotageOption(world, creature);
  if (sabotage) options.push(sabotage);

  options.push(patrolOption(world, creature));

  const { independence } = mind.personality;
  let best = options[0]!;
  let bestScore = -Infinity;

  for (const option of options) {
    const score = option.score - crowding(world, creature, option.goal, independence);
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }

  creature.stance = best.stance;
  creature.goal = best.goal;

  /**
   * At most one call, and the louder one wins.
   *
   * These share a cooldown, so emitting `contact` first would silently swallow
   * the `summon` that follows it a line later — the same trap that once ate the
   * `lost` call. Priority rather than forcing is the right fix here: a creature
   * calling the pack in is already announcing that it has you, so making both
   * noises is redundant, and forcing a summon past its cooldown would let one
   * creature flatten the clearest signal the player gets.
   *
   * The summon threshold matters in both directions. Too low and the pack
   * spends the run converging on nothing — and since a call also gives away the
   * caller, too low is a straightforward gift to the player.
   */
  if (best.kind === 'pursue') {
    const worthGathering =
      totalBelief(mind.belief) >= BELIEF_SUMMON_THRESHOLD &&
      mind.personality.vocality > 0.5;

    if (worthGathering) {
      vocalize(world, creature, 'summon');
    } else if (best.stance === 'charge') {
      vocalize(world, creature, 'contact');
    }
  }
}

/**
 * Contact kills (Q62).
 *
 * No downed state and no wrestling free — reaching you is the whole threat, and
 * softening it would make every other system in the game less sharp.
 */
export function resolveContact(world: WorldState): void {
  for (const cid of Object.keys(world.creatures)) {
    const creature = world.creatures[cid];
    if (!creature || !creature.alive) continue;

    for (const pid of Object.keys(world.players)) {
      const player = world.players[pid];
      if (!player || !player.alive) continue;

      if (dist(creature.pos, player.pos) <= CREATURE_KILL_RANGE_M) {
        player.alive = false;
        player.vel.x = 0;
        player.vel.y = 0;
      }
    }
  }
}

/** Walking ground clears it. The negative-information half of searching. */
export function recordVisit(world: WorldState, creature: Creature, mind: Mind): void {
  markChecked(mind.belief, creature.pos, world.tick);
}

/** A killed creature walks back out of the lair after five minutes (Q57). */
export function respawn(creature: Creature): void {
  if (creature.alive || creature.respawnSecLeft > 0) return;

  creature.alive = true;
  creature.health = CREATURE_HEALTH;
  creature.damageTaken = 0;
  creature.contact = null;
  creature.goal = null;
  creature.stance = 'sweep';
  creature.pos = { ...creature.anchor };
}

/** Kill a creature. Step 7 calls this from combat; exposed here for tests. */
export function killCreature(creature: Creature): void {
  creature.alive = false;
  creature.health = 0;
  creature.goal = null;
  creature.contact = null;
  creature.vel = { x: 0, y: 0 };
  creature.respawnSecLeft = CREATURE_RESPAWN_SEC;
}
