import {
  BELIEF_CELL_M,
  BELIEF_CHECK_RADIUS_M,
  BELIEF_DECAY_PER_SEC,
  BELIEF_DIFFUSE_PER_SEC,
  BELIEF_MIN_MASS,
} from '@ember/shared';
import type { Vec2 } from '@ember/shared';

/**
 * What one creature believes about where you are.
 *
 * This is the spine of the whole creature stack, and the reason it exists is
 * that a hunter which only knows "the last place I sensed something" is beaten
 * once and beaten forever: you learn its one behaviour in a single run and
 * never fear it again. A creature carrying a *distribution* behaves like
 * something that reasons — it commits to the likely places, works outward when
 * they come up empty, and does not re-check ground it just walked.
 *
 * Three properties make it honest as well as useful:
 *
 *   - Mass only ever enters through a real sense event, or through a call from
 *     another creature that had one. There is no path from a player's true
 *     position into this field that does not pass through something the pack
 *     actually perceived.
 *   - It decays and it spreads, so a belief is always worse than the
 *     observation that created it, and gets worse with time.
 *   - Walking through a place removes mass from it. That is what turns a blob
 *     of probability into visible searching.
 *
 * It is also the *only* spatial thing either language model is ever shown
 * (Step 10). Because everything above reads this rather than the world, the
 * fairness boundary is a property of the data flow rather than a rule anybody
 * has to remember to follow.
 *
 * Deliberately server-side state, held off `WorldState`: the world is
 * `structuredClone`d for snapshots and prediction, and a creature's belief is
 * both large and exactly the sort of thing that must never drift toward a wire.
 */
export interface BeliefField {
  /** Grid size in cells. */
  w: number;
  h: number;
  /** Cell size in metres. */
  cellM: number;
  /** Unnormalised probability mass per cell. */
  p: Float32Array;
  /** Tick each cell was last physically checked. Zero means never. */
  checked: Int32Array;
  /** Reused blur buffer, so diffusion allocates nothing per tick. */
  scratch: Float32Array;
}

export function createBelief(worldW: number, worldH: number): BeliefField {
  const w = Math.max(1, Math.ceil(worldW / BELIEF_CELL_M));
  const h = Math.max(1, Math.ceil(worldH / BELIEF_CELL_M));
  return {
    w,
    h,
    cellM: BELIEF_CELL_M,
    p: new Float32Array(w * h),
    checked: new Int32Array(w * h),
    scratch: new Float32Array(w * h),
  };
}

export function cellOf(field: BeliefField, pos: Vec2): { cx: number; cy: number } {
  return {
    cx: Math.min(field.w - 1, Math.max(0, Math.floor(pos.x / field.cellM))),
    cy: Math.min(field.h - 1, Math.max(0, Math.floor(pos.y / field.cellM))),
  };
}

/** Centre of a cell in world metres. */
export function cellCentre(field: BeliefField, cx: number, cy: number): Vec2 {
  return { x: (cx + 0.5) * field.cellM, y: (cy + 0.5) * field.cellM };
}

/**
 * Add mass around an observation.
 *
 * `spread` is in cells and encodes how good the observation was: seeing a
 * lantern is worth a tight spike, hearing a footfall at the edge of earshot is
 * worth a broad smear. That difference is what makes a creature acting on sound
 * arrive in roughly the right area rather than precisely on your head, which is
 * the difference between an animal and a homing missile.
 */
export function injectBelief(
  field: BeliefField,
  pos: Vec2,
  mass: number,
  spread: number,
): void {
  const { cx, cy } = cellOf(field, pos);
  const r = Math.max(0, Math.round(spread));

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= field.w || y >= field.h) continue;

      // Falls off with distance from the observation, so the peak stays where
      // the creature actually sensed something.
      const d = Math.hypot(dx, dy);
      if (d > r + 0.5) continue;
      const weight = 1 / (1 + d * d);

      field.p[y * field.w + x] = (field.p[y * field.w + x] ?? 0) + mass * weight;
    }
  }
}

/**
 * Age the field: belief fades, and what remains spreads.
 *
 * Both are per-second rates raised to `dt`, so the behaviour does not change if
 * the tactical tick rate is ever retuned.
 */
export function ageBelief(field: BeliefField, dt: number): void {
  const keep = Math.pow(BELIEF_DECAY_PER_SEC, dt);
  const spread = 1 - Math.pow(1 - BELIEF_DIFFUSE_PER_SEC, dt);

  const { p, scratch, w, h } = field;

  // Four-neighbour blur. Diffusion is the model of you having moved since the
  // creature last knew anything: the longer ago it was, the wider the area it
  // has to consider, which is exactly why a stale contact produces a search
  // rather than a beeline.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const self = p[i] ?? 0;

      let sum = 0;
      let n = 0;
      if (x > 0) { sum += p[i - 1] ?? 0; n++; }
      if (x < w - 1) { sum += p[i + 1] ?? 0; n++; }
      if (y > 0) { sum += p[i - w] ?? 0; n++; }
      if (y < h - 1) { sum += p[i + w] ?? 0; n++; }

      const neighbours = n > 0 ? sum / n : self;
      const blurred = self * (1 - spread) + neighbours * spread;
      scratch[i] = blurred * keep;
    }
  }

  for (let i = 0; i < p.length; i++) {
    const v = scratch[i] ?? 0;
    // Snap the long tail to zero so a field never stays faintly non-empty
    // forever, which would stop a creature from ever concluding it has lost you.
    p[i] = v < BELIEF_MIN_MASS ? 0 : v;
  }
}

/**
 * Record that a creature has physically been somewhere and found nothing.
 *
 * The negative information half, and the single change that makes creatures
 * read as searching rather than wandering. Without it a creature orbits the
 * same peak forever; with it, checking a place removes it from consideration
 * and the search visibly works outward.
 */
export function markChecked(field: BeliefField, pos: Vec2, tick: number): void {
  const { cx, cy } = cellOf(field, pos);
  const r = Math.ceil(BELIEF_CHECK_RADIUS_M / field.cellM);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= field.w || y >= field.h) continue;
      if (Math.hypot(dx * field.cellM, dy * field.cellM) > BELIEF_CHECK_RADIUS_M) continue;

      const i = y * field.w + x;
      field.p[i] = 0;
      field.checked[i] = tick;
    }
  }
}

/** Total mass. Zero means the creature has no idea where anybody is. */
export function totalBelief(field: BeliefField): number {
  let sum = 0;
  for (let i = 0; i < field.p.length; i++) sum += field.p[i] ?? 0;
  return sum;
}

export interface BeliefPeak {
  pos: Vec2;
  mass: number;
}

/**
 * The most promising place to look, given where the creature is standing.
 *
 * Not simply the highest cell: a creature that always walks to the global
 * maximum ping-pongs between two similar peaks and looks broken. Mass is
 * discounted by travel distance and boosted by how long it has been since the
 * cell was checked, which produces a creature that sweeps an area outward
 * instead of oscillating across it.
 */
export function bestSearchTarget(
  field: BeliefField,
  from: Vec2,
  tick: number,
): BeliefPeak | null {
  let bestScore = 0;
  let best: BeliefPeak | null = null;

  for (let cy = 0; cy < field.h; cy++) {
    for (let cx = 0; cx < field.w; cx++) {
      const i = cy * field.w + cx;
      const mass = field.p[i] ?? 0;
      if (mass <= 0) continue;

      const centre = cellCentre(field, cx, cy);
      const dist = Math.hypot(centre.x - from.x, centre.y - from.y);

      // Nearby beats far, but never so strongly that a creature refuses to
      // cross the map for something it is confident about.
      const reach = 1 / (1 + dist / 40);

      // Somewhere it has not looked recently is worth more than somewhere it
      // just cleared, even at equal mass.
      const sinceChecked = tick - (field.checked[i] ?? 0);
      const freshness = 1 + Math.min(1, sinceChecked / 1200);

      const score = mass * reach * freshness;
      if (score > bestScore) {
        bestScore = score;
        best = { pos: centre, mass };
      }
    }
  }

  return best;
}

/**
 * Fold one creature's belief into another's — what a call actually does.
 *
 * This is the mechanic that makes `summon` more than a noise. A creature that
 * has you and calls out hands its picture of where you are to everything in
 * earshot, so three creatures converging from different angles is not scripted
 * coordination: it is three fields that now agree. It is also why calling has a
 * real cost, since the call that gathers the pack also tells you where they are.
 */
export function blendBelief(dst: BeliefField, src: BeliefField, weight: number): void {
  if (dst.p.length !== src.p.length) return;
  for (let i = 0; i < dst.p.length; i++) {
    const incoming = (src.p[i] ?? 0) * weight;
    if (incoming <= 0) continue;
    // Take the stronger of the two rather than summing: hearing the same call
    // from two directions should not make a creature twice as certain.
    dst.p[i] = Math.max(dst.p[i] ?? 0, incoming);
  }
}
