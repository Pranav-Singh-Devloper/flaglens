# The FlagLens demo video, built in code

The demo video is produced by a reproducible pipeline: real footage of the extension driven by a script, an
expressive ElevenLabs voiceover that is checked by speech-to-text, reaction-clip memes, and the edit, captions and mix
in Remotion.

```
recordings (real)            animations            audio (ElevenLabs)
─────────────────            ──────────            ──────────────────
scripts/record.mjs           manim/scenes.py       scripts/audio.mjs
scripts/record-dashboard.mjs   └─ scripts/manim.sh   vo + word timings, sfx, music bed
   └─ frames-to-video.mjs (exact 60 fps)
                 \                 |                 /
                  └── scripts/export-data.mjs ──┐
                                                ▼
                         src/ (Remotion: edit, camera, cursor, captions, mix)
                                                ▼
                               out/flaglens-demo.mp4 (1080p60)
```

## How it works

- **Real VS Code, driven by a script.** `scripts/record.mjs` launches a clean VS Code with the released `.vsix`
  installed into a throwaway profile, connects to it over the Chrome DevTools Protocol with Playwright, and performs
  every take like a person would: eased mouse moves, real hovers, clicks, typing. Nothing in the footage is mocked:
  it runs against the self-hosted Flagsmith from `make up && make seed`, and the demo shop is the real
  `examples/demo-shop` server rendered in Chrome.
- **Frame-exact capture.** Each window is screencast at 2560×1440 (sharp when the edit zooms in). Every frame keeps
  its compositor timestamp, and `frames-to-video.mjs` resamples them onto an exact 60 fps grid, so the footage has a
  constant frame rate with no drift or guessed frames.
- **An event log drives the edit.** The director logs every cursor move, click, keystroke and the on-screen box of
  key elements (hover cards, dialogs, toasts). Remotion uses it to draw a smooth cursor with click ripples, aim the
  camera, and place click and typing sounds on the exact frame.
- **An expressive, verified voiceover.** The script (`src/script.json`) uses Eleven v3 audio tags (`[whispers]`,
  `[laughs]`, `[sighs]`) and pauses. v3 can improvise, so `scripts/audio.mjs` transcribes every take with ElevenLabs
  Scribe (with audio-event tagging), compares the words with the script and checks that each tagged laugh or sigh
  was actually performed. It keeps the best of up to three takes. Speech-to-text timings also give exact split points:
  a scene's voice can be cut at a word so a meme lands mid-sentence while the footage freezes underneath.
- **Memes.** `scripts/memes.mjs` fetches a few short reaction clips from [Vlipsy](https://vlipsy.com) and trims them.
  They belong to their studios, so they are **not committed** (`public/memes/` and `.cache/` are git-ignored); each is
  used for one to three seconds with its watermark intact, and credited in the outro.
- **ElevenLabs** also provides the sound effects (including the meme boom and record scratch) and a seamless music
  loop. Every file is cached, so re-running never spends credits twice.
- **Story.** The edit is built around three promises (it knows what runs, it proves your rules, it's live): a card
  names them after the title, each proving scene keeps its promise in the corner, and a recap card ends the video.
  The real-time scene captures the Flagsmith dashboard and VS Code together and times the update with a stopwatch.
- **Pace.** The voiceover is sped up slightly after generation (`tempo` in `src/script.json`, ffmpeg `atempo`, which
  keeps the pitch) and its word timings are scaled to match.
- **Manim** scenes from the first cut are still in `manim/`; the current edit doesn't use them.

## Rebuild it

```bash
make up && make seed && make package          # from the repo root
cd video && npm install
node scripts/audio.mjs vo && node scripts/audio.mjs sfx && node scripts/audio.mjs beds   # needs ELEVENLABS_API_KEY in video/.env
node scripts/record.mjs && node scripts/record-dashboard.mjs                               # real footage (opens VS Code)
node scripts/memes.mjs                                                                     # reaction clips (not committed)
node scripts/export-data.mjs
node scripts/stills-at.mjs out/stills 28 70 88 104                                              # optional: check moments
npm run render                                                                             # → out/flaglens-demo.mp4
```

Voice, sound effects and music: [ElevenLabs](https://elevenlabs.io). Reaction clips: [Vlipsy](https://vlipsy.com),
© their respective owners.
