// Browser-half verification for lgtm-dsh.
//
// Run with `node test/client.test.js`. There is no browser here, so this drives
// client/client.js through a stubbed module loader and a minimal React shim whose
// `createElement` invokes function components eagerly and whose hook state
// survives re-renders.
//
// What it proves: the loader shell and factory shape, the Cordis plugin object
// the web app expects, that `require` reaches for nothing but `react` and that
// the bundle touches no DOM at apply or render time, that `apply` registers into
// `settings.plugin.item` under the same namespace the Host registers, that the
// card renders real markup in every catalog state, that the model picker defaults
// to an early usable route, that the staged-form contract holds (an edit writes
// nothing until Save, Discard drops it, a successful save collapses), and that a
// release list which fails to load can never change the stored version.
//
// What it does NOT prove: real React rendering, CSS layout, or how the slot host
// feeds props. Those go through the `--patch` channel against a live web app —
// see docs/aegis/plans/ section 12 P7.

import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';

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

/** Concatenate every string in a rendered element tree. */
const textOf = (node) => {
  if (typeof node === 'string') return node;
  if (node === null || node === undefined || typeof node !== 'object') return '';
  const kids = node.children;
  return Array.isArray(kids) ? kids.map(textOf).join(' ') : textOf(kids);
};

/** Collect every node whose type matches, depth-first. */
const nodesOfType = (node, type, found = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (node.type === type) found.push(node);
  const kids = node.children;
  if (Array.isArray(kids)) kids.forEach((kid) => nodesOfType(kid, type, found));
  else nodesOfType(kids, type, found);
  return found;
};

/** Collect every `style` object in the tree, for token assertions. */
const stylesOf = (node, found = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (node.props?.style !== undefined) found.push(node.props.style);
  const kids = node.children;
  if (Array.isArray(kids)) kids.forEach((kid) => stylesOf(kid, found));
  else stylesOf(kids, found);
  return found;
};

/** Collect nodes carrying a given className token. */
const nodesWithClass = (node, className, found = []) => {
  if (node === null || node === undefined || typeof node !== 'object') return found;
  if (String(node.props?.className ?? '').split(/\s+/).includes(className)) found.push(node);
  const kids = node.children;
  if (Array.isArray(kids)) kids.forEach((kid) => nodesWithClass(kid, className, found));
  else nodesWithClass(kids, className, found);
  return found;
};

// --- stub the platform ------------------------------------------------------
let captured;
globalThis.window = { __ModuleLoader__: { load: (definition) => { captured = definition; } } };

// `document` is deliberately NOT defined: the card styles itself inline and
// injects no stylesheet, so any DOM access at apply or render time would throw
// here and fail the suite.
let documentTouched = false;
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  get() {
    documentTouched = true;
    return undefined;
  },
});

// A miniature React: hook state persists across renders so an effect's state
// update is observable on the next render.
let hookStates = [];
let hookIndex = 0;
let pendingEffects = [];

const fakeReact = {
  createElement: (type, props, ...children) => {
    const merged = { ...(props ?? {}) };
    if (children.length > 0) merged.children = children.length === 1 ? children[0] : children;
    if (typeof type === 'function') return type(merged);
    return { type, props: merged, children: merged.children };
  },
  useState: (initial) => {
    const slot = hookIndex++;
    if (!(slot in hookStates)) hookStates[slot] = typeof initial === 'function' ? initial() : initial;
    return [hookStates[slot], (next) => { hookStates[slot] = typeof next === 'function' ? next(hookStates[slot]) : next; }];
  },
  useEffect: (fn) => { hookIndex++; pendingEffects.push(fn); },
};

/** Anything beyond `react` is a dependency this bundle must not have. */
const requireShim = (specifier) => {
  if (specifier === 'react') return fakeReact;
  throw new Error(`unexpected require("${specifier}") — this bundle must depend on react alone`);
};

/** Render once, running the effects the render registered. */
const renderOnce = (renderFn, props) => {
  hookIndex = 0;
  pendingEffects = [];
  const tree = renderFn(props);
  for (const effect of pendingEffects) effect();
  return tree;
};

/** Release the microtask queue so a resolved fetch chain or save can settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The header button — the only one carrying `aria-expanded`. */
const headerOf = (tree) => nodesOfType(tree, 'button').find((node) => 'aria-expanded' in node.props);

/** Render, click the header, then render again — the card is now open. */
const renderOpen = (renderFn, props) => {
  const tree = renderOnce(renderFn, props);
  headerOf(tree)?.props.onClick();
  return renderOnce(renderFn, props);
};

/** Find a button by its visible label. */
const buttonFor = (tree, label) => nodesOfType(tree, 'button').find((node) => textOf(node) === label);

/** Find a select by one of its option values. */
const selectFor = (tree, optionValue) =>
  nodesOfType(tree, 'select').find((node) => (node.children ?? []).some((option) => option?.props?.value === optionValue));

/** The option values of a select, in order. */
const valuesOf = (select) => (select.children ?? []).map((option) => option.props.value);

// Hoisted because more than one block reads them. `registration` and `tree` are
// assigned inside the block that produces them.
const writes = [];
const makeScope = (value) => ({
  getSnapshot: () => ({ status: 'ready', value, writable: true }),
  subscribe: () => () => {},
  set: async (name, next) => { writes.push([name, next]); },
  unset: async (name) => { writes.push([name, undefined]); },
});
let registration;
let tree;
let live;

test("the bundle loads through the loader shell and yields a Cordis plugin", async () => {
const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
// Executing the bundle IS the test; the loader shell is the thing under test.
new Function('window', 'require', source)(globalThis.window, requireShim);

report('bundle called __ModuleLoader__.load', () => (captured ? 'yes' : 'NO'));
assert('bundle declares its loader id', captured.id === 'lgtm-dsh', captured.id);

const plugin = captured.factory(requireShim);
report('factory returns a Cordis plugin object', () => Object.keys(plugin).join(','));
assert('browser plugin name matches the host plugin', plugin.name === 'lgtm-dsh', plugin.name);
assert(
  'the browser half declares its services at the top level',
  Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('settingsScope'),
  JSON.stringify(plugin.inject),
);

// `slots` and `settingsScope` are declared in `inject`, so they live on the
// context itself — the shape the settings-card cookbook uses.
const registrations = [];
const ctx = {
  effect: () => {},
  settingsScope: { bind: ({ namespace }) => ({ namespace, ...makeScope({}) }) },
  slots: {
    inject: (slot, cb) => { registrations.push({ kind: 'slotInject', slot }); cb(); },
    register: (options, render) => { registrations.push({ kind: 'register', options, render }); return () => {}; },
  },
};

let applyError;
try {
  plugin.apply(ctx);
} catch (error) {
  applyError = error;
}
assert('apply runs without throwing', applyError === undefined, applyError?.message);
assert('apply installs no stylesheet effect and touches no DOM', documentTouched === false);

const slotInject = registrations.find((entry) => entry.kind === 'slotInject');
assert('apply injects the plugin-item slot', slotInject?.slot === 'settings.plugin.item', slotInject?.slot);

registration = registrations.find((entry) => entry.kind === 'register');
assert('card registers into settings.plugin.item', registration?.options.name === 'settings.plugin.item');
assert('card key equals the host settings namespace', registration?.options.key === 'lgtm-dsh', registration?.options.key);
assert(
  'the registration carries nothing but name, key and inject',
  Object.keys(registration?.options ?? {}).sort().join(',') === 'inject,key,name',
  Object.keys(registration?.options ?? {}).join(','),
);
assert(
  'a keyed entry must not claim order',
  registration?.options.order === undefined,
  String(registration?.options.order),
);

const props = registration.options.inject();
assert('card props expose both scopes', props.own !== undefined && props.catalog !== undefined, Object.keys(props).join(','));
});

// --- fixture catalogs -------------------------------------------------------
const TYPESAFE = { displayName: 'typesafe', apiKeyEnv: 'TYPESAFE_API_KEY', baseURL: 'https://api.typesafe.ai' };
const OPENROUTER = { displayName: 'openrouter/jev', apiKeyEnv: 'OPENROUTER_JEV_API_KEY', baseURL: 'https://openrouter.ai/api' };
const FOREIGN = { displayName: 'foreign', apiKeyEnv: 'FOREIGN_KEY', baseURL: 'https://example.test/v1' };

// The card must reach the network for nothing: no fetch stub is installed, and
// any request would throw here.
globalThis.fetch = () => {
  throw new Error('the card must not fetch anything');
};

test("the card renders collapsed by default, like the built-in cards", async () => {
hookStates = [];
tree = renderOnce(registration.render, { own: makeScope({}), catalog: makeScope({ providers: { typesafe: TYPESAFE } }) });
assert('the card renders a container', nodesOfType(tree, 'div').length > 0);
assert('the header names the plugin', textOf(tree).includes('lgtm-dsh'));
assert('the card starts collapsed', nodesOfType(tree, 'select').length === 0);
assert('the header describes what the plugin does', textOf(tree).includes('添加lgtm（使用typesafe Jev 测试）'));
assert(
  'a usable route keeps the header quiet',
  !textOf(tree).includes('需要一个 TypeSafe 凭据'),
  textOf(tree),
);
assert('the header collapses via aria-expanded', headerOf(tree).props['aria-expanded'] === false);
});

test("the card chrome carries the DSH alias tokens", async () => {
const cardStyle = stylesOf(tree).find((style) => style.borderRadius === '12px');
assert('the container uses the built-in 12px radius', cardStyle !== undefined);
assert('the container border is a design token', String(cardStyle?.border).includes('--dsw-alias-border-l2'), String(cardStyle?.border));
assert('the container background is a design token', String(cardStyle?.background).includes('--dsw-alias-bg-layer'), String(cardStyle?.background));
});

test("opening with an empty catalog asks for a model provider", async () => {
hookStates = [];
tree = renderOpen(registration.render, { own: makeScope({}), catalog: makeScope({}) });
assert('expanding renders the body', nodesOfType(tree, 'select').length === 1, String(nodesOfType(tree, 'select').length));
assert('the only control is a native select', nodesOfType(tree, 'select').length === 1);
assert('no route yields the add-provider guidance', textOf(tree).includes('需要添加自定义模型提供方'));
assert(
  'an unusable catalog adds the credential hint to the header',
  textOf(tree).includes('添加lgtm（使用typesafe Jev 测试） · 需要一个 TypeSafe 凭据'),
  textOf(tree).slice(0, 160),
);
assert('guidance names the reference to declare', textOf(tree).includes('apiKeyEnv: TYPESAFE_API_KEY'));
assert('the stale global-install sentence is gone', !textOf(tree).includes('自动安装'));
assert('the stale setup sentence is gone', !textOf(tree).includes('bun → pnpm'));
assert('the card exposes no version control', !textOf(tree).includes('lgtm 版本'));
assert('the card shows no API row', nodesWithClass(tree, 'lgtmdsh-api').length === 0);
});

test("the live catalog offers every route and preselects an early one", async () => {
hookStates = [];
live = { own: makeScope({}), catalog: makeScope({ providers: { typesafe: TYPESAFE, 'openrouter-jev': OPENROUTER } }) };
tree = renderOpen(registration.render, live);

const routeSelect = selectFor(tree, 'typesafe');
assert('the route select lists every registered route', valuesOf(routeSelect).length === 2, valuesOf(routeSelect).join(','));
assert('the model picker defaults to an early usable route', routeSelect.props.value === 'typesafe', String(routeSelect.props.value));

const routeLabels = routeSelect.children.map((option) => textOf(option));
assert('the TypeSafe route is labelled 就绪', routeLabels.some((label) => label.includes('就绪')), routeLabels.join(' | '));
assert(
  'the OpenRouter route is labelled 不匹配',
  routeLabels.some((label) => label.includes('不匹配')),
  routeLabels.join(' | '),
);
assert('a ready route suppresses the add-provider guidance', !textOf(tree).includes('需要添加自定义模型提供方'));
assert('save is disabled while the form is clean', buttonFor(tree, '保存').props.disabled === true);
assert('discard is disabled while the form is clean', buttonFor(tree, '放弃').props.disabled === true);
// Nothing on the card explains the credential: the route's verdict is already in
// the option labels, and the reference is an implementation fact, not a choice.
assert('the card carries no explanatory prose', !textOf(tree).includes('apiKeyEnv'), textOf(tree));
});

test("the staged form writes nothing until Save", async () => {
hookStates = [];
writes.length = 0;
tree = renderOpen(registration.render, live);
await flush();
tree = renderOnce(registration.render, live);
selectFor(tree, 'typesafe').props.onChange({ target: { value: 'openrouter-jev' } });
tree = renderOnce(registration.render, live);

assert('a pick writes nothing before save', writes.length === 0, JSON.stringify(writes));
assert('a pick marks the form dirty', textOf(tree).includes('未保存'));
assert('a pick enables save', buttonFor(tree, '保存').props.disabled === false);
assert('the staged route is shown', selectFor(tree, 'openrouter-jev').props.value === 'openrouter-jev');

buttonFor(tree, '放弃').props.onClick();
tree = renderOnce(registration.render, live);
assert('discard writes nothing', writes.length === 0, JSON.stringify(writes));
assert('discard clears the dirty note', !textOf(tree).includes('未保存'));
assert('discard restores the default route', selectFor(tree, 'typesafe').props.value === 'typesafe');

selectFor(tree, 'typesafe').props.onChange({ target: { value: 'openrouter-jev' } });
tree = renderOnce(registration.render, live);
await buttonFor(tree, '保存').props.onClick();
await flush();
tree = renderOnce(registration.render, live);
assert(
  'save writes the staged route',
  writes.some(([name, next]) => name === 'provider' && next === 'openrouter-jev'),
  JSON.stringify(writes),
);
assert(
  'save writes the route alone — the reference is derived, not stored',
  writes.length === 1 && writes[0][0] === 'provider',
  JSON.stringify(writes),
);
assert('save clears the dirty note', !textOf(tree).includes('未保存'), textOf(tree).slice(0, 120));
assert('a successful save collapses the card', nodesOfType(tree, 'select').length === 0);
});

test("the default selection skips a foreign route declared first", async () => {
hookStates = [];
tree = renderOpen(registration.render, { own: makeScope({}), catalog: makeScope({ providers: { foreign: FOREIGN, typesafe: TYPESAFE } }) });
assert(
  'a foreign route declared first is not the default',
  selectFor(tree, 'foreign').props.value === 'typesafe',
  String(selectFor(tree, 'foreign').props.value),
);
});

test("a stored selection wins over the default", async () => {
hookStates = [];
tree = renderOpen(registration.render, {
  own: makeScope({ provider: 'openrouter-jev' }),
  catalog: makeScope({ providers: { typesafe: TYPESAFE, 'openrouter-jev': OPENROUTER } }),
});
assert('a stored route selection is preserved', selectFor(tree, 'openrouter-jev').props.value === 'openrouter-jev');
});

test("an unwritable document gets the read-only note", async () => {
hookStates = [];
tree = renderOpen(registration.render, {
  own: { getSnapshot: () => ({ status: 'ready', value: {}, writable: false }), subscribe: () => () => {}, set: async () => {} },
  catalog: makeScope({ providers: { typesafe: TYPESAFE } }),
});
assert('an unwritable document shows the read-only note', textOf(tree).includes('不接受设置写入'));
assert('an unwritable document disables every control', selectFor(tree, 'typesafe').props.disabled === true);
});

test("an unserved namespace renders no card at all", async () => {
hookStates = [];
tree = renderOnce(registration.render, {
  own: { getSnapshot: () => ({ status: 'unavailable', value: undefined, writable: false }), subscribe: () => () => {}, set: async () => {} },
  catalog: makeScope({}),
});
assert('an unavailable namespace renders nothing', tree === null, String(tree));
assert('the bundle never reached for the DOM', documentTouched === false);
});

/**
 * The label-by-label report, after every block has run. The verdict itself is
 * `node:test`'s: a block that lifted a failed assertion already failed the file,
 * so nothing here has to set an exit code.
 */
after(() => {
  let failed = 0;
  for (const [ok, label, detail] of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` :: ${detail}` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} assertions passed`);
});

