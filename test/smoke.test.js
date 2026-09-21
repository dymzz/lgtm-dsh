// Scaffold verification for lgtm-dsh (host half).
//
// Run with `node test/smoke.test.js` from the package root. The test hook is set
// here, before index.js is imported, which is why the import below is dynamic:
// `__test` is resolved when the module body evaluates.
//
// What this proves: the plugin's named exports are shaped the way the Cordis
// loader expects, every `defineTool` schema compiles under the DSH schema DSL (a
// missing `additionalProperties` on an object node throws there), the settings
// section compiles, dependency resolution reports a usable CLI or an actionable
// reason, shell quoting survives the paths this plugin actually produces,
// `collectStatus` agrees with the resolver and the credential seam, the audit
// command is the one lgtm 0.3.1's own `parseArgs` accepts, the confidence bands
// mirror lgtm's `certain`/`highLine`, a JSON report normalizes the way the tool
// declares, every exit shape lands on the right outcome, and the price the
// plugin charges against a token count still equals the price lgtm ships.
//
// What it does NOT prove: anything needing a live host — skill-root mounting,
// registration into a real registry, or the audit subprocess. Those are the
// in-host checks in docs/aegis/plans/ sections 12/13.

import { existsSync, readFileSync } from 'node:fs';
import { after, test } from 'node:test';

import { assertObjectJsonSchema, assertSupportedJsonSchema, defineTool, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';

process.env.LGTM_DSH_TEST_HOOK = '1';

const mod = await import('../index.js');
const t = mod.__test;

const results = [];
/**
 * Report a value; a throwing probe is a failure and fails the block it is in.
 *
 * `report` and `assert` throw rather than only tallying, because the tally is
 * not what decides anything: `node:test` decides, and it decides on a throw. A
 * collector that never throws would let a block full of failed assertions pass —
 * the exact kind of test lgtm exists to find.
 */
const report = (label, fn) => {
  try {
    const value = fn();
    results.push([true, label, value === undefined ? '' : String(value)]);
  } catch (error) {
    results.push([false, label, error.message]);
    throw new Error(`${label} :: ${error.message}`);
  }
};
/** Assert a boolean; a falsy verdict is a failure and fails the block it is in. */
const assert = (label, condition, detail) => {
  const ok = Boolean(condition);
  results.push([ok, label, detail === undefined ? '' : String(detail)]);
  if (!ok) throw new Error(`${label}${detail === undefined ? '' : ` :: ${detail}`}`);
};

// Every section is a top-level `test("literal", …)` block, and the literal is
// load-bearing: lgtm's `extractTests` only recognises a call rooted at `it` or
// `test` whose first argument is a string literal. Routing the sections through
// a `section(name, body)` helper — or even `test(someVariable, …)` — hides them
// from it completely, which is how this suite ended up invisible to the plugin
// it exists to test.

// Hoisted because more than one block reads them. Everything else stays inside
// the block that owns it.
const status = t.statusTool({ get: () => undefined }, () => ({ credentialRef: 'TYPESAFE_API_KEY', version: 'latest' }));
const audit = t.auditTool({ get: () => undefined }, () => ({ provider: '', credentialRef: 'TYPESAFE_API_KEY' }));
const llmSection = {
  providers: {
    typesafe: { apiKeyEnv: 'TYPESAFE_API_KEY', baseURL: 'https://api.typesafe.ai' },
    'openrouter-jev': { apiKeyEnv: 'OPENROUTER_JEV_API_KEY', baseURL: 'https://openrouter.ai/api' },
    keyless: { baseURL: 'https://example.test/v1' },
  },
};
const settingsStub = { get: (ns) => (ns === 'llm-pi-ai' ? llmSection : undefined) };
const resolved = t.resolveLgtm();
const withoutKey = { credentials: { resolve: async () => undefined } };
const jsonReport = {
  findings: [
    { file: 'test/a.test.js', line: 12, name: 'rejects a duplicate', checkId: 'vacuous-assertion', probability: 0.82, threshold: 0.6 },
    { file: 'test/b.test.js', line: 3, name: 'maps a user', checkId: 'would-pass-if-broken', probability: 0.7, threshold: 0.6, high: 0.9 },
    { file: 'test/c.test.js', line: 9, name: 'sub threshold', checkId: 'over-mocked', probability: 0.55, threshold: 0.6 },
  ],
  checks: {
    'vacuous-assertion': { emoji: '😐🤏', blurb: 'accepts wrong output too', explanation: 'pin the exact value', threshold: 0.6 },
    'would-pass-if-broken': { emoji: '😐🤏', blurb: 'the fixture misses the branch', explanation: 'move it', threshold: 0.6 },
  },
  classes: [],
  tests: 12,
  files: 3,
  skipped: 1,
  inputTokens: 4200,
  durationMs: 5300,
  verbose: false,
  distribution: '2 contract-integration · 1 mocked-seam · 9 pure-logic',
};

test("the plugin's loader-facing shape is what the Cordis loader expects", async () => {
report('plugin exports its loader name', () => mod.name);
report('plugin declares its injected services', () => mod.inject.join(','));
report('apply is a function', () => typeof mod.apply);
assert(
  'settings is deferred, not a hard dependency',
  !mod.inject.includes('settings'),
  mod.inject.join(','),
);
assert('inject still lists the genuinely required services', ['tools', 'shell', 'credentials', 'skills'].every((s) => mod.inject.includes(s)), mod.inject.join(','));
assert('the commands service is not injected', !mod.inject.includes('commands'), mod.inject.join(','));
assert('the package is the documented one', mod.LGTM_PACKAGE === '@stardeckai/lgtm', mod.LGTM_PACKAGE);
});

test("both tool schemas compile under the DSH schema DSL", async () => {
// The name is a claim about the DSL, so it has to be asserted against the thing
// that enforces the DSL, not against the tools' own names. lgtm flagged the
// earlier version of this block as `assertion-weaker-than-name` at 0.77: it was
// named for compilation and asserted `status.name`. The two `report(...)` probes
// below are now real checks, and the negative control is the claim itself —
// `defineTool` rejects an object node that does not declare `additionalProperties`,
// while the looser `assertObjectJsonSchema` guard accepts it, so only the
// compiler can prove this.
report('the status output schema is a supported, object-rooted schema', () => {
  assertObjectJsonSchema(status.output.schema);
  return 'object-rooted';
});
report('the audit output schema is a supported, object-rooted schema', () => {
  assertObjectJsonSchema(audit.output.schema);
  return 'object-rooted';
});
report('the audit parameter schema is a supported node', () => {
  assertSupportedJsonSchema(audit.parameters);
  return audit.parameters.type;
});
let schemaError;
try {
  defineTool({
    name: 'probe',
    description: 'a schema the DSL must refuse',
    parameters: {},
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean', required: true } } },
      render: () => [{ type: 'text', text: 'x' }],
    },
    execute: async () => ({ ok: true }),
  });
} catch (error) {
  schemaError = error;
}
assert(
  'an object node with no additionalProperties is refused by the DSL',
  schemaError?.code === 'UNSUPPORTED_SCHEMA',
  schemaError === undefined ? 'the DSL accepted it' : `${schemaError.code}: ${schemaError.message}`,
);
assert(
  'the audit declares a cooperative deadline',
  audit.timeoutMs > 0,
  String(audit.timeoutMs),
);
assert(
  'the audit asks for a plan-or-run, never both',
  Object.keys(audit.parameters.properties).join(',') === 'target,plan,workdir',
  Object.keys(audit.parameters.properties).join(','),
);
assert('no lgtm_setup command is exported', t.setupCommand === undefined);
assert('no global-install helper is exported', t.ensureLgtm === undefined);
});

test("the settings section carries exactly one field", async () => {
report('settings schema compiles', () => t.Config({}).provider);
assert('the settings namespace is "lgtm-dsh"', t.SETTINGS_NS === 'lgtm-dsh', t.SETTINGS_NS);
assert('the version is not a config field', t.Config({}).version === undefined, String(t.Config({}).version));
assert(
  'the credential reference is not a config field either',
  t.Config({}).credentialRef === undefined,
  String(t.Config({}).credentialRef),
);
assert(
  'the schema carries exactly one choice',
  Object.keys(t.Config({})).join(',') === 'provider',
  Object.keys(t.Config({})).join(','),
);
assert('no route selected defaults to an empty provider', t.Config({}).provider === '');
});

test("the credential reference follows the selected route", async () => {
// The route owns which credential it authenticates with, so the reference is read
// back from that route's profile instead of being stored a second time.

assert(
  'the reference follows the selected route',
  t.credentialRefFor(settingsStub, 'openrouter-jev') === 'OPENROUTER_JEV_API_KEY',
  t.credentialRefFor(settingsStub, 'openrouter-jev'),
);
assert(
  'the default route yields the reference lgtm reads',
  t.credentialRefFor(settingsStub, 'typesafe') === 'TYPESAFE_API_KEY',
);
assert('no selection falls back to the reference lgtm reads', t.credentialRefFor(settingsStub, '') === 'TYPESAFE_API_KEY');
assert('an unknown route falls back too', t.credentialRefFor(settingsStub, 'nope') === 'TYPESAFE_API_KEY');
assert('a route declaring no apiKeyEnv falls back', t.credentialRefFor(settingsStub, 'keyless') === 'TYPESAFE_API_KEY');
assert('a missing settings provider falls back', t.credentialRefFor(undefined, 'typesafe') === 'TYPESAFE_API_KEY');
assert(
  'a throwing settings provider falls back',
  t.credentialRefFor({ get: () => { throw new Error('no seam'); } }, 'typesafe') === 'TYPESAFE_API_KEY',
);
});

test("dependency resolution names a usable CLI or an actionable fix", async () => {
// One source: the copy that shipped with the plugin. The version is a dependency
// fact, so the resolver takes no version argument.
assert('resolveLgtm reports presence as a boolean', typeof resolved.present === 'boolean', String(resolved.present));

if (resolved.present) {
  assert('a present CLI path exists on disk', existsSync(resolved.cli), resolved.cli);
  assert('a present package reports a version', typeof resolved.version === 'string', resolved.version);
  assert('the CLI is the declared bin', /cli\.js$/.test(resolved.cli), resolved.cli);
  console.log(`      (shipped copy present in this tree: ${resolved.version} at ${resolved.cli})`);
} else {
  assert('an absent package explains the fix', /dsh plugin --profile/.test(resolved.reason), resolved.reason);
  assert('the absent reason names the package', resolved.reason.includes('@stardeckai/lgtm'));
  console.log(`      (shipped copy absent in this tree — exercising the failure path)`);
}
});

test("shell quoting survives the paths this plugin produces", async () => {
// Everything this plugin quotes is a filesystem path, a git ref, or a package
// spec. A Windows profile path contains spaces, so quoting is load-bearing.
const win = process.platform === 'win32';
assert(
  'a plain path is quoted',
  t.quote('C:/a/b/cli.js') === "'C:/a/b/cli.js'",
  t.quote('C:/a/b/cli.js'),
);
assert(
  'a path with a space stays one argument',
  t.quote('C:/Program Files/x/cli.js') === "'C:/Program Files/x/cli.js'",
  t.quote('C:/Program Files/x/cli.js'),
);
assert(
  'an embedded single quote is escaped for this shell',
  t.quote("it's") === (win ? "'it''s'" : "'it'\\''s'"),
  t.quote("it's"),
);
assert('quoting is shell-appropriate', t.quote("it's").includes(win ? "''" : "'\\''"));
});

test("collectStatus agrees with the resolver and the credential seam", async () => {
// `credentials` is a required service, so the stub supplies it where an injected
// service actually lives: on the context itself, not behind `ctx.get()`.
const absent = await t.collectStatus(withoutKey, { credentialRef: 'TYPESAFE_API_KEY' });
assert('status is never ready without a credential', absent.ready === false, `ready=${absent.ready}`);
assert('status mirrors the resolver', absent.lgtm.installed === resolved.present, `installed=${absent.lgtm.installed}`);
assert('status reports no managers field', absent.managers === undefined);
assert('status reports no version control state', absent.lgtm.source === undefined, String(absent.lgtm.source));

const withKey = { credentials: { resolve: async (ref) => ({ value: 'redacted', source: 'file', ref }) } };
const present = await t.collectStatus(withKey, { credentialRef: 'MY_OWN_REF' });
assert('the configured reference is the one resolved', present.credential.ref === 'MY_OWN_REF', present.credential.ref);
assert('a resolving credential is reported present', present.credential.present === true);
assert(
  'readiness is exactly CLI-and-credential',
  present.ready === (resolved.present && true),
  `ready=${present.ready} installed=${resolved.present}`,
);
report('status render produces text', () => t.renderStatus(present).split('\n')[0]);

// --- rendering --------------------------------------------------------------
report('status render is multi-line', () => t.renderStatus(present).split('\n').length);
assert(
  'an unready status never claims readiness',
  t.renderStatus(absent).startsWith('lgtm ready: no'),
  t.renderStatus(absent).split('\n')[0],
);
});

test("the audit command line is one lgtm's own parseArgs accepts", async () => {
// lgtm's `parseArgs` is the authority: `--diff` takes an OPTIONAL value, and a
// bare one is only recognized when the next argument looks like a flag, so the
// order here is load-bearing rather than cosmetic.
//
// PowerShell adds a second authority. A quoted path at the start of a statement
// is an expression, not a command, so the runner needs `&` — and `&` backgrounds
// a POSIX pipeline, so the operator is Windows-only. A live host caught this:
// without it, the tool's own command string came back as `ParserError`.
const cli = 'C:/p/node_modules/@stardeckai/lgtm/dist/cli.js';
const win = process.platform === 'win32';
const node = `${win ? '& ' : ''}${t.quote(process.execPath)}`;
assert(
  'a default audit diffs against the default branch and asks for JSON',
  t.auditCommand(cli, {}) === `${node} '${cli}' --diff --yes --format json`,
  t.auditCommand(cli, {}),
);
assert(
  'Windows gets the call operator, POSIX does not',
  t.auditCommand(cli, {}).startsWith(win ? "& '" : "'"),
  t.auditCommand(cli, {}).slice(0, 3),
);
assert(
  'the call operator precedes the quoted runner only',
  t.auditCommand(cli, {}).indexOf('&') === (win ? 0 : -1),
  t.auditCommand(cli, {}),
);
assert('a named target replaces the diff selector', t.auditCommand(cli, { target: '.' }).includes("'.'"));
assert('a named target drops --diff entirely', !t.auditCommand(cli, { target: '.' }).includes('--diff'));
assert(
  'every flag after a bare --diff is a flag',
  t.auditCommand(cli, { target: '.' }).endsWith('--yes --format json'),
  t.auditCommand(cli, { target: '.' }),
);
assert(
  'the free estimate passes --dry-run and asks for no report',
  t.auditCommand(cli, { plan: true }) === `${node} '${cli}' --diff --dry-run`,
  t.auditCommand(cli, { plan: true }),
);
assert('the free estimate never carries --yes', !t.auditCommand(cli, { plan: true }).includes('--yes'));
assert('the runner is an absolute node, not a PATH lookup', /node(\.exe)?/.test(process.execPath), process.execPath);
});

test("confidence bands mirror lgtm's certain and highLine", async () => {
// Mirrors lgtm's own `certain`/`highLine`: 0.15 over the finding's own
// threshold, capped at 0.95, unless the check pinned its own line.
assert('the margin is lgtm\'s', t.CERTAIN_MARGIN === 0.15, String(t.CERTAIN_MARGIN));
assert('0.15 over the threshold is high', t.confidenceOf({ probability: 0.75, threshold: 0.6 }) === 'high');
assert(
  'just under the margin is only worth a look',
  t.confidenceOf({ probability: 0.74, threshold: 0.6 }) === 'worth-a-look',
  t.confidenceOf({ probability: 0.74, threshold: 0.6 }),
);
assert(
  'a check that pins its own line is held to it',
  t.confidenceOf({ probability: 0.62, threshold: 0.6, high: 0.61 }) === 'high',
);
assert(
  'a pinned line above the score is not cleared',
  t.confidenceOf({ probability: 0.62, threshold: 0.6, high: 0.9 }) === 'worth-a-look',
);
assert(
  'the margin stops at 0.95',
  t.confidenceOf({ probability: 0.94, threshold: 0.9 }) === 'worth-a-look' &&
    t.confidenceOf({ probability: 0.95, threshold: 0.9 }) === 'high',
  `${t.confidenceOf({ probability: 0.94, threshold: 0.9 })}/${t.confidenceOf({ probability: 0.95, threshold: 0.9 })}`,
);
});

test("lgtm's JSON report normalizes to the declared output shape", async () => {
// The JSON shape is lgtm's `formatReport(..., 'json', summary)`: findings and
// checks are pretty-printed, thresholds ride on each finding, and `checks` only
// explains the ids that actually fired.
const normalized = t.normalizeReport(jsonReport);
assert('a row under its own threshold is dropped', normalized.findings.length === 2, String(normalized.findings.length));
assert('a finding clear of its threshold is high', normalized.findings[0].confidence === 'high');
assert('a pinned high line demotes a finding', normalized.findings[1].confidence === 'worth-a-look');
assert('every fired check is carried once', normalized.checks.length === 2, String(normalized.checks.length));
assert('a check keeps lgtm\'s own wording', normalized.checks[0].blurb === 'accepts wrong output too');
assert(
  'the run counts survive',
  normalized.tests === 12 && normalized.files === 3 && normalized.skipped === 1 && normalized.inputTokens === 4200,
  JSON.stringify([normalized.tests, normalized.files, normalized.skipped, normalized.inputTokens]),
);
assert('the distribution line survives', normalized.distribution.startsWith('2 contract-integration'));
assert('a missing report normalizes to nothing, not a crash', t.normalizeReport(undefined).findings.length === 0);
assert('a report with no findings has no checks', t.normalizeReport({ findings: [] }).checks === undefined);
});

test("the price the plugin charges equals the one lgtm ships", async () => {
// lgtm owns the price and the JSON report carries tokens only, so the plugin
// prices it. This re-reads lgtm's own constant rather than trusting the copy.
const lgtmChecks = new URL('../node_modules/@stardeckai/lgtm/dist/checks/index.js', import.meta.url);
if (existsSync(lgtmChecks)) {
  const declared = /USD_PER_INPUT_TOKEN\s*=\s*([\d.e-]+)\s*\/\s*([\d_]+)/.exec(readFileSync(lgtmChecks, 'utf8'));
  assert('lgtm still declares a per-token price', declared !== null);
  if (declared) {
    const theirs = Number(declared[1]) / Number(declared[2].replace(/_/g, ''));
    assert(
      'the plugin prices a report at lgtm\'s own rate',
      Math.abs(theirs - t.USD_PER_INPUT_TOKEN) < Number.EPSILON,
      `${theirs} vs ${t.USD_PER_INPUT_TOKEN}`,
    );
  }
} else {
  console.log('      (shipped lgtm absent — price cross-check skipped)');
}
});

test("collectAudit over the shell seam yields values the schema accepts", async () => {
// The shell service is the only thing between this plugin and a real lgtm, so
// every fact it is handed is asserted here: the command, the environment, the
// absence of stdin, the output budget, and the refusal to escalate the sandbox.
const specs = [];
const runCtx = (stdout, stderr = '', exitCode = 0) => ({
  get: () => undefined,
  credentials: { resolve: async (ref) => ({ value: 'sekret-value', source: 'file', ref }) },
  shell: {
    resolve: (request) => request,
    run: async (spec) => {
      specs.push(spec);
      return {
        exitCode,
        timedOut: false,
        signal: null,
        sandbox: { mode: 'workspace-write', denied: false },
        stdout: { text: stdout, truncated: false },
        stderr: { text: stderr, truncated: false },
      };
    },
  },
});
const state = { provider: '', credentialRef: 'TYPESAFE_API_KEY' };

const planValue = await t.collectAudit(
  runCtx('will run on 3 tests in 1 file, 17 checks each\n\nestimated cost:    ~1234 input tokens ≈ $0.0001\n'),
  state,
  { plan: true },
  {},
);
assert('an estimate is ok without findings', planValue.ok === true && planValue.findings.length === 0);
assert('an estimate keeps lgtm\'s own plan lines', planValue.plan.some((line) => line.includes('estimated cost')));
assert('the key is handed over as the variable lgtm reads', specs.at(-1).env.TYPESAFE_API_KEY === 'sekret-value');
assert('the child is told not to colour its output', specs.at(-1).env.NO_COLOR === '1');
assert('the credential never reaches the tool result', !JSON.stringify(planValue).includes('sekret-value'));
assert('stdin is left unset so lgtm cannot prompt', specs.at(-1).stdin === undefined);
assert('the output budget is above the executor default', specs.at(-1).stdoutMaxBytes > 64_000, String(specs.at(-1).stdoutMaxBytes));
assert('no self-granted sandbox escalation', specs.at(-1).sandboxPolicy === undefined);
assert('the estimate is bounded well under the audit deadline', specs.at(-1).timeoutMs < 600_000, String(specs.at(-1).timeoutMs));
report('an estimate renders as an estimate', () => t.renderAudit(planValue).split('\n')[0]);

const reportValue = await t.collectAudit(runCtx(JSON.stringify(jsonReport)), state, {}, {});
assert('a JSON report becomes findings', reportValue.ok === true && reportValue.findings.length === 2);
assert('the audit deadline is the executor cap', specs.at(-1).timeoutMs === 600_000, String(specs.at(-1).timeoutMs));
assert(
  'the cost is priced from the token count',
  Math.abs(reportValue.costUsd - 4200 * t.USD_PER_INPUT_TOKEN) < Number.EPSILON,
  String(reportValue.costUsd),
);
assert('a skipped block is called out', reportValue.notes.some((note) => note.includes('skipped')));
assert('the rendered report counts the bands', t.renderAudit(reportValue).includes('1 high, 1 worth a look'), t.renderAudit(reportValue).split('\n')[0]);

const cleanValue = await t.collectAudit(runCtx(JSON.stringify({ findings: [], checks: {}, tests: 4, files: 1 })), state, {}, {});
assert('an empty report is a clean run', cleanValue.ok === true && cleanValue.findings.length === 0);
assert('a clean run renders as clean', t.renderAudit(cleanValue).includes('nothing to report'), t.renderAudit(cleanValue));

// A skipped block was never judged, so a headline of "nothing to report" over a
// partly-skipped run is the false clean this plugin exists to prevent. A live
// run produced exactly that: 12 of 13 blocks skipped, headline "fine?".
const partlySkipped = t.renderAudit({ ok: true, findings: [], tests: 13, files: 1, skipped: 12 });
assert(
  'a partly-skipped run is never reported as clean',
  !partlySkipped.includes('nothing to report'),
  partlySkipped.split('\n')[0],
);
assert('a partly-skipped run says how many were judged', partlySkipped.includes('1 of 13'), partlySkipped.split('\n')[0]);
const allSkipped = t.renderAudit({ ok: true, findings: [], tests: 5, files: 1, skipped: 5 });
assert('a fully-skipped run claims no verdict', allSkipped.includes('nothing was judged'), allSkipped.split('\n')[0]);
assert(
  'a finding-bearing run counts what was judged, not what was sent',
  t.renderAudit({ ok: true, findings: [{ file: 'a.js', line: 1, name: 'n', checkId: 'vacuous-assertion', probability: 0.9, confidence: 'high' }], tests: 9, files: 1, skipped: 4 }).includes('5 of 9'),
  t.renderAudit({ ok: true, findings: [{ file: 'a.js', line: 1, name: 'n', checkId: 'vacuous-assertion', probability: 0.9, confidence: 'high' }], tests: 9, files: 1, skipped: 4 }).split('\n')[0],
);
assert('a clean run reports no notes', cleanValue.notes === undefined, JSON.stringify(cleanValue.notes));

// The three shapes that mean "nothing was judged" must never read as clean.
const before = specs.length;
const silent = await t.collectAudit(runCtx(''), state, {}, {});
assert('exit 0 with no report is not a clean run', silent.ok === false && silent.findings.length === 0);
assert('the silent run still went to the shell', specs.length === before + 1);
assert('a did-not-run renders as did-not-run', t.renderAudit(silent).startsWith('lgtm: the audit did not run'));

const rejected = await t.collectAudit(
  runCtx('', 'TypeSafe rejected the API key. Run: lgtm init', 2),
  { provider: 'openrouter-jev', credentialRef: 'OPENROUTER_JEV_API_KEY' },
  {},
  {},
);
assert('an auth rejection names the route that supplied the key', rejected.notes[0].includes('openrouter-jev'), rejected.notes[0]);
assert('an auth rejection does not forward lgtm\'s own advice', !rejected.notes[0].includes('lgtm init'));

// Every other exit 2 is lgtm's own diagnosis and is forwarded unchanged: an
// unknown ref, a target that is not there.
const unknownRef = 'Error: --diff: unknown ref nobody-knows-this';
const unknownRun = await t.collectAudit(runCtx('', unknownRef, 2), state, {}, {});
assert('an unknown ref forwards lgtm\'s message verbatim', unknownRun.notes[0] === unknownRef, unknownRun.notes[0]);

// The missing-default-branch message is the one case where lgtm's own advice
// (`--diff <ref>`) is unusable — this tool has no such parameter, and no ref can
// help a directory that is not a work tree. Point the caller at the action that
// does exist.
const noBranch = 'Error: --diff: no default branch found (tried origin/HEAD, origin/main, main, master) — pass --diff <ref>';
const gitless = await t.collectAudit(runCtx('', noBranch, 2), state, {}, {});
assert(
  'a missing default branch points at the target instead',
  gitless.notes[0].includes('target: "."'),
  gitless.notes[0],
);
assert('a missing default branch does not repeat --diff advice', !gitless.notes[0].includes('--diff'), gitless.notes[0]);

const garbage = await t.collectAudit(runCtx('not json at all'), state, {}, {});
assert('an unparsable report is a failure, not an empty one', garbage.ok === false && garbage.findings.length === 0);

// A missing credential must stop before anything is spent.
const spendBefore = specs.length;
const keyless = { get: () => undefined, credentials: { resolve: async () => undefined } };
const noKey = await t.collectAudit(keyless, state, {}, {});
assert('a missing credential is not ready', noKey.ok === false && /resolves to no value/.test(noKey.notes[0]));
assert('a missing credential never reaches the shell', specs.length === spendBefore);

// A killed child is reported as killed, with the mode that killed it.
const killed = await t.collectAudit(
  { ...runCtx(''), shell: { resolve: (r) => r, run: async () => ({ exitCode: null, timedOut: true, signal: 'SIGKILL', stdout: { text: '' }, stderr: { text: '' } }) } },
  state,
  {},
  {},
);
assert('a killed audit is a failure', killed.ok === false && /was still running/.test(killed.notes[0]), killed.notes[0]);

// --- every value must satisfy the declared output schema ---------------------
// The registry validates `execute`'s return against `output.schema` before it
// materializes anything, so a value that misses the declaration is a runtime
// failure that no other assertion here would catch. Run the registry's own
// validator over every shape this tool can return.
const auditSchema = audit.output?.schema;
assert('the audit declares an output schema', auditSchema !== undefined && typeof auditSchema === 'object');
const produced = { planValue, reportValue, cleanValue, silent, rejected, gitless, garbage, noKey, killed };
for (const [label, value] of Object.entries(produced)) {
  const errors = validateJsonSchemaValue(auditSchema, value);
  assert(`the ${label} value satisfies the declared schema`, errors.length === 0, errors.join('; '));
}
const statusErrors = validateJsonSchemaValue(
  status.output?.schema,
  await t.collectStatus(withoutKey, { credentialRef: 'TYPESAFE_API_KEY' }),
);
assert('the status value satisfies its declared schema', statusErrors.length === 0, statusErrors.join('; '));
});

test("apply wires the settings section and registers both tools", async () => {
// The documented plugin-configuration path is a `config:` block on the patch
// row, which Cordis validates against the exported schema before `apply` runs.
// A plugin that already has a cordis.yml entry reaches it through
// `settings.installSection`, which layers that entry under the user document and
// hands back a live source getter.
const applied = {};
const registeredTools = [];
const injectedServices = [];
const fakeCtx = {
  get: () => undefined,
  logger: { info: () => {}, warn: () => {} },
  effect: (fn) => { try { fn(); } catch { /* registration disposers are inert here */ } },
  on: () => () => {},
  // `settings` is deliberately absent from the top-level inject, so it arrives
  // through a deferred inject exactly as the cookbook wires it.
  inject: (services, callback) => {
    injectedServices.push(services);
    if (!services.includes('settings')) return;
    callback({
      settings: {
        // The host reads a route's credential reference back out of `llm-pi-ai`,
        // so the stub has to answer for that namespace too.
        get: (ns) => (ns === 'llm-pi-ai' ? llmSection : undefined),
        installSection: (owner, ns, schema, entry, hooks) => {
          applied.owner = owner;
          applied.ns = ns;
          applied.schema = schema;
          applied.entry = entry;
          applied.hooks = hooks;
        },
      },
    });
  },
  credentials: { resolve: async (ref) => ({ value: 'x', source: 'file', ref }) },
  skills: { registerProvider: () => () => {}, register: () => () => {} },
  tools: { register: (tool) => { registeredTools.push(tool); return () => {}; } },
  shell: { resolve: (request) => request, run: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) },
};

const rowConfig = { provider: 'typesafe' };
let applyError2;
try {
  mod.apply(fakeCtx, rowConfig);
} catch (error) {
  applyError2 = error;
}
assert('apply accepts a composition config', applyError2 === undefined, applyError2?.message);
assert('apply defers on the settings service', injectedServices.some((s) => s.includes('settings')), JSON.stringify(injectedServices));
assert('apply installs the settings section', applied.ns === 'lgtm-dsh', String(applied.ns));
assert('the composition entry becomes the section base', applied.entry === rowConfig, JSON.stringify(applied.entry));
assert('the section is owned by this plugin context', applied.owner === fakeCtx);
assert('installSection hands back a source sink', typeof applied.hooks?.setSource === 'function');
assert('installSection takes a change hook', typeof applied.hooks?.onChange === 'function');

// installSection replaces the source with the live section getter; the status
// tool must follow it, and derive the reference from whatever route it names.
applied.hooks.setSource(() => ({ provider: 'openrouter-jev' }));
const statusTool = registeredTools.find((tool) => tool.name === 'lgtm_status');
assert('the status tool is registered', statusTool !== undefined);
assert('the audit tool is registered too', registeredTools.some((tool) => tool.name === 'lgtm_audit'));
const fromSection = await statusTool.execute({});
assert(
  'the live section wins over the composition entry',
  fromSection.credential.ref === 'OPENROUTER_JEV_API_KEY',
  String(fromSection.credential.ref),
);
});

/**
 * The label-by-label report, after every block has run. The verdict itself is
 * `node:test`'s: a block that lifted a failed assertion already failed the file,
 * so nothing here has to set an exit code.
 */
after(() => {
  let failedCount = 0;
  for (const [ok, label, detail] of results) {
    if (!ok) failedCount += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
  console.log(`\n${results.length - failedCount}/${results.length} assertions passed`);
});

