// Collects everything the edit needs into src/data/*.json: per-take event logs (cursor moves, clicks, marks with
// element boxes) relative to each footage file's first frame, footage durations, and voiceover word timings.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const rec = join(root, 'recordings');
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

const takes = {};
for (const take of readdirSync(rec)) {
  const evFile = join(rec, take, `${take}.events.json`);
  if (!existsSync(evFile)) continue;
  const events = JSON.parse(readFileSync(evFile, 'utf8'));
  const tracks = {};
  for (const track of readdirSync(join(rec, take))) {
    const idx = join(rec, take, track, 'index.json');
    if (!existsSync(idx)) continue;
    const { startedAt } = JSON.parse(readFileSync(idx, 'utf8'));
    const file = `footage/${take}-${track}.mp4`;
    tracks[track] = { file, startedAt, duration: dur(join(root, 'public', file)) };
  }
  const main = tracks.vscode ?? tracks.dashboard;
  const rel = (t) => +(t - main.startedAt).toFixed(3);
  // VS Code records at window.zoomLevel 1.5, so Playwright reports zoomed CSS px. Scale them into the 1920x1080
  // frame the footage shows. (The dashboard and shop pages are not zoomed.)
  const zf = tracks.vscode ? Math.pow(1.2, 1.5) : 1;
  const pt = (p) => (p ? { x: +(p.x * zf).toFixed(1), y: +(p.y * zf).toFixed(1) } : p);
  const bx = (b) => (b ? { x: b.x * zf, y: b.y * zf, width: b.width * zf, height: b.height * zf } : b);
  takes[take] = {
    tracks: Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, { file: v.file, duration: v.duration, offset: +(v.startedAt - main.startedAt).toFixed(3) }])),
    events: events.map((e) => ({
      ...e,
      t: rel(e.t),
      ...(e.t0 !== undefined && { t0: rel(e.t0) }),
      ...(e.t1 !== undefined && { t1: rel(e.t1) }),
      ...(e.from && { from: pt(e.from) }),
      ...(e.to && { to: pt(e.to) }),
      ...(e.x !== undefined && { x: e.x * zf, y: e.y * zf }),
      ...(e.box && { box: bx(e.box) }),
    })),
  };
}
writeFileSync(join(root, 'src/data/takes.json'), JSON.stringify(takes, null, 1));

const script = JSON.parse(readFileSync(join(root, 'src/script.json'), 'utf8'));
const vo = Object.fromEntries(script.scenes.map((s) => [s.id, JSON.parse(readFileSync(join(root, `public/audio/vo-${s.id}.json`), 'utf8'))]));
writeFileSync(join(root, 'src/data/vo.json'), JSON.stringify(vo));

const manim = Object.fromEntries(['StatesScene', 'DriftScene', 'StaleScene'].map((s) => [s, dur(join(root, `public/manim/${s}.mp4`))]));
writeFileSync(join(root, 'src/data/manim.json'), JSON.stringify(manim));
console.log(Object.keys(takes).join(', '), '|', Object.entries(manim).map(([k, v]) => `${k} ${v}s`).join(', '));
