// End-to-end tests against Flagsmith Cloud (app.flagsmith.com), run inside a real VS Code like suite.ts.
//
//   make seed-cloud && FLAGLENS_IT_CLOUD=1 npm run test:integration -w extension
//
// Uses the organisation API key and project from .env.cloud (git-ignored), points FlagLens at https://api.flagsmith.com
// through user settings, and checks the same core workflows as the self-hosted suite. Every change it makes is undone.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { App } from '../../src/app';
import { parseDotenv } from '../../src/config';

const results: string[] = [];
let failures = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push(`  ✔ ${name}`);
  } catch (e) {
    failures++;
    results.push(`  ✖ ${name}\n      ${(e as Error).message.split('\n').join('\n      ')}`);
  }
}

async function waitFor<T>(what: string, fn: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function open(name: string): Promise<vscode.TextDocument> {
  const folder = vscode.workspace.workspaceFolders![0]!.uri;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, name));
  await vscode.window.showTextDocument(doc);
  return doc;
}

const hoverText = (hovers: vscode.Hover[]) =>
  hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))).join('\n');

export async function run(): Promise<void> {
  const envPath = process.env.FLAGLENS_IT_ENV;
  assert.ok(envPath, 'FLAGLENS_IT_ENV is not set');
  const env = parseDotenv(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(envPath))));
  const apiUrl = env.FLAGSMITH_API_URL!;
  assert.match(apiUrl, /^https:\/\/[^/]*flagsmith\.com/, 'FLAGSMITH_API_URL in .env.cloud should be Flagsmith Cloud');

  const ext = vscode.extensions.getExtension<App>('pranav-singh-devloper.flaglens');
  assert.ok(ext, 'extension not found');
  const app = await ext.activate();
  app.confirm = async () => true;

  // The demo workspace's flagsmith.json points at the local dev kit; user settings take precedence over it.
  const cfg = vscode.workspace.getConfiguration('flaglens');
  await cfg.update('apiUrl', apiUrl, vscode.ConfigurationTarget.Global);
  await cfg.update('projectId', Number(env.FLAGSMITH_PROJECT_ID), vscode.ConfigurationTarget.Global);
  await app.keys.set(apiUrl, env.FLAGSMITH_API_KEY!);
  await vscode.commands.executeCommand('flaglens.refresh');
  const { store } = app;
  await waitFor('store to load from Flagsmith Cloud', () => store.status === 'ok' && store.connection?.client.baseUrl === apiUrl && store.rows.size > 0, 60_000);
  // Leftovers from an interrupted run: test identities (and their overrides) in the Edge store.
  for (const e of store.environments) {
    const base = `/environments/${e.apiKey}/edge-identities/`;
    const page = await store.connection!.client.request<{ results: { identity_uuid: string; identifier: string }[] }>('GET', `${base}?q=flaglens-`);
    for (const i of page.results.filter((x) => /^flaglens-(e2e|probe)-/.test(x.identifier))) await store.connection!.client.request('DELETE', `${base}${i.identity_uuid}/`);
  }
  const dev = store.environments.find((e) => e.name === 'Development')!;
  const prd = store.environments.find((e) => e.name === 'Production')!;

  await test('connects to Flagsmith Cloud: the seeded project, its environments and flags, Cloud dashboard links', async () => {
    assert.equal(store.project?.name, 'Demo Shop');
    assert.equal(store.environments.length, 3);
    // The seed adds 7 flags; a free Cloud plan's one project may already hold others (e.g. Flagsmith's starter flag).
    for (const key of ['new_checkout', 'banner_text', 'rate_limit_per_minute', 'checkout_button_color', 'dark_mode', 'maintenance_mode', 'legacy_search']) assert.ok(store.row(key), key);
    assert.equal(prd.protected, true);
    assert.match(store.connection!.dashboardUrl, /^https:\/\/app\.flagsmith\.com/);
  });

  await test('CodeLens shows every environment and the drift badge', async () => {
    const doc = await open('server.mjs');
    const titles = await waitFor('code lenses', async () => {
      const l = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri, 100);
      return l.length >= 7 ? l.map((x) => x.command?.title ?? '') : undefined;
    });
    const nc = titles.find((t) => t.includes('new_checkout'))!;
    // Environments are listed in Flagsmith's order; Staging may come last if it was created after the others.
    for (const part of [/Development ● on/, /Staging ● on/, /Production ○ off/]) assert.match(nc, part);
    assert.match(titles.find((t) => t.includes('rate_limit_per_minute'))!, /drift/);
  });

  await test('hover lists values and variant weights', async () => {
    const doc = await open('server.mjs');
    const i = doc.getText().indexOf("'checkout_button_color'");
    const hover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, doc.positionAt(i + 3)));
    assert.match(hover, /checkout_button_color/);
    assert.match(hover, /green/);
  });

  await test('toggle publishes a new version in Flagsmith Cloud (v2), then the toggle back restores it', async () => {
    const client = store.connection!.client;
    const featureId = store.row('new_checkout')!.feature.id;
    // Every Cloud environment uses feature versioning: each change is a new version with a new live state.
    assert.equal(dev.v2Versioning, true);
    const live = async () => (await client.listFeatureStates(dev.apiKey, featureId)).find((s) => s.feature_segment === null && s.identity === null)!.enabled;
    const before = await live();
    await vscode.commands.executeCommand('flaglens.toggleFlag', 'new_checkout', dev.id);
    assert.equal(await live(), !before);
    await vscode.commands.executeCommand('flaglens.toggleFlag', 'new_checkout', dev.id);
    assert.equal(await live(), before);
  });

  const beta = { name: 'Beta tester', identifier: 'alice@demo-shop.dev', traits: { email: 'alice@demo-shop.dev', plan: 'pro', country: 'GB' } };

  await test('preview as a user: local evaluation equals what Flagsmith Cloud serves that user', async () => {
    await waitFor('environment documents', () => store.previewSupported);
    await vscode.commands.executeCommand('flaglens.previewAs', beta);
    try {
      const local = store.evaluation(prd.id)!;
      assert.equal(local.get('new_checkout')?.enabled, true, 'beta_testers turns new_checkout on in Production');
      const res = await fetch(`${apiUrl}/api/v1/identities/`, {
        method: 'POST',
        headers: { 'X-Environment-Key': prd.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: beta.identifier, transient: true, traits: Object.entries(beta.traits).map(([trait_key, trait_value]) => ({ trait_key, trait_value })) }),
      });
      assert.ok(res.ok, `identities: HTTP ${res.status}`);
      const server = (await res.json()) as { flags: { feature: { name: string }; enabled: boolean; feature_state_value: unknown }[] };
      assert.ok(server.flags.length >= 7);
      for (const f of server.flags) {
        assert.deepEqual([local.get(f.feature.name)?.enabled, local.get(f.feature.name)?.value], [f.enabled, f.feature_state_value], f.feature.name);
      }
    } finally {
      await vscode.commands.executeCommand('flaglens.previewAs', null);
    }
  });

  await test('targeting rule check finds the shadowed and the redundant override, and only those', async () => {
    const md = await vscode.commands.executeCommand<string>('flaglens.checkRules', { show: false });
    assert.match(md, /2 problems in \d+ segment overrides/);
    assert.match(md, /`rate_limit_per_minute` \| Never applies \(shadowed\)/);
    assert.match(md, /`banner_text` \| Changes nothing \(redundant\)/);
  });

  await test('identity override in the Edge store: set a flag for one user in Flagsmith Cloud, then remove it', async () => {
    assert.equal(store.project?.use_edge_identities, true, 'Cloud projects use Edge identities');
    const user = { name: 'Cloud override test', identifier: `flaglens-e2e-${Date.now()}@example.com`, traits: {} };
    await vscode.commands.executeCommand('flaglens.previewAs', user);
    try {
      assert.equal(store.evaluation(prd.id)!.get('new_checkout')!.enabled, false);
      await vscode.commands.executeCommand('flaglens.setUserOverride', 'new_checkout', prd.id, { enabled: true, value: null });
      await waitFor('override in the preview', () => store.evaluation(prd.id)!.get('new_checkout')!.reason.kind === 'identity');
      // What Flagsmith Cloud serves this user now. Stored (Edge) identities are served by Cloud's Edge SDK API.
      const sdkUrl = apiUrl.replace('://api.flagsmith.com', '://edge.api.flagsmith.com');
      const served = async () => {
        const res = await fetch(`${sdkUrl}/api/v1/identities/?identifier=${encodeURIComponent(user.identifier)}`, { headers: { 'X-Environment-Key': prd.apiKey } });
        return ((await res.json()) as { flags: { feature: { name: string }; enabled: boolean }[] }).flags.find((f) => f.feature.name === 'new_checkout')?.enabled;
      };
      await waitFor('Flagsmith Cloud to serve the override', async () => (await served()) === true);
      await vscode.commands.executeCommand('flaglens.setUserOverride', 'new_checkout', prd.id, 'remove');
      await waitFor('override gone from the preview', () => store.evaluation(prd.id)!.get('new_checkout')!.reason.kind !== 'identity');
      await waitFor('Flagsmith Cloud to stop serving it', async () => (await served()) === false);
    } finally {
      await vscode.commands.executeCommand('flaglens.previewAs', null);
    }
  });

  await test('environment matrix opens', async () => {
    await vscode.commands.executeCommand('flaglens.openMatrix');
    assert.ok(await waitFor('matrix tab', () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'Flagsmith Environment Matrix')));
  });

  console.log(`\nFlagLens integration tests against Flagsmith Cloud (${apiUrl})\n${results.join('\n')}\n`);
  if (failures) throw new Error(`${failures} Cloud integration test(s) failed`);
}
