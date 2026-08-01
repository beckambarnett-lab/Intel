# EMBER

*(working title)*

A multiplayer strategy survival game played in the dark.

You have a fire. The fire eats wood, wood is the only clock, and when it runs out you lose.
Wood is out in the forest, and the forest is dark. You carry one lantern — light is the only
way you see, and the only way *they* see you. Every trip out is the same trade: go lit and be
tracked, or go dark and be blind.

The enemy is a small number of creatures commanded by a live LLM. They perceive light and
nothing else. They cannot touch a bright fire, so they don't attack the flame — they attack
your ability to feed it.

You win by finding the amulet of darkness, picking it up, and running it back to your fire.

---

## Status

**Step 1 of 13 complete** — skeleton, authoritative server, client prediction.

Full specification: [`DESIGN.md`](./DESIGN.md) — 20 locked decisions, 136 resolved questions, and a
13-step implementation spec with the stack settled and per-step acceptance gates.

Agent orientation: [`CLAUDE.md`](./CLAUDE.md) — read this first if you are picking the project up.

## Quickstart

Requires Node 22+. On Windows use **PowerShell 7** (`pwsh`) — Windows PowerShell 5.1 does not
support `&&` and will choke on chained commands.

```bash
npm install
npm run dev          # server on :8787, client on :5173
```

Open <http://localhost:5173> twice — one normal window, one private — to play two clients.

| Command | |
|---|---|
| `npm run dev` | Server and client together |
| `npm run dev:server` | Server only (`:8787`) |
| `npm run dev:client` | Client only (`:5173`) |
| `npm test` | Vitest, including a real two-client integration test |
| `npm run typecheck` | `tsc --build` across all three packages |

### URL parameters

| Parameter | Effect |
|---|---|
| `?lag=200` | Simulate 200ms round-trip latency. **Use this to verify prediction** — local movement must stay perfectly smooth |
| `?name=alice` | Set your display name |
| `?server=ws://host:8787` | Point at a different server |

## Layout

```
packages/
  shared/   Deterministic sim + protocol. Imported as SOURCE by both sides.
  server/   Authoritative 20Hz room. Owns all truth.
  client/   PixiJS renderer, prediction, reconciliation.
```

`packages/shared/src/sim/index.ts` holds the fixed 15-stage tick order. It never varies, and new
systems slot into a numbered stage rather than being appended wherever they fit.

All tunables live in `packages/shared/src/constants.ts`, cross-referenced to the Q-numbers in
`DESIGN.md`.

## Controls

`WASD` move · `Shift` sprint · `C` creep. The rest arrive with the systems that need them.

## Not yet reconciled

The predecessor `Cinders game` project (`ARC.md`, `DESIGN.md`) records what was tried before and
what broke. It was not available when `DESIGN.md` was written — reconcile it before Step 2.
