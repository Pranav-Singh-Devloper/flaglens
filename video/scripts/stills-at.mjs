// Renders stills of the edit at given times (seconds), bundling once. For checking the edit without a full render.
//   node scripts/stills-at.mjs out/stills 4 10.3 12 ...
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [outDir, ...times] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: join(process.cwd(), 'src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'FlagLensDemo' });
for (const t of times) {
  const frame = Math.round(Number(t) * composition.fps);
  await renderStill({ composition, serveUrl, frame, output: join(outDir, `t${String(t).padStart(6, '0')}.png`), imageFormat: 'png', scale: 0.5 });
  console.log(`  ${t}s`);
}
