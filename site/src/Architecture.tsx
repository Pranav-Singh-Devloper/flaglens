// Interactive architecture: pick a flow to watch it step through the system, or click any box for its details
// (what it does, where the code is, which Flagsmith endpoints it uses).
import { useEffect, useMemo, useState } from "react";

type NodeId =
  | "scanner"
  | "ui"
  | "store"
  | "engine"
  | "analyses"
  | "commands"
  | "safety"
  | "realtime"
  | "client"
  | "api"
  | "tasks"
  | "pg"
  | "mcp"
  | "shop"
  | "seed"
  | "ci"
  | "mon";

interface Box {
  x: number;
  y: number;
  w: number;
  title: string;
  sub: string;
  lane: "editor" | "flagsmith" | "around";
  about: string;
  files: string[];
  flagsmith: string[];
  facts?: string[];
}

const H = 54;

const NODES: Record<NodeId, Box> = {
  scanner: {
    x: 32,
    y: 72,
    w: 176,
    title: "Scanner",
    sub: "Code References pattern",
    lane: "editor",
    about:
      "Finds flag keys in open files with the same pattern as Flagsmith's own Code References scanner, plus the JS client's getValue and the React SDK's useFlags. Results are cached by document version.",
    files: ["extension/src/core/scanner.ts", "extension/src/references.ts"],
    flagsmith: ["Flagsmith/ci Code References pattern"],
    facts: [
      "JavaScript, TypeScript, Python, Go, Java, Kotlin, C#, Dart and Ruby",
    ],
  },
  ui: {
    x: 216,
    y: 72,
    w: 360,
    title: "Editor UI",
    sub: "CodeLens · hover · diagnostics · greying · tree · matrix",
    lane: "editor",
    about:
      "Everything you see: live state above every flag, hover cards, problems and quick fixes, greyed-out code, the sidebar tree, the Environment Matrix webview and the status bar (environment, previewed user, real-time indicator).",
    files: [
      "extension/src/providers/*",
      "extension/src/views/*",
      "extension/src/present.ts",
    ],
    flagsmith: [],
    facts: ["Redraws only what changed", "Strict CSP webview"],
  },
  store: {
    x: 32,
    y: 192,
    w: 176,
    title: "Flag store",
    sub: "refresh · change detection",
    lane: "editor",
    about:
      "Holds the feature × environment matrix, environment documents, Feature Health events and dependencies. Refreshes on a timer (10 s, or 30 s while the webhook is live) and on every webhook event; keeps the last known data when Flagsmith is unreachable and backs off.",
    files: ["extension/src/store/flagStore.ts", "extension/src/core/model.ts"],
    flagsmith: [
      "GET /projects/{id}/features/?environment=",
      "GET /environments/{key}/featurestates/",
      "GET /environments/{key}/document/",
      "GET /projects/{id}/feature-health/events/",
      "GET /environments/{key}/experiments/",
    ],
  },
  engine: {
    x: 216,
    y: 192,
    w: 176,
    title: "Local engine",
    sub: "Flagsmith's rules, ported",
    lane: "editor",
    about:
      "A TypeScript port of Flagsmith's open-source evaluation engine, run on the environment document: md5 percentage buckets, segment priorities, all 14 rule operators with Flagsmith's type casting, multivariate splits, identity overrides, and flag dependencies in two passes.",
    files: [
      "extension/src/core/engine.ts",
      "extension/scripts/verify-engine.mjs",
    ],
    flagsmith: [
      "Environment document",
      "Transient identities (POST /identities/) for verification",
    ],
    facts: ["15,050 of 15,050 results match the live server"],
  },
  analyses: {
    x: 400,
    y: 192,
    w: 176,
    title: "Analyses",
    sub: "dead code · rules · tests",
    lane: "editor",
    about:
      "Dead code under Kleene's three-valued logic (never greys code that might run), the targeting-rule check over trait equivalence classes (shadowed, redundant, matches nobody), and covering arrays for the smallest pairwise test plan.",
    files: [
      "extension/src/core/deadcode.ts",
      "extension/src/core/rules.ts",
      "extension/src/core/pairwise.ts",
    ],
    flagsmith: [
      "Segments, overrides and priorities from the environment documents",
    ],
    facts: [
      "96 combinations → 7 runs, provably minimal",
      "Every rule finding holds for every possible user",
    ],
  },
  commands: {
    x: 32,
    y: 312,
    w: 176,
    title: "Commands",
    sub: "toggles · overrides",
    lane: "editor",
    about:
      "Toggle, set value, create flag, set a flag for the previewed user, edit segment overrides, publish code references, preview as a user, check rules, test plans, diff, history.",
    files: ["extension/src/commands/*"],
    flagsmith: [
      "POST /projects/{id}/features/",
      "POST /projects/{id}/code-references/",
      "GET /environments/{key}/trait-keys/",
    ],
  },
  safety: {
    x: 216,
    y: 312,
    w: 176,
    title: "Safety",
    sub: "confirm · typed · undo",
    lane: "editor",
    about:
      "Every write is confirmed and says who it affects. Protected environments (prod|live|main) need the flag name typed. Feature Health alerts and unmet dependencies are repeated in the confirmation. Undo, and a journal of every change.",
    files: ["extension/src/safety.ts"],
    flagsmith: ["Flagsmith's audit log records every write too"],
  },
  realtime: {
    x: 400,
    y: 312,
    w: 176,
    title: "Real-time listener",
    sub: "signed webhook",
    lane: "editor",
    about:
      "A small HTTP listener on a random port and a random 128-bit path. Flagsmith calls it for every change; each call must carry a valid HMAC-SHA256 signature (checked in constant time) and only triggers a refresh. The webhook is removed when the window closes; stale ones from crashed windows are cleaned up.",
    files: ["extension/src/realtime.ts", "extension/src/core/webhook.ts"],
    flagsmith: [
      "POST / DELETE /organisations/{id}/webhooks/",
      "X-Flagsmith-Signature",
      "FLAG_UPDATED, AUDIT_LOG_CREATED",
    ],
    facts: ["About two seconds from a change anywhere to the editor"],
  },
  client: {
    x: 32,
    y: 432,
    w: 544,
    title: "API client",
    sub: "fetch · Api-Key · pagination · timeouts · retries · typed errors",
    lane: "editor",
    about:
      "One typed client for the Management API using Node's global fetch: no runtime dependencies. Handles both paginated and plain-array answers, internal hostnames in next links, timeouts and error mapping. The Organisation API key lives only in VS Code SecretStorage.",
    files: ["extension/src/api/client.ts", "extension/src/api/types.ts"],
    flagsmith: ["Authorization: Api-Key <Organisation key>"],
    facts: ["Zero runtime dependencies; the whole extension is 62 KB"],
  },
  api: {
    x: 690,
    y: 72,
    w: 380,
    title: "Flagsmith REST API :8000",
    sub: "Management API · SDK API · /api/v1",
    lane: "flagsmith",
    about:
      "The official open-source Flagsmith 2.295.2 image, started by make up. FlagLens uses flags, feature states, environment documents, segments and segment overrides, identities and identity overrides, v2 feature versions, organisation webhooks, Code References, Feature Health, lifecycle, trait keys and experiments.",
    files: ["devkit/compose.yaml"],
    flagsmith: [
      "flagsmith/flagsmith:2.295.2 (serve)",
      "SSRF_ALLOWED_HOSTS=host.docker.internal",
    ],
  },
  tasks: {
    x: 690,
    y: 192,
    w: 180,
    title: "Task processor",
    sub: "sends the webhooks",
    lane: "flagsmith",
    about:
      "Flagsmith's background worker. It delivers webhooks (to FlagLens's listener through host.docker.internal) and other asynchronous work such as enabling v2 versioning.",
    files: ["devkit/compose.yaml"],
    flagsmith: ["flagsmith/flagsmith:2.295.2 (run-task-processor)"],
  },
  pg: {
    x: 890,
    y: 192,
    w: 180,
    title: "Postgres",
    sub: "flags, audit log, events",
    lane: "flagsmith",
    about:
      "Flagsmith stores everything here, including analytics for Experiments (beta), which the dev kit turns on.",
    files: ["devkit/compose.yaml"],
    flagsmith: ["postgres:15.5-alpine"],
  },
  mcp: {
    x: 690,
    y: 312,
    w: 380,
    title: "Flagsmith MCP server (optional)",
    sub: "make mcp · :8002",
    lane: "flagsmith",
    about:
      "Flagsmith's official MCP server, pointed at the self-hosted instance, so AI assistants can read and change the same flags.",
    files: ["devkit/compose.yaml (profile mcp)"],
    flagsmith: ["flagsmith/flagsmith-mcp"],
  },
  shop: {
    x: 680,
    y: 452,
    w: 92,
    title: "Demo shop",
    sub: "Node SDK",
    lane: "around",
    about:
      "A small shop that reads its banner, checkout and button colour from self-hosted Flagsmith with the official Node SDK and per-visitor identities, so a toggle in VS Code is visible on the next request.",
    files: ["examples/demo-shop/server.mjs"],
    flagsmith: ["@flagsmith/nodejs", "SDK API with environment keys"],
  },
  seed: {
    x: 780,
    y: 452,
    w: 92,
    title: "Seed",
    sub: "REST only",
    lane: "around",
    about:
      "make seed bootstraps everything through the public REST API: admin, organisation, project, 3 environments, 7 flags, 6 segments with overrides, an API key and a Feature Health provider. Idempotent; CI runs it twice.",
    files: ["devkit/seed.mjs", "devkit/seed-data.json"],
    flagsmith: [
      "signup → organisation → project → environments → flags → segments → API key",
      "POST /projects/{id}/feature-health/providers/",
    ],
  },
  ci: {
    x: 880,
    y: 452,
    w: 92,
    title: "CI",
    sub: "code-refs",
    lane: "around",
    about:
      "make code-refs publishes every flag reference in the repository, the same upload the editor command does, for a CI job.",
    files: ["extension/scripts/publish-code-references.mjs"],
    flagsmith: ["POST /projects/{id}/code-references/"],
  },
  mon: {
    x: 980,
    y: 452,
    w: 92,
    title: "Monitoring",
    sub: "Feature Health",
    lane: "around",
    about:
      "Any monitoring tool (Grafana, Alertmanager) can mark a flag unhealthy through the Feature Health webhook. make alert and make recover simulate it.",
    files: ["devkit/health.mjs"],
    flagsmith: ["Feature Health Webhook provider"],
  },
};

type EdgeId = `${NodeId}>${NodeId}`;
const EDGES: EdgeId[] = [
  "scanner>ui",
  "store>ui",
  "store>engine",
  "engine>analyses",
  "analyses>ui",
  "store>client",
  "ui>commands",
  "commands>safety",
  "safety>client",
  "client>api",
  "api>tasks",
  "api>pg",
  "tasks>realtime",
  "realtime>store",
  "realtime>client",
  "shop>api",
  "seed>api",
  "ci>api",
  "mon>api",
  "mcp>api",
  "commands>client",
  "scanner>commands",
];

interface Step {
  nodes: NodeId[];
  edges: EdgeId[];
  text: string;
}
interface Flow {
  id: string;
  label: string;
  steps: Step[];
}

const FLOWS: Flow[] = [
  {
    id: "read",
    label: "Read loop",
    steps: [
      {
        nodes: ["store", "client"],
        edges: ["store>client"],
        text: "The flag store refreshes: on a timer (every 10 s, or 30 s while real time is on) and on every webhook event.",
      },
      {
        nodes: ["client", "api"],
        edges: ["client>api"],
        text: "N + 1 requests with the Organisation API key: flags (with lifecycle, owners, code-reference counts), each environment's feature states and environment document, Feature Health events.",
      },
      {
        nodes: ["store", "engine", "analyses"],
        edges: ["store>engine", "engine>analyses"],
        text: "The documents are evaluated locally. Facts that hold for everyone feed greying; the rule check runs over every segment override.",
      },
      {
        nodes: ["scanner", "analyses", "store", "ui"],
        edges: ["scanner>ui", "analyses>ui", "store>ui"],
        text: "Only what changed is redrawn: CodeLens, hovers, diagnostics, greyed code, tree and matrix.",
      },
    ],
  },
  {
    id: "preview",
    label: "Preview as a user",
    steps: [
      {
        nodes: ["ui", "commands"],
        edges: ["ui>commands"],
        text: "Pick a test user in the status bar: one of flaglens.personas, or an identifier and traits, with trait suggestions from the segment rules and Flagsmith's stored trait keys.",
      },
      {
        nodes: ["store", "engine"],
        edges: ["store>engine"],
        text: "Flagsmith's own rules, run locally on the environment document: md5 buckets mod 9999, segment priorities, 14 operators, identity overrides, dependencies in two passes. No request per user.",
      },
      {
        nodes: ["engine", "analyses", "ui"],
        edges: ["engine>analyses", "analyses>ui"],
        text: "Every CodeLens, hover and greyed line now shows what this user gets, and which segment, bucket or override decided.",
      },
      {
        nodes: ["engine", "api"],
        edges: [],
        text: "Trust, but verify: make verify-engine compares the engine with the live server through transient identities. 15,050 of 15,050 agree.",
      },
    ],
  },
  {
    id: "write",
    label: "A safe write",
    steps: [
      {
        nodes: ["ui", "commands"],
        edges: ["ui>commands"],
        text: "Click Turn off in a CodeLens, Set for this user in a hover, or Segment overrides…",
      },
      {
        nodes: ["commands", "safety"],
        edges: ["commands>safety"],
        text: "A confirmation that names who is affected. Protected environments need the flag name typed. Feature Health alerts and unmet dependencies are repeated here.",
      },
      {
        nodes: ["safety", "client", "api"],
        edges: ["safety>client", "client>api"],
        text: "One Flagsmith write: PATCH the feature state; in a v2-versioned environment, POST a version and publish it; or the identity / segment override endpoints.",
      },
      {
        nodes: ["api", "pg", "store", "ui"],
        edges: ["api>pg", "store>ui"],
        text: "Stored and in Flagsmith's audit log. The editor refreshes, the rule check re-runs, and Undo is one click away.",
      },
    ],
  },
  {
    id: "realtime",
    label: "Real time",
    steps: [
      {
        nodes: ["realtime", "client", "api"],
        edges: ["realtime>client", "client>api"],
        text: "On connect FlagLens opens a listener on a random port and path, and registers an organisation webhook with a random secret.",
      },
      {
        nodes: ["api", "tasks"],
        edges: ["api>tasks"],
        text: "Someone changes a flag anywhere: the dashboard, the API, a teammate. Flagsmith queues the webhook.",
      },
      {
        nodes: ["tasks", "realtime"],
        edges: ["tasks>realtime"],
        text: "The task processor POSTs to the editor through host.docker.internal. The HMAC-SHA256 signature is checked in constant time.",
      },
      {
        nodes: ["realtime", "store", "ui"],
        edges: ["realtime>store", "store>ui"],
        text: "A refresh, and the editor shows the change: about two seconds end to end. Polling stays as the fallback.",
      },
    ],
  },
  {
    id: "health",
    label: "Feature Health",
    steps: [
      {
        nodes: ["mon", "api"],
        edges: ["mon>api"],
        text: "Monitoring reports new_checkout unhealthy in Production through the Feature Health webhook (make alert).",
      },
      {
        nodes: ["api", "pg"],
        edges: ["api>pg"],
        text: "Flagsmith records the event, with its reason and links.",
      },
      {
        nodes: ["store", "client", "api"],
        edges: ["store>client", "client>api"],
        text: "FlagLens reads the latest event per flag and environment on its next refresh.",
      },
      {
        nodes: ["ui", "safety"],
        edges: ["store>ui"],
        text: "An unhealthy badge at every reference, the reason in the hover, and a warning in the confirmation before anyone toggles it.",
      },
    ],
  },
  {
    id: "refs",
    label: "Code References",
    steps: [
      {
        nodes: ["scanner", "commands"],
        edges: ["scanner>commands"],
        text: "The workspace is scanned with Flagsmith's Code References pattern; only keys of real flags are kept.",
      },
      {
        nodes: ["commands", "client", "api"],
        edges: ["commands>client", "client>api"],
        text: "After a confirmation: POST /projects/{id}/code-references/ with the GitHub repository, the commit and every file and line.",
      },
      {
        nodes: ["ci", "api"],
        edges: ["ci>api"],
        text: "Or from CI with make code-refs.",
      },
      {
        nodes: ["api", "store", "ui"],
        edges: ["store>ui"],
        text: "The dashboard links each flag to its lines and moves it from new to live; the counts and lifecycle come back to the hover.",
      },
    ],
  },
  {
    id: "devkit",
    label: "Dev kit",
    steps: [
      {
        nodes: ["api", "tasks", "pg"],
        edges: ["api>tasks", "api>pg"],
        text: "make up: the official Flagsmith 2.295.2 images, pinned, with a health check so it returns when Flagsmith is ready.",
      },
      {
        nodes: ["seed", "api"],
        edges: ["seed>api"],
        text: "make seed: a realistic demo through the public REST API only. Idempotent: it restores every flag to its declared state.",
      },
      {
        nodes: ["shop", "api"],
        edges: ["shop>api"],
        text: "make demo: a shop that reads its flags with the official Node SDK, so a toggle in the editor shows up on the next request.",
      },
      {
        nodes: ["mcp", "api"],
        edges: ["mcp>api"],
        text: "make mcp: Flagsmith's MCP server on the same instance, for AI assistants.",
      },
    ],
  },
];

const center = (n: Box) => ({ x: n.x + n.w / 2, y: n.y + H / 2 });

export default function Architecture() {
  const [flowId, setFlowId] = useState("read");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [picked, setPicked] = useState<NodeId | null>(null);
  const flow = FLOWS.find((f) => f.id === flowId)!;
  const current = flow.steps[step]!;

  useEffect(() => {
    if (!playing || picked) return;
    const t = setTimeout(() => {
      if (step < flow.steps.length - 1) setStep(step + 1);
      else {
        const i = FLOWS.findIndex((f) => f.id === flowId);
        setFlowId(FLOWS[(i + 1) % FLOWS.length]!.id);
        setStep(0);
      }
    }, 3600);
    return () => clearTimeout(t);
  }, [playing, picked, step, flowId, flow.steps.length]);

  const activeNodes = useMemo(
    () => new Set<NodeId>(picked ? [picked] : current.nodes),
    [picked, current],
  );
  const activeEdges = useMemo(() => {
    if (!picked) return new Set(current.edges);
    return new Set(EDGES.filter((e) => e.split(">").includes(picked)));
  }, [picked, current]);

  const chooseFlow = (id: string) => {
    setFlowId(id);
    setStep(0);
    setPicked(null);
  };
  const detail = picked ? NODES[picked] : null;

  return (
    <div className="rounded-3xl border border-line bg-white p-5 shadow-[0_1px_0_rgba(14,17,36,0.04)] md:p-8">
      <div className="flex flex-wrap gap-2">
        {FLOWS.map((f) => (
          <button
            key={f.id}
            onClick={() => chooseFlow(f.id)}
            className={`cursor-target rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold transition ${
              f.id === flowId && !picked
                ? "border-brand bg-brand text-white"
                : "border-line bg-paper text-body hover:border-brand hover:text-brand"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5">
        <div className="-mx-2 overflow-x-auto px-2">
          <svg
            viewBox="0 0 1100 530"
            className="w-full min-w-[760px] select-none"
            role="img"
            aria-label="FlagLens architecture diagram"
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="#6a58f0" />
              </marker>
            </defs>
            {/* lanes */}
            <rect
              x="20"
              y="20"
              width="570"
              height="490"
              rx="18"
              fill="#f6f5ff"
              stroke="#e3defe"
            />
            <text
              x="40"
              y="50"
              className="fill-[#6a58f0] text-[15px] font-bold"
            >
              VS Code + FlagLens
            </text>
            <text x="196" y="50" className="fill-[#6b7186] text-[13px]">
              zero runtime dependencies · 62 KB
            </text>
            <rect
              x="670"
              y="20"
              width="420"
              height="370"
              rx="18"
              fill="#effaf3"
              stroke="#cdeedb"
            />
            <text
              x="690"
              y="50"
              className="fill-[#12a150] text-[15px] font-bold"
            >
              Self-hosted Flagsmith 2.295.2
            </text>
            <text x="925" y="50" className="fill-[#6b7186] text-[13px]">
              make up
            </text>
            <rect
              x="670"
              y="410"
              width="420"
              height="100"
              rx="18"
              fill="#fbfbfe"
              stroke="#e6e7f0"
            />
            <text
              x="690"
              y="438"
              className="fill-[#6b7186] text-[13px] font-bold"
            >
              AROUND IT
            </text>

            {/* edges */}
            {EDGES.map((id) => {
              const [a, b] = id.split(">") as [NodeId, NodeId];
              const p = center(NODES[a]);
              const q = center(NODES[b]);
              const on = activeEdges.has(id);
              return (
                <line
                  key={id}
                  x1={p.x}
                  y1={p.y}
                  x2={q.x}
                  y2={q.y}
                  stroke={on ? "#6a58f0" : "#d8dae6"}
                  strokeWidth={on ? 3 : 1.5}
                  strokeDasharray={on ? "8 7" : undefined}
                  className={on ? "arch-flow" : ""}
                />
              );
            })}

            {/* nodes */}
            {(Object.entries(NODES) as [NodeId, Box][]).map(([id, n]) => {
              const on = activeNodes.has(id);
              const green = n.lane === "flagsmith";
              return (
                <g
                  key={id}
                  onClick={() => setPicked(picked === id ? null : id)}
                  className="cursor-target cursor-pointer"
                >
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={H}
                    rx="12"
                    fill={on ? (green ? "#e3f7ea" : "#efecff") : "#ffffff"}
                    stroke={on ? (green ? "#12a150" : "#6a58f0") : "#e0e2ec"}
                    strokeWidth={on ? 2.5 : 1.2}
                    style={{
                      transition: "all .35s ease",
                      filter: on
                        ? "drop-shadow(0 6px 14px rgba(106,88,240,.22))"
                        : undefined,
                    }}
                  />
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + 23}
                    textAnchor="middle"
                    className="fill-[#0e1124] text-[16px] font-bold"
                  >
                    {n.title}
                  </text>
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + 41}
                    textAnchor="middle"
                    className="fill-[#6b7186] text-[12px]"
                  >
                    {n.sub}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="flex min-h-[230px] flex-col rounded-2xl border border-line bg-paper p-5">
          {detail ? (
            <>
              <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">
                {detail.lane === "editor"
                  ? "In the extension"
                  : detail.lane === "flagsmith"
                    ? "Self-hosted Flagsmith"
                    : "Around it"}
              </div>
              <h3 className="mt-1 text-[20px] font-bold tracking-tight">
                {detail.title}
              </h3>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-body">
                {detail.about}
              </p>
              {detail.facts?.map((f) => (
                <div
                  key={f}
                  className="mt-3 rounded-lg bg-[#e9f8ef] px-3 py-2 text-[13.5px] font-semibold text-go"
                >
                  {f}
                </div>
              ))}
              {detail.flagsmith.length > 0 && (
                <>
                  <div className="mt-4 text-[12px] font-semibold tracking-wide text-muted uppercase">
                    Flagsmith
                  </div>
                  <ul className="mt-1 space-y-1">
                    {detail.flagsmith.map((f) => (
                      <li key={f} className="font-mono text-[12.5px] text-ink">
                        {f}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="mt-4 text-[12px] font-semibold tracking-wide text-muted uppercase">
                Code
              </div>
              <ul className="mt-1 space-y-1">
                {detail.files.map((f) => (
                  <li key={f} className="font-mono text-[12.5px] text-brand">
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setPicked(null)}
                className="cursor-target mt-auto self-start pt-5 text-[14px] font-semibold text-brand hover:underline"
              >
                ← Back to the {flow.label.toLowerCase()} flow
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">
                  {flow.label} · step {step + 1} of {flow.steps.length}
                </div>
                <div className="flex gap-1.5">
                  <button
                    aria-label="Previous step"
                    onClick={() => setStep(Math.max(0, step - 1))}
                    className="cursor-target rounded-lg border border-line bg-white px-2.5 py-1 text-[13px] hover:border-brand"
                  >
                    ←
                  </button>
                  <button
                    aria-label={playing ? "Pause" : "Play"}
                    onClick={() => setPlaying(!playing)}
                    className="cursor-target rounded-lg border border-line bg-white px-2.5 py-1 text-[13px] hover:border-brand"
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button
                    aria-label="Next step"
                    onClick={() =>
                      setStep(Math.min(flow.steps.length - 1, step + 1))
                    }
                    className="cursor-target rounded-lg border border-line bg-white px-2.5 py-1 text-[13px] hover:border-brand"
                  >
                    →
                  </button>
                </div>
              </div>
              <ol className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                {flow.steps.map((s, i) => (
                  <li
                    key={i}
                    onClick={() => setStep(i)}
                    className={`cursor-target flex cursor-pointer gap-3 rounded-xl p-2.5 text-[14px] leading-relaxed transition ${i === step ? "bg-white text-ink shadow-sm ring-1 ring-[#d9d3ff]" : "text-muted hover:text-body"}`}
                  >
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${i === step ? "bg-brand text-white" : "bg-line text-muted"}`}
                    >
                      {i + 1}
                    </span>
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto pt-4 text-[13px] text-muted">
                Click any box for its details, code and Flagsmith endpoints.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
