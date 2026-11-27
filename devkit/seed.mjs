#!/usr/bin/env node
// FlagLens dev-kit seed: turns a fresh self-hosted Flagsmith into a ready-to-demo instance.
//
//   node devkit/seed.mjs          (or: make seed / npm run devkit:seed)
//   node devkit/seed.mjs --cloud  (or: make seed-cloud) seeds the same project into a Flagsmith Cloud organisation,
//                                 using the organisation API key in .env.cloud (see .env.example)
//
// It is idempotent: it logs in if the admin already exists, reuses the organisation, project, environments
// and flags it finds, and resets every demo flag to the state declared in devkit/seed-data.json.
// Only Node >= 18 is needed (global fetch); there are no dependencies.
//
// Every call goes through Flagsmith's public REST API, the same API the extension uses.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { parseDotenv, renderDotenv, envVarSuffix, normaliseBaseUrl, waitUntil } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// Flagsmith Cloud: no sign-up through the API, so the seed uses an organisation API key you create in the dashboard,
// reuses that organisation, and keeps everything in .env.cloud so the self-hosted .env is untouched.
const CLOUD = process.argv.includes('--cloud');
const rootEnvPath = join(root, CLOUD ? '.env.cloud' : '.env');
const demoEnvPath = join(root, 'examples', 'demo-shop', '.env');

// Values already in .env win over defaults, and real environment variables win over both.
const fileEnv = existsSync(rootEnvPath) ? parseDotenv(readFileSync(rootEnvPath, 'utf8')) : {};
const setting = (name, fallback) => process.env[name] || fileEnv[name] || fallback;

const API_URL = normaliseBaseUrl(setting('FLAGSMITH_API_URL', CLOUD ? 'https://api.flagsmith.com' : 'http://localhost:8000'));
const ADMIN_EMAIL = setting('ADMIN_EMAIL', 'admin@flaglens.local');
const ADMIN_PASSWORD = setting('ADMIN_PASSWORD', 'FlagLens-demo-2026');
const DEMO_PORT = setting('DEMO_PORT', '3030');
const data = JSON.parse(readFileSync(join(here, 'seed-data.json'), 'utf8'));

const log = (msg) => console.log(`  ${msg}`);
const step = (msg) => console.log(`\n▸ ${msg}`);

// ---------------------------------------------------------------------------------------------------------------
// Minimal REST client
// ---------------------------------------------------------------------------------------------------------------

let authHeader = '';

async function api(method, path, body) {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(authHeader && { Authorization: authHeader }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → HTTP ${res.status}: ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/** Fetches every page of a paginated list. Some endpoints (e.g. /projects/) return a plain array instead. */
async function listAll(path) {
  let page = await api('GET', path);
  if (Array.isArray(page)) return page;
  const items = [...page.results];
  while (page.next) {
    const next = new URL(page.next);
    page = await api('GET', `${next.pathname.replace(/^\/api\/v1/, '')}${next.search}`);
    items.push(...page.results);
  }
  return items;
}

// ---------------------------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------------------------

async function waitForFlagsmith() {
  step(`Waiting for Flagsmith at ${API_URL}`);
  let dots = 0;
  const ok = await waitUntil(
    async () => (await fetch(`${API_URL}/health/readiness/`, { signal: AbortSignal.timeout(3_000) })).ok,
    { onWait: () => process.stdout.write(dots++ === 0 ? '  starting (first boot runs migrations, 1–3 min)…' : '.') },
  );
  if (dots) process.stdout.write('\n');
  if (!ok) {
    throw new Error(`Flagsmith did not become ready at ${API_URL} within 3 minutes. Is it running? Try: make up && make logs`);
  }
  log('ready ✓');
}

async function signUpOrLogIn() {
  step(`Admin user ${ADMIN_EMAIL}`);
  try {
    await api('POST', '/auth/users/', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, first_name: 'FlagLens', last_name: 'Admin' });
    log('created ✓');
  } catch (e) {
    if (e.status !== 400) throw e; // 400 = user already exists (or the password policy rejected it, which login will reveal)
    log('already exists, logging in');
  }
  try {
    const { key } = await api('POST', '/auth/login/', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    authHeader = `Token ${key}`;
  } catch (e) {
    throw new Error(
      `Could not log in as ${ADMIN_EMAIL} (${e.message}).\n` +
        `  If you changed ADMIN_PASSWORD after the first seed, run "make reset && make up && make seed" to start fresh.`,
    );
  }
}

async function getOrCreateOrganisation() {
  if (CLOUD) {
    // An organisation API key sees exactly one organisation: its own.
    step('Organisation (from the API key)');
    const [org] = await listAll('/organisations/');
    if (!org) throw new Error('The API key in .env.cloud sees no organisation. Create an organisation API key in Flagsmith Cloud.');
    log(`"${org.name}" (id ${org.id})`);
    return org;
  }
  step(`Organisation "${data.organisation}"`);
  const orgs = await listAll('/organisations/');
  let org = orgs.find((o) => o.name === data.organisation);
  if (!org) {
    org = await api('POST', '/organisations/', { name: data.organisation });
    log(`created (id ${org.id}) ✓`);
  } else log(`found (id ${org.id})`);
  return org;
}

async function getOrCreateProject(org) {
  step(`Project "${data.project}"`);
  // Flagsmith Cloud's free plan allows one project. FLAGSMITH_PROJECT_ID in .env.cloud seeds into an existing project
  // instead (it is renamed to the demo's name; everything already in it is left as it is).
  const chosen = CLOUD && setting('FLAGSMITH_PROJECT_ID', '');
  if (chosen) {
    let project = await api('GET', `/projects/${chosen}/`);
    if (project.name !== data.project) {
      log(`using project ${project.id} ("${project.name}"), renamed to "${data.project}"`);
      project = await api('PUT', `/projects/${project.id}/`, { name: data.project, organisation: org.id });
    } else log(`found (id ${project.id})`);
    return project;
  }
  const projects = await listAll(`/projects/?organisation=${org.id}`);
  let project = projects.find((p) => p.name === data.project && p.organisation === org.id);
  if (!project) {
    try {
      project = await api('POST', '/projects/', { name: data.project, organisation: org.id });
    } catch (e) {
      if (CLOUD && e.status === 403) {
        throw new Error(
          `Flagsmith Cloud would not create another project (${e.message}). The free plan allows one.\n` +
            '  To seed into an existing project instead, add FLAGSMITH_PROJECT_ID=<its id> to .env.cloud (it is renamed\n' +
            `  "${data.project}"; nothing in it is deleted), then run make seed-cloud again.`,
        );
      }
      throw e;
    }
    log(`created (id ${project.id}) ✓`);
  } else log(`found (id ${project.id})`);
  return project;
}

async function getOrCreateEnvironments(project) {
  step('Environments');
  // Verified on 2.295.2: creating a project through the API does NOT create any environments.
  const existing = await listAll(`/environments/?project=${project.id}`);
  const envs = [];
  for (const name of data.environments) {
    let env = existing.find((e) => e.name === name);
    if (!env) {
      env = await api('POST', '/environments/', { name, project: project.id });
      log(`${name}: created ✓`);
    } else log(`${name}: found`);
    envs.push(env);
  }
  return envs;
}

async function getOrCreateTags(project) {
  step('Tags');
  const existing = await listAll(`/projects/${project.id}/tags/`);
  const ids = new Map();
  for (const t of data.tags) {
    let tag = existing.find((x) => x.label === t.label);
    if (!tag) {
      tag = await api('POST', `/projects/${project.id}/tags/`, t);
      log(`${t.label}: created ✓`);
    } else log(`${t.label}: found`);
    ids.set(t.label, tag.id);
  }
  return ids;
}

/** Converts a JS value into Flagsmith's typed multivariate-option fields. */
/**
 * Feature versioning (v2), which every Flagsmith Cloud environment uses: direct state writes are rejected, and a
 * change is a new version of the flag in that environment, published at once. Flagsmith keeps the previous ones.
 */
async function publishVersion(env, featureId, change) {
  await api('POST', `/environments/${env.id}/features/${featureId}/versions/`, { publish_immediately: true, description: 'make seed', ...change });
}

function typedValue(value) {
  if (value === null || value === undefined) return { type: 'unicode', string_value: null };
  if (typeof value === 'number') return { type: 'int', integer_value: value };
  if (typeof value === 'boolean') return { type: 'bool', boolean_value: value };
  return { type: 'unicode', string_value: String(value) };
}

async function seedFlags(project, envs, tagIds) {
  step('Flags');
  const existing = await listAll(`/projects/${project.id}/features/?page_size=100`);
  // A running experiment locks its flag in that environment (Flagsmith rejects direct writes), so re-seeding leaves
  // that flag as the experiment configured it.
  const lockedByExperiment = new Set();
  for (const env of envs) {
    for (const x of await listAll(`/environments/${env.api_key}/experiments/`).catch(() => [])) {
      if (x.status === 'running') lockedByExperiment.add(`${env.id}:${x.feature?.id ?? x.feature}`);
    }
  }
  for (const flag of data.flags) {
    const tags = (flag.tags ?? []).map((label) => tagIds.get(label));
    let feature = existing.find((f) => f.name === flag.name);
    if (!feature) {
      feature = await api('POST', `/projects/${project.id}/features/`, {
        name: flag.name,
        type: flag.type ?? 'STANDARD',
        description: flag.description ?? '',
        default_enabled: false,
        initial_value: flag.initial_value ?? null,
        tags,
        multivariate_options: (flag.variants ?? []).map((v) => ({
          ...typedValue(v.value),
          key: v.key,
          default_percentage_allocation: v.weight,
        })),
      });
    }
    // Verified on 2.295.2: variant `key`s sent with the feature are ignored, so set them on each option.
    // The PATCH must include default_percentage_allocation, otherwise the server answers 500 (KeyError).
    for (const variant of flag.variants ?? []) {
      const option = feature.multivariate_options.find((o) => (o.string_value ?? o.integer_value ?? o.boolean_value) === variant.value);
      if (option && option.key !== variant.key) {
        await api('PATCH', `/projects/${project.id}/features/${feature.id}/mv-options/${option.id}/`, {
          feature: feature.id,
          key: variant.key,
          default_percentage_allocation: variant.weight,
        });
      }
    }
    // Keep metadata in sync (also un-archives first so state writes succeed, then archives at the end).
    await api('PATCH', `/projects/${project.id}/features/${feature.id}/`, {
      name: flag.name,
      description: flag.description ?? '',
      tags,
      is_archived: false,
    });

    for (const env of envs) {
      const wanted = flag.states[env.name];
      if (!wanted) continue;
      const states = await listAll(`/environments/${env.api_key}/featurestates/?feature=${feature.id}`);
      // The environment default is the state with no segment and no identity.
      const fs = states.find((s) => s.feature_segment === null && s.identity === null);
      if (!fs) throw new Error(`No environment default feature state for ${flag.name} in ${env.name}`);
      const patch = { enabled: wanted.enabled };
      // Verified on 2.295.2: a raw JSON value is accepted and keeps its type (string, int or bool).
      if ('value' in wanted) patch.feature_state_value = wanted.value;
      if (lockedByExperiment.has(`${env.id}:${feature.id}`)) continue;
      if (env.use_v2_feature_versioning) {
        const value = 'value' in wanted ? wanted.value : fs.feature_state_value;
        if (fs.enabled === wanted.enabled && fs.feature_state_value === value) continue; // no new version for nothing
        await publishVersion(env, feature.id, { feature_states_to_update: [{ feature_segment: null, enabled: wanted.enabled, feature_state_value: typedValue(value) }] });
        continue;
      }
      await api('PATCH', `/environments/${env.api_key}/featurestates/${fs.id}/`, patch);
    }

    if (flag.archived) {
      await api('PATCH', `/projects/${project.id}/features/${feature.id}/`, { name: flag.name, is_archived: true });
    }

    const summary = envs.map((e) => `${e.name} ${flag.states[e.name]?.enabled ? '●' : '○'}`).join('  ');
    log(`${flag.name.padEnd(24)} ${summary}${flag.archived ? '  (archived)' : ''}`);
  }
}

/**
 * Segments (who) and segment overrides (what they get). Re-running restores both: segment rules are rewritten, and
 * every override on a seeded flag is removed and recreated, so the result always matches seed-data.json.
 */
async function seedSegments(project, envs) {
  step('Segments');
  const segments = new Map();
  const existing = await listAll(`/projects/${project.id}/segments/`);
  for (const s of data.segments ?? []) {
    // The dashboard stores conditions as one top-level ALL rule wrapping the user's rules; do the same.
    const body = { name: s.name, description: s.description ?? '', project: project.id, rules: [{ type: 'ALL', rules: s.rules.map((r) => ({ ...r, rules: [] })), conditions: [] }] };
    const found = existing.find((e) => e.name === s.name);
    const segment = found
      ? await api('PUT', `/projects/${project.id}/segments/${found.id}/`, body)
      : await api('POST', `/projects/${project.id}/segments/`, body);
    segments.set(s.name, segment);
    const rule = s.rules.flatMap((r) => r.conditions.map((c) => `${c.property ?? 'identity'} ${c.operator} ${c.value}`)).join(', ');
    log(`${s.name.padEnd(24)} ${rule}`);
  }

  const overrides = data.segment_overrides ?? [];
  if (!overrides.length) return;
  const features = await listAll(`/projects/${project.id}/features/?page_size=100`);
  const seededFlags = new Set(overrides.map((o) => o.flag));
  const overrideState = (o, feature, segment, priority) => ({
    enabled: o.enabled,
    feature_state_value: 'value' in o ? typedValue(o.value) : { type: 'unicode', string_value: null },
    feature_segment: { segment: segment.id, priority },
    // Verified on 2.295.2: an override of a multivariate flag copies the flag's variant split unless told
    // otherwise, which would hide the override's own value. 0% on every variant makes everyone get `value`.
    ...(feature.type === 'MULTIVARIATE' &&
      'value' in o && { multivariate_feature_state_values: feature.multivariate_options.map((m) => ({ multivariate_feature_option: m.id, percentage_allocation: 0 })) }),
  });
  // v2 environments: one version per flag replaces its overrides with the declared ones, in priority order.
  for (const env of envs.filter((e) => e.use_v2_feature_versioning)) {
    for (const name of seededFlags) {
      const feature = features.find((f) => f.name === name);
      if (!feature) continue;
      const wanted = overrides.map((o, priority) => ({ o, priority })).filter(({ o }) => o.flag === name && o.environment === env.name);
      const current = (await listAll(`/features/feature-segments/?feature=${feature.id}&environment=${env.id}`)).filter((f) => !f.is_system_segment);
      const same =
        current.length === wanted.length &&
        wanted.every(({ o }, i) => [...current].sort((a, b) => a.priority - b.priority)[i]?.segment === segments.get(o.segment)?.id);
      if (same && !process.argv.includes('--force')) {
        for (const { o } of wanted) log(`${o.flag} → ${o.segment} in ${o.environment}: already in place`);
        continue;
      }
      await publishVersion(env, feature.id, {
        segment_ids_to_delete_overrides: current.map((f) => f.segment),
        feature_states_to_create: wanted.map(({ o }, i) => overrideState(o, feature, segments.get(o.segment), i)),
      });
      for (const { o } of wanted) log(`${o.flag} → ${o.segment} in ${o.environment}: ${o.enabled ? 'on' : 'off'}${'value' in o ? ` ${JSON.stringify(o.value)}` : ''}`);
    }
  }
  for (const env of envs.filter((e) => !e.use_v2_feature_versioning)) {
    for (const name of seededFlags) {
      const feature = features.find((f) => f.name === name);
      if (!feature) continue;
      for (const fseg of await listAll(`/features/feature-segments/?feature=${feature.id}&environment=${env.id}`)) {
        // System segments belong to Flagsmith features (an experiment's rollout, a flag dependency): keep them.
        if (fseg.is_system_segment) continue;
        await api('DELETE', `/features/feature-segments/${fseg.id}/`);
      }
    }
  }
  for (const [priority, o] of overrides.entries()) {
    const feature = features.find((f) => f.name === o.flag);
    const env = envs.find((e) => e.name === o.environment);
    const segment = segments.get(o.segment);
    if (!feature || !env || !segment) throw new Error(`Unknown flag, environment or segment in override ${JSON.stringify(o)}`);
    if (env.use_v2_feature_versioning) continue; // published above
    await api('POST', `/environments/${env.api_key}/features/${feature.id}/create-segment-override/`, overrideState(o, feature, segment, priority));
    log(`${o.flag} → ${o.segment} in ${o.environment}: ${o.enabled ? 'on' : 'off'}${'value' in o ? ` ${JSON.stringify(o.value)}` : ''}`);
  }
}

/**
 * Experimentation (beta): an A/B test on a multivariate flag, with a conversion metric and simulated shoppers, so the
 * experiment has results to read. Self-hosted Flagsmith stores the events in its own database (the "Flagsmith
 * database" warehouse). Every shopper is identified through the SDK API, so Flagsmith itself assigns the variation;
 * the seed then sends the exposure and, at the configured rate, a conversion event, exactly as an SDK would.
 * Re-seeding keeps a running experiment and its data; traffic is only sent while it has fewer than half the shoppers.
 */
async function seedExperiment(project, envs) {
  const x = data.experiment;
  if (!x) return;
  step('Experiment');
  const env = envs.find((e) => e.name === x.environment);
  const features = await listAll(`/projects/${project.id}/features/?page_size=100`);
  const feature = features.find((f) => f.name === x.flag);
  if (!env || !feature) throw new Error(`Unknown environment or flag in the experiment: ${x.environment}, ${x.flag}`);
  const base = `/environments/${env.api_key}`;

  const warehouses = await listAll(`${base}/warehouse-connections/`);
  // Self-hosted: events go to Flagsmith's own Postgres. Flagsmith Cloud: to its managed warehouse ("flagsmith").
  if (CLOUD ? !warehouses.some((w) => w.warehouse_type === 'flagsmith') : !warehouses.some((w) => w.config?.source === 'flagsmith_database')) {
    await api('POST', `${base}/warehouse-connections/`, CLOUD ? { warehouse_type: 'flagsmith', config: {} } : { warehouse_type: 'postgres', config: { source: 'flagsmith_database' } });
  }
  const metrics = await listAll(`${base}/experiment-metrics/`);
  const metric =
    metrics.find((m) => m.name === x.metric.name) ??
    (await api('POST', `${base}/experiment-metrics/`, {
      name: x.metric.name,
      description: x.metric.description,
      aggregation: x.metric.aggregation,
      direction: x.metric.direction,
      definition: { version: 1, event: x.metric.event },
    }));

  let experiment = (await listAll(`${base}/experiments/`)).find((e) => e.name === x.name && e.status !== 'completed');
  if (!experiment) {
    const control = feature.initial_value;
    experiment = await api('POST', `${base}/experiments/`, {
      feature: feature.id,
      name: x.name,
      hypothesis: x.hypothesis,
      metrics: [{ metric: String(metric.id), expected_direction: 'increase' }],
      experiment_rollout: {
        enabled: true,
        rollout_percentage: x.rollout_percentage,
        feature_state_value: { type: 'string', value: control },
        multivariate_feature_state_values: feature.multivariate_options.map((o) => ({
          multivariate_feature_option: o.id,
          percentage_allocation: x.split[o.string_value] ?? 0,
        })),
      },
    });
  }
  if (experiment.status === 'created' || experiment.status === 'paused') experiment = await api('POST', `${base}/experiments/${experiment.id}/start/`);

  const results = await api('GET', `${base}/experiments/${experiment.id}/results/`).catch(() => null);
  const seen = Object.values(results?.results?.payload?.metrics?.[0]?.variants ?? {}).reduce((n, v) => n + v.n, 0);
  if (seen < x.traffic.shoppers / 2) {
    try {
      const sent = await sendShoppers(env, feature, experiment, x.traffic);
      log(`${sent.shoppers} simulated shoppers: ${Object.entries(sent.byVariant).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    } catch (e) {
      // Flagsmith Cloud: the managed warehouse must be active on the organisation's plan before it accepts events.
      if (!CLOUD || e.status !== 404) throw e;
      log(`"${x.name}" is running, but Flagsmith Cloud's warehouse does not accept events on this plan yet, so it has no results`);
      return;
    }
  }
  // Ask Flagsmith to recompute the results now (it allows one refresh every few minutes; a recent one is fine).
  for (const what of ['exposures', 'results']) await api('POST', `${base}/experiments/${experiment.id}/${what}/refresh/`).catch(() => {});
  log(`"${x.name}" running in ${env.name} on ${x.flag} (metric: ${x.metric.name})`);
}

/** Simulated shoppers, as an SDK would report them: Flagsmith assigns the variation, then exposure and conversion events. */
async function sendShoppers(env, feature, experiment, traffic) {
  const sdk = { 'X-Environment-Key': env.api_key, 'Content-Type': 'application/json' };
  const started = Date.parse(experiment.started_at ?? new Date().toISOString());
  // Flagsmith only counts events after the experiment started and up to when it computes the results, so every
  // timestamp lies between the two. Right after the start that window is tiny: wait a few seconds to open it.
  const wait = started + 6_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const now = Date.now();
  const from = started + 1_000;
  const to = now - 1_000;
  // A fixed seed: the same shoppers convert on every machine.
  let state = 20261127;
  const random = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const events = [];
  const byVariant = {};
  const ids = Array.from({ length: traffic.shoppers }, (_, i) => `shopper-${String(i + 1).padStart(4, '0')}`);
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const served = await Promise.all(
      batch.map(async (identifier) => {
        const res = await fetch(`${API_URL}/api/v1/identities/`, { method: 'POST', headers: sdk, body: JSON.stringify({ identifier, traits: [], transient: true }) });
        const flags = (await res.json()).flags;
        return { identifier, value: flags.find((f) => f.feature.name === feature.name)?.feature_state_value };
      }),
    );
    for (const { identifier, value } of served) {
      const variant = value === feature.initial_value ? 'control' : value;
      byVariant[variant] = (byVariant[variant] ?? 0) + 1;
      // Seen in the first half of the window; a shopper who buys does so later, still inside it.
      const at = from + Math.floor(random() * Math.min(60_000, (to - from) / 2));
      events.push({ event: '$flag_exposure', feature_name: feature.name, identifier, value: variant, timestamp: at });
      if (random() < (traffic.conversion_rate[value] ?? 0)) events.push({ event: data.experiment.metric.event, identifier, timestamp: at + Math.floor(random() * (to - at)) });
    }
  }
  for (let i = 0; i < events.length; i += 100) {
    const res = await fetch(`${API_URL}/api/v1/events/`, { method: 'POST', headers: sdk, body: JSON.stringify({ events: events.slice(i, i + 100) }) });
    if (!res.ok) throw Object.assign(new Error(`Flagsmith rejected experiment events: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { status: res.status });
  }
  return { shoppers: ids.length, byVariant };
}

/**
 * Feature Health: a Webhook provider gives a URL that monitoring tools post alerts to, and Flagsmith marks the flag
 * healthy or unhealthy (FlagLens shows it). Re-seeding marks any flag left unhealthy (e.g. by `make alert`) healthy.
 */
async function seedFeatureHealth(project, envs) {
  step('Feature health');
  const providers = await api('GET', `/projects/${project.id}/feature-health/providers/`);
  const provider = providers.find((p) => p.name === 'Webhook') ?? (await api('POST', `/projects/${project.id}/feature-health/providers/`, { name: 'Webhook' }));
  const features = await listAll(`/projects/${project.id}/features/?page_size=100`);
  const latest = new Map();
  for (const e of await api('GET', `/projects/${project.id}/feature-health/events/`)) {
    const k = `${e.feature}:${e.environment}`;
    if (!latest.has(k) || e.created_at > latest.get(k).created_at) latest.set(k, e);
  }
  let recovered = 0;
  for (const e of latest.values()) {
    if (e.type !== 'UNHEALTHY') continue;
    const feature = features.find((f) => f.id === e.feature);
    const env = envs.find((x) => x.id === e.environment);
    if (!feature) continue;
    await postHealth(provider.webhook_url, { feature: feature.name, ...(env && { environment: env.name }), status: 'healthy' });
    recovered++;
  }
  log(`Webhook provider ready (URL in .env as FLAGSMITH_HEALTH_WEBHOOK_URL)${recovered ? `; ${recovered} flag(s) marked healthy again` : ''}`);
  return provider.webhook_url;
}

async function postHealth(url, event) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`feature health event → HTTP ${res.status}`);
}

async function getOrCreateOrgApiKey(org, project) {
  step('Organisation API key (for the FlagLens extension)');
  // Re-use the key in .env if it still works, so re-seeding doesn't pile up keys.
  const current = fileEnv.FLAGSMITH_API_KEY;
  if (current) {
    const res = await fetch(`${API_URL}/api/v1/projects/${project.id}/`, { headers: { Authorization: `Api-Key ${current}` } });
    if (res.ok) {
      log('existing key in .env still works, keeping it');
      return current;
    }
  }
  // Verified on 2.295.2: the full key is returned only in this response.
  const created = await api('POST', `/organisations/${org.id}/master-api-keys/`, { name: 'flaglens-dev', is_admin: true });
  log(`created key ${created.prefix}… ✓`);
  return created.key;
}

function writeEnvFiles({ apiKey, org, project, envs, healthWebhook }) {
  step('Writing .env files (git-ignored)');
  const envEntries = envs.map((e) => [`FLAGSMITH_ENV_KEY_${envVarSuffix(e.name)}`, e.api_key]);
  const header = [
    `Written by \`make seed${CLOUD ? '-cloud' : ''}\`. Git-ignored: never commit this file. See .env.example for documentation.`,
    CLOUD ? 'Flagsmith Cloud: the organisation API key is yours; re-run make seed-cloud at any time.' : 'Re-run `make seed` at any time; the API key is kept if it still works.',
    '',
  ];
  if (CLOUD) {
    writeFileSync(
      rootEnvPath,
      renderDotenv([
        ...header,
        ['FLAGSMITH_API_URL', API_URL],
        ['FLAGSMITH_API_KEY', apiKey],
        ['FLAGSMITH_ORGANISATION_ID', String(org.id)],
        ['FLAGSMITH_PROJECT_ID', String(project.id)],
        ...envEntries,
        ...(healthWebhook ? [['FLAGSMITH_HEALTH_WEBHOOK_URL', healthWebhook]] : []),
      ]),
      { mode: 0o600 },
    );
    log(relative(root, rootEnvPath));
    return;
  }
  writeFileSync(
    rootEnvPath,
    renderDotenv([
      ...header,
      ['FLAGSMITH_API_URL', API_URL],
      ['FLAGSMITH_API_KEY', apiKey],
      ['FLAGSMITH_ORGANISATION_ID', String(org.id)],
      ['FLAGSMITH_PROJECT_ID', String(project.id)],
      ...envEntries,
      ['FLAGSMITH_HEALTH_WEBHOOK_URL', healthWebhook],
      ['ADMIN_EMAIL', ADMIN_EMAIL],
      ['ADMIN_PASSWORD', ADMIN_PASSWORD],
      ['DEMO_PORT', DEMO_PORT],
    ]),
    { mode: 0o600 },
  );
  log(relative(root, rootEnvPath));
  // The demo workspace gets its own copy so FlagLens finds the key when you open examples/demo-shop on its own.
  writeFileSync(
    demoEnvPath,
    renderDotenv([
      ...header,
      ['FLAGSMITH_API_URL', API_URL],
      ['FLAGSMITH_API_KEY', apiKey],
      ['FLAGSMITH_PROJECT_ID', String(project.id)],
      ...envEntries,
      ['DEMO_PORT', DEMO_PORT],
    ]),
    { mode: 0o600 },
  );
  log(relative(root, demoEnvPath));
}

function printSuccess({ project, envs }) {
  const dev = envs.find((e) => e.name === 'Development') ?? envs[0];
  if (CLOUD) {
    const box = [
      '✔ Flagsmith Cloud is seeded and ready.',
      '',
      `Dashboard   https://app.flagsmith.com/project/${project.id}/environment/${dev.api_key}/features`,
      `Project     ${data.project} · ${envs.map((e) => e.name).join(', ')} · ${data.flags.length} flags`,
      '',
      'Next: in VS Code, FlagLens: Connect to Flagsmith…',
      `  API URL ${API_URL}, the organisation API key from .env.cloud, project "${data.project}"`,
    ];
    const w = Math.max(...box.map((l) => l.length)) + 2;
    console.log(`\n┌${'─'.repeat(w)}┐\n${box.map((l) => `│ ${l.padEnd(w - 1)}│`).join('\n')}\n└${'─'.repeat(w)}┘\n`);
    return;
  }
  const lines = [
    '✔ Self-hosted Flagsmith is seeded and ready.',
    '',
    `Dashboard   ${API_URL}/project/${project.id}/environment/${dev.api_key}/features`,
    `Login       ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`,
    `Project     ${data.project} · ${envs.map((e) => e.name).join(', ')} · ${data.flags.length} flags`,
    '',
    'Next:',
    '  1. Install FlagLens (make install-ext, or the .vsix from Releases)',
    '  2. Open the demo workspace:  code examples/demo-shop',
    `  3. Run the demo shop:        make demo   → http://localhost:${DEMO_PORT}`,
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  console.log(`\n┌${'─'.repeat(width)}┐`);
  for (const l of lines) console.log(`│ ${l.padEnd(width - 1)}│`);
  console.log(`└${'─'.repeat(width)}┘\n`);
}

/** On Cloud, a step the organisation's plan doesn't include is skipped with a note instead of failing the seed. */
async function optional(name, fn) {
  if (!CLOUD) return fn();
  try {
    return await fn();
  } catch (e) {
    log(`${name} skipped on this Flagsmith Cloud plan (${e.message.slice(0, 160)})`);
    return undefined;
  }
}

async function main() {
  if (CLOUD) {
    console.log(`FlagLens dev kit · seeding Flagsmith Cloud at ${API_URL}`);
    const key = setting('FLAGSMITH_API_KEY', '');
    if (!key) {
      throw new Error(
        'No organisation API key. In Flagsmith Cloud: Organisation Settings → API Access → create a key, then put\n' +
          '  FLAGSMITH_API_KEY=<key>   in .env.cloud (git-ignored) and run make seed-cloud again.',
      );
    }
    authHeader = `Api-Key ${key}`;
  } else {
    console.log('FlagLens dev kit · seeding self-hosted Flagsmith');
    await waitForFlagsmith();
    await signUpOrLogIn();
  }
  const org = await getOrCreateOrganisation();
  const project = await getOrCreateProject(org);
  const envs = await getOrCreateEnvironments(project);
  const tagIds = await getOrCreateTags(project);
  await seedFlags(project, envs, tagIds);
  await seedSegments(project, envs);
  await optional('Experiment', () => seedExperiment(project, envs));
  const healthWebhook = (await optional('Feature Health', () => seedFeatureHealth(project, envs))) ?? '';
  const apiKey = CLOUD ? setting('FLAGSMITH_API_KEY', '') : await getOrCreateOrgApiKey(org, project);
  writeEnvFiles({ apiKey, org, project, envs, healthWebhook });
  printSuccess({ project, envs });
}

main().catch((e) => {
  console.error(`\n✖ Seed failed: ${e.message}`);
  if (e.cause?.code === 'ECONNREFUSED') console.error('  Flagsmith is not reachable. Start it with: make up');
  process.exit(1);
});
