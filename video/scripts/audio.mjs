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

/**
 * Groups character timings into words: [{word, start, end}] in seconds. v3 audio tags such as [laughs] come back as
 * characters too; they are performed, not spoken, so they are left out of the captions.
 */
function words(alignment) {
  const out = [];
  let cur = null;
  let inTag = false;
  alignment.characters.forEach((ch, i) => {
    const s = alignment.character_start_times_seconds[i];
    const e = alignment.character_end_times_seconds[i];
    if (ch === '[') inTag = true;
    if (inTag) {
      if (ch === ']') inTag = false;
      if (cur) out.push(cur);
      cur = null;
      return;
    }
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
    // Eleven v3 performs audio tags ([laughs], [sighs], [whispers]…) and pauses; "Creative" (stability 0) is the most
    // expressive setting. It can improvise, so every take is transcribed and checked before it is kept.
    const v3 = script.voice.model === 'eleven_v3';
    let best = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`VO ${scene.id} (${scene.text.length} chars), take ${attempt}`);
      const r = await call(`/v1/text-to-speech/${script.voice.id}/with-timestamps?output_format=mp3_44100_128`, {
        text: scene.text,
        model_id: script.voice.model,
        ...(v3
          ? { voice_settings: { stability: 0, similarity_boost: 0.8 } }
          : {
              // Continuity between separately generated scenes.
              previous_text: scenes[i - 1]?.text,
              next_text: scenes[i + 1]?.text,
              voice_settings: { stability: 0.42, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.04 },
            }),
      }, { json: true });
      const audio = Buffer.from(r.audio_base64, 'base64');
      writeFileSync(mp3, audio);
      const check = await verify(mp3, scene.text);
      console.log(`  heard: "${check.heard}"\n  word accuracy ${(check.accuracy * 100).toFixed(0)}%, events: ${check.events.join(' ') || 'none'}${check.performed ? '' : ' (a tagged laugh/sigh is missing)'}`);
      const score = check.accuracy + (check.performed ? 1 : 0);
      if (!best || score > best.score) best = { score, audio, check, alignment: r.alignment };
      if (check.accuracy >= 0.92 && check.performed) break;
    }
    // Keep the best take, not the last one.
    writeFileSync(mp3, best.audio);
    const c = best.check;
    // A slightly faster delivery than the voice's natural pace keeps the video brisk. atempo keeps the pitch, and the
    // word timings are scaled to match.
    const tempo = script.voice.tempo ?? 1;
    let wordTimes = words(best.alignment);
    if (tempo !== 1) {
      const tmp = `${mp3}.tmp.mp3`;
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp3, '-filter:a', `atempo=${tempo}`, '-b:a', '128k', tmp]);
      execFileSync('mv', [tmp, mp3]);
      wordTimes = wordTimes.map((w) => ({ ...w, start: w.start / tempo, end: w.end / tempo }));
    }
    writeFileSync(meta, JSON.stringify({ id: scene.id, duration: duration(mp3), tempo, words: wordTimes, heard: c.heard, accuracy: c.accuracy, events: c.events }, null, 1));
  }
}

/**
 * Transcribes a take (ElevenLabs Scribe, with audio events such as laughter) and compares it with the script, so a
 * take where the voice improvised or skipped words is caught without anyone listening.
 */
async function verify(file, text) {
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('tag_audio_events', 'true');
  form.append('file', new Blob([readFileSync(file)], { type: 'audio/mpeg' }), 'take.mp3');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY }, body: form });
  if (!res.ok) throw new Error(`speech-to-text → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  appendFileSync(ledger, `${new Date().toISOString()} /v1/speech-to-text cost=${res.headers.get('character-cost') ?? '?'}\n`);
  const r = await res.json();
  // Compare words, not spelling: the transcriber writes "Flag Lens", "grays", "2:00 AM" for FlagLens, greys, two A.M.
  const SAME = [[/flag ?lens/g, 'flaglens'], [/flag ?smith/g, 'flagsmith'], [/\bgr[ae]ys?\b/g, 'grey'], [/favou?rite/g, 'favourite'], [/2:00 ?a\.?m\.?|two a\.? ?m\.?/g, 'two am'], [/\bmath\b/g, 'maths']];
  const norm = (s) => {
    let t = s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').toLowerCase();
    for (const [re, to] of SAME) t = t.replace(re, to);
    return t.replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  };
  const want = norm(text);
  const got = norm(r.text);
  // Word-level similarity: longest common subsequence over the longer of the two.
  const dp = Array.from({ length: want.length + 1 }, () => new Array(got.length + 1).fill(0));
  for (let a = 1; a <= want.length; a++) for (let b = 1; b <= got.length; b++) dp[a][b] = want[a - 1] === got[b - 1] ? dp[a - 1][b - 1] + 1 : Math.max(dp[a - 1][b], dp[a][b - 1]);
  const accuracy = dp[want.length][got.length] / Math.max(want.length, got.length);
  const events = (r.text.match(/\([^)]*\)|\[[^\]]*\]/g) ?? []).map((e) => e.toLowerCase());
  // Tags that should be audible (a laugh, a sigh) must show up as audio events; whispers and moods don't get tagged.
  const wanted = (text.match(/\[[^\]]*\]/g) ?? []).map((t) => (/laugh|chuckl|giggl/.test(t) ? 'laugh' : /sigh/.test(t) ? 'sigh' : null)).filter(Boolean);
  const family = { laugh: /laugh|chuckl|giggl/, sigh: /sigh|exhal/ };
  const performed = wanted.every((w) => events.some((e) => family[w].test(e)));
  return { heard: r.text, accuracy, events, performed };
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
  // Meme beats.
  boom: { text: 'Deep booming bass hit with short reverb tail, comedic dramatic reveal sound, punchy, internet meme style', seconds: 1.2 },
  scratch: { text: 'Vinyl record scratch, short, comedic freeze-frame moment', seconds: 0.8 },
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
    text: 'Instrumental background music loop for a modern tech product video: confident, energetic electronic beat at 128 BPM, warm analog synth bass, bright arpeggiated plucks, clean punchy drums, uplifting, polished, seamless loop, no vocals',
    seconds: 30,
    loop: true,
  },
  'music-end': {
    text: 'Short uplifting electronic music ending sting for a tech product video, final synth chord with drum hit and shimmering tail, 128 BPM, no vocals',
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
