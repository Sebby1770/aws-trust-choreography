# Trust Choreography

[![CI](https://github.com/Sebby1770/aws-trust-choreography/actions/workflows/ci.yml/badge.svg)](https://github.com/Sebby1770/aws-trust-choreography/actions/workflows/ci.yml)

An interactive cloud and enterprise-network architecture lab. Start from an AWS workload or a
network topology, make it your own, understand its trust boundaries, then rehearse failures and
packet paths before production does it for you. Built with vanilla HTML, CSS, and modern ES modules
— no framework and no runtime dependencies.

## What it does

The app opens in a project-first **Explore** workspace, with dedicated **AWS Studio**, **Network
Lab**, and **Review** workspaces. AWS Studio and Network Lab use the full available viewport under
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

**Review Center**

- Reviews the live AWS architecture and Network Lab topology instead of a fixed demo.
- Produces an explainable readiness verdict across security, reliability, observability, recovery,
  addressing, redundancy, and core network services.
- Prioritises findings as **Must fix**, **Improve**, or **Passed**, with Guided and Evidence modes.
- **Fix in Studio** actions open the correct editor and select the affected path, service, field,
  or pre-filtered library result.
- An Architecture Passport captures diagram counts, checks passed, open priorities, and the rough
  planning estimate, with Markdown and JSON downloads.
- Blank labs are excluded from the combined score so unused workspaces cannot dilute real work.
- The Review Center is diagram guidance, not a live AWS-account audit or certification.

**AWS Flow Studio** (full-screen)

- A topology-first architecture lab: click or drag services onto the canvas, move nodes, draw
  directional trust paths, auto-layout, undo / redo, focus the canvas, and open either side panel
  only when it is useful.
- **Guided mode** is the beginner-friendly default. It keeps the Add → Connect → Analyze journey
  visible, starts with the inspector collapsed, and opens intelligence contextually when a node or
  path is selected.
- **Pro mode** reveals named sessions, detailed score controls, status tools, JSON import, local
  save, and JSON / SVG / Terraform / Mermaid exports. The selected experience persists locally.
- **Import infrastructure as code** — paste (or drop) a Terraform `.tf` file or a CloudFormation
  JSON template and it becomes a live diagram: services are drawn, plumbing is hidden, references
  become directional trust paths, and plaintext listeners arrive already flagged as unencrypted.
  A preview shows exactly what will be drawn before it replaces the canvas. Everything is parsed
  in the browser — nothing is uploaded and no AWS account is contacted.
- **Trust zones** — every service sits in a zone (internet, edge, public subnet, private subnet,
  data tier, management), editable per node. Imported stacks derive their zone from real VPC and
  subnet placement: compute in a subnet routing to an internet gateway is public, everything else
  in the VPC is private, and an `internal = true` load balancer is not a public entry point.
- **Boundary analysis** — a path between zones is a trust boundary crossing. The review reports
  plaintext on a boundary, a datastore answering the internet, untrusted traffic reaching internal
  compute unmediated, outbound paths from the data tier, and edge protection that is present but
  not actually on the traffic path. Crossings are drawn on the canvas, not just listed.
- **AI / LLM building blocks** — an "AI" library tab with Claude, ChatGPT, Foundation Model, AI
  Agent, Vector Database, Embeddings Model, and AI Guardrails nodes you can drop into an AWS
  architecture.
- **Starter templates** — Claude RAG assistant, AI agent platform, GenAI chatbot, plus Serverless
  API, Event pipeline, and Resilient web app.
- Live Architecture Intelligence scoring across security, reliability, observability, and recovery.
- **A paper canvas built for large architectures** — the diagram sits on a white 2400 x 1500
  surface that genuinely zooms (Fit, then 25%-200%) and scrolls, with compact nodes so a real
  system fits on screen. Fit frames your diagram rather than the empty canvas, and SVG export
  matches the same white palette so exported diagrams drop straight into a README.
- **Canvas-first chrome** — the workspace switcher is a dropdown next to the wordmark, and the
  icon library and insights inspector share one slide-over drawer opened by **Panels** at the far
  end of the header. What used to be five stacked strips above the canvas plus two fixed side
  columns is now a single slim toolbar over a full-width canvas.
- **Chaos Lab** — a third inspector tab that turns the canvas into a resilience analysis: an
  estimated end-to-end availability headline (with nines and projected downtime per year),
  **single points of failure** found as graph articulation points (ranked by how many nodes they
  strand, weighted by criticality), per-flow availability with **independent route counts**,
  a **blast radius** ranking, and plain-English recommendations. "Kill selected node" rehearses a
  real outage against the live topology and reports whether the architecture stays _resilient_,
  goes _degraded_, or hits a full _outage_.

- Traffic and failure rehearsal for understanding affected paths before production.
- Multiple named sessions, each with its own locally auto-saved canvas, plus a rough monthly cost
  estimate. Terraform output is scaffolding with TODOs and must be reviewed before use.- A searchable library of **862 official AWS architecture icons**, lazy-loaded so it never blocks
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

- **Command palette (⌘K)** — a keyboard-first launcher for moving between workspaces, changing the
  theme, refreshing Review, and copying or downloading the current design report.
- **Portable review reports** — copy a plain-English Markdown summary or download Markdown and JSON
  versions of the current readiness evidence.
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

The infrastructure-as-code importer reads the diagram implied by your code — it does not run
`terraform plan`, resolve state, or contact AWS. Modules are not expanded, `count` / `for_each`
resources are drawn once rather than fanned out, and only AWS resources are drawn; each of these is
reported as a warning on the import preview rather than silently guessed at. CloudFormation support
covers JSON templates (convert YAML with `cfn-flip` first).

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
  flow-studio.js       AWS architecture canvas and domain state
  aws-review-model.js  pure, explainable AWS readiness rules
  studio-shell.js      Guided/Pro experience and responsive panel controls
  network-lab.js       network canvas, scoring, persistence, and packet simulation
  review-center.js     combined review model, report builder, and DOM controller
  ai-icons.js          Claude/ChatGPT/AI library nodes (unit-tested)
  personalize.js       per-visitor edit profile (unit-tested)
  views.js             Explore / AWS / Network / Review workspace switcher
  theme.js             light/dark/system theme controller
  command-palette.js   ⌘K launcher + fuzzy ranking (unit-tested)
  workspace-commands.js navigation, theme, and Review commands
  animated-content.js  reveal-on-scroll engine (unit-tested)
  studio-sessions.js   multi-session store for Flow Studio (unit-tested)
  cost-model.js        rough monthly cost estimator (unit-tested)
  terraform-export.js  canvas → main.tf skeleton (unit-tested)
  mermaid-export.js    canvas → Mermaid flowchart (unit-tested)
  svg-export.js        canvas → white-background SVG diagram (unit-tested)
  canvas-focus.js      canvas-first layout: workspace dropdown + panel drawer (unit-tested)
  trust-zones.js       trust zones, boundary crossings, threat model (unit-tested)
  iac-import.js        Terraform/CloudFormation → canvas (unit-tested)
  iac-service-map.js   IaC resource type → AWS service tables
  iac-import-ui.js     import dialog wiring (unit-tested)
  studio-extras.js     cost badge + TF/MMD toolbar wiring
  spotlight.js         pointer-tracked spotlight cards
  icon-catalog.js      lazy loader for the icon catalog chunk
studio-shell.css       full-viewport AWS editor shell and responsive drawers
network-lab.css        Network Lab visual system and responsive canvas
review-center.css      Review Center visual system and responsive report layout
assets/ai-icons/       custom AI / LLM node SVGs
tests/                 Vitest unit and jsdom interaction suites
assets/aws-icons/      862 official AWS architecture SVGs + generated catalog
tools/                 icon-catalog generator
```

The resilience, packet-routing, scoring, session, and URL-state logic live in testable modules; see
`tests/`.

## Performance

The shell, Explore workspace, Review Center, and Network Lab load immediately. The heavier AWS Flow
Studio, session/export helpers, and official icon catalog are loaded lazily via dynamic `import()`
when the studio nears the viewport, Review opens, or the browser is idle.

## Deployment

Pushes to `main` are verified, built with Vite, and published from `dist/client` to GitHub Pages by
the [deploy workflow](.github/workflows/deploy.yml). Enable Pages with the **GitHub Actions** source
if it is not already on.

## Icons

The Flow Studio icon catalog is generated from the current
[AWS Architecture Icons package](https://aws.amazon.com/architecture/icons/) with
`npm run build:icons`.

See [CHANGELOG.md](CHANGELOG.md) for dated release notes.
