# Changelog

All notable changes to this project are documented here.

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
