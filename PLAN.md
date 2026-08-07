# EMBER — Build plan, Steps 6–13

`DESIGN.md` is the specification: what the game is, and what each step must contain. This document
is the **plan against the code as it actually exists** — where the seams are today, what each
remaining step has to touch, what is missing that no step owns, and what could go wrong. It does not
restate DESIGN.md's decisions and it does not change any of them. Where it disagrees with
`DESIGN.md`, `DESIGN.md` wins and this file is the bug.

Companion document: `EXECUTION.md` — the runbook for actually driving these steps.

---

## 1. Where the code stands

Verified against the working tree at the time of writing, not inferred from commit messages.

| | |
|---|---|
| Steps complete | 1–5 (plus an unnumbered **Step 4A**, the real lighting pipeline) |
| Source | ~8,200 lines TypeScript across 3 workspaces |
| Tests | 159 passing in 12 files; `tsc --build` clean |
| Protocol | version **4** |
| Map | `tube` (1200 × 250 m) is the real map; `sandbox` (60 × 40 m) is retained for fast tests |

**The tick order** (`packages/shared/src/sim/index.ts`) has all 15 stages documented and 7 of them
implemented: 1 applyInputs · 2 weight · 3 movement · 5 lantern · 6 fire · 7 chopping · 8 items ·
14 winLose (embers case only). Stages 4, 9, 10, 11, 12, 13 and 15 are empty and are exactly what
Steps 6–10 fill in. No stage has ever been reordered and none may be.

**What already exists that later steps depend on:**

- `los.ts` — `raycastLOS()` and `canSee(grid, origin, radius, target)`. Creature light-sensing in
  Step 6 is a `canSee` call, not new geometry work.
- `server/visibility.ts` — `VisibilityIndex.visibleTo()` with 300 ms hysteresis, plus
  `fireViewFor()`. Every new entity type must be added here, and that is the single highest-risk
  recurring edit in the whole remaining build (§5.1).
- `client/net.ts` — prediction replays `step()` on a local `WorldState`; inventory and fire are
  explicitly **not** predicted, they snap to authority. This precedent decides how creatures are
  handled (§5.2).
- `client/render/phantoms.ts` + `silhouette.ts` — the client-only phantom system, and the silhouette
  draw path that real creatures must reuse verbatim (Q52).
- `client/render/memory.boundary.test.ts` — a structural import test that fails the build if the
  collision/memory boundary is ever crossed. **This is the working prototype of the Step 10 fairness
  harness**; copy its shape rather than inventing a new one.

**Placeholders already in place, waiting for their step:**

| Placeholder | Where | Consumed by |
|---|---|---|
| `Player.noiseMul` (written, read by nobody) | `sim/weight.ts` | Step 6, stage 4 |
| `Fire.safeRadiusM` (computed, read by nobody) | `sim/fire.ts` | Step 6 (Q7) |
| `SOUND_RADIUS_M` (still/creep/walk/sprint/chop/gunshot) | `constants.ts` | Steps 6–7 |
| `MASS_KG` entries for items that do not spawn yet | `constants.ts` | Steps 7–9, 12 |
| `Outcome` union with a single member `'embersDied'` | `types.ts` | Steps 8 and 12 |
| `ItemKind = 'branch' \| 'log'` | `types.ts` | Steps 7, 9, 12 |

That list is good news: the hard integration decisions were made early. Most of Steps 6–9 is filling
in slots that already exist rather than opening new seams.

---

## 2. Gaps that no numbered step owns

These are the reason this plan exists. Each one is real, none of them is a DESIGN.md change, and
every one of them will otherwise be discovered mid-step by an agent that then has to improvise.

### 2.1 Audio does not exist yet, and Step 6's gate requires it

`DESIGN.md` §21 never gives audio a step, but Q129 makes it the highest-priority system, Step 6's
gate is *"hear the difference"*, and Step 7 is an audio system with a visual garnish. Nothing under
`client/src/audio/` exists.

**Plan:** treat positional audio as **Step 6, part 0** — a `client/audio/positional.ts` built on Web
Audio `PannerNode`, driven by whatever server-side sound events Step 6 already has to introduce.
It does not need good sound design at Step 6; it needs correct direction and distance. Step 7 then
adds `listen.ts` on top rather than building the whole audio stack under time pressure during the
duel.

### 2.2 Voice has no step either

Q123 (proximity voice, no global channel) and Q79 (the dead keep voice) are load-bearing for
**Step 8's gate** — "the ghost is actively useful on comms" cannot be judged without comms.

**Plan:** WebRTC mesh + server-gated volume slots in as **Step 8, part 0**. It is the first gate that
cannot be evaluated without it. Building it earlier is wasted effort; building it later means Step 8
ships un-gated.

### 2.3 No ESLint, no CI

Step 10.2 requires a `no-restricted-imports` rule and 10.3 requires a **CI-blocking** fairness test.
There is no ESLint config and no `.github/` directory at all.

**Plan:** add ESLint (flat config, `typescript-eslint`) and a GitHub Actions workflow running
`typecheck` + `test` + `lint` as **Step 10, part 0**, before `perception.ts` is written. Doing it
first is what makes the boundary enforceable rather than aspirational. Note that the *test* half of
the boundary can be written without ESLint at all — `memory.boundary.test.ts` proves it — so the
fairness test is not blocked on tooling if CI turns into a rabbit hole.

### 2.4 No headless economy harness

§19 and §21.1 both require 100 unattended runs with a median death at minute 25–35. `economy.test.ts`
exists but is a unit test, not a harness.

**Plan:** build it at **Step 6**, once a scripted director exists to make an unattended run
meaningful, and re-run it at every step after. Its output is the only objective evidence at Step 13,
and a harness written at Step 13 measures a game nobody can still change cheaply.

### 2.5 The predecessor project is still unreconciled

`CLAUDE.md` and `README.md` both flag the `Cinders game` docs (`ARC.md`, `DESIGN.md`) as
outstanding, and §22.5 says to reconcile "before Step 2". Step 5 is now done and it has not happened.
The known collision area is the **ghost/revival system**, which is Step 8.

**Plan:** the deadline is now **before Step 8**, and that is a hard one. If the docs cannot be found
by then, record that decision explicitly in this file and proceed — an indefinite block on a document
nobody can locate is worse than a documented divergence.

### 2.6 `README.md` says "Step 1 of 13 complete"

Stale by four steps. Fold the correction into the next step's commit.

---

## 3. The steps

Each entry gives the integration points against real files, the new surface area, the load-bearing
rule in play, and the risk that step actually carries. Goals and Done-when gates are in `DESIGN.md`
§21 and are not duplicated here.

### Step 6 — Creatures, scripted

The largest remaining step by a wide margin: it fills three tick stages, opens the sound system,
introduces the first server-authoritative non-player entity, and is the first step whose gate is
about fear rather than function.

- **New:** `shared/sim/sound.ts` (stage 4), `shared/sim/creatures.ts` (stages 9 and 10),
  `server/director/fallback.ts`, `client/audio/positional.ts` (§2.1).
- **Touches:** `sim/index.ts` (fill stages 4, 9, 10 — never reorder), `types.ts` (`Creature`,
  `SoundEvent`, creature roster on `WorldState`), `protocol.ts` (**bump to 5** — creatures and
  sounds in the snapshot), `server/visibility.ts` (creatures culled exactly like players),
  `client/render/stage.ts` (draw creatures through `silhouette.ts`).
- **Reads placeholders:** `noiseMul` (stage 2 → stage 4), `safeRadiusM` (Q7 perimeter),
  `SOUND_RADIUS_M`.
- **Rule in play:** #1 — creature positions are culled per-player from the first snapshot that
  contains them. A creature stalking you in the dark must not be on the wire.
- **Sequencing inside the step:** sound before senses before states before sabotage. The state
  machine is a priority switch over a blackboard, not a BT library — the blackboard field is also
  where Step 10's orders will land, so its shape matters more than the switch's.
- **Risks:**
  - *Prediction.* Creatures must be authoritative-only, interpolated like remote players, never
    predicted. If `step()` runs creature AI on the client's predicted world it will both diverge and
    leak. Decision recorded in §5.2.
  - *Phantom collision.* Q52 requires real creatures to render identically to phantoms in stale
    memory. Reuse `silhouette.ts` unchanged; do not give creatures their own draw path "for now".
  - *The gate is subjective and comes before the LLM on purpose.* Budget real tuning time here. If
    the creatures are not frightening on a script, Step 10 cannot rescue them.

### Step 7 — The duel

- **New:** `shared/sim/combat.ts` (stage 11), `client/audio/listen.ts`, blip generation server-side.
- **Touches:** `protocol.ts` (**bump to 6** — `AudioBlip { angle, confidence }`, muzzle flash
  events), `types.ts` (gun state, desperation stage), `InputFrame` (**`listen` held, `aim` held,
  `fire` edge** — note the existing edge-vs-held reasoning in `types.ts`: a held flag that should be
  an edge will re-fire on every replayed tick during reconciliation), `render/lighting.ts` (muzzle
  flash as a **real light source**, not a special case).
- **Rule in play:** #5 — blips are computed server-side and sent as `{angle, confidence}` only. The
  client must not know creature positions; that is the same rule as #1 and this is where it is most
  tempting to break.
- **Risks:** the ±12°→±3° tightening needs a server-side per-player listen timer, which is new state
  that must survive reconnection. Friendly fire (Q76) plus blips means a two-player test can end in
  an accidental murder — that is working as designed and should not be "fixed".

### Step 8 — Death & ghosts

- **New:** `shared/sim/ghosts.ts` (stage 12), corpse items, sacrifice ritual, `client/voice.ts` +
  server volume gating (§2.2).
- **Touches:** `Outcome` (**add `'allGhosts'`** — Q135's second failure state), `types.ts` (ghost
  flag, corpse as a carryable with two-player carry), `server/visibility.ts` (**ghosts see truly at
  12 m, ignoring lighting and memory rot entirely** — a genuinely different culling path, the first
  time `visibleTo` needs per-viewer *modes*), `client/render/memory.ts` (ghost render path bypasses
  rot; revival wipes memory per Q54).
- **Rule in play:** #1 again, in its most awkward form. A ghost's culling rule is *different*, not
  *absent*. Resist "ghosts get everything" — it re-opens the devtools hole for any player who dies.
- **Blocked on:** §2.5, the predecessor reconciliation. This is the step it collides with.
- **Risks:** the two-player corpse carry (Q33) is the first mechanic requiring two players to
  cooperate on one object; it needs its own integration test, not just a playtest.

### Step 9 — Crafting & scrap

The lowest-risk remaining step, and the one most likely to be *sloppy* rather than *wrong*.

- **New:** `shared/sim/crafting.ts` (stage 13), three stations, scrap item kinds, creature-part items.
- **Touches:** `constants.ts` (**18 recipes as a data table**, per CLAUDE.md — a recipe expressed as
  code is a bug in this project), `ItemKind` union grows substantially, map generation gains scrap
  placement weighted to the Ruins.
- **Risks:** `ItemKind` is a `Record`-keyed union used by `Carrying`, `emptyCarrying()` and
  `carriedMassKg()`. Growing it from 2 to ~15 members touches serialisation size on every snapshot —
  check the snapshot payload does not balloon, since `Carrying` is sent whole whenever the woodpile
  is visible.

### Step 10 — The LLM director *(irreversible)*

The most consequential step and the one with the most explicit build order in `DESIGN.md`. Follow
§21 Step 10's numbering exactly: **perception → context → fairness test → schema → llm → fallback →
intent log**. The API call is fifth of seven for a reason.

- **New:** `server/director/{perception,context,schema,llm}.ts` (`fallback.ts` already exists from
  Step 6 and **stays forever**), ESLint + CI (§2.3), the fairness test.
- **Rule in play:** #2 and #6, both absolute. `context.ts` may import `perception.ts` and must never
  import `types.ts` or touch `WorldState`, enforced by ESLint **and** a CI-blocking test. The game
  must play correctly with `ANTHROPIC_API_KEY` removed entirely — verify by actually removing it,
  not by reading the fallback code.
- **Model:** `claude-sonnet-5`, one call per 12 s, fully async, never blocking the tick. Escalate to
  `claude-opus-5` only on the Q93 endgame trigger.
- **Risks:**
  - *The named trap.* Do not add player positions to the context to make the model smarter. It is
    undetectable by playtesting, which is why the test is CI-blocking.
  - *Async discipline.* A 20 Hz tick and a multi-second API call means orders land on a blackboard
    and are consumed by stage 10 whenever they arrive. Any `await` on the tick path is a bug.
  - *Determinism.* The director's output must not enter the shared `step()` in a way the client
    replays — orders are server-side state that reaches the client only through creature behaviour.

### Step 11 — The car

- **New:** vehicle entity, five parts, fuel, wreck/repair.
- **Touches:** movement (a driven entity carrying players is a new movement mode), visibility (the
  25 m headlight cone is a light source, so it both reveals and is revealed), map generation (Ruins
  placement, Q98).
- **Risks:** the trunk is 200 kg — an order of magnitude past `CARRY_CAPACITY_KG`. Confirm the weight
  system's speed curve does not produce nonsense when a container, rather than a player, holds mass.

### Step 12 — Amulet & endgame

- **New:** amulet item, the lair, the wake-the-lair event, the win condition in stage 14.
- **Touches:** `Outcome` (**add `'won'`**), lantern (Q94 — while carrying the amulet the lantern
  *cannot be lit at all*; this is a hard block in `sim/lantern.ts`, not a fuel penalty), the director
  (explicit endgame signal, Opus escalation).
- **Why it is late and should stay late:** its gate is that memory rot, weight, sound stealth and the
  horizon bloom all work *simultaneously*. It is the integration exam for Steps 2–9 and it is only
  meaningful once they have all been tuned.

### Step 13 — Tuning

- Three levers only (Q131): fire burn escalation, resource depletion, LLM aggression. Everything else
  is off the table — resist the temptation to fix a pacing problem by touching a fourth number.
- Also lands here: the tutorial (Q132) and the run summary with the enemy diary (Q134/Q116).
- **Evidence:** the §2.4 harness, 100 runs, median death minute 25–35. If it was built at Step 6 as
  planned, this step reads its output. If it was not, this step also has to build it.

---

## 4. Critical path and ordering

```
Step 6  ──> Step 7  ──> Step 8  ──> Step 9  ──> Step 10 ──> Step 11 ──> Step 12 ──> Step 13
  │           │           │                       ▲
  │           │           │                       │
  ├ audio     ├ listen    ├ voice        ESLint + CI + fairness test
  │  (§2.1)   │           │  (§2.2)      (§2.3, before perception.ts)
  │           │           │
  └ harness   └           └ predecessor reconciliation deadline (§2.5)
     (§2.4)
```

Nothing in Steps 6–13 can be safely reordered:

- **6 before 7** — the duel needs creatures with senses and sound.
- **7 before 8** — death is only interesting once something can kill you deliberately.
- **9 before 10** — the director's world should contain the objects it will talk about.
- **10 before 12** — the endgame escalates the director; there must be one to escalate.
- **13 last** — tuning a system still under construction is wasted work.

The one genuinely movable piece is **Step 9**, which has no hard dependency on Step 8. If Step 8 is
blocked on §2.5, do Step 9 first rather than idling. That is the only permitted reorder in this plan.

---

## 5. Cross-cutting decisions

These recur in every step and are worth deciding once, here, rather than five times inconsistently.

### 5.1 Every new entity type extends the culling index

`server/visibility.ts` is the anti-cheat spine. Steps 6, 8, 9, 11 and 12 each introduce entities
(creatures, ghosts and corpses, scrap and stations, the car, the amulet) and **every one of them
needs a culling rule written in the same commit that introduces it**. The failure mode is not a
crash; it is a snapshot that quietly contains something the player cannot see, discovered months
later by someone reading the socket.

Rule of thumb per entity: *what light would have to touch this for a player to know it is there?*
Static geometry is exempt (the map is sent as a seed, deliberately). Everything that moves, or that
can be moved, is not.

### 5.2 Prediction policy — decided

The existing code predicts **local movement only**; inventory and fire snap to authority. Extend that
rule rather than relitigating it per step:

| Predicted client-side | Authoritative, never predicted |
|---|---|
| Local player movement | Creatures (all behaviour) |
| Local lantern shutter state | Combat resolution and hits |
| — | Item pickup/drop, crafting, fire |
| — | Blips, ghosts, the car's motion |

Everything in the right column arrives by snapshot and is interpolated. This keeps `step()` identical
on both sides while ensuring the client never has enough information to predict what it must not
know.

### 5.3 Protocol versioning

`PROTOCOL_VERSION` is 4. Bump it in any step that changes a message shape — Steps 6, 7, 8, 9, 11 and
12 all will. A mismatched client gets `reject`, which is far better than a client silently
misreading a snapshot.

### 5.4 Constants and data tables

Every tunable goes in `constants.ts` with its Q-number. Recipes (Step 9), creature senses and speeds
(Step 6), desperation stages (Step 7) and car parts (Step 11) are **data tables**, not code. This is
already the house style; the file is 643 lines and organised by section, so keep adding sections
rather than scattering values.

### 5.5 Testing posture

The game cannot be validated by unit tests, but three specific things must be:

1. **Structural boundary tests** — `memory.boundary.test.ts` today, the fairness harness at Step 10.
   These guard silent failures that playtesting cannot detect. They are the most valuable tests here.
2. **Determinism** — client and server must produce identical results from `step()`. Any new sim
   stage needs a test that it is pure and free of `Math.random`, `Date.now`, and iteration-order
   dependence.
3. **Integration** — `server.integration.test.ts` runs two real clients. Extend it whenever a step
   adds a multiplayer interaction (Step 8's two-player corpse carry especially).

Everything else is a playtest, which is what the gates are.

---

## 6. Risk register

| Risk | Step | Cost if it lands | Mitigation |
|---|---|---|---|
| Creature positions leak into snapshots | 6 | Fatal to the whole game; undetectable in play | Extend `VisibilityIndex` in the same commit; read the socket at the gate |
| Player positions enter the LLM context | 10 | The enemy is omniscient, not intelligent; invisible in playtesting | Fairness test **written before** `llm.ts`, CI-blocking |
| Audio deferred to Step 7 | 6 | Step 6's gate cannot be judged; the duel is built on an untested stack | Positional audio as Step 6 part 0 |
| Predecessor collision found at Step 8 | 8 | Ghost/revival rework after it is load-bearing | Reconcile before Step 8, or record the divergence |
| Creatures predicted client-side | 6 | Rubber-banding plus an information leak | §5.2, decided |
| Blocking the tick on the API call | 10 | 20 Hz sim stalls for seconds | Orders on a blackboard, consumed by stage 10 |
| Scripted director quietly rots | 10–13 | The API-key-removed gate fails late | Run one playtest per step with the key unset |
| Tuning without evidence | 13 | Endless subjective retuning | Harness at Step 6, re-run every step |
| `ItemKind` growth bloats snapshots | 9 | Bandwidth and GC pressure at 20 Hz | Measure the snapshot before and after |

---

## 7. Open decisions

Things that genuinely need a human call, with the step where they stop being deferrable.

1. **Repository name** (§22.2 aside) — `intel` vs `ember`. Free now, progressively annoying later.
   *Deadline: whenever, but it only gets worse.*
2. **The `Cinders game` docs** — findable or not? *Deadline: before Step 8.*
3. **Voice transport** — WebRTC mesh is specified for 2–4 players. Confirm the player count ceiling
   is still 4, since a mesh stops being the right answer above that. *Deadline: Step 8.*
4. **Where the run summary lives** (Q134) — in-client screen, or a written artefact after the run?
   Affects whether the intent log needs persistence beyond the process. *Deadline: Step 10, when the
   intent log starts being written.*
5. **Reconnect window** (Q125, 3 minutes, character stands inert) — not implemented and no step owns
   it. It interacts with Step 7's listen timer and Step 8's ghost state. *Deadline: Step 8.*

---

## 8. What "done" looks like

Step 13 completes when the §21.1 verification list passes in full: per-step gates all green, 100
headless runs with a median death at minute 25–35, the fairness harness green in CI, sane creature
behaviour with the LLM stubbed at 3 s, 10 s and hard failure, a clean websocket log with nothing
off-screen in it, and a stranger who works out the shutter within five minutes without being told.

The last one is the real test. The other eight are how you earn the right to run it.
