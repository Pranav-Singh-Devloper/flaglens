// Motion-graphics scenes built in React: the cold-open hook, title, dev-kit terminal, PR comment, tests, outro.
import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import terminal from '../data/terminal.json';
import { C, FPS, MONO, SANS, clamp01, easeOutCubic } from '../theme';
import { Background, Logo, Window } from './Chrome';

const pop = (frame: number, at: number, fps = FPS) => spring({ frame: frame - at * fps, fps, config: { damping: 15, stiffness: 160 } });

// ------------------------------------------------------------------------------------------------------------------
// Cold open: the line of code that starts the question.
// ------------------------------------------------------------------------------------------------------------------
export const CodeHook: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const lines = [
    { text: '// checkout.ts', color: '#6A9955' },
    { text: "if (flags.isFeatureEnabled('new_checkout')) {", color: C.text },
    { text: '  return renderNewCheckout();', color: C.text },
    { text: '}', color: C.text },
  ];
  const total = lines.reduce((n, l) => n + l.text.length, 0);
  const typed = Math.floor(clamp01(t / 1.1) * total);
  let left = typed;
  const q = pop(f, 1.45);
  const hl = clamp01((t - 1.2) / 0.3);
  const zoom = 1 + easeOutCubic(clamp01(t / 4)) * 0.06;
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <div style={{ position: 'absolute', left: 360, top: 250, width: 1200, padding: '40px 48px', borderRadius: 22, background: '#1E1E1E', boxShadow: '0 50px 120px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)' }}>
          {lines.map((l, i) => {
            const shown = l.text.slice(0, Math.max(0, left));
            left -= l.text.length;
            const parts = shown.split("'new_checkout'");
            return (
              <div key={i} style={{ fontFamily: MONO, fontSize: 40, lineHeight: 1.6, color: l.color, whiteSpace: 'pre', minHeight: 64 }}>
                {parts.length > 1 ? (
                  <>
                    {parts[0]}
                    <span style={{ color: '#CE9178', background: `rgba(245,165,36,${0.28 * hl})`, borderRadius: 8, boxShadow: hl ? `0 0 0 ${3 * hl}px rgba(245,165,36,0.8)` : 'none' }}>'new_checkout'</span>
                    {parts[1]}
                  </>
                ) : (
                  <span style={{ color: l.text.startsWith('if') ? C.text : l.color }}>{shown}</span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 690, textAlign: 'center', fontFamily: SANS, fontWeight: 800, fontSize: 84, letterSpacing: -2, color: C.text, opacity: q, transform: `translateY(${(1 - q) * 30}px)` }}>
          Is this on in <span style={{ color: C.warn }}>production</span>?
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Counter shown over the dashboard hunt: every click it takes without FlagLens. */
export const ClickCounter: React.FC<{ count: number }> = ({ count }) => {
  const f = useCurrentFrame();
  const k = pop(f, 0.2);
  return (
    <div style={{ position: 'absolute', right: 70, top: 44, padding: '14px 24px', borderRadius: 18, background: 'rgba(11,16,32,0.85)', border: `1px solid ${C.border}`, fontFamily: SANS, color: C.text, fontSize: 30, fontWeight: 700, display: 'flex', gap: 14, alignItems: 'center', opacity: k, zIndex: 60 }}>
      <span style={{ color: C.muted, fontWeight: 600 }}>clicks + keystrokes to check one flag</span>
      <span style={{ fontFamily: MONO, color: C.warn, fontSize: 44, minWidth: 54, textAlign: 'right' }}>{count}</span>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------------------------
// Title
// ------------------------------------------------------------------------------------------------------------------
const lensChips = [
  ['new_checkout', '● on', '● on', '○ off'],
  ['rate_limit_per_minute', '● 1000', '● 100', '● 50'],
  ['dark_mode', '● on', '● on', '● on'],
  ['banner_text', '● on', '● on', '● on'],
  ['checkout_button_color', '● blue', '● blue', '● blue'],
];

export const TitleCard: React.FC<{ liveAt: number; builtAt: number }> = ({ liveAt, builtAt }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const draw = easeOutCubic(clamp01(t / 0.9));
  const word = pop(f, 0.35);
  const sub = pop(f, liveAt);
  const pill = pop(f, builtAt);
  return (
    <AbsoluteFill>
      <Background />
      {lensChips.map((c, i) => {
        const y = 1150 - ((t * (38 + i * 9) + i * 260) % 1400);
        const x = [120, 1180, 260, 1240, 640][i]!;
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, opacity: 0.16 + (i % 2) * 0.08, filter: `blur(${i % 3}px)`, fontFamily: MONO, fontSize: 20, color: C.muted, padding: '8px 16px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'rgba(20,26,46,0.6)', whiteSpace: 'nowrap' }}>
            ⚑ {c[0]} &nbsp;Dev {c[1]} · Staging {c[2]} · Prod {c[3]}
          </div>
        );
      })}
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, transform: `scale(${0.9 + 0.1 * word})` }}>
          <div style={{ transform: `rotate(${(1 - draw) * -20}deg)`, filter: `drop-shadow(0 20px 60px rgba(124,108,255,${0.5 * draw}))` }}>
            <Logo size={170} draw={draw} />
          </div>
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 150, letterSpacing: -5, color: C.text, opacity: word, transform: `translateX(${(1 - word) * -40}px)` }}>
            Flag<span style={{ color: C.accent2 }}>Lens</span>
          </div>
        </div>
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 48, color: C.text, opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }}>
          Live Flagsmith flags, right inside VS Code.
        </div>
        <div style={{ display: 'flex', gap: 16, opacity: pill, transform: `translateY(${(1 - pill) * 20}px)` }}>
          {['Self-hosted', 'Open-source Flagsmith', 'VS Code extension'].map((p) => (
            <div key={p} style={{ padding: '12px 24px', borderRadius: 999, border: `1px solid ${C.accent}66`, background: 'rgba(124,108,255,0.14)', color: C.accent2, fontFamily: SANS, fontWeight: 600, fontSize: 28 }}>
              {p}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------------------------
// Dev kit terminal (real output of `make up` and `make seed`)
// ------------------------------------------------------------------------------------------------------------------
type TLine = { at: number; text: string; kind: 'cmd' | 'out' | 'ok' | 'head' | 'flag' };

function terminalScript(): TLine[] {
  const out: TLine[] = [];
  out.push({ at: 0.3, text: 'make up', kind: 'cmd' });
  terminal.up.forEach((l, i) => out.push({ at: 1.0 + i * 0.17, text: l, kind: /Healthy/.test(l) ? 'ok' : 'out' }));
  out.push({ at: 3.4, text: 'make seed', kind: 'cmd' });
  terminal.seed.forEach((l, i) => out.push({ at: 4.2 + i * 0.22, text: l, kind: l.startsWith('▸') ? 'head' : l.startsWith('  ') ? 'flag' : 'out' }));
  return out;
}

export const Terminal: React.FC<{ boxAt: number }> = ({ boxAt }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const lines = terminalScript();
  const visible = lines.filter((l) => t >= l.at);
  const lineH = 38;
  const maxLines = 17;
  const scroll = Math.max(0, visible.length - maxLines);
  const box = pop(f, boxAt);
  const chips = pop(f, 0.6);
  const color = (l: TLine) => (l.kind === 'ok' ? C.on : l.kind === 'head' ? C.accent2 : l.kind === 'flag' ? '#C9CCDA' : C.muted);
  return (
    <AbsoluteFill>
      <Background hue="green" />
      <div style={{ position: 'absolute', left: 260, right: 260, top: 70, display: 'flex', justifyContent: 'center', gap: 14, opacity: chips }}>
        {['docker compose', 'flagsmith/flagsmith:2.295.2', 'postgres 15', 'zero-click REST seed'].map((c) => (
          <div key={c} style={{ padding: '10px 20px', borderRadius: 999, background: 'rgba(46,204,113,0.12)', border: '1px solid rgba(46,204,113,0.4)', color: '#8FF0B8', fontFamily: MONO, fontSize: 22 }}>
            {c}
          </div>
        ))}
      </div>
      <Window rect={{ x: 210, y: 150, w: 1500, h: 790 }} bar={{ kind: 'terminal', text: 'zsh — ~/flaglens' }}>
        <div style={{ position: 'absolute', inset: 0, background: '#0F1220', padding: '22px 30px', overflow: 'hidden' }}>
          <div style={{ transform: `translateY(${-scroll * lineH}px)` }}>
            {visible.map((l, i) => {
              if (l.kind === 'cmd') {
                const n = Math.floor(clamp01((t - l.at) / 0.45) * l.text.length);
                return (
                  <div key={i} style={{ fontFamily: MONO, fontSize: 27, height: lineH, color: C.text, whiteSpace: 'pre' }}>
                    <span style={{ color: C.on }}>❯ </span>
                    {l.text.slice(0, n)}
                    {n < l.text.length && <span style={{ background: C.text, color: C.bg }}> </span>}
                  </div>
                );
              }
              return (
                <div key={i} style={{ fontFamily: MONO, fontSize: 25, height: lineH, color: color(l), whiteSpace: 'pre', opacity: clamp01((t - l.at) / 0.12) }}>
                  {l.text}
                </div>
              );
            })}
          </div>
        </div>
      </Window>
      {t >= boxAt && (
        <div style={{ position: 'absolute', left: 430, top: 600, width: 1060, padding: '26px 34px', borderRadius: 18, background: '#0E1A14', border: `2px solid ${C.on}`, boxShadow: `0 30px 90px rgba(0,0,0,0.6), 0 0 0 8px rgba(46,204,113,0.15)`, transform: `scale(${0.9 + 0.1 * box})`, opacity: box, fontFamily: MONO }}>
          {terminal.box.map((l, i) => (
            <div key={i} style={{ fontSize: i === 0 ? 32 : 25, lineHeight: 1.6, color: i === 0 ? C.on : '#C9CCDA', fontWeight: i === 0 ? 700 : 400, whiteSpace: 'pre' }}>
              {l}
            </div>
          ))}
        </div>
      )}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------------------------
// The copied Markdown, pasted into a pull request.
// ------------------------------------------------------------------------------------------------------------------
export const PRComment: React.FC = () => {
  const f = useCurrentFrame();
  const k = pop(f, 0.1);
  const rows = [
    ['new_checkout', 'on', 'off'],
    ['rate_limit_per_minute', 'on 100', 'on 50'],
  ];
  const cell: React.CSSProperties = { padding: '14px 22px', borderBottom: '1px solid #30363D', fontSize: 26 };
  return (
    <AbsoluteFill>
      <Background hue="warm" />
      <div style={{ position: 'absolute', left: 260, top: 150, width: 1400, borderRadius: 18, overflow: 'hidden', background: '#0D1117', border: '1px solid #30363D', boxShadow: '0 50px 120px rgba(0,0,0,0.55)', transform: `translateY(${(1 - k) * 60}px) scale(${0.96 + 0.04 * k})`, opacity: k, fontFamily: SANS, color: '#E6EDF3' }}>
        <div style={{ padding: '18px 26px', background: '#161B22', borderBottom: '1px solid #30363D', display: 'flex', gap: 14, alignItems: 'center', fontSize: 24 }}>
          <div style={{ width: 40, height: 40, borderRadius: 40, background: `linear-gradient(135deg, ${C.accent}, ${C.on})` }} />
          <b>you</b>
          <span style={{ color: '#8B949E' }}>commented on</span>
          <b>Raise production rate limit #42</b>
          <span style={{ marginLeft: 'auto', color: '#8B949E', fontSize: 20 }}>pasted from FlagLens</span>
        </div>
        <div style={{ padding: '26px 34px 30px' }}>
          <div style={{ fontSize: 34, fontWeight: 700, marginBottom: 20 }}>Flagsmith drift: Staging → Production (Demo Shop)</div>
          <table style={{ borderCollapse: 'collapse', width: '100%', border: '1px solid #30363D' }}>
            <thead>
              <tr style={{ background: '#161B22' }}>
                {['Flag', 'Staging', 'Production'].map((h) => (
                  <th key={h} style={{ ...cell, textAlign: 'left', fontWeight: 700 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rk = pop(f, 0.35 + i * 0.18);
                return (
                  <tr key={r[0]} style={{ opacity: rk, transform: `translateX(${(1 - rk) * 30}px)` }}>
                    <td style={cell}>
                      <code style={{ fontFamily: MONO, background: '#262C36', padding: '4px 10px', borderRadius: 6 }}>{r[0]}</code>
                    </td>
                    <td style={cell}>{r[1]}</td>
                    <td style={{ ...cell, color: C.warn, fontWeight: 700 }}>{r[2]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 16, color: '#8B949E', fontSize: 20 }}>2 differences · read from http://localhost:8000 by FlagLens</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------------------------------------------------------
// Tests (names are the real end-to-end test titles)
// ------------------------------------------------------------------------------------------------------------------
const TESTS = [
  'connects using flagsmith.json and picks its environment',
  'CodeLens shows every environment, drift and archived badges',
  'hover lists states, values and variants',
  'typo diagnostic with "Replace with" quick fix, and stale hint',
  'archived flag in use gets a warning',
  'autocomplete suggests flag keys inside a flag call',
  'toggle writes to Flagsmith, then the toggle back restores it',
  'a change made outside the editor shows up by polling',
  'declined confirmation changes nothing',
  'copy diff as Markdown lists Staging vs Production differences',
  'environment matrix opens',
];

export const TestsPanel: React.FC<{ startAt: number }> = ({ startAt }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const head = pop(f, startAt - 0.3);
  return (
    <div style={{ position: 'absolute', left: 1160, top: 150, width: 690, padding: '26px 30px', borderRadius: 18, background: 'rgba(11,16,32,0.9)', border: `1px solid ${C.border}`, boxShadow: '0 40px 100px rgba(0,0,0,0.5)', opacity: head, transform: `translateX(${(1 - head) * 60}px)`, fontFamily: SANS }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ color: C.text, fontSize: 28, fontWeight: 700 }}>End-to-end, every push</div>
        <div style={{ padding: '6px 14px', borderRadius: 999, background: 'rgba(46,204,113,0.15)', color: C.on, fontWeight: 700, fontSize: 20, opacity: clamp01((t - startAt - 11 * 0.16) / 0.3) }}>CI ✓ passing</div>
      </div>
      <div style={{ color: C.muted, fontSize: 19, marginBottom: 14 }}>real VS Code · real self-hosted Flagsmith 2.295.2</div>
      {TESTS.map((name, i) => {
        const k = clamp01((t - startAt - i * 0.16) / 0.18);
        return (
          <div key={name} style={{ display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 20, lineHeight: 1.75, color: C.text, opacity: 0.25 + 0.75 * k }}>
            <span style={{ color: k > 0.5 ? C.on : C.muted, fontWeight: 800, width: 20 }}>{k > 0.5 ? '✓' : '·'}</span>
            <span>{name}</span>
          </div>
        );
      })}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------------------------
// Outro
// ------------------------------------------------------------------------------------------------------------------
export const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = pop(f, 0.1, fps);
  const b = pop(f, 0.6, fps);
  const c = pop(f, 1.1, fps);
  const d = pop(f, 1.6, fps);
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 30, fontFamily: SANS }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: a, transform: `scale(${0.92 + 0.08 * a})` }}>
          <Logo size={110} />
          <div style={{ fontWeight: 800, fontSize: 104, letterSpacing: -4, color: C.text }}>
            Flag<span style={{ color: C.accent2 }}>Lens</span>
          </div>
        </div>
        <div style={{ opacity: b, transform: `translateY(${(1 - b) * 20}px)`, fontFamily: MONO, fontSize: 40, color: C.text, padding: '16px 30px', borderRadius: 16, background: '#0F1220', border: `1px solid ${C.border}` }}>
          <span style={{ color: C.on }}>❯ </span>make up && make seed
        </div>
        <div style={{ opacity: c, transform: `translateY(${(1 - c) * 20}px)`, fontSize: 40, fontWeight: 700, color: C.accent2 }}>github.com/Pranav-Singh-Devloper/flaglens</div>
        <div style={{ opacity: d, display: 'flex', gap: 14, marginTop: 10 }}>
          {['Toggle Wars 2026', 'Track 03 · Build on Open Source Flagsmith', 'MIT'].map((p) => (
            <div key={p} style={{ padding: '10px 22px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.05)', color: C.muted, fontWeight: 600, fontSize: 24 }}>
              {p}
            </div>
          ))}
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 150, textAlign: 'center', fontFamily: SANS, fontSize: 20, color: C.muted, opacity: d }}>
        Footage: the real extension against self-hosted Flagsmith · Edited with Remotion &amp; Manim · Voice, music &amp; sound: ElevenLabs
      </div>
      <AbsoluteFill style={{ background: 'black', opacity: interpolate(f, [7.2 * fps, 8 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />
    </AbsoluteFill>
  );
};
