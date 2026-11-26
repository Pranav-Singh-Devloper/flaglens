// FlagLens landing page. Interactive pieces come from React Bits (reactbits.dev), in src/components/reactbits.
import { useEffect, useState, type ReactNode } from 'react';
import AnimatedContent from './components/reactbits/AnimatedContent';
import ClickSpark from './components/reactbits/ClickSpark';
import CountUp from './components/reactbits/CountUp';
import DotGrid from './components/reactbits/DotGrid';
import GlareHover from './components/reactbits/GlareHover';
import GradientText from './components/reactbits/GradientText';
import Magnet from './components/reactbits/Magnet';
import RotatingText from './components/reactbits/RotatingText';
import Architecture from './Architecture';
import ShinyText from './components/reactbits/ShinyText';
import SplitText from './components/reactbits/SplitText';
import SpotlightCard from './components/reactbits/SpotlightCard';
import StarBorder from './components/reactbits/StarBorder';
import TargetCursor from './components/reactbits/TargetCursor';

const REPO = 'https://github.com/Pranav-Singh-Devloper/flaglens';
const RELEASES = `${REPO}/releases/latest`;
const VIDEO = `${REPO}/releases/download/v0.5.1/flaglens-demo.mp4`;
const BRAND = '#6a58f0';

/** True on devices with a precise pointer (mouse, trackpad): the custom cursor is only for those. */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(pointer: fine)');
    setFine(m.matches);
    const on = () => setFine(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return fine;
}

const Reveal = ({ children, delay = 0 }: { children: ReactNode; delay?: number }) => (
  <AnimatedContent distance={40} duration={0.9} ease="power3.out" initialOpacity={0} threshold={0.15} delay={delay}>
    {children}
  </AnimatedContent>
);

const Button = ({ href, children }: { href: string; children: ReactNode }) => (
  <Magnet padding={60} magnetStrength={6}>
    <a href={href} className="cursor-target inline-flex items-center rounded-xl border border-line bg-white px-5 py-3 text-[15px] font-semibold text-ink shadow-sm transition hover:border-[#cfcbea] hover:bg-[#fafaff]">
      {children}
    </a>
  </Magnet>
);

const Window = ({ children }: { children: ReactNode }) => (
  <div className="overflow-hidden rounded-2xl border border-line bg-[#1e1e1e] shadow-[0_30px_90px_rgba(40,30,120,0.18)]">
    <div className="flex h-8 items-center gap-1.5 border-b border-black/30 bg-[#24273a] px-3.5">
      <i className="block h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
      <i className="block h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
      <i className="block h-2.5 w-2.5 rounded-full bg-[#28c840]" />
    </div>
    {children}
  </div>
);

const Shot = ({ src, alt }: { src: string; alt: string }) => (
  <GlareHover width="100%" height="auto" borderRadius="14px" borderColor="#e6e7f0" glareColor="#ffffff" glareOpacity={0.35} blendMode="soft-light" className="cursor-target block overflow-hidden shadow-[0_24px_70px_rgba(40,30,120,0.16)]">
    <img src={src} alt={alt} width={1600} height={900} className="block h-auto w-full" />
  </GlareHover>
);

const FEATURES = [
  {
    title: "Greys out code that can't run",
    body: 'Pick an environment, or a single user, and branches that can never execute fade out like an inactive #ifdef, with the reason at the end of the line. A typo in a flag key? The code behind it is greyed too.',
    proof: (
      <>
        Conditions are evaluated in three-valued logic, so anything uncertain stays visible. It <b className="text-go">never greys code that might execute.</b>
      </>
    ),
    img: '/assets/screenshots/grey-out.png',
    alt: 'Greyed-out branches in VS Code with the reason at the end of each line',
  },
  {
    title: 'Preview flags as any user',
    body: 'Choose an identity and its traits from the status bar. CodeLens, hovers and greyed code then show what that user gets in every environment, and which segment, split bucket or override decided it.',
    proof: (
      <>
        Flagsmith&apos;s own evaluation rules, run locally. <b className="text-go">15,050 of 15,050</b> results match the live server, across every rule operator and flag dependencies.
      </>
    ),
    img: '/assets/screenshots/preview-as.png',
    alt: 'Hover card comparing environment state with what a beta tester gets',
  },
  {
    title: 'Checks your targeting rules',
    body: 'Finds segment overrides that can never apply because a higher-priority one catches everyone first, overrides that change nothing, segments that match nobody and defaults nobody gets.',
    proof: (
      <>
        Each finding is <b className="text-go">proven for every possible user</b>, using the anomaly model from firewall-policy analysis and an exact split of trait values into equivalence classes.
      </>
    ),
    img: '/assets/screenshots/rule-check.png',
    alt: 'Targeting rule check report listing a shadowed and a redundant override',
  },
  {
    title: 'Plans the smallest set of tests',
    body: 'Choose flags and FlagLens builds the fewest test runs in which every pair of flag values appears together, ready to paste as JSON or a GitHub Actions matrix.',
    proof: (
      <>
        Six flags: <b className="text-go">96 combinations become 7 runs</b>, provably the minimum (Kleitman–Spencer for on/off flags, plus a lower bound for mixed flags).
      </>
    ),
    img: '/assets/screenshots/test-plan.png',
    alt: 'Pairwise test plan with 7 runs instead of 96',
  },
];

const ESSENTIALS = [
  { title: 'Live state inline', body: "Every environment's state and value above each flag, with drift, stale and archived badges.", img: 'codelens' },
  { title: 'Safe toggles', body: "Every change is confirmed. Production asks you to type the flag's name, and Undo asks again.", img: 'protected-confirm' },
  { title: 'Environment drift', body: 'A matrix of every flag across environments, with differences highlighted and a Markdown diff for your pull request.', img: 'matrix' },
  { title: 'Typos and stale flags', body: 'Unknown keys are underlined with a one-click fix. Stale and archived flags show up as problems, for free.', img: 'typo-quick-fix' },
];

const COMMANDS = 'git clone https://github.com/Pranav-Singh-Devloper/flaglens.git && cd flaglens\nmake up\nmake seed\nmake demo';

function CopyButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="cursor-target absolute top-3 right-3 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/70 hover:text-white"
      onClick={async () => {
        await navigator.clipboard.writeText(COMMANDS);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function App() {
  const fine = useFinePointer();
  return (
    <ClickSpark sparkColor={[BRAND, '#2ecc71', '#a99dff']} sparkSize={9} sparkRadius={22} sparkCount={9} duration={450}>
      {fine && <TargetCursor targetSelector=".cursor-target" cursorColor={BRAND} cursorColorOnTarget={BRAND} hideDefaultCursor={false} spinDuration={3} blendMode="normal" />}

      <nav className="sticky top-0 z-40 border-b border-line/80 bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="#" className="cursor-target flex items-center gap-2.5 text-xl font-extrabold tracking-tight text-ink">
            <img src="/assets/flaglens-icon.svg" alt="" className="h-8 w-8" />
            <span>
              Flag<span className="text-brand">Lens</span>
            </span>
          </a>
          <div className="hidden gap-7 text-[15px] text-muted md:flex">
            {[
              ['Features', '#features'],
              ['Demo', '#demo'],
              ['Quick start', '#start'],
              ['Research', '#research'],
              ['Architecture', '#architecture'],
              ['GitHub', REPO],
            ].map(([label, href]) => (
              <a key={label} href={href} className="cursor-target hover:text-ink">
                {label}
              </a>
            ))}
          </div>
        </div>
      </nav>

      <header className="relative overflow-hidden">
        <div className="absolute inset-0">
          <DotGrid dotSize={4} gap={22} baseColor="#c9cce0" activeColor={BRAND} proximity={150} shockRadius={260} shockStrength={5} glow={0.8} fade={0.6} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(48%_40%_at_50%_36%,rgba(251,251,254,0.9),rgba(251,251,254,0.35)_65%,rgba(251,251,254,0)_100%)]" />

        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
          <div className="mb-6 inline-block rounded-full border border-[#d9d3ff] bg-white/80 px-4 py-1.5 text-[13px] font-semibold">
            <ShinyText text="For self-hosted, open-source Flagsmith" color="#5a4ad8" shineColor="#c7bdff" speed={3} />
          </div>

          <h1 className="mx-auto max-w-4xl text-[clamp(38px,5.6vw,64px)] leading-[1.06] font-extrabold tracking-[-0.035em]">
            <SplitText text="See, test and trust your feature flags," tag="span" splitType="words" delay={70} duration={0.9} trigger="load" className="block" />
            <GradientText colors={[BRAND, '#2ecc71', '#4f8cff', BRAND]} animationSpeed={6} className="mt-1 !inline-flex">
              right in your code.
            </GradientText>
          </h1>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2 text-[19px] text-body">
            <span>A VS Code extension that</span>
            <RotatingText
              texts={['knows what runs', 'proves your rules', 'is live with your Flagsmith']}
              mainClassName="overflow-hidden rounded-lg bg-brand px-3 py-0.5 font-semibold text-white"
              splitLevelClassName="overflow-hidden"
              staggerDuration={0.015}
              rotationInterval={2600}
            />
          </div>
          <div className="mx-auto mt-7 grid max-w-4xl gap-3 text-left sm:grid-cols-3">
            {[
              ['1', 'It knows what runs', '15,050 of 15,050 local evaluations match the live server'],
              ['2', 'It proves your rules', 'every finding holds for every possible user'],
              ['3', "It's live", 'a dashboard toggle reaches the editor in about 3 s'],
            ].map(([n, t, proof]) => (
              <div key={n} className="rounded-2xl border border-line bg-white/85 p-4 shadow-sm">
                <div className="flex items-center gap-2.5 text-[16px] font-bold text-ink">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[12px] text-white">{n}</span>
                  {t}
                </div>
                <div className="mt-1.5 text-[14px] text-go">{proof}</div>
              </div>
            ))}
          </div>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Magnet padding={60} magnetStrength={6}>
              <StarBorder as="a" href={RELEASES} theme="light" color={BRAND} radius={12} stars={2} sparkle className="cursor-target" backgroundColor={BRAND} textColor="#ffffff">
                <span className="px-2 text-[15px] font-semibold">Download for VS Code</span>
              </StarBorder>
            </Magnet>
            <Button href="https://open-vsx.org/extension/pranav-singh-devloper/flaglens">Open VSX</Button>
            <Button href="#demo">Watch the 2:33 demo</Button>
            <Button href={REPO}>View on GitHub</Button>
          </div>
          <p className="mt-4 text-[13px] text-muted">Free and MIT licensed · Toggle Wars 2026, Track 03: Build on Open Source Flagsmith</p>

          <Reveal delay={0.2}>
            <div className="mx-auto mt-12 max-w-5xl">
              <Window>
                <img src="/assets/hero.gif" alt="FlagLens greys out code that can't run, then previews flags as a beta tester: Production is off for everyone but on for this user, via the beta_testers segment" width={864} height={486} className="block h-auto w-full" />
              </Window>
            </div>
          </Reveal>

          <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 overflow-hidden rounded-2xl border border-line bg-white text-left shadow-sm md:grid-cols-4">
            {[
              { n: <><CountUp to={15050} separator="," duration={1.6} /> / 15,050</>, l: 'local evaluations match the live server' },
              { n: <><CountUp from={7} to={96} direction="down" duration={1.8} /> runs</>, l: 'instead of 96: a provably minimal test plan' },
              { n: <><CountUp to={192} duration={1.4} /> + <CountUp to={23} duration={1.4} /></>, l: 'unit and end-to-end tests, run in CI' },
              { n: <><CountUp to={62} duration={1.2} /> KB</>, l: 'zero runtime dependencies' },
            ].map((s, i) => (
              <div key={i} className={`p-5 ${i % 2 ? '' : 'border-r'} border-line md:border-r md:last:border-r-0 ${i < 2 ? 'border-b md:border-b-0' : ''}`}>
                <div className="text-[26px] font-extrabold tracking-tight tabular-nums">{s.n}</div>
                <div className="text-sm text-muted">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section id="features" className="pt-20">
          <Reveal>
            <h2 className="text-[clamp(28px,3.4vw,40px)] leading-tight font-extrabold tracking-tight">Answers you can trust, not guesses</h2>
            <p className="mt-3 max-w-2xl text-[17px] text-muted">
              A flag check hides the most important fact about the code below it: does it run, and for whom? The answer lives in a dashboard, spread across environments, segments, priorities and percentage splits. FlagLens brings it into the editor.
            </p>
          </Reveal>

          <div className="mt-14 space-y-24">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title}>
                <div className={`grid items-center gap-10 md:grid-cols-[1fr_1.25fr] ${i % 2 ? 'md:grid-cols-[1.25fr_1fr]' : ''}`}>
                  <div className={i % 2 ? 'md:order-2' : ''}>
                    <div className="mb-2 text-[13px] font-semibold tracking-wide text-brand uppercase">0{i + 1}</div>
                    <h3 className="text-[26px] font-bold tracking-tight">{f.title}</h3>
                    <p className="mt-3 text-[16px] leading-relaxed text-body">{f.body}</p>
                    <div className="mt-5 border-l-[3px] border-go bg-[#effaf3] py-2.5 pr-3 pl-4 text-[15px] text-ink">{f.proof}</div>
                  </div>
                  <Shot src={f.img} alt={f.alt} />
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="pt-28">
          <Reveal>
            <h2 className="text-[clamp(28px,3.4vw,40px)] leading-tight font-extrabold tracking-tight">And the essentials, done carefully</h2>
            <p className="mt-3 max-w-2xl text-[17px] text-muted">Live state above every flag, safe changes, drift between environments, typo detection and flag hygiene that works on open-source Flagsmith.</p>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {ESSENTIALS.map((e, i) => (
              <Reveal key={e.title} delay={i * 0.08}>
                <SpotlightCard theme="light" spotlightColor="rgba(106, 88, 240, 0.18)" className="cursor-target h-full overflow-hidden !p-0">
                  <img src={`/assets/screenshots/${e.img}.png`} alt={e.title} loading="lazy" className="block h-auto w-full border-b border-line" />
                  <div className="p-5">
                    <h4 className="text-[17px] font-bold">{e.title}</h4>
                    <p className="mt-1 text-[15px] text-muted">{e.body}</p>
                  </div>
                </SpotlightCard>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="demo" className="pt-28">
          <Reveal>
            <h2 className="text-[clamp(28px,3.4vw,40px)] leading-tight font-extrabold tracking-tight">See it in 2 minutes 33 seconds</h2>
            <p className="mt-3 max-w-2xl text-[17px] text-muted">
              Everything in the video is real: the released extension, driven by a script against a self-hosted Flagsmith started with one command. Also{' '}
              <a href="https://youtu.be/n9qszMKXoB4" className="cursor-target font-semibold text-brand hover:underline">
                on YouTube
              </a>
              , with captions and chapters.
            </p>
            <div className="mt-8">
              <Window>
                <video controls preload="none" poster="/assets/poster.jpg" playsInline className="block h-auto w-full">
                  <source src={VIDEO} type="video/mp4" />
                </video>
              </Window>
            </div>
            <p className="mt-3 text-[13px] text-muted">
              Can&apos;t play it here?{' '}
              <a href={VIDEO} className="cursor-target text-brand hover:underline">
                Download the MP4
              </a>{' '}
              (79 MB, 1080p60).
            </p>
          </Reveal>
        </section>

        <section id="start" className="pt-28">
          <Reveal>
            <h2 className="text-[clamp(28px,3.4vw,40px)] leading-tight font-extrabold tracking-tight">Running in five minutes</h2>
            <p className="mt-3 max-w-2xl text-[17px] text-muted">The dev kit starts the official open-source Flagsmith images in Docker and seeds a realistic demo project through Flagsmith&apos;s own REST API. No clicking.</p>
          </Reveal>
          <div className="mt-8 grid items-start gap-8 md:grid-cols-2">
            <Reveal>
              <pre className="relative overflow-x-auto rounded-2xl bg-[#11142a] p-6 font-mono text-[14px] leading-[1.9] text-[#d5d8e5] shadow-[0_20px_60px_rgba(17,20,42,0.25)]">
                <CopyButton />
                <span className="text-[#7a81a3]"># Docker, Node.js 22+, VS Code</span>
                {'\n'}
                <span className="text-[#2ecc71]">$</span> git clone https://github.com/Pranav-Singh-Devloper/flaglens.git{'\n'}
                <span className="text-[#2ecc71]">$</span> cd flaglens{'\n'}
                <span className="text-[#2ecc71]">$</span> make up <span className="text-[#7a81a3]">  # Flagsmith 2.295.2 on :8000</span>
                {'\n'}
                <span className="text-[#2ecc71]">$</span> make seed <span className="text-[#7a81a3]"># demo project, flags, segments</span>
                {'\n'}
                <span className="text-[#2ecc71]">$</span> make demo <span className="text-[#7a81a3]"># the demo shop on :3030</span>
              </pre>
            </Reveal>
            <Reveal delay={0.1}>
              <ol className="list-decimal space-y-3 pl-5 text-[16px] text-body marker:font-semibold marker:text-brand">
                <li>
                  Install the <code className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[14px]">.vsix</code> from{' '}
                  <a href={RELEASES} className="cursor-target text-brand hover:underline">
                    Releases
                  </a>
                  : Command Palette, <b>Extensions: Install from VSIX</b>.
                </li>
                <li>
                  Open <code className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[14px]">examples/demo-shop</code>. FlagLens finds the key the seed wrote and asks to connect.
                </li>
                <li>
                  Flags light up in <code className="rounded bg-brand-soft px-1.5 py-0.5 font-mono text-[14px]">server.mjs</code>. Click the status bar to switch environment or preview as a user.
                </li>
                <li>
                  Using your own Flagsmith? Run <b>FlagLens: Connect to Flagsmith</b> with your URL and an Organisation API key.
                </li>
              </ol>
            </Reveal>
          </div>
        </section>

        <section className="pt-28">
          <Reveal>
            <h2 className="text-[clamp(28px,3.4vw,40px)] leading-tight font-extrabold tracking-tight">Built on open-source Flagsmith</h2>
            <p className="mt-3 max-w-2xl text-[17px] text-muted">Remove Flagsmith and FlagLens does nothing: every badge, value and finding comes from the Flagsmith API.</p>
          </Reveal>
          <div className="mt-8 grid gap-x-10 gap-y-5 md:grid-cols-2">
            {[
              ['Self-hosted first.', 'Works against your own instance, with Flagsmith Cloud supported too.'],
              ["Flagsmith's own semantics.", 'Environment documents evaluated exactly as the server does, verified with transient identities.'],
              ['Fits the toolchain.', "Reads the Flagsmith CLI's flagsmith.json and finds flags like Flagsmith's Code References scanner."],
              ['Code References, published.', 'One command uploads every flag reference, so the Flagsmith dashboard links each flag to its files and lines.'],
              ['Feature Health in the editor.', 'When monitoring marks a flag unhealthy in Flagsmith, every reference shows it, and so does the confirmation.'],
              ['Real time, and editable.', 'Changes arrive through a signed Flagsmith webhook in a few seconds; segment and identity overrides are edited right next to the code.'],
              ['Dependencies and lifecycle.', "A flag that requires another is marked blocked where it can't serve; lifecycle stage and owners are in the hover."],
              ['Safe by default.', "API keys live in VS Code's SecretStorage; every write is confirmed and logged in Flagsmith's audit log."],
            ].map(([b, t], i) => (
              <Reveal key={b} delay={i * 0.06}>
                <div className="relative pl-5 text-[16px] text-body">
                  <span className="absolute top-2.5 left-0 h-2 w-2 rounded-[3px] bg-brand" />
                  <b className="text-ink">{b}</b> {t}
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="research" className="pt-28">
          <Reveal>
            <SpotlightCard theme="light" spotlightColor="rgba(46, 204, 113, 0.16)" className="!rounded-3xl !p-10">
              <div className="grid items-center gap-10 md:grid-cols-[1.4fr_1fr]">
                <div>
                  <div className="mb-4 inline-block rounded-full border border-[#d9d3ff] bg-brand-soft px-3.5 py-1 text-[13px] font-semibold text-brand">Research paper</div>
                  <h3 className="text-[24px] leading-snug font-bold tracking-tight">FlagLens: Exact, Server-Verified Reasoning about Feature Flags in the Editor</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-body">
                    How the engine port is tested against the server, why greying out is sound under three-valued logic, a soundness theorem for the targeting-rule check, and covering arrays for test plans, including a lower bound for one multi-valued flag among on/off flags.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Magnet padding={50} magnetStrength={6}>
                      <a href="/assets/flaglens-paper.pdf" className="cursor-target inline-flex rounded-xl bg-brand px-5 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-[#5b49e6]">
                        Read the paper (PDF)
                      </a>
                    </Magnet>
                    <Button href={`${REPO}/blob/main/docs/paper/flaglens.md`}>Read on GitHub</Button>
                  </div>
                </div>
                <p className="text-[14px] leading-relaxed text-muted">
                  Builds on firewall-policy anomaly analysis (Al-Shaer &amp; Hamed), FAME, Kleene&apos;s three-valued logic, abstract interpretation (Cousot &amp; Cousot), covering arrays (Katona; Kleitman &amp; Spencer), IPOG and simulated annealing for interaction testing, and studies of feature-toggle debt and automated cleanup at Uber and DoorDash. 27 references.
                </p>
              </div>
            </SpotlightCard>
          </Reveal>
        </section>

        <section id="architecture" className="pt-28">
          <Reveal>
            <h2 className="text-[clamp(28px,3.4vw,40px)] leading-tight font-extrabold tracking-tight">How it works, end to end</h2>
            <p className="mt-3 max-w-3xl text-[17px] text-muted">
              Pick a flow to watch it move through the editor and your self-hosted Flagsmith, or click any box for what it does, where the code is and which Flagsmith endpoints it uses.
            </p>
          </Reveal>
          <div className="mt-8">
            <Reveal>
              <Architecture />
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="mt-28 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-6 py-8 text-[14px] text-muted">
          <div>FlagLens is a community project, not an official Flagsmith product. MIT licence.</div>
          <div>
            Built by{' '}
            <a href="https://github.com/Pranav-Singh-Devloper" className="cursor-target text-brand hover:underline">
              Pranav Singh
            </a>{' '}
            for Toggle Wars 2026 ·{' '}
            <a href={REPO} className="cursor-target text-brand hover:underline">
              Source on GitHub
            </a>
          </div>
        </div>
      </footer>
    </ClickSpark>
  );
}
