---
description: Implement one numbered step of the EMBER build plan
---

Read `CLAUDE.md` and `DESIGN.md` §21, then implement **Step $ARGUMENTS** — and nothing else.

Rules:

- Do not start any later step, and do not "prepare" for one.
- Honour the six load-bearing rules in `CLAUDE.md`. If the step seems to require breaking one,
  stop and tell me rather than working around it.
- Every tunable goes in `packages/shared/src/constants.ts`, cross-referenced to its Q-number.
  Never inline a magic number at a call site.
- New systems slot into their numbered stage in the tick order in
  `packages/shared/src/sim/index.ts`. Do not reorder existing stages.
- The client and server must keep running the identical `step()` from `@ember/shared`.
  Never copy sim code across the boundary.
- Run `npm run typecheck` and `npm test`. Both must pass before you finish.
- Commit with a message naming the step.

Then STOP. Tell me exactly what to do in the browser to check this step's Done-when gate, and
describe what a failure would look like as distinct from a pass.
