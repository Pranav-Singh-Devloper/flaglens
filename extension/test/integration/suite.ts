// Runs inside the VS Code extension host (see run.mjs). Talks to the real self-hosted Flagsmith seeded by `make seed`.
// Confirmations are auto-accepted through the App.confirm seam; everything else is the real extension.

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

async function waitFor<T>(what: string, fn: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function open(name: string): Promise<vscode.TextDocument> {
  const folder = vscode.workspace.workspaceFolders![0]!.uri;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, name));
  await vscode.window.showTextDocument(doc);
  return doc;
}

function positionOf(doc: vscode.TextDocument, needle: string, offsetInNeedle = 0): vscode.Position {
  const i = doc.getText().indexOf(needle);
  assert.ok(i >= 0, `"${needle}" not found in ${doc.fileName}`);
  return doc.positionAt(i + offsetInNeedle);
}

function hoverText(hovers: vscode.Hover[]): string {
  return hovers.flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))).join('\n');
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<App>('pranav-singh-devloper.flaglens');
  assert.ok(ext, 'extension not found');
  const app = await ext.activate();
  app.confirm = async () => true;

  // Use the key the dev kit wrote, exactly as a user clicking "Connect" on the .env prompt would.
  const folder = vscode.workspace.workspaceFolders![0]!.uri;
  const dotenv = parseDotenv(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, '.env'))));
  await app.keys.set(dotenv.FLAGSMITH_API_URL!, dotenv.FLAGSMITH_API_KEY!);
  await vscode.commands.executeCommand('flaglens.refresh');
  await waitFor('store to load', () => app.store.status === 'ok' && app.store.rows.size > 0);
  const { store } = app;
  const dev = store.environments.find((e) => e.name === 'Development')!;
  const stg = store.environments.find((e) => e.name === 'Staging')!;
  const prd = store.environments.find((e) => e.name === 'Production')!;

  await test('connects using flagsmith.json (project by name) and picks its environment', async () => {
    assert.equal(store.project?.name, 'Demo Shop');
    assert.equal(store.environments.length, 3);
    assert.equal(store.rows.size, 7);
    assert.equal(store.activeEnvironment?.name, 'Development');
    assert.equal(prd.protected, true);
    assert.equal(dev.protected, false);
  });

  await test('CodeLens shows every environment, drift and archived badges', async () => {
    const doc = await open('server.mjs');
    const lenses = await waitFor('code lenses', async () => {
      const l = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri, 100);
      return l.length >= 7 ? l : undefined;
    });
    const titles = lenses.map((l) => l.command?.title ?? '');
    const nc = titles.find((t) => t.includes('new_checkout'));
    assert.ok(nc, `no new_checkout lens in:\n${titles.join('\n')}`);
    assert.match(nc!, /Development ● on .*Staging ● on .*Production ○ off/);
    assert.match(titles.find((t) => t.includes('rate_limit_per_minute'))!, /drift/);
    assert.match(titles.find((t) => t.includes('legacy_search'))!, /archived/);
  });

  await test('hover lists states, values and variants', async () => {
    const doc = await open('server.mjs');
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, positionOf(doc, "'checkout_button_color'", 3));
    const text = hoverText(hovers);
    assert.match(text, /checkout_button_color/);
    assert.match(text, /Production/);
    assert.match(text, /green/);
    assert.match(text, /50%/);
  });

  await test('typo diagnostic with "Replace with" quick fix, and stale hint', async () => {
    const doc = await open('typo.ts');
    const diags = await waitFor('diagnostics', () => {
      const d = vscode.languages.getDiagnostics(doc.uri).filter((x) => x.source === 'FlagLens');
      return d.length >= 2 ? d : undefined;
    });
    const typo = diags.find((d) => d.code === 'unknown-flag');
    assert.ok(typo, 'no unknown-flag diagnostic');
    assert.match(typo!.message, /new_chekout.*Did you mean "new_checkout"/);
    const stale = diags.find((d) => d.code === 'stale-flag');
    assert.ok(stale && /dark_mode has been ON in every environment/.test(stale.message), 'no stale dark_mode diagnostic');
    const hover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, typo!.range.start));
    assert.match(hover, /Did you mean `new_checkout`\?/);
    assert.doesNotMatch(hover, /`[^`]*\\_[^`]*`/, 'Markdown escapes must not leak into code spans');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, typo!.range);
    const titles = actions.map((a) => a.title);
    assert.ok(titles.includes('Replace with "new_checkout"'), titles.join(', '));
    assert.ok(titles.some((t) => t.startsWith('Create flag "new_chekout"')));
  });

  await test('archived flag in use gets a warning', async () => {
    const doc = await open('server.mjs');
    const d = await waitFor('archived diagnostic', () => vscode.languages.getDiagnostics(doc.uri).find((x) => x.code === 'archived-flag'));
    assert.match(d.message, /legacy_search/);
  });

  await test('autocomplete suggests flag keys inside a flag call', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'javascript', content: "flags.isFeatureEnabled('new_" });
    const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 28));
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.includes('new_checkout'), labels.slice(0, 20).join(', '));
    assert.ok(!labels.includes('legacy_search'), 'archived flags should not be suggested');
  });

  await test('toggle writes to Flagsmith, then the toggle back restores it', async () => {
    const client = store.connection!.client;
    const before = store.row('new_checkout')!.states.get(dev.id)!;
    await vscode.commands.executeCommand('flaglens.toggleFlag', 'new_checkout', dev.id);
    const after = await client.getFeatureState(dev.apiKey, before.featureStateId);
    assert.equal(after.enabled, !before.enabled);
    assert.equal(store.row('new_checkout')!.states.get(dev.id)!.enabled, !before.enabled, 'store not updated immediately');
    await vscode.commands.executeCommand('flaglens.toggleFlag', 'new_checkout', dev.id);
    assert.equal((await client.getFeatureState(dev.apiKey, before.featureStateId)).enabled, before.enabled);
  });

  await test('a change made outside the editor (dashboard/API) shows up by polling', async () => {
    const client = store.connection!.client;
    const fs = store.row('maintenance_mode')!.states.get(stg.id)!;
    await client.updateFeatureState(stg.apiKey, fs.featureStateId, { enabled: true });
    try {
      await waitFor('poll to pick up the change', () => store.row('maintenance_mode')!.states.get(stg.id)!.enabled, 15_000);
    } finally {
      await client.updateFeatureState(stg.apiKey, fs.featureStateId, { enabled: false });
    }
  });

  await test('declined confirmation changes nothing', async () => {
    app.confirm = async () => false;
    const client = store.connection!.client;
    const before = store.row('new_checkout')!.states.get(prd.id)!;
    await vscode.commands.executeCommand('flaglens.toggleFlag', 'new_checkout', prd.id);
    assert.equal((await client.getFeatureState(prd.apiKey, before.featureStateId)).enabled, before.enabled);
    app.confirm = async () => true;
  });

  await test('copy diff as Markdown lists Staging vs Production differences', async () => {
    const md = await vscode.commands.executeCommand<string>('flaglens.copyDiffMarkdown', stg.id, prd.id);
    assert.match(md, /\| `rate_limit_per_minute` \| on 100 \| on 50 \|/);
    assert.match(md, /\| `new_checkout` \| on \| off \|/);
    assert.equal(await vscode.env.clipboard.readText(), md);
  });

  await test('environment matrix opens', async () => {
    await vscode.commands.executeCommand('flaglens.openMatrix');
    const tab = await waitFor('matrix tab', () =>
      vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'Flagsmith Environment Matrix'),
    );
    assert.ok(tab);
  });

  console.log(`\nFlagLens integration tests\n${results.join('\n')}\n`);
  if (failures) throw new Error(`${failures} integration test(s) failed`);
}
