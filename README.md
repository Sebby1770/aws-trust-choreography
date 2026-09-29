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

**AWS Diagram Studio** (full-screen) — a draw.io-class editor that understands AWS

- **Takes the whole screen.** The site header folds into the studio's own light-blue title bar
  (workspace switcher, theme, command palette), with a draw.io-style menubar (File, Edit, View,
  Arrange, Insert, Help), a tool strip, the shape library on the left, and a Format / Insights /
  Chaos panel on the right. Both side panels collapse; on tablets and phones they float over the
  canvas.
- **Infinite canvas** — scroll or Space-drag to pan, ⌘-scroll or pinch to zoom at the pointer (10%–400%),
  fit diagram / fit selection, a draggable minimap, and a grid with snapping.
- **Real editing** — multi-select (click, shift-click, marquee), move with smart alignment guides,
  resize from eight handles, nudge with the arrow keys, copy / cut / paste (across tabs via the
  system clipboard), duplicate or ⌥-drag to copy, group and ungroup, lock, bring to front / send to
  back, align and distribute, auto layout, find (⌘F), and labelled undo / redo.
- **Connectors like draw.io, only smarter** — hover a shape for blue arrows: drag one to connect,
  click one to add a connected copy, or let go on empty canvas to pick what to create there.
  Orthogonal connectors **route around other shapes** (A\* over an orthogonal visibility grid with a
  bend penalty) and drop below service labels instead of cutting through them. Straight and curved
  routing, draggable segments and waypoints, fixed ports, arrowheads (including crow's-foot ER ends),
  dashes, animated flow, and labels you can drag along the line.
- **Shapes** — general and flowchart shapes, notes, text, images, all 862 official AWS icons, AI / LLM
  nodes, 20 network devices, and **AWS group containers** (AWS Cloud, Region, VPC, Availability Zone,
  public / private subnet, security group, Auto Scaling group and more). Double-click anywhere to
  add something by name — `sqs`, `alb`, `ddb` and other shorthand work.
- **Trust zones follow containers.** Drop a service into a private subnet (or a data-tier / edge /
  management zone container) and it takes on that trust zone; change a container's zone and the
  services inside follow. Plaintext and tier-skipping paths are highlighted on the canvas.
- **Format panel** — fill, line, width, pattern, rounded corners, shadow, opacity, fonts and alignment,
  exact position and size, container type and zone, and the architecture fields (environment,
  criticality, trust zone, notes) for services.
- **draw.io interchange** — **open** `.drawio` / `.xml` files (compressed or not, every page) and
  editable `.drawio.svg`: draw.io's own AWS shapes become live, analysable services and its AWS
  groups become containers. **Save** as a native `.drawio` file (real draw.io AWS group shapes, the
  exact icons embedded) that round-trips trust zones, criticality and traffic types.
- **Export** PNG (2×), SVG that reopens as an editable draw.io diagram, JSON, a Terraform skeleton,
  Mermaid, and SQL DDL. Paste draw.io shapes straight onto the canvas.
- **Pages** — tabs along the bottom, each auto-saved; rename, duplicate and delete from the tab menu.
- **Database diagrams (ER)** — table shapes with a column editor (name, type, PK, NOT NULL, UNIQUE).
  Drawing a line between two tables creates the foreign key (`players.team_id → teams.id`) with
  crow's-foot ends that follow the column's nullability. File › Import SQL schema turns
  `CREATE TABLE` DDL into a laid-out ER diagram, and Export › SQL writes the diagram back out as
  dependency-ordered DDL for PostgreSQL, MySQL or SQLite.
- **Architecture intelligence** stays live alongside the drawing: the readiness score and
  prioritised checks, **Chaos Lab** (availability, single points of failure, blast radius, and
  "kill this service" rehearsal), traffic animation, and a rough monthly cost.
- **Import infrastructure as code** — Terraform or CloudFormation becomes a live diagram (see
  File › Import Terraform / CloudFormation).
- Keyboard shortcuts for everything (press `?`), command-palette actions, and light / dark themes.

**SQL Review**

- Paste a query and get a structural read plus findings: destructive statements with no WHERE,
  cartesian joins, `NOT IN` against a nullable subquery, leading-wildcard LIKE, non-sargable
  predicates, `DISTINCT` hiding a join fan-out, correlated subqueries, deep `OFFSET` paging, and
  interpolated values — all in the browser. Optionally goes further with **your own** Anthropic
  API key.
- **SQL ⇄ schema diagram.** Paste `CREATE TABLE` statements and a live ER diagram of the tables and
  foreign keys appears beside the findings; **Open in AWS Studio** turns it into an editable page.
  **From diagram** does the reverse, writing DDL for the tables drawn in the studio in the chosen
  dialect.

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
  flow-studio.js       AWS Diagram Studio: composes the editor with intelligence, pages, import/export
  diagram/             the diagram engine (unit-tested):
    editor.js          interactive editor — pointer, keyboard, clipboard, text editing, history
    model.js           document schema, migration, containment, paint order, clipboard
    router.js          connector routing (obstacle-avoiding orthogonal, straight, curved) and arrowheads
    scene.js           document → SVG, shared by the canvas and every export
    geometry.js        rects, snapping, smart guides, align / distribute, resizing
    drawio.js          .drawio import / export
    er.js, table.js    ER tables, foreign keys, SQL schema ⇄ diagram
    layout.js          layered auto layout
    overlay.js, viewport.js, history.js, text.js, vdom.js, shapes.js, templates.js
    library.js, format-panel.js, menus.js, quick-insert.js, minimap.js, export.js
  sql-schema.js        DDL parser and multi-dialect DDL writer (unit-tested)
  sql-schema-preview.js live ER preview for SQL Review (loaded on demand)
  aws-review-model.js  pure, explainable AWS readiness rules
  studio-shell.js      Maximise mode, per-view layout classes, shortcuts dialog
  network-lab.js       network canvas, scoring, persistence, and packet simulation
  review-center.js     combined review model, report builder, and DOM controller
  ai-icons.js          Claude/ChatGPT/AI library nodes (unit-tested)
  personalize.js       per-visitor edit profile (unit-tested)
  views.js             Explore / AWS / Network / Review workspace switcher
  theme.js             light/dark/system theme controller
  command-palette.js   ⌘K launcher + fuzzy ranking (unit-tested)
  workspace-commands.js navigation, theme, and Review commands
  animated-content.js  reveal-on-scroll engine (unit-tested)
  studio-sessions.js   page store for the diagram studio (unit-tested)
  cost-model.js        rough monthly cost estimator (unit-tested)
  terraform-export.js  canvas → main.tf skeleton (unit-tested)
  mermaid-export.js    canvas → Mermaid flowchart (unit-tested)
  canvas-focus.js      workspace dropdown + the Network Lab's Library/Tools/Insights drawer (unit-tested)
  network-icons.js     line-art device icons for the Network Lab (unit-tested)
  sql-review.js        SQL static analysis — masking, rules, scoring (unit-tested)
  sql-assist.js        optional Claude review via your own API key (unit-tested)
  sql-lab.js           SQL workspace controller (unit-tested)
  trust-zones.js       trust zones, boundary crossings, threat model (unit-tested)
  iac-import.js        Terraform/CloudFormation → canvas (unit-tested)
  iac-service-map.js   IaC resource type → AWS service tables
  iac-import-ui.js     import dialog wiring (unit-tested)
  spotlight.js         pointer-tracked spotlight cards
  icon-catalog.js      lazy loader for the icon catalog chunk
diagram-studio.css     the AWS Diagram Studio (light-blue, full-screen) and its design tokens
app-theme.css          maps every other workspace onto the studio's light-blue design system
studio-shell.css       full-viewport editor shell shared by the labs
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

The shell, Explore workspace, Review Center, and Network Lab load immediately. The heavier AWS Diagram
Studio, its diagram engine, and the official icon catalog are loaded lazily via dynamic `import()`
when the studio nears the viewport, Review opens, or the browser is idle; the SQL Review schema
preview loads the first time pasted SQL contains a `CREATE TABLE`.

## Deployment

Pushes to `main` are verified, built with Vite, and published from `dist/client` to GitHub Pages by
the [deploy workflow](.github/workflows/deploy.yml). Enable Pages with the **GitHub Actions** source
if it is not already on.

## Icons

The Flow Studio icon catalog is generated from the current
[AWS Architecture Icons package](https://aws.amazon.com/architecture/icons/) with
`npm run build:icons`.

See [CHANGELOG.md](CHANGELOG.md) for dated release notes.
