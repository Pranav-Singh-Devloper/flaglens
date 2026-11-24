// Renders review stills at given seconds (one bundle, many frames).
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const secs = process.argv.slice(2).map(Number);
const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts'), publicDir: join(root, 'public') });
const composition = await selectComposition({ serveUrl, id: 'FlagLensDemo' });
mkdirSync(join(root, 'out/stills'), { recursive: true });
for (const s of secs) {
  const frame = Math.round(s * 60);
  await renderStill({ serveUrl, composition, frame, output: join(root, `out/stills/${String(s).padStart(6, '0')}.jpg`), imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5 });
  process.stdout.write(`${s} `);
}
console.log('done');
