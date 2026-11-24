// Frame capture + event log for the recordings.
//
// A Track screencasts one page (VS Code's window or a Chrome tab) over CDP and writes every frame as a JPEG with
// the compositor's timestamp. frames-to-video.mjs later resamples the frames onto an exact 60 fps grid, so the
// result has a constant frame rate no matter how irregularly frames arrived.
//
// A Director performs actions (mouse moves, clicks, typing) and logs them with wall-clock times, so the edit can
// draw a smooth cursor and zoom to the right place at the right moment.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class Track {
  constructor(name, cdp, dir, { width, height, quality = 88 }) {
    this.name = name;
    this.cdp = cdp;
    this.dir = join(dir, name);
    this.opts = { width, height, quality };
    this.frames = [];
    this.pending = [];
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(join(this.dir, 'frames'), { recursive: true });
    this.onFrame = async (f) => {
      const i = this.frames.length;
      const file = `frames/${String(i).padStart(6, '0')}.jpg`;
      this.frames.push({ t: f.metadata.timestamp, file });
      this.pending.push(writeFile(join(this.dir, file), Buffer.from(f.data, 'base64')));
      await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
  }

  async start() {
    this.cdp.on('Page.screencastFrame', this.onFrame);
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.opts.quality,
      maxWidth: this.opts.width,
      maxHeight: this.opts.height,
      everyNthFrame: 1,
    });
    this.startedAt = Date.now() / 1000;
  }

  async stop() {
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    this.cdp.off('Page.screencastFrame', this.onFrame);
    this.stoppedAt = Date.now() / 1000;
    await Promise.all(this.pending);
    writeFileSync(join(this.dir, 'index.json'), JSON.stringify({ startedAt: this.startedAt, stoppedAt: this.stoppedAt, ...this.opts, frames: this.frames }));
    return this.frames.length;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

/** Performs human-like actions on a Playwright page and logs them for the edit. */
export class Director {
  constructor(page, dir, take) {
    this.page = page;
    this.dir = dir;
    this.take = take;
    this.events = [];
    this.cursor = { x: 960, y: 540 };
  }

  log(type, data = {}) {
    this.events.push({ t: now(), type, ...data });
  }

  /** Records a named moment, optionally with the on-screen box of an element (for zoom targets). */
  async mark(name, locator) {
    const box = locator ? await locator.boundingBox().catch(() => null) : null;
    this.log('mark', { name, box });
    return box;
  }

  /** Moves the mouse along an eased path over `ms`, as a person would, sending real mousemove events. */
  async moveTo(x, y, ms = 700) {
    const from = { ...this.cursor };
    const t0 = now();
    const steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
      await this.page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
      await sleep(ms / steps);
    }
    this.cursor = { x, y };
    this.log('move', { from, to: { x, y }, t0, t1: now() });
  }

  async moveToLocator(locator, { ms = 700, dx = 0.5, dy = 0.5 } = {}) {
    await locator.waitFor({ state: 'visible', timeout: 15_000 });
    const b = await locator.boundingBox();
    await this.moveTo(b.x + b.width * dx, b.y + b.height * dy, ms);
    return b;
  }

  async click({ hold = 90 } = {}) {
    this.log('click', { ...this.cursor });
    await this.page.mouse.down();
    await sleep(hold);
    await this.page.mouse.up();
  }

  async clickLocator(locator, opts = {}) {
    const b = await this.moveToLocator(locator, opts);
    await sleep(opts.pause ?? 120);
    await this.click();
    if (process.env.REC_DEBUG) {
      this.shots = (this.shots ?? 0) + 1;
      await sleep(600);
      await this.page.screenshot({ path: join(this.dir, `debug-${this.take}-${this.shots}.png`), scale: 'css' });
    }
    return b;
  }

  /** Types like a person: steady rhythm with small natural variation. */
  async type(text, { cps = 14 } = {}) {
    this.log('type', { text, t0: now() });
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(1000 / cps + (Math.random() - 0.5) * 30);
    }
  }

  async key(combo) {
    this.log('key', { combo });
    await this.page.keyboard.press(combo);
  }

  wait(ms) {
    return sleep(ms);
  }

  save() {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${this.take}.events.json`), JSON.stringify(this.events, null, 1));
  }
}
