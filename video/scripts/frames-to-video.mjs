// Turns a captured track (irregularly timed JPEG frames) into an exact constant-frame-rate 60 fps video.
// Output frame k shows the newest captured frame at time start + k/60, so timing is faithful and no frame is
// dropped or duplicated by guesswork.
//
//   node scripts/frames-to-video.mjs recordings/<take>/<track> public/footage/<name>.mp4
import { readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

export async function framesToVideo(trackDir, outFile, { fps = 60 } = {}) {
  const index = JSON.parse(readFileSync(join(trackDir, 'index.json'), 'utf8'));
  const frames = index.frames;
  if (!frames.length) throw new Error(`no frames in ${trackDir}`);
  const start = index.startedAt;
  const end = Math.max(index.stoppedAt, frames.at(-1).t);
  const total = Math.ceil((end - start) * fps);
  mkdirSync(dirname(outFile), { recursive: true });

  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p',
    '-g', String(fps), '-r', String(fps), '-movflags', '+faststart',
    outFile,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));

  let j = 0;
  let current = readFileSync(join(trackDir, frames[0].file));
  let currentIdx = 0;
  let held = 0;
  for (let k = 0; k < total; k++) {
    const t = start + k / fps;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    if (j !== currentIdx) {
      current = readFileSync(join(trackDir, frames[j].file));
      currentIdx = j;
    } else held++;
    if (!ff.stdin.write(current)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  return { start, frames: total, captured: frames.length, seconds: total / fps, held };
}

if (process.argv[1].endsWith('frames-to-video.mjs')) {
  const [trackDir, out] = process.argv.slice(2);
  console.log(await framesToVideo(trackDir, out));
}
