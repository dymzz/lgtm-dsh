// Diagnostic: report whether the DSH model routes lgtm-dsh depends on are
// configured and usable. Run with `node scripts/check-providers.mjs`.
//
// Cost-free: it validates the settings section against the adapter's own schema
// and issues GETs to listing endpoints only. It never issues a completion, so it
// spends nothing. Credential values are never printed.
//
// What it can and cannot prove:
//   - It CAN prove the section is well-formed and that a key authenticates.
//   - It CANNOT prove a chat-completion route serves requests: both TypeSafe and
//     OpenRouter answer 404 to a GET on their completion endpoints, so a 404 here
//     is not evidence either way. Use a real audit run for that.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
const settings = parse(readFileSync(join(dshHome, 'settings.yaml'), 'utf8'));
const refs = (() => {
  try {
    return parse(readFileSync(join(dshHome, '.credentials.yaml'), 'utf8')).refs ?? {};
  } catch {
    return {};
  }
})();

const section = settings['llm-pi-ai'];
console.log(`DSH home: ${dshHome}`);
console.log(`llm-pi-ai section: ${section ? 'present' : 'MISSING'}`);
if (!section) process.exit(1);

const { Config } = await import('@deepseek-ai/dsh-llm-pi-ai');
let validated;
try {
  validated = Config(section);
  console.log('schema validation: PASSED (the adapter will accept this section)\n');
} catch (error) {
  console.log('schema validation: FAILED');
  console.log(String(error.message).slice(0, 600));
  process.exit(1);
}

const LGTM_REF = 'TYPESAFE_API_KEY';

for (const [route, profile] of Object.entries(validated.providers ?? {})) {
  const ref = profile.apiKeyEnv;
  const present = Boolean(refs[ref]);
  const usableByLgtm = ref === LGTM_REF;
  console.log(`route "${route}"`);
  console.log(`  displayName : ${profile.displayName ?? '(none)'}`);
  console.log(`  api         : ${profile.api}`);
  console.log(`  baseURL     : ${profile.baseURL}`);
  console.log(`  apiKeyEnv   : ${ref ?? '(none)'} -> ${present ? 'value present' : 'NO VALUE'}`);
  console.log(`  models      : ${(profile.models ?? []).map((m) => m.id).join(', ')}`);
  console.log(`  lgtm can use: ${usableByLgtm ? 'YES (lgtm reads this exact reference)' : `no (lgtm reads only ${LGTM_REF})`}`);

  if (profile.baseURL && present) {
    try {
      const response = await fetch(`${profile.baseURL.replace(/\/$/, '')}/v1/models`, {
        headers: { authorization: `Bearer ${refs[ref]}` },
        signal: AbortSignal.timeout(20_000),
      });
      console.log(`  GET ${profile.baseURL}/v1/models -> ${response.status}`);
      if (response.ok) {
        const body = await response.text();
        const ids = [...body.matchAll(/"name"\s*:\s*"([^"]+)"|"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
        if (ids.length > 0) console.log(`    advertises: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ', …' : ''}`);
      }
    } catch (error) {
      console.log(`  GET ${profile.baseURL}/v1/models -> network error: ${error.message}`);
    }
  }
  console.log('');
}

const hasLgtmRef = Boolean(refs[LGTM_REF]);
console.log(
  hasLgtmRef
    ? `lgtm-dsh is ready on the credential side: ${LGTM_REF} resolves.`
    : `lgtm-dsh is NOT ready: ${LGTM_REF} has no value. Add a custom model provider whose apiKeyEnv is ${LGTM_REF}.`,
);
