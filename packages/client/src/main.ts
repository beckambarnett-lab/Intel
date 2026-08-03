import {
  CARRY_CAPACITY_KG,
  CHOP_SWINGS,
  FIRE_STOKE_SEC,
  TICK_MS,
  lanternRadius,
  overstokeMultiplier,
} from '@ember/shared';
import type { LanternState } from '@ember/shared';
import { InputSource } from './input.js';
import { NetClient } from './net.js';
import type { NetStats } from './net.js';
import { Stage } from './render/stage.js';

const params = new URLSearchParams(location.search);

/** Simulated round-trip latency, e.g. ?lag=200. Used to verify prediction. */
const simulatedLag = Number(params.get('lag') ?? 0);

/** Server URL — defaults to the dev server on this host. */
const serverUrl = params.get('server') ?? `ws://${location.hostname}:8787`;

const playerName = params.get('name') ?? `player-${Math.floor(Math.random() * 900 + 100)}`;

/** ?netlog=1 — log every inbound snapshot. The Step 2 verification instrument. */
const netlog = params.get('netlog') === '1';

async function main(): Promise<void> {
  const mount = document.getElementById('app');
  const hud = document.getElementById('hud');
  if (!mount || !hud) throw new Error('missing #app or #hud');

  const stage = new Stage();
  await stage.init(mount);

  const input = new InputSource();
  const net = new NetClient(serverUrl, playerName, simulatedLag, netlog);
  net.connect();

  let mapDrawn = false;
  let accumulator = 0;
  let last = performance.now();

  const frame = (): void => {
    const now = performance.now();
    let elapsed = now - last;
    last = now;

    // A backgrounded tab returns a huge delta; do not try to replay it.
    if (elapsed > 250) elapsed = 250;
    accumulator += elapsed;

    // Fixed timestep. The sim only ever advances in whole ticks.
    while (accumulator >= TICK_MS) {
      net.tick((seq) => input.sample(seq));
      accumulator -= TICK_MS;
    }

    // Redrawn on first sight of the map, and again whenever a felled tree has
    // cleared a tile (Q20). The lighting mask needs no redraw — it reads the
    // grid every frame, so the sightline opens the moment the trunk goes.
    if (net.playerId && net.fire && (!mapDrawn || net.gridDirty)) {
      stage.drawMap(net.grid, net.bounds.w, net.bounds.h, net.fire.pos, net.woodpilePos);
      net.gridDirty = false;
      mapDrawn = true;
    }

    const players = net.renderedPlayers(now);
    const creatures = net.renderedCreatures(now);
    const me = players.find((p) => p.isLocal) ?? null;
    // Real elapsed time, not the fixed sim step: flicker and the bloom fade are
    // presentation and should run at display rate rather than at 20Hz.
    stage.render(
      net.grid,
      net.fire,
      players,
      creatures,
      net.droppedLanterns,
      net.visibleItems,
      me,
      elapsed / 1000,
    );

    hud.textContent = formatHud(net);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

function formatHud(net: NetClient): string {
  const s: NetStats = net.getStats();
  const lines = [
    `${s.connected ? 'connected' : 'DISCONNECTED'}  ${s.playerId}  visible peers ${s.peers}`,
    `tick ${s.serverTick}  ack ${s.ack}  pending ${s.pending}`,
    `rtt ${s.rttMs.toFixed(0)}ms  simulated lag ${s.simulatedLagMs}ms`,
    `corrections ${s.corrections}  last ${s.lastCorrectionM.toFixed(3)}m`,
  ];

  const lantern: LanternState | null = net.lantern;
  if (lantern) {
    const moving = lantern.transition > 0 ? ` -> ${lantern.target}` : '';
    const flare = lantern.bloom > 0 ? '  BLOOM' : '';
    if (net.me && !net.me.hasLantern) lines.push('lantern SET DOWN — G to pick it back up');
    lines.push(
      `lantern ${lantern.stage}${moving}  fuel ${lantern.fuel.toFixed(1)}  radius ${lanternRadius(lantern).toFixed(1)}m${flare}`,
    );
  }

  const fire = net.fire;
  if (fire) {
    // fuel is only sent while you are in the firelight (Q127) — when it is
    // absent, the tier is all you get, which is the intended experience.
    //
    // Shown as a bare number rather than a fraction: there is no capacity to be
    // a fraction of any more (DECISIONS §6). What replaces it is the burn rate,
    // which is the thing an over-stoked fire actually costs you — at 7500 fuel
    // that reads 25.0/s, one whole log a second.
    const fuel =
      fire.fuel !== undefined
        ? `${fire.fuel.toFixed(0)} (${overstokeMultiplier(fire.fuel).toFixed(1)}/s)`
        : '— (too far to read)';
    lines.push(`fire ${fire.tier}  fuel ${fuel}  light ${fire.lightRadiusM.toFixed(1)}m`);

    if (fire.emberSecLeft !== undefined && fire.fuel !== undefined && fire.fuel <= 0) {
      lines.push(`EMBERS — ${fire.emberSecLeft.toFixed(1)}s`);
    }
  }

  const me = net.me;
  if (me) {
    const pct = ((me.loadKg / CARRY_CAPACITY_KG) * 100).toFixed(0);
    lines.push(
      `carrying ${me.carrying.log} logs, ${me.carrying.branch} branches` +
        `  ${me.loadKg.toFixed(1)}/${CARRY_CAPACITY_KG}kg (${pct}%)  speed ${(me.speedMul * 100).toFixed(0)}%`,
    );

    if (me.chop) {
      const swings = `${me.chop.swings}/${CHOP_SWINGS}`;
      lines.push(`chopping ${swings} swings`);
    } else if (me.stokeProgress > 0) {
      lines.push(`stoking ${((me.stokeProgress / FIRE_STOKE_SEC) * 100).toFixed(0)}%`);
    } else if (me.depositProgress > 0) {
      lines.push('depositing');
    }
  }

  const pile = net.woodpileContents;
  if (pile) lines.push(`woodpile ${pile.log} logs, ${pile.branch} branches`);

  // Only creatures you can actually see appear here — the server sent nothing
  // else. An empty line does not mean an empty wood.
  const seen = net.renderedCreatures(performance.now());
  if (seen.length > 0) {
    lines.push(`creatures in sight: ${seen.map((c) => c.state).join(', ')}`);
  }

  if (me && !me.alive) lines.push('YOU ARE DEAD — ghosts arrive in Step 8');

  if (net.outcome === 'embersDied') lines.push('THE EMBERS DIED — run over');

  return lines.join('\n');
}

void main();
