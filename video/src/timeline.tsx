// The edit: every scene, its length, its voiceover parts, meme cards and sound effects. Footage timings come from the
// recorded event logs (see footage.ts), so clicks, zooms and sounds land exactly on what happens on screen.
//
// A scene's voiceover can be split at a word boundary (`from`/`to`, seconds into the clip), so a meme can land
// mid-sentence while the footage freezes underneath (a segment with a near-zero rate).
import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import vo from './data/vo.json';
import { cameraAt, clipFrames, clicks, events, frameAtVideoTime, mark, shotOnMark, videoTimeAt, type Clip, type Shot } from './footage';
import { Background, Callout, Chapter, Window } from './components/Chrome';
import { CameraStage, Footage, ScreenShot } from './components/Footage';
import { ClickCounter, Terminal } from './components/Graphics';
import { Pillar, PromiseCard, Recap, Still, Stopwatch, TermChip, VersionsCard } from './components/Story';
import { Ring, StatCard, memeSeconds, type MemeName } from './components/Meme';
import { C, FPS, SANS, sec } from './theme';

export type SfxName = 'whoosh' | 'click' | 'pop' | 'success' | 'alert' | 'typing' | 'impact' | 'riser' | 'boom' | 'scratch';
export type Sfx = { name: SfxName; at: number; volume?: number; len?: number };
type VoId = keyof typeof vo;
/** A voiceover clip (or part of one) placed `at` seconds into the scene. */
export type VoPart = { id: VoId; at: number; from?: number; to?: number };
export type MemeCue = { name: MemeName; at: number; caption?: string; volume?: number };
export type Scene = { id: string; seconds: number; vo: VoPart[]; memes?: MemeCue[]; sfx: Sfx[]; render: () => React.ReactNode };

const voDur = (id: VoId) => vo[id].duration;
const word = (id: VoId, w: string) => {
  const hit = vo[id].words.find((x) => x.word.toLowerCase().startsWith(w));
  if (!hit) throw new Error(`word "${w}" not in VO ${id}`);
  return hit.start;
};
/** A freeze: a footage segment that advances 0.01 s over `seconds`. */
const freeze = (t: number, seconds: number) => ({ from: t, to: t + 0.01, rate: 0.01 / seconds });

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

/** VS Code footage in the standard window, with extra overlays that move with the camera (e.g. the typo ring). */
const RECT = { x: 112, y: 63, w: 1696, h: 954 };
const S = RECT.w / 1920;
const Stage: React.FC<{ clip: Clip; shots: Shot[]; children?: React.ReactNode }> = ({ clip, shots, children }) => (
  <CameraStage clip={clip} shots={shots} rect={RECT} crop={{ x: 0, y: 0, w: 1920, h: 1080 }}>
    <Window rect={RECT} lights>
      <Footage clip={clip} track="vscode" css={{ w: 1920, h: 1080 }} box={{ w: RECT.w, h: RECT.h }} />
    </Window>
    {children}
  </CameraStage>
);

// ---------------------------------------------------------------------------------------------------------------
// The story: a hook, the problem, then three promises (it knows what runs · it proves your rules · it's live), each
// proved on screen, then the rest in a fast montage and a recap. Each proving scene keeps its promise in the corner.
// ---------------------------------------------------------------------------------------------------------------
/** The last occurrence of a word (e.g. "live" in "live inside VS Code ... and it's live"). */
const lastWord = (id: VoId, w: string) => {
  const hits = vo[id].words.filter((x) => x.word.toLowerCase().startsWith(w));
  if (!hits.length) throw new Error(`word "${w}" not in VO ${id}`);
  return hits[hits.length - 1]!.start;
};
/** Scene time at which a clip reaches a video time. */
const sceneAt = (clip: Clip, t: number) => frameAtVideoTime(clip, t)! / FPS;

// 1. Hook: code that has never run. Slow push in, a zoom punch onto the typo, a facepalm.
const typoBox = mark('hook', 'typo')!.box!;
const hookClip: Clip = { take: 'hook', segments: [{ from: 0.3, to: 2.3 }, { from: 2.3, to: 6.4, rate: 0.85 }, { from: 6.4, to: 9.1 }], hold: 1.0 };
const HOOK_VO = 0.2;
const hookPunch = HOOK_VO + word('hook', 'why') + 0.35;
const hookPunchVideoT = videoTimeAt(hookClip, sec(hookPunch));
const hookMeme = hookPunch + 0.45;
const hook: Scene = {
  id: 'hook',
  seconds: hookMeme + memeSeconds('facepalm') + 0.05,
  vo: [{ id: 'hook', at: HOOK_VO }],
  memes: [{ name: 'facepalm', at: hookMeme, caption: '3 sprints later', volume: 0 }],
  sfx: [
    { name: 'riser', at: hookPunch - 1.8, volume: 0.3 },
    { name: 'boom', at: hookPunch - 0.05, volume: 0.75 },
    { name: 'scratch', at: hookMeme - 0.05, volume: 0.5 },
  ],
  render: () => (
    <>
      <Background hue="warm" />
      <Stage
        clip={hookClip}
        shots={[
          { at: 0, z: 1.9, x: 760, y: 470, dur: 0.01 },
          { at: 0.31, z: 2.3, x: 740, y: 462, dur: 5.5 },
          { at: hookPunchVideoT, z: 3.0, x: typoBox.x + typoBox.width / 2 + 40, y: typoBox.y - 20, dur: 0.18 },
        ]}
      >
        <Ring x={RECT.x + typoBox.x * S} y={RECT.y + typoBox.y * S} w={typoBox.width * S} h={typoBox.height * S} at={hookPunch} />
      </Stage>
      <Callout from={sec(HOOK_VO + word('hook', 'never'))} to={sec(hookPunch - 0.3)} x={960} y={130} anchor="center" text="Times this ran in production: 0" tone="warn" />
    </>
  ),
};

// 2. The problem: SDKs default silently, and the answer lives five clicks away in a dashboard.
const hookHold: Clip = { take: 'hook', segments: [freeze(9.05, 6)] };
const hunt: Clip = { take: 'hunt', segments: [{ from: 1.8, to: 18.4, rate: 2.7 }] };
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
const PROB_VO = 0.1;
const probHunt = PROB_VO + word('problem', 'because') - 0.2;
const problem: Scene = {
  id: 'problem',
  seconds: Math.min(probHunt + huntSec, PROB_VO + voDur('problem') + 0.35),
  vo: [{ id: 'problem', at: PROB_VO }],
  sfx: [{ name: 'alert', at: PROB_VO + word('problem', 'off'), volume: 0.4 }, { name: 'whoosh', at: probHunt - 0.15, volume: 0.45 }, ...footageSfx(hunt, probHunt)],
  render: () => (
    <>
      <Part from={0} seconds={probHunt}>
        <Background hue="warm" />
        <Stage clip={hookHold} shots={[{ at: 0, z: 1.7, x: 1240, y: 330, dur: 0.01 }]} />
        <Callout from={sec(PROB_VO + word('problem', 'off'))} x={960} y={130} anchor="center" text="Unknown key → SDK default: off. No error." tone="warn" />
      </Part>
      <Part from={probHunt} seconds={huntSec + 1}>
        <HuntPart />
      </Part>
    </>
  ),
};

// 3. Title and the three promises, each appearing on the word that names it.
const TITLE_VO = 0.2;
const title: Scene = {
  id: 'title',
  seconds: TITLE_VO + voDur('title') + 0.55,
  vo: [{ id: 'title', at: TITLE_VO }],
  sfx: [
    { name: 'impact', at: 0.05, volume: 0.6 },
    { name: 'pop', at: TITLE_VO + word('title', 'knows'), volume: 0.5 },
    { name: 'pop', at: TITLE_VO + word('title', 'proves'), volume: 0.5 },
    { name: 'pop', at: TITLE_VO + lastWord('title', 'live'), volume: 0.5 },
  ],
  render: () => (
    <PromiseCard
      subAt={TITLE_VO + word('title', 'self-hosted')}
      claimsAt={[TITLE_VO + word('title', 'knows') - 0.15, TITLE_VO + word('title', 'proves') - 0.15, TITLE_VO + lastWord('title', 'live') - 0.25]}
    />
  ),
};

// 4. Dev kit, then Connect.
const DEV_VO = 0.2;
const connectClip: Clip = { take: 'connect', segments: [{ from: 2.4, to: 10.9, rate: 1.3 }], hold: 0.3 };
const connectAt = DEV_VO + word('devkit', 'click') - 0.6;
const devkit: Scene = {
  id: 'devkit',
  seconds: Math.max(DEV_VO + voDur('devkit') + 0.3, connectAt + clipFrames(connectClip) / FPS),
  vo: [{ id: 'devkit', at: DEV_VO }],
  sfx: [{ name: 'typing', at: 0.3, volume: 0.35, len: 0.5 }, { name: 'success', at: DEV_VO + word('devkit', 'demo'), volume: 0.45 }, ...footageSfx(connectClip, connectAt, { pops: ['toast'], successes: ['lenses'] })],
  render: () => (
    <>
      <Part from={0} seconds={connectAt}>
        <Terminal boxAt={DEV_VO + word('devkit', 'demo')} />
      </Part>
      <Part from={connectAt} seconds={30}>
        <Background />
        <ScreenShot
          clip={connectClip}
          shots={[
            { ...shotOnMark('connect', 'toast', { maxZ: 1.3, pad: 1.6 }), at: 0, dur: 0.01 },
            { at: mark('connect', 'lenses')!.t - 0.7, z: 1.0, x: 960, y: 540, dur: 0.7 },
            { at: mark('connect', 'lenses')!.t + 0.5, z: 1.32, x: 1010, y: 640, dur: 0.9 },
            shotOnMark('connect', 'status', { maxZ: 1.9, pad: 3, lead: 0.5 }),
          ]}
        />
      </Part>
      <Chapter n="▶" text="Set up in two commands" />
    </>
  ),
};

// 5. Promise 1: greyed-out code, Development then Production.
const greyClip: Clip = { take: 'greyout', segments: [{ from: 0.4, to: 4.6, rate: 1.25 }, { from: 4.6, to: 11.8, rate: 1.1 }], hold: 0.6 };
const GREY_VO = 0.15;
const greyout: Scene = {
  id: 'greyout',
  seconds: Math.max(clipFrames(greyClip) / FPS, GREY_VO + voDur('greyout') + 0.3),
  vo: [{ id: 'greyout', at: GREY_VO }],
  sfx: [...footageSfx(greyClip, 0, { pops: ['envpick'] }), { name: 'whoosh', at: sceneAt(greyClip, mark('greyout', 'prod')!.t) - 0.1, volume: 0.35 }],
  render: () => (
    <>
      <Background />
      <Stage
        clip={greyClip}
        shots={[
          { at: 0, z: 1.12, x: 1000, y: 560, dur: 0.01 },
          { at: 2.2, z: 1.45, x: 1120, y: 760, dur: 1.4 },
          shotOnMark('greyout', 'envpick', { maxZ: 1.7, pad: 1.6, lead: 0.3 }),
          { at: mark('greyout', 'prod')!.t - 0.2, z: 1.55, x: 1120, y: 800, dur: 0.7 },
        ]}
      />
      <Callout from={sec(GREY_VO + word('greyout', 'greyed'))} to={sec(GREY_VO + word('greyout', 'switch') - 0.2)} x={960} y={110} anchor="center" text="Development: dead branches greyed, with the reason" />
      <Callout from={sec(GREY_VO + word('greyout', 'only'))} x={960} y={110} anchor="center" text="Production: new_checkout differs per user → not greyed" tone="on" />
      <Pillar n={1} />
    </>
  ),
};

// 6. Promise 1: preview as a user, and the server check.
const previewClip: Clip = { take: 'preview', segments: [{ from: 0.6, to: 15.3, rate: 1.15 }], hold: 1.6 };
const PREV_VO = 0.15;
const prevStatAt = PREV_VO + word('preview', 'flagsmith') - 0.1;
const preview: Scene = {
  id: 'preview',
  seconds: Math.max(clipFrames(previewClip) / FPS, PREV_VO + voDur('preview') + 0.4),
  vo: [{ id: 'preview', at: PREV_VO }],
  sfx: [...footageSfx(previewClip, 0, { pops: ['personas', 'hover:new_checkout'], successes: ['beta'] }), { name: 'success', at: PREV_VO + word('preview', 'zero') + 0.1, volume: 0.45 }],
  render: () => (
    <>
      <Background />
      <Stage
        clip={previewClip}
        shots={[
          { at: 0, z: 1.0, x: 960, y: 540, dur: 0.01 },
          shotOnMark('preview', 'personas', { maxZ: 1.9, pad: 1.3, lead: 0.4 }),
          { at: mark('preview', 'beta')!.t - 0.3, z: 1.4, x: 1000, y: 330, dur: 0.8 },
          shotOnMark('preview', 'hover:new_checkout', { maxZ: 1.8, pad: 1.12, lead: 0.2 }),
          { at: videoTimeAt(previewClip, sec(prevStatAt - 0.3)), z: 1.0, x: 960, y: 540, dur: 0.7 },
        ]}
      />
      <Part from={prevStatAt} seconds={30}>
        <StatCard countAt={PREV_VO + word('preview', 'fifteen') - prevStatAt} missesAt={PREV_VO + word('preview', 'zero') - prevStatAt} />
      </Part>
      <Pillar n={1} />
    </>
  ),
};

// 7. Promise 2: the rule check finds the shadowed override; fix it from the editor; the finding disappears.
const fixClip: Clip = {
  take: 'segfix',
  segments: [{ from: 0.5, to: 4.9, rate: 0.85 }, { from: 4.9, to: 13.4, rate: 3.0 }, { from: 13.4, to: 16.0, rate: 1.6 }, { from: 16.0, to: 20.8, rate: 1.5 }],
  hold: 1.6,
};
const FIX_VO = 0.15;
const fixVo2 = FIX_VO + voDur('rules') + 0.15;
const fixedAt = sceneAt(fixClip, mark('segfix', 'fixed')!.t);
const fix: Scene = {
  id: 'fix',
  seconds: Math.max(clipFrames(fixClip) / FPS, fixVo2 + voDur('segfix') + 0.3),
  vo: [
    { id: 'rules', at: FIX_VO },
    { id: 'segfix', at: fixVo2 },
  ],
  sfx: [...footageSfx(fixClip, 0, { pops: ['hover:rate_limit_per_minute', 'list', 'dialog'], successes: ['fixed'] })],
  render: () => (
    <>
      <Background />
      <Stage
        clip={fixClip}
        shots={[
          { at: 0, z: 1.0, x: 960, y: 540, dur: 0.01 },
          shotOnMark('segfix', 'hover:rate_limit_per_minute', { maxZ: 1.75, pad: 1.08, lead: 0.2 }),
          shotOnMark('segfix', 'list', { maxZ: 1.9, pad: 1.3, lead: 0.2 }),
          shotOnMark('segfix', 'dialog', { maxZ: 1.7, pad: 1.4, lead: 0.2 }),
          shotOnMark('segfix', 'typed-confirm', { maxZ: 1.8, pad: 1.3, lead: 0.2 }),
          shotOnMark('segfix', 'fixed', { maxZ: 1.6, pad: 1.6, lead: 0.3 }),
        ]}
      />
      <Callout from={sec(FIX_VO + word('rules', 'this'))} to={sec(fixVo2)} x={960} y={110} anchor="center" text={'"pro_eu" never applies: "pro_plan" catches its users first'} tone="warn" />
      <Callout from={sec(fixedAt)} x={960} y={110} anchor="center" text="Re-checked: pro_eu applies now. Written to Flagsmith." tone="on" />
      <Pillar n={2} />
    </>
  ),
};

// 8. Promise 3: real time. The Flagsmith dashboard (left) and VS Code (right), with a stopwatch.
const rtClip: Clip = { take: 'realtime', segments: [{ from: 0.2, to: 9.9 }], hold: 1.4 };
const RT_VO = 0.15;
const rtConfirmed = sceneAt(rtClip, mark('realtime', 'confirmed')!.t);
const rtUpdated = sceneAt(rtClip, mark('realtime', 'vscode-updated')!.t);
const RealtimeSplit: React.FC = () => {
  // The dashboard is cropped to its flag list and the confirmation dialog, so both read at video size.
  const dashCrop = { x: 150, y: 250, w: 810, h: 650 };
  const dashRect = { x: 40, y: 150, w: 760, h: 46 + Math.round((760 * dashCrop.h) / dashCrop.w) };
  const vsRect = { x: 830, y: 150, w: 1050, h: 712 };
  const vsCrop = { x: 520, y: 200, w: 1300, h: 880 };
  return (
    <AbsoluteFill>
      <Background />
      <Label x={50} y={100} text="Flagsmith dashboard" sub="self-hosted" />
      <Label x={840} y={100} text="VS Code" sub="FlagLens" />
      <Window rect={dashRect} bar={{ kind: 'browser', text: 'localhost:8000 · Demo Shop · Development' }}>
        <Footage clip={rtClip} track="dash" css={{ w: 960, h: 900 }} crop={dashCrop} box={{ w: dashRect.w, h: dashRect.h - 46 }} />
      </Window>
      <Window rect={vsRect} lights={false}>
        <Footage clip={rtClip} track="vscode" css={{ w: 1920, h: 1080 }} crop={vsCrop} box={{ w: vsRect.w, h: vsRect.h }} cursor={false} />
      </Window>
    </AbsoluteFill>
  );
};
const realtime: Scene = {
  id: 'realtime',
  seconds: Math.max(clipFrames(rtClip) / FPS, RT_VO + voDur('realtime') + 0.3),
  vo: [{ id: 'realtime', at: RT_VO }],
  sfx: [...footageSfx(rtClip, 0, { pops: ['modal'] }), { name: 'success', at: rtUpdated, volume: 0.5 }],
  render: () => (
    <>
      <RealtimeSplit />
      <Stopwatch from={rtConfirmed} to={rtUpdated} seconds={mark('realtime', 'vscode-updated')!.t - mark('realtime', 'confirmed')!.t} x={420} y={830} />
      <Pillar n={3} />
    </>
  ),
};

// 9. Promise 3: Feature Health. A monitoring alert reaches the code and the confirmation.
const healthClip: Clip = {
  take: 'health',
  segments: [{ from: 0.6, to: 4.4 }, { from: 5.6, to: 9.4, rate: 1.25 }, { from: 10.8, to: 13.9, rate: 2.0 }, { from: 13.9, to: 16.7 }],
  hold: 0.3,
};
const HEALTH_VO = 0.15;
const healthAlertAt = sceneAt(healthClip, mark('health', 'alert')!.t);
const healthBadgeAt = sceneAt(healthClip, mark('health', 'badge')!.t);
const health: Scene = {
  id: 'health',
  seconds: Math.max(clipFrames(healthClip) / FPS, HEALTH_VO + voDur('health') + 0.3),
  vo: [{ id: 'health', at: HEALTH_VO }],
  sfx: [...footageSfx(healthClip, 0, { alerts: ['badge'], pops: ['dialog'] }), { name: 'typing', at: healthAlertAt, volume: 0.35, len: 0.5 }],
  render: () => (
    <>
      <Background />
      <Stage
        clip={healthClip}
        shots={[
          { at: 0, z: 1.25, x: 1000, y: 420, dur: 0.01 },
          { ...shotOnMark('health', 'badge', { maxZ: 1.9, pad: 2.2, lead: 0.1 }) },
          shotOnMark('health', 'hover:new_checkout', { maxZ: 1.7, pad: 1.1, lead: 0.2 }),
          shotOnMark('health', 'dialog', { maxZ: 1.8, pad: 1.25, lead: 0.2 }),
        ]}
      />
      <TermChip at={healthAlertAt} until={healthBadgeAt + 0.6} cmd="make alert" note="a monitoring alert, sent to Flagsmith Feature Health" x={960} y={760} />
      <Pillar n={3} />
    </>
  ),
};

// 10. Safe writes: one click in Development (the shop updates), then Production needs the flag name. Gandalf.
const SAFE_VO = 0.15;
const safeSplit = word('safety', 'production') - 0.08;
const toggleClip: Clip = { take: 'toggle', segments: [{ from: 2.4, to: 11.4, rate: 2.0 }], hold: 0.2 };
const toggleSec = Math.max(clipFrames(toggleClip) / FPS, SAFE_VO + safeSplit + 0.1);
const toggleShopAt = sceneAt(toggleClip, mark('toggle', 'shop-updated')!.t);
const toggle: Scene = {
  id: 'toggle',
  seconds: toggleSec,
  vo: [{ id: 'safety', at: SAFE_VO, to: safeSplit }],
  sfx: [...footageSfx(toggleClip, 0, { pops: ['quickpick'], successes: ['toast'] }), { name: 'pop', at: toggleShopAt, volume: 0.5 }],
  render: () => (
    <>
      <SplitToggle
        clip={toggleClip}
        shopUrl="localhost:3030"
        envLabel="Development"
        shots={[splitShot('toggle', 'quickpick', { maxZ: 1.5, pad: 1.25 }), splitShot('toggle', 'dialog', { maxZ: 1.6, pad: 1.5 }), splitShot('toggle', 'toast', { maxZ: 1.6, pad: 1.5 })]}
        callouts={<Callout from={sec(toggleShopAt)} x={1550} y={790} anchor="center" text="No redeploy" tone="on" />}
      />
      <Chapter n="✓" text="Every change is safe" />
    </>
  ),
};
const GANDALF = memeSeconds('pass');
const protFreezeAt = mark('protected', 'typed-confirm')!.t + 0.12;
const protectedClip: Clip = { take: 'protected', segments: [{ from: 2.0, to: protFreezeAt, rate: 2.2 }, freeze(protFreezeAt, GANDALF + 0.1), { from: protFreezeAt + 0.01, to: 12.0, rate: 1.6 }], hold: 0.3 };
const protMemeAt = (protFreezeAt - 2.0) / 2.2;
const protSplit2 = word('safety', 'you') - 0.06;
const protShopAt = sceneAt(protectedClip, mark('protected', 'shop-updated')!.t);
const protectedScene: Scene = {
  id: 'protected',
  seconds: Math.max(clipFrames(protectedClip) / FPS, protMemeAt + GANDALF + 0.15 + voDur('safety') - protSplit2 + 0.3),
  vo: [
    { id: 'safety', at: Math.max(0.1, protMemeAt - (protSplit2 - safeSplit) - 0.1), from: safeSplit, to: protSplit2 },
    { id: 'safety', at: protMemeAt + GANDALF + 0.15, from: protSplit2 },
  ],
  memes: [{ name: 'pass', at: protMemeAt, volume: 0.95 }],
  sfx: [...footageSfx(protectedClip, 0, { pops: ['dialog'], successes: ['toast'] }), { name: 'boom', at: protMemeAt - 0.02, volume: 0.45 }, { name: 'pop', at: protShopAt, volume: 0.45 }],
  render: () => (
    <SplitToggle
      clip={protectedClip}
      shopUrl="localhost:3030/?env=Production"
      envLabel="Production"
      shots={[splitShot('protected', 'dialog', { maxZ: 1.6, pad: 1.5 }), splitShot('protected', 'typed-confirm', { maxZ: 1.7, pad: 1.2, dy: 40 }), splitShot('protected', 'toast', { maxZ: 1.6, pad: 1.5 })]}
      callouts={<Callout from={sec(protMemeAt + GANDALF)} x={620} y={830} anchor="center" text="Production is protected: type the flag name. Undo included." tone="warn" />}
    />
  ),
};

// 11. Pairwise test plan: "ninety-six combinations" → maths → "or seven runs".
const MATH = memeSeconds('math');
const TP_VO = 0.15;
const tpSplit = word('testplan', 'or') - 0.05;
const tpMeme = TP_VO + tpSplit + 0.05;
const tpFreezeAt = Math.min(tpMeme + 0.3, 7.0);
const testplanClip: Clip = { take: 'testplan', segments: [{ from: 0.3, to: tpFreezeAt, rate: 1.2 }, freeze(tpFreezeAt, MATH + 0.1), { from: tpFreezeAt + 0.01, to: 11.2 }], hold: 0.8 };
const testplan: Scene = {
  id: 'testplan',
  seconds: Math.max(clipFrames(testplanClip) / FPS, tpMeme + MATH + 0.1 + voDur('testplan') - tpSplit + 0.35),
  vo: [
    { id: 'testplan', at: TP_VO, to: tpSplit },
    { id: 'testplan', at: tpMeme + MATH + 0.1, from: tpSplit },
  ],
  memes: [{ name: 'math', at: tpMeme, caption: '96 combinations', volume: 0.7 }],
  sfx: [...footageSfx(testplanClip, 0, { pops: ['flags', 'mode'], successes: ['plan'] })],
  render: () => (
    <>
      <Background />
      <Stage
        clip={testplanClip}
        shots={[
          { at: 0, z: 1.0, x: 960, y: 540, dur: 0.01 },
          shotOnMark('testplan', 'flags', { maxZ: 1.8, pad: 1.15, lead: 0.3 }),
          shotOnMark('testplan', 'mode', { maxZ: 2.1, pad: 1.25, lead: 0.2 }),
          { at: mark('testplan', 'plan')!.t - 0.2, z: 1.55, x: 1500, y: 560, dur: 0.8 },
        ]}
      />
      <Chapter n="∑" text="Smallest test plan" />
    </>
  ),
};

// 12. Montage: one beat per thing, on the word that names it.
const MONT_VO = 0.1;
const mAt = (w: string) => MONT_VO + word('montage', w) - 0.1;
const mDrift: Clip = { take: 'drift', segments: [{ from: 20.7, to: 23.2, rate: 1.4 }], hold: 0.6 };
const mTypo: Clip = { take: 'typo', segments: [{ from: 8.25, to: 11.9, rate: 2.2 }], hold: 0.1 };
const mStale: Clip = { take: 'stale', segments: [{ from: 8.6, to: 12.4 }], hold: 1.0 };
const beats = [mAt('code'), mAt('overrides'), mAt('versioned'), mAt('drift'), mAt('typos'), mAt('stale')];
const montage: Scene = {
  id: 'montage',
  seconds: MONT_VO + voDur('montage') + 0.45,
  vo: [{ id: 'montage', at: MONT_VO }],
  sfx: beats.slice(1).map((at) => ({ name: 'whoosh' as const, at: at - 0.05, volume: 0.3 })),
  render: () => (
    <>
      <Part from={0} seconds={beats[1]!}>
        <Still src="stills/dash-code-refs.png" bar="localhost:8000 · Code references, published by FlagLens" seconds={beats[1]!} focus={{ x: 0.75, y: 0.95 }} zoom={1.25} />
      </Part>
      <Part from={beats[1]!} seconds={beats[2]! - beats[1]!}>
        <Still src="stills/user-override.png" seconds={beats[2]! - beats[1]!} focus={{ x: 0.5, y: 0.1 }} zoom={1.3} />
      </Part>
      <Part from={beats[2]!} seconds={beats[3]! - beats[2]!}>
        <VersionsCard />
      </Part>
      <Part from={beats[3]!} seconds={beats[4]! - beats[3]!}>
        <Background />
        <ScreenShot clip={mDrift} shots={[{ ...shotOnMark('drift', 'copied', { maxZ: 1.35, pad: 1.6 }), at: 0, dur: 0.01 }]} />
      </Part>
      <Part from={beats[4]!} seconds={beats[5]! - beats[4]!}>
        <Background />
        <ScreenShot clip={mTypo} shots={[{ ...shotOnMark('typo', 'quickfix', { maxZ: 1.7, pad: 2.6, dx: -120 }), at: 0, dur: 0.01 }]} />
      </Part>
      <Part from={beats[5]!} seconds={30}>
        <Background />
        <ScreenShot clip={mStale} shots={[{ ...shotOnMark('stale', 'problems', { maxZ: 1.45, pad: 1.05 }), at: 0, dur: 0.01 }]} />
        <Callout from={sec(MONT_VO + word('montage', 'all') - beats[5]!)} x={960} y={110} anchor="center" text="All on open-source, self-hosted Flagsmith" tone="on" />
      </Part>
      <Chapter n="+" text="And the rest" />
    </>
  ),
};

// 13. Recap, then "Nailed it."
const OUT_VO = 0.35;
const outMeme = OUT_VO + voDur('outro') + 0.35;
const outro: Scene = {
  id: 'outro',
  seconds: outMeme + memeSeconds('nailedit') + 0.8,
  vo: [{ id: 'outro', at: OUT_VO }],
  memes: [{ name: 'nailedit', at: outMeme, volume: 0.95 }],
  sfx: [{ name: 'whoosh', at: 0.0, volume: 0.4 }],
  render: () => <Recap fadeAt={outMeme + memeSeconds('nailedit') + 0.05} />,
};

export const SCENES: Scene[] = [hook, problem, title, devkit, greyout, preview, fix, realtime, health, toggle, protectedScene, testplan, montage, outro];

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
