// Backgrounds, window frames and small UI pieces shared by every scene.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO, SANS } from '../theme';

/** Deep navy with slowly drifting colour fields and a faint grid. */
export const Background: React.FC<{ hue?: 'accent' | 'warm' | 'green' }> = ({ hue = 'accent' }) => {
  const f = useCurrentFrame();
  const t = f / 60;
  const a = hue === 'warm' ? '245,165,36' : hue === 'green' ? '46,204,113' : '124,108,255';
  const x1 = 20 + Math.sin(t * 0.25) * 12;
  const y1 = 25 + Math.cos(t * 0.2) * 10;
  const x2 = 80 + Math.cos(t * 0.22) * 10;
  const y2 = 75 + Math.sin(t * 0.18) * 12;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 700px at ${x1}% ${y1}%, rgba(${a},0.22), transparent 70%), radial-gradient(800px 650px at ${x2}% ${y2}%, rgba(46,120,255,0.14), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }}
      />
    </AbsoluteFill>
  );
};

export const TrafficLights: React.FC<{ size?: number }> = ({ size = 13 }) => (
  <div style={{ display: 'flex', gap: size * 0.62 }}>
    {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
      <div key={c} style={{ width: size, height: size, borderRadius: size, background: c }} />
    ))}
  </div>
);

export type Rect = { x: number; y: number; w: number; h: number };

/** A floating window. `bar` adds a browser/terminal title bar above the content. */
export const Window: React.FC<{ rect: Rect; bar?: { kind: 'browser' | 'terminal'; text: string }; lights?: boolean; children: React.ReactNode; radius?: number }> = ({
  rect,
  bar,
  lights,
  children,
  radius = 16,
}) => {
  const barH = bar ? 46 : 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h + barH,
        borderRadius: radius,
        overflow: 'hidden',
        boxShadow: '0 50px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
        background: '#1E1E1E',
      }}
    >
      {bar && (
        <div style={{ height: barH, display: 'flex', alignItems: 'center', gap: 18, padding: '0 16px', background: bar.kind === 'browser' ? '#26293A' : '#181B2A', borderBottom: `1px solid ${C.border}` }}>
          <TrafficLights />
          {bar.kind === 'browser' ? (
            <div style={{ flex: 1, height: 30, borderRadius: 15, background: '#141725', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 8, color: '#C9CCDA', fontFamily: SANS, fontSize: 16 }}>
              <span style={{ color: C.muted }}>ⓘ</span>
              <span>{bar.text}</span>
            </div>
          ) : (
            <div style={{ flex: 1, textAlign: 'center', marginRight: 60, color: C.muted, fontFamily: SANS, fontSize: 15 }}>{bar.text}</div>
          )}
        </div>
      )}
      <div style={{ position: 'relative', width: rect.w, height: rect.h, overflow: 'hidden' }}>{children}</div>
      {lights && (
        <div style={{ position: 'absolute', left: 16, top: 13 }}>
          <TrafficLights size={12} />
        </div>
      )}
    </div>
  );
};

/** Top-left chapter label that slides in when a scene starts. */
export const Chapter: React.FC<{ n: number; text: string }> = ({ n, text }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f - 6, fps, config: { damping: 18, stiffness: 140 } });
  // Introduce the chapter, then get out of the way of the footage.
  const out = interpolate(f, [3.2 * fps, 3.8 * fps], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (out <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 48,
        top: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 18px 10px 10px',
        borderRadius: 999,
        background: 'rgba(11,16,32,0.78)',
        border: `1px solid ${C.border}`,
        backdropFilter: 'blur(10px)',
        transform: `translateX(${interpolate(k, [0, 1], [-40, 0])}px)`,
        opacity: k * out,
        fontFamily: SANS,
        zIndex: 50,
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 30, background: C.accent, color: 'white', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15 }}>{n}</div>
      <div style={{ color: C.text, fontWeight: 600, fontSize: 21, letterSpacing: 0.2 }}>{text}</div>
    </div>
  );
};

/** A pop-in label pointing at something, shown between two frames of the scene. */
export const Callout: React.FC<{ from: number; to?: number; x: number; y: number; text: string; tone?: 'accent' | 'warn' | 'on'; anchor?: 'left' | 'right' | 'center' }> = ({
  from,
  to = 1e9,
  x,
  y,
  text,
  tone = 'accent',
  anchor = 'left',
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (f < from || f > to + 12) return null;
  const kin = spring({ frame: f - from, fps, config: { damping: 14, stiffness: 180 } });
  const kout = f > to ? interpolate(f, [to, to + 12], [1, 0], { extrapolateRight: 'clamp' }) : 1;
  const color = tone === 'warn' ? C.warn : tone === 'on' ? C.on : C.accent;
  const tx = anchor === 'right' ? '-100%' : anchor === 'center' ? '-50%' : '0%';
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(${tx}, -50%) scale(${0.85 + 0.15 * kin})`,
        opacity: kin * kout,
        padding: '12px 20px',
        borderRadius: 14,
        background: color,
        color: tone === 'warn' ? '#1A1200' : 'white',
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: 26,
        whiteSpace: 'nowrap',
        boxShadow: `0 18px 50px rgba(0,0,0,0.45), 0 0 0 6px ${color}33`,
        zIndex: 40,
      }}
    >
      {text}
    </div>
  );
};

export const Mono: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ fontFamily: MONO, ...style }}>{children}</span>
);

/** FlagLens mark: a lens ring with a flag, drawn as SVG (stroke animates in with `draw` 0..1). */
export const Logo: React.FC<{ size: number; draw?: number }> = ({ size, draw = 1 }) => {
  const circ = 2 * Math.PI * 34;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128">
      <rect x="0" y="0" width="128" height="128" rx="30" fill="#1E1B3A" />
      <circle cx="54" cy="54" r="34" fill="#2A2652" opacity={draw} />
      <circle cx="54" cy="54" r="34" fill="none" stroke={C.accent} strokeWidth="10" strokeDasharray={circ} strokeDashoffset={circ * (1 - draw)} strokeLinecap="round" transform="rotate(-90 54 54)" />
      <line x1="80" y1="80" x2={80 + 24 * draw} y2={80 + 24 * draw} stroke={C.accent} strokeWidth="16" strokeLinecap="round" />
      <line x1="44" y1="30" x2="44" y2={30 + 48 * draw} stroke="#E6E6F0" strokeWidth="6.4" strokeLinecap="round" />
      <path d="M44 32 H78 L70 43 L78 54 H44 Z" fill={C.on} opacity={draw} />
    </svg>
  );
};
