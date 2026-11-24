# The FlagLens demo video, built in code

The demo video is produced by a reproducible pipeline: real footage of the extension driven by a script, concept
animations in Manim, and the edit, captions and mix in Remotion.

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
- **Manim** renders the concept scenes (21 states → one line, drift, the stale-flag rule).
- **ElevenLabs** provides the voiceover (with word timestamps for the captions), sound effects and a seamless music
  loop. Every file is cached, so re-running never spends credits twice.

## Rebuild it

```bash
make up && make seed && make package          # from the repo root
cd video && npm install
node scripts/audio.mjs vo && node scripts/audio.mjs sfx && node scripts/audio.mjs beds   # needs ELEVENLABS_API_KEY in video/.env
node scripts/record.mjs && node scripts/record-dashboard.mjs                               # real footage (opens VS Code)
sh scripts/manim.sh                                                                        # needs Manim Community
node scripts/export-data.mjs
npm run render                                                                             # → out/flaglens-demo.mp4
```

Voice, sound effects and music: [ElevenLabs](https://elevenlabs.io).
