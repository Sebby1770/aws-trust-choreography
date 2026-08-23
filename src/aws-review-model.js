/**
 * Pure AWS design-review rules shared by Flow Studio and Review Center.
 *
 * The result only evaluates evidence represented in the diagram. It does not
 * inspect a live AWS account and should never be presented as certification.
 */

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function architectureParts(input) {
  const state = input && typeof input === "object" ? input : {};
  return {
    nodes: Array.isArray(state.nodes) ? state.nodes : [],
    connections: Array.isArray(state.connections) ? state.connections : [],
  };
}

function finding(id, category, tone, title, detail, recommendation, target = null) {
  return { id, category, tone, title, detail, recommendation, target };
}

/** Return explainable checks for an AWS architecture diagram. */
export function reviewAwsChecks(input = {}) {
  const { nodes, connections } = architectureParts(input);
  const checks = [];
  const names = nodes.map((node) => `${node?.name || ""} ${node?.serviceName || ""}`.toLowerCase());
  const connectedIds = new Set(
    connections.flatMap((connection) => [connection.from, connection.to])
  );
  const isolated = nodes.filter((node) => !connectedIds.has(node.id));
  const hasMonitoring = names.some((name) => name.includes("cloudwatch"));
  const hasPublicEntry = names.some(
    (name) => name.includes("cloudfront") || name.includes("api gateway")
  );
  const hasEdgeSecurity = names.some((name) => name.includes("waf") || name.includes("shield"));
  const hasData = names.some(
    (name) =>
      name.includes("dynamodb") ||
      name.includes("rds") ||
      name.includes("aurora") ||
      name.includes("s3")
  );
  const hasRecovery = names.some(
    (name) => name.includes("backup") || name.includes("s3") || name.includes("glacier")
  );

  checks.push(
    nodes.length >= 2 && connections.length >= 1
      ? finding(
          "flow",
          "reliability",
          "pass",
          "Flow path established",
          `${connections.length} directional connection${connections.length === 1 ? "" : "s"}`,
          "Keep ownership and protocol labels current as the design changes."
        )
      : finding(
          "flow",
          "reliability",
          "warn",
          "Architecture is not connected",
          "Fewer than two services participate in a directional trust path.",
          "Add at least two nodes and connect them.",
          { kind: "canvas" }
        )
  );

  checks.push(
    isolated.length
      ? finding(
          "isolated",
          "reliability",
          "warn",
          `${isolated.length} isolated node${isolated.length === 1 ? "" : "s"}`,
          "One or more services do not participate in any visible request, data, or telemetry path.",
          "Connect every service so ownership and traffic flow are explicit.",
          { kind: "node", id: isolated[0]?.id || null }
        )
      : finding(
          "isolated",
          "reliability",
          "pass",
          "No isolated services",
          "Every node participates in the architecture flow.",
          "Keep the diagram aligned with the deployed system."
        )
  );

  checks.push(
    hasMonitoring
      ? finding(
          "observability",
          "observability",
          "pass",
          "Observability present",
          "CloudWatch is represented in the design.",
          "Add telemetry paths to show where logs and metrics are collected."
        )
      : finding(
          "observability",
          "observability",
          "warn",
          "Monitoring is missing",
          "No CloudWatch service is represented in the architecture.",
          "Add CloudWatch or another telemetry destination so failures are visible.",
          { kind: "library", query: "CloudWatch" }
        )
  );

  if (hasPublicEntry) {
    checks.push(
      hasEdgeSecurity
        ? finding(
            "edge-security",
            "security",
            "pass",
            "Public edge is protected",
            "WAF or Shield is represented alongside a public entry service.",
            "Confirm the protection is attached to every public path."
          )
        : finding(
            "edge-security",
            "security",
            "warn",
            "Public edge needs protection",
            "A public entry service is present without a visible WAF or Shield control.",
            "Add AWS WAF or Shield near the public traffic path.",
            { kind: "library", query: "WAF" }
          )
    );
  }

  if (hasData) {
    checks.push(
      hasRecovery
        ? finding(
            "recovery",
            "recovery",
            "pass",
            "Recovery target represented",
            "The architecture includes a durable recovery service.",
            "Document retention and recovery objectives in the node notes."
          )
        : finding(
            "recovery",
            "recovery",
            "warn",
            "Data recovery is unclear",
            "A data service is present without an explicit backup or archive destination.",
            "Add AWS Backup, S3, or Glacier to show recovery intent.",
            { kind: "library", query: "AWS Backup" }
          )
    );
  }

  const unencrypted = connections.filter((connection) => connection.encrypted === false);
  if (unencrypted.length) {
    checks.unshift(
      finding(
        "encryption",
        "security",
        "fail",
        `${unencrypted.length} unencrypted path${unencrypted.length === 1 ? "" : "s"}`,
        "At least one modeled workload path explicitly disables in-transit encryption.",
        "Enable in-transit encryption for every workload path.",
        { kind: "connection", id: unencrypted[0]?.id || null, field: "encrypted" }
      )
    );
  } else if (connections.length) {
    checks.push(
      finding(
        "encryption",
        "security",
        "pass",
        "Traffic encryption declared",
        "Every modeled path is encrypted in transit.",
        "Keep protocol and encryption metadata current."
      )
    );
  }

  const hasIdentity = names.some(
    (name) => name.includes("iam") || name.includes("cognito") || name.includes("identity")
  );
  checks.push(
    hasIdentity
      ? finding(
          "identity",
          "security",
          "pass",
          "Identity boundary represented",
          "The design includes an AWS identity control.",
          "Document which identities are trusted across each boundary."
        )
      : finding(
          "identity",
          "security",
          "warn",
          "Identity boundary is implicit",
          "No IAM, Cognito, or IAM Identity Center control appears in the design.",
          "Add an identity service to make authentication and trust ownership visible.",
          { kind: "library", query: "IAM" }
        )
  );

  return checks;
}

/** Return the four Flow Studio readiness dimensions and their overall score. */
export function scoreAwsArchitecture(input = {}, simulation = {}) {
  const { nodes, connections } = architectureParts(input);
  const names = nodes.map((node) => `${node?.name || ""} ${node?.serviceName || ""}`.toLowerCase());
  const includesAny = (...terms) => names.some((name) => terms.some((term) => name.includes(term)));
  const connectedIds = new Set(
    connections.flatMap((connection) => [connection.from, connection.to])
  );
  const connectedRatio = nodes.length ? connectedIds.size / nodes.length : 0;
  const encryptedRatio = connections.length
    ? connections.filter((connection) => connection.encrypted !== false).length / connections.length
    : 0;
  const security = clamp(
    Math.round(
      20 +
        encryptedRatio * 35 +
        (includesAny("waf", "shield") ? 25 : 0) +
        (includesAny("iam", "cognito", "identity center") ? 20 : 0)
    )
  );
  const reliability = clamp(
    Math.round(
      22 +
        connectedRatio * 30 +
        Math.min(18, nodes.length * 2.5) +
        (includesAny("queue", "sqs", "eventbridge", "auto scaling", "elastic load") ? 22 : 0) +
        (nodes.filter((node) => node.environment === "Production").length >= 3 ? 8 : 0)
    )
  );
  const observability = clamp(
    Math.round(
      18 +
        (includesAny("cloudwatch") ? 48 : 0) +
        (includesAny("x-ray", "cloudtrail") ? 22 : 0) +
        (connections.some((connection) => connection.type === "telemetry") ? 12 : 0)
    )
  );
  const recovery = clamp(
    Math.round(
      18 +
        (includesAny("backup", "glacier") ? 38 : 0) +
        (includesAny("s3", "dynamodb", "aurora", "rds") ? 24 : 0) +
        (includesAny("queue", "sqs", "step functions") ? 20 : 0)
    )
  );
  const failurePenalty = simulation.failed
    ? Math.min(20, 7 + Math.max(0, Number(simulation.affectedCount) || 0) * 2)
    : 0;
  const overall = clamp(
    Math.round((security + reliability + observability + recovery) / 4) - failurePenalty
  );
  return { security, reliability, observability, recovery, overall };
}

/** Produce the complete AWS review in one call. */
export function reviewAwsArchitecture(input = {}, simulation = {}) {
  return {
    analysis: scoreAwsArchitecture(input, simulation),
    checks: reviewAwsChecks(input),
  };
}
