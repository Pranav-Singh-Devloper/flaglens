// Graphics for the "three promises" structure of the video: the promise card after the title, a persistent pillar
// badge on the scenes that prove each promise, a stopwatch for real time, still images for the montage, and the
// recap at the end.
import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, FPS, MONO, SANS, clamp01 } from '../theme';
import { Background, Logo, Window } from './Chrome';

const pop = (frame: number, at: number, fps = FPS) => spring({ frame: frame - at * fps, fps, config: { damping: 15, stiffness: 160 } });

export const PROMISES = ['It knows what runs', 'It proves your rules', "It's live"] as const;
const PROMISE_PROOF = ['15,050 / 15,050 checks match the server', 'every finding holds for every user', 'seconds from dashboard to editor'];

/** The title, then the three promises appearing on the words that name them. */
export const PromiseCard: React.FC<{ subAt: number; claimsAt: [number, number, number] }> = ({ subAt, claimsAt }) => {
  const f = useCurrentFrame();
  const logo = pop(f, 0.1);
  const sub = pop(f, subAt);
  // The wordmark moves up once the promises start.
  const lift = interpolate(f, [claimsAt[0] * FPS - 8, claimsAt[0] * FPS + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, transform: `translateY(${-lift * 40}px)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, opacity: logo, transform: `scale(${(0.9 + 0.1 * logo) * (1 - 0.28 * lift)})` }}>
          <Logo size={140} />
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 132, letterSpacing: -5, color: C.text }}>
            Flag<span style={{ color: C.accent2 }}>Lens</span>
          </div>
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 42, color: C.muted, opacity: sub, transform: `translateY(${(1 - sub) * 16}px)` }}>
          Self-hosted Flagsmith, live inside VS Code
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 24 }}>
          {PROMISES.map((p, i) => {
            const k = pop(f, claimsAt[i]!);
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: k, transform: `translateX(${(1 - k) * -50}px)` }}>
                <div style={{ width: 58, height: 58, borderRadius: 58, background: C.accent, color: 'white', display: 'grid', placeItems: 'center', fontFamily: SANS, fontWeight: 800, fontSize: 30 }}>{i + 1}</div>
                <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 60, letterSpacing: -1.5, color: C.text }}>{p}.</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Which promise the current scene proves: stays on screen for the whole scene. */
export const Pillar: React.FC<{ n: 1 | 2 | 3 }> = ({ n }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - 4, fps, config: { damping: 18, stiffness: 140 } });
  return (
    <div
      style={{
        position: 'absolute',
        left: 40,
        top: 22,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 22px 10px 10px',
        borderRadius: 999,
        background: 'rgba(124,108,255,0.92)',
        boxShadow: '0 12px 40px rgba(124,108,255,0.35)',
        transform: `translateX(${interpolate(k, [0, 1], [-50, 0])}px)`,
        opacity: k,
        fontFamily: SANS,
        zIndex: 60,
      }}
    >
      <div style={{ width: 36, height: 36, borderRadius: 36, background: 'white', color: C.accent, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 19 }}>{n}</div>
      <div style={{ color: 'white', fontWeight: 800, fontSize: 25 }}>{PROMISES[n - 1]}</div>
    </div>
  );
};

/** Counts from `from` (scene seconds) and stops at `to`, showing the measured time. */
export const Stopwatch: React.FC<{ from: number; to: number; seconds: number; x: number; y: number }> = ({ from, to, seconds, x, y }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  if (t < from - 0.2) return null;
  const running = t < to;
  const shown = running ? Math.max(0, ((t - from) / (to - from)) * seconds) : seconds;
  const k = pop(f, from - 0.2);
  const done = pop(f, to);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-50%, 0) scale(${0.9 + 0.1 * k + 0.08 * (running ? 0 : Math.sin(Math.min(1, done) * Math.PI))})`,
        opacity: k,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '14px 28px',
        borderRadius: 18,
        background: running ? 'rgba(20,26,46,0.92)' : 'rgba(46,204,113,0.95)',
        border: `1px solid ${running ? C.border : 'transparent'}`,
        fontFamily: SANS,
        color: running ? C.text : '#06210F',
        boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
        whiteSpace: 'nowrap',
        zIndex: 40,
      }}
    >
      <div style={{ fontSize: 30 }}>{running ? '⏱' : '⚡'}</div>
      <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 40 }}>{shown.toFixed(1)} s</div>
      <div style={{ fontWeight: 700, fontSize: 24, opacity: 0.85 }}>{running ? 'dashboard → editor' : 'in the editor, no refresh'}</div>
    </div>
  );
};

/** A one-line terminal, e.g. `make alert`, with a note. */
export const TermChip: React.FC<{ at: number; until?: number; cmd: string; note: string; x: number; y: number }> = ({ at, until, cmd, note, x, y }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  if (t < at || (until !== undefined && t > until + 0.3)) return null;
  const k = pop(f, at);
  const out = until === undefined ? 1 : interpolate(t, [until, until + 0.3], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const typed = cmd.slice(0, Math.floor(clamp01((t - at) / 0.5) * cmd.length));
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, 0) translateY(${(1 - k) * 20}px)`, opacity: k * out, zIndex: 40, fontFamily: SANS }}>
      <div style={{ padding: '16px 26px', borderRadius: 16, background: '#0F1220', border: `1px solid ${C.border}`, boxShadow: '0 24px 70px rgba(0,0,0,0.5)', fontFamily: MONO, fontSize: 34, color: C.text }}>
        <span style={{ color: C.on }}>❯ </span>
        {typed}
        <span style={{ opacity: Math.floor(t * 2) % 2 ? 0 : 1 }}>▍</span>
      </div>
      <div style={{ marginTop: 10, textAlign: 'center', color: C.text, fontSize: 22, fontWeight: 600, padding: '6px 14px', borderRadius: 10, background: 'rgba(11,16,32,0.9)' }}>{note}</div>
    </div>
  );
};

/** A screenshot in a window, with a slow push in. */
export const Still: React.FC<{ src: string; bar?: string; seconds: number; focus?: { x: number; y: number }; zoom?: number }> = ({ src, bar, seconds, focus = { x: 0.5, y: 0.5 }, zoom = 1.12 }) => {
  const f = useCurrentFrame();
  const k = clamp01(f / (seconds * FPS));
  const z = 1 + (zoom - 1) * k;
  const rect = { x: 160, y: 70, w: 1600, h: 946 };
  return (
    <AbsoluteFill>
      <Background />
      <Window rect={rect} bar={bar ? { kind: 'browser', text: bar } : undefined} lights={!bar}>
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${z})`, transformOrigin: `${focus.x * 100}% ${focus.y * 100}%` }} />
        </div>
      </Window>
    </AbsoluteFill>
  );
};

/** v2 feature versioning: each change from FlagLens is a published version (as listed by the versions API). */
export const VersionsCard: React.FC = () => {
  const f = useCurrentFrame();
  const rows = [
    { v: 'FlagLens: Turn ON', who: 'from VS Code', live: true },
    { v: 'FlagLens: Set value to 50', who: 'from VS Code', live: false },
    { v: 'Initial version', who: 'Flagsmith', live: false },
  ];
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 1100, padding: 40, borderRadius: 28, background: C.panel, border: `1px solid ${C.border}`, fontFamily: SANS, boxShadow: '0 40px 110px rgba(0,0,0,0.5)' }}>
          <div style={{ color: C.muted, fontWeight: 700, fontSize: 24 }}>Environment with feature versioning (v2) · dark_mode</div>
          {rows.map((r, i) => {
            const k = pop(f, 0.15 + i * 0.18);
            return (
              <div key={r.v} style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 22, opacity: k, transform: `translateY(${(1 - k) * 14}px)` }}>
                <div style={{ fontFamily: MONO, color: C.accent2, fontSize: 26, width: 60 }}>v{3 - i}</div>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 32, flex: 1 }}>{r.v}</div>
                <div style={{ color: C.muted, fontSize: 24 }}>{r.who}</div>
                {r.live && <div style={{ padding: '6px 16px', borderRadius: 999, background: 'rgba(46,204,113,0.18)', color: C.on, fontWeight: 700, fontSize: 22 }}>live</div>}
              </div>
            );
          })}
          <div style={{ marginTop: 28, color: C.muted, fontSize: 24 }}>A toggle in a versioned environment publishes a new version; Undo publishes another.</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** The last frame a judge sees: the three promises with their proof, how to start, and where. */
export const Recap: React.FC<{ fadeAt: number }> = ({ fadeAt }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = pop(f, 0.05, fps);
  const cmd = pop(f, 1.4, fps);
  const foot = pop(f, 1.8, fps);
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, fontFamily: SANS }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: head, transform: `scale(${0.92 + 0.08 * head})` }}>
          <Logo size={86} />
          <div style={{ fontWeight: 800, fontSize: 84, letterSpacing: -3, color: C.text }}>
            Flag<span style={{ color: C.accent2 }}>Lens</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
          {PROMISES.map((p, i) => {
            const k = pop(f, 0.35 + i * 0.3, fps);
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'baseline', gap: 20, opacity: k, transform: `translateX(${(1 - k) * -40}px)` }}>
                <div style={{ width: 44, height: 44, borderRadius: 44, background: C.accent, color: 'white', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 22, alignSelf: 'center' }}>{i + 1}</div>
                <div style={{ fontWeight: 800, fontSize: 46, color: C.text, width: 560 }}>{p}</div>
                <div style={{ fontWeight: 600, fontSize: 30, color: C.on }}>{PROMISE_PROOF[i]}</div>
              </div>
            );
          })}
        </div>
        <div style={{ opacity: cmd, transform: `translateY(${(1 - cmd) * 16}px)`, display: 'flex', gap: 18, alignItems: 'center', marginTop: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 36, color: C.text, padding: '14px 28px', borderRadius: 16, background: '#0F1220', border: `1px solid ${C.border}` }}>
            <span style={{ color: C.on }}>❯ </span>make up && make seed
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: C.accent2 }}>github.com/Pranav-Singh-Devloper/flaglens</div>
        </div>
        <div style={{ opacity: foot, display: 'flex', gap: 12, marginTop: 6 }}>
          {['Toggle Wars 2026 · Track 03', 'Self-hosted, open-source Flagsmith', '190 unit + 22 end-to-end tests', 'MIT'].map((p) => (
            <div key={p} style={{ padding: '9px 20px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.05)', color: C.muted, fontWeight: 600, fontSize: 22 }}>
              {p}
            </div>
          ))}
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 120, textAlign: 'center', fontFamily: SANS, fontSize: 19, color: C.muted, opacity: foot }}>
        Footage: the real extension against self-hosted Flagsmith · Edited with Remotion · Voice, music &amp; sound: ElevenLabs · Reaction clips via Vlipsy, © their owners
      </div>
      <AbsoluteFill style={{ background: 'black', opacity: interpolate(f, [fadeAt * fps, (fadeAt + 0.7) * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />
    </AbsoluteFill>
  );
};
