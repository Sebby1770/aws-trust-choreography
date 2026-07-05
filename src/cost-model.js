/**
 * Cost lens — rough monthly cost estimation for a Flow Studio architecture.
 *
 * Every node is matched by service keywords to a ballpark monthly figure, then
 * scaled by its criticality tier. These are deliberately coarse planning
 * numbers (steady mid-size workload, us-east-1-ish), not a quote — the point
 * is comparing architectures and spotting the expensive corners at a glance.
 */

const PRICES = [
  { match: ["claude", "chatgpt", "foundation model"], usd: 200, why: "LLM API usage" },
  { match: ["vector database"], usd: 70, why: "managed vector store" },
  { match: ["embeddings"], usd: 40, why: "embedding calls" },
  { match: ["ai agent"], usd: 50, why: "agent orchestration" },
  { match: ["guardrails"], usd: 15, why: "moderation calls" },
  { match: ["eks", "kubernetes"], usd: 150, why: "cluster + nodes" },
  { match: ["rds", "aurora"], usd: 120, why: "database instances" },
  { match: ["ec2", "auto scaling"], usd: 70, why: "instances" },
  { match: ["opensearch", "elasticsearch"], usd: 90, why: "search cluster" },
  { match: ["redshift"], usd: 180, why: "warehouse" },
  { match: ["dynamodb"], usd: 30, why: "capacity + storage" },
  { match: ["cloudfront"], usd: 25, why: "egress + requests" },
  { match: ["load balancing", "elb", "alb"], usd: 25, why: "ALB hours" },
  { match: ["kinesis"], usd: 35, why: "shard hours" },
  { match: ["cloudwatch"], usd: 15, why: "logs + metrics" },
  { match: ["api gateway"], usd: 12, why: "requests" },
  { match: ["step functions"], usd: 10, why: "state transitions" },
  { match: ["waf", "shield"], usd: 10, why: "rules + requests" },
  { match: ["lambda"], usd: 8, why: "invocations" },
  { match: ["backup"], usd: 8, why: "vault storage" },
  { match: ["s3", "storage service"], usd: 5, why: "storage + requests" },
  { match: ["cognito"], usd: 5, why: "MAUs" },
  { match: ["eventbridge"], usd: 3, why: "events" },
  { match: ["sqs", "sns", "queue"], usd: 2, why: "messages" },
  { match: ["route 53", "dns"], usd: 1, why: "zones + queries" },
];

const CRITICALITY_FACTOR = { high: 1.5, medium: 1, low: 0.6 };
const DEFAULT_USD = 20;

/** Estimate one node's monthly cost. */
export function estimateNodeCost(node) {
  const hay = `${node?.serviceName || ""} ${node?.name || ""}`.toLowerCase();
  const hit = PRICES.find((p) => p.match.some((m) => hay.includes(m)));
  const base = hit ? hit.usd : DEFAULT_USD;
  const factor = CRITICALITY_FACTOR[node?.criticality] ?? 1;
  return {
    usd: Math.round(base * factor),
    why: hit ? hit.why : "generic service",
  };
}

/**
 * Estimate a whole architecture.
 * @param {Array} nodes - Flow Studio state.nodes
 * @returns {{total: number, lines: Array<{name: string, usd: number, why: string}>}}
 */
export function estimateArchitectureCost(nodes = []) {
  const lines = nodes.map((node) => {
    const { usd, why } = estimateNodeCost(node);
    return { name: node?.name || node?.serviceName || "Service", usd, why };
  });
  lines.sort((a, b) => b.usd - a.usd);
  return { total: lines.reduce((sum, line) => sum + line.usd, 0), lines };
}

/** Compact money formatting for the badge ("$1.2k" / "$840"). */
export function formatUsd(value) {
  if (!Number.isFinite(value)) return "$0";
  return value >= 1000
    ? `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`
    : `$${Math.round(value)}`;
}
