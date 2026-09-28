/**
 * Starter architectures, drawn the way an AWS architect would draw them:
 * services placed inside AWS Cloud / Region / VPC / subnet containers, so a
 * template doubles as a demonstration of trust zones coming from containers.
 *
 * Coordinates are world pixels (top-left of each 48 x 48 service icon).
 */

import { createDocument, makeConnection, makeServiceNode, makeShape } from "./model.js";

const USERS = "Users 48 Light";

export const TEMPLATES = {
  serverless: {
    title: "Serverless API",
    summary: "API Gateway + Lambda + DynamoDB",
    groups: [{ key: "cloud", preset: "aws-cloud", x: 170, y: 60, w: 920, h: 480 }],
    nodes: [
      {
        key: "users",
        service: USERS,
        type: "resource",
        name: "Customers",
        x: 60,
        y: 240,
        zone: "internet",
      },
      {
        key: "cdn",
        service: "Amazon CloudFront",
        name: "Global edge",
        x: 250,
        y: 240,
        parent: "cloud",
      },
      { key: "waf", service: "AWS WAF", name: "Edge protection", x: 420, y: 240, parent: "cloud" },
      {
        key: "api",
        service: "Amazon API Gateway",
        name: "Public API",
        x: 590,
        y: 240,
        parent: "cloud",
      },
      {
        key: "fn",
        service: "AWS Lambda",
        name: "Request processor",
        x: 760,
        y: 240,
        parent: "cloud",
      },
      {
        key: "db",
        service: "Amazon DynamoDB",
        name: "Application state",
        x: 960,
        y: 140,
        parent: "cloud",
      },
      {
        key: "s3",
        service: "Amazon Simple Storage Service",
        name: "Object archive",
        x: 960,
        y: 340,
        parent: "cloud",
      },
      {
        key: "cw",
        service: "Amazon CloudWatch",
        name: "Service telemetry",
        x: 760,
        y: 420,
        parent: "cloud",
      },
      {
        key: "idp",
        service: "Amazon Cognito",
        name: "Customer identity",
        x: 590,
        y: 420,
        parent: "cloud",
      },
    ],
    links: [
      ["users", "cdn"],
      ["cdn", "waf"],
      ["waf", "api"],
      ["api", "fn"],
      ["fn", "db"],
      ["fn", "s3"],
      ["fn", "cw"],
      ["idp", "api"],
    ],
  },
  events: {
    title: "Event pipeline",
    summary: "EventBridge + Step Functions + SQS",
    groups: [{ key: "cloud", preset: "aws-cloud", x: 160, y: 60, w: 940, h: 470 }],
    nodes: [
      {
        key: "bus",
        service: "Amazon EventBridge",
        name: "Event ingress",
        x: 220,
        y: 220,
        parent: "cloud",
      },
      {
        key: "flow",
        service: "AWS Step Functions",
        name: "Workflow orchestrator",
        x: 390,
        y: 220,
        parent: "cloud",
      },
      {
        key: "queue",
        service: "Amazon Simple Queue Service",
        name: "Durable work queue",
        x: 560,
        y: 220,
        parent: "cloud",
      },
      { key: "fn", service: "AWS Lambda", name: "Event worker", x: 730, y: 220, parent: "cloud" },
      {
        key: "db",
        service: "Amazon DynamoDB",
        name: "Processing state",
        x: 950,
        y: 130,
        parent: "cloud",
      },
      {
        key: "s3",
        service: "Amazon Simple Storage Service",
        name: "Result archive",
        x: 950,
        y: 320,
        parent: "cloud",
      },
      {
        key: "cw",
        service: "Amazon CloudWatch",
        name: "Pipeline telemetry",
        x: 730,
        y: 410,
        parent: "cloud",
      },
      {
        key: "iam",
        service: "AWS Identity and Access Management",
        name: "Execution roles",
        x: 390,
        y: 410,
        parent: "cloud",
      },
    ],
    links: [
      ["bus", "flow"],
      ["flow", "queue"],
      ["queue", "fn"],
      ["fn", "db"],
      ["fn", "s3"],
      ["fn", "cw"],
      ["iam", "flow"],
    ],
  },
  web: {
    title: "Resilient web app",
    summary: "Route 53 + CloudFront + ALB + EC2 + RDS in a VPC",
    groups: [
      { key: "cloud", preset: "aws-cloud", x: 140, y: 40, w: 1240, h: 660 },
      { key: "region", preset: "region", x: 320, y: 100, w: 1030, h: 570, parent: "cloud" },
      { key: "vpc", preset: "vpc", x: 350, y: 150, w: 790, h: 490, parent: "region" },
      { key: "public", preset: "public-subnet", x: 380, y: 210, w: 210, h: 390, parent: "vpc" },
      {
        key: "app",
        preset: "private-subnet",
        x: 620,
        y: 210,
        w: 230,
        h: 390,
        parent: "vpc",
        label: "App subnet",
      },
      { key: "asg", preset: "auto-scaling-group", x: 640, y: 300, w: 190, h: 170, parent: "app" },
      {
        key: "data",
        preset: "private-subnet",
        x: 880,
        y: 210,
        w: 230,
        h: 390,
        parent: "vpc",
        label: "Data subnet",
        zone: "data",
      },
    ],
    nodes: [
      {
        key: "users",
        service: USERS,
        type: "resource",
        name: "Customers",
        x: 40,
        y: 340,
        zone: "internet",
      },
      {
        key: "dns",
        service: "Amazon Route 53",
        name: "Global DNS",
        x: 210,
        y: 180,
        parent: "cloud",
      },
      {
        key: "cdn",
        service: "Amazon CloudFront",
        name: "Global edge",
        x: 210,
        y: 340,
        parent: "cloud",
      },
      { key: "waf", service: "AWS WAF", name: "Edge protection", x: 210, y: 500, parent: "cloud" },
      {
        key: "alb",
        service: "Elastic Load Balancing",
        name: "Application load balancer",
        x: 461,
        y: 360,
        parent: "public",
      },
      {
        key: "fleet",
        service: "Amazon EC2 Auto Scaling",
        name: "Application fleet",
        x: 711,
        y: 350,
        parent: "asg",
      },
      {
        key: "db",
        service: "Amazon RDS",
        name: "Primary database",
        x: 971,
        y: 360,
        parent: "data",
      },
      {
        key: "s3",
        service: "Amazon Simple Storage Service",
        name: "Static assets",
        x: 1220,
        y: 180,
        parent: "region",
      },
      {
        key: "cw",
        service: "Amazon CloudWatch",
        name: "Operations telemetry",
        x: 1220,
        y: 360,
        parent: "region",
      },
      {
        key: "backup",
        service: "AWS Backup",
        name: "Recovery vault",
        x: 1220,
        y: 540,
        parent: "region",
      },
    ],
    links: [
      ["users", "dns"],
      ["dns", "cdn"],
      ["cdn", "waf"],
      ["waf", "alb"],
      ["alb", "fleet"],
      ["fleet", "db"],
      ["s3", "cdn"],
      ["fleet", "cw"],
      ["db", "backup"],
    ],
  },
  "claude-rag": {
    title: "Claude RAG assistant",
    summary: "API Gateway + Lambda + Claude + vector DB",
    groups: [{ key: "cloud", preset: "aws-cloud", x: 140, y: 60, w: 900, h: 500 }],
    nodes: [
      {
        key: "users",
        service: USERS,
        type: "resource",
        name: "Users",
        x: 40,
        y: 200,
        zone: "internet",
      },
      {
        key: "api",
        service: "Amazon API Gateway",
        name: "Chat API",
        x: 210,
        y: 200,
        parent: "cloud",
      },
      { key: "fn", service: "AWS Lambda", name: "Orchestrator", x: 390, y: 200, parent: "cloud" },
      {
        key: "llm",
        service: "Claude",
        name: "Claude — reasoning",
        x: 570,
        y: 200,
        parent: "cloud",
      },
      {
        key: "guard",
        service: "AI Guardrails",
        name: "Safety filter",
        x: 750,
        y: 200,
        parent: "cloud",
      },
      {
        key: "embed",
        service: "Embeddings Model",
        name: "Embeddings",
        x: 390,
        y: 400,
        parent: "cloud",
      },
      {
        key: "vector",
        service: "Vector Database",
        name: "Knowledge index",
        x: 570,
        y: 400,
        parent: "cloud",
      },
      {
        key: "docs",
        service: "Amazon Simple Storage Service",
        name: "Source documents",
        x: 750,
        y: 400,
        parent: "cloud",
      },
      {
        key: "cw",
        service: "Amazon CloudWatch",
        name: "Token & latency telemetry",
        x: 210,
        y: 400,
        parent: "cloud",
      },
    ],
    links: [
      ["users", "api"],
      ["api", "fn"],
      ["fn", "llm"],
      ["llm", "guard"],
      ["fn", "embed"],
      ["embed", "vector"],
      ["vector", "docs"],
      ["fn", "cw"],
    ],
  },
  "ai-agent": {
    title: "AI agent platform",
    summary: "Agent + model + tools + memory",
    groups: [{ key: "cloud", preset: "aws-cloud", x: 140, y: 60, w: 900, h: 500 }],
    nodes: [
      {
        key: "users",
        service: USERS,
        type: "resource",
        name: "Users",
        x: 40,
        y: 200,
        zone: "internet",
      },
      {
        key: "api",
        service: "Amazon API Gateway",
        name: "Agent API",
        x: 210,
        y: 200,
        parent: "cloud",
      },
      {
        key: "agent",
        service: "AI Agent",
        name: "Planner / orchestrator",
        x: 390,
        y: 200,
        parent: "cloud",
      },
      {
        key: "model",
        service: "Foundation Model",
        name: "Reasoning model",
        x: 570,
        y: 200,
        parent: "cloud",
      },
      {
        key: "guard",
        service: "AI Guardrails",
        name: "Policy guardrails",
        x: 750,
        y: 200,
        parent: "cloud",
      },
      {
        key: "tools",
        service: "AWS Lambda",
        name: "Tool functions",
        x: 390,
        y: 400,
        parent: "cloud",
      },
      {
        key: "memory",
        service: "Amazon DynamoDB",
        name: "Agent memory",
        x: 570,
        y: 400,
        parent: "cloud",
      },
      {
        key: "vector",
        service: "Vector Database",
        name: "Retrieval",
        x: 750,
        y: 400,
        parent: "cloud",
      },
      {
        key: "cw",
        service: "Amazon CloudWatch",
        name: "Traces & evals",
        x: 210,
        y: 400,
        parent: "cloud",
      },
    ],
    links: [
      ["users", "api"],
      ["api", "agent"],
      ["agent", "model"],
      ["model", "guard"],
      ["agent", "tools"],
      ["agent", "memory"],
      ["agent", "vector"],
      ["agent", "cw"],
    ],
  },
  chatbot: {
    title: "GenAI chatbot",
    summary: "CloudFront + Lambda + model + guardrails",
    groups: [{ key: "cloud", preset: "aws-cloud", x: 140, y: 60, w: 980, h: 500 }],
    nodes: [
      {
        key: "users",
        service: USERS,
        type: "resource",
        name: "Users",
        x: 40,
        y: 200,
        zone: "internet",
      },
      { key: "cdn", service: "Amazon CloudFront", name: "Edge", x: 210, y: 200, parent: "cloud" },
      {
        key: "api",
        service: "Amazon API Gateway",
        name: "Chat API",
        x: 390,
        y: 200,
        parent: "cloud",
      },
      { key: "fn", service: "AWS Lambda", name: "Backend", x: 570, y: 200, parent: "cloud" },
      { key: "llm", service: "ChatGPT", name: "ChatGPT", x: 750, y: 200, parent: "cloud" },
      {
        key: "guard",
        service: "AI Guardrails",
        name: "Moderation",
        x: 930,
        y: 200,
        parent: "cloud",
      },
      {
        key: "auth",
        service: "Amazon Cognito",
        name: "Customer auth",
        x: 390,
        y: 400,
        parent: "cloud",
      },
      {
        key: "cw",
        service: "Amazon CloudWatch",
        name: "Telemetry",
        x: 570,
        y: 400,
        parent: "cloud",
      },
      {
        key: "history",
        service: "Amazon DynamoDB",
        name: "Conversation history",
        x: 750,
        y: 400,
        parent: "cloud",
      },
    ],
    links: [
      ["users", "cdn"],
      ["cdn", "api"],
      ["api", "fn"],
      ["fn", "llm"],
      ["llm", "guard"],
      ["auth", "api"],
      ["fn", "history"],
      ["fn", "cw"],
    ],
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

/**
 * Build a template as a document.
 *
 * @param {string} id
 * @param {{findIcon: (name: string, type?: string) => object|null, connectionDefaults?: Function, environment?: string}} options
 * @returns {object|null}
 */
export function buildTemplate(
  id,
  { findIcon, connectionDefaults = () => ({}), environment = "Production" } = {}
) {
  const template = TEMPLATES[id];
  if (!template) return null;
  const doc = createDocument({ name: template.title });
  const keys = new Map();
  template.groups.forEach((group, index) => {
    const shape = makeShape("container", {
      preset: group.preset,
      x: group.x,
      y: group.y,
      w: group.w,
      h: group.h,
      label: group.label,
      zone: group.zone,
      z: -(template.groups.length - index),
    });
    keys.set(group.key, shape.id);
    doc.shapes.push(shape);
  });
  template.groups.forEach((group) => {
    if (group.parent)
      doc.shapes.find((shape) => shape.id === keys.get(group.key)).parent = keys.get(group.parent);
  });
  template.nodes.forEach((entry, index) => {
    const icon = findIcon(entry.service, entry.type || "service");
    if (!icon) throw new Error(`Missing icon for template service: ${entry.service}`);
    const node = makeServiceNode(icon, {
      name: entry.name,
      x: entry.x,
      y: entry.y,
      z: index + 1,
      parent: entry.parent ? keys.get(entry.parent) : null,
      zone: entry.zone,
      environment,
      criticality: index < 4 ? "high" : "medium",
      notes: `${icon.name} in the ${template.title} reference architecture.`,
    });
    keys.set(entry.key, node.id);
    doc.nodes.push(node);
  });
  // Services sitting in a zoned container take on its zone.
  for (const node of doc.nodes) {
    const entry = template.nodes.find((candidate) => keys.get(candidate.key) === node.id);
    if (entry?.zone) continue;
    let parent = doc.shapes.find((shape) => shape.id === node.parent);
    while (parent) {
      const group = template.groups.find((candidate) => keys.get(candidate.key) === parent.id);
      const zone =
        group?.zone ||
        (parent.preset === "public-subnet"
          ? "public"
          : parent.preset === "private-subnet"
            ? "private"
            : null);
      if (zone) {
        node.zone = zone;
        break;
      }
      parent = doc.shapes.find((shape) => shape.id === parent.parent);
    }
  }
  template.links.forEach(([from, to]) => {
    const source = doc.nodes.find((node) => node.id === keys.get(from));
    const target = doc.nodes.find((node) => node.id === keys.get(to));
    doc.connections.push(makeConnection(source.id, target.id, connectionDefaults(source, target)));
  });
  return doc;
}
