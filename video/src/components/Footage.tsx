import React from 'react';
import { Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { cameraAt, clipFrames, cursorAt, segmentStarts, sinceClick, takes, videoTimeAt, type Clip, type Shot } from '../footage';
import { FPS } from '../theme';
import { Window, type Rect } from './Chrome';

export type Crop = { x: number; y: number; w: number; h: number };

/** macOS-style pointer, drawn in footage CSS px. */
const Pointer: React.FC<{ x: number; y: number; press: number }> = ({ x, y, press }) => (
  <svg width={26} height={36} viewBox="0 0 26 36" style={{ position: 'absolute', left: x - 3, top: y - 2, transform: `scale(${1 - press * 0.12})`, transformOrigin: '3px 2px', filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.45))', zIndex: 30 }}>
    <path d="M3 2 L3 28 L9.5 22 L14 33 L18.5 31 L14 20.5 L23 20.5 Z" fill="white" stroke="black" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

/**
 * Plays a clip of a recorded track inside a box. `crop` (footage CSS px) picks the region to show.
 * The cursor (if any) is drawn from the take's event log at the right time and place.
 */
export const Footage: React.FC<{ clip: Clip; track: string; css: { w: number; h: number }; crop?: Crop; box: { w: number; h: number }; cursor?: boolean }> = ({
  clip,
  track,
  css,
  crop = { x: 0, y: 0, w: css.w, h: css.h },
  box,
  cursor = true,
}) => {
  const frame = useCurrentFrame();
  const info = takes[clip.take]!.tracks[track]!;
  const s = box.w / crop.w;
  const starts = segmentStarts(clip);
  const total = clipFrames(clip);
  const lastSeg = clip.segments[clip.segments.length - 1]!;
  const vt = videoTimeAt(clip, Math.min(frame, total - 1));
  const pos = cursor ? cursorAt(clip.take, vt) : undefined;
  const since = sinceClick(clip.take, vt);
  const press = since !== undefined && since < 0.18 ? 1 - since / 0.18 : 0;
  const videoStyle: React.CSSProperties = { position: 'absolute', left: -crop.x * s, top: -crop.y * s, width: css.w * s, height: css.h * s };
  // Tracks that started a few ms after the main one are shifted so they stay in sync.
  const shift = (t: number) => Math.max(0, t - info.offset);
  return (
    <div style={{ position: 'absolute', width: box.w, height: box.h, overflow: 'hidden', background: '#1E1E1E' }}>
      {clip.segments.map((seg, i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={Math.round(((seg.to - seg.from) / (seg.rate ?? 1)) * FPS)} layout="none">
          <OffthreadVideo src={staticFile(info.file)} startFrom={Math.round(shift(seg.from) * FPS)} playbackRate={seg.rate ?? 1} muted style={videoStyle} />
        </Sequence>
      ))}
      {clip.hold ? (
        <Sequence from={starts[starts.length - 1]! + Math.round(((lastSeg.to - lastSeg.from) / (lastSeg.rate ?? 1)) * FPS)} layout="none">
          <Freeze frame={0}>
            <OffthreadVideo src={staticFile(info.file)} startFrom={Math.max(0, Math.round(shift(lastSeg.to) * FPS) - 2)} muted style={videoStyle} />
          </Freeze>
        </Sequence>
      ) : null}
      {pos && (
        <div style={{ position: 'absolute', left: 0, top: 0, transform: `scale(${s})`, transformOrigin: '0 0' }}>
          <div style={{ position: 'absolute', left: -crop.x, top: -crop.y }}>
            {since !== undefined && since < 0.45 && (
              <div
                style={{
                  position: 'absolute',
                  left: pos.x - 6 - since * 70,
                  top: pos.y - 6 - since * 70,
                  width: 12 + since * 140,
                  height: 12 + since * 140,
                  borderRadius: '50%',
                  border: `3px solid rgba(124,108,255,${0.9 - since * 2})`,
                  background: `rgba(124,108,255,${0.25 - since * 0.5})`,
                }}
              />
            )}
            <Pointer x={pos.x} y={pos.y} press={press} />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * A window on the background with a camera: the whole stage zooms toward the shot's focus point (footage CSS px),
 * clamped so the frame never shows empty space beyond the window once zoomed in.
 */
export const CameraStage: React.FC<{ clip: Clip; shots: Shot[]; rect: Rect; barH?: number; crop: Crop; children: React.ReactNode }> = ({ clip, shots, rect, barH = 0, crop, children }) => {
  const frame = useCurrentFrame();
  const vt = videoTimeAt(clip, frame);
  const cam = cameraAt(shots, vt);
  const s = rect.w / crop.w;
  let fx = rect.x + (cam.x - crop.x) * s;
  let fy = rect.y + barH + (cam.y - crop.y) * s;
  const z = cam.z;
  // Keep the visible area inside the window when zoomed in enough to fill the frame.
  const halfW = 960 / z;
  const halfH = 540 / z;
  const winL = rect.x;
  const winR = rect.x + rect.w;
  const winT = rect.y;
  const winB = rect.y + barH + rect.h;
  const k = Math.min(1, Math.max(0, (z - 1) / 0.25)); // blend clamping in as we zoom
  const cx = winR - winL > 2 * halfW ? Math.min(winR - halfW, Math.max(winL + halfW, fx)) : (winL + winR) / 2;
  const cy = winB - winT > 2 * halfH ? Math.min(winB - halfH, Math.max(winT + halfH, fy)) : (winT + winB) / 2;
  fx = fx + (cx - fx) * k;
  fy = fy + (cy - fy) * k;
  const lerp = Math.min(1, z - 1); // at z=1 stay centred on the canvas
  const ox = 960 + (fx - 960) * lerp;
  const oy = 540 + (fy - 540) * lerp;
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translate(960px, 540px) scale(${z}) translate(${-ox}px, ${-oy}px)`, transformOrigin: '0 0' }}>{children}</div>
  );
};

/** The common case: one VS Code (or dashboard) recording in a floating window with a camera. */
export const ScreenShot: React.FC<{
  clip: Clip;
  track?: string;
  css?: { w: number; h: number };
  shots?: Shot[];
  rect?: Rect;
  bar?: { kind: 'browser' | 'terminal'; text: string };
  lights?: boolean;
}> = ({ clip, track = 'vscode', css = { w: 1920, h: 1080 }, shots = [], rect = { x: 112, y: 63, w: 1696, h: 954 }, bar, lights = true }) => {
  const barH = bar ? 46 : 0;
  const r = bar ? { ...rect, h: rect.h - barH, y: rect.y } : rect;
  const crop = { x: 0, y: 0, w: css.w, h: css.h };
  return (
    <CameraStage clip={clip} shots={shots} rect={r} barH={barH} crop={crop}>
      <Window rect={r} bar={bar} lights={lights && !bar}>
        <Footage clip={clip} track={track} css={css} box={{ w: r.w, h: r.h }} />
      </Window>
    </CameraStage>
  );
};
