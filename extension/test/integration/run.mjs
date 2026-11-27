// End-to-end test: runs the extension inside a real VS Code against the self-hosted dev kit.
//
//   make up && make seed && npm run test:integration -w extension
//   make seed-cloud && FLAGLENS_IT_CLOUD=1 npm run test:integration -w extension   (against Flagsmith Cloud, see cloud.ts)
//
// Downloads the latest stable VS Code into .vscode-test/ on first run (or uses VSCODE_PATH).
import { runTests } from '@vscode/test-electron';
import * as esbuild from 'esbuild';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, '../..');
const workspace = resolve(extensionDevelopmentPath, '../examples/demo-shop');
const CLOUD = !!process.env.FLAGLENS_IT_CLOUD;
const cloudEnv = resolve(extensionDevelopmentPath, '../.env.cloud');
if (CLOUD && !existsSync(cloudEnv)) {
  console.error('No .env.cloud. Run make seed-cloud first (see .env.example).');
  process.exit(1);
}

await esbuild.build({
  entryPoints: [join(here, CLOUD ? 'cloud.ts' : 'suite.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  outfile: join(extensionDevelopmentPath, 'dist-test/suite.js'),
  logLevel: 'warning',
});

// Downloads (and caches in .vscode-test/) a clean VS Code build, the same way CI does. Set VSCODE_PATH to use a
// specific installed VS Code binary instead.
const vscodeExecutablePath = process.env.VSCODE_PATH && existsSync(process.env.VSCODE_PATH) ? process.env.VSCODE_PATH : undefined;

// When this runs from a terminal inside VS Code (or a fork), inherited VSCODE_* / ELECTRON_* variables make the test
// instance try to attach to the parent editor and get killed. Start it with a clean environment.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VSCODE_') || name.startsWith('ELECTRON_')) delete process.env[name];
}

try {
  await runTests({
    ...(vscodeExecutablePath ? { vscodeExecutablePath } : { version: 'stable' }),
    extensionDevelopmentPath,
    extensionTestsPath: join(extensionDevelopmentPath, 'dist-test/suite.js'),
    ...(CLOUD && { extensionTestsEnv: { FLAGLENS_IT_ENV: cloudEnv } }),
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'flaglens-it-'))}`],
  });
} catch (e) {
  console.error('Integration tests failed:', e);
  process.exit(1);
}
