// Reaction-clip "meme cards" (clips from Vlipsy, see scripts/memes.mjs) and the stat card for the engine check.
import React from 'react';
import { AbsoluteFill, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import memes from '../data/memes.json';
import { C, FPS, SANS, clamp01 } from '../theme';

const IMPACT = loadAnton('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily;

export type MemeName = keyof typeof memes;
export const memeSeconds = (name: MemeName) => memes[name];

/**
 * A meme card over the scene: the scene dims, the clip pops in on a slightly tilted white card with its own audio,
 * and an optional caption in the classic meme style. Lives inside a Sequence that starts when the meme starts.
 */
export const Meme: React.FC<{ name: MemeName; caption?: string; tilt?: number; volume?: number }> = ({ name, caption, tilt = -2, volume = 0.9 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.round(memes[name] * fps);
  const inK = spring({ frame: f, fps, config: { damping: 13, stiffness: 210, mass: 0.8 } });
  const outK = clamp01((f - (total - 7)) / 7);
  const scale = (0.62 + 0.38 * inK) * (1 - 0.08 * outK);
  const rot = tilt + (1 - inK) * -9;
  const dim = clamp01(f / 5) * (1 - outK);
  const w = 1180;
  const h = Math.round((w * 9) / 16);
  return (
    <AbsoluteFill style={{ zIndex: 60 }}>
      <AbsoluteFill style={{ background: `rgba(4,6,14,${0.72 * dim})` }} />
      <div
        style={{
          position: 'absolute',
          left: 960 - w / 2,
          top: 500 - h / 2,
          width: w,
          height: h,
          transform: `scale(${scale}) rotate(${rot}deg)`,
          opacity: 1 - outK,
          borderRadius: 18,
          overflow: 'hidden',
          border: '8px solid #FFFFFF',
          boxShadow: '0 50px 140px rgba(0,0,0,0.65)',
          background: '#000',
        }}
      >
        <OffthreadVideo src={staticFile(`memes/${name}.mp4`)} volume={volume} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {caption && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 26,
              textAlign: 'center',
              fontFamily: IMPACT,
              fontSize: 62,
              lineHeight: 1.05,
              color: 'white',
              textTransform: 'uppercase',
              letterSpacing: 1,
              WebkitTextStroke: '3px black',
              paintOrder: 'stroke fill',
              textShadow: '0 4px 0 rgba(0,0,0,0.6)',
              padding: '0 40px',
            }}
          >
            {caption}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/** "15,050 / 15,050": FlagLens's local evaluation against the live server, counting up. */
export const StatCard: React.FC<{ countAt: number; missesAt: number }> = ({ countAt, missesAt }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const { fps } = useVideoConfig();
  const k = spring({ frame: f, fps, config: { damping: 16, stiffness: 170 } });
  const n = Math.round(15050 * clamp01((t - countAt) / 1.3) ** 0.6);
  const miss = spring({ frame: f - missesAt * fps, fps, config: { damping: 12, stiffness: 220 } });
  return (
    <div
      style={{
        position: 'absolute',
        right: 70,
        top: 120,
        width: 640,
        padding: '30px 36px',
        borderRadius: 24,
        background: 'rgba(11,16,32,0.94)',
        border: `1px solid ${C.border}`,
        boxShadow: '0 40px 110px rgba(0,0,0,0.6)',
        fontFamily: SANS,
        opacity: k,
        transform: `translateX(${(1 - k) * 80}px)`,
        zIndex: 55,
      }}
    >
      <div style={{ color: C.muted, fontSize: 22, fontWeight: 600, marginBottom: 10 }}>Local evaluation vs. the live Flagsmith server</div>
      <div style={{ color: C.text, fontSize: 84, fontWeight: 800, letterSpacing: -3, fontVariantNumeric: 'tabular-nums' }}>
        {n.toLocaleString('en-GB')} <span style={{ color: C.muted, fontSize: 48 }}>/ 15,050</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14 }}>
        <div
          style={{
            padding: '8px 20px',
            borderRadius: 999,
            background: 'rgba(46,204,113,0.16)',
            color: C.on,
            fontWeight: 800,
            fontSize: 30,
            transform: `scale(${0.6 + 0.4 * miss})`,
            opacity: clamp01(miss * 2),
          }}
        >
          0 misses ✓
        </div>
        <div style={{ color: C.muted, fontSize: 20, opacity: interpolate(t, [missesAt, missesAt + 0.4], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          random users · every rule operator · make verify-engine
        </div>
      </div>
    </div>
  );
};

/** A pulsing ring around a spot on screen (scene coordinates), for the hook's typo reveal. */
export const Ring: React.FC<{ x: number; y: number; w: number; h: number; at: number }> = ({ x, y, w, h, at }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - at * fps, fps, config: { damping: 10, stiffness: 260 } });
  if (f < at * fps) return null;
  const pulse = 1 + 0.04 * Math.sin((f / fps - at) * 9);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - 14,
        top: y - 10,
        width: w + 28,
        height: h + 20,
        borderRadius: 14,
        border: `5px solid ${C.bad}`,
        boxShadow: `0 0 0 8px rgba(255,93,93,0.18), 0 0 40px rgba(255,93,93,0.5)`,
        transform: `scale(${(0.4 + 0.6 * k) * pulse})`,
        opacity: k,
        zIndex: 30,
        pointerEvents: 'none',
      }}
    />
  );
};
