# Trust Choreography

[![CI](https://github.com/Sebby1770/aws-trust-choreography/actions/workflows/ci.yml/badge.svg)](https://github.com/Sebby1770/aws-trust-choreography/actions/workflows/ci.yml)

An interactive cloud and enterprise-network architecture lab. Start from an AWS workload or a
network topology, make it your own, understand its trust boundaries, then rehearse failures and
packet paths before production does it for you. Built with vanilla HTML, CSS, and modern ES modules
— no framework and no runtime dependencies.

## What it does

The app opens in a project-first **Explore** workspace, with dedicated **AWS Studio**, **Network
Lab**, and **Rehearse** workspaces. AWS Studio and Network Lab use the full available viewport under
the compact navigation bar, so their canvases feel like focused diagramming applications instead
of sections embedded in a long page.

**Project Launchpad**

- A guided "create architecture" flow for naming a project, choosing its AWS region and lifecycle
  stage, and selecting a starting shape.
- A filterable blueprint gallery for serverless APIs, resilient web platforms, event pipelines,
  Claude RAG assistants, AI agent platforms, generative AI chatbots, or a blank canvas.
- Every choice opens directly in Flow Studio with the project metadata and service environments
  already applied.
- **Configure this project** and the top-level **AWS Studio** action both open the same full-screen
  editor at the top of the page.
- A responsive, editorial visual system with a live architecture preview, workload cost and
  recovery signals, and a clear compose → understand → rehearse → ship journey.

**Command Atlas**

- A rail · map · console layout: scenario rail, a dominant live service topology, and an
  **Operations console** whose dropdown switches between Incident inspector, Telemetry, Active
  runbook, Control posture, and Operating doctrine.
- A **Resilience Index** — a composite 0–100 score with an A–F grade, shown as a live ring gauge
  that blends route health, weakest node, fallback, durability, and recovery time (minus a
  blast-radius penalty) and recolours as the situation changes.
- Glowing service nodes for CloudFront, EKS, IAM, Aurora, Step Functions, Lambda, S3, EventBridge,
  and an SNS-backed manual lane, joined by animated trust-path packets and fallback routes.
- Scenario tabs — steady state, traffic surge, identity drift, recovery drill — that drive the
  topology, telemetry, runbooks, posture model, and operating doctrine.
- A **failure composer** that stacks faults (edge flood, identity breach, data lag, workflow
  backlog), recomputes service confidence scores, and classifies blast radius from _Contained_ to
  _Systemic_.
- **Make it your own** — an edit mode lets any visitor rename the atlas and its services and set
  their own confidence scores; the personalization persists in the browser, with a reset to
  defaults, and a "Copy a link to my version" command shares the whole tailored atlas as a URL.

**AWS Flow Studio** (full-screen)

- A topology-first architecture lab: click or drag services onto the canvas, move nodes, draw
  directional trust paths, auto-layout, undo / redo, focus the canvas, and open either side panel
  only when it is useful.
- **Guided mode** is the beginner-friendly default. It keeps the Add → Connect → Analyze journey
  visible, starts with the inspector collapsed, and opens intelligence contextually when a node or
  path is selected.
- **Pro mode** reveals named sessions, detailed score controls, status tools, JSON import, local
  save, and JSON / SVG / Terraform / Mermaid exports. The selected experience persists locally.
- **AI / LLM building blocks** — an "AI" library tab with Claude, ChatGPT, Foundation Model, AI
  Agent, Vector Database, Embeddings Model, and AI Guardrails nodes you can drop into an AWS
  architecture.
- **Starter templates** — Claude RAG assistant, AI agent platform, GenAI chatbot, plus Serverless
  API, Event pipeline, and Resilient web app.
- Live Architecture Intelligence scoring across security, reliability, observability, and recovery.
- Traffic and failure rehearsal for understanding affected paths before production.
- Multiple named sessions, each with its own locally auto-saved canvas, plus a rough monthly cost
  estimate. Terraform output is scaffolding with TODOs and must be reviewed before use.
- A searchable library of **862 official AWS architecture icons**, lazy-loaded so it never blocks
  first paint.

**Network Lab** (full-screen)

- A Packet Tracer-inspired, vendor-neutral editor with **20 devices** across networking, servers,
  endpoints, cloud, and security.
- Search and filter the device library, click to add, drag devices to arrange them, connect links,
  auto-layout, delete, and use undo / redo.
- Configure device name, IPv4 address, subnet, VLAN, status, and notes in the live inspector.
- Start from Small office, Three-tier data centre, Campus, Hybrid cloud, or Blank topologies.
- Choose any two devices and send a packet to visualize the reachable hop-by-hop path.
- Live educational checks for addressing, redundancy, security, and core services.
- Local autosave plus JSON import and export. On tablets and phones, the library and inspector
  become drawers while wide topologies scroll inside the canvas.

**Experience**

- **Command palette (⌘K)** — a keyboard-first launcher that fuzzy-matches across every action:
  switch scenarios, inject or clear faults, inspect any node, change theme, or copy a report.
- **Copy incident report** — generates a shareable Markdown summary (scenario, faults, telemetry,
  weakest node, recommendation, and a deep link) from the live state.
- **Shareable deep links** — the active scenario, injected faults, and selected node are encoded in
  the URL hash, so the share button copies a link that reopens the exact same view.
- **Theming** — light / dark / follow-system, persisted across visits.
- **Animated reveals** — a vanilla port of React Bits'
  [AnimatedContent](https://reactbits.dev/animations/animated-content): sections glide + fade into
  place on viewport entry (staggered, `prefers-reduced-motion`-aware, with a no-JS failsafe).
- **Accessibility** — skip link, keyboard-operable nodes, visible focus rings, and full
  `prefers-reduced-motion` support (the SVG choreography freezes when motion is reduced).
- Responsive page layouts for desktop, tablet, and mobile; wide diagrams intentionally scroll
  inside their canvases rather than forcing the whole page sideways.

## Data and simulation limits

This is a browser-local learning and design tool. It does not create an AWS account, provision
cloud resources, emulate Cisco IOS, or provide a shared collaboration backend. Architecture
intelligence, cost, and Network Lab readiness scores are heuristics rather than production audits.
The packet test follows the shortest available graph path while excluding offline devices; it does
not model physical ports, routing tables, ACLs, STP, VLAN enforcement, latency, protocol stacks, or
device CLI configuration.

## Getting started

```bash
npm ci           # install the locked dev toolchain (Node 20+)
npm run dev      # start the Vite dev server with hot reload
npm run build    # create a production build
```

Then open the printed local URL. Development serves the native source modules; the production build
bundles and minifies the app into `dist/client`.

## Scripts

| Script                | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Vite dev server with hot module reload                |
| `npm run build`       | Build the production site into `dist/`                |
| `npm test`            | Run the Vitest unit suite                             |
| `npm run test:watch`  | Run Vitest in watch mode                              |
| `npm run coverage`    | Run tests with a V8 coverage report                   |
| `npm run lint`        | Lint with ESLint                                      |
| `npm run lint:fix`    | Apply safe ESLint fixes                               |
| `npm run format`      | Format with Prettier (`format:check` to verify only)  |
| `npm run check`       | Lint + format check + tests (the CI gate)             |
| `npm run build:icons` | Regenerate the icon catalog from the AWS icon package |

## Project structure

```
src/
  main.js              app entry — boots the workspaces, lazy-loads AWS Flow Studio
  resilience-model.js  pure scenario/fault domain model (unit-tested)
  atlas.js             incident-command DOM controller
  flow-studio.js       AWS architecture canvas and domain state
  studio-shell.js      Guided/Pro experience and responsive panel controls
  network-lab.js       network canvas, scoring, persistence, and packet simulation
  ai-icons.js          Claude/ChatGPT/AI library nodes (unit-tested)
  personalize.js       per-visitor edit profile (unit-tested)
  views.js             Explore / AWS / Network / Rehearse workspace switcher
  console-deck.js      operations-console module dropdown
  theme.js             light/dark/system theme controller
  url-state.js         shareable URL-hash state (unit-tested)
  command-palette.js   ⌘K launcher + fuzzy ranking (unit-tested)
  incident-report.js   Markdown incident-report builder (unit-tested)
  animated-content.js  reveal-on-scroll engine (unit-tested)
  studio-sessions.js   multi-session store for Flow Studio (unit-tested)
  cost-model.js        rough monthly cost estimator (unit-tested)
  terraform-export.js  canvas → main.tf skeleton (unit-tested)
  mermaid-export.js    canvas → Mermaid flowchart (unit-tested)
  studio-extras.js     cost badge + TF/MMD toolbar wiring
  spotlight.js         pointer-tracked spotlight cards
  icon-catalog.js      lazy loader for the icon catalog chunk
studio-shell.css       full-viewport AWS editor shell and responsive drawers
network-lab.css        Network Lab visual system and responsive canvas
assets/ai-icons/       custom AI / LLM node SVGs
tests/                 Vitest unit and jsdom interaction suites
assets/aws-icons/      862 official AWS architecture SVGs + generated catalog
tools/                 icon-catalog generator
```

The resilience, packet-routing, scoring, session, and URL-state logic live in testable modules; see
`tests/`.

## Performance

The shell, Explore workspace, Rehearse atlas, and Network Lab load immediately. The heavier AWS Flow
Studio, session/export helpers, and official icon catalog are loaded lazily via dynamic `import()`
when the studio nears the viewport or the browser is idle.

## Deployment

Pushes to `main` are verified, built with Vite, and published from `dist/client` to GitHub Pages by
the [deploy workflow](.github/workflows/deploy.yml). Enable Pages with the **GitHub Actions** source
if it is not already on.

## Icons

The Flow Studio icon catalog is generated from the current
[AWS Architecture Icons package](https://aws.amazon.com/architecture/icons/) with
`npm run build:icons`.

See [CHANGELOG.md](CHANGELOG.md) for dated release notes.
