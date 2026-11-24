// Footage timing: a Clip plays parts of a recorded take, each part at its own speed, optionally holding the last
// frame. Everything that must line up with the footage (cursor, clicks, camera, sound effects) is computed from the
// take's event log through these functions, so it stays in sync whatever speeds the edit uses.
import takesJson from './data/takes.json';
import { FPS, easeInOutCubic } from './theme';

type Ev = { t: number; type: string; name?: string; box?: { x: number; y: number; width: number; height: number } | null; from?: P; to?: P; t0?: number; t1?: number; x?: number; y?: number; text?: string };
type P = { x: number; y: number };
type Take = { tracks: Record<string, { file: string; duration: number; offset: number }>; events: Ev[] };
export const takes = takesJson as unknown as Record<string, Take>;

export type Segment = { from: number; to: number; rate?: number };
export type Clip = { take: string; segments: Segment[]; hold?: number };

const segFrames = (s: Segment) => Math.round(((s.to - s.from) / (s.rate ?? 1)) * FPS);

export function clipFrames(c: Clip): number {
  return c.segments.reduce((n, s) => n + segFrames(s), 0) + Math.round((c.hold ?? 0) * FPS);
}

/** Start frame (within the clip) of each segment. */
export function segmentStarts(c: Clip): number[] {
  const out: number[] = [];
  let f = 0;
  for (const s of c.segments) {
    out.push(f);
    f += segFrames(s);
  }
  return out;
}

/** Footage time (seconds) shown at a frame of the clip. */
export function videoTimeAt(c: Clip, frame: number): number {
  let f = frame;
  for (const s of c.segments) {
    const n = segFrames(s);
    if (f < n) return s.from + (f / FPS) * (s.rate ?? 1);
    f -= n;
  }
  return c.segments[c.segments.length - 1]!.to;
}

/** Clip frame at which a footage time is shown, if that moment is in the clip. */
export function frameAtVideoTime(c: Clip, t: number): number | undefined {
  let base = 0;
  for (const s of c.segments) {
    if (t >= s.from && t <= s.to) return base + Math.round(((t - s.from) / (s.rate ?? 1)) * FPS);
    base += segFrames(s);
  }
  return undefined;
}

export const events = (take: string) => takes[take]!.events;
export const marks = (take: string) => events(take).filter((e) => e.type === 'mark');
export const mark = (take: string, name: string) => marks(take).find((e) => e.name === name);
export const clicks = (take: string) => events(take).filter((e) => e.type === 'click');

/** Cursor position at footage time t, following the logged eased moves exactly. */
export function cursorAt(take: string, t: number): P | undefined {
  const moves = events(take).filter((e) => e.type === 'move');
  if (!moves.length) return undefined;
  let pos: P = moves[0]!.from!;
  for (const m of moves) {
    if (t < m.t0!) break;
    if (t <= m.t1!) {
      const k = easeInOutCubic((t - m.t0!) / Math.max(0.001, m.t1! - m.t0!));
      return { x: m.from!.x + (m.to!.x - m.from!.x) * k, y: m.from!.y + (m.to!.y - m.from!.y) * k };
    }
    pos = m.to!;
  }
  return pos;
}

/** Seconds since the most recent click (for the click ripple), or undefined. */
export function sinceClick(take: string, t: number): number | undefined {
  let best: number | undefined;
  for (const c of clicks(take)) if (c.t <= t) best = t - c.t;
  return best;
}

export type Shot = { at: number; z: number; x: number; y: number; dur?: number };

/** Camera (zoom + focus point in footage CSS px) at footage time t, easing between shots. */
export function cameraAt(shots: Shot[], t: number): { z: number; x: number; y: number } {
  let cur = { z: 1, x: 960, y: 540 };
  for (const s of shots) {
    const dur = s.dur ?? 0.9;
    if (t < s.at) break;
    const k = easeInOutCubic(Math.min(1, (t - s.at) / dur));
    // Interpolate zoom in log space so zooming feels uniform.
    const z = Math.exp(Math.log(cur.z) + (Math.log(s.z) - Math.log(cur.z)) * k);
    cur = { z, x: cur.x + (s.x - cur.x) * k, y: cur.y + (s.y - cur.y) * k };
  }
  return cur;
}

/** A shot that frames a logged element box (from a mark) with some breathing room. */
export function shotOnMark(take: string, name: string, opts: { pad?: number; maxZ?: number; minZ?: number; lead?: number; dur?: number; dx?: number; dy?: number } = {}): Shot {
  const m = mark(take, name);
  if (!m) throw new Error(`mark ${take}:${name} not found`);
  const b = m.box ?? { x: 760, y: 440, width: 400, height: 200 };
  const pad = opts.pad ?? 1.7;
  const z = Math.max(opts.minZ ?? 1, Math.min(opts.maxZ ?? 1.8, 1920 / (b.width * pad), 1080 / (b.height * pad)));
  return { at: m.t - (opts.lead ?? 0.35), z, x: b.x + b.width / 2 + (opts.dx ?? 0), y: b.y + b.height / 2 + (opts.dy ?? 0), dur: opts.dur };
}
