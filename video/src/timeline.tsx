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
import { ClickCounter, Outro, Terminal, TitleCard } from './components/Graphics';
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
// 1. Hook: code that has never run. Slow push in, then a zoom punch onto the typo, then a facepalm.
// ---------------------------------------------------------------------------------------------------------------
const typoBox = mark('hook', 'typo')!.box!;
const hookClip: Clip = { take: 'hook', segments: [{ from: 0.3, to: 2.2 }, { from: 2.2, to: 6.35, rate: 0.55 }, { from: 6.35, to: 9.1 }], hold: 1.5 };
const HOOK_VO = 0.25;
const hookPunch = HOOK_VO + word('hook', 'why') + 0.45;
const hookPunchVideoT = videoTimeAt(hookClip, sec(hookPunch));
const hookMeme = hookPunch + 0.55;
const hook: Scene = {
  id: 'hook',
  seconds: hookMeme + memeSeconds('facepalm') + 0.05,
  vo: [{ id: 'hook', at: HOOK_VO }],
  memes: [{ name: 'facepalm', at: hookMeme, caption: '3 sprints later', volume: 0 }],
  sfx: [
    { name: 'riser', at: hookPunch - 2.0, volume: 0.3 },
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
          { at: 0.31, z: 2.3, x: 740, y: 462, dur: 6.0 },
          { at: hookPunchVideoT, z: 3.0, x: typoBox.x + typoBox.width / 2 + 40, y: typoBox.y - 20, dur: 0.18 },
        ]}
      >
        <Ring x={RECT.x + typoBox.x * S} y={RECT.y + typoBox.y * S} w={typoBox.width * S} h={typoBox.height * S} at={hookPunch} />
      </Stage>
      <Callout from={sec(HOOK_VO + word('hook', 'never'))} to={sec(hookPunch - 0.3)} x={960} y={130} anchor="center" text="Times this ran in production: 0" tone="warn" />
    </>
  ),
};

// ---------------------------------------------------------------------------------------------------------------
// 2. The problem: SDKs default silently, and the answer lives five clicks away in a dashboard.
// ---------------------------------------------------------------------------------------------------------------
const hookHold: Clip = { take: 'hook', segments: [freeze(9.05, 7.6)] };
const hunt: Clip = { take: 'hunt', segments: [{ from: 1.8, to: 18.4, rate: 2.25 }] };
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
const PROB_VO = 0.15;
const probHunt = PROB_VO + word('problem', 'because') - 0.25;
const probMeme = PROB_VO + voDur('problem') + 0.15;
const problem: Scene = {
  id: 'problem',
  seconds: probMeme + memeSeconds('intercom') + 0.05,
  vo: [{ id: 'problem', at: PROB_VO }],
  memes: [{ name: 'intercom', at: probMeme, caption: 'me, looking for one flag', volume: 0.85 }],
  sfx: [
    { name: 'alert', at: PROB_VO + word('problem', 'off'), volume: 0.4 },
    { name: 'whoosh', at: probHunt - 0.15, volume: 0.45 },
    ...footageSfx(hunt, probHunt),
    { name: 'scratch', at: probMeme - 0.05, volume: 0.5 },
  ],
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

// 3. Title
const title: Scene = {
  id: 'title',
  seconds: 0.25 + voDur('title') + 0.45,
  vo: [{ id: 'title', at: 0.25 }],
  sfx: [{ name: 'impact', at: 0.05, volume: 0.6 }],
  render: () => <TitleCard liveAt={0.25 + word('title', 'live')} builtAt={0.25 + word('title', 'made')} />,
};

// 4. Dev kit
const devkit: Scene = {
  id: 'devkit',
  seconds: 0.3 + voDur('devkit') + 0.5,
  vo: [{ id: 'devkit', at: 0.3 }],
  sfx: [
    { name: 'typing', at: 0.3, volume: 0.35, len: 0.5 },
    { name: 'typing', at: 3.4, volume: 0.35, len: 0.5 },
    { name: 'success', at: 0.3 + word('devkit', 'demo'), volume: 0.45 },
  ],
  render: () => (
    <>
      <Terminal boxAt={0.3 + word('devkit', 'demo')} />
      <Chapter n={1} text="One-command self-hosted dev kit" />
    </>
  ),
};

// 5. Connect
const connectClip: Clip = { take: 'connect', segments: [{ from: 0, to: 10.7 }], hold: 0.2 };
const connect: Scene = {
  id: 'connect',
  seconds: clipFrames(connectClip) / FPS,
  vo: [{ id: 'connect', at: 0.6 }],
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
      <Chapter n={2} text="Live state, right in the code" />
    </>
  ),
};

// 6. Toggle (split with the live shop)
const toggleClip: Clip = { take: 'toggle', segments: [{ from: 1.8, to: 13.4, rate: 1.6 }], hold: 0.6 };
const toggleShopAt = frameAtVideoTime(toggleClip, mark('toggle', 'shop-updated')!.t)! / FPS;
const toggle: Scene = {
  id: 'toggle',
  seconds: clipFrames(toggleClip) / FPS,
  vo: [{ id: 'toggle', at: 0.3 }],
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
      <Chapter n={3} text="Safe toggles" />
    </>
  ),
};

// 7. Protected environments: "Nope." → Gandalf (footage frozen on the typed confirmation) → the rest.
const GANDALF = memeSeconds('pass');
const protFreezeAt = mark('protected', 'typed-confirm')!.t + 0.12;
const protectedClip: Clip = {
  take: 'protected',
  segments: [{ from: 2.0, to: protFreezeAt, rate: 1.6 }, freeze(protFreezeAt, GANDALF + 0.1), { from: protFreezeAt + 0.01, to: 12.2, rate: 1.3 }, { from: 14.2, to: 21.5, rate: 2.0 }],
  hold: 0.4,
};
const protMemeAt = (protFreezeAt - 2.0) / 1.6;
const protTypedAt = frameAtVideoTime(protectedClip, mark('protected', 'typed-confirm')!.t)! / FPS;
const protUndoAt = frameAtVideoTime(protectedClip, mark('protected', 'undo-dialog')!.t)! / FPS;
const protShopAt = frameAtVideoTime(protectedClip, mark('protected', 'shop-updated')!.t)! / FPS;
const protRevertAt = frameAtVideoTime(protectedClip, mark('protected', 'shop-reverted')!.t)! / FPS;
const protSplit = word('protected', 'you') - 0.06;
const protectedScene: Scene = {
  id: 'protected',
  seconds: clipFrames(protectedClip) / FPS,
  vo: [
    { id: 'protected', at: Math.max(0.3, protMemeAt - protSplit - 0.15), to: protSplit },
    { id: 'protected', at: protMemeAt + GANDALF + 0.15, from: protSplit },
  ],
  memes: [{ name: 'pass', at: protMemeAt, volume: 0.95 }],
  sfx: [
    ...footageSfx(protectedClip, 0, { pops: ['dialog', 'undo-dialog'], successes: ['toast', 'undone'] }),
    { name: 'boom', at: protMemeAt - 0.02, volume: 0.45 },
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
            <Callout from={sec(protTypedAt + GANDALF)} to={sec(protShopAt - 0.6)} x={620} y={830} anchor="center" text="Production is protected: type the flag name" tone="warn" />
            <Callout from={sec(protUndoAt - 0.2)} x={620} y={830} anchor="center" text="Undo (asks again in Production)" />
          </>
        }
      />
      <Chapter n={4} text="Protected environments" />
    </>
  ),
};

// 8. Greyed-out code: Development, then Production (where only the certain branches stay grey).
const greyClip: Clip = { take: 'greyout', segments: [{ from: 0.4, to: 5.0, rate: 0.75 }, { from: 5.0, to: 11.88 }], hold: 1.2 };
const GREY_VO = 0.2;
const greyout: Scene = {
  id: 'greyout',
  seconds: Math.max(clipFrames(greyClip) / FPS, GREY_VO + voDur('greyout') + 0.35),
  vo: [{ id: 'greyout', at: GREY_VO }],
  sfx: [...footageSfx(greyClip, 0, { pops: ['envpick'] }), { name: 'whoosh', at: frameAtVideoTime(greyClip, mark('greyout', 'prod')!.t)! / FPS - 0.1, volume: 0.35 }],
  render: () => (
    <>
      <Background />
      <Stage
        clip={greyClip}
        shots={[
          { at: 0, z: 1.12, x: 1000, y: 560, dur: 0.01 },
          { at: 2.6, z: 1.45, x: 1120, y: 760, dur: 1.6 },
          shotOnMark('greyout', 'envpick', { maxZ: 1.7, pad: 1.6, lead: 0.3 }),
          { at: mark('greyout', 'prod')!.t - 0.2, z: 1.55, x: 1120, y: 800, dur: 0.8 },
        ]}
      />
      <Callout from={sec(GREY_VO + word('greyout', 'greys'))} to={sec(GREY_VO + word('greyout', 'switch') - 0.2)} x={960} y={120} anchor="center" text="Development: dead branches greyed, with the reason" />
      <Callout from={sec(GREY_VO + word('greyout', 'only'))} x={960} y={120} anchor="center" text="Production: new_checkout differs per user → not greyed" tone="on" />
      <Chapter n={5} text="Code that can't run, greyed out" />
    </>
  ),
};

// 9. Preview as a user, and the server check.
const previewClip: Clip = { take: 'preview', segments: [{ from: 0.6, to: 15.43 }], hold: 3.6 };
const PREV_VO = 0.2;
const prevStatAt = PREV_VO + word('preview', 'and') - 0.1;
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
          { at: mark('preview', 'beta')!.t - 0.3, z: 1.4, x: 1000, y: 330, dur: 0.9 },
          shotOnMark('preview', 'hover:new_checkout', { maxZ: 1.8, pad: 1.12, lead: 0.2 }),
          { at: videoTimeAt(previewClip, sec(prevStatAt - 0.3)), z: 1.0, x: 960, y: 540, dur: 0.8 },
        ]}
      />
      <Part from={prevStatAt} seconds={30}>
        <StatCard countAt={PREV_VO + word('preview', 'fourteen') - prevStatAt} missesAt={PREV_VO + word('preview', 'zero') - prevStatAt} />
      </Part>
      <Chapter n={6} text="Preview as a user" />
    </>
  ),
};

// 10. Targeting rule check: the hover, then the report. "They're so different."
const rulesClip: Clip = { take: 'rules', segments: [{ from: 0.6, to: 6.8 }, { from: 6.8, to: 10.0, rate: 2.4 }, { from: 10.0, to: 14.25 }], hold: 0.4 };
const RULES_VO = 0.2;
const rulesMeme = RULES_VO + voDur('rules') + 0.2;
const rules: Scene = {
  id: 'rules',
  seconds: rulesMeme + memeSeconds('different') + 0.25,
  vo: [{ id: 'rules', at: RULES_VO }],
  memes: [{ name: 'different', at: rulesMeme, volume: 0.95 }],
  sfx: [...footageSfx(rulesClip, 0, { pops: ['hover:rate_limit_per_minute', 'report'] }), { name: 'scratch', at: rulesMeme - 0.05, volume: 0.45 }],
  render: () => (
    <>
      <Background />
      <Stage
        clip={rulesClip}
        shots={[
          { at: 0, z: 1.0, x: 960, y: 540, dur: 0.01 },
          shotOnMark('rules', 'hover:rate_limit_per_minute', { maxZ: 1.85, pad: 1.08, lead: 0.2 }),
          { at: 6.7, z: 1.0, x: 960, y: 540, dur: 0.6 },
          { at: mark('rules', 'report')!.t - 0.1, z: 1.85, x: 1580, y: 760, dur: 0.9 },
        ]}
      />
      <Chapter n={7} text="Targeting rule check" />
    </>
  ),
};

// 11. Pairwise test plan: "ninety-six combinations" → maths → [sigh] "Or… seven runs."
const MATH = memeSeconds('math');
const TP_VO = 0.2;
// Speech-to-text timing: "combinations" ends at 3.94 s, then a sigh until 5.64 s. Split there, so the sigh comes
// after the meme. (The alignment stretches "combinations." over the sigh, so it can't be used for this.)
const tpSplit = 3.97;
const tpMeme = TP_VO + tpSplit + 0.05;
const tpFreezeAt = tpMeme + 0.3;
const testplanClip: Clip = { take: 'testplan', segments: [{ from: 0.3, to: tpFreezeAt }, freeze(tpFreezeAt, MATH + 0.1), { from: tpFreezeAt + 0.01, to: 11.25, rate: 0.9 }], hold: 1.6 };
const testplan: Scene = {
  id: 'testplan',
  seconds: Math.max(clipFrames(testplanClip) / FPS, tpMeme + MATH + 0.1 + voDur('testplan') - tpSplit + 0.4),
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
          { at: mark('testplan', 'plan')!.t - 0.2, z: 1.55, x: 1500, y: 560, dur: 0.9 },
        ]}
      />
      <Chapter n={8} text="Pairwise test plan" />
    </>
  ),
};

// 12. Montage: drift, typo fix, stale flags. "All free, on open source." → free real estate.
const mDrift: Clip = { take: 'drift', segments: [{ from: 20.7, to: 23.2, rate: 1.1 }], hold: 0.6 };
const mTypo: Clip = { take: 'typo', segments: [{ from: 8.25, to: 11.9, rate: 1.9 }], hold: 0.1 };
const mStale: Clip = { take: 'stale', segments: [{ from: 8.6, to: 12.4 }], hold: 1.0 };
const MONT_VO = 0.15;
const mTypoAt = MONT_VO + word('montage', 'one-click') - 0.15;
const mStaleAt = MONT_VO + word('montage', 'stale') - 0.15;
const montMeme = MONT_VO + voDur('montage') + 0.1;
const montage: Scene = {
  id: 'montage',
  seconds: montMeme + memeSeconds('realestate') + 0.2,
  vo: [{ id: 'montage', at: MONT_VO }],
  memes: [{ name: 'realestate', at: montMeme, volume: 0.95 }],
  sfx: [
    { name: 'whoosh', at: mTypoAt - 0.1, volume: 0.35 },
    { name: 'whoosh', at: mStaleAt - 0.1, volume: 0.35 },
    ...footageSfx(mTypo, mTypoAt, { pops: ['quickfix'], successes: ['fixed'] }),
  ],
  render: () => (
    <>
      <Part from={0} seconds={mTypoAt}>
        <Background />
        <ScreenShot clip={mDrift} shots={[{ at: 0, z: 1.5, x: 1230, y: 360, dur: 0.01 }, shotOnMark('drift', 'copied', { maxZ: 1.35, pad: 1.6, lead: 0.4 })]} />
      </Part>
      <Part from={mTypoAt} seconds={mStaleAt - mTypoAt}>
        <Background />
        <ScreenShot clip={mTypo} shots={[{ ...shotOnMark('typo', 'quickfix', { maxZ: 1.7, pad: 2.6, lead: 0.25, dx: -120 }), at: 0, dur: 0.01 }, { at: mark('typo', 'fixed')!.t - 0.2, z: 1.45, x: 800, y: 300, dur: 0.5 }]} />
      </Part>
      <Part from={mStaleAt} seconds={30}>
        <Background />
        <ScreenShot clip={mStale} shots={[{ ...shotOnMark('stale', 'problems', { maxZ: 1.45, pad: 1.05 }), at: 0, dur: 0.01 }]} />
        <Callout from={sec(MONT_VO + word('montage', 'all') - mStaleAt)} x={960} y={120} anchor="center" text="Stale-flag detection: paid on Cloud, free here" tone="on" />
      </Part>
      <Chapter n={9} text="Drift · typos · stale flags" />
    </>
  ),
};

// 13. Outro, then "Nailed it."
const OUT_VO = 0.4;
const outMeme = OUT_VO + voDur('outro') + 0.15;
const outro: Scene = {
  id: 'outro',
  seconds: outMeme + memeSeconds('nailedit') + 0.9,
  vo: [{ id: 'outro', at: OUT_VO }],
  memes: [{ name: 'nailedit', at: outMeme, volume: 0.95 }],
  sfx: [{ name: 'whoosh', at: 0.0, volume: 0.4 }],
  render: () => <Outro fadeAt={outMeme + memeSeconds('nailedit') + 0.05} />,
};

export const SCENES: Scene[] = [hook, problem, title, devkit, connect, toggle, protectedScene, greyout, preview, rules, testplan, montage, outro];

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
