#!/usr/bin/env node
// Checks that Flagsmith's MCP server (make mcp) works against this self-hosted Flagsmith with the organisation key the
// seed wrote to .env: an MCP handshake over Streamable HTTP, the tool list, then two read-only tool calls.
// This is the same server, URL and key FlagLens hands to VS Code's AI assistants. Zero dependencies (Node 18+).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...readDotenv(join(root, '.env')), ...process.env };
const MCP_URL = env.FLAGSMITH_MCP_URL || 'http://localhost:8002/mcp';
const KEY = env.FLAGSMITH_API_KEY;
if (!KEY) fail('No FLAGSMITH_API_KEY in .env. Run: make up && make seed');

function readDotenv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

function fail(message) {
  console.error(`✘ ${message}`);
  process.exit(1);
}

let session;
let nextId = 1;
/** One JSON-RPC message. The server answers with JSON or a short event stream; both are handled. */
async function rpc(method, params, { notify = false } = {}) {
  const body = { jsonrpc: '2.0', method, ...(params && { params }), ...(!notify && { id: nextId++ }) };
  let res;
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(session && { 'Mcp-Session-Id': session }),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    fail(`Cannot reach the MCP server at ${MCP_URL} (${e.cause?.code ?? e.message}). Start it with: make mcp`);
  }
  session = res.headers.get('mcp-session-id') ?? session;
  if (notify) return undefined;
  const text = await res.text();
  if (!res.ok) fail(`${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
  const json = res.headers.get('content-type')?.includes('text/event-stream')
    ? JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? 'null')
    : JSON.parse(text);
  if (json?.error) fail(`${method}: ${json.error.message}`);
  return json.result;
}

async function call(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = result.content?.map((c) => c.text ?? '').join('') ?? '';
  if (result.isError) fail(`${name}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'flaglens-mcp-check', version: '1' } });
await rpc('notifications/initialized', undefined, { notify: true });
console.log(`✔ MCP handshake with ${init.serverInfo?.name ?? 'server'} ${init.serverInfo?.version ?? ''} at ${MCP_URL}`);

const { tools } = await rpc('tools/list', {});
console.log(`✔ ${tools.length} Flagsmith tools, e.g. ${['list_projects_in_organization', 'list_project_features', 'list_experiments', 'get_experiment_results'].filter((t) => tools.some((x) => x.name === t)).join(', ')}`);
if (process.argv.includes('--schemas')) for (const t of tools) console.log(`  ${t.name}(${Object.keys(t.inputSchema?.properties ?? {}).join(', ')})`);

/** Paged lists come as {results: [...]}, plain lists as {result: [...]}. */
const items = (x) => x?.results ?? x?.result ?? x;

// What an assistant would do for "which checkout colour is winning?": find the project, its flags, the experiment.
const orgs = await call('list_organizations', {});
const org = items(orgs)[0];
const projects = await call('list_projects_in_organization', { id: org.id });
const project = items(projects).find((p) => p.name === 'Demo Shop');
if (!project) fail('No "Demo Shop" project. Run: make seed');
const features = await call('list_project_features', { project_pk: project.id, page_size: 100 });
console.log(`✔ list_project_features: ${items(features).length} flags in "${project.name}"`);

const stagingKey = env.FLAGSMITH_ENV_KEY_STAGING;
if (stagingKey) {
  const experiments = await call('list_experiments', { environment_api_key: stagingKey });
  const experiment = items(experiments)[0];
  if (experiment) {
    const results = await call('get_experiment_results', { environment_api_key: stagingKey, experiment_id: experiment.id });
    const inference = results?.results?.payload?.metrics?.[0]?.inference ?? {};
    const best = Object.entries(inference)
      .filter(([, v]) => v)
      .sort(([, a], [, b]) => b.chance_to_win - a.chance_to_win)[0];
    console.log(
      `✔ get_experiment_results: "${experiment.name}" is ${experiment.status}` +
        (best ? `; ${best[0]} leads (${Math.round(best[1].chance_to_win * 100)}% chance to beat control)` : '; results not computed yet'),
    );
  }
}
console.log(`\nFlagLens offers this server to VS Code's AI assistants as "Flagsmith" while it is connected (VS Code 1.101+).`);
