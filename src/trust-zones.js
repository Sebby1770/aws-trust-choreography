/**
 * Trust zones and boundary analysis — the primitive this project is named for.
 *
 * Every service sits in a zone, zones have a trust level, and a connection that
 * crosses between them is a *trust boundary crossing*. Crossings are where the
 * interesting failures live: untrusted traffic reaching internal compute, a
 * datastore answering the public internet, plaintext on a boundary, an
 * exfiltration path out of the data tier.
 *
 * Design notes worth knowing before changing the rules:
 *
 *  - **Management is cross-cutting.** IAM, KMS, Secrets Manager, CloudWatch and
 *    friends are a control plane that legitimately talks to every tier, so
 *    crossings to or from it are never counted as tier jumps.
 *  - **`edge → data` is not a finding.** CloudFront in front of an S3 origin is
 *    one of the most common correct AWS patterns. Flagging it would make the
 *    whole analysis read as noise, so it is recognised explicitly instead.
 *  - The rules below only judge what the diagram states. Nothing here inspects
 *    a live account, so this is design review, never certification.
 */

/**
 * Zones, outermost (least trusted) first. `trust` is an ordinal tier used to
 * decide whether a crossing steps inward one tier or skips past one.
 */
export const ZONES = {
  internet: {
    label: "Internet",
    trust: 0,
    hint: "Untrusted callers outside your control",
  },
  edge: {
    label: "Edge",
    trust: 1,
    hint: "AWS edge and managed entry points, outside the VPC",
  },
  public: {
    label: "Public subnet",
    trust: 2,
    hint: "Inside the VPC, routable from the internet",
  },
  private: {
    label: "Private subnet",
    trust: 3,
    hint: "Inside the VPC, no inbound internet route",
  },
  data: {
    label: "Data tier",
    trust: 4,
    hint: "Persistent state — the thing an attacker actually wants",
  },
  management: {
    label: "Management",
    trust: 3,
    hint: "Identity, secrets, and telemetry control plane",
  },
};

export const ZONE_IDS = Object.keys(ZONES);
export const DEFAULT_ZONE = "private";

/** Service-name fragments → zone, checked in order. */
const ZONE_BY_SERVICE = [
  [
    [
      "cloudfront",
      "route 53",
      "global accelerator",
      "waf",
      "shield",
      "api gateway",
      "appsync",
      "amplify",
    ],
    "edge",
  ],
  [["load balancing", "elastic load", "nat gateway", "bastion", "transit gateway"], "public"],
  [
    [
      "dynamodb",
      "simple storage",
      "aurora",
      "amazon rds",
      "elasticache",
      "redshift",
      "opensearch",
      "elasticsearch",
      "neptune",
      "documentdb",
      "efs",
      "elastic file",
      "backup",
      "glacier",
      "timestream",
      "memorydb",
      "athena",
    ],
    "data",
  ],
  [
    [
      "identity and access",
      "cognito",
      "key management",
      "secrets manager",
      "certificate manager",
      "systems manager",
      "cloudtrail",
      "cloudwatch",
      "x ray",
      "x-ray",
      "config",
      "guardduty",
      "security hub",
    ],
    "management",
  ],
];

/** Normalise an arbitrary value to a known zone id. */
export function normalizeZone(value, fallback = DEFAULT_ZONE) {
  const zone = String(value || "").toLowerCase();
  return ZONE_IDS.includes(zone) ? zone : fallback;
}

/** Trust tier for a zone. */
export function zoneTrust(zone) {
  return ZONES[normalizeZone(zone)]?.trust ?? ZONES[DEFAULT_ZONE].trust;
}

/**
 * Guess a zone from a service name, so an existing diagram gains trust
 * placement without anyone re-labelling every node by hand.
 */
export function inferZone(serviceName, name = "") {
  const haystack = `${serviceName || ""} ${name || ""}`.toLowerCase();
  if (!haystack.trim()) return DEFAULT_ZONE;
  for (const [fragments, zone] of ZONE_BY_SERVICE) {
    if (fragments.some((fragment) => haystack.includes(fragment))) return zone;
  }
  return DEFAULT_ZONE;
}

/** The zone a node declares, falling back to what its service implies. */
export function zoneOf(node) {
  if (!node) return DEFAULT_ZONE;
  const declared = String(node.zone || "").toLowerCase();
  if (ZONE_IDS.includes(declared)) return declared;
  return inferZone(node.serviceName, node.name);
}

/**
 * Describe what a connection between two zones is.
 *
 * @returns {{kind: string, jump: number, from: string, to: string}}
 *   kind is one of: internal, management, ingress, egress, bypass, step, outbound
 */
export function classifyCrossing(fromZone, toZone) {
  const from = normalizeZone(fromZone);
  const to = normalizeZone(toZone);
  if (from === to) return { kind: "internal", jump: 0, from, to };
  // Control-plane traffic is expected from every tier — never a tier jump.
  if (from === "management" || to === "management") {
    return { kind: "management", jump: 0, from, to };
  }
  const jump = zoneTrust(to) - zoneTrust(from);
  if (from === "internet") return { kind: "ingress", jump, from, to };
  if (to === "internet") return { kind: "egress", jump, from, to };
  if (jump > 0) {
    // A multi-tier jump is only a *bypass* when it lands on persistent storage
    // with no application tier in front. Skipping a subnet tier is not itself
    // suspicious: API Gateway → Lambda never touches a subnet, and calling the
    // canonical serverless shape a bypass would make the analysis useless.
    const skipsApplicationTier = to === "data" && zoneTrust(from) < zoneTrust("private");
    return { kind: skipsApplicationTier ? "bypass" : "step", jump, from, to };
  }
  return { kind: "outbound", jump, from, to };
}

/** True when a crossing leaves one zone for another at all. */
export function isBoundaryCrossing(fromZone, toZone) {
  return classifyCrossing(fromZone, toZone).kind !== "internal";
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function threat(id, severity, title, detail, mitigation, target = null) {
  return { id, severity, title, detail, mitigation, target };
}

/**
 * Analyse the trust posture of an architecture.
 *
 * @param {{nodes?: Array, connections?: Array}} input
 * @returns {{
 *   zones: object, entries: string[], reachable: string[],
 *   crossings: Array, threats: Array, score: number,
 *   hasIngress: boolean, guardedIngress: boolean, identifiedIngress: boolean,
 *   recognised: Array
 * }}
 */
export function analyzeTrust(input = {}) {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const connections = Array.isArray(input.connections) ? input.connections : [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const zoneFor = new Map(nodes.map((node) => [node.id, zoneOf(node)]));

  const zones = {};
  for (const zone of zoneFor.values()) zones[zone] = (zones[zone] || 0) + 1;

  const inDegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const connection of connections) {
    if (!byId.has(connection.from) || !byId.has(connection.to)) continue;
    inDegree.set(connection.to, (inDegree.get(connection.to) || 0) + 1);
    outgoing.get(connection.from).push(connection.to);
  }

  // Entry points: anything explicitly on the internet, plus outward-facing
  // services nothing else calls — those are where untrusted traffic arrives.
  let entries = nodes
    .filter((node) => {
      const zone = zoneFor.get(node.id);
      if (zone === "internet") return true;
      return (zone === "edge" || zone === "public") && !inDegree.get(node.id);
    })
    .map((node) => node.id);
  if (!entries.length) {
    entries = nodes
      .filter((node) => ["internet", "edge", "public"].includes(zoneFor.get(node.id)))
      .map((node) => node.id);
  }

  // Everything untrusted traffic can eventually touch.
  const reachable = new Set();
  const queue = [...entries];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of outgoing.get(id) || []) queue.push(next);
  }

  const crossings = [];
  for (const connection of connections) {
    const from = byId.get(connection.from);
    const to = byId.get(connection.to);
    if (!from || !to) continue;
    const fromZone = zoneFor.get(from.id);
    const toZone = zoneFor.get(to.id);
    const classified = classifyCrossing(fromZone, toZone);
    // Node ids and zone ids are kept in separately named fields on purpose:
    // spreading the classification over `from`/`to` would silently replace the
    // node ids with zone ids, and every threat target would point at a zone.
    crossings.push({
      connectionId: connection.id || null,
      fromId: from.id,
      toId: to.id,
      fromName: from.name || from.serviceName || from.id,
      toName: to.name || to.serviceName || to.id,
      fromZone: classified.from,
      toZone: classified.to,
      kind: classified.kind,
      jump: classified.jump,
      encrypted: connection.encrypted !== false,
    });
  }

  const boundary = crossings.filter((crossing) => crossing.kind !== "internal");
  const threats = [];
  const recognised = [];

  // --- Plaintext on a trust boundary -------------------------------------
  const plaintext = boundary.filter((crossing) => !crossing.encrypted);
  for (const crossing of plaintext.slice(0, 3)) {
    const critical = crossing.kind === "ingress";
    threats.push(
      threat(
        `plaintext-${crossing.connectionId || `${crossing.fromId}-${crossing.toId}`}`,
        critical ? "critical" : "high",
        `Plaintext across a trust boundary: ${crossing.fromName} → ${crossing.toName}`,
        `This path leaves ${ZONES[crossing.fromZone].label} for ${ZONES[crossing.toZone].label} with in-transit encryption switched off, so anything on the wire between them can read or alter it.`,
        "Enable TLS on this path, then mark the connection encrypted.",
        { kind: "connection", id: crossing.connectionId, field: "encrypted" }
      )
    );
  }

  // --- Untrusted traffic reaching too far in ------------------------------
  for (const crossing of boundary) {
    if (crossing.fromZone !== "internet") continue;
    if (crossing.toZone === "data") {
      threats.push(
        threat(
          `exposed-data-${crossing.toId}`,
          "critical",
          `Data tier answers the internet directly: ${crossing.toName}`,
          `${crossing.toName} holds persistent state and takes traffic straight from the internet with no edge or application tier in front of it.`,
          "Put an application tier in front of it and move the datastore into a private subnet.",
          { kind: "node", id: crossing.toId }
        )
      );
    } else if (crossing.toZone === "private") {
      threats.push(
        threat(
          `unmediated-private-${crossing.toId}`,
          "high",
          `Internet reaches internal compute unmediated: ${crossing.toName}`,
          `Traffic arrives from the internet into ${ZONES.private.label} without passing an edge or public tier that could filter it.`,
          "Route this through an edge service or load balancer so there is somewhere to apply filtering.",
          { kind: "node", id: crossing.toId }
        )
      );
    }
  }

  // --- Exfiltration paths out of the data tier ----------------------------
  for (const crossing of boundary) {
    if (crossing.fromZone === "data" && ["internet", "edge"].includes(crossing.toZone)) {
      threats.push(
        threat(
          `data-egress-${crossing.connectionId || crossing.fromId}`,
          "high",
          `Outbound path from the data tier: ${crossing.fromName} → ${crossing.toName}`,
          "A path leads outward from persistent storage, which is the shape a data-exfiltration route takes.",
          "Confirm this egress is required; if it is, constrain it with an endpoint policy or egress filtering.",
          { kind: "connection", id: crossing.connectionId }
        )
      );
    }
  }

  // --- Guarding the front door -------------------------------------------
  const isGuard = (node) => /waf|shield/i.test(`${node.serviceName || ""} ${node.name || ""}`);
  const isIdentity = (node) =>
    /identity and access|\biam\b|cognito|identity center/i.test(
      `${node.serviceName || ""} ${node.name || ""}`
    );

  const hasIngress = entries.length > 0 && nodes.length > 1;
  const guards = nodes.filter(isGuard);
  const connectedIds = new Set(
    connections.flatMap((connection) => [connection.from, connection.to])
  );
  // A guard only counts if it is on the ingress path — an unconnected WAF
  // parked in a corner of the canvas protects nothing.
  const guardedIngress = guards.some((node) => connectedIds.has(node.id) && reachable.has(node.id));
  const identities = nodes.filter(isIdentity);
  const identifiedIngress = identities.some((node) => connectedIds.has(node.id));

  if (hasIngress && guards.length && !guardedIngress) {
    threats.push(
      threat(
        "guard-off-path",
        "high",
        "Edge protection is not on the traffic path",
        `${guards[0].name || "A WAF or Shield control"} is on the canvas but is not connected to anything untrusted traffic passes through, so it filters nothing.`,
        "Connect it into the ingress path in front of the public entry point.",
        { kind: "node", id: guards[0].id }
      )
    );
  } else if (hasIngress && !guards.length) {
    threats.push(
      threat(
        "guard-missing",
        "medium",
        "No edge protection in front of the public entry point",
        "Untrusted traffic enters with no WAF or Shield control represented anywhere on the path.",
        "Add AWS WAF (or Shield for volumetric attacks) in front of the public entry point.",
        { kind: "library", query: "WAF" }
      )
    );
  }

  if (hasIngress && !identifiedIngress) {
    threats.push(
      threat(
        "identity-missing",
        "medium",
        "Nothing establishes who the caller is",
        "Traffic crosses into your architecture with no identity control represented, so every request is anonymous by design.",
        "Add Cognito, IAM, or IAM Identity Center and connect it to the entry path.",
        { kind: "library", query: "Cognito" }
      )
    );
  }

  // --- Patterns worth acknowledging rather than flagging ------------------
  for (const crossing of boundary) {
    if (crossing.fromZone === "edge" && crossing.toZone === "data") {
      recognised.push(
        `${crossing.fromName} → ${crossing.toName} is a recognised edge-to-origin pattern, not a boundary bypass.`
      );
    }
  }

  // --- Posture score ------------------------------------------------------
  let score = 100;
  score -= Math.min(36, plaintext.length * 12);
  for (const item of threats) {
    if (item.id.startsWith("exposed-data")) score -= 30;
    else if (item.id.startsWith("unmediated-private")) score -= 15;
    else if (item.id.startsWith("data-egress")) score -= 15;
  }
  if (hasIngress && !guardedIngress) score -= 12;
  if (hasIngress && !identifiedIngress) score -= 10;
  if (!boundary.length && nodes.length > 1) {
    // A multi-service design with no crossings at all usually means every node
    // was left on its inferred default rather than actually placed.
    score = Math.min(score, 70);
  }

  return {
    zones,
    entries,
    reachable: [...reachable],
    crossings,
    boundaryCount: boundary.length,
    threats,
    recognised,
    hasIngress,
    guardedIngress,
    identifiedIngress,
    score: clamp(Math.round(score)),
  };
}
