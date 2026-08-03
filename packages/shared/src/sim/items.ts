import {
  LANTERN_PICKUP_RANGE_M,
  LANTERN_REFUEL_HOLD_SEC,
  LANTERN_REFUEL_PER_LOG,
  LANTERN_REFUEL_RATE,
  CHOP_SWINGS,
  DEPOSIT_RANGE_M,
  DEPOSIT_SEC_PER_ITEM,
  FIRE_CAPACITY,
  FIRE_EMBER_GRACE_SEC,
  FIRE_STOKE_RANGE_M,
  FIRE_STOKE_SEC,
  FUEL_VALUE,
  PANIC_DROP_SCATTER_M,
  PICKUP_RANGE_M,
  TILE_M,
} from '../constants.js';
import type { MapDef } from '../grid.js';
import { distance } from '../math.js';
import type { Vec2 } from '../math.js';
import { ITEM_KINDS, carriedCount, emptyLantern } from '../types.js';
import type {
  Carrying,
  DroppedLantern,
  ItemKind,
  Player,
  TickInputs,
  WorldItem,
  WorldState,
} from '../types.js';
import { refreshFire } from './fire.js';

/**
 * Items, the woodpile, and feeding the fire (§3, §5) — tick stage 8.
 *
 * `E` is context sensitive (Q126), resolving in a fixed order: stoke, then
 * deposit, then pick up. Chopping is stage 7 and takes it before any of these.
 *
 * At most one of them is normally in range anyway — the fire, the woodpile and
 * any trunk sit far enough apart that their ranges do not overlap. The order
 * is fixed rather than nearest-wins so that on the rare occasion it does have
 * to arbitrate, it arbitrates the same way every time.
 */

/**
 * Seed a world with the trees and deadfall its map defines.
 *
 * Called once when the run starts. Neither is ever replenished (Q18/Q19):
 * permanent depletion is the engine that strips the near wood in about fifteen
 * minutes and forces you further down the tube for the next load.
 */
export function populateFromMap(world: WorldState, map: MapDef): void {
  for (const t of map.trees) {
    const id = `t${t.x},${t.y}`;
    world.trees[id] = {
      id,
      tx: t.x,
      ty: t.y,
      // Centre of the tile, so range checks are symmetric around the trunk.
      pos: { x: t.x + TILE_M / 2, y: t.y + TILE_M / 2 },
      swingsLeft: CHOP_SWINGS,
      felled: false,
    };
  }

  for (const d of map.deadfall) spawnItem(world, 'branch', d);
}

/** Put a new item on the ground. Ids come from the world so replay is stable. */
export function spawnItem(world: WorldState, kind: ItemKind, pos: Vec2): WorldItem {
  const id = `i${world.nextItemId++}`;
  const item: WorldItem = { id, kind, pos: { ...pos } };
  world.items[id] = item;
  return item;
}

/** The nearest item within reach, if any. */
export function itemInRange(world: WorldState, pos: Vec2): WorldItem | null {
  let best: WorldItem | null = null;
  let bestDist = Infinity;

  for (const id of Object.keys(world.items)) {
    const item = world.items[id];
    if (!item) continue;

    const d = distance(pos, item.pos);
    if (d <= PICKUP_RANGE_M && d < bestDist) {
      best = item;
      bestDist = d;
    }
  }

  return best;
}

/**
 * The heaviest fuel in a load that still fits in the fire.
 *
 * Logs before branches, so the good wood goes on while there is room for it
 * and the branches are what you are left topping up with — which is the
 * shape the fuel values (Q10) imply.
 */
function bestFuel(available: Carrying, fuel: number): ItemKind | null {
  for (const kind of ITEM_KINDS) {
    if (available[kind] <= 0) continue;
    if (fuel + FUEL_VALUE[kind] <= FIRE_CAPACITY) return kind;
  }
  return null;
}

/**
 * Tick stage 8 — items.
 *
 * Pickup, drop, panic drop, the woodpile, and stoking. Runs after the fire has
 * burned (stage 6) and before the run is judged (stage 14), so a log thrown on
 * at the last possible tick still saves the run.
 */
export function items(world: WorldState, inputs: TickInputs, dt: number): void {
  for (const id of Object.keys(world.players)) {
    const player = world.players[id];
    if (!player) continue;

    const frame = inputs[id];

    // Panic drop (Q35): one key, everything, instantly, no channel and no
    // confirmation. Non-negotiable given the chase design — it has to be
    // usable while something is already on top of you.
    if (frame?.panicDrop === true && carriedCount(player.carrying) > 0) {
      panicDrop(world, player.pos, player.carrying);
      player.stokeProgress = 0;
      player.depositProgress = 0;
    }

    // Q41: deliberate, edge-triggered, and not a channel.
    if (frame?.dropLantern === true) toggleLantern(world, player);

    // Q39: refuelling is its own key and runs anywhere, so it is resolved
    // before the interact chain rather than competing with it.
    refuelLantern(world, player, frame?.refuel === true, dt);

    // Interact and refuel are different keys, so `E` no longer owns the refuel
    // channel — refuelLantern above is the only thing that touches its state.
    const holding = frame?.interact === true;
    if (!holding) {
      player.stokeProgress = 0;
      player.depositProgress = 0;
      continue;
    }

    if (tryStoke(world, player.id, dt)) continue;
    if (tryDeposit(world, player.id, dt)) continue;
    if (tryTakeLantern(world, player.id)) continue;
    tryPickup(world, player.id);
  }
}

/**
 * Q41: put the lantern down, or pick one back up.
 *
 * Edge-triggered and outside the interact chain, because it is not a channel —
 * you should be able to set a decoy and be moving in the same tick.
 */
function toggleLantern(world: WorldState, player: Player): void {
  if (player.hasLantern) {
    const id = `dl${world.nextItemId++}`;
    world.droppedLanterns[id] = {
      id,
      pos: { x: player.pos.x, y: player.pos.y },
      // The lantern goes down exactly as it was: same stage, same fuel. A decoy
      // is only worth setting if it keeps throwing the light you were using.
      lantern: structuredClone(player.lantern),
    };
    player.lantern = emptyLantern();
    player.hasLantern = false;
    player.refuelProgress = 0;
    return;
  }

  const nearest = nearestDroppedLantern(world, player.pos);
  if (!nearest) return;
  player.lantern = structuredClone(nearest.lantern);
  player.hasLantern = true;
  delete world.droppedLanterns[nearest.id];
}

/** The closest dropped lantern within arm's reach, or null. */
export function nearestDroppedLantern(world: WorldState, pos: Vec2): DroppedLantern | null {
  let best: DroppedLantern | null = null;
  let bestDist = LANTERN_PICKUP_RANGE_M;

  for (const id of Object.keys(world.droppedLanterns)) {
    const dl = world.droppedLanterns[id];
    if (!dl) continue;
    const d = distance(dl.pos, pos);
    if (d > bestDist) continue;
    best = dl;
    bestDist = d;
  }

  return best;
}

/** Picking one up is an interact, so it does not fight with the `G` toggle. */
function tryTakeLantern(world: WorldState, playerId: string): boolean {
  const player = world.players[playerId];
  if (!player || player.hasLantern) return false;
  if (!nearestDroppedLantern(world, player.pos)) return false;
  toggleLantern(world, player);
  return true;
}

/**
 * Q39: hold `F` and wood goes in, anywhere.
 *
 * Continuous rather than a discrete channel per log. Holding a key and watching
 * a level climb is a different feel from committing to a 1.5s animation, and it
 * is the one that makes "how much light do I want to buy right now" a decision
 * you make with your thumb. Q39's numbers still set the rate.
 *
 * There is no ceiling. Overfill it if you like — every unit you pour in is one
 * the bonfire does not get (L6), and that trade is the whole point.
 */
function refuelLantern(
  world: WorldState,
  player: Player,
  holding: boolean,
  dt: number,
): void {
  if (!holding || !player.hasLantern) {
    player.refuelProgress = 0;
    return;
  }

  // The wind-up. Long enough that cycling the shutter never costs you a log.
  player.refuelProgress += dt;
  if (player.refuelProgress < LANTERN_REFUEL_HOLD_SEC) return;

  let toPour = LANTERN_REFUEL_RATE * dt;

  while (toPour > 0) {
    // A log leaves your hands when it starts going in, and its units flow over
    // the next second and a half. Letting go keeps the remainder on you, so an
    // interrupted refuel costs the time and not the wood.
    if (player.refuelPartial <= 0) {
      if (player.carrying.log <= 0) return;
      player.carrying.log--;
      player.refuelPartial = LANTERN_REFUEL_PER_LOG;
    }

    const take = Math.min(toPour, player.refuelPartial);
    player.lantern.fuel += take;
    player.refuelPartial -= take;
    toPour -= take;
  }
}

/** @returns true if the fire consumed this player's interact for the tick. */
function tryStoke(world: WorldState, playerId: string, dt: number): boolean {
  const player = world.players[playerId];
  const f = world.fire;
  if (!player) return false;

  if (f.dead || distance(player.pos, f.pos) > FIRE_STOKE_RANGE_M) {
    player.stokeProgress = 0;
    return false;
  }

  // Either from hand or from the pile (Q23) — hand first, so that what you
  // hauled back goes on before the reserve does.
  const fromHand = bestFuel(player.carrying, f.fuel);
  const fromPile =
    fromHand === null && distance(f.pos, world.woodpile.pos) <= FIRE_STOKE_RANGE_M + DEPOSIT_RANGE_M
      ? bestFuel(world.woodpile.contents, f.fuel)
      : null;

  const kind = fromHand ?? fromPile;
  if (kind === null) {
    // Nothing that fits. The fire is full, or you have nothing to burn.
    player.stokeProgress = 0;
    return false;
  }

  player.stokeProgress += dt;
  if (player.stokeProgress < FIRE_STOKE_SEC) return true;

  player.stokeProgress = 0;
  if (fromHand !== null) player.carrying[kind] -= 1;
  else world.woodpile.contents[kind] -= 1;

  f.fuel = Math.min(FIRE_CAPACITY, f.fuel + FUEL_VALUE[kind]);
  if (f.fuel > 0) f.emberSecLeft = FIRE_EMBER_GRACE_SEC;
  refreshFire(f);

  return true;
}

/** @returns true if the woodpile consumed this player's interact for the tick. */
function tryDeposit(world: WorldState, playerId: string, dt: number): boolean {
  const player = world.players[playerId];
  if (!player) return false;

  const pile = world.woodpile;
  if (distance(player.pos, pile.pos) > DEPOSIT_RANGE_M) {
    player.depositProgress = 0;
    return false;
  }

  // Heaviest first, so the thing slowing you down is the thing that leaves.
  const kind = ITEM_KINDS.find((k) => player.carrying[k] > 0);
  if (kind === undefined) {
    player.depositProgress = 0;
    return false;
  }

  player.depositProgress += dt;
  if (player.depositProgress < DEPOSIT_SEC_PER_ITEM) return true;

  player.depositProgress = 0;
  player.carrying[kind] -= 1;
  // Unlimited capacity (Q22) — the pile is never the constraint, your back is.
  pile.contents[kind] += 1;

  return true;
}

function tryPickup(world: WorldState, playerId: string): void {
  const player = world.players[playerId];
  if (!player) return;

  const item = itemInRange(world, player.pos);
  if (!item) return;

  // Instant, no tool, no channel (Q15). Over-capacity is not blocked here:
  // Q34 has no slots and no refusal, and the speed curve already makes going
  // over the limit its own punishment (Q31).
  player.carrying[item.kind] += 1;
  delete world.items[item.id];
}

/** Dump a whole load on the ground in a small ring (Q35). */
export function panicDrop(world: WorldState, pos: Vec2, carrying: Carrying): void {
  let dropped = 0;
  const total = carriedCount(carrying);

  for (const kind of ITEM_KINDS) {
    const count = carrying[kind];
    for (let i = 0; i < count; i++) {
      const angle = (dropped / Math.max(1, total)) * Math.PI * 2;
      spawnItem(world, kind, {
        x: pos.x + Math.cos(angle) * PANIC_DROP_SCATTER_M,
        y: pos.y + Math.sin(angle) * PANIC_DROP_SCATTER_M,
      });
      dropped++;
    }
    carrying[kind] = 0;
  }
}
