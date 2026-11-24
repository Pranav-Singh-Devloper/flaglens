// Launches a clean VS Code (the build downloaded by the extension's integration tests) with FlagLens installed from
// the released .vsix, and connects Playwright to its window over the Chrome DevTools Protocol.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '../..');
const testDir = join(repo, 'extension/.vscode-test');
const build = readdirSync(testDir).find((d) => d.startsWith('vscode-darwin'));
export const APP = join(testDir, build, 'Visual Studio Code.app');
const CLI = join(APP, 'Contents/Resources/app/bin/code');
const ELECTRON = join(APP, 'Contents/MacOS/Code');

/** VS Code settings tuned for a crisp, distraction-free 1080p recording. */
export const RECORDING_SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  'window.zoomLevel': 1.5,
  'window.dialogStyle': 'custom',
  'window.titleBarStyle': 'custom',
  'window.commandCenter': false,
  'workbench.layoutControl.enabled': false,
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.editor.empty.hint': 'hidden',
  'chat.disableAIFeatures': true,
  'chat.commandCenter.enabled': false,
  'editor.fontSize': 15,
  'editor.lineHeight': 24,
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.cursorSmoothCaretAnimation': 'on',
  'editor.cursorBlinking': 'smooth',
  'editor.smoothScrolling': true,
  'editor.hover.delay': 200,
  'editor.lightbulb.enabled': 'on',
  'editor.inlayHints.enabled': 'off',
  'editor.guides.indentation': false,
  'editor.renderLineHighlight': 'none',
  'editor.occurrencesHighlight': 'off',
  'editor.selectionHighlight': false,
  'editor.matchBrackets': 'never',
  'editor.bracketPairColorization.enabled': false,
  'workbench.list.smoothScrolling': true,
  'breadcrumbs.enabled': false,
  'security.workspace.trust.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.ignoreRecommendations': true,
  'git.enabled': false,
  'scm.diffDecorations': 'none',
  'files.exclude': { '**/.vscode': true, '**/node_modules': true, '**/.env': true },
  'explorer.compactFolders': false,
  'typescript.validate.enable': false,
  'javascript.validate.enable': false,
};

export async function launchVSCode({ workspace, profile, port = 9400 + Math.floor(Math.random() * 500), vsix = join(repo, 'extension/flaglens.vsix'), settings = {}, extraArgs = [] }) {
  // A leftover instance from an aborted run would keep the debugging port and we would attach to the wrong window.
  try {
    execFileSync('pkill', ['-f', profile]);
    await new Promise((r) => setTimeout(r, 1500));
  } catch {
    // nothing to kill
  }
  rmSync(profile, { recursive: true, force: true });
  const userData = join(profile, 'user-data');
  const extDir = join(profile, 'extensions');
  mkdirSync(join(userData, 'User'), { recursive: true });
  writeFileSync(join(userData, 'User/settings.json'), JSON.stringify({ ...RECORDING_SETTINGS, ...settings }, null, 2));

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VSCODE_') && !k.startsWith('ELECTRON_')));
  if (!existsSync(vsix)) throw new Error(`Missing ${vsix}: run make package`);
  execFileSync(CLI, ['--user-data-dir', userData, '--extensions-dir', extDir, '--install-extension', vsix, '--force'], { env, stdio: 'pipe' });

  const proc = spawn(
    ELECTRON,
    [
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extDir}`,
      `--remote-debugging-port=${port}`,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-telemetry',
      '--disable-updates',
      // Keep secrets inside this throwaway profile (otherwise macOS Keychain-backed keys leak between profiles).
      '--password-store=basic',
      '--new-window',
      workspace,
      ...extraArgs,
    ],
    { env, stdio: 'ignore', detached: false },
  );

  let browser;
  for (let i = 0; i < 80 && !browser; i++) {
    await new Promise((r) => setTimeout(r, 250));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  if (!browser) throw new Error('Could not connect to VS Code over CDP');
  let page;
  for (let i = 0; i < 160 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('workbench'));
    if (!page) await new Promise((r) => setTimeout(r, 250));
  }
  if (!page) throw new Error('VS Code workbench window not found');
  await page.waitForSelector('.monaco-workbench', { timeout: 30_000 });
  return { browser, page, proc, close: () => proc.kill() };
}

/**
 * Forces the window's viewport to an exact 16:9 size, independent of the physical screen. Done through Playwright so
 * its input coordinates match what is rendered. Returns a CDP session for the screencast.
 */
export async function setViewport(page, width = 1920, height = 1080, deviceScaleFactor = 2) {
  await page.setViewportSize({ width, height });
  const cdp = await page.context().newCDPSession(page);
  // Same CSS size (so input coordinates still match), rendered at 2x for a sharp 4K capture we can zoom into.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  return cdp;
}
