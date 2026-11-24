// Burned-in captions from ElevenLabs word timestamps: short phrases, with the spoken word highlighted.
import React from 'react';
import { useCurrentFrame } from 'remotion';
import { C, FPS, SANS } from '../theme';

export type Word = { word: string; start: number; end: number };
export type CaptionTrack = { at: number; words: Word[] }[]; // `at` = absolute start (s) of each VO clip

type Phrase = { words: (Word & { abs: number; absEnd: number })[]; start: number; end: number };

function phrases(track: CaptionTrack): Phrase[] {
  const out: Phrase[] = [];
  for (const clip of track) {
    let cur: Phrase | null = null;
    for (const w of clip.words) {
      const ww = { ...w, abs: clip.at + w.start, absEnd: clip.at + w.end };
      if (!cur) cur = { words: [], start: ww.abs, end: ww.absEnd };
      cur.words.push(ww);
      cur.end = ww.absEnd;
      const chars = cur.words.map((x) => x.word).join(' ').length;
      if (/[.,:?!]$/.test(w.word) || chars > 38) {
        out.push(cur);
        cur = null;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export const Captions: React.FC<{ track: CaptionTrack }> = ({ track }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const all = React.useMemo(() => phrases(track), [track]);
  const p = all.find((x, i) => t >= x.start - 0.05 && t < Math.max(x.end + 0.25, Math.min((all[i + 1]?.start ?? 1e9) - 0.02, x.end + 0.6)));
  if (!p) return null;
  const fadeIn = Math.min(1, (t - (p.start - 0.05)) / 0.12);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 58, display: 'flex', justifyContent: 'center', zIndex: 100 }}>
      <div
        style={{
          maxWidth: 1300,
          padding: '12px 26px',
          borderRadius: 16,
          background: 'rgba(6,9,20,0.78)',
          border: `1px solid ${C.border}`,
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 40,
          lineHeight: 1.25,
          letterSpacing: -0.2,
          textAlign: 'center',
          opacity: fadeIn,
          transform: `translateY(${(1 - fadeIn) * 8}px)`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
        }}
      >
        {p.words.map((w, i) => {
          const spoken = t >= w.abs - 0.02;
          return (
            <span key={i} style={{ color: spoken ? '#FFFFFF' : 'rgba(230,232,240,0.42)', transition: 'none' }}>
              {w.word.replace(/\.\.\.$/, '…')}
              {i < p.words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
};
