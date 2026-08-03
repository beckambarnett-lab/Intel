# EMBER — title art prompts

Every prompt here is built off `DESIGN.md`'s locked art direction, not generic horror-game vibes:

- **Q128** — near-monochrome darkness; warm firelight is the *only* saturated colour in the game.
  Everything you value is orange, everything else is grey. This is the single hardest rule.
- **L1 / Q44** — true shadowcasting. Trunks and ruins throw hard-edged radial shadows *away* from
  the fire. No soft ambient fill, no moonlight, no rim light from nowhere.
- **L11** — post-collapse. Forest reclaiming ruins, wrecked vehicles, rusted machinery.
- **L7 / Q47** — memory rot: unlit terrain is desaturated, brightness-drained, edge-sharpened.
  Trunks lean, branches sharpen into limbs.
- **Q13** — the fire's horizon bloom down the tube is the only navigation aid in the game.
- **Q56 / Q59** — four creatures; they perceive light and nothing else.

---

## 1. Hero key art (primary)

> Cinematic key art for a survival horror game. High three-quarter overhead view, camera tilted
> about 60 degrees down, looking into a small clearing in a dead winter forest at night. Dead
> centre: a large bonfire burning hard, the only light source in the entire image. Its glow throws
> long hard-edged radial shadows outward from every tree trunk, every rusted oil drum, every stump,
> like spokes of black cut across snowless frozen ground — true raycast shadows with crisp
> boundaries, not soft ambient falloff. Ringing the fire: a stacked woodpile, a chopping block with
> an axe buried in it, a half-stripped wrecked sedan swallowed by roots and bracken, coils of rusted
> machinery going back to the forest. One lone human figure in a heavy layered coat stands at the
> very edge of the firelight with their back to us, small in frame, holding a shuttered brass
> lantern low at their side; the lantern casts its own tight separate pool of orange that stops
> abruptly at a wall of pure black. Just beyond the reach of the light, at the treeline, four tall
> gaunt eyeless silhouettes stand between the trunks — barely resolved, defined only by the rim of
> dim orange grazing their edges, mostly negative space, faces never legible. The forest behind them
> dissolves into an ash-grey, colour-drained, hallucinated version of itself: trunks leaning at
> wrong angles, branches sharpening into reaching limbs, detail rotting away into black at the frame
> edges. Colour discipline is absolute: the fire and lantern are the only saturated things in the
> image — deep ember orange, coal red, white-hot core — and every single other element is
> desaturated near-black, ash grey and cold bone. Palette #07070A, #1A1614, #6E6E68, #8C2A0E,
> #FF7A2F, #FFD9A0. Heavy grain, deep crushed blacks, no blue moonlight, no fill light, no lens
> flare, 90% of the canvas in darkness. Painterly digital illustration, muted charcoal-and-ink
> texture over photoreal lighting. Bleak, patient, lonely. --ar 16:9

## 2. Compact version (short-prompt engines)

> Top-down-ish night forest clearing, one bonfire as the sole light source throwing hard radial
> shadows from trunks and rusted wreckage, a lone figure with a shuttered lantern at the edge of the
> glow, four gaunt eyeless silhouettes waiting just outside the light, forest rotting into
> desaturated grey hallucination beyond. Firelight is the only saturated colour; everything else is
> near-black and ash grey. Crushed blacks, heavy grain, painterly horror key art. --ar 16:9

## 3. Alternate compositions

**A — The Tube.** Ground-level view down a long corridor of dead trees, the frame almost entirely
black. Far away at the vanishing point, a tiny warm bloom on the horizon: the camp fire, the only
thing in the picture, no bigger than a thumbnail. Foreground: a single figure walking away from
camera with a hooded lantern, a 1-metre pool of light around their boots, everything else absolute
dark. Silhouettes flanking them in the trees, implied not drawn. Sells the loneliness and the fact
that the glow *is* the compass.

**B — The Amulet Run.** A sprinting figure carrying a heavy black stone amulet, no lantern, no light
on them at all — rendered entirely as a grey memory-rot silhouette against a warped colour-drained
forest, trunks leaning like ribs. Behind them, far back, the only warmth in frame is the distant
camp bloom they are running toward. Pursuing shapes are indistinguishable from the leaning trees.

**C — The Perimeter.** Straight overhead, near-orthographic, the camp as a bright orange disc on a
field of black. The disc's edge is a hard circle. Four pale shapes press against the outside of that
circle at four points, like a clock face. Almost abstract. Works as a poster, an icon, or a loading
screen.

## 4. Logotype prompt

> The word "EMBER" in a tall condensed brutalist serif, letterforms carved from cold grey stone or
> charred wood, spanning the lower third of a black field. The letters are unlit and near-black
> except where a fire below-frame catches their bottom edges in dim ember orange, and fine cracks
> running through the strokes glow faintly from within like coals. Fine ash and drifting sparks rise
> across the letterforms. No gradients on the face of the type, no bevels, no glow bloom outside the
> cracks. Wide letter spacing. Subtitle beneath in small, thin, widely tracked grey caps.

## 5. Negative prompt

`blue moonlight, teal shadows, purple sky, colour grading split-tone, ambient fill light, lens
flare, god rays, bright overall exposure, magic effects, glowing eyes, visible monster face, gore,
sharp-toothed creature close-up, fantasy armour, torch-lit dungeon, campfire camping vibe, cozy,
warm inviting, HUD elements, text watermark, oversaturated, HDR, clean digital gloss`

## 6. Notes on getting it right

- If the generator adds blue or teal to the shadows, restate **"shadows are pure black, zero blue,
  zero colour in the darkness"** — that is the failure mode that breaks Q128 every time.
- If the creatures come out too legible, push them further out: *"barely visible, 90% obscured, read
  as gaps between the trees rather than as figures."* Ambiguity is the mechanic (Q52).
- The fire should feel like it is **losing**. Ask for "burning hard but low, more coal than flame,
  the woodpile visibly small" — the whole game is a clock running out.
- Aspect ratios: `16:9` key art · `21:9` Steam capsule / banner · `1:1` icon (composition C) ·
  `2:3` poster (composition B).
