# Changelog

All notable changes to this project are documented here.

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
