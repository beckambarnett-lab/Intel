# Decisions that override DESIGN.md

`DESIGN.md` is still the spec for everything it covers. These are the places
where playtesting changed a decision after it was locked, and where following
the design bible literally would now rebuild something we deliberately removed.

**Read this before Step 7.** Every entry here was arrived at by playing the
build, and several replaced a first attempt that was wrong in an instructive
way. The reasoning is preserved because the wrong version is usually the
obvious one, and it will be re-derived otherwise.

Steps 1–6 are complete, and the fire's fuel cap is gone (§6). Next: Step 7.

---

## 1. Creatures see in the dark. Light is camouflage. *(overrides L12, Q37, Q59)*

L12 said "they hunt your light — kill your light and they lose you entirely and
switch to hearing", and Q37's `seenAtM` column made brighter light spotted from
further (4m hooded / 45m full). That produced **two roughly equal strategies** —
go bright and be seen from far, or go dark and be invisible until close — and a
dilemma the player cannot evaluate is worse than one option with a price on it.

Now:

- **Sight is flat at `CREATURE_DARK_SIGHT_M` (60m)**, whatever your lantern is
  doing. Going dark does not shorten it; it only sharpens them up.
- **Only line of sight breaks it**, so hearing is what happens when you put rock
  between you. Cover is the stealth tool, not darkness. Q58's range table stays
  load-bearing and `C` (creep) matters — behind something.
- Detection is flat **on purpose**. If bright light also drew them from further,
  darkness would have merit again and the dilemma would be back.

Light's value is that **you see further** — you watch one stalk in from nine
metres instead of noticing it at one — and that fuel is the only price. One
axis, risk against reward, with a death spiral when the tank runs dry.

## 2. It pounces at the CENTRE of the brightest thing it can see

Not at you, and **not at a guess**. One rule; everything falls out of it:

| your situation | what it charges |
|---|---|
| holding a lantern | you — you *are* the centre |
| standing in firelight | the bonfire — you are off to one side of it |
| lantern set down (Q41) | the lantern — it misses you entirely |
| no light at all | you; nothing else to fix on |

Targets are chosen by **brightness, not proximity** (`brighter()` in
`sim/creatures.ts`). That is what makes the decoy work: a lit lantern on the
ground outshines a player standing in the dark beside it.

**Do not add aiming scatter.** It was tried. Randomising the aim point inside
the glow made a bright lantern *unpredictable* rather than safe — a wrong guess
sometimes landed exactly where you dodged to — so surviving became a coin flip
with no skill in it. Measured, dodging was *worse* with a full lantern than a
hooded one. The counterplay must be something you do, not something you are
dealt.

## 3. The fire is a beacon *(extends Q13)*

Creatures spawn at the lair and walk the tube toward the bonfire because they
can see it. Q13 already carries its glow down the whole map as a horizon bloom —
over the treeline, not through it — so this needs **no line of sight**.

Reach is `fire.lightRadiusM × CREATURE_FIRE_BEACON_MULT` (90):

    roaring  14m -> 1260m (the whole map)   guttering 3m -> 270m
    burning  10m ->  900m                   embers  1.5m -> 135m
    low       6m ->  540m                   out          -> nothing

So the trade cuts both ways at once: a big fire holds the perimeter (Q7) and
hides you inside its glow, **and** summons everything in the wood. It also paces
the opening honestly — about 2.3 minutes of walking before the first arrival,
earned by distance rather than a scripted grace period.

`DIRECTOR_PATROL_ZONES` now only decides where stragglers wander when the fire
is out or too small to have drawn them.

## 4. Curiosity band: 60–120m

Between `CREATURE_DARK_SIGHT_M` and `CREATURE_CURIOSITY_M` a creature catches a
*hint* and drifts over at walking pace (`certain: false` on the blackboard →
`investigate`). Only inside 60m does that become a sighting and a chase.

Without it the model was a switch: at 61m it had no idea you existed, at 59m it
was sprinting at your face. Traced: notices at ~92m, commits at ~52m, on you
about five seconds later.

## 5. Momentum, stamina and the launch *(overrides Q61's speeds)*

Movement used to set velocity straight at the target every tick. Creatures now
carry a **heading and a speed**: they accelerate, can only turn sharply when
slow (`turnRateAt`: 360°/s at rest → 35°/s at full charge), and spend stamina.

The **launch** is the payoff — brake to aim, rear and roar for
`CREATURE_LAUNCH_WIND_SEC` (0.4s), then burst to ~18 m/s on a heading frozen at
commitment. It cannot steer. Sidestep and it goes past.

- **Launches may only commit from 12–25m.** The lower bound must stay above
  `LANTERN_STAGES.full.radiusM`. Committing inside your own glow would make the
  aim pinpoint however bright you were.
- Speeds: patrol 1.1×, pursue 1.15×, launch 2.6×, desperate 1.8× of
  `PLAYER_WALK_SPEED` (now 7 m/s). Q61's 0.9/1.15 made a patrolling creature
  slower than a walking player, which read as scenery on a 1200m map. The
  relationship Q61 cares about is preserved: you cannot outrun a pursuit at a
  walk, a sprint edges one by 0.7 m/s, Q32 removes even that above half load,
  and nothing outruns a charge.
- The wind-up is **fixed, not scaled by light**. Scaling it was tried and puts
  the effect where the player cannot see the cause.
- A spent creature drops to a trudge. Stamina that gated only launches gated
  nothing observable.

**One narrow, deliberate exception to Q122** lives in
`server/src/visibility.ts`: a creature rearing or committed is sent to players
within launch range even outside their lantern. Without it the dodge cannot be
reacted to. It stays honest because the renderer still decides what you *see* —
on remembered ground it arrives at memory brightness, easily mistaken for a
phantom; on ground you have never lit it stays black.

## 6. No caps on fuel

- **Lantern**: `LANTERN_TANK` (50) is the starting fill, not a ceiling. Hold `F`
  to refuel continuously (Q39's numbers set the rate); a tap still cycles the
  shutter, with `LANTERN_REFUEL_HOLD_SEC` between them.
- **Bonfire**: Q1/Q9's hard cap of 300 is gone. The fire scales indefinitely and
  eats wood in proportion. `FIRE_CAPACITY` is now `FIRE_NOMINAL_FUEL` — still
  300, but a reference point rather than a ceiling, and everything Q5 and Q7
  keyed to a *fraction* of it is now stated in absolute fuel.

  Three decisions, and each was picked so that **at or below 300 the arithmetic
  is bit-identical to the capped version**. Step 3's "an idle fire dies in
  exactly five minutes" gate did not move and did not need editing.

  **Burn** is `FIRE_BASE_BURN_PER_SEC × max(1, fuel / FIRE_NOMINAL_FUEL)`, with
  the Q3 crowd and Q4 escalation multipliers still on top. The `max(1, …)` is
  what protects the five minutes: a fire on its last log must not burn in slow
  motion. Above nominal the drain is proportional to what is on it, which is
  exponential decay with a five-minute e-fold — so 7500 fuel (300 logs) starts
  at 25/sec, *exactly one log a second*, falls back to nominal in about sixteen
  minutes and dies at twenty-one. The same wood drip-fed would have burned for
  over two hours. **Over-stoking rents light; it never banks it**, and that
  6× waste is the entire price.

  **Tiers** are the old fractions multiplied out: roaring 225, burning 120, low
  45, guttering 0.3, embers 0. Nothing about the current feel changes.
  `FIRE_PERIMETER_MIN_FUEL` is 45, which is the `low` threshold, as Q7 says.
  Guttering starts at 0.3 rather than at 0 because reaching zero is what triggers
  the ember countdown (L15) — if the two thresholds met, a dead fire would report
  itself as guttering and the scramble would never start. **There is no tier
  above roaring**: an over-stoked fire is a roaring fire that happens to be
  enormous, and a sixth state would mean a sixth set of audio and VFX assets for
  a band with no upper edge.

  **Radius** is unchanged below nominal and logarithmic above it:
  `14 + FIRE_RADIUS_LOG_COEFF × ln(fuel / nominal)`. Every doubling of the
  woodpile is worth a flat ~6.9m, so 300 logs throws 46m and 1200 logs throws
  60m. The coefficient (10) was set by measurement, not taste. Per frame per
  light the client casts a visibility polygon and stamps the memory field, and
  both grow faster than the radius: on the tube map at camp, **14m costs 0.7ms,
  46m costs 3.9ms, 60m costs 7.5ms, and 80m costs 16ms — the entire 60fps
  frame**. Ten puts a realistic hoard at a quarter of the budget and needs 2400
  logs to reach 67m. That self-limiting curve is the only reason no hard clamp
  was needed; **raising this coefficient is a performance change, not a taste
  change**.

  Two consequences worth knowing:

  - **The beacon does not get worse.** `CREATURE_FIRE_BEACON_MULT` (90) already
    saturates at roaring — 14m × 90 = 1260m is longer than the 1200m map — so
    growing the radius does not summon anything extra. Over-stoking buys light
    and a wider perimeter at no cost in creature attention. The only price is
    wood, deliberately.
  - **`campPresenceRangeM` in `sim/creatures.ts` exists because of this.** The
    perimeter passes `CREATURE_SIEGE_RANGE_M` (40m) at about 890 logs, and the
    flat gate would then sit *inside* the ring the creature is excluded from: it
    could never get close enough to decide to prowl or to take the woodpile, so
    it would walk at camp forever and be shoved back every tick. The gate now
    stays outside the perimeter it describes, and returns the flat 40 for any
    fire of ordinary size.

  **Pre-existing, not caused by this, but now permanent:** `sabotage` is a dead
  end whenever the woodpile sits inside the safe radius, which is true of any
  fire above ~62 fuel — the creature walks to the perimeter and grinds there
  instead of reaching the pile. Verified against the pre-change build, which does
  the same thing at nominal. It used to be a phase you burned through; with a big
  fire it is the steady state, so **Q24's primary sabotage effectively does not
  fire while the camp is well fed**. Worth a decision before or during Step 7 —
  either the perimeter should not shield the pile, or the pile belongs outside
  it.

## 7. Controls beyond Q126

`G` sets the lantern down / picks it back up. Hold `F` refuels.

---

## Step 7, as designed in conversation

The duel, built on the movement model above:

- **Muzzle flash blinds** for a window, within its own 12m radius and line of
  sight, **refreshing not stacking**. Q72 already says the flash reveals the
  creature *because it is a real light*; blinding is the same principle read
  backwards, since creatures hunt light.
- **Blinded means inaccurate, not slowed.** It charges the sound of the report
  at full speed on a bad heading. A stun-lock turns the scariest thing in the
  game into a shooting gallery.
- **Reload is 2s and noisy.** This is what forces L13's "relocate immediately" to
  be a rhythm rather than advice: shoot → it comes at the report → move → shoot.
- **Blind should be shorter than the reload** (~1.2s vs 2s) so the two beats
  stay distinct — it lunges wrong, recovers, reacquires, *then* you fire. At 3s
  it is permanently blinded and the beats merge.
- **Desperate creatures lead your heading** rather than your last position —
  they lunge where you were *going*, so dodging becomes a direction change.
- Blinding is load-bearing now rather than decorative: since creatures see in
  the dark, the flash is the only thing that takes their sight away.

## Environment notes

- Windows: use `npm.cmd` (PowerShell blocks the unsigned `npm.ps1`), and leave
  the `npm run dev` terminal open — the server runs inside it.
- **The dev container has no GPU.** `typecheck`, the suite and a production
  build all pass over renderer bugs that only fail on real WebGL. A first-frame
  crash shipped this way once. The browser check is not optional.
- Verify sim behaviour by tracing it: a throwaway `*.test.ts` that prints
  distance/state/speed per second and throws the log has caught more real bugs
  in this project than reading the code has.
