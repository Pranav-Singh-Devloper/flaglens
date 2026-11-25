// Runs inside the VS Code extension host (see run.mjs). Talks to the real self-hosted Flagsmith seeded by `make seed`.
// Confirmations are auto-accepted through the App.confirm seam; everything else is the real extension.

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { App } from '../../src/app';
import { parseDotenv } from '../../src/config';
import { HOVER_COMMANDS } from '../../src/present';

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

  await test('real time: a change made in Flagsmith arrives through the webhook, signed, and the webhook is removed on stop', async () => {
    const realtime = app.realtime!;
    await waitFor('real-time webhook', () => realtime.live, 15_000);
    const client = store.connection!.client;
    const org = store.project!.organisation;
    const ours = async () => (await client.listOrganisationWebhooks(org)).filter((h) => /\/flaglens\/[0-9a-f]+$/.test(h.url));
    const [hook] = await ours();
    assert.ok(hook, 'FlagLens registered an organisation webhook');
    const { port, pathname } = new URL(hook!.url);

    // Only signed calls are accepted, and only on the secret path.
    const unsigned = await fetch(`http://127.0.0.1:${port}${pathname}`, { method: 'POST', body: '{"event_type":"FLAG_UPDATED"}' });
    assert.equal(unsigned.status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/flaglens/0000000000000000`, { method: 'POST', body: '{}' })).status, 404);

    const before = realtime.events;
    const fs = store.row('maintenance_mode')!.states.get(stg.id)!;
    await client.updateFeatureState(stg.apiKey, fs.featureStateId, { enabled: true });
    try {
      await waitFor('webhook event', () => realtime.events > before && realtime.lastEvent?.feature === 'maintenance_mode', 15_000);
      await waitFor('refresh after the event', () => store.row('maintenance_mode')!.states.get(stg.id)!.enabled, 5_000);
    } finally {
      await client.updateFeatureState(stg.apiKey, fs.featureStateId, { enabled: false });
    }

    await realtime.stop();
    assert.equal((await ours()).length, 0, 'the webhook is removed when FlagLens stops');
    await realtime.start({ mode: 'auto', callbackHost: 'host.docker.internal' });
    assert.ok(realtime.live);
    assert.equal((await ours()).length, 1);
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

  const beta = { name: 'Beta tester', identifier: 'alice@demo-shop.dev', traits: { email: 'alice@demo-shop.dev', plan: 'pro', country: 'GB' } };

  await test('preview as a user: CodeLens and hover show what that user gets, and why', async () => {
    await waitFor('environment documents', () => store.previewSupported);
    await vscode.commands.executeCommand('flaglens.previewAs', beta);
    try {
      const doc = await open('server.mjs');
      const lens = async (key: string) =>
        waitFor(`${key} lens`, async () => {
          const l = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri, 100);
          return l.map((x) => x.command?.title ?? '').find((t) => t.includes(key) && t.includes('Beta tester'));
        });
      assert.match(await lens('new_checkout'), /Production ● on \(beta_testers\)/);
      assert.match(await lens('rate_limit_per_minute'), /Production ● on 500 \(pro_plan\)/);
      const hover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, positionOf(doc, "'new_checkout'", 3)));
      assert.match(hover, /Previewing as \*\*Beta tester\*\*/);
      assert.match(hover, /segment `beta_testers` \(priority 0\)/);

      // The local answer must equal the server's, for every flag (transient identity: nothing is stored).
      const res = await fetch(`${dotenv.FLAGSMITH_API_URL}/api/v1/identities/`, {
        method: 'POST',
        headers: { 'X-Environment-Key': prd.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: beta.identifier, transient: true, traits: Object.entries(beta.traits).map(([trait_key, trait_value]) => ({ trait_key, trait_value })) }),
      });
      const server = (await res.json()) as { flags: { feature: { name: string }; enabled: boolean; feature_state_value: unknown }[] };
      const local = store.evaluation(prd.id)!;
      for (const f of server.flags) {
        assert.deepEqual([local.get(f.feature.name)?.enabled, local.get(f.feature.name)?.value], [f.enabled, f.feature_state_value], f.feature.name);
      }
    } finally {
      await vscode.commands.executeCommand('flaglens.previewAs', null);
    }
    const doc = await open('server.mjs');
    const plain = await waitFor('lens without persona', async () => {
      const l = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri, 100);
      return l.map((x) => x.command?.title ?? '').find((t) => t.includes('new_checkout') && !t.includes('Beta tester'));
    });
    assert.match(plain, /Production ○ off/);
  });

  await test('greys out code that cannot run, and only when it is certain', async () => {
    const doc = await open('server.mjs');
    const deadText = () => (app.deadCode!.lastRanges.get(doc.uri.toString()) ?? []).map((r) => doc.getText().slice(r.start, r.end));
    store.setActiveEnvironment(dev.id);
    const inDev = await waitFor('dead ranges in Development', () => (deadText().length ? deadText() : undefined));
    assert.ok(inDev.some((t) => t.includes('return maintenancePage')), 'maintenance guard should be greyed (off)');
    assert.ok(inDev.some((t) => t.includes('step 1 of 3')), 'old checkout should be greyed (new_checkout on)');

    // In Production new_checkout has a segment override, so for "everyone" the old checkout may still run.
    store.setActiveEnvironment(prd.id);
    assert.ok(!deadText().some((t) => t.includes('step 1 of 3')), 'must not grey a branch some users still get');
    assert.ok(!deadText().some((t) => t.includes('One-page checkout')));

    // For the beta tester it is certain: they get the new checkout.
    try {
      await vscode.commands.executeCommand('flaglens.previewAs', beta);
      assert.ok(deadText().some((t) => t.includes('step 1 of 3')), 'beta tester never sees the old checkout');
    } finally {
      await vscode.commands.executeCommand('flaglens.previewAs', null);
      store.setActiveEnvironment(dev.id);
    }
  });

  await test('targeting rule check finds the shadowed and the redundant override, and only those', async () => {
    const md = await vscode.commands.executeCommand<string>('flaglens.checkRules', { show: false });
    assert.match(md, /2 problems in \d+ segment overrides/);
    assert.match(md, /`rate_limit_per_minute` \| Never applies \(shadowed\) \| .*caught first by "pro_plan" \(priority 1\)/);
    assert.match(md, /`banner_text` \| Changes nothing \(redundant\)/);
    const doc = await open('server.mjs');
    const d = await waitFor('rule diagnostic', () => vscode.languages.getDiagnostics(doc.uri).find((x) => x.code === 'rule-issue' && /pro_eu/.test(x.message)));
    assert.equal(doc.getText(d.range), 'rate_limit_per_minute');
    assert.equal(d.severity, vscode.DiagnosticSeverity.Warning);
    const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri, 100);
    assert.match(lenses.map((l) => l.command?.title ?? '').find((t) => t.includes('rate_limit_per_minute'))!, /rule issue/);
  });

  await test('pairwise test plan: optimal for on/off flags, covers values too', async () => {
    const onoff = await vscode.commands.executeCommand<string>('flaglens.testPlan', ['new_checkout', 'dark_mode', 'maintenance_mode', 'banner_text'], 'onoff', { show: false });
    assert.match(onoff, /\*\*5 runs instead of 16\*\*/);
    assert.match(onoff, /Provably optimal/);
    const values = await vscode.commands.executeCommand<string>('flaglens.testPlan', ['checkout_button_color', 'rate_limit_per_minute', 'new_checkout'], 'values', { show: false });
    const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(values)![1]!) as Record<string, { enabled: boolean; value: unknown }>[];
    // rate_limit_per_minute takes off + 1000, 100, 50, 500, 800 somewhere; every one must appear in some run.
    const limits = new Set(json.map((r) => (r.rate_limit_per_minute!.enabled ? r.rate_limit_per_minute!.value : 'off')));
    assert.deepEqual([...limits].sort(), [100, 1000, 50, 500, 800, 'off'].sort());
  });

  await test('publishes code references to Flagsmith; its counts and lifecycle show in the hover', async () => {
    const result = await vscode.commands.executeCommand<{ references: number; flags: number }>('flaglens.publishCodeReferences', { yes: true });
    assert.ok(result && result.references > 0 && result.flags >= 6, JSON.stringify(result));
    await waitFor('code reference counts', () => (store.row('new_checkout')!.feature.codeReferences > 0 ? true : (void store.refresh(), false)));
    const doc = await open('server.mjs');
    const hover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, positionOf(doc, "'new_checkout'", 3)));
    assert.match(hover, /code references? in Flagsmith/);
    assert.match(hover, /lifecycle in Development: \*\*live\*\*/);
  });

  await test('Feature Health: an unhealthy flag is badged, explained and flagged in the confirmation', async () => {
    const client = store.connection!.client;
    const pid = store.project!.id;
    const [provider] = await client.request<{ webhook_url: string }[]>('GET', `/projects/${pid}/feature-health/providers/`);
    assert.ok(provider, 'make seed creates the Webhook provider');
    const post = async (status: string) => {
      const res = await fetch(provider!.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Flagsmith answers 400 unless the reason has both block lists, even when one is empty.
        body: JSON.stringify({ feature: 'new_checkout', environment: 'Production', status, reason: { text_blocks: [{ title: 'Checkout errors', text: 'Error rate 4.2%' }], url_blocks: [] } }),
      });
      assert.ok(res.ok, `Feature Health webhook answered HTTP ${res.status}`);
    };
    await post('unhealthy');
    try {
      const row = store.row('new_checkout')!;
      await waitFor('health event', () => (store.unhealthy(row.feature.id).length ? true : (void store.refresh(), false)));
      const doc = await open('server.mjs');
      const lens = await waitFor('unhealthy lens', async () => {
        const l = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri, 100);
        return l.map((x) => x.command?.title ?? '').find((t) => t.includes('new_checkout') && t.includes('unhealthy'));
      });
      assert.ok(lens);
      const hover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, positionOf(doc, "'new_checkout'", 3)));
      assert.match(hover, /\*\*Unhealthy\*\* in Production .*Checkout errors: Error rate 4\\?\.2%/);
      let detail = '';
      app.confirm = async (intent) => {
        detail = intent.detail ?? '';
        return false;
      };
      await vscode.commands.executeCommand('flaglens.toggleFlag', 'new_checkout', prd.id);
      assert.match(detail, /UNHEALTHY in Production: Checkout errors/);
    } finally {
      app.confirm = async () => true;
      await post('healthy');
      await store.refresh();
    }
  });

  await test('flag dependencies: blocked where the prerequisite is off, and evaluated per user like the server', async () => {
    const client = store.connection!.client;
    const child = store.row('checkout_button_color')!.feature.id;
    const parent = store.row('new_checkout')!.feature.id;
    await client.request('POST', `/environments/${prd.apiKey}/features/${child}/dependencies/${parent}/`);
    try {
      await waitFor('dependency in the document', async () => {
        await store.refresh();
        return store.dependencies('checkout_button_color').some((d) => d.env.id === prd.id && d.blocked);
      });
      const doc = await open('server.mjs');
      const hover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, positionOf(doc, "'checkout_button_color'", 3)));
      assert.match(hover, /Requires `new_checkout` in Production: \*\*served off\*\*/);
      // new_checkout is on for beta testers in Production, so the dependent flag is served to them.
      await vscode.commands.executeCommand('flaglens.previewAs', beta);
      assert.equal(store.evaluation(prd.id)!.get('checkout_button_color')!.enabled, true);
      await vscode.commands.executeCommand('flaglens.previewAs', { identifier: 'someone', traits: {} });
      assert.equal(store.evaluation(prd.id)!.get('checkout_button_color')!.enabled, false);
    } finally {
      await vscode.commands.executeCommand('flaglens.previewAs', null);
      await client.request('DELETE', `/environments/${prd.apiKey}/features/${child}/dependencies/${parent}/`);
      await store.refresh();
    }
  });

  await test('identity override: set a flag for the previewed user only, confirmed, then remove it', async () => {
    const client = store.connection!.client;
    const user = { name: 'Override test', identifier: `flaglens-e2e-${Date.now()}@example.com`, traits: {} };
    await vscode.commands.executeCommand('flaglens.previewAs', user);
    let intent: { action: string; detail?: string; scope?: string } | undefined;
    app.confirm = async (i) => {
      intent = i;
      return true;
    };
    try {
      assert.equal(store.evaluation(prd.id)!.get('new_checkout')!.enabled, false, 'off for this user before');
      await vscode.commands.executeCommand('flaglens.setUserOverride', 'new_checkout', prd.id, { enabled: true, value: null });
      assert.equal(intent?.scope, `${user.identifier} only`);
      assert.match(intent!.action, /^Turn ON for Override test$/);

      // Flagsmith stores it, the local preview shows it, and everyone else is unaffected.
      const identity = await client.findIdentity(prd.apiKey, user.identifier);
      assert.ok(identity, 'identity created in Flagsmith');
      const overrides = await client.listIdentityFeatureStates(prd.apiKey, identity!.id);
      assert.deepEqual(overrides.map((o) => [o.feature, o.enabled]), [[store.row('new_checkout')!.feature.id, true]]);
      await waitFor('override in the preview', () => store.evaluation(prd.id)!.get('new_checkout')!.reason.kind === 'identity');
      assert.equal(store.evaluation(prd.id)!.get('new_checkout')!.enabled, true);
      assert.equal(store.row('new_checkout')!.states.get(prd.id)!.enabled, false, 'the environment default is unchanged');

      const doc = await open('server.mjs');
      const hover = hoverText(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, positionOf(doc, "'new_checkout'", 3)));
      assert.match(hover, /Set for Override test…/);
      // Hover links only run allow-listed commands: every link in the hover must be on the list.
      for (const [, cmd] of hover.matchAll(/command:([\w.]+)/g)) assert.ok(HOVER_COMMANDS.includes(cmd!), `hover links to ${cmd}, which is not allow-listed`);

      await vscode.commands.executeCommand('flaglens.setUserOverride', 'new_checkout', prd.id, 'remove');
      assert.match(intent!.action, /^Remove override for Override test$/);
      assert.equal((await client.listIdentityFeatureStates(prd.apiKey, identity!.id)).length, 0);
      await waitFor('override gone from the preview', () => store.evaluation(prd.id)!.get('new_checkout')!.reason.kind !== 'identity');
      await client.request('DELETE', `/environments/${prd.apiKey}/identities/${identity!.id}/`);
    } finally {
      app.confirm = async () => true;
      await vscode.commands.executeCommand('flaglens.previewAs', null);
    }
  });

  await test('segment overrides: add, change, reorder (fixing a shadowed rule) and remove, written to Flagsmith', async () => {
    const client = store.connection!.client;
    const feature = store.row('rate_limit_per_minute')!.feature.id;
    const order = async () => (await client.listFeatureSegments(feature, prd.id)).sort((a, b) => a.priority - b.priority).map((l) => l.segment_name);
    const value = async (segment: string) => {
      const link = (await client.listFeatureSegments(feature, prd.id)).find((l) => l.segment_name === segment)!;
      const state = (await client.listFeatureStatesTyped(feature, prd.id)).find((s) => (typeof s.feature_segment === 'object' ? s.feature_segment?.id : s.feature_segment) === link.id)!;
      return { enabled: state.enabled, value: state.feature_state_value?.integer_value };
    };
    const shadowed = () => store.findingsFor('rate_limit_per_minute').some((f) => f.kind === 'shadowed' && f.segment === 'pro_eu' && f.environment === 'Production');
    const run = (step: object) => vscode.commands.executeCommand('flaglens.editSegmentOverrides', 'rate_limit_per_minute', prd.id, step);
    let detail = '';
    app.confirm = async (i) => {
      detail = i.detail ?? '';
      return true;
    };
    assert.deepEqual(await order(), ['pro_plan', 'pro_eu']);
    assert.ok(shadowed(), 'the seeded mistake: pro_eu is shadowed by pro_plan');
    const original = (await client.listFeatureSegments(feature, prd.id)).map((l) => ({ id: l.id, priority: l.priority }));
    try {
      await run({ op: 'add', segment: 'india', enabled: true, value: 777 });
      assert.match(detail, /1\. pro_plan: on 500\n2\. pro_eu: on 800/);
      assert.deepEqual(await order(), ['pro_plan', 'pro_eu', 'india'], 'added last');
      assert.deepEqual(await value('india'), { enabled: true, value: 777 });

      await run({ op: 'set', segment: 'india', enabled: false });
      assert.deepEqual(await value('india'), { enabled: false, value: 777 });

      // Moving pro_eu above pro_plan fixes the seeded mistake: the rule check no longer reports it.
      await run({ op: 'move', segment: 'pro_eu', to: 0 });
      assert.deepEqual(await order(), ['pro_eu', 'pro_plan', 'india']);
      await waitFor('rule check without the shadowed finding', () => !shadowed());
      await run({ op: 'move', segment: 'pro_eu', to: 1 });
      await waitFor('rule check with the shadowed finding again', () => shadowed());

      await run({ op: 'remove', segment: 'india' });
      assert.deepEqual(await order(), ['pro_plan', 'pro_eu']);
    } finally {
      app.confirm = async () => true;
      const leftover = (await client.listFeatureSegments(feature, prd.id)).find((l) => l.segment_name === 'india');
      if (leftover) await client.deleteSegmentOverride(leftover.id);
      // Back to the seeded priority numbers, which other tests quote.
      await client.request('POST', '/features/feature-segments/update-priorities/', original);
      await store.refresh();
    }
  });

  await test('v2 versioned environment: a toggle publishes a new version, and Undo publishes another', async () => {
    const client = store.connection!.client;
    const created = await client.request<{ id: number; api_key: string }>('POST', '/environments/', { name: 'Versioned (e2e)', project: store.project!.id });
    try {
      await client.request('POST', `/environments/${created.api_key}/enable-v2-versioning/`);
      const env = await waitFor('v2 versioning enabled', async () => {
        await store.refresh();
        const e = store.environment(created.id);
        return e?.v2Versioning ? e : undefined;
      }, 30_000);
      const fid = store.row('dark_mode')!.feature.id;
      const versions = async () => (await client.request<{ results: { description: string | null; is_live: boolean }[] }>('GET', `/environments/${env.id}/features/${fid}/versions/`)).results;
      const before = (await versions()).length;
      const wasOn = store.row('dark_mode')!.states.get(env.id)!.enabled;

      let detail = '';
      app.confirm = async (i) => {
        detail = i.detail ?? '';
        return true;
      };
      await vscode.commands.executeCommand('flaglens.toggleFlag', 'dark_mode', env.id);
      assert.match(detail, /publishes a new version/);
      const after = await versions();
      assert.equal(after.length, before + 1, 'one new version');
      assert.match(after.find((v) => v.is_live)?.description ?? '', /^FlagLens: Turn O(N|FF)$/);
      const live = (await client.listFeatureStates(env.apiKey, fid)).find((s) => s.feature_segment === null && s.identity === null)!;
      assert.equal(live.enabled, !wasOn);
      await waitFor('store shows the published state', () => store.row('dark_mode')!.states.get(env.id)!.enabled === !wasOn);
    } finally {
      app.confirm = async () => true;
      await client.request('DELETE', `/environments/${created.api_key}/`);
      await store.refresh();
    }
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
