# AWS Trust Choreography

A single-page HTML/CSS/JavaScript experiment inspired by dark resilience dashboards and AWS service maps.

It visualizes a cloud recovery story with:

- glowing service nodes for CloudFront, EKS, IAM, Aurora, Step Functions, Lambda, S3, EventBridge, and an SNS-backed manual lane
- animated trust-path packets and fallback routes
- scenario tabs for steady state, traffic surge, identity drift, and recovery drill
- clickable service nodes with live confidence copy and metrics

Open `index.html` directly in a browser, or serve the folder with any static file server.
