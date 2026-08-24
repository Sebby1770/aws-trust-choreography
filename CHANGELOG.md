# Changelog

All notable changes to this project are documented here.

## 2026-08-24 — Nothing but the canvas, in both labs

### Changed

- **Every remaining strip of chrome now lives in the drawer.** The toolbar, architecture name,
  templates, Guided/Pro/Help, the cost estimate, the simulation controls and the status bar are
  reached from a new **Tools** tab beside Library and Insights. Chrome above the canvas went from
  105px to 1px — the lab is the drawing surface and nothing else.
- **The Network Lab gets the same treatment**: same dropdown, same Panels drawer, same three
  tabs, and the same white paper canvas, node cards and zone bands as the AWS studio. The two
  labs are now described by one config in `canvas-focus.js` rather than two implementations.
- The chrome is **relocated at runtime, not duplicated or rebuilt**, so every control in the
  drawer is the same element the labs already wired up — a listener attached before the move
  still fires after it.

### Fixed

- `document.ownerDocument` is null, so building the drawer against the document threw and left
  both labs without panels.
- `.app-shell[data-active-view] .flow-studio` sets the lab layout at a higher specificity than a
  plain `.flow-studio.is-canvas-focus`, so the canvas-only layout was being ignored and left a
  68px band of shell background under the canvas.

## 2026-08-24 — Canvas-first studio

### Changed

- **The studio is the canvas now.** It previously stacked five strips above the drawing surface
  (title, meta, toolbar, guided steps, architecture bar) and pinned a library column and an
  inspector column either side. That is now one slim toolbar over a full-width canvas.
- **The workspace switcher is a dropdown** beside the wordmark instead of four header tabs, so
  the header is a single row and reads as one control rather than a row of competing pills.
- **The library and the inspector share one slide-over drawer**, opened by a **Panels** button at
  the far end of the header and switched with Library / Insights tabs. Closing it returns the
  full width to the canvas. The drawer remembers which panel you had open and whether it was
  open at all; Escape closes it.
- Nothing was removed — the library, inspector, cost estimate, insights, chaos lab, and every
  toolbar control are all still there, just reached from the drawer or the dropdown. The
  implementation is additive (classes and a `data-drawer` attribute over the existing markup),
  so the controls the studio already wired up are untouched.

### Fixed

- Hidden panels no longer stay in the tab order or the accessibility tree — the closed side of
  the drawer is marked `inert`.
- The older per-panel collapse and focus modes are cleared when the canvas layout is on. Left
  set, their `display: none !important` kept the drawer permanently empty.

## 2026-08-23 — A paper canvas for large architectures

### Added

- **A real canvas zoom.** The diagram now lives on a fixed 2400 x 1500 surface that is visually
  scaled and scrolled, so architectures are no longer capped at whatever fits the viewport. Zoom
  runs from 25% to 200% via the status-bar control or the canvas +/- buttons, which previously
  resized node cards rather than zooming the diagram.
- **Fit frames the diagram, not the canvas.** "Fit" measures the bounding box of your nodes and
  scales to that, then scrolls it into view — fitting the whole empty surface would shrink a
  handful of services to specks.
- **`svg-export.js`** — the SVG exporter is now a pure, unit-tested module alongside the
  Terraform and Mermaid exporters, instead of a string template buried in the studio closure.

### Changed

- **The canvas is white paper in every theme.** Official AWS icons are drawn for white
  backgrounds, and exported diagrams land in READMEs and docs that are white. Node cards,
  labels, connection strokes, arrowheads, zone bands, the minimap, and the grid were all
  retinted for ink-on-white contrast.
- **Nodes are compact** — 76px wide with 34px icons (was 104px/46px), so noticeably more of a
  real architecture is legible at once. The "Node size" control still scales them from there.
- **SVG export matches the canvas**, replacing the dark `#06131d` backdrop and light-on-dark
  text with the same white palette used on screen.

### Fixed

- Diagrams saved before this release have no stored canvas zoom. That resolved to `NaN` and
  silently pinned the surface at 100% instead of fitting; legacy state is now migrated to "fit".
- The studio view is `display:none` until opened, so the first fit could run against a
  zero-size viewport and stick at 100%. A `ResizeObserver` re-fits once the viewport has a box.

## 2026-08-22 — Chaos Lab: availability math, SPOF detection, failure rehearsal

### Added

- **Chaos Lab** — a third Flow Studio inspector tab that analyzes the resilience of whatever is on
  the canvas:
  - **Estimated end-to-end availability** — per-service availability heuristics (managed services
    rank above raw compute, nudged by declared criticality) combined along the best route via
    Dijkstra in `-log` space, so the reported route maximizes the product of availabilities.
    Shown as a headline with nines and projected downtime minutes per year.
  - **Single points of failure** — real graph articulation points (iterative Tarjan low-link),
    ranked by how many nodes their loss strands, weighted by criticality.
  - **Flow availability table** — every entry→terminal flow with hop count, the number of
    **vertex-disjoint routes**, and its availability (redundant flows combine as parallel systems).
  - **Blast radius** — downstream reach per node, classified contained / significant / systemic.
  - **Recommendations** — plain-English advice naming the specific SPOF, the fragile flow and what
    a second route would buy it, the weakest link, and single-front-door risk.
  - **Failure rehearsal** — "Kill selected node" removes a node from the analysis, greys it on the
    canvas, and reports whether the architecture stays *resilient*, goes *degraded*, or hits an
    *outage*, with surviving-flow counts. "Restore all" brings it back.
- `src/chaos-engine.js` — the whole analysis is a pure, dependency-free, DOM-free module with
  **31 unit tests** covering availability estimates, entry/terminal discovery, articulation points
  (including criticality weighting and empty/single-node graphs), blast radius with cycles,
  best-path selection, disjoint route counting, multi-node failure simulation, and report
  determinism.

### Fixed

- Failure analysis pinned entry and exit points to the **undamaged** topology. Previously,
  removing a node let its orphaned downstream neighbours look like brand-new front doors, so the
  report could claim a *healthier* architecture after a failure. Covered by a regression test.

## 2026-07-30 — Trust boundaries: the primitive this project is named for

### Added

- **Trust zones** (`src/trust-zones.js`) — every service now sits in a zone (internet, edge, public subnet, private subnet, data tier, management) with an ordinal trust tier, editable per node in the Flow Studio inspector. Existing diagrams gain placement automatically: the zone is inferred from the service when none is declared, so nothing needs relabelling by hand.
- **Boundary analysis** — a connection between two zones is a *trust boundary crossing*, classified as internal, management, ingress, egress, step, or bypass. The threat model reports plaintext on a boundary, a datastore answering the internet directly, untrusted traffic reaching internal compute unmediated, outbound paths from the data tier, and edge protection that exists but is not on the traffic path.
- **The importer now uses the placement it used to discard.** VPC and subnet references were dropped so they could not be mistaken for traffic; they are now kept as *placement* and drive the zone. Compute in a subnet that auto-assigns public IPs — or that is associated with a route table routing to an internet gateway — lands in the public zone; everything else in the VPC lands in private. An `internal = true` load balancer is correctly private rather than a public entry point, and a datastore declaring `publicly_accessible` is called out on import.
- **A Trust lens** in the Review Center, alongside Security, Reliability, Observability, Recovery, and Network.
- **Boundary crossings are visible on the canvas.** Encryption was recorded on a connection but never drawn; plaintext paths are now dashed, and a crossing that reaches storage with no application tier in front — or leads back out of the data tier — is drawn in warning colour.

### Changed

- **Security scoring is topology-aware instead of substring-based.** A WAF used to earn a flat 25 points for existing anywhere on the canvas, even wired to nothing. It now earns them only if untrusted traffic actually passes through it, and the same applies to identity controls. Encryption on a boundary crossing counts for more than encryption inside a zone.

### Notes on the rules

Two judgements keep the analysis useful rather than noisy, and both are covered by tests: the **management** zone (IAM, KMS, Secrets Manager, CloudWatch) is cross-cutting, so talking to it is never a tier jump; and **`edge → data`** — CloudFront in front of an S3 origin — is recognised as a correct pattern rather than flagged as a bypass. Likewise, skipping a subnet tier is not a bypass: API Gateway → Lambda never touches a subnet, and "bypass" is reserved for reaching persistent storage with no application tier in front of it.

## 2026-07-30 — Harden the IaC round trip

### Fixed

- **HCL injection in the Terraform export.** Node names, environments, criticality, the region, and the architecture name were interpolated raw into `main.tf`. A name containing `"` closed the `Name = "..."` literal early and let the remainder be emitted as top-level HCL — so importing an untrusted template and exporting it could produce a `main.tf` carrying attacker-chosen blocks (including a `provisioner "local-exec"`) into a file a user may `terraform apply`. Values now go through `hclString()` (escapes `\`, `"`, CR/LF/tab, strips control characters, and neutralises the `${` and `%{` interpolation openers) or `hclComment()` (collapses to a single line so a newline cannot reach statement position). Reproduced end to end before and after; 11 new tests cover quote/newline breakout, interpolation markers, backslashes, control characters, and hostile regions and connection types.
- **X-Ray nodes were silently dropped on import.** The IaC map emitted `AWS X-Ray` but the icon catalog spells it `AWS X Ray`, and an unresolved service name makes Flow Studio discard the node without a word. Every test mocked `adoptArchitecture`, so nothing caught it.

### Added

- **`src/icon-match.js`** — the icon-matching rule now has one definition, used by Flow Studio's `findIcon` and covered directly by tests. A new test walks **every** service name the IaC importer can emit (53 of them) against the real 862-icon catalog, so a silent-drop mismatch fails CI instead of shipping.
- **Coverage thresholds** (`vite.config.js`) — a ratchet set just under current numbers so coverage cannot quietly regress. Verified it fails when the floor is raised past actual coverage.
- The Pages deploy no longer cancels an in-flight production deployment, pins its actions to commit SHAs, and **verifies the deployed page actually serves** (HTTP 200 plus a content check, with retries) instead of assuming a green deploy means a working site.

## 2026-07-29 — Infrastructure-as-code import: the round trip closes

### Added

- **Import Terraform and CloudFormation** — an "Import IaC" action in the Flow Studio export menu turns real infrastructure code into a live diagram. Paste, drop a file, or load one; a preview shows the services, paths, hidden plumbing, and unencrypted paths that will be drawn before anything replaces the canvas. Parsing happens entirely in the browser — nothing is uploaded and no AWS account is contacted.
- **Real HCL scanning** — a string, comment, heredoc, and interpolation-aware scanner finds top-level blocks, so braces inside an IAM policy heredoc or a `${lookup(var.m, "key")}` expression no longer corrupt block boundaries.
- **Reference tracing with plumbing contraction** — references between resources become directional trust paths, and paths *through* plumbing are collapsed: `alb → listener → target group → attachment → instance` becomes a single `alb → instance` edge. Parent-pointing attributes are inverted first, which is what makes `queue → function`, `api → function`, and `function → log group` come out pointing the right way. Placement attributes (`vpc_id`, `subnets`, security groups) are deliberately *not* drawn as traffic.
- **Encryption carried from the code** — a `protocol = "HTTP"` listener or `viewer_protocol_policy = "allow-all"` arrives on the canvas as an unencrypted path and flows straight through to the Review Center as a must-fix.
- **Round trip** — a canvas exported to `main.tf` and re-imported keeps its services, names, environments, criticality, region, topology, and external AI/SaaS nodes, recovered from the exporter's own tags and topology comments.
- Honest limits, surfaced as warnings rather than guesses: modules are not expanded, `count`/`for_each` is drawn once, non-AWS providers are ignored, very large stacks are capped, and CloudFormation YAML is refused with instructions instead of half-parsed.
- `adoptArchitecture` is now part of the public `AWSFlowStudio` API, so the JSON file importer and the IaC importer share one validated path onto the canvas.
## 2026-07-05 — The decision layer: cost lens + IaC and diagram exports

### Added

- **Live cost lens** — a 💰 badge in the Flow Studio header estimates the architecture's rough monthly cost as you build (per-service planning figures scaled by criticality, with a biggest-spenders tooltip). Deliberately coarse: for comparing designs, not billing.
- **Terraform export** — a "TF" toolbar button downloads the canvas as a `main.tf` skeleton: every service maps to its closest Terraform resource type with tags and TODOs, AI services (Claude, ChatGPT, vector stores…) become SaaS placeholders, and the topology is included as comments — unencrypted paths are flagged.
- **Mermaid export** — an "MMD" toolbar button copies the architecture as a Mermaid flowchart (typed arrows per traffic kind, high-criticality nodes highlighted) ready to paste into GitHub READMEs and PRs.
- All three engines are pure, dependency-free modules with unit tests.

## 2026-07-02 — Flow Studio first

### Added

- **Flow Studio is now the main screen** — the app opens straight into the architecture studio; the Command Atlas incident workbench is one selection away.
- **Workspace dropdown** — the header tabs are replaced by a labelled dropdown (Flow Studio / Command Atlas) that persists your choice.
- **Studio sessions** — create, switch, rename, and delete multiple named architectures from the studio titlebar. Each session keeps its own auto-saved canvas (up to 12), the architecture-name field renames the active session, and the last session can never be deleted. The store core is dependency-free and unit-tested.
- **Spotlight cards** — a vanilla port of React Bits' SpotlightCard: starter templates and posture/doctrine cards get a radial highlight that follows the pointer (hover devices only, reduced-motion aware).
- **Animated gradient titles** — a vanilla port of React Bits' GradientText: the headline and Flow Studio title now sweep their gradients continuously.

## 2026-07-02 — Animated reveals

### Added

- **Animated content reveals** — a dependency-free vanilla port of React Bits' [AnimatedContent](https://reactbits.dev/animations/animated-content). Elements marked `data-animate` (up / down / left / right / scale) glide + fade into place as they enter the viewport, with staggered delays: the hero, workspace switcher, and controls rise in sequence, the scenario rail slides from the left, the topology scales up, the operations console slides from the right, and Flow Studio reveals on scroll. Built on IntersectionObserver + CSS transitions (no React/GSAP, matching the buildless stack), fully `prefers-reduced-motion`-aware, with a head-script failsafe so content can never get stuck hidden if scripting fails.

## 2026-07-02 — Resilience Index

### Added

- **Resilience Index** — a single composite 0–100 headline score with an A–F grade, shown as a live ring gauge on the map's authority card. It blends route health, the weakest node, fallback readiness, data durability, and recovery speed, minus a blast-radius penalty, and recolours (green / amber / red) as scenarios, injected faults, and personalized scores change. Pure and unit-tested against the composition model.

## 2026-06-30 — Incident Playback

### Added

- **Incident Playback** — a cinematic ▶ mode (also in the ⌘K palette) that auto-runs a narrated, six-step walkthrough: steady state → traffic surge → edge flood → identity drift → a compounding two-fault failure → recovery. Each step drives the scenario, injected faults, and inspected node while a caption banner with progress dots explains what is happening, then hands control back. Honours `prefers-reduced-motion` (calmer pacing) and stops on Escape, the Stop button, or toggling ▶.
- The playback script is data-only and unit-tested against the resilience model, so it can never reference a scenario, fault, or node that does not exist.

## 2026-06-24 — Edit mode & readable titles

### Added

- **"Make it your own" edit mode** — an Edit toggle (and command-palette actions) lets any visitor tailor the atlas to their own system: rename the headline and subtitle inline, and click any service node to rename it and set its own confidence score. Everything persists to `localStorage`, with a one-click reset to defaults.
- **Share my version** — a "Copy a link to my version" command encodes the full personalization (title, subtitle, renamed services, custom scores) into a compact, URL-safe link; opening it adopts that tailored atlas for the visitor to keep editing.
- Per-node base **score overrides** flow through the same composition engine, so injected faults still stack on top of a personalized baseline.

### Fixed

- **Invisible titles in light mode** — the Flow Studio and topology map are now treated as always-dark "screens" (the dark palette is pinned to them), so their titles and labels stay legible regardless of the light/dark theme. Previously the hardcoded-dark panels showed theme-dark text in light mode.

### Changed

- Signature **gradient titles** for the headline and the Flow Studio heading (readable base colour with an accent sweep) for a more distinctive look.

## 2026-06-24

### Added

- **Workspace views** — a header switcher splits the app into a full "Command Atlas" workspace and a dedicated, full-screen "Flow Studio" screen. The choice persists across visits.
- **AI / LLM building blocks in Flow Studio** — a new "AI" library tab with Claude, ChatGPT, Foundation Model, AI Agent, Vector Database, Embeddings Model, and AI Guardrails nodes (custom icons) that drop straight onto the canvas.
- **AI starter templates** — Claude RAG assistant, AI agent platform, and GenAI chatbot, alongside the existing AWS templates, each scored by the same Architecture Intelligence engine.
- **Operations console** — the incident modules (Incident inspector, Telemetry, Active runbook, Control posture, Operating doctrine) now live in one right-hand console with a dropdown to switch between them, replacing the long stacked deck and giving the topology map more room.

### Changed

- Reorganized the Command Atlas into a cleaner rail · map · console layout; the map is now the dominant element.
- The AI catalog leads the Flow Studio library and is merged client-side, keeping the official 862-icon AWS set intact.

### Validation

- ESLint, Prettier, and Vitest (45 tests) green.
- Browser-verified: view switching, the full-screen Flow Studio, the AI library tab (7 nodes), the Claude RAG / AI agent / GenAI chatbot templates, and the console dropdown switching across all five modules — zero console errors.

## 2026-06-22

### Added

- A professional toolchain: Vite dev server, Vitest unit tests, ESLint, and Prettier, wired together behind `npm run check`.
- GitHub Actions CI (lint, format check, tests) and a GitHub Pages deploy workflow.
- Light / dark / follow-system theming with a header toggle, persisted across visits.
- A command palette (⌘K / Ctrl-K) with fuzzy search across every action — switch scenarios, inject/clear faults, inspect nodes, and change theme from the keyboard.
- A "Copy incident report" command that generates a shareable Markdown summary (scenario, faults, telemetry, weakest node, recommendation, deep link) from the live state.
- Shareable deep links — the active scenario, injected faults, and selected node are encoded in the URL hash, and a share button copies a link that reopens the exact same view.
- Accessibility pass: a skip link, role/keyboard semantics on service nodes, a high-contrast focus ring, and full `prefers-reduced-motion` support that freezes the SVG choreography.
- Unit tests for the resilience composition model and the URL-state codec.

### Changed

- Refactored the monolithic scripts into focused ES modules under `src/`, extracting the pure resilience domain model and URL-state logic into dependency-free, unit-tested units.
- Converted the icon catalog to an ES module and lazy-loaded both it (~327 KB) and Flow Studio via dynamic `import()` so they no longer block first paint — the initial JavaScript payload is now a fraction of the previous eager load.

### Validation

- ESLint, Prettier, and Vitest (26 tests) all green.
- Browser-tested scenario switching, fault injection and telemetry, node selection, deep-link encode/restore, theme toggle, lazy Flow Studio init, and mobile layout with zero console errors and no horizontal overflow.

## 2026-06-21

### Added

- Architecture Intelligence with a live resilience score and separate Security, Reliability, Observability, and Recovery dimensions.
- Prioritized design recommendations that react to topology coverage, identity boundaries, observability, recovery intent, and path encryption.
- Semantic architecture paths for synchronous requests, events, data access, telemetry, and replication, including editable labels and encryption state.
- Traffic simulation and node-failure rehearsal with downstream blast-radius tracing, affected path highlighting, and score impact.
- Automatic topology layout, a live minimap, canvas zoom controls, collapsible icon library, and recently used AWS services.
- Architecture import from Flow Studio JSON and portable SVG diagram export with embedded official AWS icons.
- Auto-save and keyboard shortcuts for undo, redo, and save.

### Improved

- Rebuilt Flow Studio as a topology-first architecture lab with a larger canvas, compact command bar, layered workload bands, and an architecture-intelligence rail.
- Expanded the Serverless API, Event Pipeline, and Resilient Web App templates to model production concerns such as edge protection, identity, telemetry, queues, backups, and recovery paths.
- Refined desktop and mobile layouts so the editor, simulation dock, icon catalog, and analysis remain usable without horizontal overflow.

### Validation

- Browser-tested path editing, score recalculation, failure injection, traffic simulation, auto-layout, icon search and creation, JSON import/export, SVG export, auto-save, and library collapse.
- Verified all 862 official AWS icons, desktop rendering at 1536 x 1024, mobile rendering at 390 x 844, and zero browser console errors.

## 2026-06-20

### Added

- AWS Flow Studio for creating custom AWS architectures inside the Command Atlas.
- Searchable catalog of 862 official AWS service, resource, group, and category SVG icons from the 2026 Q2 architecture icon package.
- Draggable diagram nodes, directional connection mode, connection selection, node deletion, undo, redo, and fit-to-canvas controls.
- Node inspector for custom names, environment, criticality, and architecture notes.
- Serverless API, Event Pipeline, Resilient Web App, and Blank starter templates.
- Live architecture checks for connected paths, isolated services, observability, public-edge protection, and data recovery intent.
- Local architecture persistence, grid and zoom preferences, regional context, and JSON export.

### Validation

- Desktop interaction flow covering icon search, node creation, connection, inspector editing, undo, redo, save, export, and template switching.
- Responsive verification at 1536 x 1024 and 390 x 844 with no horizontal overflow or browser console errors.

## 2026-06-19

### Redesigned

- Rebuilt the first viewport as a three-zone incident command workbench with a scenario rail, dominant service topology, and live incident inspector.
- Moved failure injection beside the topology so stacked faults and their consequences can be composed without leaving the map.
- Reworked typography, spacing, borders, node details, telemetry, runbooks, posture controls, and doctrine into a denser operations-console system.
- Added focused desktop, tablet, and mobile layouts that preserve the topology and controls without horizontal overflow.

### Added

- Interactive Failure Composer with Edge Flood, Identity Breach, Data Lag, and Workflow Backlog injections.
- Composable failure stacking that recalculates service confidence scores and visually marks impacted map nodes.
- Live blast-radius classification from Localized through Systemic.
- Weakest-node analysis and a composed recovery window.
- Dynamic route health, fallback readiness, data durability, and recovery ETA under injected faults.
- Contextual operator recommendations assembled from the active fault set.
- Clear Injections control that restores the base scenario without changing the selected scenario.

### Changed

- Scenario telemetry now flows through a shared composition model instead of being written directly to the page.
- The selected service drawer now reflects fault-adjusted confidence.

### Validation

- JavaScript syntax checks.
- Browser interaction checks for single and stacked injections, telemetry changes, map impact states, clearing, console health, and mobile overflow.
