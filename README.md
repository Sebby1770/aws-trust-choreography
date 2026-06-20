# AWS Resilience Command Atlas

A single-page HTML/CSS/JavaScript experiment inspired by AWS resilience dashboards and service maps.

It visualizes a cloud recovery story with:

- a three-zone incident command workbench with scenario navigation, live topology, and fault inspector
- glowing service nodes for CloudFront, EKS, IAM, Aurora, Step Functions, Lambda, S3, EventBridge, and an SNS-backed manual lane
- animated trust-path packets and fallback routes
- scenario tabs for steady state, traffic surge, identity drift, and recovery drill
- clickable service nodes with live confidence copy and metrics
- scenario-specific recovery runbooks that update with the active incident mode
- a resilience posture model across Prevent, Absorb, Recover, and Learn control lenses
- scenario-specific operating doctrine that names the failure model, stance, decision rule, and proof of recovery
- interactive failure composition with stacked fault injection, blast-radius analysis, and live service-score degradation
- AWS Flow Studio with draggable architecture nodes, directional connections, templates, validation, local saves, and JSON export
- a searchable library of 862 official AWS architecture icons across services, resources, groups, and categories
- a visible link to the official [AWS website](https://aws.amazon.com/)
- responsive operations-console layouts for desktop, tablet, and mobile

Open `index.html` directly in a browser, or serve the folder with any static file server.

See [CHANGELOG.md](CHANGELOG.md) for dated release notes.

The Flow Studio icon catalog is generated from the current [AWS Architecture Icons package](https://aws.amazon.com/architecture/icons/) with `node tools/build-aws-icon-catalog.mjs`.
