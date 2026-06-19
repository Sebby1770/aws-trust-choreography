# Changelog

All notable changes to this project are documented here.

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
