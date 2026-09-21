# @stardeckai/lgtm 0.3.1 — machine-readable metadata for all 17 `Check` objects

Source: `https://raw.githubusercontent.com/stardeckai/lgtm/main/src/checks/<path>` (branch `main`), fetched with `web_fetch`.
Result: **17/17 fetched, HTTP 200, zero 404s, no alternative paths needed.**
`src/checks/types.ts` also fetched (HTTP 200) and quoted verbatim in §3.

Fields requested: `id`, `threshold`, `high`, flags (`diffOnly`, `optIn`, `invert`, `pinned`), `blurb`, `criteria`.
`instructions` is present and non-empty on all 17 (not quoted here by request; refetchable, or ask for a verbatim dump).

## 1. Compact table

| # | path under `src/checks/` | `id` | `threshold` | `high` | flags present |
|---|---|---|---|---|---|
| 1 | `assertions/would-pass-if-broken.ts` | `would-pass-if-broken` | `0.35` | (absent) | `invert` |
| 2 | `assertions/vacuous-assertion.ts` | `vacuous-assertion` | `0.58` | `0.75` | `pinned` |
| 3 | `assertions/assertion-weaker-than-name.ts` | `assertion-weaker-than-name` | `0.68` | `0.78` | `pinned` |
| 4 | `assertions/tests-calls-not-outcomes.ts` | `tests-calls-not-outcomes` | `0.75` | (absent) | — (none) |
| 5 | `assertions/broad-snapshot.ts` | `broad-snapshot` | `0.35` | (absent) | — (none) |
| 6 | `assertions/swallowed-error-as-success.ts` | `swallowed-error-as-success` | `0.70` | (absent) | — (none) |
| 7 | `mocks/reimplements-logic.ts` | `reimplements-logic` | `0.6` | `0.78` | `pinned` |
| 8 | `mocks/mocks-seam-under-test.ts` | `mocks-seam-under-test` | `0.84` | `0.9` | `pinned`, `invert` |
| 9 | `mocks/mock-mirrors-implementation.ts` | `mock-mirrors-implementation` | `0.55` | (absent) | — (none) |
| 10 | `mocks/over-mocked.ts` | `over-mocked` | `0.55` | (absent) | — (none) |
| 11 | `scope/tests-internals.ts` | `tests-internals` | `0.35` | (absent) | — (none) |
| 12 | `scope/setup-dominates.ts` | `setup-dominates` | `0.70` | (absent) | — (none) |
| 13 | `scope/impossible-fixture.ts` | `impossible-fixture` | `0.50` | (absent) | — (none) |
| 14 | `scope/happy-path-only-of-risky-boundary.ts` | `happy-path-only-of-risky-boundary` | `0.65` | `0.75` | `pinned`, `invert` |
| 15 | `scope/trivial-primitive.ts` | `trivial-primitive` | `0.68` | `0.78` | `pinned` |
| 16 | `diff/regression-does-not-distinguish.ts` | `regression-does-not-distinguish` | `0.35` | (absent) | `diffOnly`, `optIn` |
| 17 | `diff/changed-in-lockstep.ts` | `changed-in-lockstep` | `DEFAULT_THRESHOLD` (exported `0.8`) | (absent) | `diffOnly`, `optIn` |

Literal-value notes:
- Thresholds are written with differing trailing-zero style in the source: `0.35`, `0.58`, `0.68`, `0.75`, `0.35`, `0.70`, `0.6`, `0.84`, `0.55`, `0.55`, `0.35`, `0.70`, `0.50`, `0.65`, `0.68`, `0.35`, `DEFAULT_THRESHOLD`.
- Only file 17 uses the identifier `DEFAULT_THRESHOLD` (`import { DEFAULT_THRESHOLD, type Check } from "../types.js";`); its value is `0.8`.
- `criteria` is present on 16 of 17. The single exception is **#9 `mock-mirrors-implementation.ts`**, which has `id`, `blurb`, `instructions`, `threshold: 0.55` and **no `criteria` property**.
- All 17 use `} satisfies Check;` as the closing form; none annotate with `: Check`.
- `high` values are given absolutely (`0.75`, `0.78`, `0.78`, `0.9`, `0.75`, `0.78`), never as an expression; verified as 6 files with `high` present, 11 absent.

## 2. Per-check `blurb` and `criteria` (verbatim)

### 1. `assertions/would-pass-if-broken.ts` — id `would-pass-if-broken`
- flags: `invert: true`
- blurb: `Remove the behaviour in the name and every assertion stays green: the fixture never reaches that branch. Move it to the failing side.`
- criteria: present
  - true: `The obvious broken version changes at least one asserted value on this fixture, so the test would go red.`
  - false: `Every assertion still holds under the obvious broken version, or there is no assertion this fixture is sure to reach.`

### 2. `assertions/vacuous-assertion.ts` — id `vacuous-assertion`
- flags: `pinned: true` (source comment: `// Pinned under the fitted 0.65; the high line at 0.75 rather than the standard +0.15.`)
- blurb: `The assertion (toBeDefined, truthy, length ≥ 0) accepts wrong output too; pin the exact value a bug would change.`
- criteria: present
  - true: `Every assertion in the block also passes on a realistic wrong result.`
  - false: `An assertion pins an exact value or shape, the error's identity, an existence that is itself the invariant, a comparison against a second real computation a plausible bug would change, or the success of a call whose whole contract is to throw on bad input.`

### 3. `assertions/assertion-weaker-than-name.ts` — id `assertion-weaker-than-name`
- flags: `pinned: true` (source comment: `// Pinned under the fitted 0.90, which one real negative at 0.82 forced; the real positives run from 0.65 up.`)
- blurb: `The name promises a behaviour the assertions never check; assert it, or rename the test to what it proves.`
- criteria: present
  - true: `The name promises a behavior the assertions do not check.`
  - false: `The assertions cover the behavior the name promises.`

### 4. `assertions/tests-calls-not-outcomes.ts` — id `tests-calls-not-outcomes`
- flags: none
- blurb: `It checks that a function was called, not what the call changed; assert the resulting state or output.`
- criteria: present
  - true: `The unit derives a value or selection that no assertion pins; the only evidence is that a double was touched.`
  - false: `The call or its absence is the unit's whole effect, or a concrete result, error or state is pinned.`

### 5. `assertions/broad-snapshot.ts` — id `broad-snapshot`
- flags: none
- blurb: `The assertion is a snapshot of the whole output, so any change re-records it and nobody reads what changed; pin the fields that matter.`
- criteria: present
  - true: `The expected value is a recorded artifact — snapshot, golden file or frozen digest — of output far wider than the behavior the name claims.`
  - false: `No recording is compared (a hand-written literal, an identifier merely named snapshot, or two live values checked against each other), or the recorded value is short enough to read the named behavior off the diff.`

### 6. `assertions/swallowed-error-as-success.ts` — id `swallowed-error-as-success`
- flags: none
- blurb: `The test passes whether the error is thrown, caught or never raised; assert the specific failure by class, code or message.`
- criteria: present
  - true: `An unrelated crash inside the code under test would produce the same result this test asserts.`
  - false: `The asserted result names this failure rather than the neighbouring one — its class, code, status, failing step, echoed reason, attempt count, or a status a sibling running the same fixture without this failure does not return — or it is the declared output of a fail-closed mapping; a sibling pins a non-fallback result from the same unit so a blanket fallback could not stay green; the block drives the accepting path or no failure path at all; or \`expect.assertions(n)\`, a rethrow of unexpected types, or a read-back proving nothing was written forces the failure path.`
  - (in source, the `false:` value is written on a continuation line after the key; the string value itself has no newline)

### 7. `mocks/reimplements-logic.ts` — id `reimplements-logic`
- flags: `pinned: true` (source comment: `// Pinned under the fitted 0.85: one dogfood drift guard at 0.77 is the only real negative above 0.5, and the / real positives sit from 0.6 up. High at 0.78 keeps that guard just under the line.`)
- blurb: `The expected value is computed with the same logic as production, so both can be wrong together; write the expected value by hand.`
- criteria: present
  - true: `The expected side of an assertion is produced by the production algorithm or a copy of it.`
  - false: `Expected values are literals or requirement-derived examples; production code only built inputs, or the assertion is a parity, property or drift guard.`

### 8. `mocks/mocks-seam-under-test.ts` — id `mocks-seam-under-test`
- flags: `pinned: true`, `invert: true` (source comment: `// Pinned under the fitted 0.95: catches 7 of 10 real positives and fires on 2 of 25 real negatives, both the / "stub feeds a fact the real code carries" shape the labels and the model disagree on. Six variants this round / (see iterations.json); the next lever is a harvest of real positives, not more wording.`)
- blurb: `The collaborator that decides this behaviour is a mock, so the test proves the mock's script, not the code; use the real one here.`
- criteria: present
  - true: `The collaborator that decides the named behaviour runs for real and an assertion depends on what it did.`
  - false: `The deciding collaborator is a scripted mock, so the assertion only reads back what the mock was told.`

### 9. `mocks/mock-mirrors-implementation.ts` — id `mock-mirrors-implementation`
- flags: none
- blurb: `The mock re-encodes the production logic, so an implementation that agrees with the copy passes even when both are wrong; use the real collaborator or fixed data.`
- criteria: **ABSENT** — the object literal has no `criteria` key at all (only `id`, `blurb`, `instructions`, `threshold: 0.55`).
- Note: `instructions` here is a single question sentence, much shorter than the other checks': `Does the mock setup in \`test_code\` or \`file_context\` duplicate \`implementation\` so closely that the test proves almost nothing about the real code?`

### 10. `mocks/over-mocked.ts` — id `over-mocked`
- flags: none
- blurb: `Every asserted value came out of a fake; the only real code left is glue between stubs. Fake fewer collaborators, or test the integration.`
- criteria: present
  - true: `The collaborators that make the promised decisions are all fakes; only glue between them runs for real.`
  - false: `A real collaborator or the entry point decides an asserted value, or the swapped module is a real test store.`

### 11. `scope/tests-internals.ts` — id `tests-internals`
- flags: none
- blurb: `It asserts private state, class names or call order rather than observable behaviour, so a refactor breaks it and a bug does not; assert the output.`
- criteria: present
  - true: `The asserted value is reachable only by peeking at internals, and the contract surface goes unasserted.`
  - false: `The asserted value is a return, thrown error, rendered text/role/state, persisted state, or a payload, argument or count recorded at a collaborator or injected boundary.`

### 12. `scope/setup-dominates.ts` — id `setup-dominates`
- flags: none
- blurb: `Most of the setup never reaches the assertion; cut it to what the assertion depends on, or assert more of it.`
- criteria: present
  - true: `This block builds its own bulky fixture and most of its fields, rows or stubs are never touched by the exercised path.`
  - false: `The bulky mocks or fixtures are file-level and shared with sibling blocks, or the path reads what is built, or the block owns only a few lines of setup.`
  - (in source, the `false:` value is written on a continuation line after the key)

### 13. `scope/impossible-fixture.ts` — id `impossible-fixture`
- flags: none
- blurb: `The fixture is a state production validation could never produce, so the branch it exercises cannot happen; build it through the real constructor or validator.`
- criteria: present
  - true: `A rule you can name in \`implementation\` forbids the fixture state, the fixture reaches code past that rule without the rule running, and the asserted behaviour depends on it.`
  - false: `The fixture is the bad input the rule under test is asked to reject, or no rule can be named: production writes this state too, or the impossible part is never read.`

### 14. `scope/happy-path-only-of-risky-boundary.ts` — id `happy-path-only-of-risky-boundary`
- flags: `pinned: true`, `invert: true` (source comment: `// Pinned under the fitted 0.80, which one real negative at 0.71 forces (an it.each sibling covers its refusals / and the rows never reach the model; see TODO.md). Real positives run 0.70–0.80.`)
- blurb: `The refusal path this code exists for (the reject, the limit, the wrong tenant) has no test here or among its siblings; add one.`
- criteria: present
  - true: `This block or a sibling drives the riskiest refusal in the implementation, or there is no refusal branch to miss.`
  - false: `Every block, this one and the siblings, stays on the allowed path; the riskiest refusal is driven by none of them.`

### 15. `scope/trivial-primitive.ts` — id `trivial-primitive`
- flags: `pinned: true` (source comment: `// Pinned under the fitted 0.90: the real positives run from 0.7 up and the real negatives top out under 0.6.`)
- blurb: `A one-line helper tested on its own; any real test of the feature that uses it would catch the same break. Delete it, or test the feature.`
- criteria: present
  - true: `A one-liner with no subtle edge cases, already exercised by any real test of the feature.`
  - false: `The behavior has edge cases worth pinning on their own — money or rounding, parsing, dates and time zones, encoding, or a security or permission path.`

### 16. `diff/regression-does-not-distinguish.ts` — id `regression-does-not-distinguish`
- flags: `diffOnly: true`, `optIn: true` (source comment: `// Off by default (Sept 2026): the corpus has no real case for the diff checks, so the threshold is fitted on / synthetic ones only. On a 584-test customer branch this family was 102 of 187 flagged findings and 42 of 54 / high-confidence ones, with a median score at the threshold. Back on after a PR-based harvest (see TODO.md).`)
- blurb: `This regression test also passes on the pre-fix code, so it does not lock the fix; assert the value the bug got wrong.`
- criteria: present
  - true: `Every assertion in this test also holds against the pre-change code in \`diff\`.`
  - false: `An assertion fails against the pre-change code, or \`diff\` only adds code that did not exist before.`

### 17. `diff/changed-in-lockstep.ts` — id `changed-in-lockstep`
- threshold: literal identifier `DEFAULT_THRESHOLD` → `0.8`
- flags: `diffOnly: true`, `optIn: true` (same 3-line comment as #16)
- blurb: `The expected values changed in the same diff as the code that produces them, so the test may only mirror the new behaviour; derive them from the requirement.`
- criteria: present
  - true: `The test's expectations were edited to match the new implementation output.`
  - false: `The test expresses a requirement that was decided independently of the implementation change.`
- Full source: §4.

## 3. `src/checks/types.ts` (verbatim, HTTP 200)

```ts
export type Check = {
  id: string;
  /** the glyph after the 😐 face for this check */
  /** the one-liner printed under a finding, in --list-checks and in the Claude skill */
  blurb: string;
  instructions: string;
  criteria?: { true: string; false: string };
  threshold: number;
  /** the high-confidence line, when it is not threshold + the standard margin (see report.ts CERTAIN_MARGIN) */
  high?: number;
  /** set by hand and left alone by `pnpm eval --fit-thresholds --write`; say why in a comment next to it */
  pinned?: true;
  /** the instructions ask the opposite question (is the test sound?) and the answer is flipped: Jev is
   *  conservative on "yes", so a check phrased as "does this test catch the break?" puts its confident answers
   *  on the sound tests and the smell score is 1 − that. */
  invert?: true;
  /** only sent when `diff` is part of the state */
  diffOnly?: true;
  /** off unless named in --only: the corpus has no real case for it yet, so its threshold is a guess. The eval
   *  runner still scores it (AnalyzeOptions.optIn). Say why in a comment next to it. */
  optIn?: true;
};

export const DEFAULT_THRESHOLD = 0.8;
```

Shape deltas vs. the type text in the task prompt (comments aside, the prompt's shape is accurate):
- The real file carries an extra leading doc comment `/** the glyph after the 😐 face for this check */` immediately before the `blurb` doc comment.
- Property order is exactly: `id`, `blurb`, `instructions`, `criteria?`, `threshold`, `high?`, `pinned?`, `invert?`, `diffOnly?`, `optIn?` — matching the prompt.
- `DEFAULT_THRESHOLD = 0.8` confirmed exactly (line after the type, no trailing comment).

## 4. `src/checks/diff/changed-in-lockstep.ts` — full source verbatim (HTTP 200)

```ts
import { DEFAULT_THRESHOLD, type Check } from "../types.js";

export default {
  id: "changed-in-lockstep",
  blurb: "The expected values changed in the same diff as the code that produces them, so the test may only mirror the new behaviour; derive them from the requirement.",
  instructions:
    "Procedure. 1. Look at the test file's side of `diff`. If it is all additions — no removed (`-`) assertion line — nothing was rewritten to match the implementation: answer no. 2. Otherwise pair each edited expectation with the implementation line in `diff` that produces it. Answer yes when an expected literal that already existed was rewritten to the new output, so the test now records the change instead of requiring it. Answer no when the asserted values are unchanged and only the call shape, signature or types moved, or when the expectation states a requirement decided independently of the implementation.",
  criteria: {
    true: "The test's expectations were edited to match the new implementation output.",
    false: "The test expresses a requirement that was decided independently of the implementation change.",
  },
  threshold: DEFAULT_THRESHOLD,
  diffOnly: true,
  // Off by default (Sept 2026): the corpus has no real case for the diff checks, so the threshold is fitted on
  // synthetic ones only. On a 584-test customer branch this family was 102 of 187 flagged findings and 42 of 54
  // high-confidence ones, with a median score at the threshold. Back on after a PR-based harvest (see TODO.md).
  optIn: true,
} satisfies Check;
```

(Note: the task brief named `assertions/mocks-seam-under-test.ts`, which does not exist; the real path is `mocks/mocks-seam-under-test.ts` — fetched successfully, §2 item 8. No 404 occurred on any of the 17 listed paths.)
