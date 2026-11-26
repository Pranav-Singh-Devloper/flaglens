#!/usr/bin/env node
// flaglens check: the editor's checks for a whole repository, against Flagsmith, for CI.
//
//   node extension/scripts/check.mjs [--path examples/demo-shop] [--strict] [--comment]      (make flag-check)
//
//   --path     only check files under this folder (repeatable); default: the whole repository
//   --strict   exit with 1 when there are problems (unknown keys, archived flags in code, rule findings)
//   --comment  in a pull request on GitHub Actions, also post the report as a PR comment (needs GH_TOKEN)
//
// Reads FLAGSMITH_API_URL, FLAGSMITH_API_KEY and FLAGSMITH_PROJECT_ID from the environment or the repository's .env.
// Writes the report to stdout, and to the job summary on GitHub Actions ($GITHUB_STEP_SUMMARY).
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const paths = args.flatMap((a, i) => (a === '--path' && args[i + 1] ? [args[i + 1].replace(/\/+$/, '')] : []));

const here = dirname(fileURLToPath(import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', cwd: root }).trim();

const dotenv = existsSync(join(root, '.env'))
  ? Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n').map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]))
  : {};
const env = { ...dotenv, ...process.env };
for (const k of ['FLAGSMITH_API_KEY', 'FLAGSMITH_PROJECT_ID']) if (!env[k]) throw new Error(`${k} is not set`);
const api = (env.FLAGSMITH_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
const headers = { Authorization: `Api-Key ${env.FLAGSMITH_API_KEY}` };
const get = async (path) => {
  const res = await fetch(path.startsWith('http') ? path : `${api}/api/v1${path}`, { headers });
  if (!res.ok) throw new Error(`Flagsmith answered HTTP ${res.status} for ${path}`);
  return res.json();
};
const all = async (path) => {
  const out = [];
  for (let next = path; next; ) {
    const page = await get(next);
    if (Array.isArray(page)) return page;
    out.push(...page.results);
    next = page.next;
  }
  return out;
};

const bundle = await build({ entryPoints: [join(here, '..', 'src', 'cli', 'check.ts')], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { runCheck, checkMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const pid = env.FLAGSMITH_PROJECT_ID;
const [project, features, environments] = await Promise.all([get(`/projects/${pid}/`), all(`/projects/${pid}/features/?page_size=100`), all(`/environments/?project=${pid}`)]);
const documents = await Promise.all(environments.map((e) => get(`/environments/${e.api_key}/document/`)));

// Source files only: docs and tests mention flag keys as examples.
const SOURCE = /\.(m?[jt]sx?|cjs|py|go|java|kt|cs|dart|rb|php|swift|vue|svelte)$/;
const SKIP = /(^|\/)(node_modules|dist|out|build|vendor|test|tests|__tests__|fixtures?)\//;
const files = [];
for (const file of git('ls-files').split('\n')) {
  if (!file || !SOURCE.test(file) || SKIP.test(file)) continue;
  if (paths.length && !paths.some((p) => file === p || file.startsWith(`${p}/`))) continue;
  const full = join(root, file);
  if (!existsSync(full) || statSync(full).size > 1_000_000) continue;
  files.push({ path: file, text: readFileSync(full, 'utf8') });
}

const result = runCheck({ project: project.name, flags: features.map((f) => ({ name: f.name, archived: !!f.is_archived })), documents, files });
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD');
const link = repo ? (p, l) => `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/blob/${sha}/${p}#L${l}` : undefined;
const md = checkMarkdown(result, link);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);

if (flag('--comment') && process.env.GITHUB_EVENT_PATH) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request?.number;
  if (pr) {
    const body = join(tmpdir(), 'flaglens-check.md');
    writeFileSync(body, md);
    execFileSync('gh', ['pr', 'comment', String(pr), '--body-file', body], { stdio: 'inherit' });
  }
}
if (flag('--strict') && result.problems) process.exit(1);
