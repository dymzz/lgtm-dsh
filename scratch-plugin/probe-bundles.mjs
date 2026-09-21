// Probe a running dsh web instance for the client bundles it serves, so a
// --patch mounted source tree can be checked for its browser half.
//
// Usage: node .verify/probe-bundles.mjs <base-url> <token>
const [base, token] = process.argv.slice(2);
if (!base || !token) {
  console.error('usage: node probe-bundles.mjs <base-url> <token>');
  process.exit(2);
}

const handshake = await fetch(`${base}/?token=${token}`, { redirect: 'manual' });
const cookie = (handshake.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0]).join('; ');
console.log(`handshake: ${handshake.status}, cookie: ${cookie ? 'yes' : 'no'}`);

const authed = { headers: cookie ? { cookie } : {} };
const html = await (await fetch(`${base}/`, authed)).text();
console.log(`page bytes: ${html.length}`);

// The boot graph names each plugin bundle; the shell may inline the manifest or
// reference it, so look for both a JSON array and plain URLs.
const urls = new Set();
for (const match of html.matchAll(/["'(]([^"')]*\/plugins\/[^"')]+)/g)) urls.add(match[1]);
for (const match of html.matchAll(/"(plugins\/[^"]+)"/g)) urls.add(`/${match[1]}`);
console.log(`plugin bundle references found: ${urls.size}`);
for (const url of urls) console.log(`  ${url.slice(0, 200)}`);

// The serving protocol is the combo form, not a per-package path: find the
// combo that carries this package and fetch exactly that.
const combo = [...urls].find((url) => url.includes('lgtm-dsh/client.js'));
console.log(`\nlgtm-dsh combo: ${combo ?? 'NOT IN THE BOOT GRAPH'}`);
if (combo) {
  const response = await fetch(`${base}${combo.replace(/&amp;/g, '&')}`, authed);
  const body = await response.text();
  console.log(`  status: ${response.status}, bytes: ${body.length}`);
  console.log(`  loader id: ${body.includes("id: 'lgtm-dsh'") || body.includes('id: "lgtm-dsh"')}`);
  console.log(`  registers the card: ${body.includes('settings.plugin.item')}`);
  console.log(`  is the modlens-style rewrite: ${body.includes('@liustack/modlens')}`);
  console.log(`  uses native selects: ${body.includes("'select'")}`);
  console.log(`  head: ${body.slice(0, 140).replace(/\s+/g, ' ')}`);
}
