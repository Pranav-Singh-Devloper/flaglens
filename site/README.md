# FlagLens website

The landing page at **https://flaglens-one.vercel.app**: Vite, React, Tailwind CSS, and interactive components from
[React Bits](https://reactbits.dev) (copied into `src/components/reactbits/` from its registry, as React Bits
intends; see its licence).

```bash
cd site
npm install
npm run dev        # http://localhost:5173
sh deploy.sh       # build and deploy to Vercel (production)
```

`npm run build` first copies the images, hero GIF and paper from `docs/` into `public/assets/` (git-ignored), so
they are not duplicated in the repository. The demo video plays straight from the GitHub release.

Components used: DotGrid (interactive background with a click shockwave), SplitText, GradientText, ShinyText,
RotatingText and CountUp (text), GlareHover, SpotlightCard, StarBorder and Magnet (hover), AnimatedContent (scroll
reveals), ClickSpark (click effect) and TargetCursor (cursor, on mouse and trackpad only).
