# EMBER — Execution runbook

How to actually drive the remaining build. `PLAN.md` is what to build and in what order;
`DESIGN.md` §21 is the specification each step is measured against. This is the operating manual:
one step per session, stop at every gate, and what to do when a gate fails.

`DESIGN.md` §22–§23 wrote this workflow when Step 1 was the next thing to build. This supersedes the
step-by-step parts of §23 and keeps its reasoning intact.

---

## 0. Before the first session of the day

```bash
git pull origin main
npm install          # only when package.json changed; harmless otherwise
npm run typecheck
npm test
npm run dev          # server :8787, client :5173
```

A green baseline before you start is what lets you attribute any breakage to the step you are
about to build. If `main` is red, fix that first — never start a step on a red tree.

**Current baseline:** `tsc --build` clean, 159 tests in 12 files, protocol version 4.

Two browser windows on `localhost:5173`, one normal and one private, gives you the two clients that
every gate from Step 1 onward assumes.

---

## 1. The per-step loop

Each step is **one fresh Claude Code session**. Fresh context per step is the point, not an
inconvenience — chaining them collapses quality around the fourth step, which is why the plan is
shaped this way at all.

1. Open a session in the repo.
2. Run `/step N`.
3. It builds only that step, runs `npm run typecheck` and `npm test`, commits, then **stops** and
   tells you exactly what to check in the browser.
4. You run the gate (§3) with two clients.
5. Pass → push, then `/step N+1` in a **new** session. Fail → §4.

The `/step` command already exists at `.claude/commands/step.md` and encodes the six load-bearing
rules. Do not paraphrase it into a free-form prompt; the constraints in it are the whole point.

### What a step is allowed to do

- Fill its own numbered tick stages. Never reorder existing ones.
- Add constants to `packages/shared/src/constants.ts`, cross-referenced to a Q-number.
- Extend `server/visibility.ts` for any entity it introduces (`PLAN.md` §5.1).
- Bump `PROTOCOL_VERSION` if it changes a message shape.

### What a step must never do

- Start or "prepare for" a later step.
- Send a client anything it cannot see, even temporarily.
- Copy sim code across the client/server boundary.
- Inline a tunable at a call site.
- Break one of the six rules in `CLAUDE.md` quietly. If a step appears to require it, the correct
  outcome is the session **stopping and telling you**, not working around it.

---

## 2. Session prompts

**Normal start:**

```
/step 6
```

**Resuming a step that ran out of context mid-way:**

> Read CLAUDE.md, PLAN.md, and DESIGN.md §21. Check `git log` and the working tree to see how far
> Step N got, then finish it and stop at the gate.

Nothing is lost when a session ends early — work is committed as it goes and the repo is the state.

**When a gate failed and you want a fix, not a new step:**

> Gate failed on Step N — <what it felt like, in plain language>. Fix that and re-run the gate. Do
> not start Step N+1.

---

## 3. Running a gate

Gates are about **feel**, and most of them cannot be judged by a test. Run each one with two clients,
in a genuinely dark room if you can — this game is unreadable on a bright screen.

### The universal checks, every step

| Check | How |
|---|---|
| Typecheck and tests | `npm run typecheck && npm test` — both green before you even look at the browser |
| Prediction still smooth | `localhost:5173?lag=200` — local movement stays perfectly smooth, corrections near zero |
| **Nothing off-screen on the wire** | Devtools → Network → WS → Messages. Read a snapshot. It must contain only what your screen shows |

The third one is not optional polish. It is the check that keeps the entire game from being
defeatable with one console command, and it gets *more* important with every entity type added.

### Per-step gates

Pulled from `DESIGN.md` §21. Italics mark the ones only a human can judge.

| Step | Gate | A failure looks like |
|---|---|---|
| **6** Creatures | You can be hunted, lose them by hooding your lantern and standing still, and *hear the difference* | You lose them by walking away; hooding changes nothing; you cannot tell where a creature is by ear; creature positions appear in the socket log |
| **7** The duel | You can kill one in total darkness by sound alone, and *the moment after your first shot is frightening* | Blips are too precise to be tense, or too vague to act on; the shot does not visibly draw everything nearby; you can see the creature without the muzzle flash |
| **8** Ghosts | Death is survivable but expensive, and the ghost is *actually useful* on comms | Dying feels like a bench; or revival is so cheap that death stops mattering; or a dead player's client suddenly receives the whole world |
| **9** Crafting | The gun is a real milestone that required a deliberate scrap expedition | You craft it incidentally on the way to something else, or you never have enough scrap to try |
| **10** LLM | Creatures visibly coordinate — flanking, cutting routes, sieging while one sabotages — **and the game still plays correctly with the API key removed entirely** | Behaviour is indistinguishable from the script; or the tick hitches when the API is slow; or the fairness test is red; or removing the key breaks the run |
| **11** The car | Turning the headlights on *feels like a decision with consequences* | Headlights are free; or the car is so useful you always drive; or so weak you never repair it |
| **12** Endgame | The final run uses memory rot, weight, sound stealth and the horizon bloom at once — and is winnable | You can win with the lantern lit; or the run home is navigable without the bloom; or it is impossible rather than hard |
| **13** Tuning | First several runs fail around minute 25–35 in the 100-run headless harness | Median death far outside that window, or wildly high variance between runs |

### Extra checks on the irreversible steps

**Step 10 is the one that can be silently broken.** Three checks, all mandatory:

```bash
npm test                                  # the fairness test must be green
npx eslint .                              # no-restricted-imports must be enforced, not advisory
```

then, with `ANTHROPIC_API_KEY` **unset in the server's environment**, play a full run. Creatures must
behave exactly as they did at the end of Step 6. If the game degrades noticeably, the scripted
director has rotted and that is a Step 10 bug, not a missing feature.

Also grep the generated prompt once by hand — log one real context payload and read it. If a player
position is in there without a light or sound event that would justify it, stop and fix it before
anything else. Everything downstream of that is built on a broken premise.

---

## 4. When a gate fails

Say what was wrong **sensorially, not technically**. "The rot reads as a blur filter, not as memory
going wrong" is far more useful than "the drift shader alpha is off" — you are the only person who
can judge feel, and the implementation detail is the part the session can work out for itself.

- **Fail:** *"Gate failed on Step 6 — hooding the lantern doesn't lose them. They keep coming
  straight at me. Fix before Step 7."*
- **Partial:** *"Creatures are frightening, but the sabotage never happens — I have never seen the
  woodpile scattered. Retune before continuing."*
- **Pass with a note:** *"Passes. The sniff sound is too frequent, note it for Step 13."* Notes go to
  tuning; they do not block the next step.

Do not carry a failed gate forward. The steps are ordered so that passing gate N is what makes step
N+1 buildable, and a deferred failure compounds.

---

## 5. Commit, push, and pull requests

One commit per step, so a bad step is one `git revert` away.

```bash
git add -A
git commit -m "Step N: <what the step was>"
git push -u origin <branch>
```

If a push fails on a network error, retry with backoff (2s, 4s, 8s, 16s) rather than immediately.
Work on a branch, open a draft PR, and merge to `main` once the gate passes — `main` should only ever
contain steps whose gates have been run.

---

## 6. The headless harness

Build this at Step 6 (`PLAN.md` §2.4), then run it after every subsequent step:

```bash
npm run harness            # 100 unattended runs, scripted director, no players
```

Expected output: median run death between minute 25 and 35, reported with the spread. Run it at every
step from 6 onward — its value is the *trend*. A single run at Step 13 tells you the number; the
trend tells you which step changed it.

---

## 7. Environment notes

### The API key

`ANTHROPIC_API_KEY` is needed only at **Step 10**. Server-side only, loaded from `.env`, and `.env`
must be in `.gitignore` before the key is ever written to disk. It must never reach a client bundle —
this is checked by grepping the built client:

```bash
npm run build
grep -r "sk-ant" packages/client/dist/ && echo "LEAK" || echo "clean"
```

Run that once at Step 10 and once more at Step 13.

### Windows specifics

These are the ones that actually bite on this project:

1. **PowerShell 7+** (`pwsh`). Windows PowerShell 5.1 does not support `&&` and sessions generate
   chained commands constantly. This is the single biggest day-to-day annoyance if skipped.
2. **Long paths** before the first `npm install`: `git config --global core.longpaths true` and
   `LongPathsEnabled=1` in `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`. A three-package
   workspace's `node_modules` exceeds `MAX_PATH`.
3. **Line endings** — `.gitattributes` already sets `eol=lf`. Leave it; it is what keeps GLSL and
   TypeScript diffs from churning.
4. **WSL2**, if you use it at all: keep the repo in the Linux filesystem (`~/ember`), never
   `/mnt/c/...`. Vite's watcher across that boundary is pathologically slow and HMR effectively
   stops. Native Windows is the better fit — it is a browser game, so the dev server and the browser
   want to be on the same OS.

### Two-client testing

Two browser windows on one machine, one normal and one private, is sufficient for every gate. You
only need LAN access and a firewall exception to test with a second person — worth doing once around
Step 8, when voice arrives and a real second human starts to matter.

---

## 8. Useful commands

| | |
|---|---|
| `npm run dev` | Server and client together |
| `npm run dev:server` | Server only, `:8787` |
| `npm run dev:client` | Client only, `:5173` |
| `npm test` | Vitest, including the two-client integration test |
| `npm run test:watch` | Vitest in watch mode while iterating |
| `npm run typecheck` | `tsc --build` across all three packages |
| `npm run build` | Production client bundle |

URL parameters: `?lag=200` simulates latency (this is how you verify prediction), `?name=alice` sets
a display name, `?server=ws://host:8787` points at another machine.

---

## 9. Quick reference — the six rules

From `CLAUDE.md`. A step that appears to require breaking one of these should stop and say so.

1. The server never sends a client anything it cannot see.
2. The LLM never receives raw player positions.
3. Collision reads the true occluder grid, never the memory texture.
4. Client and server run the identical `step()` from `packages/shared`.
5. Listen-mode blips are computed server-side, sent as `{angle, confidence}` only.
6. The scripted director ships permanently as the LLM failure path.

Rules 1, 2 and 3 are architecturally irreversible. The others are recoverable but expensive.
