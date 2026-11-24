import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import vo from './data/vo.json';
import { Captions, type CaptionTrack } from './components/Captions';
import { SCENES, TOTAL_FRAMES, sceneStarts } from './timeline';
import { FPS, sec } from './theme';

/** Every scene enters with a short, soft scale-and-fade, so cuts feel deliberate rather than abrupt. */
const SceneIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f, fps, config: { damping: 20, stiffness: 120 }, durationInFrames: 22 });
  return <AbsoluteFill style={{ opacity: interpolate(f, [0, 8], [0, 1], { extrapolateRight: 'clamp' }), transform: `scale(${1.035 - 0.035 * k})` }}>{children}</AbsoluteFill>;
};

/** Voiceover clips in absolute seconds. */
const voClips = SCENES.flatMap((s, i) => (s.vo ? [{ id: s.vo.id, at: sceneStarts[i]! / FPS + s.vo.at }] : []));

/** Music level: lower under the voice, higher in the gaps, with smooth ramps. */
function musicVolume(frame: number): number {
  const t = frame / FPS;
  let w = 0;
  for (const c of voClips) {
    const start = c.at;
    const end = c.at + vo[c.id].duration;
    const d = t < start ? start - t : t > end ? t - end : 0;
    w = Math.max(w, Math.max(0, 1 - d / 0.5));
  }
  const fadeIn = Math.min(1, t / 1.2);
  const outroStart = sceneStarts[sceneStarts.length - 1]! / FPS;
  const fadeOut = t < outroStart ? 1 : Math.max(0, 1 - (t - outroStart) / 1.5);
  return (0.3 - 0.17 * w) * fadeIn * fadeOut;
}

export const FlagLensDemo: React.FC = () => {
  const captions: CaptionTrack = voClips.map((c) => ({ at: c.at, words: vo[c.id].words }));
  const outroStart = sceneStarts[sceneStarts.length - 1]!;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B1020' }}>
      {SCENES.map((s, i) => (
        <Sequence key={s.id} from={sceneStarts[i]} durationInFrames={sec(s.seconds)} name={s.id}>
          <SceneIn>{s.render()}</SceneIn>
        </Sequence>
      ))}

      <Captions track={captions} />

      {voClips.map((c) => (
        <Sequence key={`vo-${c.id}`} from={Math.round(c.at * FPS)} name={`vo ${c.id}`}>
          <Audio src={staticFile(`audio/vo-${c.id}.mp3`)} volume={1} />
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
