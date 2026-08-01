import { TICK_MS } from '@ember/shared';
import { InputSource } from './input.js';
import { NetClient } from './net.js';
import { Stage } from './render/stage.js';

const params = new URLSearchParams(location.search);

/** Simulated round-trip latency, e.g. ?lag=200. Used to verify prediction. */
const simulatedLag = Number(params.get('lag') ?? 0);

/** Server URL — defaults to the dev server on this host. */
const serverUrl = params.get('server') ?? `ws://${location.hostname}:8787`;

const playerName = params.get('name') ?? `player-${Math.floor(Math.random() * 900 + 100)}`;

async function main(): Promise<void> {
  const mount = document.getElementById('app');
  const hud = document.getElementById('hud');
  if (!mount || !hud) throw new Error('missing #app or #hud');

  const stage = new Stage();
  await stage.init(mount);

  const input = new InputSource();
  const net = new NetClient(serverUrl, playerName, simulatedLag);
  net.connect();

  let boundsDrawn = false;
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

    if (!boundsDrawn && net.playerId) {
      stage.drawBounds(net.bounds.w, net.bounds.h);
      boundsDrawn = true;
    }

    const players = net.renderedPlayers(now);
    const me = players.find((p) => p.isLocal) ?? null;
    stage.render(players, me);

    hud.textContent = formatHud(net.getStats());
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

function formatHud(s: ReturnType<NetClient['getStats']>): string {
  return [
    `${s.connected ? 'connected' : 'DISCONNECTED'}  ${s.playerId}  peers ${s.peers}`,
    `tick ${s.serverTick}  ack ${s.ack}  pending ${s.pending}`,
    `rtt ${s.rttMs.toFixed(0)}ms  simulated lag ${s.simulatedLagMs}ms`,
    `corrections ${s.corrections}  last ${s.lastCorrectionM.toFixed(3)}m`,
  ].join('\n');
}

void main();
