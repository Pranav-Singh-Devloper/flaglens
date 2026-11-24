import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

export const FPS = 60;
export const W = 1920;
export const H = 1080;

export const C = {
  bg: '#0B1020',
  bg2: '#11183A',
  panel: '#141A2E',
  panel2: '#1B2340',
  text: '#E6E8F0',
  muted: '#8A90A6',
  accent: '#7C6CFF',
  accent2: '#A99DFF',
  on: '#2ECC71',
  warn: '#F5A524',
  bad: '#FF5D5D',
  border: 'rgba(255,255,255,0.09)',
};

export const SANS = loadInter('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] }).fontFamily;
export const MONO = loadMono('normal', { weights: ['400', '500', '700'], subsets: ['latin'] }).fontFamily;

export const sec = (s: number) => Math.round(s * FPS);

export const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
export const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
export const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
