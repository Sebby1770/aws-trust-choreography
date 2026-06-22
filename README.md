# AWS Resilience Command Atlas

[![CI](https://github.com/Sebby1770/aws-trust-choreography/actions/workflows/ci.yml/badge.svg)](https://github.com/Sebby1770/aws-trust-choreography/actions/workflows/ci.yml)

An interactive, single-page incident-command atlas and architecture studio inspired by AWS
resilience dashboards and service maps. Built with vanilla HTML, CSS, and modern ES modules — no
framework, no runtime dependencies.

## What it does

**Incident command workbench**

- A three-zone workbench: scenario rail, live service topology, and an incident inspector.
- Glowing service nodes for CloudFront, EKS, IAM, Aurora, Step Functions, Lambda, S3, EventBridge,
  and an SNS-backed manual lane, joined by animated trust-path packets and fallback routes.
- Scenario tabs — steady state, traffic surge, identity drift, recovery drill — that drive the
  topology, telemetry, runbooks, posture model, and operating doctrine.
- A **failure composer** that stacks faults (edge flood, identity breach, data lag, workflow
  backlog), recomputes service confidence scores, and classifies blast radius from _Contained_ to
  _Systemic_.
- A resilience posture model (Prevent / Absorb / Recover / Learn) and scenario-specific doctrine.

**AWS Flow Studio**

- A topology-first architecture lab: draggable nodes, directional connections, auto-layout, undo /
  redo, templates, local autosave, and JSON / SVG export.
- Live Architecture Intelligence scoring across security, reliability, observability, and recovery.
- A searchable library of **862 official AWS architecture icons**, lazy-loaded so it never blocks
  first paint.

**Experience**

- **Command palette (⌘K)** — a keyboard-first launcher that fuzzy-matches across every action:
  switch scenarios, inject or clear faults, inspect any node, change theme, or copy a report.
- **Copy incident report** — generates a shareable Markdown summary (scenario, faults, telemetry,
  weakest node, recommendation, and a deep link) from the live state.
- **Shareable deep links** — the active scenario, injected faults, and selected node are encoded in
  the URL hash, so the share button copies a link that reopens the exact same view.
- **Theming** — light / dark / follow-system, persisted across visits.
- **Accessibility** — skip link, keyboard-operable nodes, visible focus rings, and full
  `prefers-reduced-motion` support (the SVG choreography freezes when motion is reduced).
- Responsive layouts for desktop, tablet, and mobile with no horizontal overflow.

## Getting started

```bash
npm install      # install dev tooling
npm run dev      # start the Vite dev server with hot reload
```

Then open the printed local URL. The app ships as native ES modules and has no bundling step — it
runs directly from the source files, both in development and in production.

## Scripts

| Script                | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | Vite dev server with hot module reload                |
| `npm test`            | Run the Vitest unit suite                             |
| `npm run coverage`    | Run tests with a V8 coverage report                   |
| `npm run lint`        | Lint with ESLint                                      |
| `npm run format`      | Format with Prettier (`format:check` to verify only)  |
| `npm run check`       | Lint + format check + tests (the CI gate)             |
| `npm run build:icons` | Regenerate the icon catalog from the AWS icon package |

## Project structure

```
src/
  main.js              app entry — boots the atlas, lazy-loads Flow Studio
  resilience-model.js  pure scenario/fault domain model (unit-tested)
  atlas.js             incident-command DOM controller
  flow-studio.js       architecture studio
  theme.js             light/dark/system theme controller
  url-state.js         shareable URL-hash state (unit-tested)
  command-palette.js   ⌘K launcher + fuzzy ranking (unit-tested)
  incident-report.js   Markdown incident-report builder (unit-tested)
  icon-catalog.js      lazy loader for the icon catalog chunk
tests/                 Vitest suites for the pure modules
assets/aws-icons/      862 official AWS architecture SVGs + generated catalog
tools/                 icon-catalog generator
```

The resilience composition logic and URL-state codec live in dependency-free modules so they can be
verified in isolation; see `tests/`.

## Performance

The app loads as native ES modules. First paint pulls only the lightweight atlas; the Flow Studio
module and the ~327 KB icon catalog are loaded lazily via dynamic `import()` (when the studio nears
the viewport, or on idle), keeping the initial payload small.

## Deployment

Pushes to `main` are assembled into a static site and published to GitHub Pages by the
[deploy workflow](.github/workflows/deploy.yml) — no bundling, just the runtime files. Enable Pages
with the **GitHub Actions** source if it is not already on.

## Icons

The Flow Studio icon catalog is generated from the current
[AWS Architecture Icons package](https://aws.amazon.com/architecture/icons/) with
`npm run build:icons`.

See [CHANGELOG.md](CHANGELOG.md) for dated release notes.
