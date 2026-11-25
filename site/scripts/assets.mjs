// Copies images, the hero GIF and the paper from docs/ into public/assets, so they are not duplicated in git.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(site, '..');
const out = join(site, 'public/assets');
mkdirSync(join(out, 'screenshots'), { recursive: true });
const copy = (from, to) => cpSync(join(root, from), join(out, to));
copy('site/poster.jpg', 'poster.jpg');
copy('site/social.png', 'social.png');
copy('docs/hero.gif', 'hero.gif');
copy('docs/brand/flaglens-icon.svg', 'flaglens-icon.svg');
copy('docs/paper/flaglens.pdf', 'flaglens-paper.pdf');
for (const s of ['grey-out', 'preview-as', 'rule-check', 'test-plan', 'codelens', 'protected-confirm', 'matrix', 'typo-quick-fix']) {
  copy(`docs/screenshots/${s}.png`, `screenshots/${s}.png`);
}
console.log('assets copied');
