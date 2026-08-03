# Decisions that override DESIGN.md

`DESIGN.md` is still the spec for everything it covers. These are the places
where playtesting changed a decision after it was locked, and where following
the design bible literally would now rebuild something we deliberately removed.

**Read this before Step 7.** Every entry here was arrived at by playing the
build, and several replaced a first attempt that was wrong in an instructive
way. The reasoning is preserved because the wrong version is usually the
obvious one, and it will be re-derived otherwise.

Steps 1–6 are complete. Next: the fire's fuel cap (below), then Step 7.

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
- **Bonfire — NOT YET BUILT.** Q1/Q9's hard cap of 300 is to be removed: the
  fire scales indefinitely and burn rate scales with how much is on it. This is
  the next task, and it is not a tweak — Q5 defines *every tier and light radius
  as a fraction of capacity*, and Q7 keys the perimeter to a fraction, so with
  no cap there is no denominator. Radius and tiers need re-deriving against
  absolute fuel, and Step 3's "idle fire dies in exactly 5 minutes" gate moves.

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
