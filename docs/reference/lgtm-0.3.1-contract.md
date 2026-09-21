# `@stardeckai/lgtm@0.3.1` — machine-readable contract

Provenance: `main` tree sha `e6c05cec9b5a68623aa430d7abd52e16b18d2d01`; every `src/*.ts` blob sha is **identical at tag `v0.3.1` and `main`**, and `package.json` on main declares `"version": "0.3.1"` → source below is the 0.3.1 source.
`package.json`: `"type": "module"`, `"bin": {"lgtm": "dist/cli.js"}`, `"files": ["dist","skills"]`, `"engines": {"node": ">=20"}`, deps `@babel/parser ^7.25.0`, `@typesafe-ai/sdk ^0.6.0`.

---

## 1. Environment variables

Complete set of `process.env` reads in shipped code (`files: ["dist","skills"]`; `dist` is compiled from `src`):

| Var | File | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | `src/init.ts` (2 sites) | the API key |
| `NO_COLOR` | `src/report.ts` | disable ANSI |
| `FORCE_COLOR` | `src/report.ts` | force ANSI |
| `LGTM_DEBUG` | `src/analyze.ts` | warn on state trimming |

`TYPESAFE_API_KEY` — **yes**, read. `OPENROUTER_API_KEY` — **no, not read anywhere.** No other provider key is read.

`src/init.ts` (verbatim):

```ts
/** Key from the environment, else the global config file. */
export function resolveApiKey(home: string = os.homedir()): string | undefined {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try {
    return JSON.parse(fs.readFileSync(configPath(home), "utf8")).apiKey ?? undefined;
  } catch {
    return undefined;
  }
}
```

```ts
  let key = opts.key;
  if (!key && process.env.TYPESAFE_API_KEY) {
    console.log("TYPESAFE_API_KEY is already set in the environment — keeping it, not writing a config file.");
  } else if (!key) {
    key = await askKey();
  }
  if (key) written.push(saveKey(key, home));
```

`src/report.ts`:
```ts
const COLOR = !process.env.NO_COLOR && (Boolean(process.env.FORCE_COLOR) || Boolean(process.stdout.isTTY));
```
`src/analyze.ts`:
```ts
      if (trims.length > 0 && process.env.LGTM_DEBUG) {
```

**Precedence (runtime): `TYPESAFE_API_KEY` > `~/.config/lgtm/config.json`.**
Locked by `src/init.test.ts`: `it("prefers the environment key over the config file")`.
**Precedence (when writing): `--key <v>` / positional `key <v>` > env > prompt.** With `--key` given, the config file *is* written even if the env var is set.

**Transitive (SDK) env vars.** The pinned `@typesafe-ai/sdk` `v0.6.0` `src/env.ts` (blob sha `3a51939b…`, identical on main) reads four vars — none is a non-TypeSafe provider key:
```ts
export const ENV = {
  /** Required API key; used when `apiKey` is omitted. */
  apiKey: "TYPESAFE_API_KEY",
  /** API root; defaults to `https://api.typesafe.ai`. */
  baseURL: "TYPESAFE_BASE_URL",
  /** Default model name; defaults to `jev-latest`. */
  defaultModel: "TYPESAFE_DEFAULT_MODEL",
  /** Log level; defaults to `warn`. */
  logLevel: "TYPESAFE_LOG_LEVEL",
} as const;
```
`TYPESAFE_BASE_URL` is therefore a real, supported override of the endpoint for a wrapper (lgtm itself constructs `new TypeSafeClient({ apiKey, timeout: 60_000 })` and does not set `baseURL`).

---

## 2. Config file

`src/init.ts`:
```ts
export const configPath = (home: string = os.homedir()) => path.join(home, ".config", "lgtm", "config.json");
```
**Absolute path: `$HOME/.config/lgtm/config.json`. `XDG_CONFIG_HOME` is NOT consulted** — it is `os.homedir()` + literal `.config`.

```ts
/** Write (or replace) the saved key; returns the config path. `lgtm key` uses this directly. */
export function saveKey(key: string, home = os.homedir()): string {
  const config = configPath(home);
  fs.mkdirSync(path.dirname(config), { recursive: true, mode: 0o700 });
  fs.writeFileSync(config, JSON.stringify({ apiKey: key }, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(config, 0o600);
  return config;
}
```
- Schema: exactly `{ "apiKey": "<string>" }`, pretty-printed 2-space, trailing newline. `src/init.test.ts` locks it: `expect(JSON.parse(...)).toEqual({ apiKey: "sk-test-123" })`.
- Mode: file `0o600`, parent dir `0o700`; `chmodSync` reapplied so an existing file is re-tightened. Asserted: `expect(fs.statSync(configPath(home)).mode & 0o777).toBe(0o600);`
- Rewritten wholesale by `lgtm key <v>` / `lgtm init --key <v>` — no merge, no other keys are preserved.

**What `lgtm init` writes** (`src/init.ts` `init()`): (1) the config file, only if a key came from `--key` or the prompt — **not** when `TYPESAFE_API_KEY` is set in the env; (2) skill files, depending on mode (see §3). Returned array is printed as `wrote <file>` lines.

Other on-disk state:
- `$HOME/.config/lgtm/usage.jsonl` — JSONL, one `Run` per line: `export type Run = { at: string; tokens: number; worktree?: string };` (`src/usage.ts`), appended best-effort from a `finally` in `src/cli.ts`.
- Cache: `src/cli.ts`:
```ts
function cacheDir(): string {
  const local = path.join(process.cwd(), "node_modules");
  const base = fs.existsSync(local) ? local : os.tmpdir();
  return path.join(base, ".cache", "lgtm");
}
```
Key (`src/analyze.ts`): `sha256(JSON.stringify(state) + questions + JSON.stringify(TEST_CLASSES) + MODEL_TAG + VERSION)` where `MODEL_TAG = "jev-latest"`, `VERSION` = package version, and `questions = checks.map(c => c.id + c.instructions + JSON.stringify(c.criteria ?? null)).join(",")`. Files are `<hash>.json` holding the raw answers map. `--no-cache` sets `cacheDir: undefined`, disabling reads *and* writes.
- `<cwd>/.lgtmignore` (gitignore-style, one pattern per line, `#` comments) — `src/ignore.ts`.

---

## 3. Subcommands, flags, and `init --skill none`

Every option is parsed once by `node:util` `parseArgs` (`strict` default true → **an unknown flag throws → top-level handler → exit 2**):

| Flag | Type | Effect |
|---|---|---|
| `--key <value>` | string | `init`: use this key instead of prompting |
| `--skill <where>` | string | `init`/`skill`: `global\|project\|claude\|none`; invalid → stderr + exit 2 |
| `--yes` | boolean | skip confirm prompt; `init`/`skill` default to `global` |
| `--diff [base]` | string | only changed tests; bare normalized to `--diff=` by `normalizeDiffFlag` |
| `--diff-all-blocks` | boolean | with `--diff`, all blocks of a changed file |
| `--threshold <0..1>` | string | override every check's threshold; out of range → exit 2 |
| `--only <ids,…>` / `--skip <ids,…>` | string | check selection; unknown id → exit 2 |
| `--format <fmt>` | string, default `text` | `text\|github\|json`; other → exit 2 |
| `--concurrency <n>` | string | parallel requests, default 4 |
| `--no-impl` | boolean | don't send implementation source |
| `--lean` | boolean | 8k impl, no test file/guidelines |
| `--no-cache` | boolean | ignore the answer cache |
| `--fail` | boolean | exit 1 if any finding is high-confidence |
| `--fail-on-error` | boolean | exit 1 if any block was skipped by an API error |
| `--ignore <pattern>` | string, `multiple: true` | repeatable; merged with `.lgtmignore` |
| `--dry-run` | boolean | plan only, calls nothing, no key needed |
| `--json` | boolean | **only** meaningful with `--dry-run`: dumps raw states |
| `--classes` | boolean | text format only: one line per test with its class |
| `--verbose` | boolean | also report 0.5→threshold findings |
| `--list-checks` | boolean | print checks and exit 0 |
| `--help` | boolean | print USAGE and exit 0 (not listed in USAGE text) |

Subcommands, dispatched on `positionals[0]` **before** the target guard:

| Command | Flags used | Behaviour (verbatim dispatch) |
|---|---|---|
| `init` | `--key`, `--skill`, `--yes` | `await init({ key: values.key, skill, yes: values.yes })`; prints `wrote <file>` per file, then `😐👍  You're set. Run: lgtm --diff`; exit 0 |
| `skill` | `--skill`, `--yes` | `installSkill(skill ?? (values.yes ? "global" : await askSkillMode()))`; prints `wrote <file>`; exit 0 |
| `usage` | — | `usageReport(Date.now(), worktreeRoot())`; all time / last day / last week / this worktree; exit 0 |
| `clear-cache` | — | `fs.rmSync(cacheDir(), {recursive:true, force:true})`; prints `cleared N cached answer(s) from <dir>`; exit 0 |
| `key [value]` | `--key` | `positionals[1] ?? values.key ?? await askKey()`; empty → stderr `No key given. Run: lgtm key <value>` + exit 2; else writes config + `Key swapped.` |
| *(none)* | all run flags | analyze path. `positionals.length === 0 && values.diff === undefined` → prints USAGE on **stdout** + exit 2 |

### `lgtm init --skill none`, step by step

`skill` is validated (`SKILL_MODES.includes`) → `"none"` is dispatched to `init()`:

1. `home = os.homedir()`, `written = []`.
2. `key = opts.key` (the `--key` value, else `undefined`).
3. If `!key && process.env.TYPESAFE_API_KEY` → logs `TYPESAFE_API_KEY is already set in the environment — keeping it, not writing a config file.` and **writes nothing**.
   Else if `!key` → `await askKey()` (stdin prompt).
4. `if (key) written.push(saveKey(key, home))`.
5. `mode = opts.skill ?? …` → `"none"`.
6. `installSkill("none", …)`:
```ts
export function installSkill(mode: SkillMode, opts: {...} = {}): string[] {
  if (mode === "none") return [];
```
7. Back in `main()`: `for (const file of await init(...)) console.log(\`wrote ${file}\`)` then `console.log("😐👍  You're set. Run: lgtm --diff")`, `return 0`.

Sequences: env key set + `--skill none` → zero files, only the "already set" line and "You're set"; exit 0.
`--key X --skill none` → writes `~/.config/lgtm/config.json` only; `src/init.test.ts` locks `expect(written).toEqual([configPath(home)])` and that no skill file exists in `$HOME` or cwd.

### Does `init --skill none` block on stdin when `TYPESAFE_API_KEY` is set? **No.**

Every stdin read goes through one of exactly two functions, both in `src/init.ts`, and neither is reached:

```ts
/** Prompt for a key unless one was given. */
export async function askKey(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const key = (await rl.question("Paste your TypeSafe API key (https://typesafe.ai): ")).trim();
  rl.close();
  return key;
}
```
```ts
export async function askSkillMode(): Promise<SkillMode> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const yes = (await rl.question("Install the /lgtm and /actually-test skills for your coding agents? [Y/n] "))
      .trim()
      .toLowerCase();
    if (yes.startsWith("n")) return "none";
    const where = (await rl.question("Where? (g)lobal for every project / (p)roject only [g] ")).trim().toLowerCase();
    return where.startsWith("p") ? "project" : "global";
  } finally {
    rl.close();
  }
}
```
`askKey` is skipped by the env branch; `askSkillMode` is skipped because `opts.skill === "none"` short-circuits `??`. `installSkill("none")` returns before any `spawnSync`. No `readline` interface is ever created. **Fully non-interactive.**

Contrast — the blocking risks that *do* exist:
- `lgtm init --yes` with no `--key` and no env var → still calls `askKey()` (`--yes` does not cover the key prompt).
- `lgtm init --yes` (or `lgtm skill --yes`) → mode `global` → `spawnSync("npx", ["-y","skills","add", <pkgRoot>/skills, "-g"], { stdio: "inherit", cwd })` — the `skills` CLI prompts, and stdio is inherited, so it can block on stdin. Non-zero exit falls back to writing files directly.
- `--skill claude` → `writeSkillFiles(home)` only, no spawn.
- `--skill project` → same `npx` call *without* `-g`, cwd = `process.cwd()`.

---

## 4. Non-interactive behaviour

`--yes` suppresses exactly two things: the run confirmation, and the `init`/`skill` skill-mode prompt (defaulting to `global`). It does **not** suppress `askKey()`.

`src/cli.ts` (verbatim, after the plan is printed and after `--dry-run` has already returned):
```ts
  // The plan always prints; on json/github it goes to stderr so stdout stays machine-readable.
  printPlan(jobs, files, selection?.label, opts, values["dry-run"] || format === "text" ? console.log : console.error);
  if (values["dry-run"]) return 0;
  if (!values.yes) {
    if (!process.stdin.isTTY) {
      console.error(c("dim", "\nnot a terminal — pass --yes to run, or --dry-run to only estimate"));
      return 0;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("\nRun? [Y/n] ")).trim().toLowerCase();
    rl.close();
    if (answer && answer !== "y" && answer !== "yes") return 0;
    console.log("");
  }
```

**The guard tests `process.stdin.isTTY`, not stdout.** Consequences for a wrapper:
- stdin not a TTY, no `--yes` → message on **stderr**, **nothing on stdout**, **exit 0**. This is indistinguishable from a clean run by exit code alone — always pass `--yes`.
- stdin *is* a TTY, stdout piped, no `--yes` → it **will prompt interactively** and then write JSON to stdout. Pass `--yes` *and* give the child a non-TTY stdin (e.g. `stdio: ['ignore','pipe','pipe']`).
- Default answer is **yes**: an empty line (bare Enter) runs. Only an explicit non-`y`/`yes` answer aborts, and that path also exits 0.
- On an interactive "yes", `console.log("")` emits a leading `"\n"` on **stdout** before the report. With `--yes`, stdout is exactly the report/JSON.
- `--dry-run` returns before this block, so `--dry-run` is always safe and needs no key.
- The plan is printed to stdout in `text` mode and to **stderr** in `json`/`github` modes, so piped stdout stays parseable.

---

## 5. `--format json` schema

Serializer, `src/report.ts` (`formatReport`, json branch, verbatim):
```ts
  if (format === "json") {
    // Explain each check once, under `checks`, so findings stay one line each.
    const used = [...new Set(rows.map((f) => f.checkId))];
    const checks = Object.fromEntries(
      used.map((id) => {
        const check = BY_ID.get(id);
        return [id, { emoji: GESTURE[CATEGORY_OF[id] ?? "scope"], blurb: check?.blurb, threshold: check?.threshold, explanation: EXPLANATIONS[id] }];
      }),
    );
    return JSON.stringify({ findings: rows, checks, ...summary, distribution: distribution(summary.classes) }, null, 2);
  }
```
`summary` is built by `src/cli.ts` (verbatim):
```ts
  console.log(
    formatReport(result.findings, format, {
      classes: result.classes,
      tests: jobs.length,
      files: new Set(jobs.map((j) => j.block.file)).size,
      skipped: result.skipped,
      inputTokens: result.inputTokens,
      durationMs,
      verbose: Boolean(values.verbose),
    }),
  );
```

Types, verbatim:

`src/report.ts`:
```ts
export type Summary = {
  tests: number;
  files: number;
  skipped: number;
  inputTokens: number;
  /** wall-clock time spent in analyze(); 0 when nothing ran */
  durationMs: number;
  classes: Classified[];
  /** --verbose: also print each finding's probability. Off by default: a 0.64 next to a smell reads as a
   *  confidence, but it is a score against a fitted cut-off that moves ±0.1 between runs of the same state. */
  verbose?: boolean;
};
```

`src/analyze.ts`:
```ts
export type Finding = {
  file: string;
  line: number;
  name: string;
  checkId: string;
  probability: number;
  /** the threshold this finding was judged against, so the report can rank it */
  threshold: number;
  /** the check's own high-confidence line, when it overrides the standard margin */
  high?: number;
};
```
```ts
/** What kind of test a block is, per the `test_class` choice question. */
export type Classified = { file: string; line: number; name: string; testClass: TestClass };
```
```ts
export type AnalyzeResult = {
  findings: Finding[];
  classes: Classified[];
  skipped: number;
  inputTokens: number;
  /** model that answered the live requests; undefined when every answer came from cache */
  model?: string;
};
```

`src/extract.ts` (source of `file`/`line`/`name`/`endLine`):
```ts
export type TestBlock = {
  file: string;
  line: number;
  name: string;
  describePath: string[];
  /** exact source slice of the whole it(...) call */
  code: string;
  /** last line of the it(...) call, 1-based and inclusive */
  endLine: number;
};
```

### Top-level object — exact keys, in serialization order

```
{
  "findings": Finding[],          // sorted: file (localeCompare) → line asc → probability desc
  "checks":   { [checkId]: { emoji, blurb, threshold, explanation } },
  "classes":  Classified[],
  "tests":    number,             // = jobs.length, i.e. test BLOCKS sent (called "test cases" in text)
  "files":    number,             // distinct test files
  "skipped":  number,             // blocks skipped by APIError/APIConnectionError
  "inputTokens": number,
  "durationMs": number,           // analyze() wall clock only; 0 if nothing ran
  "verbose":  boolean,
  "distribution": string          // e.g. "1 contract-integration · 2 mocked-seam · 3 pure-logic"
}
```
Key order is `findings, checks,` then the `summary` literal's order `classes, tests, files, skipped, inputTokens, durationMs, verbose,` then `distribution`. `JSON.stringify(..., null, 2)` — pretty-printed, 2 spaces, followed by `console.log`'s newline.

### Nested shapes and literal field names

- Per-finding entries — `findings[i]`: `file`, `line`, `name`, `checkId`, `probability`, `threshold`, `high` (optional).
  - **file path** → `file` (path relative to `process.cwd()`, as produced by `discover()`'s `path.relative(process.cwd(), path.resolve(f))`).
  - **line number** → `line` (1-based, the `it(...)` call's `loc.start.line`).
  - **test/block name** → `name` (the literal/`StringLiteral`/template first argument; template holes become `${…}`). The `describe` path is **not** in JSON (it only exists in `state.describe_path` of `--dry-run --json`).
  - **check id** → `checkId`.
  - **confidence/probability score** → `probability` (a rounded 2-dp number, 0–1; for `invert` checks it is `Math.round((1 - raw) * 100) / 100`). `threshold` is the *effective* threshold (`opts.threshold ?? check.threshold`).
  - **"worth a look" vs "high confidence" status** → **there is no such field.** It is derived; see below.
- `checks` map — only the check ids that actually fired (`used = [...new Set(rows.map(f => f.checkId))]`); `{}` when there are no findings. Per entry: `emoji` (the **family** gesture, e.g. `"😐👏"`), `blurb` (string), `threshold` (the check's **static** threshold — note it ignores `--threshold` while `findings[i].threshold` honours it), `explanation` (from `EXPLANATIONS`, quoted verbatim in `src/checks/explanations.ts`).
- `classes[i]`: `file`, `line`, `name`, `testClass` ∈ `"contract_integration" | "mocked_seam_unit" | "pure_logic"` (`src/checks/classes.ts`). **Order is not deterministic** — entries are pushed as concurrent workers finish (`classes.push(...)` inside `run`), unlike the sorted `findings`.
- Per-file grouping: **no grouped structure in JSON.** Findings are a flat array; grouping exists only in the text renderer (`blocks()`, keyed by `` `${f.file}:${f.line}` ``). Group by `file` client-side.
- Summary/verdict: `tests`, `files`, `skipped`, `distribution` — the human verdict strings (`😐👍 …`, `😐🫵 …`, `😐🤞 …`) are **text-only and absent from JSON**. Recompute if needed.
- Token usage: `inputTokens` (input only; output tokens are free).
- Cost: **not in JSON.** `src/checks/index.ts`:
```ts
/** TypeSafe list price for jev-latest: $0.042 per million input tokens, output tokens are free. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const usd = (inputTokens: number) => `$${(inputTokens * USD_PER_INPUT_TOKEN).toFixed(4)}`;
```
  Cost = `inputTokens * 0.042 / 1e6`. Cached blocks contribute 0 tokens.
- Duration: `durationMs` (ms, integer-ish) — measured as `Date.now() - startedAt` around `analyze()` only, excluding arg parsing, discovery, state building, planning and reporting.
- Model: `AnalyzeResult.model` exists internally but is **not passed into `summary`**, so no model field appears in JSON.

### Deriving the status (verbatim, `src/report.ts`)
```ts
/** A finding at or above its threshold — as opposed to a --verbose "suspicious" one. */
export const real = (f: Finding) => f.probability >= f.threshold;

/**
 * How far above its threshold a finding must sit to count as proven. Measured on identical states sent five
 * times, 97% of answers move less than 0.10 between runs, so the band just over the line is where a keeper
 * can land on a bad draw; three steps up it cannot.
 */
export const CERTAIN_MARGIN = 0.15;
/** A finding well clear of its threshold: the ones the verdict counts and --fail blocks on. */
export const highLine = (threshold: number, high?: number) => high ?? Math.min(0.95, threshold + CERTAIN_MARGIN);
export const certain = (f: Finding) => real(f) && f.probability >= highLine(f.threshold, f.high);
```
So: **high confidence** = `probability >= (high ?? Math.min(0.95, threshold + 0.15))`; **worth a look** = `probability >= threshold && !highConfidence`; **suspicious** (`--verbose` only) = `probability >= Math.min(0.5, threshold)` and `probability < threshold`. Note `high` is only emitted when the check defines one *and* `--threshold` was not passed — after `--threshold`, recompute with the standard `+0.15` margin.

### JSON-mode gotchas
- `distribution` is built with the ANSI styler: `` `${c("green", …)} · ${c("yellow", …)} · ${c("dim", …)}` ``. `COLOR` is true when `FORCE_COLOR` is set **or** `process.stdout.isTTY`. So with a TTY stdout (or `FORCE_COLOR=1`) **escape codes land inside the JSON string**. Set `NO_COLOR=1` (or keep stdout piped) when parsing.
- `--dry-run --json` is a **different schema** (array of `{file, line, questions: string[], state: object}`), not `--format json`:
```ts
    console.log(JSON.stringify(jobs.map((job) => ({
      file: job.block.file,
      line: job.block.line,
      questions: [...checksFor(job.state, opts, job.touched).map((c) => c.id), "test_class (choice)"],
      state: job.state,
    })), null, 2));
```
- `--format github` emits `::warning file=<f>,line=<l>::[<checkId>] <name>` for `certain` and `::notice …` for the worth-a-look band; sub-threshold (`--verbose`) findings emit nothing. Empty string when nothing qualifies.
- `--verbose` widens the *finding* set (probability ≥ `Math.min(0.5, threshold)`), so `findings` can contain sub-threshold rows; the threshold logic above still classifies them.

### The 17 checks (ids, static thresholds, high lines)
`high` "—" means absent → `min(0.95, threshold + 0.15)`. All are `satisfies Check` (`src/checks/types.ts`).

| check id | threshold | high | flags |
|---|---|---|---|
| `would-pass-if-broken` | 0.35 | — | invert |
| `vacuous-assertion` | 0.58 | 0.75 | pinned |
| `assertion-weaker-than-name` | 0.68 | 0.78 | pinned |
| `tests-calls-not-outcomes` | 0.75 | — | |
| `broad-snapshot` | 0.35 | — | |
| `swallowed-error-as-success` | 0.70 | — | |
| `reimplements-logic` | 0.6 | 0.78 | pinned |
| `mocks-seam-under-test` | 0.84 | 0.9 | pinned, invert |
| `mock-mirrors-implementation` | 0.55 | — | (no `criteria`) |
| `over-mocked` | 0.55 | — | |
| `tests-internals` | 0.35 | — | |
| `setup-dominates` | 0.70 | — | |
| `impossible-fixture` | 0.50 | — | |
| `happy-path-only-of-risky-boundary` | 0.65 | 0.75 | pinned, invert |
| `trivial-primitive` | 0.68 | 0.78 | pinned |
| `regression-does-not-distinguish` | 0.35 | — | diffOnly, optIn |
| `changed-in-lockstep` | `DEFAULT_THRESHOLD` = 0.8 | — | diffOnly, optIn |

`src/checks/types.ts` verbatim:
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
Family gestures (`CATEGORY_OF` + `GESTURE` in `src/checks/index.ts`): assertions `😐🤏`, mocks `😐👏`, scope `😐🤌`, diff `😐🫸`. Check **order** is locked by `src/checks/index.test.ts` `ORDER` and is the order of `CHECKS`, `--list-checks`, the README table and the skill.

---

## 6. Exit codes

Written via `process.exitCode`, never `process.exit()`:
```ts
// exitCode, not exit(): exit() drops piped stdout past ~64 KB (json output into a pipe).
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err);
    process.exitCode = 2;
  },
);
```

| Code | Sites (all in `src/cli.ts` unless noted) |
|---|---|
| **0** | successful run; `--help`; `init`/`skill`/`usage`/`clear-cache`/`key` success; `--list-checks`; `--dry-run`; `jobs.length === 0` → stderr `no test blocks found in N file(s)` (still 0); **not a terminal without `--yes`**; user answered non-yes at the prompt |
| **1** | `if (values.fail && result.findings.some(certain)) return 1;` and `if (values["fail-on-error"] && result.skipped > 0) return 1;` |
| **2** | no target and no `--diff` (USAGE on stdout); invalid `--skill`; `--format` not `text\|github\|json`; unknown check id in `--only`/`--skip`; `--threshold` outside 0..1; no API key → `No API key. Run: lgtm init`; `AuthenticationError` → `TypeSafe rejected the API key. Run: lgtm init`; `key` with no value; unknown flag (`parseArgs` strict throws); any other unhandled rejection — e.g. `--diff` on an unknown ref or with no default branch found, which throws out of `diffSelection` |

`--fail` and `--fail-on-error` only ever turn 0 into 1; they never raise 2, and 2 always wins if it happens first (`--fail` is evaluated last, after the report is printed).

**`--fail` is narrower than the README implies**: the code is `result.findings.some(certain)` — only findings at/above the high-confidence line. The "worth a look" band (threshold ≤ p < threshold+0.15) does **not** trip it, nor does `--verbose` widen it (`certain` requires `real(f)`). `--fail-on-error` keys off `skipped`, which counts only `APIError`/`APIConnectionError` blocks (`AuthenticationError` rethrows → exit 2).

Assessment note: exit 0 on "not a terminal, nothing ran" is the single most dangerous behaviour for a wrapper. Pair it with an empty-stdout check.

---

## 7. Minimum Node version and runtime prerequisites

- **Node `>=20`** (`package.json` `engines`; the SDK README likewise says "Node.js 20 or newer"). Node 20 is genuinely required: `styleText` from `node:util` (used by `c()` in `src/report.ts`) landed in 20.12. ESM only (`"type": "module"`).
- **`git` on PATH** — required for `--diff` (`gitRun`/`tryGit` in `src/analyze.ts`: `rev-parse --verify --quiet`, `merge-base`, `rev-parse --show-toplevel`, `diff --name-only`, `ls-files --others --exclude-standard`, `diff -U0`, `diff`, `ls-files`, `diff --no-index`). Also used best-effort by `worktreeRoot()` for `lgtm usage` attribution (failure is caught → `undefined`). `repoGuidelines()` walks up to the first `.git` (dir or file) for `CLAUDE.md`/`AGENTS.md`/`CONTRIBUTING.md`/`.cursorrules`/`TESTING.md`.
  - `--diff` needs real history: CI must `fetch-depth: 0`; with no default branch found it throws `--diff: no default branch found (tried origin/HEAD, origin/main, main, master) — pass --diff <ref>` → exit 2.
- **`npx` on PATH** for `init`/`skill` with `--skill global|project` (runs `npx -y skills add <pkgRoot>/skills [-g]`, `stdio: "inherit"`); a missing/failing `npx` falls back to writing `SKILL.md` files directly.
- **What counts as a test file, and what counts as a test block** — two separate gates, and failing either
  yields the same silent no-op.
  1. **The file name** must match `TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/`
     (`discover()`/`walkDir()`; directories `node_modules`, `dist`, `build`, `.git` are skipped).
     **`.mjs` and `.cjs` are invisible** — `smoke.mjs` and `smoke.test.mjs` both fail the pattern.
  2. **The block** must be a call whose callee is rooted at the identifier **`it`** or **`test`**, with a
     **string or template literal as its first argument** (`extractTests()` in `dist/extract.js`, which parses
     with `@babel/parser` including `typescript` and `jsx`). `describe('name', …)` is not a block: it only
     pushes onto the name path. `it.only`, `it.skip.each(table)(…)` etc. all resolve to their root name.
     - **The literal has to be at the call site, and the callee has to be rooted at `it`/`test`.** A shared
       test-helper wrapper destroys every block in the file at once: `section("name", body)` is rooted at
       `section` (not a block), and the `test(name, …)` *inside* that helper has an **Identifier** first
       argument, which `nameOf` maps to `null` (also not a block). `test(\`…\`)` is fine; `test(VARIABLE, …)`
       is not; no amount of nesting or aliasing helps. Measured, not inferred: routing 23 sections through such
       a helper left `lgtm .` reporting `2 tests in 1 file`; inlining a literal at each call site took it to
       `25 tests in 3 files` with nothing else changed.
  A file that passes gate 1 but contains no such call is **counted as discovered and yields no blocks**, so
  `lgtm <dir>` prints `no test blocks found in N file(s)` on stderr with **exit 0 and empty stdout**. This is
  the "did not run" case, never a clean suite, and it is why a hand-rolled assertion script (a flat
  `assert()` harness with no `it`/`test` calls) is invisible to lgtm no matter what it is named.
  Both gates were verified against the installed 0.3.1: `test/ --dry-run` → `no test blocks found in 2 file(s)`.
- Network access to `https://api.typesafe.ai` (or `TYPESAFE_BASE_URL`) + a TypeSafe API key. Not needed for `--dry-run`, `--list-checks`, `--classes`(text), `clear-cache`, `usage`, `skill`.
- No other external runtime deps; the package ships only `dist` + `skills`.

---

## 8. Skills it ships

Two, generated by `src/skill.ts` (`SKILLS`), shipped as `skills/<name>/SKILL.md`, file names locked to their generators by `src/init.test.ts` (`"ships skills/$name/SKILL.md in sync with its generator"`):

```ts
/** Every bundled skill, in the order they are written. */
export const SKILLS: { name: string; markdown: () => string }[] = [
  { name: "lgtm", markdown: skillMarkdown },
  { name: "actually-test", markdown: actuallyTestMarkdown },
];
```

- Names: **`lgtm`** and **`actually-test`** (the README's `/lgtm`, `/actually-test`).
- Install targets: `--skill claude` → `$HOME/.claude/skills/{lgtm,actually-test}/SKILL.md`; `--skill global|project` → handed to `npx -y skills add`, and on failure written to `$HOME` (global) or `process.cwd()` (project) under `.claude/skills/<name>/SKILL.md`. Never `src/` — `writeSkillFiles(root)` is dated by `path.join(root, ".claude", "skills", name, "SKILL.md")`.
- **Frontmatter fields: exactly `name` and `description`** (YAML, `---` fenced, nothing else). Verbatim from the shipped `skills/lgtm/SKILL.md` at tag `v0.3.1`:

```markdown
---
name: lgtm
description: Run the lgtm test linter on the current branch or a path and act on its findings. Use when the user runs /lgtm, asks whether tests are any good, or asks which tests to delete or strengthen.
---
```

and `actually-test` (`skills/actually-test/SKILL.md`):

```markdown
---
name: actually-test
description: Write the tests a change actually needs, then iterate with lgtm until they prove something. Use when the user runs /actually-test or asks to test what was just built.
---
```

Both bodies are static except the `/lgtm` skill's `## Checks` list, which interpolates one bullet per check (`- <gesture> \`<id>\` — <blurb>\n  <EXPLANATION>`), so the skill text changes whenever a check's blurb or explanation does.

---

## Wrapper recipe (derived)

```
lgtm --diff --yes --format json
  env: { TYPESAFE_API_KEY, NO_COLOR: "1" }
  stdio: ['ignore', 'pipe', 'pipe']     // stdin non-TTY, stdout piped & parseable
```
0. Give it a target it can actually see: the file must match `TEST_FILE` **and** contain `it(...)`/`test(...)`
   calls with string names. `--dry-run` (free, no key needed) is the only cheap way to confirm you have one.
   Also, if the wrapper launches `node <abs path>` **through PowerShell**, the quoted runner needs the call
   operator: `& 'C:\Program Files\nodejs\node.exe' 'C:\…\cli.js' …`. Without `&`, PowerShell parses the leading
   quoted path as an *expression* and the second quoted argument is a `ParserError` before anything runs.
   POSIX shells must NOT get the `&` (it backgrounds the pipeline), so the operator is platform-conditional.
   This one is invisible to unit tests that only compare command strings — a live host found it.
1. `--yes` is mandatory; without it, non-TTY stdin yields exit 0 with empty stdout.
2. Treat **exit 0 + empty stdout** as "did not run", never as "clean".
3. stdout is one JSON object (`JSON.parse` directly). stderr carries the plan, the progress bar, `[lgtm] skipped …` warnings and `[lgtm] git diff … failed`.
4. Read `findings` (sorted), `checks` (explanation per fired check id), `classes` (unsorted), `tests`, `files`, `skipped`, `inputTokens`, `durationMs`, `verbose`, `distribution`.
5. Status per finding: `p >= (high ?? min(0.95, threshold + 0.15))` = high confidence; `p >= threshold` = worth a look. Cost = `inputTokens * 0.042 / 1e6`.
6. Exit 1 only when `--fail`/`--fail-on-error` are passed and their conditions hold; exit 2 is always a hard failure (bad flag, no key, bad ref, auth).
7. `--dry-run --json` (no key needed) is the cheap pre-flight, but its schema is unrelated to `--format json`.
