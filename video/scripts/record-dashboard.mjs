// Records the real self-hosted Flagsmith dashboard (http://localhost:8000) in Chrome:
//   hunt  — what checking one flag across environments looks like without FlagLens (cold open)
//   proof — the dashboard showing the same states FlagLens shows in the editor
//
//   node scripts/record-dashboard.mjs [take ...]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { repo } from './vscode.mjs';
import { Track, Director } from './capture.mjs';
import { framesToVideo } from './frames-to-video.mjs';

const REC = join(repo, 'video/recordings');
const FOOTAGE = join(repo, 'video/public/footage');
const only = process.argv.slice(2);
const want = (t) => only.length === 0 || only.includes(t);
const env = Object.fromEntries(
  readFileSync(join(repo, '.env'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
);
const BASE = env.FLAGSMITH_API_URL;
const PID = env.FLAGSMITH_PROJECT_ID;

execFileSync('node', [join(repo, 'devkit/seed.mjs')], { stdio: 'ignore' });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.6 });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);

// Log in once, off camera, with the dev-kit's local demo account.
await p.goto(`${BASE}/login`);
await p.locator('input').first().fill(env.ADMIN_EMAIL);
await p.locator('input[type=password]').fill(env.ADMIN_PASSWORD);
await p.getByRole('button', { name: /log in/i }).click();
await p.waitForURL(/organisation/);

const search = () => p.getByPlaceholder('Search').last();
const envSelect = () => p.locator('.react-select__control').first();
const envOption = (name) => p.locator('.react-select__option', { hasText: new RegExp(`^${name}$`) }).first();
const row = (name) => p.locator('.list-item', { hasText: name }).first();

async function take(name, fn) {
  if (!want(name)) return;
  console.log(`● take ${name}`);
  const d = new Director(p, join(REC, name), name);
  d.cursor = { x: 800, y: 450 };
  const track = new Track('dashboard', cdp, join(REC, name), { width: 2560, height: 1440, quality: 90 });
  await track.start();
  d.log('start');
  await d.wait(500);
  await fn(d);
  await d.wait(500);
  d.log('end');
  console.log(`  dashboard: ${await track.stop()} frames`);
  d.save();
  const r = await framesToVideo(join(REC, name, 'dashboard'), join(FOOTAGE, `${name}-dashboard.mp4`));
  console.log(`  → ${name}-dashboard.mp4 ${r.seconds.toFixed(1)}s`);
}

async function switchEnv(d, name) {
  await d.clickLocator(envSelect(), { ms: 700 });
  await envOption(name).waitFor({ state: 'visible' });
  await d.wait(300);
  await d.clickLocator(envOption(name), { ms: 500 });
  await p.waitForTimeout(900);
}

async function searchFor(d, text) {
  await d.clickLocator(search(), { ms: 700, dx: 0.3 });
  await p.keyboard.press('Meta+A');
  await d.type(text, { cps: 16 });
  await d.wait(900);
}

await p.goto(`${BASE}/organisation/1/projects`);
await p.getByText('Demo Shop').first().waitFor();

await take('hunt', async (d) => {
  await d.wait(600);
  await d.clickLocator(p.getByText('Demo Shop').first(), { ms: 900 });
  await search().waitFor({ state: 'visible' });
  await d.wait(700);
  await switchEnv(d, 'Production');
  await searchFor(d, 'new_checkout');
  await d.mark('prod-result', row('new_checkout'));
  await d.wait(900);
  await switchEnv(d, 'Staging');
  await searchFor(d, 'new_checkout');
  await d.mark('staging-result', row('new_checkout'));
  await d.wait(1200);
});

await p.goto(`${BASE}/project/${PID}/environment/${env.FLAGSMITH_ENV_KEY_PRODUCTION}/features`);
await search().waitFor({ state: 'visible' });
await p.waitForTimeout(1500);

await take('proof', async (d) => {
  await d.wait(800);
  await d.moveToLocator(row('rate_limit_per_minute'), { ms: 1000, dx: 0.6 });
  await d.mark('rate', row('rate_limit_per_minute'));
  await d.wait(1200);
  await d.moveToLocator(row('new_checkout'), { ms: 800, dx: 0.6 });
  await d.mark('new_checkout', row('new_checkout'));
  await d.wait(1200);
  await switchEnv(d, 'Staging');
  await d.mark('staging', p.locator('.panel').first());
  await d.wait(1600);
});

await browser.close();
process.exit(0);
