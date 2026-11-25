// Fetches the reaction clips used as meme cards from Vlipsy and trims them for the edit.
//
//   node scripts/memes.mjs
//
// The clips belong to their studios; they are NOT committed (public/memes/ and .cache/ are git-ignored), so the
// repository never redistributes them. Each is used for one or two seconds, watermark intact, credited in the outro.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, '.cache/vlipsy');
const OUT = join(root, 'public/memes');
mkdirSync(OUT, { recursive: true });

/** name → Vlipsy clip id, page, and the part we use (seconds, from the clip's own word timings and frames). */
export const MEMES = {
  facepalm: { id: 'XxY47ckM', page: 'star-trek-picard-facepalm-XxY47ckM', from: 3.3, to: 6.1, title: 'Star Trek: TNG' },
  intercom: { id: 'Ti1v22iv', page: 'pulp-fiction-where-is-the-intercom-Ti1v22iv', from: 7.0, to: 9.05, title: 'Pulp Fiction' },
  pass: { id: 'gJcPDaxm', page: 'lord-of-the-rings-you-shall-not-pass-gJcPDaxm', from: 1.7, to: 4.6, title: 'The Lord of the Rings' },
  different: { id: 'WAbfsOQO', page: 'the-devil-wears-prada-its-a-tough-call-theyre-so-different-WAbfsOQO', from: 2.3, to: 3.42, title: 'The Devil Wears Prada' },
  math: { id: 'unXhJxNK', page: 'the-hangover-blackjack-math-unXhJxNK', from: 0.2, to: 2.7, title: 'The Hangover' },
  realestate: { id: 'R46n5O6p', page: 'tim-and-eric-free-real-estate-R46n5O6p', from: 0, to: 1.4, title: 'Tim and Eric Awesome Show' },
  nailedit: { id: '938F5rRD', page: 'the-office-nailed-it-938F5rRD', from: 1.2, to: 2.5, title: 'The Office' },
};

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const durations = {};
for (const [name, m] of Object.entries(MEMES)) {
  const dir = join(CACHE, m.id);
  const src = join(dir, `${m.id}.mp4`);
  if (!existsSync(src)) {
    mkdirSync(dir, { recursive: true });
    const res = await fetch(`https://cdn.vlipsy.com/clips/meta/${m.id}/480p-watermark.mp4`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${m.page}: HTTP ${res.status}`);
    writeFileSync(src, Buffer.from(await res.arrayBuffer()));
  }
  const out = join(OUT, `${name}.mp4`);
  // Loudness-match clips with sound; a silent clip (Picard) would make loudnorm divide by zero.
  const probe = execFileSync('ffmpeg', ['-hide_banner', '-ss', String(m.from), '-to', String(m.to), '-i', src, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(probe.toString())?.[1] ?? -99);
  const af = peak > -60 ? 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000' : 'aresample=48000';
  // Trim, then motion-interpolate to a true 60 fps: film is 24 fps, which can't be shown evenly at 60 fps without
  // judder (frames held 2, 3, 2, 3 times). Scene-cut detection keeps hard cuts clean. Then a Lanczos upscale.
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-ss', String(m.from), '-to', String(m.to), '-i', src,
    '-vf', 'minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff:scd_threshold=8,scale=1280:-2:flags=lanczos', '-af', af,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', out,
  ]);
  durations[name] = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
  console.log(`${name.padEnd(11)} ${durations[name].toFixed(2)}s  (${m.title}, vlipsy.com/clips/${m.page})`);
}
writeFileSync(join(root, 'src/data/memes.json'), JSON.stringify(durations, null, 1));
