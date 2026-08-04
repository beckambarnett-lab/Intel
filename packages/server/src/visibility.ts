import {
  LIT_FIGURE_VISIBLE_M,
  VISIBILITY_HYSTERESIS_MS,
  canSee,
  heard,
  lanternRadius,
} from '@ember/shared';
import type {
  CallEvent,
  Creature,
  CreatureView,
  FireView,
  Player,
  PlayerId,
  WorldItem,
  WorldState,
} from '@ember/shared';

/** Strip a creature down to what looking at it would tell you. */
function viewOf(creature: Creature): CreatureView {
  return {
    id: creature.id,
    pos: { ...creature.pos },
    facing: creature.facing,
    stance: creature.stance,
    alive: creature.alive,
  };
}

/**
 * Calls this player was in earshot of this tick.
 *
 * Deliberately not gated on sight. Hearing something call from somewhere out in
 * the dark, and then hearing it answered from two other directions, is the
 * clearest read the player ever gets on what the pack is doing — and it works
 * at eighty metres through solid rock, which nothing visual does.
 */
export function audibleCallsTo(world: WorldState, viewer: Player): CallEvent[] {
  const out: CallEvent[] = [];

  for (const sound of world.sounds) {
    if (sound.kind !== 'call') continue;
    if (!heard(sound, viewer.pos)) continue;

    const creature = world.creatures[sound.sourceId];
    if (!creature || !creature.vocalizing) continue;

    out.push({ kind: creature.vocalizing, pos: { ...sound.pos } });
  }

  return out;
}

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
   * The creatures this player may receive, as views rather than as creatures.
   *
   * Same test as everything else: your light, or the fire's light plus a line
   * to it. What differs is what gets built at the end — a `CreatureView`, never
   * the `Creature` itself, because the full struct carries where that creature
   * last sensed somebody and that is a position belonging to another player.
   *
   * Dead creatures are dropped entirely rather than sent with `alive: false`.
   * A corpse you cannot see is not something you should be able to count, and
   * knowing three of the four are down is a fact worth hiding.
   */
  visibleCreaturesTo(world: WorldState, viewerId: PlayerId, nowMs: number): CreatureView[] {
    const viewer = world.players[viewerId];
    if (!viewer) return [];

    const out: CreatureView[] = [];
    const lantern = lanternRadius(viewer.lantern);
    const fire = world.fire;

    for (const id of Object.keys(world.creatures)) {
      const creature = world.creatures[id];
      if (!creature || !creature.alive) continue;

      const key = `${viewerId}|creature:${id}`;
      const lit =
        canSee(world.grid, viewer.pos, lantern, creature.pos) ||
        (canSee(world.grid, fire.pos, fire.lightRadiusM, creature.pos) &&
          canSee(world.grid, viewer.pos, LIT_FIGURE_VISIBLE_M, creature.pos));

      if (lit) {
        this.lastSeenAt.set(key, nowMs);
        out.push(viewOf(creature));
        continue;
      }

      // Hysteresis, same as players: a creature crossing the edge of your light
      // should not strobe. It only ever extends something you already saw.
      const last = this.lastSeenAt.get(key);
      if (last !== undefined && nowMs - last < VISIBILITY_HYSTERESIS_MS) {
        out.push(viewOf(creature));
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
