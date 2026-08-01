# EMBER — Design Bible & Build Plan

## Context

The repo is a README and a `.gitignore`. The pitch is strong but underspecified: a fire that eats
wood, a lantern that trades sight for safety, creatures commanded by a live LLM, an amulet to win.
Building from that alone would mean inventing a hundred rules mid-implementation and getting them
wrong. This document closes every gap.

**Two referenced documents are not in this container** and were not available while writing this:
`C:\Users\becka\.claude\plans\i-want-to-make-rustling-puffin.md`, and the predecessor `Cinders game`
folder (`ARC.md`, `DESIGN.md`) which reportedly records *what was tried and what broke*. Everything
below was designed clean. Paste those in and I will reconcile — the ghost/revival system below is
already known to exist there in some form, so there are likely other collisions.

**How to read this.** Section 1 is locked — you answered those directly. Sections 2+ are numbered
questions I could not ask you without a 30-round interrogation, each with a **default** I have
committed to. Nothing is blank. Reply with just the numbers you want changed (e.g. "flip 14, 39,
88") and I will revise before writing code.

---

## 1. LOCKED — your direct answers

| # | Decision |
|---|---|
| L1 | **2D top-down**, true shadowcasting line-of-sight; trees and walls cast real shadows |
| L2 | **Real-time**, always; no pausing |
| L3 | **2–4 players, pure co-op** |
| L4 | **Browser + TypeScript client, authoritative Node server** |
| L5 | **One lantern per player, 3-stage shutter** (hooded / low / full); brighter burns fuel faster |
| L6 | **Lantern burns raw wood** — light and the fire draw from the same supply |
| L7 | **Darkness = remembered terrain**, which rots: dims, blurs, sharpens into a haunted wood the longer since you lit it. Geometry never lies. **Phantoms** appear in stale memory and dispel under light |
| L8 | **Chop → logs → carry → camp woodpile → feed fire**, with a **full weight system**: every item has mass, speed degrades with load, at capacity you cannot move |
| L9 | **Heavy crafting.** Two base resources: **scrap** (heavy, no tool needed) and **wood** (needs an axe, slower to gather, lighter). Wood is the common ingredient; **scrap is the star** |
| L10 | **Creature bodies are crafting material** — masks, tonics |
| L11 | **Setting: post-collapse.** Forest reclaiming ruins, wrecked vehicles, rusted machinery |
| L12 | **Creature senses:** they hunt your light. Kill your light and they lose you entirely and **switch to hearing** |
| L13 | **The gun is crafted from scrap.** Muzzle flash reveals the creature's exact position to you; the report reveals your exact position to it. You must relocate immediately, fast and quiet |
| L14 | **Sound duel:** ~5 shots to kill. Stand still and you are inaudible. **Hold-to-listen, fully stationary** — vision drops away, footsteps/sniffs/growls render as faint directional blips. Wounded creatures grow desperate: louder, more erratic, more dangerous |
| L15 | **Fire at zero → ~60s ember grace** to revive it; camp becomes enterable; embers die = run over |
| L16 | **Death → ghost** with limited-range sight; revive by **sacrificing a creature on the bonfire** |
| L17 | **LLM is the commander, code is the muscle** — plain-language orders every 10–20s, behaviour tree executes |
| L18 | **45–60 minute runs** |
| L19 | **Map is a long tube** — your camp at one end, the **creature lair** at the other |
| L20 | **The amulet is the win condition. The car is a late-game tool**, repairable, headlights, chases |

---

## 2. The Fire

**Q1.** Fuel capacity? — **Default: 300 units.**
**Q2.** Base burn rate? — **Default: 1.0/sec → a full fire lasts 5 minutes.**
**Q3.** Does burn scale with player count? — **Default: yes, +8% per player past the first.**
**Q4.** Does it escalate over the run? — **Default: yes, +10% every 10 minutes.** This is what makes the run end.
**Q5.** Fire tiers and light radius? — **Default:** Roaring 75–100% → 14m · Burning 40–75% → 10m · Low 15–40% → 6m · Guttering 1–15% → 3m · Embers → 1.5m. Radius interpolates smoothly; tiers only drive audio/VFX state.
**Q6.** Is the safe radius the same as the light radius? — **Default: no — safe radius is 70% of light radius.** You can see a creature at the edge of firelight that can still reach you.
**Q7.** When can creatures enter camp? — **Default: never while fire ≥ Low (15%).** Below that the perimeter fails.
**Q8.** Time to stoke one log? — **Default: 1.2s channel, interruptible, must be within 1.5m.**
**Q9.** Can you overstoke? — **Default: no, hard cap at 300.** Prevents front-loading the whole run.
**Q10.** Log fuel value? — **Default: log = 25, deadfall branch = 8.** Twelve logs fills an empty fire.
**Q11.** Can creatures damage the fire directly? — **Default: never.** They attack supply, never the flame.
**Q12.** Weather / rain pressure on the fire? — **Default: not in v1.** Flagged as the best difficulty lever to add later.
**Q13.** Does the fire's glow show from far away? — **Default: yes — visible as a horizon bloom down the whole tube.** It is your compass; no minimap exists.
**Q14.** Second fires / forward camps? — **Default: not in v1.** Would relieve exactly the pressure the game is built on.

## 3. Wood & Chopping

**Q15.** Sources of wood? — **Default: two.** Deadfall branches (ground, no tool, instant pickup) and standing trees (axe required).
**Q16.** Chopping cost? — **Default: 6 swings, 0.7s each, hold-to-chop, interruptible; yields 4 logs.**
**Q17.** Is chopping audible to creatures? — **Default: yes, 20m.** It is the loudest thing you routinely do.
**Q18.** Do trees respawn? — **Default: no. Permanent depletion.** The near wood is stripped bare in ~15 minutes, which is the engine that forces you down the tube.
**Q19.** Does deadfall respawn? — **Default: no.**
**Q20.** Do felled trees change line-of-sight? — **Default: yes — a felled tree stops casting shadow**, permanently altering visibility. Clearing a lane home is a real strategy.
**Q21.** Do dropped logs persist? — **Default: yes, indefinitely, and they are visible to nobody in the dark** — including you.
**Q22.** Woodpile capacity? — **Default: unlimited. Deposit is 0.25s per log.**
**Q23.** Feed the fire from the pile or from hand? — **Default: either.**
**Q24.** Can creatures attack the woodpile? — **Default: yes — 3s to scatter, hurling logs into the dark beyond the safe radius.** This is their primary sabotage.

## 4. Scrap & Salvage

**Q25.** Where does scrap come from? — **Default: wrecks, collapsed structures, machinery** in the Ruins zone and scattered lightly elsewhere. Pick up by hand, no tool.
**Q26.** Scrap grades? — **Default: two.** Light scrap 6kg (common) and heavy scrap 15kg (rare, needed for the gun and car parts).
**Q27.** Does scrap respawn? — **Default: no.**
**Q28.** Is scrap ever fuel? — **Default: no.** Keeps the two economies cleanly separate.
**Q29.** Can creatures steal scrap? — **Default: yes — they drag it away from camp** rather than destroying it. Recoverable if you hunt it down.

## 5. Weight & Inventory

**Q30.** Carry capacity? — **Default: 40kg base.**
**Q31.** Speed curve? — **Default:** `speed = 1 − 0.6 × (load/cap)^1.5`. Empty 100% · half 79% · full 40% · over capacity you cannot move.
**Q32.** Sprint? — **Default: available only under 50% load.**
**Q33.** Item masses? — **Default:** branch 1.5 · log 4 · light scrap 6 · heavy scrap 15 · gun 3 · ammo 0.1 · car part 20–30 · **creature corpse 25 (drag only, two players halves it)** · amulet 15.
**Q34.** Inventory UI model? — **Default: weight-only, no grid, no slots.** You carry what you can bear.
**Q35.** Panic drop? — **Default: yes — one key dumps everything instantly.** Non-negotiable given the chase design.
**Q36.** Does load make you louder? — **Default: yes, sound radius scales +50% at full load.** Ties weight directly to the duel.

## 6. Lantern & Light

**Q37.** Radius, burn, and detection per stage? — **Default:** Hooded 1.2m / 0.01 per sec / seen at 4m · Low 4m / 0.08 / seen at 18m · Full 9m / 0.25 / seen at 45m.
**Q38.** Lantern tank size? — **Default: 50 units (2 logs).** ~3.3 min at full, ~10 min at low.
**Q39.** Refuel cost and time? — **Default: 1 log = 25 units, 1.5s, anywhere.** You can refuel in the field from wood you're carrying — which is wood the fire doesn't get.
**Q40.** Shutter transition? — **Default: 0.3s, with a brief bloom on opening** — a tell that can get you caught.
**Q41.** Can you drop a lit lantern as a decoy? — **Default: yes.** It keeps burning and keeps drawing them.
**Q42.** Torches? — **Default: yes — craftable, 90s burn, 6m radius, throwable** as a light lure. The cheapest way to move a creature off a route.
**Q43.** Does the amulet light? — **Default: no. See Q92.**
**Q44.** Does light pass through trees? — **Default: no — full shadowcasting occlusion.** This is the whole tactical texture: you hide behind trunks and ruins.
**Q45.** Can players see each other's light? — **Default: yes, at full detection range**, same as creatures see it. A teammate's lantern across the wood is both a comfort and a warning.

## 7. Memory & the Rotting Map

**Q46.** How long until memory starts degrading? — **Default: begins at 30s, fully rotten at 4 minutes.**
**Q47.** What degrades? — **Default: brightness down, saturation to near-zero, edge-sharpening and silhouette warping up.** Trunks lean, branches sharpen into limbs.
**Q48.** Is geometry ever wrong? — **Default: never.** Collision always matches the true world.
**Q49.** Phantoms — how often? — **Default: spawn chance scales with rot; roughly one per 20s in fully-rotten memory within view.**
**Q50.** Do phantoms move? — **Default: yes, slowly, and toward you.**
**Q51.** How are they dispelled? — **Default: any real light touching them.** They vanish instantly, which is a huge relief beat and costs you fuel every time.
**Q52.** Can a phantom ever be a real creature? — **Default: yes — real creatures render identically in stale memory.** You can never be sure, which is the entire point.
**Q53.** Is memory per-player or shared? — **Default: per-player.** Your map is your own experience.
**Q54.** Does memory persist through death? — **Default: no, ghosts see truly (Q78); on revival your memory is wiped.**
**Q55.** First-time-seen areas? — **Default: rendered with maximum distortion until properly lit**, per your note.

## 8. Creatures

**Q56.** How many? — **Default: 4.**
**Q57.** Do they respawn? — **Default: yes — killed creatures return from the lair after 5 minutes.** Bodies must be renewable or revival (L16) becomes impossible to sustain.
**Q58.** Sound detection ranges? — **Default:** standing still 0m · crouch-creep 3m · walk 10m · sprint 25m · chopping 20m · gunshot 60m (alerts *all* creatures).
**Q59.** Light detection? — **Default: per Q37, and requires line-of-sight.**
**Q60.** Behaviour states? — **Default:** Patrol · Investigate · Pursue (light) · Hunt (sound) · Siege (camp perimeter) · Sabotage (woodpile/scrap) · Desperate (wounded) · Return.
**Q61.** Move speed? — **Default: 0.9× an unloaded player when patrolling, 1.15× when pursuing.** You cannot outrun one while carrying a load — you must break line of sight and go dark.
**Q62.** Contact result? — **Default: player killed → ghost (L16).** No downed state; the ghost *is* the second chance.
**Q63.** Can they open/break things? — **Default: they can scatter the woodpile and drag scrap. They cannot enter a defended camp or damage the car.**
**Q64.** Do they communicate with each other? — **Default: yes, implicitly — the LLM commands all of them from one shared context**, so they coordinate by construction.
**Q65.** Can they be permanently thinned? — **Default: no (Q57)**, but a kill buys you ~5 quiet minutes in that area, which is the real reward.

## 9. The Duel & the Gun

**Q66.** Shots to kill? — **Default: 5.**
**Q67.** Listen mode? — **Default: hold key, fully stationary, vision fades to near-black over 0.4s**, ambient audio ducks, sound events render as directional blips.
**Q68.** Blip accuracy? — **Default: ±12° initially, tightening to ±3° after 3 continuous seconds of listening.** Patience is rewarded.
**Q69.** What makes noise? — **Default:** footfalls while moving, a sniff every 2–4s while hunting, a growl on state change.
**Q70.** Desperation escalation? — **Default: 3 stages.** 0 hits methodical and quiet · 1–2 agitated, faster sweeps · 3–4 frenzied, pouncing blind, very loud and very fast. Exactly your described loop: it reveals itself more as it becomes harder to dodge.
**Q71.** Aiming? — **Default: hold to raise, turn speed cut to 35% while aimed**, so committing to a direction is a real commitment.
**Q72.** Muzzle flash? — **Default: 0.15s burst lighting ~12m**, revealing the creature's silhouette and everything else nearby.
**Q73.** Report? — **Default: broadcasts your exact position to every creature within 60m** and forces them into Hunt.
**Q74.** Ammo? — **Default: crafted, 5 rounds per 2 light scrap.** Never abundant.
**Q75.** Can you miss? — **Default: yes — hit detection is a true directional cone.** Firing at a bad blip wastes a round and announces you.
**Q76.** Friendly fire? — **Default: yes.** In the dark, with blips, this will happen and it should.

## 10. Death, Ghosts & Revival

**Q77.** Ghost vision range? — **Default: 12m, true sight** — no light needed, no memory rot, sees creatures and players.
**Q78.** Can ghosts move freely? — **Default: yes, at 80% speed, through obstacles, undetectable.**
**Q79.** Can ghosts communicate? — **Default: yes — full voice to the living.** The dead become the team's scout, which turns dying into a role rather than a bench.
**Q80.** Can ghosts interact with anything? — **Default: no. Nothing at all.**
**Q81.** Revival cost? — **Default: drag a corpse (25kg) to the bonfire, fire must be ≥ Burning (40%), 8s ritual, consumes 40 fuel.**
**Q82.** Can a ghost be revived more than once? — **Default: yes, unlimited, cost is the limit.**
**Q83.** All players ghosts? — **Default: run over immediately.**
**Q84.** Do corpses decay? — **Default: yes, unusable after 6 minutes.** You must commit to the haul.

## 11. Crafting

**Q85.** Stations? — **Default: three, all at camp.** Workbench (scrap work) · Forge (requires fire ≥ Burning) · Altar (creature parts).
**Q86.** Can you craft in the field? — **Default: no.** Camp must remain the gravity well.
**Q87.** Recipe count for v1? — **Default: 18.**
**Q88.** Core recipes? — **Default:** Axe (2 scrap + 3 wood) · Second lantern (3 scrap + 2 wood) · **Gun (8 heavy scrap + 2 wood, forge)** · Ammo ×5 (2 scrap) · Torch (2 wood + hide) · Backpack, +15kg (4 scrap + 2 hide) · Muffled boots, halves movement noise (3 hide) · Snare trap (3 scrap + 2 wood) · Windbreak, −15% burn rate (4 scrap) · plus 5 car parts (Q95).
**Q89.** Creature-part recipes? — **Default:** **Mask of the Blind** (skull + 3 scrap) — sound blips render passively without stopping, but your light radius is halved · **Mask of Stillness** (skull + hide) — creatures' hearing of you halved · **Tonic of the Beast** (organ + wood) — 90s: +25% speed, +10kg capacity, but double noise · **Tonic of Quiet** (organ + hide) — 60s near-silent · **Rendered fat** — burns in the lantern at ⅓ the rate of wood.
**Q90.** Are tools durable / breakable? — **Default: no.** Durability would add busywork without adding tension.
**Q91.** Is the tech tree gated? — **Default: yes, by resource rarity only** — no research, no unlocks. Heavy scrap is deep down the tube, and that is the gate.

## 12. The Amulet & Winning

**Q92.** Where is it? — **Default: at the creature lair, far end of the tube.**
**Q93.** What does picking it up do? — **Default: wakes the lair.** Every creature instantly learns its position and converges. The LLM is told explicitly that the endgame has begun.
**Q94.** What does carrying it do? — **Default: your lantern cannot be lit at all.** You run the entire length of the tube on rotting memory, hunted purely by sound. 15kg. This is the game's final exam and it uses every system.
**Q95.** Can you drop it? — **Default: yes.** Can creatures move it? **Default: no** — it stays where dropped.
**Q96.** Win trigger? — **Default: amulet within 1.5m of your bonfire while the fire is still alive.**
**Q97.** Is there any hint to its location? — **Default: no map marker; the lair is a visually unmistakable landmark** at the tube's end.

## 13. The Car

**Q98.** Where? — **Default: the Ruins, mid-tube.**
**Q99.** Parts needed? — **Default: 5** — battery, tyres, fuel line, headlight assembly, engine block. Each is heavy scrap plus a specific salvage found in a different zone.
**Q100.** What does it give you? — **Default: fast travel along the tube, 200kg trunk capacity, and headlights** (a 25m cone, enormous aggro).
**Q101.** Car fuel? — **Default: yes, finite, scavenged.** It is a limited number of trips, not a permanent solution.
**Q102.** Can it be damaged? — **Default: yes — creatures can wreck it during a chase**, requiring repair.
**Q103.** Can you drive without headlights? — **Default: yes, slowly and nearly blind.** The chase set-piece is choosing to turn them on.
**Q104.** Is the car required to win? — **Default: no**, but reaching the lair on foot with enough light to survive is punishing.

## 14. The Map

**Q105.** Dimensions? — **Default: ~1200m long × 250m wide**, bounded by ravine and cliff.
**Q106.** Zones? — **Default: five.** Camp (0–150) · Near Wood (150–400) · The Ruins (400–700, scrap-rich, car) · Deep Wood (700–1000) · The Lair (1000–1200, amulet).
**Q107.** Procedural or authored? — **Default: hand-authored zone templates, procedural detail within them.** Landmarks stay fixed so memory navigation is learnable.
**Q108.** Landmarks? — **Default: yes, one unmistakable silhouette per zone** — water tower, collapsed overpass, the wreck field, the lair.
**Q109.** Is the map the same every run? — **Default: layout fixed, resource and creature placement randomised.**
**Q110.** Is there verticality? — **Default: no.** Flat, single layer.

## 15. LLM Director

**Q111.** Cadence? — **Default: one call every 12 seconds.**
**Q112.** Model? — **Default: `claude-sonnet-5`** for the tick loop — latency and cost dominate here. Escalate to `claude-opus-5` only for the endgame trigger (Q93).
**Q113.** What does it see? — **Default: only what its creatures could sense.** Light events (position, brightness, timestamp), sound events, its own roster (positions, health, state), fire tier *if a creature has line of sight to camp*, elapsed time, its own last orders and their outcomes.
**Q114.** Does it ever get raw player positions? — **Default: NO. Enforced in the context builder, not by prompt instruction.** This is the single most important fairness rule in the project; a leak here silently ruins the game.
**Q115.** Output format? — **Default: strict JSON, one order per creature**, from a closed verb set: `PATROL(zone)` · `MOVE_TO(x,y)` · `INVESTIGATE(point)` · `HUNT_SOUND` · `SIEGE_CAMP` · `GUARD(zone)` · `SABOTAGE_PILE` · `REGROUP` · `RETREAT`. Plus one free-text `intent` string.
**Q116.** What is `intent` for? — **Default: developer log and post-run replay.** Optionally surfaced to players after a run as the enemy's diary — a strong hook, cheap to build.
**Q117.** Failure handling? — **Default: behaviour tree continues the last order.** After 3 consecutive failures, fall back to a scripted director permanently for that run and log it.
**Q118.** Cost control? — **Default: prompt-cache the static rules block; keep the dynamic context under ~800 tokens.**
**Q119.** Does it know the map? — **Default: yes, zone names and the tube layout.** It does not know where the amulet, the car, or unfound resources are.
**Q120.** Difficulty tuning? — **Default: via a system-prompt aggression parameter**, not by feeding it more information. Never make it stronger by making it omniscient.

## 16. Multiplayer, Controls & Presentation

**Q121.** Tick rate? — **Default: 20Hz server, client prediction for own movement, interpolation for others.**
**Q122.** Anti-cheat for darkness? — **Default: server-side per-player visibility culling** — never send entities the client cannot see. Without this, one console command defeats the entire game.
**Q123.** Voice chat? — **Default: proximity voice, no global channel.** Splitting up must feel like being alone.
**Q124.** Join model? — **Default: lobby before the run, no drop-in.**
**Q125.** Reconnect? — **Default: yes, within 3 minutes; character stands inert meanwhile.**
**Q126.** Controls? — **Default: WASD, mouse-aim, `F` shutter cycle, `E` interact/chop hold, `Q` panic drop, `Shift` sprint, `C` crouch-creep, `Ctrl` hold-to-listen, `R` raise weapon.**
**Q127.** HUD? — **Default: near-diegetic and minimal.** Lantern fuel reads off the lantern sprite; weight shows as a strain vignette; fire fuel is only legible when near the fire. **No minimap, no compass, no objective marker** — the fire's horizon glow is your only navigation aid.
**Q128.** Art direction? — **Default: near-monochrome darkness with warm firelight as the only saturated colour** in the game. Everything you value is orange; everything else is grey.
**Q129.** Audio priority? — **Default: highest.** The duel is an audio system with a visual garnish. Positional audio must be correct before the duel can be tuned at all.
**Q130.** Music? — **Default: none during play.** Silence is the instrument. Stingers on fire-tier drops only.

## 17. Session & Balance

**Q131.** Difficulty curve? — **Default: three levers only** — fire burn escalation (Q4), permanent resource depletion (Q18), and LLM aggression (Q120).
**Q132.** Tutorial? — **Default: a scripted opening 3 minutes** with a full fire and no creatures, teaching chop → haul → stoke before the first one arrives.
**Q133.** Meta-progression between runs? — **Default: none.** Every run starts cold.
**Q134.** Run summary? — **Default: yes — timeline of fire level, deaths, kills, and the LLM's intent log** (Q116).
**Q135.** Failure states? — **Default: two.** Embers die, or every player is a ghost.
**Q136.** Target first-run outcome? — **Default: loss.** Tune so the first several runs fail around minute 25–35.

---

## 18. Build Order — at a glance

Each phase is playable, which matters more than any of the above. **Fully specified in §21.**

1. Skeleton — server, tick, client, movement
2. Darkness — shadowcasting, lantern, visibility culling
3. The clock — fire, fuel, tiers, ember state
4. The loop — trees, chopping, weight, woodpile
5. Memory rot — decay, distortion, phantoms
6. Creatures, scripted — senses, states, behaviour
7. The duel — listen mode, blips, gun, desperation
8. Death & ghosts — corpses, sacrifice, revival
9. Crafting & scrap — stations, 18 recipes
10. The LLM director — context builder first, then orders
11. The car
12. The amulet, the lair, the endgame
13. Tuning

## 19. Verification

- **Per phase:** run it with 2 clients and play the loop end to end. This game cannot be validated by unit tests.
- **Automated:** headless server sim running 100 unattended runs to check fire-economy pacing — median run should die around minute 25–35 with a scripted director and no player.
- **Fairness harness (critical):** an assertion in the LLM context builder that fails loudly if any player position enters the prompt without a corresponding light or sound event within range. Run it as a test, not a code review.
- **Latency:** confirm creatures behave sanely with the LLM stubbed to 3s, 10s, and total failure.
- **The real test:** a stranger plays without instruction. If they do not work out that the shutter is the core verb within five minutes, the light system has failed and no amount of tuning fixes it.

---

## 20. The eight load-bearing defaults — CONFIRMED

These were the calls I made rather than inherited, and they are now **confirmed and locked**. They
are load-bearing: each one holds up systems elsewhere in this document, so changing any of them
later is a design change, not a tuning change.

- **Q18 — trees never respawn.** ✅ The engine driving you down the tube. Everything about map
  pacing (§14) and the car's usefulness (Q100) depends on this.
- **Q57 — creatures respawn after 5 minutes.** ✅ Required, or revival (Q81) starves.
- **Q62 — no downed state; contact kills straight to ghost.** ✅ Makes the ghost system the sole
  second chance, which is what gives Q81 its weight.
- **Q79 — ghosts keep voice comms and become scouts.** ✅ Turns death into a role, not a bench.
- **Q94 — carrying the amulet forbids light entirely.** ✅ The final exam; uses memory rot (§7),
  the sound duel (§9), and weight (§5) simultaneously.
- **Q114 — the LLM never receives raw player positions.** ✅ Enforced in the context builder and
  covered by a failing test (§19), never by prompt instruction.
- **Q127 — no minimap, no objective marker; navigate by firelight alone.** ✅ This is why Q13
  (the horizon bloom) exists and why it cannot be cut.
- **Q133 — no meta-progression.** ✅ Every run cold.

All remaining numbered defaults (Q1–Q136) stand as written unless called out later. The numbers in
§2–§17 are first guesses for tuning (Q13 of the build order); the *structures* are settled.

---

# 21. IMPLEMENTATION SPEC

Read §1–§20 first. That is *what* the game is. This is *how to build it*, in order, with the
technology named and the finish line for each step defined. Do not skip ahead — every step depends
on the one before it, and three of them (Step 2, Step 5, Step 10) are architecturally irreversible
if done late.

## 21.0 Technology decisions — settled, do not re-litigate

| Concern | Choice | Why this and not the alternative |
|---|---|---|
| Language | **TypeScript**, strict, everywhere | Shared sim code between client and server is the whole architecture |
| Repo | **npm workspaces monorepo**, 3 packages | `shared` must be importable by both sides as source |
| Build | **Vite** (client), **tsx** (server dev), **tsc** (typecheck) | Fastest iteration; no bundler config rabbit hole |
| Renderer | **PixiJS v8** (WebGL) | Need custom GLSL filters for memory rot. Canvas2D cannot do §7 |
| Transport | **`ws`**, JSON messages | Not socket.io — leaner. Swap to MessagePack only if profiling demands |
| Sim style | **Plain typed structs + system functions.** No ECS library | At this scope an ECS adds ceremony and obscures the tick order |
| Sim timing | **Fixed 50ms step (20Hz), deterministic, pure** | Required for client prediction to replay identically |
| Audio | **Web Audio API** with `PannerNode` | §16 Q129 makes positional audio load-bearing, not decorative |
| Voice | **WebRTC mesh**, server-gated volume | 2–4 players; a mesh is fine and avoids an SFU |
| LLM | **`@anthropic-ai/sdk`**, `claude-sonnet-5` | Q112. Server-side only; the key never reaches a client |
| Tests | **Vitest** | Sim is pure functions — unit-testable without a browser |

### Repository layout — create exactly this

```
ember/
  package.json                  workspaces: packages/*
  tsconfig.base.json            strict: true, target ES2022
  packages/
    shared/src/
      constants.ts              EVERY tunable from §2–§17, one file, named exports
      types.ts                  WorldState, Player, Creature, Item, SoundEvent, ...
      math.ts                   Vec2, lerp, clamp, seeded RNG (mulberry32)
      grid.ts                   OccluderGrid: 1m tiles, opaque bitset
      los.ts                    raycastLOS() [server] + visibilityPolygon() [client]
      protocol.ts               ClientMsg | ServerMsg discriminated unions
      sim/
        index.ts                step(world, inputs, dt) -> world   ← THE tick order lives here
        movement.ts  fire.ts  lantern.ts  weight.ts  chopping.ts
        items.ts     sound.ts  creatures.ts  combat.ts  crafting.ts  ghosts.ts
    server/src/
      index.ts                  ws server, lobby, run lifecycle
      room.ts                   one run, the 20Hz loop
      visibility.ts             per-player culling (Q122) + hysteresis
      director/
        perception.ts           PerceptionLog — the ONLY thing the LLM may read
        context.ts              builds the prompt. Imports perception.ts, NEVER types.ts
        schema.ts               closed order verb set (Q115) + zod validation
        llm.ts                  API call, caching, retry, timeout
        fallback.ts             scripted director
    client/src/
      main.ts  net.ts  input.ts
      render/ stage.ts  lighting.ts  memory.ts  entities.ts  hud.ts
      audio/  positional.ts  listen.ts
      voice.ts
```

### The tick order — `shared/sim/index.ts`, never varies

```
1  applyInputs        intents only, no movement yet
2  weight             recompute load → speedMul, noiseMul
3  movement           integrate, collide against OccluderGrid
4  emitSounds         movement/chop/gun → SoundEvent[] (this tick only)
5  lantern            drain fuel by shutter stage, handle transitions
6  fire               drain fuel, recompute tier + radii, ember countdown
7  chopping           swing progress, fell trees, spawn logs
8  items              pickup, drop, deposit, stoke
9  creatureSense      light checks (raycastLOS) then sound checks
10 creatureAct        behaviour tree, consuming blackboard orders
11 combat             shots, hits, desperation stage, deaths
12 ghosts             corpse decay, sacrifice ritual progress
13 crafting           station progress
14 winLose            amulet at fire / embers dead / all ghosts
15 writePerception    append to PerceptionLog  ← server-only hook
```

Every function is `(world, ctx) => void` mutating a draft, or pure returning new state. Pick one
and hold it: **mutate a draft, structuredClone the snapshot for the network layer.**

---

## Step 1 — Skeleton

**Goal:** two players walking around a lit rectangle, server-authoritative, prediction working.

1. Scaffold the monorepo and the three packages exactly as above. `tsconfig.base.json` with
   `"strict": true`; each package extends it with project references.
2. `shared/types.ts` — define `WorldState`, `Player`, `InputFrame { seq, dx, dy, buttons, tick }`.
3. `shared/sim/movement.ts` + `index.ts` — steps 1 and 3 of the tick order only. Fixed 50ms.
4. `server/room.ts` — `setInterval` 50ms, apply queued inputs, step, broadcast snapshot with
   `lastProcessedSeq` per player.
5. `client/net.ts` — send inputs at 20Hz tagged with a monotonic `seq`. On snapshot: snap the local
   player to the authoritative position, then **replay all inputs after `lastProcessedSeq`** through
   the identical `step()`. Other entities: buffer 100ms and interpolate, never predict.
6. `client/render/stage.ts` — PixiJS app, camera follows local player, debug rectangles for bodies.

**Done when:** two browsers, both players visible, movement feels instant locally with no rubber-band
on a 100ms simulated latency. **Verify prediction is real** by adding artificial 200ms lag and
confirming local movement stays smooth.

**Trap:** if the client and server ever run different `step()` code, prediction diverges silently.
Import from `shared`, never copy.

## Step 2 — Darkness *(architecturally irreversible — do it now)*

**Goal:** the screen is black except what your lantern reveals, and the server never tells you
anything else.

1. `shared/grid.ts` — `OccluderGrid`, 1m tiles, `Uint8Array` opacity. Built from the map definition.
2. `shared/los.ts`:
   - `raycastLOS(grid, a, b): boolean` — DDA traversal. **Server** uses this for creature sight.
   - `visibilityPolygon(grid, origin, radius): Vec2[]` — cast rays to occluder corners ±ε, sort by
     angle, build a triangle fan. **Client** uses this for rendering.
3. `client/render/lighting.ts` — render the visibility polygon into a mask render-target, composite
   world → mask → screen. Multiple lights (own lantern, fire, other players' lanterns, muzzle flash)
   composite additively into one mask.
4. `shared/sim/lantern.ts` — three shutter stages with radius / burn / detection from `constants.ts`
   (Q37). 0.3s transition with an opening bloom (Q40).
5. **`server/visibility.ts` — the anti-cheat spine (Q122).** Each tick, per player, compute the set
   of entities inside their light polygon or the fire's. Send **only** those. Add 300ms removal
   hysteresis so entities do not flicker at the boundary.

**Done when:** hooding your lantern makes the screen go near-black, and — critically — a player with
devtools open and the full websocket log **cannot see where anything else is.** Test this
explicitly: log every inbound message and confirm no off-screen entity appears in it.

**Trap:** it is tempting to send everything and hide it client-side "for now." That decision is
never undone, and it makes the entire game cheatable. Cull from the first snapshot.

## Step 3 — The clock

**Goal:** a fire that burns down and ends the run.

1. `shared/sim/fire.ts` — fuel 0–300, base drain 1.0/s, `×(1 + 0.08×(players−1))`, escalation
   `+10%` per 10 min (Q1–Q4). Tier and both radii from Q5/Q6, interpolated smoothly.
2. Ember state (Q7/L15): at 0 fuel enter `EMBERS`, 60s countdown, safe radius collapses so creatures
   may enter camp, relightable with any wood. Countdown expiry → loss.
3. Stoking (Q8): 1.2s interruptible channel within 1.5m, cap at 300 (Q9).
4. `client/render/hud.ts` — the **horizon bloom** (Q13): the fire's glow rendered as a distance-scaled
   gradient at the screen edge pointing home, brightness tied to tier. This is the navigation system;
   there is no minimap (Q127).

**Done when:** an idle run ends in exactly 5 minutes from full, the ember scramble is playable, and
you can find your way home from 800m out using only the bloom.

## Step 4 — The loop

**Goal:** it becomes a game.

1. `shared/sim/weight.ts` — masses (Q33), `speed = 1 − 0.6×(load/40)^1.5` (Q31), sprint gated under
   50% (Q32), `noiseMul` up to +50% at full (Q36). No slots, weight only (Q34).
2. `shared/sim/chopping.ts` — 6 swings × 0.7s, hold-to-chop, interruptible, yields 4 logs (Q16).
   Felling a tree **clears its occluder tile** (Q20) — the grid is mutable, and the lighting mask
   must pick that up the same frame.
3. `shared/sim/items.ts` — world items, pickup/drop, panic-drop on `Q` (Q35), the camp woodpile with
   unlimited capacity (Q22), deposit and stoke-from-pile (Q23).
4. Deadfall and trees placed by the map generator; neither respawns (Q18/Q19).

**Done when:** a solo player can keep the fire alive for 15 minutes by chopping and hauling, and
feels the speed penalty of a full load without checking a number.

## Step 5 — Memory rot *(the game's signature — do not compromise it)*

**Goal:** the dark is not empty, it is a lie you remember.

1. `client/render/memory.ts` — a `lastSeen` render-target at **1 texel per metre** (1200×250, tiny).
   Each frame, write `now` into every texel inside the current visibility polygon.
2. World shader samples it: `age = now − lastSeen`.
   - `age == 0` → true lit render.
   - `age > 0` → **rot**: brightness falls off starting at 30s, fully rotten at 4 min (Q46);
     saturation → 0; UV domain-warp proportional to age (trunks lean, edges sharpen into limbs) (Q47).
   - `lastSeen == 0` (never seen) → maximum distortion (Q55).
3. **Collision reads the true grid, never the memory texture (Q48).** Keep them in separate modules
   so this cannot be confused.
4. Phantoms (Q49–Q52): client-only entities spawned in high-age regions, ~1 per 20s in view, drifting
   slowly toward the player, destroyed on contact with any real light. **They must use the exact same
   silhouette shader as a dimly-lit real creature** — that ambiguity is the entire mechanic.
5. Memory is per-player (Q53) and wiped on revival (Q54).

**Done when:** walking back through territory you cleared 3 minutes ago is genuinely unsettling, and
you have raised your lantern at least once at something that turned out to be nothing.

## Step 6 — Creatures, scripted

**Goal:** four hunters with real senses and no LLM yet.

1. `shared/sim/sound.ts` — `SoundEvent { pos, loudness, kind, tick }`. Emitted by movement (speed ×
   `noiseMul`), chopping (20m), gunshot (60m), woodpile scatter. Ranges from Q58.
2. `shared/sim/creatures.ts`:
   - **Sense light:** any lantern/fire/flash within its stage's detection range *and* `raycastLOS`.
   - **Sense sound:** only consulted when there is no light target (L12). Standing still = 0m = truly
     inaudible (Q58).
   - **States** (Q60): Patrol · Investigate · Pursue · Hunt · Siege · Sabotage · Desperate · Return.
     Implement as a **priority switch over a blackboard**, not a BT library — debuggable and small.
   - Speeds 0.9× patrol / 1.15× pursue (Q61). Cannot enter safe radius while fire ≥ Low (Q7).
3. Sabotage (Q24/Q29): 3s to scatter the woodpile, hurling logs beyond the safe radius; scrap dragged
   away rather than destroyed.
4. Contact → player killed (Q62). Stub the ghost for now; wire it fully in Step 8.
5. `server/director/fallback.ts` — a scripted director assigning patrol zones. **This ships and stays
   forever** as the LLM failure path (Q117).

**Done when:** you can be hunted, lose them by hooding your lantern and standing still, and hear the
difference. Tune this *before* adding the LLM — if the creatures are not frightening on a script, the
LLM will not save them.

## Step 7 — The duel

**Goal:** the sound-based gunfight from L13/L14.

1. **Listen mode** (Q67): hold `Ctrl`, fully stationary, vision fades to near-black over 0.4s,
   ambient audio ducks hard.
2. **Blips must come from the server, not the client** — the client does not know creature positions
   and must not. Server sends `AudioBlip { angle, confidence }` only. Angular error ±12° tightening
   to ±3° after 3 continuous seconds (Q68).
3. Creature noise emission (Q69): footfalls while moving, a sniff every 2–4s while hunting, a growl
   on state change.
4. **Desperation** (Q70), the heart of it: 0 hits methodical and quiet · 1–2 agitated with faster
   sweeps · 3–4 frenzied, pouncing blind, very loud and very fast. Louder *and* harder to dodge as it
   weakens — that escalation is the whole fight.
5. Gun (`shared/sim/combat.ts`): raise with `R`, turn speed cut to 35% while aimed (Q71), 5 hits to
   kill (Q66), true directional cone so you can miss (Q75), friendly fire on (Q76).
6. **Muzzle flash** (Q72/Q73): a 0.15s light source at ~12m radius pushed into the lighting mask —
   it reveals the creature *because it is a real light*, not as a special case. The report broadcasts
   your exact position to every creature within 60m and forces them into Hunt.

**Done when:** you can kill a creature in total darkness using only sound, and the moment after your
first shot is genuinely frightening.

## Step 8 — Death & ghosts

1. Ghost (Q77–Q80): 12m **true sight** — ignores lighting and memory rot entirely, a separate render
   path. 80% speed, passes through obstacles, undetectable, cannot interact with anything.
2. Voice stays live to the living (Q79) — do not mute the dead; they become the scout.
3. Corpses: 25kg, drag-only, two-player carry halves effective weight (Q33), decay to unusable at
   6 minutes (Q84).
4. Sacrifice (Q81): corpse at bonfire, fire ≥ Burning, 8s ritual, consumes 40 fuel, ghost revives at
   the fire with **memory wiped** (Q54).
5. All players ghosts → run over (Q83).

**Done when:** a death feels survivable but expensive, and the ghost is actively useful on comms.

## Step 9 — Crafting & scrap

1. Scrap placement (Q25/Q26): light 6kg common, heavy 15kg rare and concentrated in the Ruins.
   Neither respawns (Q27).
2. Three stations at camp (Q85): Workbench · Forge (requires fire ≥ Burning) · Altar. No field
   crafting (Q86).
3. All 18 recipes (Q88) driven by a **data table in `constants.ts`**, not code — you will retune
   these constantly.
4. Creature-part items (Q89): Mask of the Blind (passive blips, half light radius) · Mask of
   Stillness · Tonic of the Beast · Tonic of Quiet · Rendered fat (⅓ lantern burn rate).
5. No durability (Q90). Gating is by resource rarity alone (Q91).

**Done when:** the gun is a real mid-run milestone that required a deliberate scrap expedition.

## Step 10 — The LLM director *(build the fairness boundary first)*

**Build these in this exact order. The context builder comes before the API call.**

1. **`server/director/perception.ts`** — a `PerceptionLog` written *exclusively* by the creature
   sensing code in Step 6. It holds light events (position, brightness, timestamp), sound events,
   creature roster (position, health, state), fire tier **only if a creature currently has LOS to
   camp**, elapsed time, and the previous orders with outcomes (Q113).
2. **`server/director/context.ts`** — builds the prompt from `PerceptionLog` **and nothing else.**
   Enforce structurally: this file may import `perception.ts`; it must **never** import `types.ts` or
   touch `WorldState` (Q114). Add an ESLint `no-restricted-imports` rule so a future edit cannot
   quietly break it.
3. **The fairness test, written now, in CI** — assert that no player position appears in a generated
   prompt without a corresponding light or sound event within range in the same window. This is the
   most important test in the project.
4. `schema.ts` — the closed verb set (Q115): `PATROL(zone)` · `MOVE_TO(x,y)` · `INVESTIGATE(point)` ·
   `HUNT_SOUND` · `SIEGE_CAMP` · `GUARD(zone)` · `SABOTAGE_PILE` · `REGROUP` · `RETREAT`, plus a free
   text `intent`. Validate with zod and **reject** malformed orders rather than coercing them.
5. `llm.ts` — `claude-sonnet-5`, one call per 12s (Q111/Q112), **fully async and never blocking the
   tick.** Cache the static rules block; keep dynamic context under ~800 tokens (Q118). Escalate to
   `claude-opus-5` only on the endgame trigger (Q93).
6. Failure path (Q117): behaviour tree continues the last order; after 3 consecutive failures switch
   permanently to `fallback.ts` for that run and log it.
7. Store `intent` per tick for the post-run enemy diary (Q116/Q134).

**Done when:** creatures visibly coordinate — cutting off a route, splitting to flank, laying siege
while one sabotages — and the game still plays correctly with the API key removed entirely.

**Trap:** do not "help" the model by adding player positions to the context to make it smarter. It
makes the enemy omniscient rather than intelligent, and it is undetectable by playtesting.

## Step 11 — The car

1. Placed in the Ruins (Q98). Five parts (Q99), each heavy scrap plus a specific salvage from a
   different zone.
2. Running: fast travel along the tube, 200kg trunk, 25m headlight cone with enormous aggro (Q100).
3. Finite scavenged fuel (Q101); wreckable by creatures during a chase and repairable (Q102);
   drivable dark, slowly and nearly blind (Q103).

**Done when:** turning the headlights on feels like a decision with consequences.

## Step 12 — The amulet & the endgame

1. Amulet at the lair, far end of the tube (Q92). 15kg.
2. Pickup **wakes the lair** (Q93): every creature learns its position, all converge, and the
   director is explicitly told the endgame has begun (escalate to `claude-opus-5` here).
3. While carried, **the lantern cannot be lit at all** (Q94) — the run home is on rotting memory,
   hunted purely by sound. Droppable; creatures cannot move it (Q95).
4. Win: amulet within 1.5m of a living bonfire (Q96).

**Done when:** the final run uses memory rot, the weight system, sound stealth, and the fire's
horizon bloom all at once — and is winnable.

## Step 13 — Tuning

Every number in §2–§17 is a first guess and will be wrong. Tune only these three levers (Q131):
fire burn escalation, resource depletion rate, LLM aggression. Target: first several runs fail
around minute 25–35 (Q136). Build the tutorial (Q132) and the run summary (Q134) here.

---

## 21.1 Verification

Per-step "Done when" gates are above and are mandatory. In addition:

- **Playtest each step with 2 clients.** This game cannot be validated by unit tests.
- **Headless sim harness** — 100 unattended runs with the scripted director; median death should
  land at minute 25–35.
- **Fairness harness (CI-blocking)** — Step 10.3. Never allow a red build here.
- **Latency matrix** — creatures must behave sanely with the LLM stubbed at 3s, 10s, and hard failure.
- **The anti-cheat check** — inspect the raw websocket log and confirm nothing off-screen is present.
- **The stranger test** — someone plays with no instruction. If they do not discover that the shutter
  is the core verb within five minutes, the light system has failed and tuning will not fix it.

---

# 22. MIGRATION & EXECUTION ON WINDOWS

*Operational, not design. §1–§21 is the game; this section is how to get it built from your own
machine. The `DESIGN.md` already delivered to you contains §1–§21 — this section is newer than that
copy, so re-request the file if you want it bundled in.*

## 22.1 State of the container

Five files exist here, committed across three local commits (`4f8d2e3` → `19938db` → `f8df35b`):
`DESIGN.md` (§1–§22), `CLAUDE.md`, `README.md`, `.gitattributes`, `.gitignore`. **No code yet.**

## 22.2 The push must happen from Windows — verified, not assumed

The GitHub connection **did not provision working git credentials into this container.** Diagnosed:

| Check | Result |
|---|---|
| `git remote -v` | empty — no remote was ever configured |
| `gh` CLI | not installed |
| `GH_TOKEN` / `GITHUB_TOKEN` | both the literal 14-char placeholder `proxy-inject` |
| Proxy credential injection | returns `builtin injection failed` |
| `GIT_ASKPASS` | empty |
| Anonymous read (`git ls-remote` on a public repo) | **works** |
| Authenticated read/write on any private repo | fails — prompts for a password that does not exist |

Anonymous GitHub access works, authenticated access does not. So the container can *fetch* public
code but can never *push*. **Do not spend more time trying to push from a remote session** — the
credential simply is not there.

The target repo is **`intel`**, and it already contains a `README.md`, so its history has diverged
from this container's. That makes history-merging the wrong tool for the job.

### Recommended: clone on Windows and copy the files in

Avoids all history surgery. The three local commits here are commits on a design document — their
history carries no value worth a merge conflict.

1. On Windows: `git clone https://github.com/<you>/intel.git` then `cd intel`.
2. Copy in all **five** delivered files, overwriting the `README.md` that is already there (the
   delivered one is the fuller version, pointing at `DESIGN.md` and `CLAUDE.md`).
3. `git add -A`, commit, then `git push`.
4. Confirm the default branch is `main` in the repo settings.

Note `.gitattributes` sets `eol=lf` — add it **before** committing TypeScript or GLSL, or the first
Windows commit bakes CRLF into the history.

### If you would rather keep this container's commit history

`git init` locally from the delivered files, `git remote add origin <url>`,
`git fetch origin`, `git rebase --onto origin/main --root` (resolving the `README.md` conflict in
favour of the delivered version), then `git push -u origin main`. More steps, more conflict handling,
no practical benefit.

### One aside

`intel` is an odd name for this project and it will be the folder name on disk for the whole build.
Renaming to `ember` in **Settings → General → Repository name** costs nothing right now and GitHub
redirects the old URL; it gets progressively more annoying once clones and CI exist. Entirely your
call — say the word and this document is otherwise unaffected.

## 22.3 Windows-specific setup, before Step 1

These are real friction points for *this* project specifically, not generic advice.

1. **PowerShell version.** Windows PowerShell 5.1 (the default) **does not support `&&`**. Claude Code
   will routinely generate `cmd1 && cmd2`. Install **PowerShell 7+** (`winget install Microsoft.PowerShell`)
   and run `pwsh`, or expect to hand-fix chained commands all day. This is the single biggest
   day-to-day annoyance if skipped.
2. **Long paths.** `node_modules` in a 3-package workspace will exceed the 260-character `MAX_PATH`
   limit. Enable long paths **before** the first `npm install`:
   `git config --global core.longpaths true`, and set `LongPathsEnabled=1` in
   `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem` (or via Group Policy).
3. **Line endings.** Add a `.gitattributes` with `* text=auto eol=lf` at the root before the first
   commit, or GLSL and TypeScript files will churn CRLF/LF noise through every diff.
4. **The API key.** `ANTHROPIC_API_KEY` is needed only at **Step 10**, not before. Set it with
   `setx ANTHROPIC_API_KEY "..."` (persistent, requires a new shell) and load it server-side via
   `.env`. Add `.env` to `.gitignore` immediately — the key must never reach a client bundle.
5. **If you use WSL2 instead:** keep the repo in the **Linux filesystem** (`~/ember`), never in
   `/mnt/c/...`. Vite's file watching across the `/mnt/c` boundary is pathologically slow and HMR will
   effectively stop working. You will also need to reach the dev server from a Windows browser, which
   usually works via `localhost` forwarding but is one more thing to debug. **Native Windows is the
   better fit here** — it's a browser game, so the dev server and your browser want to be on the same OS.
6. **Two-client playtesting** (required from Step 1's gate onward) works fine as **two browser windows
   on one machine** — use one normal and one private/incognito window so they get separate sessions.
   You only need LAN access, and a Windows Firewall exception, to test with a real second person.

## 22.4 How to actually drive the 13 steps

The plan is deliberately built so each step is a **self-contained session**. Do not ask for "build
EMBER" — context will overflow and quality will collapse around Step 4.

- **One step per session.** Open Claude Code and say: *"Read `CLAUDE.md` and `DESIGN.md`, then
  implement Step N. Stop at the Done-when gate."*
- **Honour the gate before moving on.** Every step has a concrete acceptance test in §21. They are
  ordered so that passing gate N is what makes step N+1 buildable.
- **Commit at every gate.** One commit per step, so a bad step is one `git revert` away.
- **Steps 2, 5 and 10 are irreversible if done late** — do not let a session "defer the hard part."
  Specifically: never accept "send everything and cull client-side for now" (Step 2), and never accept
  player positions in the LLM context (Step 10).
- **Steps 1–4 are the riskiest to rush.** They establish the shared deterministic sim; everything
  after inherits their bugs.

## 22.6 Superseded

§22.2's handoff advice is complete as written, but the operational workflow from here is §23.
Step 1 is built and delivered; the remaining twelve run on Windows.

## 22.5 Reconcile the predecessor first

Before Step 2, retrieve the **`Cinders game`** docs (`ARC.md`, `DESIGN.md`) from your machine — they
were unavailable here and reportedly record *what was tried and what broke*. The ghost/revival system
(§10) is already known to exist there in some form, so other collisions are likely. Reconciling a
90-minute design conflict now is far cheaper than discovering it at Step 8.

---

# 23. RUNNING THE BUILD

Step 1 is complete, verified, and delivered. This section is the operating manual for the remaining
twelve: **one step per session, on Windows, stopping at each gate.**

## 23.1 Do this now

```powershell
cd path\to\intel
tar -xzf ember-step1.tar.gz     # tar ships with Windows 10+
npm install
npm run dev
```

Open `localhost:5173` in two windows — one normal, one private. Two orange dots, WASD to move, each
seeing the other. Then:

```powershell
git add -A
git commit -m "Step 1: skeleton, server, client prediction"
git push
```

Optional but worth thirty seconds: load `localhost:5173?lag=200`. Movement must stay smooth while the
HUD shows ~200ms RTT and `corrections` stays near zero. That is Step 1's gate.

## 23.2 The per-step loop

Each step is one fresh Claude Code session. Fresh context per step is the point — §22.4 explains why
chaining them collapses quality around Step 4.

1. Open Claude Code in the `intel` folder.
2. Run `/step N`.
3. It builds only that step, typechecks, tests, commits, then **stops** and tells you what to playtest.
4. You run the gate. Pass → `/step N+1` next session. Fail → say what felt wrong, in plain language.
5. Push.

## 23.3 Create the `/step` command once

Save as `.claude/commands/step.md` in the repo (commit it — it belongs to the project):

```markdown
---
description: Implement one numbered step of the EMBER build plan
---

Read `CLAUDE.md` and `DESIGN.md` §21, then implement **Step $ARGUMENTS** — and nothing else.

Rules:
- Do not start any later step, and do not "prepare" for one.
- Honour the six load-bearing rules in CLAUDE.md. If a step seems to require
  breaking one, stop and tell me rather than working around it.
- Every tunable goes in `packages/shared/src/constants.ts`, never inline.
- New systems slot into their numbered stage in the tick order in
  `packages/shared/src/sim/index.ts`. Do not reorder existing stages.
- Run `npm run typecheck` and `npm test`. Both must pass.
- Commit with a message naming the step.

Then STOP. Tell me exactly what to do in the browser to check this step's
Done-when gate, and what a failure would look like as opposed to a pass.
```

## 23.4 What to say at a gate

Be blunt and sensory rather than technical — the gates are about feel, and "the drift shader alpha is
wrong" is less useful than "it looks smudgy, not haunted."

- Pass: `/step N+1` in a new session.
- Fail: *"Gate failed on Step 5 — the rot reads as a blur filter, not as memory going wrong. Fix
  before Step 6."*
- Partial: *"Darkness is right but hooding barely changes anything. Retune before continuing."*

## 23.5 If you run out of tokens mid-step

Nothing is lost. Work is committed as it goes, and a fresh session re-reads `CLAUDE.md` and
`DESIGN.md` from the repo. When your limit resets, open a session and say:

> Read CLAUDE.md and DESIGN.md. Check `git log` and the working tree to see how far Step N got, then
> finish it and stop at the gate.

This is also why nothing here depends on a timed loop: the repo is the state, so any session can pick
up from it.

## 23.6 Gate quick reference

What to check when each step reports done. Pulled from the Done-when lines in §21 — the italics are
the ones only you can judge.

| Step | Gate |
|---|---|
| 2 Darkness | Hooding the lantern goes near-black. **Open devtools, read the websocket log, confirm nothing off-screen appears in it.** |
| 3 The clock | An idle fire dies in exactly 5 minutes. The ember scramble is playable. You can get home from 800m using only the horizon bloom. |
| 4 The loop | You can hold the fire alive for 15 minutes solo, and *feel* the load penalty without reading a number. |
| 5 Memory rot | *Returning to territory you cleared 3 minutes ago is genuinely unsettling, and you have raised your lantern at least once at nothing.* |
| 6 Creatures | You can be hunted, lose them by hooding and standing still, and *hear the difference.* Must be frightening on the script, before any LLM. |
| 7 The duel | You can kill one in total darkness by sound alone, and *the moment after your first shot is frightening.* |
| 8 Ghosts | Death feels survivable but expensive, and the ghost is *actually useful* on comms. |
| 9 Crafting | The gun is a real milestone that required a deliberate scrap expedition. |
| 10 LLM | Creatures visibly coordinate — flanking, cutting routes, sieging while one sabotages. **And the game still plays correctly with the API key removed entirely.** |
| 11 The car | Turning the headlights on *feels like a decision with consequences.* |
| 12 Endgame | The final run uses memory rot, weight, sound stealth and the bloom at once — and is winnable. |
| 13 Tuning | First several runs fail around minute 25–35 in the 100-run headless harness. |

Steps 2, 5 and 10 carry the irreversible rules. Their bolded checks are not optional polish — they
are the difference between the game working and being quietly broken in a way that surfaces much later.
