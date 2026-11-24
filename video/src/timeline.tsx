// The edit: every scene, its length, its voiceover and its sound effects. Footage timings come from the recorded
// event logs (see footage.ts), so clicks, zooms and sounds land exactly on what happens on screen.
import React from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import manim from './data/manim.json';
import vo from './data/vo.json';
import { cameraAt, clipFrames, clicks, events, frameAtVideoTime, mark, shotOnMark, videoTimeAt, type Clip, type Shot } from './footage';
import { Background, Callout, Chapter, Window } from './components/Chrome';
import { CameraStage, Footage, ScreenShot } from './components/Footage';
import { ClickCounter, CodeHook, Outro, PRComment, Terminal, TestsPanel, TitleCard } from './components/Graphics';
import { C, FPS, SANS, sec } from './theme';

export type Sfx = { name: 'whoosh' | 'click' | 'pop' | 'success' | 'alert' | 'typing' | 'impact' | 'riser'; at: number; volume?: number; len?: number };
export type Scene = { id: string; seconds: number; vo?: { id: keyof typeof vo; at: number }; sfx: Sfx[]; render: () => React.ReactNode };

const voDur = (id: keyof typeof vo) => vo[id].duration;
const word = (id: keyof typeof vo, w: string) => vo[id].words.find((x) => x.word.toLowerCase().startsWith(w))!.start;

/** Sound effects for every click and typing burst that is visible in a clip, placed at `offset` seconds into the scene. */
function footageSfx(clip: Clip, offset: number, opts: { pops?: string[]; successes?: string[]; alerts?: string[] } = {}): Sfx[] {
  const out: Sfx[] = [];
  const place = (t: number) => {
    const f = frameAtVideoTime(clip, t);
    return f === undefined ? undefined : offset + f / FPS;
  };
  for (const c of clicks(clip.take)) {
    const at = place(c.t);
    if (at !== undefined) out.push({ name: 'click', at, volume: 0.5 });
  }
  for (const e of events(clip.take)) {
    if (e.type === 'type' && e.text) {
      const at = place(e.t);
      if (at !== undefined) out.push({ name: 'typing', at, volume: 0.35, len: Math.min(2.4, e.text.length / 14) });
    }
    if (e.type !== 'mark') continue;
    const at = place(e.t);
    if (at === undefined) continue;
    if (opts.pops?.includes(e.name!)) out.push({ name: 'pop', at, volume: 0.45 });
    if (opts.successes?.includes(e.name!)) out.push({ name: 'success', at, volume: 0.4 });
    if (opts.alerts?.includes(e.name!)) out.push({ name: 'alert', at, volume: 0.35 });
  }
  return out;
}

/** Shows children only between two scene-relative times. */
const Part: React.FC<{ from: number; seconds: number; children: React.ReactNode }> = ({ from, seconds, children }) => (
  <Sequence from={sec(from)} durationInFrames={sec(seconds)}>
    {children}
  </Sequence>
);

/** Manim scenes are scaled down and lifted a little to leave a clean band for the captions. */
const ManimClip: React.FC<{ name: keyof typeof manim; rate: number }> = ({ name, rate }) => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <OffthreadVideo src={staticFile(`manim/${name}.mp4`)} playbackRate={rate} muted style={{ transform: 'translateY(-46px) scale(0.86)', transformOrigin: '50% 50%' }} />
  </AbsoluteFill>
);
const manimSeconds = (name: keyof typeof manim, rate: number) => manim[name] / rate - 0.05;

const Label: React.FC<{ x: number; y: number; text: string; sub?: string }> = ({ x, y, text, sub }) => (
  <div style={{ position: 'absolute', left: x, top: y, fontFamily: SANS, color: C.text, fontWeight: 700, fontSize: 26, display: 'flex', gap: 12, alignItems: 'baseline' }}>
    {text}
    {sub && <span style={{ color: C.muted, fontWeight: 500, fontSize: 21 }}>{sub}</span>}
  </div>
);

// ---------------------------------------------------------------------------------------------------------------
// Split screen: VS Code on the left, the demo shop (live) on the right. Used by the two toggle scenes.
// ---------------------------------------------------------------------------------------------------------------
const SPLIT_BASE = { x: 420, y: 30, w: 1500, h: 1000 };

/** A shot for the split screen's VS Code panel, framing a logged element. */
function splitShot(take: string, name: string, opts: { maxZ?: number; pad?: number; lead?: number; dx?: number; dy?: number } = {}): Shot {
  const m = mark(take, name)!;
  const b = m.box!;
  const pad = opts.pad ?? 1.5;
  const z = Math.max(1, Math.min(opts.maxZ ?? 1.7, SPLIT_BASE.w / (b.width * pad), SPLIT_BASE.h / (b.height * pad)));
  return { at: m.t - (opts.lead ?? 0.3), z, x: b.x + b.width / 2 + (opts.dx ?? 0), y: b.y + b.height / 2 + (opts.dy ?? 0), dur: 0.7 };
}

const SplitToggle: React.FC<{ clip: Clip; shopUrl: string; envLabel: string; shots: Shot[]; callouts?: React.ReactNode }> = ({ clip, shopUrl, envLabel, shots, callouts }) => {
  const frame = useCurrentFrame();
  const vsRect = { x: 50, y: 140, w: 1140, h: 760 };
  const shopRect = { x: 1230, y: 140, w: 640, h: 714 };
  const shopCrop = { x: 100, y: 0, w: 760, h: 848 };
  // The VS Code panel pans and zooms to follow the action (dialogs, typed confirmation, toasts).
  const cam = cameraAt([{ at: 0, z: 1, x: SPLIT_BASE.x + SPLIT_BASE.w / 2, y: SPLIT_BASE.y + SPLIT_BASE.h / 2, dur: 0.01 }, ...shots], videoTimeAt(clip, frame));
  const w = SPLIT_BASE.w / cam.z;
  const h = SPLIT_BASE.h / cam.z;
  const vsCrop = { x: Math.min(1920 - w, Math.max(0, cam.x - w / 2)), y: Math.min(1080 - h, Math.max(0, cam.y - h / 2)), w, h };
  return (
    <AbsoluteFill>
      <Background />
      <Label x={60} y={92} text="VS Code" sub="FlagLens" />
      <Label x={1240} y={92} text="Demo shop" sub={`live · ${envLabel}`} />
      <Window rect={vsRect} lights={false}>
        <Footage clip={clip} track="vscode" css={{ w: 1920, h: 1080 }} crop={vsCrop} box={{ w: vsRect.w, h: vsRect.h }} />
      </Window>
      <Window rect={shopRect} bar={{ kind: 'browser', text: shopUrl }}>
        <Footage clip={clip} track="shop" css={{ w: 960, h: 900 }} crop={shopCrop} box={{ w: shopRect.w, h: shopRect.h }} cursor={false} />
      </Window>
      {callouts}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------------------------

// 1. Cold open: the question, the dashboard hunt, 21 states.
const hunt: Clip = { take: 'hunt', segments: [{ from: 1.8, to: 18.4, rate: 1.9 }] };
const huntSec = clipFrames(hunt) / FPS;
const HuntPart: React.FC = () => {
  const f = useCurrentFrame();
  const vt = videoTimeAt(hunt, f);
  const n = clicks('hunt').filter((c) => c.t <= vt).length + (vt > 8.6 ? 12 : vt > 7.4 ? Math.floor((vt - 7.4) * 10) : 0) + (vt > 15.9 ? 12 : vt > 14.7 ? Math.floor((vt - 14.7) * 10) : 0);
  const shots: Shot[] = [
    { at: 0, z: 1, x: 800, y: 450, dur: 0.01 },
    { ...shotOnMark('hunt', 'prod-result', { maxZ: 1.45, pad: 1.1, lead: 0.6 }) },
    { at: mark('hunt', 'prod-result')!.t + 1.2, z: 1, x: 800, y: 450, dur: 0.7 },
    { ...shotOnMark('hunt', 'staging-result', { maxZ: 1.45, pad: 1.1, lead: 0.6 }) },
  ];
  return (
    <AbsoluteFill>
      <Background hue="warm" />
      <ScreenShot clip={hunt} track="dashboard" css={{ w: 1600, h: 900 }} shots={shots} rect={{ x: 160, y: 66, w: 1600, h: 946 }} bar={{ kind: 'browser', text: 'localhost:8000/project/1/environment/…/features' }} />
      <ClickCounter count={n} />
    </AbsoluteFill>
  );
};

const coldOpen: Scene = {
  id: 'cold-open',
  seconds: 4.3 + huntSec + manimSeconds('StatesScene', 1.8),
  vo: { id: 'cold-open', at: 0.2 },
  sfx: [
    { name: 'typing', at: 0.05, volume: 0.35, len: 1.1 },
    { name: 'pop', at: 1.45, volume: 0.5 },
    { name: 'whoosh', at: 4.15, volume: 0.45 },
    ...footageSfx(hunt, 4.3),
    { name: 'whoosh', at: 4.3 + huntSec - 0.15, volume: 0.45 },
    { name: 'riser', at: 4.3 + huntSec + manimSeconds('StatesScene', 1.8) - 2.0, volume: 0.35 },
  ],
  render: () => (
    <>
      <Part from={0} seconds={4.3}>
        <CodeHook />
      </Part>
      <Part from={4.3} seconds={huntSec}>
        <HuntPart />
      </Part>
      <Part from={4.3 + huntSec} seconds={manimSeconds('StatesScene', 1.8)}>
        <ManimClip name="StatesScene" rate={1.8} />
      </Part>
    </>
  ),
};

// 2. Title
const title: Scene = {
  id: 'title',
  seconds: 0.25 + voDur('title') + 0.7,
  vo: { id: 'title', at: 0.25 },
  sfx: [{ name: 'impact', at: 0.05, volume: 0.6 }],
  render: () => <TitleCard liveAt={0.25 + word('title', 'live')} builtAt={0.25 + word('title', 'built')} />,
};

// 3. Dev kit
const devkit: Scene = {
  id: 'devkit',
  seconds: 0.3 + voDur('devkit') + 0.9,
  vo: { id: 'devkit', at: 0.3 },
  sfx: [
    { name: 'typing', at: 0.3, volume: 0.35, len: 0.5 },
    { name: 'typing', at: 3.4, volume: 0.35, len: 0.5 },
    { name: 'success', at: 9.0, volume: 0.45 },
  ],
  render: () => (
    <>
      <Terminal boxAt={9.0} />
      <Chapter n={1} text="One-command self-hosted dev kit" />
    </>
  ),
};

// 4. Connect
const connectClip: Clip = { take: 'connect', segments: [{ from: 0, to: 10.7 }], hold: 0.3 };
const connect: Scene = {
  id: 'connect',
  seconds: clipFrames(connectClip) / FPS,
  vo: { id: 'connect', at: 0.05 },
  sfx: [...footageSfx(connectClip, 0, { pops: ['toast'], successes: ['lenses'] })],
  render: () => (
    <>
      <Background />
      <ScreenShot
        clip={connectClip}
        shots={[
          shotOnMark('connect', 'toast', { maxZ: 1.3, pad: 1.6, lead: 0.1, dur: 1.0 }),
          { at: 3.85, z: 1.0, x: 960, y: 540, dur: 0.9 },
          { at: 5.3, z: 1.32, x: 1010, y: 640, dur: 1.1 },
          shotOnMark('connect', 'status', { maxZ: 1.9, pad: 3, lead: 0.5 }),
        ]}
      />
      <Chapter n={2} text="Connect in one click" />
    </>
  ),
};

// 5. Hover
const hoverClip: Clip = { take: 'hover', segments: [{ from: 0, to: 7.0 }, { from: 9.6, to: 17.3 }], hold: 0.6 };
const hoverPythonAt = frameAtVideoTime(hoverClip, mark('hover', 'python')!.t)! / FPS;
const hoverJsonAt = frameAtVideoTime(hoverClip, mark('hover', 'flagsmithjson')!.t)! / FPS;
const hover: Scene = {
  id: 'hover',
  seconds: clipFrames(hoverClip) / FPS,
  vo: { id: 'hover', at: 0.1 },
  sfx: [...footageSfx(hoverClip, 0, { pops: ['hover:checkout_button_color'] })],
  render: () => (
    <>
      <Background />
      <ScreenShot
        clip={hoverClip}
        shots={[
          shotOnMark('hover', 'hover:checkout_button_color', { maxZ: 1.75, pad: 1.25, lead: 0.4 }),
          { at: 6.6, z: 1, x: 960, y: 540, dur: 0.5 },
          { at: 10.2, z: 1.3, x: 1080, y: 420, dur: 0.9 },
          { at: 14.1, z: 1.75, x: 760, y: 250, dur: 0.9 },
        ]}
      />
      <Callout from={sec(hoverPythonAt + 0.4)} to={sec(hoverJsonAt - 0.3)} x={1840} y={150} anchor="right" text="Python too · same detection as Flagsmith Code References" />
      <Callout from={sec(hoverJsonAt + 0.6)} x={1840} y={150} anchor="right" text="flagsmith.json from the Flagsmith CLI" tone="on" />
      <Chapter n={3} text="Live state, right in the code" />
    </>
  ),
};

// 6. Toggle (split with the live shop)
const toggleClip: Clip = { take: 'toggle', segments: [{ from: 1.8, to: 13.4, rate: 1.6 }], hold: 0.9 };
const toggleShopAt = frameAtVideoTime(toggleClip, mark('toggle', 'shop-updated')!.t)! / FPS;
const toggle: Scene = {
  id: 'toggle',
  seconds: clipFrames(toggleClip) / FPS,
  vo: { id: 'toggle', at: 0.3 },
  sfx: [...footageSfx(toggleClip, 0, { pops: ['quickpick'], successes: ['toast'] }), { name: 'pop', at: toggleShopAt, volume: 0.5 }],
  render: () => (
    <>
      <SplitToggle
        clip={toggleClip}
        shopUrl="localhost:3030"
        envLabel="Development"
        shots={[
          splitShot('toggle', 'quickpick', { maxZ: 1.5, pad: 1.25 }),
          splitShot('toggle', 'dialog', { maxZ: 1.6, pad: 1.5 }),
          splitShot('toggle', 'toast', { maxZ: 1.6, pad: 1.5 }),
        ]}
        callouts={<Callout from={sec(toggleShopAt)} x={1550} y={790} anchor="center" text="No redeploy" tone="on" />} />
      <Chapter n={4} text="Safe toggles" />
    </>
  ),
};

// 7. Protected environments
const protectedClip: Clip = {
  take: 'protected',
  segments: [
    { from: 2.0, to: 7.8, rate: 1.6 },
    { from: 7.8, to: 12.2, rate: 1.3 },
    { from: 14.2, to: 21.5, rate: 2.0 },
  ],
  hold: 0.5,
};
const protTypedAt = frameAtVideoTime(protectedClip, mark('protected', 'typed-confirm')!.t)! / FPS;
const protUndoAt = frameAtVideoTime(protectedClip, mark('protected', 'undo-dialog')!.t)! / FPS;
const protShopAt = frameAtVideoTime(protectedClip, mark('protected', 'shop-updated')!.t)! / FPS;
const protRevertAt = frameAtVideoTime(protectedClip, mark('protected', 'shop-reverted')!.t)! / FPS;
const protectedScene: Scene = {
  id: 'protected',
  seconds: clipFrames(protectedClip) / FPS,
  vo: { id: 'protected', at: 1.4 },
  sfx: [
    ...footageSfx(protectedClip, 0, { pops: ['dialog', 'undo-dialog'], successes: ['toast', 'undone'] }),
    { name: 'alert', at: protTypedAt, volume: 0.35 },
    { name: 'pop', at: protShopAt, volume: 0.45 },
    { name: 'pop', at: protRevertAt, volume: 0.45 },
  ],
  render: () => (
    <>
      <SplitToggle
        clip={protectedClip}
        shopUrl="localhost:3030/?env=Production"
        envLabel="Production"
        shots={[
          splitShot('protected', 'dialog', { maxZ: 1.6, pad: 1.5 }),
          splitShot('protected', 'typed-confirm', { maxZ: 1.7, pad: 1.2, dy: 40 }),
          splitShot('protected', 'toast', { maxZ: 1.6, pad: 1.5 }),
          splitShot('protected', 'undo-dialog', { maxZ: 1.6, pad: 1.5 }),
          splitShot('protected', 'undone', { maxZ: 1.6, pad: 1.5 }),
        ]}
        callouts={
          <>
            <Callout from={sec(protTypedAt)} to={sec(protShopAt - 0.6)} x={620} y={830} anchor="center" text="Production is protected: type the flag name" tone="warn" />
            <Callout from={sec(protUndoAt - 0.2)} x={620} y={830} anchor="center" text="Undo (asks again in Production)" />
          </>
        }
      />
      <Chapter n={5} text="Protected environments" />
    </>
  ),
};

// 8. Drift
const driftClip: Clip = { take: 'drift', segments: [{ from: 15.0, to: 24.0, rate: 1.3 }] };
const driftManim = manimSeconds('DriftScene', 0.72);
const driftClipSec = clipFrames(driftClip) / FPS;
const drift: Scene = {
  id: 'drift',
  seconds: driftManim + driftClipSec + 3.6,
  vo: { id: 'drift', at: 0.2 },
  sfx: [
    { name: 'alert', at: 2.6 / 0.72 * 0.95, volume: 0.4 },
    { name: 'whoosh', at: driftManim - 0.15, volume: 0.4 },
    ...footageSfx(driftClip, driftManim, { successes: ['copied'] }),
    { name: 'whoosh', at: driftManim + driftClipSec - 0.15, volume: 0.4 },
    { name: 'pop', at: driftManim + driftClipSec + 0.15, volume: 0.45 },
  ],
  render: () => (
    <>
      <Part from={0} seconds={driftManim}>
        <ManimClip name="DriftScene" rate={0.72} />
      </Part>
      <Part from={driftManim} seconds={driftClipSec}>
        <Background />
        <ScreenShot
          clip={driftClip}
          shots={[
            { at: 15.0, z: 1, x: 960, y: 540, dur: 0.01 },
            { at: mark('drift', 'matrix')!.t - 0.2, z: 1.55, x: 1230, y: 330, dur: 1.0 },
            { at: mark('drift', 'copied')!.t - 0.4, z: 1.35, x: 1350, y: 700, dur: 0.8 },
          ]}
        />
      </Part>
      <Part from={driftManim + driftClipSec} seconds={3.6}>
        <PRComment />
      </Part>
      <Chapter n={6} text="Environment drift" />
    </>
  ),
};

// 9. Typos and archived flags
const typoClip: Clip = { take: 'typo', segments: [{ from: 1.8, to: 11.8, rate: 1.6 }, { from: 14.4, to: 20.5 }], hold: 0.4 };
const typo: Scene = {
  id: 'typo',
  seconds: clipFrames(typoClip) / FPS,
  vo: { id: 'typo', at: 0.3 },
  sfx: [...footageSfx(typoClip, 0, { alerts: ['squiggle'], pops: ['quickfix'], successes: ['fixed'] })],
  render: () => (
    <>
      <Background />
      <ScreenShot
        clip={typoClip}
        shots={[
          { ...shotOnMark('typo', 'squiggle', { maxZ: 1.7, pad: 6, lead: 0.5 }), dur: 0.8 },
          shotOnMark('typo', 'hover:new_chekout', { maxZ: 1.6, pad: 1.2, lead: 0.3 }),
          shotOnMark('typo', 'quickfix', { maxZ: 1.7, pad: 2.6, lead: 0.25, dx: -120 }),
          { at: mark('typo', 'fixed')!.t - 0.2, z: 1.45, x: 800, y: 300, dur: 0.6 },
          { at: 14.4, z: 1.15, x: 1000, y: 700, dur: 0.6 },
          shotOnMark('typo', 'hover:legacy_search', { maxZ: 1.6, pad: 1.25, lead: 0.3 }),
        ]}
      />
      <Chapter n={7} text="Typos & archived flags" />
    </>
  ),
};

// 10. Stale flags
const staleClip: Clip = { take: 'stale', segments: [{ from: 3.6, to: 11.6, rate: 1.3 }], hold: 0.3 };
const staleManim = manimSeconds('StaleScene', 1.3);
const staleClipSec = clipFrames(staleClip) / FPS;
const stale: Scene = {
  id: 'stale',
  seconds: staleManim + staleClipSec,
  vo: { id: 'stale', at: 0.2 },
  sfx: [{ name: 'whoosh', at: staleManim - 0.15, volume: 0.4 }, ...footageSfx(staleClip, staleManim)],
  render: () => (
    <>
      <Part from={0} seconds={staleManim}>
        <ManimClip name="StaleScene" rate={1.3} />
      </Part>
      <Part from={staleManim} seconds={staleClipSec}>
        <Background />
        <ScreenShot
          clip={staleClip}
          shots={[shotOnMark('stale', 'hover:dark_mode', { maxZ: 1.65, pad: 1.25, lead: 0.5 }), shotOnMark('stale', 'problems', { maxZ: 1.45, pad: 1.05, lead: 0.3 })]}
        />
      </Part>
      <Chapter n={8} text="Stale flags, free on open source" />
    </>
  ),
};

// 11. Proof: the dashboard agrees, and the tests
const proofClip: Clip = { take: 'proof', segments: [{ from: 0.4, to: 11.7, rate: 1.1 }], hold: 1.2 };
const proof: Scene = {
  id: 'proof',
  seconds: clipFrames(proofClip) / FPS,
  vo: { id: 'proof', at: 0.3 },
  sfx: [...footageSfx(proofClip, 0), { name: 'success', at: 0.3 + word('proof', 'eleven') + 11 * 0.16 + 0.2, volume: 0.4 }],
  render: () => {
    const rect = { x: 40, y: 150, w: 1100, h: 619 };
    return (
      <>
        <Background />
        <Label x={50} y={100} text="Self-hosted Flagsmith dashboard" sub="localhost:8000 · Production" />
        <CameraStage clip={proofClip} shots={[{ at: 0, z: 1, x: 800, y: 450, dur: 0.01 }]} rect={rect} barH={46} crop={{ x: 0, y: 0, w: 1600, h: 900 }}>
          <Window rect={rect} bar={{ kind: 'browser', text: 'localhost:8000/project/1/environment/…/features' }}>
            <Footage clip={proofClip} track="dashboard" css={{ w: 1600, h: 900 }} box={{ w: rect.w, h: rect.h }} />
          </Window>
        </CameraStage>
        <TestsPanel startAt={0.3 + word('proof', 'eleven')} />
        <Chapter n={9} text="Same data as the dashboard" />
      </>
    );
  },
};

// 12. Outro
const outro: Scene = {
  id: 'outro',
  seconds: 8.0,
  vo: { id: 'outro', at: 0.4 },
  sfx: [{ name: 'whoosh', at: 0.0, volume: 0.4 }],
  render: () => <Outro />,
};

export const SCENES: Scene[] = [coldOpen, title, devkit, connect, hover, toggle, protectedScene, drift, typo, stale, proof, outro];

export const sceneStarts = (() => {
  const out: number[] = [];
  let t = 0;
  for (const s of SCENES) {
    out.push(t);
    t += sec(s.seconds);
  }
  return out;
})();

export const TOTAL_FRAMES = SCENES.reduce((n, s) => n + sec(s.seconds), 0);
