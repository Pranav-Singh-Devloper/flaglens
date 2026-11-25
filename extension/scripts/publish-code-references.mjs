#!/usr/bin/env node
// Publishes the repository's flag references to Flagsmith's Code References API, from the command line or CI.
// Uses the same scanner as the extension (Flagsmith's Code References pattern plus FlagLens's extra patterns).
//
//   npm run code-refs -w extension          (make code-refs)
//
// Reads FLAGSMITH_API_URL, FLAGSMITH_API_KEY and FLAGSMITH_PROJECT_ID from the environment or the repository's .env.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
// Every other git call runs at the repository root, so paths are relative to it whatever the current directory.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', cwd: root }).trim();

const dotenv = existsSync(join(root, '.env'))
  ? Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n').map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  : {};
const env = { ...dotenv, ...process.env };
for (const k of ['FLAGSMITH_API_KEY', 'FLAGSMITH_PROJECT_ID']) if (!env[k]) throw new Error(`${k} is not set`);
const api = (env.FLAGSMITH_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '').replace(/\/api\/v1$/, '');

const bundle = await build({ entryPoints: [join(here, '..', 'src', 'core', 'scanner.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { findFlagReferences, compilePatterns, DEFAULT_EXTRA_PATTERNS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const patterns = compilePatterns(DEFAULT_EXTRA_PATTERNS);

const remote = git('config', '--get', 'remote.origin.url');
const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote);
if (!m) throw new Error('Flagsmith Code References support GitHub repositories; origin is not on GitHub.');
const repositoryUrl = `https://github.com/${m[1]}/${m[2]}`;
const revision = git('rev-parse', 'HEAD');

const headers = { Authorization: `Api-Key ${env.FLAGSMITH_API_KEY}`, 'Content-Type': 'application/json' };
let next = `${api}/api/v1/projects/${env.FLAGSMITH_PROJECT_ID}/features/?page_size=100`;
const names = new Set();
while (next) {
  const page = await (await fetch(next, { headers })).json();
  for (const f of page.results) names.add(f.name);
  next = page.next;
}

const references = [];
for (const file of git('ls-files').split('\n')) {
  if (!file || /(^|\/)(node_modules|dist|out|build)\/|\.(png|jpg|gif|mp4|mp3|pdf|vsix|lock)$/.test(file)) continue;
  const path = join(root, file);
  if (!existsSync(path) || statSync(path).size > 1_000_000) continue;
  const text = readFileSync(path, 'utf8');
  if (text.includes('\u0000')) continue;
  for (const r of findFlagReferences(text, patterns)) if (names.has(r.key)) references.push({ file_path: file, line_number: r.line + 1, feature_name: r.key });
}

const res = await fetch(`${api}/api/v1/projects/${env.FLAGSMITH_PROJECT_ID}/code-references/`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ repository_url: repositoryUrl, vcs_provider: 'github', revision, code_references: references }),
});
if (!res.ok) throw new Error(`Flagsmith answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
console.log(`Published ${references.length} references to ${new Set(references.map((r) => r.feature_name)).size} flags (${repositoryUrl}@${revision.slice(0, 7)}).`);
