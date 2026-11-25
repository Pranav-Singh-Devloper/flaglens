// Records the real VS Code footage for the video, take by take, in one VS Code session.
//
//   make up && make seed            (self-hosted Flagsmith must be running)
//   node scripts/record.mjs [take ...]   default: all takes in order
//
// Each take writes recordings/<take>/{vscode,shop}/frames + index.json and recordings/<take>/<take>.events.json.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { launchVSCode, setViewport, repo } from './vscode.mjs';
import { Track, Director } from './capture.mjs';
import { framesToVideo } from './frames-to-video.mjs';

const REC = join(repo, 'video/recordings');
const FOOTAGE = join(repo, 'video/public/footage');
const VS_CAPTURE = { width: 2560, height: 1440, quality: 90 };
const SHOP_CAPTURE = { width: 1920, height: 1800, quality: 90 };

const only = process.argv.slice(2);
const want = (t) => only.length === 0 || only.includes(t);

// Fresh, known flag states for every recording session.
execFileSync('node', [join(repo, 'devkit/seed.mjs')], { stdio: 'ignore' });

// The demo shop, exactly as `make demo` runs it.
const shop = spawn('node', [join(repo, 'examples/demo-shop/server.mjs')], { stdio: 'ignore' });
const vs = await launchVSCode({
  workspace: join(repo, 'examples/demo-shop'),
  profile: '/tmp/flaglens-rec',
  extraArgs: ['--goto', join(repo, 'examples/demo-shop/server.mjs:69:1')],
});
const p = vs.page;
const cdp = await setViewport(p);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const shopCtx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
const shopPage = await shopCtx.newPage();
const shopCdp = await shopCtx.newCDPSession(shopPage);

const sel = {
  toastButton: (text) => p.locator('.notifications-toasts .monaco-button', { hasText: new RegExp(`^${text}$`) }),
  lens: (key) => p.locator('.codelens-decoration a', { hasText: new RegExp(`^\\S*\\s*${key}\\b`) }).first(),
  // Decorations (e.g. the strikethrough on archived flags) can split the quotes into separate spans.
  token: (text) => p.locator('.view-lines span', { hasText: new RegExp(`^'?${text}'?$`) }).last(),
  hover: p.locator('.monaco-hover:visible').first(),
  quickPickItem: (text) => p.locator('.quick-input-widget .monaco-list-row', { hasText: text }).first(),
  dialogButton: (text) => p.locator('.monaco-dialog-box .monaco-button', { hasText: new RegExp(`^${text}$`) }).first(),
  dialog: p.locator('.monaco-dialog-box').first(),
  quickInput: p.locator('.quick-input-widget').first(),
  explorerItem: (name) =>
    p.locator('.explorer-folders-view .monaco-list-row').filter({ has: p.locator('.label-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) }).first(),
  statusFlag: p.locator('.statusbar-item', { hasText: 'Demo Shop' }).first(),
};

/** Runs one take: starts the captures, performs the actions, stops, and converts frames to 60 fps video. */
async function take(name, fn, { withShop = false, shopUrl } = {}) {
  if (!want(name)) return;
  console.log(`● take ${name}`);
  if (withShop) {
    // The shop reloads itself now and then, which can interrupt a navigation: try again.
    for (let i = 0; ; i++) {
      try {
        await shopPage.goto(shopUrl ?? 'http://localhost:3030/');
        break;
      } catch (e) {
        if (i === 2) throw e;
        await shopPage.waitForTimeout(500);
      }
    }
    await shopPage.waitForTimeout(800);
  }
  const d = new Director(p, join(REC, name), name);
  d.cursor = takeCursor;
  const tracks = [new Track('vscode', cdp, join(REC, name), VS_CAPTURE)];
  if (withShop) tracks.push(new Track('shop', shopCdp, join(REC, name), SHOP_CAPTURE));
  for (const t of tracks) await t.start();
  d.log('start');
  await d.wait(600);
  try {
    await fn(d);
  } catch (e) {
    await p.screenshot({ path: join(REC, `FAILED-${name}.png`) }).catch(() => {});
    for (const t of tracks) await t.stop();
    console.error(`✖ take ${name} failed: ${e.message.split('\n')[0]}`);
    await browser.close();
    vs.close();
    shop.kill();
    process.exit(1);
  }
  await d.wait(500);
  d.log('end');
  for (const t of tracks) console.log(`  ${t.name}: ${await t.stop()} frames`);
  d.save();
  takeCursor = d.cursor;
  for (const t of tracks) {
    const r = await framesToVideo(join(REC, name, t.name), join(FOOTAGE, `${name}-${t.name}.mp4`));
    console.log(`  → ${name}-${t.name}.mp4 ${r.seconds.toFixed(1)}s (${r.captured} captured frames)`);
  }
}
let takeCursor = { x: 1100, y: 620 };

/** Shows an editor hover for a token: real mouse hover, with the keyboard command as a fallback. */
async function hoverToken(d, text) {
  await d.moveToLocator(sel.token(text), { ms: 800, dx: 0.45 });
  await d.wait(250);
  await p.mouse.move(d.cursor.x + 1, d.cursor.y); // a final tiny move, like a resting hand
  if (!(await sel.hover.isVisible().catch(() => false))) {
    await d.wait(700);
  }
  if (!(await sel.hover.isVisible().catch(() => false))) {
    await d.click();
    await p.keyboard.press('Meta+K');
    await p.keyboard.press('Meta+I');
  }
  await sel.hover.waitFor({ state: 'visible', timeout: 5000 });
  await d.mark(`hover:${text}`, sel.hover);
}

/** Scrolls the active editor so `line` is near the top (off camera, between takes). */
async function scrollLineToTop(line) {
  // Wheel events don't reach Monaco reliably here, so scroll like a keyboard user: go to the top, then move the
  // caret down; the editor scrolls one line at a time once the caret reaches the bottom edge.
  const editor = p.locator('.monaco-editor .view-lines').first();
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  const top = (await editor.boundingBox()).y;
  const editorFocused = () => p.evaluate(() => !!document.activeElement?.closest('.monaco-editor'));
  if (await editorFocused()) {
    // Keyboard only: opening any quick input would hide notification toasts (we need the Connect toast).
    await p.keyboard.press('Meta+ArrowUp');
  } else {
    // Go to Line focuses the editor reliably (a click can land on an overlay).
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+G');
    await sel.quickInput.waitFor({ state: 'visible' });
    await p.keyboard.type('1');
    await p.keyboard.press('Enter');
  }
  await p.waitForTimeout(300);
  const firstVisibleLine = () =>
    p.evaluate((editorTop) => {
      const nums = [...document.querySelectorAll('.monaco-editor .margin-view-overlays .line-numbers')]
        .map((e) => ({ n: Number(e.textContent), y: e.getBoundingClientRect().y }))
        .filter((x) => x.n > 0 && x.y >= editorTop - 2);
      return nums.length ? Math.min(...nums.map((x) => x.n)) : 0;
    }, top);
  for (let i = 0; i < 200; i++) {
    if ((await firstVisibleLine()) >= line) break;
    await p.keyboard.press('ArrowDown');
    await p.waitForTimeout(40);
  }
  // Park the caret on the target line with arrow keys (it is visible, so this doesn't scroll).
  const caretLine = async () => Number(/Ln (\d+)/.exec(await p.locator('.statusbar-item', { hasText: /Ln \d+/ }).first().innerText())?.[1] ?? 0);
  for (let i = 0, n = (await caretLine()) - (line + 1); i < n; i++) await p.keyboard.press('ArrowUp');
  await p.waitForTimeout(300);
  const caret = await p.locator('.statusbar-item', { hasText: /Ln \d+/ }).first().innerText().catch(() => '?');
  console.log(`  (scrolled to line ${line}; caret ${caret})`);
}

/** Runs a command from the palette off camera. */
async function command(name) {
  await p.keyboard.press('Escape');
  await p.keyboard.press('Meta+Shift+P');
  await sel.quickInput.waitFor({ state: 'visible' });
  await p.locator('.quick-input-widget input').first().waitFor({ state: 'visible' });
  await p.keyboard.type(name);
  await p.waitForTimeout(350);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
}

async function clearToasts() {
  await command('Notifications: Clear All Notifications');
  await p.keyboard.press('Escape');
}

async function openFile(name) {
  await p.keyboard.press('Meta+P');
  await p.waitForTimeout(250);
  await p.keyboard.type(name);
  await p.waitForTimeout(350);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(700);
}

const toast = (text) => p.locator('.notifications-toasts .notification-toast', { hasText: text }).first();
const webview = () => p.frameLocator('iframe.webview.ready').frameLocator('iframe#active-frame');

// ---------------------------------------------------------------------------------------------------------------
// Takes
// ---------------------------------------------------------------------------------------------------------------

// Wait for FlagLens to offer the key from .env, with server.mjs already open at the flag code.
// Either FlagLens offers the key from .env (fresh profile), or it is already connected.
await Promise.race([
  sel.toastButton('Connect').waitFor({ state: 'visible', timeout: 30_000 }),
  sel.statusFlag.waitFor({ state: 'visible', timeout: 30_000 }),
]);
if (!want('connect') && (await sel.toastButton('Connect').isVisible())) {
  await sel.toastButton('Connect').click();
  await sel.statusFlag.waitFor({ state: 'visible', timeout: 15_000 });
  await clearToasts();
}
await scrollLineToTop(68);
await p.waitForTimeout(400);

await take('connect', async (d) => {
  await d.mark('toast', p.locator('.notifications-toasts .notification-toast').first());
  await d.wait(900);
  await d.clickLocator(sel.toastButton('Connect'), { ms: 1000 });
  await sel.lens('new_checkout').waitFor({ state: 'visible', timeout: 15_000 });
  await d.mark('lenses', p.locator('.view-lines'));
  await d.wait(1800);
  await d.moveToLocator(sel.statusFlag, { ms: 900 });
  await d.mark('status', sel.statusFlag);
  await d.wait(1600);
});

await take('hover', async (d) => {
  await hoverToken(d, 'checkout_button_color');
  await d.wait(4500);
  await d.moveTo(1150, 300, 600);
  await d.wait(300);
  await d.clickLocator(sel.explorerItem('worker.py'), { ms: 900 });
  await sel.lens('rate_limit_per_minute').waitFor({ state: 'visible', timeout: 10_000 });
  await d.mark('python', p.locator('.view-lines'));
  await d.wait(2600);
  await d.clickLocator(sel.explorerItem('flagsmith.json'), { ms: 700 });
  await d.mark('flagsmithjson', p.locator('.view-lines'));
  await d.wait(2600);
});

/** Off camera: server.mjs open with the flag block at the top. */
async function prepServer() {
  await p.keyboard.press('Escape');
  await openFile('server.mjs');
  await scrollLineToTop(68);
  await p.mouse.move(takeCursor.x, takeCursor.y);
  await p.waitForTimeout(500);
}

if (want('toggle')) await prepServer();
await take(
  'toggle',
  async (d) => {
    await d.wait(400);
    await d.clickLocator(sel.lens('new_checkout'), { ms: 900, dx: 0.3 });
    await sel.quickInput.waitFor({ state: 'visible' });
    await d.mark('quickpick', sel.quickInput);
    await d.wait(900);
    await d.clickLocator(sel.quickPickItem('Turn off in Development'), { ms: 700, dx: 0.3 });
    await sel.dialog.waitFor({ state: 'visible' });
    await d.mark('dialog', sel.dialog);
    await d.wait(1100);
    await d.clickLocator(sel.dialogButton('Turn OFF'), { ms: 700 });
    await toast('is now OFF').waitFor({ state: 'visible', timeout: 10_000 });
    await d.mark('toast', toast('is now OFF'));
    await shopPage.waitForFunction(() => document.body.innerText.includes('step 1 of 3'), null, { timeout: 10_000 });
    await d.mark('shop-updated');
    await d.wait(1500);
  },
  { withShop: true, shopUrl: 'http://localhost:3030/' },
);
if (want('toggle')) await clearToasts();

if (want('protected')) await prepServer();
await take(
  'protected',
  async (d) => {
    await d.clickLocator(sel.lens('new_checkout'), { ms: 800, dx: 0.3 });
    await sel.quickInput.waitFor({ state: 'visible' });
    await d.wait(700);
    await d.clickLocator(sel.quickPickItem('Turn on in Production'), { ms: 700, dx: 0.3 });
    await sel.dialog.waitFor({ state: 'visible' });
    await d.mark('dialog', sel.dialog);
    await d.wait(1000);
    await d.clickLocator(sel.dialogButton('Turn ON'), { ms: 600 });
    await sel.quickInput.waitFor({ state: 'visible' });
    await d.mark('typed-confirm', sel.quickInput);
    await d.wait(700);
    await d.type('new_checkout');
    await d.wait(500);
    await d.key('Enter');
    await toast('is now ON').waitFor({ state: 'visible', timeout: 10_000 });
    await d.mark('toast', toast('is now ON'));
    await shopPage.waitForFunction(() => document.body.innerText.includes('One-page checkout'), null, { timeout: 10_000 });
    await d.mark('shop-updated');
    await d.wait(1200);
    // Undo: in a protected environment it asks again, by design.
    await d.clickLocator(toast('is now ON').locator('.monaco-button', { hasText: /^Undo$/ }), { ms: 800 });
    await sel.dialog.waitFor({ state: 'visible' });
    await d.mark('undo-dialog', sel.dialog);
    await d.wait(700);
    await d.clickLocator(sel.dialogButton('Turn OFF'), { ms: 600 });
    await sel.quickInput.waitFor({ state: 'visible' });
    await d.wait(400);
    await d.type('new_checkout', { cps: 18 });
    await d.wait(300);
    await d.key('Enter');
    await toast('is now OFF').waitFor({ state: 'visible', timeout: 10_000 });
    await d.mark('undone', toast('is now OFF'));
    await shopPage.waitForFunction(() => document.body.innerText.includes('step 1 of 3'), null, { timeout: 10_000 });
    await d.mark('shop-reverted');
    await d.wait(1200);
  },
  { withShop: true, shopUrl: 'http://localhost:3030/?env=Production' },
);
if (want('protected')) await clearToasts();

if (want('drift')) await prepServer();
await take('drift', async (d) => {
  await hoverToken(d, 'rate_limit_per_minute');
  await d.wait(3800);
  await d.moveTo(1300, 250, 500);
  await p.keyboard.press('Escape');
  await d.clickLocator(p.locator('.activitybar .action-item a[aria-label^="FlagLens"]').first(), { ms: 900 });
  const treeRow = p.locator('.pane-body .monaco-list-row', { hasText: 'rate_limit_per_minute' }).first();
  await treeRow.waitFor({ state: 'visible' });
  await d.mark('tree', p.locator('.sidebar').first());
  await d.wait(900);
  await d.clickLocator(treeRow, { ms: 800, dx: 0.3 });
  await d.wait(1600);
  // View-title actions appear when the pointer is over the sidebar, as in real use.
  await d.moveToLocator(p.locator('.sidebar .composite.title').first(), { ms: 700, dx: 0.6 });
  await d.wait(300);
  await d.clickLocator(p.locator('.action-label[aria-label="Open Environment Matrix"]:visible').first(), { ms: 500 });
  const onlyDiff = webview().locator('label', { hasText: 'Only differences' });
  await onlyDiff.waitFor({ state: 'visible', timeout: 15_000 });
  await d.wait(400);
  await d.mark('matrix', p.locator('.editor-group-container').first());
  await d.wait(1800);
  await d.clickLocator(onlyDiff, { ms: 900, dx: 0.12 });
  await d.wait(1600);
  await d.mark('matrix-diff', p.locator('.editor-group-container').first());
  await d.clickLocator(webview().locator('#copyDiff'), { ms: 900 });
  await toast('Copied').waitFor({ state: 'visible', timeout: 10_000 });
  await d.mark('copied', toast('Copied'));
  await d.wait(1800);
});
if (want('drift')) {
  await clearToasts();
  await command('View: Close All Editors');
  await p.locator('.activitybar .action-item a[aria-label^="Explorer"]').first().click();
}

await take('typo', async (d) => {
  await d.clickLocator(sel.explorerItem('typo.ts'), { ms: 900 });
  await sel.token('new_chekout').waitFor({ state: 'visible' });
  await d.wait(700);
  await d.mark('squiggle', sel.token('new_chekout'));
  await hoverToken(d, 'new_chekout');
  await d.wait(2600);
  await d.clickLocator(p.locator('.monaco-hover:visible a', { hasText: /Quick Fix/ }).first(), { ms: 700 });
  const fix = p.locator('.action-widget .monaco-list-row', { hasText: 'Replace with' }).first();
  await fix.waitFor({ state: 'visible' });
  await d.mark('quickfix', p.locator('.action-widget').first());
  await d.wait(900);
  await d.clickLocator(fix, { ms: 600, dx: 0.3 });
  await sel.lens('new_checkout').waitFor({ state: 'visible' });
  await d.mark('fixed', sel.lens('new_checkout'));
  await d.wait(1600);
  await d.clickLocator(sel.explorerItem('server.mjs'), { ms: 900 });
  await d.wait(600);
  await hoverToken(d, 'legacy_search');
  await d.wait(3000);
});
if (want('typo')) {
  // Put the typo back so the demo files stay as committed.
  await p.keyboard.press('Escape');
  await openFile('typo.ts');
  await p.keyboard.press('Meta+Z');
  await p.keyboard.press('Meta+S');
}

await take('stale', async (d) => {
  await d.clickLocator(sel.explorerItem('typo.ts'), { ms: 800 });
  await d.wait(500);
  await hoverToken(d, 'dark_mode');
  await d.wait(3200);
  await d.moveTo(1200, 400, 500);
  await p.keyboard.press('Escape');
  await d.key('Meta+Shift+M');
  await p.locator('.markers-panel').first().waitFor({ state: 'visible' });
  await d.wait(500);
  await d.mark('problems', p.locator('.part.panel').first());
  await d.wait(3200);
});
// Off camera: later takes need the editor's full height.
if (want('stale')) await command('View: Close Panel');

// ---------------------------------------------------------------------------------------------------------------
// v0.3 takes: greyed-out code, Preview as user, rule check, pairwise test plan, and the hook.
// ---------------------------------------------------------------------------------------------------------------

/** Off camera: pick an item in a FlagLens quick pick opened from the palette. */
async function paletteChoose(commandName, item) {
  await command(commandName);
  await sel.quickInput.waitFor({ state: 'visible' });
  await p.keyboard.type(item);
  await p.waitForTimeout(350);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(900);
}
const statusPersona = (text) => p.locator('.statusbar-item', { hasText: text }).first();
const dimmed = () => p.locator('.view-lines').first();

if (want('hook')) {
  await command('View: Close All Editors');
  await paletteChoose('FlagLens: Switch Active Environment', 'Production');
  await openFile('typo.ts');
  await p.mouse.move(1500, 900);
  await p.waitForTimeout(1200);
}
await take('hook', async (d) => {
  await d.mark('code', dimmed());
  await d.wait(1600);
  await d.mark('dead', p.locator('.view-line', { hasText: "return 'new'" }).first());
  await d.moveToLocator(sel.token('new_chekout'), { ms: 2600, dx: 0.5 });
  await d.mark('typo', sel.token('new_chekout'));
  await d.wait(2200);
});

if (want('greyout')) {
  await p.keyboard.press('Escape');
  await command('View: Close All Editors');
  await paletteChoose('FlagLens: Switch Active Environment', 'Development');
  await prepServer();
  await scrollLineToTop(73);
  await p.mouse.move(1300, 820);
  await p.waitForTimeout(800);
}
await take('greyout', async (d) => {
  await d.mark('dev', dimmed());
  await d.wait(2400);
  await d.clickLocator(sel.statusFlag, { ms: 1000 });
  await sel.quickInput.waitFor({ state: 'visible' });
  await d.mark('envpick', sel.quickInput);
  await d.wait(700);
  await d.clickLocator(sel.quickPickItem('Production'), { ms: 700, dx: 0.2 });
  await p.waitForTimeout(400);
  await d.mark('prod', dimmed());
  await d.moveTo(1300, 820, 700);
  await d.wait(2600);
});

if (want('preview')) {
  // Recorded on its own: Production, flag block in view, no horizontal scroll, no leftover tooltip.
  await p.keyboard.press('Escape');
  if (!want('greyout')) await paletteChoose('FlagLens: Switch Active Environment', 'Production');
  await prepServer();
  await scrollLineToTop(73);
  await p.mouse.move(1300, 820);
  await p.waitForTimeout(1200);
}
await take('preview', async (d) => {
  await d.clickLocator(statusPersona('Everyone'), { ms: 900 });
  await sel.quickInput.waitFor({ state: 'visible' });
  await d.mark('personas', sel.quickInput);
  await d.wait(1200);
  await d.clickLocator(sel.quickPickItem('Beta tester'), { ms: 800, dx: 0.2 });
  await statusPersona('Beta tester').waitFor({ state: 'visible' });
  await p.waitForTimeout(300);
  await d.mark('beta', dimmed());
  await d.wait(1800);
  await hoverToken(d, 'new_checkout');
  await d.wait(3800);
  await d.moveTo(1300, 860, 600);
  await d.wait(600);
});

if (want('rules')) {
  await p.keyboard.press('Escape');
  await paletteChoose('FlagLens: Preview Flags as User', 'Everyone');
  await prepServer();
  await scrollLineToTop(68);
}
await take('rules', async (d) => {
  await hoverToken(d, 'rate_limit_per_minute');
  await d.wait(3600);
  await d.moveTo(1300, 900, 500);
  await p.keyboard.press('Escape');
  await d.key('Meta+Shift+P');
  await sel.quickInput.waitFor({ state: 'visible' });
  await d.type('Check Targeting Rules', { cps: 22 });
  await d.wait(300);
  await d.key('Enter');
  await p.locator('.tab', { hasText: 'Targeting rule check' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  await d.wait(500);
  await d.key('Meta+K');
  await d.key('V');
  await p.locator('.tab', { hasText: 'Preview' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  await p.waitForTimeout(800);
  await d.mark('report', p.locator('.editor-group-container').last());
  await d.wait(3400);
});

if (want('testplan')) {
  await p.keyboard.press('Escape');
  await command('View: Close All Editors');
  const dont = sel.dialogButton("Don't Save");
  for (let i = 0; i < 3 && (await dont.isVisible().catch(() => false)); i++) {
    await dont.click();
    await p.waitForTimeout(500);
  }
  await prepServer();
}
await take('testplan', async (d) => {
  await d.wait(400);
  await d.key('Meta+Shift+P');
  await sel.quickInput.waitFor({ state: 'visible' });
  await d.type('Generate Pairwise', { cps: 22 });
  await d.wait(300);
  await d.key('Enter');
  await p.locator('.quick-input-widget', { hasText: 'which flags' }).first().waitFor({ state: 'visible' });
  await d.mark('flags', sel.quickInput);
  await d.wait(1700);
  await d.key('Enter');
  await p.locator('.quick-input-widget', { hasText: 'which values' }).first().waitFor({ state: 'visible' });
  await d.mark('mode', sel.quickInput);
  await d.wait(1800);
  await d.key('Enter');
  await p.locator('.tab', { hasText: 'Pairwise test plan' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  await d.wait(400);
  await d.key('Meta+K');
  await d.key('V');
  await p.locator('.tab', { hasText: 'Preview' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  await p.waitForTimeout(800);
  await d.mark('plan', p.locator('.editor-group-container').last());
  await d.wait(3200);
});

// ---------------------------------------------------------------------------------------------------------------
// v0.5 takes: fixing a rule from the editor, real time from the Flagsmith dashboard, Feature Health.
// ---------------------------------------------------------------------------------------------------------------
const seed = () => execFileSync('node', [join(repo, 'devkit/seed.mjs')], { stdio: 'ignore' });
const lensText = (key, re) =>
  p.waitForFunction(
    ([k, src]) => [...document.querySelectorAll('.codelens-decoration a')].some((a) => a.textContent.includes(k) && new RegExp(src).test(a.textContent)),
    [key, re.source],
    { timeout: 30_000 },
  );
const lensLacks = (key, re) =>
  p.waitForFunction(
    ([k, src]) => {
      const a = [...document.querySelectorAll('.codelens-decoration a')].find((x) => x.textContent.includes(k));
      return !!a && !new RegExp(src).test(a.textContent);
    },
    [key, re.source],
    { timeout: 30_000 },
  );
async function closeAll() {
  await p.keyboard.press('Escape');
  await command('View: Close All Editors');
  const dont = sel.dialogButton("Don't Save");
  for (let i = 0; i < 3 && (await dont.isVisible().catch(() => false)); i++) {
    await dont.click();
    await p.waitForTimeout(500);
  }
}

if (want('segfix')) {
  await closeAll();
  await paletteChoose('FlagLens: Switch Active Environment', 'Production');
  await paletteChoose('FlagLens: Preview Flags as User', 'Everyone');
  await prepServer();
  await lensText('rate_limit_per_minute', /rule issue/);
}
await take('segfix', async (d) => {
  await hoverToken(d, 'rate_limit_per_minute');
  await d.wait(1500);
  // The hover is taller than the room above the line: scroll its links into view, as a person would.
  const link = p.locator('.monaco-hover:visible a', { hasText: /Segment overrides/ }).first();
  await d.moveToLocator(p.locator('.monaco-hover:visible').first(), { ms: 500, dy: 0.6 });
  await link.scrollIntoViewIfNeeded();
  await d.mark('hover-links', sel.hover);
  await d.wait(500);
  await d.clickLocator(link, { ms: 500 });
  await sel.quickPickItem('Production').waitFor({ state: 'visible' });
  await d.wait(400);
  await d.clickLocator(sel.quickPickItem('Production'), { ms: 600, dx: 0.2 });
  await sel.quickPickItem('pro_eu').waitFor({ state: 'visible' });
  await d.mark('list', sel.quickInput);
  await d.wait(1500);
  await d.clickLocator(sel.quickPickItem('pro_eu'), { ms: 600, dx: 0.2 });
  await sel.quickPickItem('Move up').waitFor({ state: 'visible' });
  await d.mark('actions', sel.quickInput);
  await d.wait(800);
  await d.clickLocator(sel.quickPickItem('Move up'), { ms: 600, dx: 0.2 });
  await sel.dialog.waitFor({ state: 'visible' });
  await d.mark('dialog', sel.dialog);
  await d.wait(1300);
  await d.clickLocator(sel.dialogButton('Move pro_eu to position 1 of 2'), { ms: 600 });
  await sel.quickInput.waitFor({ state: 'visible' });
  await d.mark('typed-confirm', sel.quickInput);
  await d.type('rate_limit_per_minute', { cps: 28 });
  await d.key('Enter');
  await toast('Move pro_eu').waitFor({ state: 'visible', timeout: 15_000 });
  await d.mark('toast', toast('Move pro_eu'));
  await lensLacks('rate_limit_per_minute', /rule issue/);
  await d.mark('fixed', sel.lens('rate_limit_per_minute'));
  await d.wait(2200);
});
if (want('segfix')) {
  await clearToasts();
  seed();
  await lensText('rate_limit_per_minute', /rule issue/);
}

// Real time: the Flagsmith dashboard (left) and VS Code (right) are captured together; the cursor is in the dashboard.
if (want('realtime')) {
  await closeAll();
  await paletteChoose('FlagLens: Switch Active Environment', 'Development');
  await prepServer();
  await scrollLineToTop(68);
  await p.mouse.move(1500, 900);
  // The real-time webhook must be live (lightning bolt in the status bar).
  await p.locator('.statusbar-item', { hasText: 'Demo Shop' }).locator('.codicon-zap').first().waitFor({ state: 'attached', timeout: 30_000 });
}
if (want('realtime')) {
  const env = Object.fromEntries(
    readFileSync(join(repo, '.env'), 'utf8')
      .split('\n')
      .map((l) => /^([A-Z_]+)=(.*)$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const dashCtx = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 2 });
  const dash = await dashCtx.newPage();
  const dashCdp = await dashCtx.newCDPSession(dash);
  // Log in off camera with the dev kit's local demo account.
  await dash.goto(`${env.FLAGSMITH_API_URL}/login`);
  await dash.locator('input').first().fill(env.ADMIN_EMAIL);
  await dash.locator('input[type=password]').fill(env.ADMIN_PASSWORD);
  await dash.getByRole('button', { name: /log in/i }).click();
  await dash.waitForURL(/organisation/);
  await dash.goto(`${env.FLAGSMITH_API_URL}/project/${env.FLAGSMITH_PROJECT_ID}/environment/${env.FLAGSMITH_ENV_KEY_DEVELOPMENT}/features`);
  const sw = dash.locator('.list-item', { hasText: 'maintenance_mode' }).locator('[role=switch]:visible').first();
  await sw.waitFor({ state: 'visible', timeout: 20_000 });
  await dash.waitForTimeout(800);

  console.log('● take realtime');
  const d = new Director(dash, join(REC, 'realtime'), 'realtime');
  d.cursor = { x: 640, y: 420 };
  const tracks = [new Track('dash', dashCdp, join(REC, 'realtime'), SHOP_CAPTURE), new Track('vscode', cdp, join(REC, 'realtime'), VS_CAPTURE)];
  for (const t of tracks) await t.start();
  d.log('start');
  await d.wait(900);
  await d.clickLocator(sw, { ms: 900 });
  const confirm = dash.locator('.modal button:visible, [role=dialog] button:visible', { hasText: /^Confirm$/ }).first();
  await confirm.waitFor({ state: 'visible' });
  await d.mark('modal', dash.locator('.modal-content:visible, [role=dialog]:visible').first());
  await d.wait(900);
  await d.clickLocator(confirm, { ms: 600 });
  await d.mark('confirmed');
  const t0 = Date.now();
  await lensText('maintenance_mode', /Development\s*●\s*on/);
  await d.mark('vscode-updated');
  console.log(`  VS Code updated ${((Date.now() - t0) / 1000).toFixed(1)} s after the dashboard confirmed`);
  await d.wait(3000);
  d.log('end');
  for (const t of tracks) console.log(`  ${t.name}: ${await t.stop()} frames`);
  d.save();
  for (const t of tracks) {
    const r = await framesToVideo(join(REC, 'realtime', t.name), join(FOOTAGE, `realtime-${t.name}.mp4`));
    console.log(`  → realtime-${t.name}.mp4 ${r.seconds.toFixed(1)}s`);
  }
  await dashCtx.close();
  seed();
  await lensText('maintenance_mode', /Development\s*○\s*off/);
}

if (want('health')) {
  await closeAll();
  await paletteChoose('FlagLens: Switch Active Environment', 'Production');
  await prepServer();
  await scrollLineToTop(68);
}
await take('health', async (d) => {
  await d.wait(700);
  await d.mark('alert');
  execFileSync('node', [join(repo, 'devkit/health.mjs'), 'alert'], { stdio: 'ignore' });
  await lensText('new_checkout', /unhealthy/);
  await d.mark('badge', sel.lens('new_checkout'));
  await d.wait(1300);
  // Aim at the token on its own line (the badge appearing can shift the layout), and only go on once the hover
  // really is new_checkout's.
  const token = p.locator('.view-line', { hasText: "isFeatureEnabled('new_checkout')" }).locator('span', { hasText: /new_checkout/ }).last();
  const healthHover = p.locator('.monaco-hover:visible', { hasText: 'UNHEALTHY' }).first();
  for (let i = 0; i < 3 && !(await healthHover.isVisible().catch(() => false)); i++) {
    await p.keyboard.press('Escape');
    await d.moveToLocator(token, { ms: 700, dx: 0.45 });
    await d.wait(400);
    await p.mouse.move(d.cursor.x + 1, d.cursor.y);
    await healthHover.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
  }
  await healthHover.waitFor({ state: 'visible', timeout: 1000 });
  await d.mark('hover:new_checkout', healthHover);
  await d.wait(3000);
  await d.moveTo(1300, 900, 500);
  await p.keyboard.press('Escape');
  await d.clickLocator(sel.lens('new_checkout'), { ms: 800, dx: 0.3 });
  await sel.quickInput.waitFor({ state: 'visible' });
  await d.wait(500);
  await d.clickLocator(sel.quickPickItem('Turn on in Production'), { ms: 600, dx: 0.3 });
  await sel.dialog.waitFor({ state: 'visible' });
  await d.mark('dialog', sel.dialog);
  await d.wait(2800);
  await d.clickLocator(sel.dialogButton('Cancel'), { ms: 600 });
  await d.wait(600);
});
if (want('health')) execFileSync('node', [join(repo, 'devkit/health.mjs'), 'recover'], { stdio: 'ignore' });

await browser.close();
vs.close();
shop.kill();
// Leave the demo exactly as `make seed` defines it.
execFileSync('node', [join(repo, 'devkit/seed.mjs')], { stdio: 'ignore' });
process.exit(0);
