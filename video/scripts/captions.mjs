// Writes YouTube captions (out/flaglens-demo.srt) and chapter timestamps (out/chapters.txt) from the edit: the
// voiceover's word timings placed where each part plays, and each scene's start.
//   node scripts/captions.mjs
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
// Bundled inside the project so the bundle can resolve remotion from node_modules.
const dir = join(root, '.cache');
mkdirSync(dir, { recursive: true });
const out = join(dir, 'timeline-captions.mjs');
await build({ entryPoints: [join(root, 'src/timeline.tsx')], bundle: true, platform: 'node', format: 'esm', outfile: out, external: ['remotion', 'react', 'react/*', '@remotion/*'], jsx: 'automatic', logLevel: 'silent' });
const { SCENES, sceneStarts } = await import(pathToFileURL(out).href);
const vo = (await import(pathToFileURL(join(root, 'src/data/vo.json')).href, { with: { type: 'json' } })).default;
rmSync(out, { force: true });
const FPS = 60;

// Words in absolute time, as Video.tsx plays them.
const words = [];
SCENES.forEach((s, i) => {
  for (const p of s.vo) {
    const from = p.from ?? 0;
    const to = p.to ?? vo[p.id].duration;
    const at = sceneStarts[i] / FPS + p.at - from;
    for (const w of vo[p.id].words) if (w.start >= from - 0.01 && w.start < to) words.push({ text: w.word, start: at + w.start, end: at + w.end });
  }
});

// Cues: up to ~42 characters, broken at sentence ends or pauses.
const cues = [];
let cur = null;
for (const w of words) {
  if (cur && (cur.text.length + w.text.length > 42 || w.start - cur.end > 0.6 || /[.?!]$/.test(cur.text))) {
    cues.push(cur);
    cur = null;
  }
  cur = cur ? { ...cur, text: `${cur.text} ${w.text}`, end: w.end } : { ...w };
}
if (cur) cues.push(cur);
const ts = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
writeFileSync(join(root, 'out/flaglens-demo.srt'), cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(Math.min(Math.max(c.end + 0.15, c.start + 0.8), (cues[i + 1]?.start ?? Infinity) - 0.02))}\n${c.text}\n`).join('\n'));

const NAMES = { hook: 'Code that never ran', problem: 'The problem', title: 'FlagLens: three promises', devkit: 'Self-hosted Flagsmith in two commands', greyout: '1. It knows what runs: greyed-out code', preview: '1. Preview as any user', fix: '2. It proves your rules, and fixes them', realtime: "3. It's live: dashboard to editor", health: '3. Feature Health alerts', toggle: 'Safe changes', testplan: 'Smallest test plan', montage: 'And the rest', outro: 'Recap' };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const chapters = SCENES.map((s, i) => (NAMES[s.id] ? `${mmss(sceneStarts[i] / FPS)} ${NAMES[s.id]}` : null)).filter(Boolean);
writeFileSync(join(root, 'out/chapters.txt'), chapters.join('\n') + '\n');
console.log(chapters.join('\n'));
console.log(`${cues.length} caption cues`);
