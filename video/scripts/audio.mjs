// Generates the voiceover (per scene, with word timings for captions), sound effects and music with ElevenLabs.
// Every file is cached in public/audio/: re-running never spends credits twice. Delete a file to regenerate it.
//
//   node scripts/audio.mjs vo [sceneId]   voiceover (all scenes, or one)
//   node scripts/audio.mjs sfx            sound effects
//   node scripts/audio.mjs music          background music (Eleven Music: paid plans only)
//   node scripts/audio.mjs beds           free-tier music bed: seamless loops from the sound-effects model
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const KEY = env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error('Put ELEVENLABS_API_KEY in video/.env');
const OUT = join(root, 'public/audio');
mkdirSync(OUT, { recursive: true });
const ledger = join(root, 'public/audio/credits.log');

async function call(path, body, { json = false } = {}) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const cost = res.headers.get('character-cost') ?? res.headers.get('x-character-count') ?? '?';
  appendFileSync(ledger, `${new Date().toISOString()} ${path} cost=${cost}\n`);
  console.log(`  ${path.split('?')[0]} cost=${cost}`);
  return json ? res.json() : Buffer.from(await res.arrayBuffer());
}

const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

/** Groups character timings into words: [{word, start, end}] in seconds. */
function words(alignment) {
  const out = [];
  let cur = null;
  alignment.characters.forEach((ch, i) => {
    const s = alignment.character_start_times_seconds[i];
    const e = alignment.character_end_times_seconds[i];
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = null;
    } else if (!cur) cur = { word: ch, start: s, end: e };
    else {
      cur.word += ch;
      cur.end = e;
    }
  });
  if (cur) out.push(cur);
  return out;
}

async function vo(only) {
  const script = JSON.parse(readFileSync(join(root, 'src/script.json'), 'utf8'));
  const scenes = script.scenes;
  for (const [i, scene] of scenes.entries()) {
    if (only && scene.id !== only) continue;
    const mp3 = join(OUT, `vo-${scene.id}.mp3`);
    const meta = join(OUT, `vo-${scene.id}.json`);
    if (existsSync(mp3) && existsSync(meta)) continue;
    console.log(`VO ${scene.id} (${scene.text.length} chars)`);
    const r = await call(`/v1/text-to-speech/${script.voice.id}/with-timestamps?output_format=mp3_44100_128`, {
      text: scene.text,
      model_id: script.voice.model,
      // Continuity between separately generated scenes.
      previous_text: scenes[i - 1]?.text,
      next_text: scenes[i + 1]?.text,
      voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.04 },
    }, { json: true });
    writeFileSync(mp3, Buffer.from(r.audio_base64, 'base64'));
    writeFileSync(meta, JSON.stringify({ id: scene.id, duration: duration(mp3), words: words(r.alignment) }, null, 1));
  }
}

const SFX = {
  whoosh: { text: 'Fast cinematic whoosh transition, airy, clean, modern UI motion graphics', seconds: 1.2 },
  click: { text: 'Single soft mouse click, crisp, close-up, clean, no reverb', seconds: 0.5 },
  pop: { text: 'Soft UI pop notification sound, bubbly, modern app interface', seconds: 0.6 },
  success: { text: 'Positive bright UI success chime, short, modern, two notes', seconds: 1.0 },
  alert: { text: 'Subtle warning UI tone, short low double beep, modern interface', seconds: 0.8 },
  typing: { text: 'Fast mechanical keyboard typing, close-up, clean, steady', seconds: 2.5 },
  impact: { text: 'Deep cinematic logo reveal hit with shimmer tail, modern tech trailer', seconds: 2.5 },
  riser: { text: 'Short tension riser building up, modern tech trailer, clean', seconds: 2.0 },
};

async function sfx() {
  for (const [name, s] of Object.entries(SFX)) {
    const file = join(OUT, `sfx-${name}.mp3`);
    if (existsSync(file)) continue;
    console.log(`SFX ${name}`);
    const buf = await call('/v1/sound-generation?output_format=mp3_44100_128', {
      text: s.text,
      duration_seconds: s.seconds,
      prompt_influence: 0.6,
    });
    writeFileSync(file, buf);
  }
}

async function music() {
  const file = join(OUT, 'music.mp3');
  if (existsSync(file)) return;
  const lengthMs = Number(process.argv[3] ?? 170_000);
  console.log(`Music ${lengthMs / 1000}s`);
  const buf = await call('/v1/music?output_format=mp3_44100_128', {
    prompt:
      'Confident modern tech product launch background track, instrumental, 118 BPM, punchy electronic drums, warm analog synth bass, bright plucks, uplifting and driving but unobtrusive under a voiceover, clean mix, builds energy towards the end, no vocals',
    music_length_ms: lengthMs,
    force_instrumental: true,
  });
  writeFileSync(file, buf);
}

/** Free-tier music: the Music API needs a paid plan, so build the bed from seamless sound-generation loops. */
const BEDS = {
  'music-loop': {
    text: 'Instrumental background music loop for a modern tech product video: confident driving electronic beat at 120 BPM, warm analog synth bass, bright arpeggiated plucks, clean punchy drums, uplifting, polished, seamless loop, no vocals',
    seconds: 30,
    loop: true,
  },
  'music-end': {
    text: 'Short uplifting electronic music ending sting for a tech product video, final synth chord with drum hit and shimmering tail, 120 BPM, no vocals',
    seconds: 8,
    loop: false,
  },
};

async function musicBeds() {
  for (const [name, b] of Object.entries(BEDS)) {
    const file = join(OUT, `${name}.mp3`);
    if (existsSync(file)) continue;
    console.log(`Music bed ${name}`);
    const buf = await call('/v1/sound-generation?output_format=mp3_44100_128', {
      text: b.text,
      duration_seconds: b.seconds,
      prompt_influence: 0.5,
      loop: b.loop,
      model_id: 'eleven_text_to_sound_v2',
    });
    writeFileSync(file, buf);
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'vo') await vo(arg);
else if (cmd === 'sfx') await sfx();
else if (cmd === 'music') await music();
else if (cmd === 'beds') await musicBeds();
else console.log('usage: node scripts/audio.mjs vo|sfx|music');
