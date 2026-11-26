// YouTube thumbnail (1280×720): the hook in big type, the greyed-out branch FlagLens shows, and two proof badges.
//   npx remotion still src/index.ts Thumbnail out/thumbnail.png
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Logo } from './components/Chrome';
import { C, MONO, SANS } from './theme';

const Line: React.FC<{ n: number; children: React.ReactNode; dim?: boolean }> = ({ n, children, dim }) => (
  <div data-line={n} style={{ whiteSpace: 'nowrap', opacity: dim ? 0.38 : 1 }}>
    {children}
  </div>
);

export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ background: 'radial-gradient(70% 90% at 78% 40%, #2a2170 0%, #11183A 45%, #0B1020 100%)', fontFamily: SANS, overflow: 'hidden' }}>
    {/* Left: brand and headline */}
    <div style={{ position: 'absolute', left: 58, top: 52, display: 'flex', alignItems: 'center', gap: 16 }}>
      <Logo size={64} />
      <div style={{ fontWeight: 800, fontSize: 50, letterSpacing: -1.5, color: C.text }}>
        Flag<span style={{ color: C.accent2 }}>Lens</span>
      </div>
    </div>
    <div style={{ position: 'absolute', left: 56, top: 168, fontWeight: 900, fontSize: 104, lineHeight: 0.98, letterSpacing: -4, color: 'white' }}>
      This code
      <br />
      <span style={{ background: 'linear-gradient(90deg, #FFB547, #FF6B6B)', WebkitBackgroundClip: 'text', color: 'transparent' }}>never runs.</span>
    </div>
    <div style={{ position: 'absolute', left: 60, top: 398, fontWeight: 800, fontSize: 46, color: C.accent2, letterSpacing: -1 }}>Now you can see it.</div>
    <div style={{ position: 'absolute', left: 58, bottom: 52, display: 'flex', gap: 12 }}>
      {['VS Code', 'Self-hosted Flagsmith'].map((t) => (
        <div key={t} style={{ padding: '10px 20px', borderRadius: 999, background: 'rgba(124,108,255,0.18)', border: '1px solid rgba(169,157,255,0.45)', color: C.text, fontWeight: 700, fontSize: 26 }}>
          {t}
        </div>
      ))}
    </div>

    {/* Right: the editor, as FlagLens shows it */}
    <div
      style={{
        position: 'absolute',
        left: 612,
        top: 150,
        width: 640,
        padding: '26px 28px 30px',
        borderRadius: 22,
        background: '#14182A',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6), 0 0 80px rgba(124,108,255,0.35)',
        transform: 'rotate(-2.5deg)',
        fontFamily: MONO,
        fontSize: 19.5,
        lineHeight: 1.8,
        color: '#D4D7E3',
      }}
    >
      <div style={{ fontFamily: SANS, fontSize: 21, color: '#8A90A6', marginBottom: 6 }}>
        ⚑ maintenance_mode&nbsp; Prod <span style={{ color: '#8A90A6' }}>○ off</span>
      </div>
      <Line n={74}>
        <span style={{ color: '#C586C0' }}>if</span> (flags.<span style={{ color: '#DCDCAA' }}>isFeatureEnabled</span>(<span style={{ color: '#CE9178' }}>'maintenance_mode'</span>)) {'{'}
      </Line>
      <Line n={75} dim>
        &nbsp;&nbsp;<span style={{ color: '#C586C0' }}>return</span> maintenancePage(envName);
      </Line>
      <Line n={76}>{'}'}</Line>
      <div style={{ marginTop: 10, fontFamily: SANS, fontStyle: 'italic', fontSize: 25, color: '#FFB547', fontWeight: 600 }}>← maintenance_mode is off → never runs</div>
    </div>

    {/* Proof badges */}
    <div style={{ position: 'absolute', left: 680, top: 500, transform: 'rotate(-2.5deg)', display: 'flex', gap: 14 }}>
      <div style={{ padding: '14px 22px', borderRadius: 16, background: '#2ECC71', color: '#06210F', fontWeight: 800, fontSize: 30, boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}>⚡ live in 2.9 s</div>
      <div style={{ padding: '14px 22px', borderRadius: 16, background: 'white', color: '#0B1020', fontWeight: 800, fontSize: 30, boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}>15,050 / 15,050 ✓</div>
    </div>
  </AbsoluteFill>
);
