/**
 * lgtm-dsh — a DeepSeek Harness plugin around `@stardeckai/lgtm`, a Jev-powered
 * linter for tests that pass but prove nothing.
 *
 * `@stardeckai/lgtm` is a normal `dependencies` entry of this package, so
 * `dsh plugin --profile <p> add lgtm-dsh` installs it into the profile's
 * node_modules alongside the plugin. Nothing is installed globally, PATH is
 * never consulted, and no package manager is probed: the CLI is resolved as a
 * module and launched by absolute path.
 *
 * `lgtm init` is deliberately never run. It exists to prompt for and persist an
 * API key; this plugin always supplies the key through the child process
 * environment instead, which `lgtm` prefers over its own config file.
 *
 * Both tools are real. `lgtm_status` probes without spending. `lgtm_audit`
 * passes `--dry-run` when `plan` is set — lgtm builds its states and prints its
 * own estimate without calling the model — and otherwise runs the audit and
 * normalizes the `--format json` report.
 *
 * Design constraints this file obeys (verified against lgtm 0.3.1's own
 * `dist/cli.js` and dsh 0.1.5-rc.2):
 *  - The plugin never stores a credential. It resolves the configured DSH
 *    credential reference once per operation and hands the value to the `lgtm`
 *    child process through the shell service's `env` channel. That channel is
 *    required, not merely preferred: the subprocess layer scrubs ambient
 *    entries matching /KEY|PASSWORD|SECRET|TOKEN/i, so the key can never be
 *    inherited and must be supplied explicitly.
 *  - The child variable is always `TYPESAFE_API_KEY`, whatever reference the
 *    value came from, because that is the only variable lgtm reads
 *    (`resolveApiKey` checks it, then lgtm's own config file).
 *  - `lgtm` talks to TypeSafe through `@typesafe-ai/sdk`, so `ctx.llm` cannot
 *    transport its requests and is deliberately unused here. The plugin does NOT
 *    read the `llm-pi-ai` route's endpoint either: a pi-ai route and an lgtm
 *    credential are different things that happen to share a key. The route is
 *    only the place the TypeSafe key is kept.
 *  - Every subprocess runs through `ctx.shell` with stdin left unset, which the
 *    executors map to a closed stdin — that is what stops `lgtm` prompting. lgtm
 *    refuses to run without `--yes` when stdin is not a TTY, exits 0, and prints
 *    nothing to stdout; that is why "exit 0 with an empty stdout" is classified
 *    as "did not run" and never as "clean".
 * @module lgtm-dsh
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { apply as mountSkillRoot } from '@deepseek-ai/dsh-skill-filesystem';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'lgtm-dsh';

/**
 * Services this plugin requires. `settings`, `sandboxPolicy` and the client-side
 * faces are optional-or-deferred and read through `ctx.inject` / `ctx.get` at the
 * point of use, so a deployment without them still activates.
 */
export const inject = ['tools', 'shell', 'credentials', 'skills'];

/** The npm package that owns the `lgtm` binary. Declared in `dependencies`. */
export const LGTM_PACKAGE = '@stardeckai/lgtm';

/**
 * The reference lgtm itself reads out of its own environment. It is the default,
 * not a hard-coded fact: the settings section can point the plugin at a
 * different reference, and the plugin then bridges that value into this name for
 * the child process.
 */
/**
 * The environment variable `lgtm` reads its TypeSafe key from — one name for
 * both halves of the same fact. `lgtm`'s `resolveApiKey` checks this variable
 * and then its own config file, and reads nothing else, so a value resolved
 * from any other DSH credential reference still has to be handed over under
 * this name. It is also the fallback reference for a deployment that stores the
 * key directly rather than through a model route.
 */
const TYPESAFE_KEY_ENV = 'TYPESAFE_API_KEY';

/** Settings namespace this plugin owns. The Plugin-config card is keyed on it. */
const SETTINGS_NS = 'lgtm-dsh';

const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills');

/**
 * TypeSafe's list price for jev-latest: $0.042 per million input tokens, output
 * tokens free. lgtm owns this number (`USD_PER_INPUT_TOKEN` in its
 * `dist/checks/index.js`); the copy here exists only to price a JSON report,
 * which carries token counts and no dollars. `test/smoke.test.js` re-reads lgtm's
 * own constant and fails if the two ever disagree, so this cannot drift
 * silently.
 */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

/** How far above its threshold a finding must sit to be reported as `high`. */
const CERTAIN_MARGIN = 0.15;

/**
 * Foreground stdout budget. The executor's default is 64 KB and keeps the
 * TAIL on overflow, either of which would corrupt a JSON report — this is the
 * documented case for a trusted in-process consumer to raise it.
 */
const STDOUT_MAX_BYTES = 8 * 1024 * 1024;

/** Deadline for a real audit: the executor caps a single command at 10 minutes. */
const AUDIT_TIMEOUT_MS = 600_000;

/** Deadline for `--dry-run`, which builds states in-process and calls nothing. */
const PLAN_TIMEOUT_MS = 120_000;

/** Findings the rendered text lists before it summarizes the remainder. */
const RENDERED_FINDINGS = 40;

/**
 * The plugin's settings section, rendered by the browser half in
 * Settings → Plugins → Plugin configuration.
 *
 * One field, because there is one decision. Choosing a model route already fixes
 * which credential it uses — the route declares its own `apiKeyEnv` — so storing
 * a credential reference beside it would be a second owner of the same fact.
 *
 * The CLI version is absent for the same reason: `package.json` names the range
 * and the profile's lockfile pins it, so a version setting would be a second
 * owner of a dependency fact.
 */
export const Config = z.object({
  provider: z
    .string()
    .default('')
    .description('Registered model route whose credential lgtm authenticates with. lgtm never calls this route.'),
});

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

/**
 * Locate the `@stardeckai/lgtm` CLI this plugin runs.
 *
 * The version is a dependency fact, not a runtime setting: `package.json` names
 * the range, `dsh plugin add` installs it, and the profile's lockfile pins it. So
 * there is one source, and this reads it. Resolution is module-based rather than
 * PATH-based, so a bare specifier finds exactly the copy that shipped with the
 * plugin — not whatever a global install or a shell lookup would turn up.
 * @returns the resolved CLI, or why it could not be resolved.
 */
export function resolveLgtm() {
  let manifestPath;
  try {
    manifestPath = createRequire(import.meta.url).resolve(`${LGTM_PACKAGE}/package.json`);
  } catch (error) {
    return {
      present: false,
      reason:
        `${LGTM_PACKAGE} does not resolve from this plugin, so it was not installed with it. ` +
        'Re-run: dsh plugin --profile <profile> add lgtm-dsh',
      detail: error.code ?? error.message,
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { present: false, reason: `cannot read ${manifestPath}: ${error.message}` };
  }

  const declared = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.lgtm;
  if (typeof declared !== 'string' || declared.length === 0) {
    return { present: false, version: manifest.version, reason: `${LGTM_PACKAGE} declares no "lgtm" bin entry` };
  }

  const packageRoot = dirname(manifestPath);
  return {
    present: true,
    version: typeof manifest.version === 'string' ? manifest.version : undefined,
    cli: join(packageRoot, declared),
  };
}

// ---------------------------------------------------------------------------
// Subprocess and environment helpers
// ---------------------------------------------------------------------------

/**
 * Quote one argument for the shell the deployment's executor runs.
 *
 * The shell service takes a command string, not an argv array, so this is the
 * only thing standing between a path with a space and a broken invocation. The
 * escaping rule differs by shell: POSIX closes and reopens the quote, PowerShell
 * doubles the quote.
 * @param value - the raw argument.
 * @returns the quoted argument.
 */
export function quote(value) {
  const text = String(value);
  return process.platform === 'win32' ? `'${text.replace(/'/g, "''")}'` : `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * The sandbox policy this plugin's subprocesses run under: the calling
 * session's own, resolved through the same owner every other capability reads.
 *
 * Deliberately not an override. `sandboxPolicy.resolve` treats a `mode` as an
 * approved escalation, and a plugin that grants itself `danger-full-access` to
 * save a linter's cache write would be bypassing the user's own policy — the
 * one decision this seam exists to keep in one place. An audit reads the project
 * and writes lgtm's cache; if the session's policy denies that, the denial is
 * reported instead of worked around.
 * @param ctx - the plugin context.
 * @param session - the calling session, whose cwd is the workspace boundary.
 * @returns a resolved sandbox policy, or undefined when the deployment has none.
 */
function sandboxPolicyFor(ctx, session) {
  const policy = ctx.get('sandboxPolicy');
  if (policy && typeof policy.resolve === 'function') return policy.resolve(session ? { session } : undefined);
  return undefined;
}

/**
 * Run one foreground command through the shell service.
 *
 * `stdin` is deliberately left unset: both shipped executors turn an absent
 * `stdin` into a closed fd 0, so a command that would otherwise prompt sees a
 * non-TTY stdin instead of hanging the tool call. The shell seam resolves
 * nonzero exits, timeout kills and abort kills as ordinary results and rejects
 * only for infrastructure failures, so both shapes are reported distinctly
 * rather than folded into one error.
 * @param ctx - the plugin context.
 * @param command - the shell command line to run.
 * @param options - workdir, timeout, environment, sandbox policy, signal.
 * @returns the exit facts plus captured stdout and stderr, or a start failure.
 */
async function run(ctx, command, options = {}) {
  const {
    workdir,
    timeoutMs = PLAN_TIMEOUT_MS,
    env,
    signal,
    sandboxPolicy,
    stdoutMaxBytes = STDOUT_MAX_BYTES,
  } = options;
  const spec = ctx.shell.resolve({ command, workdir, timeoutMs, stdoutMaxBytes, env, signal, sandboxPolicy });

  let result;
  try {
    result = await ctx.shell.run(spec);
  } catch (error) {
    return { started: false, reason: error?.message ?? String(error) };
  }

  return {
    started: true,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut === true,
    denied: result.sandbox?.denied === true,
    truncated: result.stdout?.truncated === true,
    stdout: result.stdout?.text ?? '',
    stderr: result.stderr?.text ?? '',
  };
}

/**
 * Ask the credential seam for the configured reference and keep the value.
 *
 * Separate from {@link probeCredential} on purpose: status needs to know whether
 * a credential resolves, the audit needs the secret itself. Keeping the
 * value-returning path only where a child process is about to be built means the
 * secret has one exit from the credential store and no reason to be logged.
 * @param ctx - the plugin context.
 * @param ref - the credential reference to resolve.
 * @returns whether a value resolved, plus the value and the source that produced it.
 */
async function resolveCredentialValue(ctx, ref) {
  const hit = await ctx.credentials.resolve(ref);
  if (hit?.value) return { present: true, value: hit.value, ref, source: hit.source };
  return { present: false, ref };
}

/**
 * Ask the credential seam for the configured reference. The secret is never
 * stored, never logged, and never leaves this call except as the `value` used
 * to build one subprocess environment.
 *
 * `credentials` is declared in `inject`, so it is guaranteed to exist by the time
 * `apply` runs; reaching it through `ctx.get()` would be the optional-dependency
 * idiom applied to a required one, which is what lets a plugin enter ACTIVE
 * half-formed instead of failing loudly.
 * @param ctx - the plugin context.
 * @param ref - the credential reference to resolve.
 * @returns whether a value resolved, and the reference and source that produced it.
 */
async function probeCredential(ctx, ref) {
  const hit = await ctx.credentials.resolve(ref);
  if (hit?.value) return { present: true, ref, source: hit.source };
  return { present: false, ref };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** One normalized audit finding, after confidence-band derivation. */
const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file: { type: 'string', required: true, description: 'Project-relative path of the test file.' },
    line: { type: 'integer', required: true, description: '1-based line where the test block starts.' },
    name: { type: 'string', required: true, description: 'Test block name.' },
    checkId: { type: 'string', required: true, description: 'The lgtm check that fired.' },
    probability: { type: 'number', required: true, description: 'Model score for this finding.' },
    confidence: {
      type: 'string',
      required: true,
      enum: ['high', 'worth-a-look'],
      description: 'Derived band: high counts against the verdict, worth-a-look does not.',
    },
  },
};

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

/**
 * The credential reference the selected model route authenticates with.
 *
 * The reference is read from the route's own `llm-pi-ai` profile rather than
 * stored beside the selection: the route already owns that fact, and a copy here
 * could disagree with what DSH actually uses. With no route selected there is
 * nothing to derive from, so this falls back to the reference `lgtm` itself
 * reads — which is also the name a deployment would store the key under.
 * @param settings - the settings provider, when it has arrived.
 * @param provider - the selected route id.
 * @returns the credential reference to resolve.
 */
export function credentialRefFor(settings, provider) {
  if (provider === undefined || provider === null || provider === '') return TYPESAFE_KEY_ENV;
  let section;
  try {
    section = settings?.get?.('llm-pi-ai');
  } catch {
    section = undefined;
  }
  const declared = section?.providers?.[provider]?.apiKeyEnv;
  return typeof declared === 'string' && declared.length > 0 ? declared : TYPESAFE_KEY_ENV;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * `lgtm_status` — environment probe. Implemented for real: it answers "can an
 * audit run right now" without spending anything.
 * @param ctx - the plugin context.
 * @param readState - reads the configured credential reference.
 * @returns a registry-ready tool definition.
 */
function statusTool(ctx, readState) {
  return defineTool({
    name: 'lgtm_status',
    description:
      'Report whether the lgtm test-audit CLI and the configured TypeSafe credential are ready. Call this before lgtm_audit. The CLI arrives with the plugin as a dependency, so a failure here needs a human: report the notes verbatim instead of retrying.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ready: { type: 'boolean', required: true },
          lgtm: {
            type: 'object',
            additionalProperties: false,
            properties: {
              installed: { type: 'boolean', required: true },
              version: { type: 'string' },
              cli: { type: 'string' },
            },
          },
          credential: {
            type: 'object',
            additionalProperties: false,
            properties: {
              present: { type: 'boolean', required: true },
              ref: { type: 'string' },
              source: { type: 'string' },
            },
          },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStatus(value) }],
    },
    execute() {
      return collectStatus(ctx, readState());
    },
  });
}

/**
 * Gather the status facts. Pure reads: no subprocess, no network, no spend.
 * @param ctx - the plugin context.
 * @param state - the configured credential reference.
 * @returns the canonical status value.
 */
async function collectStatus(ctx, state) {
  const notes = [];
  const lgtm = resolveLgtm();
  const credential = await probeCredential(ctx, state.credentialRef);

  if (!lgtm.present) {
    notes.push(lgtm.reason);
  }
  if (lgtm.present && !credential.present) {
    notes.push(
      `lgtm is installed, but the credential reference "${state.credentialRef}" resolves to no value. ` +
        'Open Settings -> Plugins -> Plugin configuration, pick the model route that holds your TypeSafe key, ' +
        `or add a custom model provider whose apiKeyEnv is ${TYPESAFE_KEY_ENV}.`,
    );
  }
  // The route is only where the key is kept; lgtm spends it at TypeSafe. A route
  // that declares its own reference is a route for another provider, and its key
  // will be rejected there — say so before an audit pays to find out.
  if (lgtm.present && credential.present && state.credentialRef !== TYPESAFE_KEY_ENV) {
    notes.push(
      `the credential comes from route "${state.provider}" (reference ${state.credentialRef}). lgtm ` +
        `authenticates at TypeSafe only, so that value must be a TypeSafe API key; a key belonging to another ` +
        `provider will be rejected. Select a route whose apiKeyEnv is ${TYPESAFE_KEY_ENV} if it is not.`,
    );
  }

  return {
    ready: lgtm.present && credential.present,
    lgtm: lgtm.present
      ? {
          installed: true,
          ...(lgtm.version === undefined ? {} : { version: lgtm.version }),
          cli: lgtm.cli,
        }
      : { installed: false },
    credential: credential.present
      ? { present: true, ref: state.credentialRef, source: credential.source }
      : { present: false, ref: state.credentialRef },
    notes,
  };
}

/** One check that fired, carrying lgtm's own wording for it. */
const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    emoji: { type: 'string', required: true, description: "The check family's face, as the CLI prints it." },
    blurb: { type: 'string', required: true, description: "One line naming what the check spotted." },
    explanation: { type: 'string', required: true, description: "The longer form, including the fix." },
    threshold: { type: 'number', required: true, description: "The check's own default threshold." },
  },
};

/**
 * `lgtm_audit` — run the audit and normalize the JSON report.
 * @param ctx - the plugin context.
 * @param readState - reads the configured route and its credential reference.
 * @returns a registry-ready tool definition.
 */
function auditTool(ctx, readState) {
  return defineTool({
    name: 'lgtm_audit',
    description:
      'Audit test code for tests that pass but prove nothing. Reads every test block alongside its implementation and reports the ones that are useless. Call with plan: true first — it estimates the cost and the runtime without calling the model, so it is free — then tell the user that estimate in one line before running the audit for real. Use after writing or changing tests, or when asked whether tests are any good.',
    parameters: {
      target: {
        type: 'string',
        description:
          'A test file or directory to audit, e.g. "." for the whole project. Omit to audit only the tests the working change touches, against the repository default branch — which needs a git work tree, so pass "." for a project that has no default branch to diff against.',
      },
      plan: {
        type: 'boolean',
        description:
          'Estimate only: list the files, the estimated input tokens, the estimated cost and the estimated runtime, and call nothing. Free.',
      },
      workdir: {
        type: 'string',
        description: 'Project directory to audit. Defaults to the session working directory.',
      },
    },
    // Declared because this tool forwards `exec.signal` into the shell spec, which
    // the executor honours by killing the child; it matches the executor's own cap.
    timeoutMs: AUDIT_TIMEOUT_MS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: 'Whether lgtm actually ran and produced a report.' },
          findings: { type: 'array', required: true, items: FINDING_SCHEMA },
          checks: { type: 'array', items: CHECK_SCHEMA },
          plan: {
            type: 'array',
            items: { type: 'string' },
            description: "lgtm's own estimate, verbatim, when plan was set. Nothing was sent.",
          },
          tests: { type: 'integer' },
          files: { type: 'integer' },
          skipped: { type: 'integer' },
          inputTokens: { type: 'integer' },
          durationMs: { type: 'integer' },
          costUsd: { type: 'number' },
          distribution: { type: 'string' },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderAudit(value) }],
    },
    execute(args, exec) {
      return collectAudit(ctx, readState(), args ?? {}, exec);
    },
  });
}

/**
 * Build the command line for one lgtm invocation.
 *
 * `node <resolved cli>` rather than the `bin` shim: the package's `bin` is a
 * `.js` file with a shebang, which Windows cannot execute directly, and
 * `process.execPath` is by definition a node that exists.
 *
 * Both the quoting and the call operator are load-bearing, and PowerShell needs
 * the operator for a reason POSIX does not have: a bare quoted string at the
 * start of a statement parses as an *expression*, so
 * `'C:\Program Files\nodejs\node.exe' 'cli.js'` is a parser error before
 * anything runs. PowerShell requires `&` to use a quoted path as the command;
 * `&` means "background" to a POSIX shell, so this is Windows-only. Caught by
 * running the tool in a live host — not by reading the grammar.
 *
 * `--diff` goes in bare and alone, because lgtm's `normalizeDiffFlag` reads the
 * NEXT argument as the base ref unless it starts with `-` or names an existing
 * file — so every flag after it has to be a flag.
 * @param cli - absolute path to lgtm's `dist/cli.js`.
 * @param options - the target path, and whether this is the free estimate.
 * @returns the shell command line.
 */
export function auditCommand(cli, options = {}) {
  const callOperator = process.platform === 'win32' ? '& ' : '';
  const parts = [`${callOperator}${quote(process.execPath)}`, quote(cli)];
  const target = options.target;
  if (typeof target === 'string' && target.length > 0) parts.push(quote(target));
  else parts.push('--diff');
  if (options.plan === true) parts.push('--dry-run');
  else parts.push('--yes', '--format', 'json');
  return parts.join(' ');
}

/**
 * Whether a finding is well clear of its own threshold.
 *
 * Mirrors lgtm's `certain`/`highLine`: a check may pin its own high line, and
 * otherwise the margin is 0.15 capped at 0.95. The finding carries both numbers,
 * so this never re-derives a check's threshold from a table that could disagree
 * with the report.
 * @param finding - one raw finding from the JSON report.
 * @returns `high` when it clears the line, otherwise `worth-a-look`.
 */
export function confidenceOf(finding) {
  const threshold = Number(finding.threshold);
  const pinned = finding.high === undefined ? undefined : Number(finding.high);
  const line = pinned ?? Math.min(0.95, (Number.isFinite(threshold) ? threshold : 0) + CERTAIN_MARGIN);
  return Number(finding.probability) >= line ? 'high' : 'worth-a-look';
}

/** Copy only the defined entries, so an absent count never reaches the validator. */
function defined(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

/** A report field as an integer, or undefined when it is missing or not one. */
function intOr(value) {
  return Number.isInteger(value) ? value : undefined;
}

/**
 * Normalize lgtm's JSON report for the model.
 *
 * Two things happen here. Sub-threshold rows are dropped: lgtm only emits them
 * under `--verbose`, which this plugin never passes, and a row under its own
 * threshold accuses nobody. And each surviving finding is given the confidence
 * band the CLI's text verdict would have given it, so a caller that reads the
 * structured result reaches the same conclusion as one that reads the terminal.
 * @param report - the parsed `--format json` payload.
 * @returns the value shape this tool declares, minus `ok` and `notes`.
 */
export function normalizeReport(report) {
  const raw = Array.isArray(report?.findings) ? report.findings : [];
  const checks = new Map();
  const findings = [];

  for (const finding of raw) {
    if (!(Number(finding.probability) >= Number(finding.threshold))) continue;
    findings.push({
      file: String(finding.file),
      line: Number(finding.line),
      name: String(finding.name),
      checkId: String(finding.checkId),
      probability: Number(finding.probability),
      confidence: confidenceOf(finding),
    });
    const meta = report?.checks?.[finding.checkId];
    if (meta !== undefined && !checks.has(finding.checkId)) {
      checks.set(
        finding.checkId,
        defined({
          id: finding.checkId,
          emoji: typeof meta.emoji === 'string' ? meta.emoji : '',
          blurb: typeof meta.blurb === 'string' ? meta.blurb : '',
          explanation: typeof meta.explanation === 'string' ? meta.explanation : '',
          threshold: Number.isFinite(Number(meta.threshold)) ? Number(meta.threshold) : 0,
        }),
      );
    }
  }

  return defined({
    findings,
    checks: checks.size > 0 ? [...checks.values()] : undefined,
    tests: intOr(report?.tests),
    files: intOr(report?.files),
    skipped: intOr(report?.skipped),
    inputTokens: intOr(report?.inputTokens),
    durationMs: intOr(report?.durationMs),
    distribution: typeof report?.distribution === 'string' ? report.distribution : undefined,
  });
}

/**
 * Translate lgtm's exit facts into a note a human can act on.
 *
 * Two cases are worth replacing rather than forwarding, because lgtm's own
 * advice is the wrong fix here:
 *  - an authentication rejection — the key came from a DSH credential, so the
 *    interesting question is which route supplied it, not `lgtm init`;
 *  - a missing default branch — lgtm suggests `--diff <ref>`, which this tool
 *    does not expose and which cannot help a directory that is not a work tree
 *    at all. What the caller can do instead is name the target.
 * @param state - the configured route and credential reference.
 * @param stderr - lgtm's own message.
 * @returns the note body.
 */
function failureNote(state, stderr) {
  const text = stderr.trim();
  if (/rejected the API key/i.test(text)) {
    return (
      `TypeSafe rejected the credential behind route "${state.provider || '(none selected)'}" ` +
      `(reference ${state.credentialRef}). lgtm authenticates at TypeSafe only, so that route has to hold a ` +
      `TypeSafe API key — a key for another provider is not one. Select a route whose apiKeyEnv is ${TYPESAFE_KEY_ENV}.`
    );
  }
  if (/no default branch found/i.test(text)) {
    return (
      'lgtm has nothing to diff against: this project is not a git work tree, or it has no default branch. ' +
      'Pass target: "." to audit the tree as it stands instead.'
    );
  }
  if (text === '') return `lgtm exited ${state.exitCode} without a message.`;
  return text;
}

/**
 * Run one audit (or one free estimate) and normalize the outcome.
 * @param ctx - the plugin context.
 * @param state - the configured route and credential reference.
 * @param args - the validated tool arguments.
 * @param exec - the tool run context: cancellation signal and calling agent.
 * @returns the canonical audit value.
 */
async function collectAudit(ctx, state, args = {}, exec = {}) {
  const resolved = resolveLgtm();
  if (!resolved.present) return { ok: false, findings: [], notes: [resolved.reason] };

  const session = exec.agent?.session;
  const plan = args.plan === true;
  const notes = [];

  const credential = await resolveCredentialValue(ctx, state.credentialRef);
  if (!credential.present) {
    return {
      ok: false,
      findings: [],
      notes: [
        `the credential reference "${state.credentialRef}" resolves to no value, so lgtm has no TypeSafe key. ` +
          'Open Settings -> Plugins -> Plugin configuration and pick the model route that holds it.',
      ],
    };
  }

  const command = auditCommand(resolved.cli, { target: args.target, plan });
  const result = await run(ctx, command, {
    workdir: args.workdir ?? session?.cwd,
    timeoutMs: plan ? PLAN_TIMEOUT_MS : AUDIT_TIMEOUT_MS,
    env: { [TYPESAFE_KEY_ENV]: credential.value, NO_COLOR: '1' },
    signal: exec.signal,
    sandboxPolicy: sandboxPolicyFor(ctx, session),
  });

  if (!result.started) {
    return { ok: false, findings: [], notes: [`could not start lgtm: ${result.reason}`] };
  }
  if (result.denied) {
    notes.push('the sandbox denied a file operation; lgtm could not read the project or write its answer cache.');
  }
  if (result.timedOut) {
    return {
      ok: false,
      findings: [],
      notes: [`lgtm was still running after ${(plan ? PLAN_TIMEOUT_MS : AUDIT_TIMEOUT_MS) / 1000}s and was killed.`, ...notes],
    };
  }
  if (result.exitCode === null) {
    return { ok: false, findings: [], notes: [`lgtm was killed by ${result.signal}.`, ...notes] };
  }

  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();

  if (plan) {
    if (result.exitCode !== 0 || stdout === '') {
      return {
        ok: false,
        findings: [],
        notes: [failureNote({ ...state, exitCode: result.exitCode }, stderr), ...notes],
      };
    }
    return { ok: true, findings: [], plan: stdout.split('\n'), ...(notes.length > 0 ? { notes } : {}) };
  }

  if (result.exitCode === 2) {
    return { ok: false, findings: [], notes: [failureNote({ ...state, exitCode: 2 }, stderr), ...notes] };
  }
  if (stdout === '') {
    // exit 0 with nothing on stdout is what lgtm does when it ran nothing: no
    // test blocks found, or a non-TTY stdin that was never told `--yes`. It is
    // never a clean report.
    return {
      ok: false,
      findings: [],
      notes: [`lgtm exited ${result.exitCode} without a report, so nothing was audited. ${stderr}`.trim(), ...notes],
    };
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    return {
      ok: false,
      findings: [],
      notes: [
        result.truncated
          ? `lgtm's report exceeded ${STDOUT_MAX_BYTES / (1024 * 1024)} MB and was truncated, so it is not valid JSON.`
          : `could not parse lgtm's JSON report: ${error.message}`,
        ...notes,
      ],
    };
  }

  const normalized = normalizeReport(report);
  // The plugin never passes --fail/--fail-on-error, so a nonzero exit here is
  // lgtm's own signal and the report is still worth reading — but not silently.
  if (result.exitCode !== 0) notes.push(`lgtm exited ${result.exitCode}, with a report.`);
  if (normalized.skipped > 0) {
    // A count with no reason is not actionable, and the reason exists only on
    // stderr: `console.warn("[lgtm] skipped <file>:<line>: <message>")`, one per
    // block lgtm gave up on. Surface a bounded sample — the skill says these
    // blocks were never judged, so the caller has to be able to say why.
    const reasons = result.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('[lgtm] skipped'));
    const sample = reasons.slice(0, 3).join(' | ');
    notes.push(
      `${normalized.skipped} test block(s) were skipped after an API error and were never judged.` +
        (sample === '' ? '' : ` ${sample}${reasons.length > 3 ? ` | … and ${reasons.length - 3} more` : ''}`),
    );
  }
  return defined({
    ok: true,
    ...normalized,
    costUsd: normalized.inputTokens === undefined ? undefined : normalized.inputTokens * USD_PER_INPUT_TOKEN,
    notes: notes.length > 0 ? notes : undefined,
    // `findings` is required by the schema; `normalizeReport` always sets it.
    findings: normalized.findings,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a status result as model-facing text.
 * @param value - the validated status value.
 * @returns the text block body.
 */
function renderStatus(value) {
  const lines = [
    `lgtm ready: ${value.ready ? 'yes' : 'no'}`,
    `  cli:        ${
      value.lgtm.installed ? `${value.lgtm.version ?? 'unknown version'} — ${value.lgtm.cli}` : 'not installed'
    }`,
    `  credential: ${
      value.credential.present
        ? `${value.credential.ref} (resolved from "${value.credential.source}")`
        : `${value.credential.ref} resolves to nothing`
    }`,
  ];
  for (const note of value.notes ?? []) lines.push(`  note: ${note}`);
  return lines.join('\n');
}

/**
 * Render an audit result as model-facing text.
 *
 * Terse on purpose: each finding's `checkId` is a key into the result's `checks`
 * list, which carries lgtm's own blurb and explanation, so repeating them here
 * would be a second copy of the same words.
 * @param value - the validated audit value.
 * @returns the text block body.
 */
function renderAudit(value) {
  const findings = value.findings ?? [];
  const notes = (value.notes ?? []).map((note) => `note: ${note}`);

  if (value.plan !== undefined && value.plan.length > 0) {
    return ['lgtm plan — nothing was sent, nothing was spent:', ...value.plan.map((line) => `  ${line}`), ...notes].join(
      '\n',
    );
  }

  if (!value.ok) return ['lgtm: the audit did not run.', ...notes].join('\n');

  const high = findings.filter((finding) => finding.confidence === 'high').length;
  const total = value.tests ?? 0;
  const skipped = value.skipped ?? 0;
  const judged = total - skipped;
  // The headline must never read as a clean suite when blocks were skipped: a
  // skipped block was never judged, so "nothing to report" over a run that
  // judged one block of thirteen is the exact false-clean this plugin exists to
  // prevent. A live run produced it — 12 of 13 skipped, headline "fine?".
  let head;
  if (findings.length > 0) {
    head =
      `lgtm: ${findings.length} finding(s) in ${judged} of ${total} test block(s) across ${value.files ?? 0} file(s) ` +
      `— ${high} high, ${findings.length - high} worth a look`;
  } else if (judged === 0) {
    head = `lgtm: nothing was judged — all ${total} test block(s) were skipped, so there is no verdict`;
  } else if (skipped > 0) {
    head =
      `lgtm: nothing found in the ${judged} of ${total} test block(s) that were judged, but ${skipped} were ` +
      'skipped and never judged — this is not a clean verdict';
  } else {
    head = `lgtm: fine? ${total} test block(s) in ${value.files ?? 0} file(s), nothing to report`;
  }

  const lines = [head];
  for (const finding of findings.slice(0, RENDERED_FINDINGS)) {
    lines.push(`${finding.file}:${finding.line}  "${finding.name}"`);
    lines.push(`  ${finding.confidence}  ${finding.checkId} ${finding.probability}`);
  }
  if (findings.length > RENDERED_FINDINGS) {
    lines.push(`… and ${findings.length - RENDERED_FINDINGS} more in the structured result.`);
  }
  if (value.distribution !== undefined) lines.push(`classes: ${value.distribution}`);
  // The skill tells the caller to report the run's cost and duration, so they
  // have to be in the one thing the caller actually reads. A structured-only
  // count is a fact with no route to the user.
  const spent = [
    value.inputTokens === undefined ? undefined : `${value.inputTokens} input tokens`,
    value.costUsd === undefined ? undefined : `≈ $${value.costUsd.toFixed(4)}`,
    value.durationMs === undefined ? undefined : `${(value.durationMs / 1000).toFixed(1)}s`,
  ].filter((part) => part !== undefined);
  if (spent.length > 0) lines.push(`run: ${spent.join(' · ')}`);
  return [...lines, ...notes].join('\n');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Compose the plugin: register the settings section, mount the shipped skill
 * tree, and register the tools.
 *
 * The skill ships inside this package and its directory is mounted as a skill
 * root, so discovery is a composition fact: nothing is ever copied into
 * $DSH_HOME/skills (which the fs sandbox denies anyway) and a plugin update
 * carries the skill with it.
 *
 * The settings section is the runtime layer. The composition layer sits under it:
 * a patch row may carry `config:` — the documented plugin-configuration path —
 * and Cordis validates it against the exported `Config` schema before `apply`
 * runs, so the value arrives already defaulted.
 *
 * A plugin that already has a `cordis.yml` entry registers through
 * `settings.installSection`, not `settings.register`: it layers the entry beneath
 * the user document, republishes through `setSource`/`onChange`, and keeps the
 * section working when no settings provider is mounted. `installSection` is a
 * thin wrapper over `register`, so the namespace lands in `describe()` either way
 * — what the wrapper adds is the composition layer and the change wiring.
 * @param ctx - the Cordis context.
 * @param config - the composition-layer config for this plugin row, already
 * validated and defaulted by Cordis against the exported `Config` schema.
 */
export function apply(ctx, config = {}) {
  // Starts at the composition entry so the tools work before the settings
  // service arrives; `installSection` replaces it with the live section getter.
  let source = () => config;

  // Captured from the deferred inject: reading another plugin's section needs the
  // provider, and `ctx.settings` does not exist until that inject has run.
  let settingsProvider;

  const readState = () => {
    // The schema owns the defaults. Resolving them through `Config` keeps one
    // source of truth instead of a second hand-written copy that could drift.
    const section = source() ?? Config({});
    return {
      provider: section.provider,
      credentialRef: credentialRefFor(settingsProvider, section.provider),
    };
  };

  ctx.inject(['settings'], (settingsCtx) => {
    settingsProvider = settingsCtx.settings;
    settingsCtx.settings.installSection(ctx, SETTINGS_NS, Config, config, {
      setSource: (current) => {
        source = current;
      },
      onChange: () => {},
    });
  });

  mountSkillRoot(ctx, {
    providerName: 'lgtm-dsh',
    includeDefaultRoots: false,
    bundledSkillDir: SKILLS_DIR,
    watch: false,
  });

  for (const tool of [statusTool(ctx, readState), auditTool(ctx, readState)]) {
    ctx.effect(() => ctx.tools.register(tool));
  }

  // Report an unusable CLI once at mount, so the problem is visible before the
  // first audit rather than inside it.
  const resolved = resolveLgtm();
  if (!resolved.present) {
    ctx.logger?.warn?.(`lgtm-dsh: ${resolved.reason}`);
  }
}

/**
 * Test affordances. The plugin's pure pieces are hard to reach from a live host,
 * so they are exposed here behind an explicit opt-in env var — the same pattern
 * `@chenkai114/dsh-daemon` uses for its version gate. Undefined in normal runs.
 */
export const __test =
  process.env.LGTM_DSH_TEST_HOOK === '1'
    ? {
        resolveLgtm,
        quote,
        probeCredential,
        resolveCredentialValue,
        credentialRefFor,
        collectStatus,
        collectAudit,
        normalizeReport,
        confidenceOf,
        auditCommand,
        statusTool,
        auditTool,
        renderStatus,
        renderAudit,
        Config,
        SETTINGS_NS,
        TYPESAFE_KEY_ENV,
        USD_PER_INPUT_TOKEN,
        CERTAIN_MARGIN,
      }
    : undefined;
