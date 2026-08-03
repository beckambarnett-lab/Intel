# EMBER — agent orientation

**Read `DESIGN.md` in full before writing any code.** It is the complete specification: 20 locked
design decisions, 136 numbered resolved questions, and a 13-step implementation spec with the
technology stack settled and per-step acceptance gates. It was produced in a long design interrogation
and every number in it is deliberate. Do not re-derive, re-litigate, or "improve" its decisions
without asking — if something looks wrong, raise it, don't silently change it.

**Then read `DECISIONS.md`, and read it second on purpose.** It is short, and it records the handful
of places where playtesting overturned a locked decision — creature senses, the launch, the fuel
caps. Where the two disagree, `DECISIONS.md` wins and says why. Several of its entries replaced a
first attempt that was wrong in an instructive way; the wrong version is usually the obvious one, so
building straight from `DESIGN.md` will re-derive it.

## What this is

A multiplayer top-down survival horror game played in the dark. A bonfire eats wood and wood is the
only clock. Light is the only way you see and the only way the creatures see you. The creatures are
commanded by a live LLM. You win by carrying the amulet of darkness back to your fire.

## Status

**Steps 1–6 are built and playable.** Next: remove the bonfire's fuel cap (`DECISIONS.md` §6 — it is
not a tweak, and the open question there needs answering first), then `DESIGN.md` §21, Step 7.

## The rules that must not be broken

These hold up other systems. Breaking one is a design change, not a refactor.

1. **The server never sends a client anything it cannot see.** (§21 Step 2, Q122) Per-player
   visibility culling from the very first snapshot. Never "send everything and hide it client-side
   for now" — that decision never gets undone and makes the whole game cheatable from devtools.
2. **The LLM never receives raw player positions.** (§21 Step 10, Q114) `director/context.ts` may
   import `perception.ts` and must never import `types.ts` or touch `WorldState`. Enforced by an
   ESLint `no-restricted-imports` rule *and* a CI-blocking test. Do not "help" the model by giving
   it more information — that makes it omniscient, not intelligent, and playtesting cannot detect it.
3. **Collision reads the true occluder grid, never the memory texture.** (§21 Step 5, Q48) The
   rotting memory map lies about how the world *looks*, never about where things *are*.
4. **Client and server run the identical `step()` from `packages/shared`.** Never copy sim code
   across the boundary; prediction diverges silently if they drift.
5. **Listen-mode blips are computed server-side** and sent as `{angle, confidence}` only, never
   positions. (§21 Step 7, Q68)
6. **The scripted director ships permanently** as the LLM failure path. (§21 Step 6, Q117) The game
   must play correctly with the API key removed entirely.

## Build order

Steps are sequential and each is playable. Do not skip ahead. Steps 2, 5 and 10 are architecturally
irreversible if done late.

1. ~~Skeleton — monorepo, authoritative server, client prediction~~ *(done)*
2. ~~**Darkness** — shadowcasting, lantern, visibility culling~~ *(done, irreversible)*
3. ~~The clock — fire, fuel, tiers, ember grace, horizon bloom~~ *(done)*
4. ~~The loop — weight, chopping, logs, woodpile~~ *(done)*
5. ~~**Memory rot** — decay shader, distortion, phantoms~~ *(done, irreversible)*
6. ~~Creatures, scripted — senses, states, sabotage~~ *(done; senses reworked — `DECISIONS.md` §1–5)*
7. The duel — listen mode, blips, gun, desperation *(designed in `DECISIONS.md`)*
8. Death & ghosts — corpses, bonfire sacrifice
9. Crafting & scrap — 3 stations, 18 recipes
10. **LLM director** — fairness boundary first *(irreversible)*
11. The car
12. Amulet & endgame
13. Tuning

## Stack

TypeScript strict throughout · npm workspaces (`shared` / `server` / `client`) · Vite + tsx + tsc ·
PixiJS v8 (WebGL — Canvas2D cannot do the memory-rot shader) · `ws` with JSON · plain structs, no ECS ·
fixed 50ms deterministic sim · Web Audio `PannerNode` · WebRTC mesh voice · `@anthropic-ai/sdk` with
`claude-sonnet-5` · Vitest.

Full layout and the fixed 15-stage tick order are in `DESIGN.md` §21.0. The tick order never varies.

## Conventions

- Every tunable lives in `packages/shared/src/constants.ts` as a named export. Recipes and item
  masses are **data tables**, not code — they will be retuned constantly.
- The sim is pure functions over a draft; `structuredClone` for network snapshots.
- `ANTHROPIC_API_KEY` is server-side only and must never reach a client bundle.

## Unresolved

Two documents referenced by the original README were not available when `DESIGN.md` was written:
the predecessor **`Cinders game`** project (`ARC.md`, `DESIGN.md`), which records what was previously
tried and what broke, and an earlier plan file. The ghost/revival system in §10 is known to exist
there in some form. **If you have access to those, reconcile them against `DESIGN.md` before Step 1**
and flag any collisions.
