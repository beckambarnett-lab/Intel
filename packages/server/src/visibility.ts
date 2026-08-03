import {
  CREATURE_LAUNCH_MAX_RANGE_M,
  LIT_FIGURE_VISIBLE_M,
  VISIBILITY_HYSTERESIS_MS,
  canSee,
  lanternRadius,
  lanternSeenAt,
  raycastLOS,
} from '@ember/shared';
import type {
  CreatureView,
  DroppedLanternView,
  FireView,
  Player,
  PlayerId,
  WorldItem,
  WorldState,
} from '@ember/shared';

/**
 * The fire as this player may see it.
 *
 * Tier and radius always: the horizon bloom is meant to be readable from the
 * far end of the map (Q13), and it is the only navigation aid in the game.
 * The exact fuel and the ember countdown only when they are standing in the
 * firelight, per Q127 — knowing the fire has 41 seconds left is not something
 * you should be able to read from 800m away.
 */
export function fireViewFor(world: WorldState, viewerId: PlayerId): FireView {
  const f = world.fire;
  const view: FireView = {
    pos: { ...f.pos },
    tier: f.tier,
    lightRadiusM: f.lightRadiusM,
    safeRadiusM: f.safeRadiusM,
    dead: f.dead,
  };

  const viewer = world.players[viewerId];
  if (viewer && canSee(world.grid, f.pos, f.lightRadiusM, viewer.pos)) {
    view.fuel = f.fuel;
    view.emberSecLeft = f.emberSecLeft;
  }

  return view;
}

/**
 * Per-player visibility culling — the anti-cheat spine (Q122).
 *
 * The rule this file exists to enforce: **the server never sends a client
 * anything it cannot see.** Not "sends it and the client hides it" — a client
 * is an adversary with devtools, and anything on the wire is visible to it. If
 * this is ever relaxed, the darkness stops being a game mechanic and becomes a
 * rendering effect, and every system built on top of it (the duel, listen mode,
 * the director's information asymmetry) stops meaning anything.
 *
 * A player sees another entity when either:
 *   - it is inside their own lantern's light and unobstructed, or
 *   - it is lit by the bonfire, and they have an unobstructed line to it.
 *
 * The second clause needs both halves. Standing in firelight makes you visible
 * to anyone who can see the fire's clearing — not to someone on the far side of
 * a rock, who would otherwise be handed your position through a wall.
 */
export class VisibilityIndex {
  /** `${viewer}|${target}` -> last timestamp the pair was genuinely visible. */
  private lastSeenAt = new Map<string, number>();

  /**
   * The entities `viewerId` is allowed to receive this tick.
   *
   * `nowMs` is passed rather than read from the clock so the hysteresis window
   * is testable without waiting on real time.
   */
  visibleTo(world: WorldState, viewerId: PlayerId, nowMs: number): Player[] {
    const viewer = world.players[viewerId];
    if (!viewer) return [];

    const out: Player[] = [];
    const lantern = lanternRadius(viewer.lantern);

    for (const id of Object.keys(world.players)) {
      const target = world.players[id];
      if (!target) continue;

      // You always know where you are. Culling yourself would break prediction.
      if (id === viewerId) {
        out.push(target);
        continue;
      }

      const key = `${viewerId}|${id}`;

      if (this.isVisible(world, viewer, target, lantern)) {
        this.lastSeenAt.set(key, nowMs);
        out.push(target);
        continue;
      }

      // Hysteresis (§21 Step 2.5): keep sending briefly after they drop out, so
      // someone walking your light's edge does not strobe. This only ever
      // extends a target you already legitimately saw — it never reveals one
      // early, which is why it cannot be used to see into the dark.
      const last = this.lastSeenAt.get(key);
      if (last !== undefined && nowMs - last < VISIBILITY_HYSTERESIS_MS) {
        out.push(target);
      }
    }

    return out;
  }

  private isVisible(
    world: WorldState,
    viewer: Player,
    target: Player,
    lanternRadiusM: number,
  ): boolean {
    if (canSee(world.grid, viewer.pos, lanternRadiusM, target.pos)) return true;

    const fire = world.fire;
    return (
      canSee(world.grid, fire.pos, fire.lightRadiusM, target.pos) &&
      // A lit figure across open ground is genuinely visible — that is a real
      // tactical fact about standing in the firelight — but only out to the
      // range a person can actually be made out (Q45), not forever down the
      // length of the tube.
      canSee(world.grid, viewer.pos, LIT_FIGURE_VISIBLE_M, target.pos)
    );
  }

  /**
   * The items this player may receive.
   *
   * Q21 is explicit that dropped wood is "visible to nobody in the dark —
   * including you", so items go through exactly the same test as players do.
   * A stash you cannot find again is a real way to lose a load, and that only
   * holds if the client is never told where it is.
   */
  visibleItemsTo(world: WorldState, viewerId: PlayerId, nowMs: number): WorldItem[] {
    const viewer = world.players[viewerId];
    if (!viewer) return [];

    const out: WorldItem[] = [];
    const lantern = lanternRadius(viewer.lantern);
    const fire = world.fire;

    for (const id of Object.keys(world.items)) {
      const item = world.items[id];
      if (!item) continue;

      const key = `${viewerId}|item:${id}`;
      const lit =
        canSee(world.grid, viewer.pos, lantern, item.pos) ||
        (canSee(world.grid, fire.pos, fire.lightRadiusM, item.pos) &&
          canSee(world.grid, viewer.pos, LIT_FIGURE_VISIBLE_M, item.pos));

      if (lit) {
        this.lastSeenAt.set(key, nowMs);
        out.push(item);
        continue;
      }

      const last = this.lastSeenAt.get(key);
      if (last !== undefined && nowMs - last < VISIBILITY_HYSTERESIS_MS) out.push(item);
    }

    return out;
  }

  /**
   * Tiles whose trees have been felled and that this player can currently see.
   *
   * Felling permanently clears an occluder (Q20), and the client has to apply
   * that to its own grid or its lighting and its collision drift from the
   * server's. Culled like everything else: learning that a trunk fell 200m
   * away would tell you exactly where somebody is chopping.
   */
  visibleFelledTilesTo(
    world: WorldState,
    viewerId: PlayerId,
  ): { x: number; y: number }[] {
    const viewer = world.players[viewerId];
    if (!viewer) return [];

    const out: { x: number; y: number }[] = [];
    const lantern = lanternRadius(viewer.lantern);
    const fire = world.fire;

    for (const id of Object.keys(world.trees)) {
      const tree = world.trees[id];
      if (!tree || !tree.felled) continue;

      const lit =
        canSee(world.grid, viewer.pos, lantern, tree.pos) ||
        (canSee(world.grid, fire.pos, fire.lightRadiusM, tree.pos) &&
          canSee(world.grid, viewer.pos, LIT_FIGURE_VISIBLE_M, tree.pos));

      if (lit) out.push({ x: tree.tx, y: tree.ty });
    }

    return out;
  }

  /**
   * The creatures this player may receive.
   *
   * The same predicate as players and items, and that is the point: a creature
   * stalking you from outside your lantern is not culled *for effect*, it is
   * culled because the client is never told anything it cannot see. Open the
   * websocket log while one is hunting you and there is nothing in it — which
   * is the only reason the dark is frightening rather than decorative.
   */
  visibleCreaturesTo(world: WorldState, viewerId: PlayerId, nowMs: number): CreatureView[] {
    const viewer = world.players[viewerId];
    if (!viewer) return [];

    const out: CreatureView[] = [];
    const lantern = lanternRadius(viewer.lantern);
    const fire = world.fire;

    for (const id of Object.keys(world.creatures)) {
      const c = world.creatures[id];
      if (!c || !c.alive) continue;

      const key = `${viewerId}|creature:${id}`;

      // A creature rearing to charge, or already committed to one, is sent
      // inside its launch range even though your lantern does not reach it.
      //
      // This is a deliberate, narrow exception to Q122 and worth stating
      // plainly. It is not "see in the dark": the thing has stopped, reared,
      // roared, and is about to cover twenty metres in a second. A player would
      // perceive that, and without it the dodge is a mechanic you can never
      // react to — which makes it random death rather than a fight.
      //
      // It stays honest in practice because the renderer still decides what you
      // actually SEE. On ground you remember it comes through at memory
      // brightness, dim and warped and easily mistaken for a phantom; on ground
      // you have never lit it stays black. Nothing is revealed that the darkness
      // was hiding, only that something enormous has announced itself.
      const charging = c.state === 'wind' || c.state === 'launch';
      const announced =
        charging &&
        Math.hypot(c.pos.x - viewer.pos.x, c.pos.y - viewer.pos.y) <= CREATURE_LAUNCH_MAX_RANGE_M &&
        raycastLOS(world.grid, viewer.pos, c.pos);

      const lit =
        announced ||
        canSee(world.grid, viewer.pos, lantern, c.pos) ||
        (canSee(world.grid, fire.pos, fire.lightRadiusM, c.pos) &&
          canSee(world.grid, viewer.pos, LIT_FIGURE_VISIBLE_M, c.pos));

      if (lit) {
        this.lastSeenAt.set(key, nowMs);
        out.push({ id: c.id, pos: { ...c.pos }, state: c.state });
        continue;
      }

      const last = this.lastSeenAt.get(key);
      if (last !== undefined && nowMs - last < VISIBILITY_HYSTERESIS_MS) {
        out.push({ id: c.id, pos: { ...c.pos }, state: c.state });
      }
    }

    return out;
  }

  /**
   * Lanterns on the ground this player can see (Q41).
   *
   * A burning lantern is a light source, so the question is whether you have a
   * clear line to it inside the range it can be seen from (Q37/Q45) — not
   * whether it happens to fall inside your own beam. A dark one, burnt out or
   * hooded to nothing, is culled like any other object in the dark.
   */
  visibleLanternsTo(world: WorldState, viewerId: PlayerId, nowMs: number): DroppedLanternView[] {
    const viewer = world.players[viewerId];
    if (!viewer) return [];

    const out: DroppedLanternView[] = [];
    const lantern = lanternRadius(viewer.lantern);
    const fire = world.fire;

    for (const id of Object.keys(world.droppedLanterns)) {
      const dl = world.droppedLanterns[id];
      if (!dl) continue;

      const key = `${viewerId}|lantern:${id}`;
      const seenAt = lanternSeenAt(dl.lantern);
      const visible =
        (seenAt > 0 && canSee(world.grid, dl.pos, seenAt, viewer.pos)) ||
        canSee(world.grid, viewer.pos, lantern, dl.pos) ||
        (canSee(world.grid, fire.pos, fire.lightRadiusM, dl.pos) &&
          canSee(world.grid, viewer.pos, LIT_FIGURE_VISIBLE_M, dl.pos));

      if (visible) {
        this.lastSeenAt.set(key, nowMs);
        out.push({ id: dl.id, pos: { ...dl.pos }, radiusM: lanternRadius(dl.lantern) });
        continue;
      }

      const last = this.lastSeenAt.get(key);
      if (last !== undefined && nowMs - last < VISIBILITY_HYSTERESIS_MS) {
        out.push({ id: dl.id, pos: { ...dl.pos }, radiusM: lanternRadius(dl.lantern) });
      }
    }

    return out;
  }

  /** Drop a departed player's pairs so the map does not grow across a long run. */
  forget(playerId: PlayerId): void {
    for (const key of this.lastSeenAt.keys()) {
      if (key.startsWith(`${playerId}|`) || key.endsWith(`|${playerId}`)) {
        this.lastSeenAt.delete(key);
      }
    }
  }
}
