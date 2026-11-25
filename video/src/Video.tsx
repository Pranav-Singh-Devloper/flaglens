import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import vo from './data/vo.json';
import { Captions, type CaptionTrack } from './components/Captions';
import { Meme, memeSeconds } from './components/Meme';
import { SCENES, TOTAL_FRAMES, sceneStarts } from './timeline';
import { FPS, sec } from './theme';

/** Every scene enters with a short, soft scale-and-fade, so cuts feel deliberate rather than abrupt. */
const SceneIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f, fps, config: { damping: 20, stiffness: 120 }, durationInFrames: 22 });
  return <AbsoluteFill style={{ opacity: interpolate(f, [0, 8], [0, 1], { extrapolateRight: 'clamp' }), transform: `scale(${1.035 - 0.035 * k})` }}>{children}</AbsoluteFill>;
};

/** Voiceover parts in absolute seconds: where they play, and which part of the clip. */
const voClips = SCENES.flatMap((s, i) =>
  s.vo.map((p) => {
    const from = p.from ?? 0;
    const to = p.to ?? vo[p.id].duration;
    return { id: p.id, at: sceneStarts[i]! / FPS + p.at, from, to };
  }),
);

/** Meme cards in absolute seconds. */
const memeCues = SCENES.flatMap((s, i) => (s.memes ?? []).map((m) => ({ ...m, abs: sceneStarts[i]! / FPS + m.at, scene: s.id })));

/** Music level: lower under the voice, near silent under a meme's own audio, higher in the gaps, with smooth ramps. */
function musicVolume(frame: number): number {
  const t = frame / FPS;
  const near = (start: number, end: number, ramp: number) => {
    const d = t < start ? start - t : t > end ? t - end : 0;
    return Math.max(0, 1 - d / ramp);
  };
  let voice = 0;
  for (const c of voClips) voice = Math.max(voice, near(c.at, c.at + (c.to - c.from), 0.5));
  let meme = 0;
  for (const m of memeCues) meme = Math.max(meme, near(m.abs, m.abs + memeSeconds(m.name), 0.15));
  const fadeIn = Math.min(1, t / 1.2);
  const outroStart = sceneStarts[sceneStarts.length - 1]! / FPS;
  const fadeOut = t < outroStart ? 1 : Math.max(0, 1 - (t - outroStart) / 1.5);
  return (0.3 - 0.17 * voice) * (1 - 0.85 * meme) * fadeIn * fadeOut;
}

export const FlagLensDemo: React.FC = () => {
  // Captions: the words of each part, shifted to where the part plays.
  const captions: CaptionTrack = voClips.map((c) => ({
    at: c.at - c.from,
    words: vo[c.id].words.filter((w) => w.start >= c.from - 0.01 && w.start < c.to),
  }));
  const outroStart = sceneStarts[sceneStarts.length - 1]!;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B1020' }}>
      {SCENES.map((s, i) => (
        <Sequence key={s.id} from={sceneStarts[i]} durationInFrames={sec(s.seconds)} name={s.id}>
          <SceneIn>{s.render()}</SceneIn>
        </Sequence>
      ))}

      {memeCues.map((m, i) => (
        <Sequence key={`meme-${i}`} from={Math.round(m.abs * FPS)} durationInFrames={Math.round(memeSeconds(m.name) * FPS)} name={`meme ${m.name}`}>
          <Meme name={m.name} caption={m.caption} volume={m.volume} />
        </Sequence>
      ))}

      <Captions track={captions} />

      {voClips.map((c, i) => (
        <Sequence key={`vo-${i}`} from={Math.round(c.at * FPS)} durationInFrames={Math.max(1, Math.round((c.to - c.from) * FPS))} name={`vo ${c.id}`}>
          <Audio src={staticFile(`audio/vo-${c.id}.mp3`)} startFrom={Math.round(c.from * FPS)} volume={1} />
        </Sequence>
      ))}

      <Audio src={staticFile('audio/music-loop.mp3')} loop volume={(f) => musicVolume(f)} />
      <Sequence from={outroStart} name="music end">
        <Audio src={staticFile('audio/music-end.mp3')} volume={0.45} />
      </Sequence>

      {SCENES.flatMap((s, i) =>
        s.sfx.map((x, j) => (
          <Sequence key={`${s.id}-sfx-${j}`} from={Math.max(0, sceneStarts[i]! + Math.round(x.at * FPS))} durationInFrames={x.len ? Math.round(x.len * FPS) : undefined} name={`sfx ${x.name}`}>
            <Audio src={staticFile(`audio/sfx-${x.name}.mp3`)} volume={x.volume ?? 0.4} />
          </Sequence>
        )),
      )}
    </AbsoluteFill>
  );
};

export const DURATION = TOTAL_FRAMES;
