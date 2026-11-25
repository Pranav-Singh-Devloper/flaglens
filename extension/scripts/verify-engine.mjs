#!/usr/bin/env node
// Checks FlagLens's local evaluation (src/core/engine.ts) against a running Flagsmith, the authority.
//
//   npm run verify:engine -w extension        (after `make up && make seed`)
//
// For every environment in .env it downloads the environment document, makes up random identities with random
// traits, and asks the server what each one gets. It uses *transient* identities, so nothing is stored in Flagsmith.
// Every flag's enabled state and value must match the local engine's answer exactly.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = join(here, '..', '..', '.env');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OPERATORS = process.argv.includes('--operators');
const COUNT = Number(args[0] ?? 300);

function readDotenv(path) {
  if (!existsSync(path)) throw new Error(`No ${path}. Run make up && make seed first.`);
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
  );
}

// Bundle the TypeScript engine in memory, so this script runs with plain Node.
const bundle = await build({
  stdin: { contents: "export * from './engine'; export { analyseRules } from './rules';", resolveDir: join(here, '..', 'src', 'core'), loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent',
});
const { evaluateFlags, matchingSegments, analyseRules } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const env = { ...readDotenv(envFile), ...process.env };
const api = (env.FLAGSMITH_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
const environments = Object.entries(env).filter(([k]) => k.startsWith('FLAGSMITH_ENV_KEY_'));

// A small seeded PRNG, so a failing run can be repeated exactly (pass a seed as the 2nd argument).
let seed = Number(args[1] ?? Date.now() % 1e9);
const startSeed = seed;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];

function randomPersona(i) {
  const id = `${pick(['user', 'cust', 'visitor'])}-${i}-${Math.floor(rand() * 1e9).toString(36)}`;
  const traits = {};
  if (rand() < 0.3) traits.email = `${id}@${pick(['demo-shop.dev', 'example.com', 'demo-shop.dev.evil.com'])}`;
  if (rand() < 0.7) traits.plan = pick(['free', 'pro', 'team', true, false]);
  if (rand() < 0.7) traits.country = pick(['IN', 'GB', 'DE', 'US', 'in']);
  if (rand() < 0.5) traits.age = Math.floor(rand() * 80);
  if (rand() < 0.5) traits.app_version = pick(['1.9.0', '2.0.0', '2.0.0-beta.1', '2.10.1', 'not-a-version']);
  if (rand() < 0.3) traits.beta = pick([true, false]);
  return { identifier: id, traits };
}

async function json(path, init, attempt = 1) {
  let res;
  try {
    res = await fetch(`${api}/api/v1${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    // A dev-kit server under load sometimes drops a keep-alive connection: retry network errors a few times.
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 250 * attempt));
    return json(path, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status}`);
  return res.json();
}

// --operators: one throwaway segment per rule operator, each switching on its own throwaway flag in Development,
// so every operator's membership decision is compared with the server. Everything is deleted afterwards.
const OPERATOR_RULES = [
  ['EQUAL', 'plan', 'pro'],
  ['NOT_EQUAL', 'plan', 'free'],
  ['GREATER_THAN', 'age', '40'],
  ['GREATER_THAN_INCLUSIVE', 'age', '40'],
  ['LESS_THAN', 'age', '18'],
  ['LESS_THAN_INCLUSIVE', 'age', '18'],
  ['CONTAINS', 'email', 'demo-shop'],
  ['NOT_CONTAINS', 'email', 'example'],
  ['REGEX', 'email', 'cust-'],
  ['REGEX', 'email', '[a-z]+-\\d+-'],
  ['IN', 'country', 'IN,GB'],
  ['MODULO', 'age', '3|1'],
  ['IS_SET', 'beta', null],
  ['IS_NOT_SET', 'country', null],
  ['EQUAL', 'beta', 'true'],
  ['GREATER_THAN_INCLUSIVE', 'app_version', '2.0.0:semver'],
  ['LESS_THAN', 'app_version', '2.0.0:semver'],
  ['PERCENTAGE_SPLIT', null, '37.5'],
  // Python's re.match anchors at the start: this matches no email (they start with the identifier), and must not.
  ['REGEX', 'email', 'demo-shop'],
  ['CONTAINS', '$.identity.identifier', 'visitor'],
];

async function admin(method, path, body) {
  const res = await fetch(`${api}/api/v1${path}`, {
    method,
    headers: { Authorization: `Api-Key ${env.FLAGSMITH_API_KEY}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

const cleanup = [];
const segmentIds = [];
if (OPERATORS) {
  const project = env.FLAGSMITH_PROJECT_ID;
  const devKey = env.FLAGSMITH_ENV_KEY_DEVELOPMENT;
  if (!project || !devKey) throw new Error('--operators needs FLAGSMITH_PROJECT_ID and FLAGSMITH_ENV_KEY_DEVELOPMENT in .env');
  // Leftovers from an aborted run would make the names clash: remove them first.
  const stale = [
    ...(await admin('GET', `/projects/${project}/features/?search=flaglens_verify_&page_size=100`)).results.map((f) => `/projects/${project}/features/${f.id}/`),
    ...(await admin('GET', `/projects/${project}/segments/?page_size=100`)).results.filter((x) => x.name.startsWith('flaglens_verify_')).map((x) => `/projects/${project}/segments/${x.id}/`),
  ];
  for (const path of stale) await admin('DELETE', path);
  console.log(`Creating ${OPERATOR_RULES.length} temporary segments and flags in Development…`);
  process.on('SIGINT', () => void runCleanup().then(() => process.exit(130)));
  try {
    for (const [i, [operator, property, value]] of OPERATOR_RULES.entries()) {
      const feature = await admin('POST', `/projects/${project}/features/`, { name: `flaglens_verify_${i}`, default_enabled: false });
      cleanup.push(() => admin('DELETE', `/projects/${project}/features/${feature.id}/`));
      const segment = await admin('POST', `/projects/${project}/segments/`, {
        name: `flaglens_verify_${i}`,
        project: Number(project),
        rules: [{ type: 'ALL', conditions: [], rules: [{ type: 'ANY', rules: [], conditions: [{ operator, property, value }] }] }],
      });
      cleanup.push(() => admin('DELETE', `/projects/${project}/segments/${segment.id}/`));
      await admin('POST', `/environments/${devKey}/features/${feature.id}/create-segment-override/`, {
        enabled: true,
        feature_state_value: { type: 'unicode', string_value: `${operator} ${property ?? ''} ${value ?? ''}`.trim() },
        feature_segment: { segment: segment.id },
      });
      segmentIds.push(segment.id);
    }
    // A flag dependency ("child requires parent"), with a segment turning the parent on for plan = pro, so the
    // dependency differs per user. Flagsmith stores it as a system segment reading $.flags["parent"].enabled.
    const mkFlag = async (name, on) => {
      const f = await admin('POST', `/projects/${project}/features/`, { name, default_enabled: on });
      cleanup.push(() => admin('DELETE', `/projects/${project}/features/${f.id}/`));
      return f;
    };
    const parent = await mkFlag('flaglens_verify_parent', false);
    const child = await mkFlag('flaglens_verify_child', true);
    await admin('POST', `/environments/${devKey}/features/${parent.id}/create-segment-override/`, {
      enabled: true,
      feature_state_value: { type: 'unicode', string_value: null },
      feature_segment: { segment: segmentIds[0] },
    });
    await admin('POST', `/environments/${devKey}/features/${child.id}/dependencies/${parent.id}/`);
  } catch (e) {
    await runCleanup();
    throw e;
  }
}

async function runCleanup() {
  for (const fn of cleanup.reverse()) await fn().catch((e) => console.log(`  cleanup: ${e.message}`));
}

let failures = 0;
const onCount = new Map();
const samples = []; // { doc, persona, flags } for the rule check below
try {
  for (const [name, key] of environments) {
    if (OPERATORS && !name.endsWith('DEVELOPMENT')) continue;
    const doc = await json(`/environments/${key}/document/`, { headers: { Authorization: `Api-Key ${env.FLAGSMITH_API_KEY}` } });
    let checks = 0;
    let agree = 0;
    const personas = Array.from({ length: COUNT }, (_, i) => randomPersona(i));
    for (let i = 0; i < personas.length; i += 10) {
      await Promise.all(
        personas.slice(i, i + 10).map(async (p) => {
          const server = await json('/identities/', {
            method: 'POST',
            headers: { 'X-Environment-Key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: p.identifier, transient: true, traits: Object.entries(p.traits).map(([trait_key, trait_value]) => ({ trait_key, trait_value })) }),
          });
          samples.push({ doc, persona: p, flags: server.flags });
        const local = evaluateFlags(doc, p);
          for (const f of server.flags) {
            const mine = local.get(f.feature.name);
            checks++;
            if (f.feature.name.startsWith('flaglens_verify_') && f.enabled) onCount.set(f.feature.name, (onCount.get(f.feature.name) ?? 0) + 1);
            if (mine && mine.enabled === f.enabled && mine.value === f.feature_state_value) agree++;
            else if (failures++ < 10) console.log(`  ✖ ${name} ${f.feature.name} for ${JSON.stringify(p)}: server ${f.enabled}/${JSON.stringify(f.feature_state_value)}, local ${mine?.enabled}/${JSON.stringify(mine?.value)}`);
          }
        }),
      );
    }
    // No identity: the server's environment flags must match too (flag dependencies apply even without one).
    const envFlags = await json('/flags/', { headers: { 'X-Environment-Key': key } });
    const noIdentity = evaluateFlags(doc);
    for (const f of envFlags) {
      const mine = noIdentity.get(f.feature.name);
      checks++;
      if (mine && mine.enabled === f.enabled && mine.value === f.feature_state_value) agree++;
      else if (failures++ < 10) console.log(`  ✖ ${name} ${f.feature.name} with no identity: server ${f.enabled}/${JSON.stringify(f.feature_state_value)}, local ${mine?.enabled}/${JSON.stringify(mine?.value)}`);
    }
    const segments = doc.project.segments.filter((s) => s.feature_states.length).length;
    console.log(`${name.replace('FLAGSMITH_ENV_KEY_', '').padEnd(12)} ${COUNT} identities × ${server_flags(doc)} flags = ${checks} checks, ${agree} agree (${((agree / checks) * 100).toFixed(2)}%) · ${segments} segment(s) with overrides`);
  }
} finally {
  // Always remove the temporary segments and flags, even when a request fails half-way.
  if (OPERATORS) await runCleanup();
}

if (OPERATORS) {
  // How many identities matched each operator: a rule that matched nobody (or everybody) would prove little.
  for (const [i, [operator, property, value]] of OPERATOR_RULES.entries()) {
    console.log(`  ${`${operator} ${property ?? '(identity)'} ${value ?? ''}`.padEnd(48)} matched ${String(onCount.get(`flaglens_verify_${i}`) ?? 0).padStart(4)} of ${COUNT}`);
  }
  console.log('Temporary segments and flags removed.');
}

// The rule checker's "never applies" findings, against the server: users inside a shadowed segment must never be
// served that override's value (checked when the value is unique to it, so serving it would be visible).
if (!OPERATORS) {
  for (const doc of new Set(samples.map((x) => x.doc))) {
    for (const f of analyseRules(doc).filter((x) => x.kind === 'shadowed')) {
      const segment = doc.project.segments.find((x) => x.name === f.segment);
      const value = segment.feature_states.find((fs) => fs.feature.name === f.flag).feature_state_value;
      const others = [...doc.feature_states, ...doc.project.segments.filter((x) => x !== segment).flatMap((x) => x.feature_states)].filter((fs) => fs.feature.name === f.flag);
      if (others.some((fs) => fs.feature_state_value === value)) continue;
      const inside = samples.filter((x) => x.doc === doc && matchingSegments(doc, x.persona).includes(segment));
      const served = inside.filter((x) => x.flags.find((fl) => fl.feature.name === f.flag)?.feature_state_value === value).length;
      if (served) failures++;
      console.log(`${served ? '✖' : '✔'} Rule check, ${doc.name}: "${f.segment}" is shadowed; ${inside.length} sampled users are in it and the server served its value (${JSON.stringify(value)}) to ${served}.`);
    }
  }
}

function server_flags(doc) {
  return doc.feature_states.length;
}

console.log(failures ? `\n✖ ${failures} mismatches (seed ${startSeed})` : `\n✔ Local evaluation matches Flagsmith exactly (seed ${startSeed}).`);
process.exit(failures ? 1 : 0);
