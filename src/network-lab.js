/**
 * Network Lab
 *
 * A small, dependency-free network diagram engine. The pure helpers at the
 * top of this file keep imported projects, starter templates, packet routing,
 * and architecture checks deterministic and easy to test.
 */

const STORAGE_KEY = "trust-choreography:network-lab:v1";
const STATE_VERSION = 1;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const NODE_WIDTH = 112;
const NODE_HEIGHT = 72;
const HISTORY_LIMIT = 60;

const DEVICE_CATEGORIES = Object.freeze(["endpoints", "network", "servers", "cloud-security"]);
const NODE_STATUSES = Object.freeze(["online", "offline", "maintenance"]);

function freezeCatalog(items) {
  items.forEach((item) => Object.freeze(item));
  return Object.freeze(items);
}

/**
 * Device glyphs are intentionally text, rather than inline SVG. They stay
 * legible at small sizes and can be restyled by the surrounding application.
 */
export const NETWORK_DEVICES = freezeCatalog([
  {
    id: "pc",
    name: "PC",
    category: "endpoints",
    glyph: "▣",
    description: "A wired desktop computer used by a person.",
  },
  {
    id: "laptop",
    name: "Laptop",
    category: "endpoints",
    glyph: "▰",
    description: "A portable wired or wireless computer.",
  },
  {
    id: "printer",
    name: "Printer",
    category: "endpoints",
    glyph: "▤",
    description: "A shared network printer.",
  },
  {
    id: "ip-phone",
    name: "IP phone",
    category: "endpoints",
    glyph: "☎",
    description: "A voice endpoint connected over Ethernet.",
  },
  {
    id: "router",
    name: "Router",
    category: "network",
    glyph: "↔",
    description: "Moves traffic between different networks.",
  },
  {
    id: "l2-switch",
    name: "Layer 2 switch",
    category: "network",
    glyph: "⇆",
    description: "Connects devices inside the same local network.",
  },
  {
    id: "l3-switch",
    name: "Layer 3 switch",
    category: "network",
    glyph: "⇄",
    description: "Switches locally and routes between VLANs.",
  },
  {
    id: "wireless-ap",
    name: "Wireless access point",
    category: "network",
    glyph: "⌁",
    description: "Connects Wi-Fi devices to the wired network.",
  },
  {
    id: "web-server",
    name: "Web server",
    category: "servers",
    glyph: "W",
    description: "Serves websites and HTTP applications.",
    service: "web",
  },
  {
    id: "dns-server",
    name: "DNS server",
    category: "servers",
    glyph: "D",
    description: "Translates names into IP addresses.",
    service: "dns",
  },
  {
    id: "dhcp-server",
    name: "DHCP server",
    category: "servers",
    glyph: "H",
    description: "Automatically assigns network addresses.",
    service: "dhcp",
  },
  {
    id: "database-server",
    name: "Database server",
    category: "servers",
    glyph: "DB",
    description: "Stores structured application data.",
    service: "database",
  },
  {
    id: "mail-server",
    name: "Mail server",
    category: "servers",
    glyph: "@",
    description: "Sends and receives email.",
    service: "mail",
  },
  {
    id: "linux-server",
    name: "Linux server",
    category: "servers",
    glyph: "L",
    description: "A general-purpose Linux workload.",
    service: "compute",
  },
  {
    id: "windows-server",
    name: "Windows server",
    category: "servers",
    glyph: "⊞",
    description: "A general-purpose Windows workload.",
    service: "compute",
  },
  {
    id: "firewall",
    name: "Firewall",
    category: "cloud-security",
    glyph: "▦",
    description: "Inspects and controls traffic between trust zones.",
    security: true,
  },
  {
    id: "load-balancer",
    name: "Load balancer",
    category: "cloud-security",
    glyph: "⑂",
    description: "Distributes requests across healthy servers.",
  },
  {
    id: "internet",
    name: "Internet",
    category: "cloud-security",
    glyph: "◎",
    description: "The public network outside your organisation.",
    external: true,
  },
  {
    id: "cloud",
    name: "Cloud",
    category: "cloud-security",
    glyph: "☁",
    description: "A public or private cloud environment.",
    external: true,
  },
  {
    id: "vpn-gateway",
    name: "VPN gateway",
    category: "cloud-security",
    glyph: "◇",
    description: "Creates an encrypted connection between networks.",
    security: true,
  },
]);

const DEVICE_BY_ID = new Map(NETWORK_DEVICES.map((device) => [device.id, device]));

function node(id, type, name, x, y, ip = "", subnet = "", vlan = "", notes = "") {
  return {
    id,
    type,
    name,
    x,
    y,
    ip,
    subnet,
    vlan,
    status: "online",
    notes,
  };
}

function link(id, source, target, label = "Ethernet") {
  return { id, source, target, label };
}

function template(id, name, description, nodes, links) {
  return {
    version: STATE_VERSION,
    template: id,
    name,
    description,
    nodes,
    links,
    selectedNodeId: null,
    selectedLinkId: null,
  };
}

const templateDefinitions = {
  blank: template(
    "blank",
    "Untitled network",
    "Start with an empty canvas and add only what you need.",
    [],
    []
  ),
  "small-office": template(
    "small-office",
    "Small office network",
    "A secure internet connection, wired and wireless users, printing, and core services.",
    [
      node("so-internet", "internet", "Internet", 70, 255),
      node("so-firewall", "firewall", "Office firewall", 260, 255, "203.0.113.2", "30"),
      node("so-router", "router", "Office router", 450, 255, "192.168.10.1", "24"),
      node("so-switch", "l2-switch", "Access switch", 650, 170, "192.168.10.2", "24", "10"),
      node("so-ap", "wireless-ap", "Office Wi-Fi", 650, 350, "192.168.10.3", "24", "10"),
      node("so-pc", "pc", "Reception PC", 800, 75, "192.168.10.21", "24", "10"),
      node("so-printer", "printer", "Shared printer", 800, 190, "192.168.10.41", "24", "10"),
      node("so-laptop", "laptop", "Team laptop", 800, 340, "192.168.10.31", "24", "10"),
      node("so-services", "dhcp-server", "DHCP service", 650, 410, "192.168.10.10", "24", "10"),
      node("so-dns", "dns-server", "DNS service", 800, 410, "192.168.10.11", "24", "10"),
    ],
    [
      link("so-l1", "so-internet", "so-firewall", "WAN"),
      link("so-l2", "so-firewall", "so-router", "Ethernet"),
      link("so-l3", "so-router", "so-switch", "Trunk"),
      link("so-l4", "so-router", "so-ap", "Ethernet"),
      link("so-l5", "so-switch", "so-pc", "Access"),
      link("so-l6", "so-switch", "so-printer", "Access"),
      link("so-l7", "so-ap", "so-laptop", "Wi-Fi"),
      link("so-l8", "so-switch", "so-services", "Access"),
      link("so-l9", "so-services", "so-dns", "Service"),
    ]
  ),
  "three-tier": template(
    "three-tier",
    "Three-tier application",
    "A protected web application separated into web, application, and data tiers.",
    [
      node("tt-internet", "internet", "Internet", 55, 260),
      node("tt-firewall", "firewall", "Edge firewall", 220, 260, "198.51.100.2", "30"),
      node("tt-lb", "load-balancer", "Public load balancer", 395, 260, "10.20.0.10", "24", "10"),
      node("tt-web-a", "web-server", "Web server A", 590, 120, "10.20.10.11", "24", "10"),
      node("tt-web-b", "web-server", "Web server B", 590, 390, "10.20.10.12", "24", "10"),
      node("tt-app-a", "linux-server", "Application server A", 790, 120, "10.20.20.11", "24", "20"),
      node("tt-app-b", "linux-server", "Application server B", 790, 390, "10.20.20.12", "24", "20"),
      node("tt-db-a", "database-server", "Primary database", 1000, 180, "10.20.30.11", "24", "30"),
      node("tt-db-b", "database-server", "Database replica", 1000, 345, "10.20.30.12", "24", "30"),
      node("tt-dns", "dns-server", "Application DNS", 395, 470, "10.20.0.53", "24", "10"),
    ],
    [
      link("tt-l1", "tt-internet", "tt-firewall", "HTTPS"),
      link("tt-l2", "tt-firewall", "tt-lb", "HTTPS"),
      link("tt-l3", "tt-lb", "tt-web-a", "HTTPS"),
      link("tt-l4", "tt-lb", "tt-web-b", "HTTPS"),
      link("tt-l5", "tt-web-a", "tt-app-a", "API"),
      link("tt-l6", "tt-web-b", "tt-app-b", "API"),
      link("tt-l7", "tt-web-a", "tt-app-b", "Failover"),
      link("tt-l8", "tt-web-b", "tt-app-a", "Failover"),
      link("tt-l9", "tt-app-a", "tt-db-a", "SQL"),
      link("tt-l10", "tt-app-b", "tt-db-a", "SQL"),
      link("tt-l11", "tt-db-a", "tt-db-b", "Replication"),
      link("tt-l12", "tt-lb", "tt-dns", "DNS"),
    ]
  ),
  campus: template(
    "campus",
    "Campus network",
    "A redundant campus core with separate user, voice, wireless, and service networks.",
    [
      node("ca-internet", "internet", "Internet", 50, 275),
      node("ca-firewall", "firewall", "Campus firewall", 205, 275, "203.0.113.10", "30"),
      node("ca-core-a", "l3-switch", "Core switch A", 385, 170, "10.0.0.2", "24"),
      node("ca-core-b", "l3-switch", "Core switch B", 385, 385, "10.0.0.3", "24"),
      node("ca-access-a", "l2-switch", "Building A switch", 590, 120, "10.0.10.2", "24", "10"),
      node("ca-access-b", "l2-switch", "Building B switch", 590, 430, "10.0.20.2", "24", "20"),
      node("ca-ap", "wireless-ap", "Campus Wi-Fi", 790, 75, "10.0.30.2", "24", "30"),
      node("ca-pc", "pc", "Lab PC", 790, 215, "10.0.10.21", "24", "10"),
      node("ca-phone", "ip-phone", "Office phone", 790, 430, "10.0.20.31", "24", "20"),
      node("ca-laptop", "laptop", "Student laptop", 980, 75, "10.0.30.41", "24", "30"),
      node("ca-dhcp", "dhcp-server", "Campus DHCP", 980, 285, "10.0.40.10", "24", "40"),
      node("ca-dns", "dns-server", "Campus DNS", 980, 430, "10.0.40.11", "24", "40"),
    ],
    [
      link("ca-l1", "ca-internet", "ca-firewall", "WAN"),
      link("ca-l2", "ca-firewall", "ca-core-a", "Routed"),
      link("ca-l3", "ca-firewall", "ca-core-b", "Routed"),
      link("ca-l4", "ca-core-a", "ca-core-b", "Core link"),
      link("ca-l5", "ca-core-a", "ca-access-a", "Trunk"),
      link("ca-l6", "ca-core-b", "ca-access-a", "Backup"),
      link("ca-l7", "ca-core-a", "ca-access-b", "Backup"),
      link("ca-l8", "ca-core-b", "ca-access-b", "Trunk"),
      link("ca-l9", "ca-access-a", "ca-ap", "Trunk"),
      link("ca-l10", "ca-access-a", "ca-pc", "Access"),
      link("ca-l11", "ca-access-b", "ca-phone", "Voice"),
      link("ca-l12", "ca-ap", "ca-laptop", "Wi-Fi"),
      link("ca-l13", "ca-core-a", "ca-dhcp", "Services"),
      link("ca-l14", "ca-core-b", "ca-dns", "Services"),
      link("ca-l15", "ca-dhcp", "ca-dns", "Service sync"),
    ]
  ),
  hybrid: template(
    "hybrid",
    "Hybrid cloud network",
    "An on-premises network connected securely to cloud services over a VPN.",
    [
      node("hy-internet", "internet", "Internet", 455, 45),
      node("hy-router", "router", "Edge router", 255, 185, "198.51.100.14", "30"),
      node("hy-firewall", "firewall", "On-prem firewall", 255, 335, "10.50.0.1", "24"),
      node("hy-core", "l3-switch", "Data centre core", 255, 485, "10.50.0.2", "24"),
      node("hy-linux", "linux-server", "On-prem application", 55, 625, "10.50.10.11", "24", "10"),
      node("hy-db", "database-server", "On-prem database", 255, 625, "10.50.20.11", "24", "20"),
      node("hy-vpn", "vpn-gateway", "On-prem VPN", 455, 260, "169.254.20.1", "30"),
      node("hy-cloud-vpn", "vpn-gateway", "Cloud VPN gateway", 675, 260, "169.254.20.2", "30"),
      node("hy-cloud", "cloud", "Cloud network", 675, 425, "10.80.0.1", "16"),
      node("hy-lb", "load-balancer", "Cloud load balancer", 870, 325, "10.80.10.10", "24", "10"),
      node("hy-web", "web-server", "Cloud web service", 1060, 225, "10.80.20.11", "24", "20"),
      node("hy-dns", "dns-server", "Hybrid DNS", 870, 525, "10.80.0.53", "24", "10"),
      node(
        "hy-cloud-db",
        "database-server",
        "Cloud database replica",
        1060,
        525,
        "10.80.30.11",
        "24",
        "30"
      ),
    ],
    [
      link("hy-l1", "hy-internet", "hy-router", "WAN"),
      link("hy-l2", "hy-router", "hy-firewall", "Routed"),
      link("hy-l3", "hy-firewall", "hy-core", "Routed"),
      link("hy-l4", "hy-core", "hy-linux", "VLAN 10"),
      link("hy-l5", "hy-core", "hy-db", "VLAN 20"),
      link("hy-l6", "hy-router", "hy-vpn", "IPsec"),
      link("hy-l7", "hy-vpn", "hy-cloud-vpn", "Encrypted tunnel"),
      link("hy-l8", "hy-cloud-vpn", "hy-cloud", "Private route"),
      link("hy-l9", "hy-cloud", "hy-lb", "VLAN 10"),
      link("hy-l10", "hy-lb", "hy-web", "HTTPS"),
      link("hy-l11", "hy-cloud", "hy-dns", "DNS"),
      link("hy-l12", "hy-cloud", "hy-cloud-db", "VLAN 30"),
      link("hy-l13", "hy-db", "hy-cloud-db", "Replication"),
    ]
  ),
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const NETWORK_TEMPLATES = deepFreeze(templateDefinitions);

function textValue(value, fallback = "", limit = 160) {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const result = String(value).trim();
  return (result || fallback).slice(0, limit);
}

function finitePosition(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(5000, Math.round(parsed)));
}

function uniqueId(rawId, prefix, used, index) {
  const base = textValue(rawId, `${prefix}-${index + 1}`, 80).replace(/[^\w-]/g, "-");
  let id = base || `${prefix}-${index + 1}`;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function cloneState(state) {
  return {
    ...state,
    nodes: state.nodes.map((item) => ({ ...item })),
    links: state.links.map((item) => ({ ...item })),
  };
}

/**
 * Turn imported, saved, or partial topology data into a safe canonical state.
 * Unknown device types and links to missing nodes are ignored.
 */
export function normalizeNetworkState(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const usedNodeIds = new Set();
  const sourceIdToNormalizedId = new Map();
  const nodes = [];

  rawNodes.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const type = textValue(item.type ?? item.deviceId ?? item.device, "", 40);
    const device = DEVICE_BY_ID.get(type);
    if (!device) return;
    const id = uniqueId(item.id, "node", usedNodeIds, index);
    const originalId = textValue(item.id, "", 80);
    if (originalId && !sourceIdToNormalizedId.has(originalId)) {
      sourceIdToNormalizedId.set(originalId, id);
    }
    const status = NODE_STATUSES.includes(item.status) ? item.status : "online";
    nodes.push({
      id,
      type,
      name: textValue(item.name, device.name, 80),
      x: finitePosition(item.x, 80 + (index % 4) * 190),
      y: finitePosition(item.y, 80 + Math.floor(index / 4) * 130),
      ip: textValue(item.ip ?? item.ipAddress, "", 50),
      subnet: textValue(item.subnet ?? item.prefix, "", 50),
      vlan: textValue(item.vlan, "", 24),
      status,
      notes: textValue(item.notes, "", 1000),
    });
  });

  const nodeIds = new Set(nodes.map((item) => item.id));
  const resolveNodeId = (value) => {
    const rawId = textValue(value, "", 80);
    if (nodeIds.has(rawId)) return rawId;
    return sourceIdToNormalizedId.get(rawId) || "";
  };
  const rawLinks = Array.isArray(raw.links)
    ? raw.links
    : Array.isArray(raw.connections)
      ? raw.connections
      : Array.isArray(raw.edges)
        ? raw.edges
        : [];
  const usedLinkIds = new Set();
  const connectedPairs = new Set();
  const links = [];

  rawLinks.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const source = resolveNodeId(item.source ?? item.from);
    const target = resolveNodeId(item.target ?? item.to);
    if (!source || !target || source === target) return;
    const pair = [source, target].sort().join("::");
    if (connectedPairs.has(pair)) return;
    connectedPairs.add(pair);
    links.push({
      id: uniqueId(item.id, "link", usedLinkIds, index),
      source,
      target,
      label: textValue(item.label, "Ethernet", 60),
    });
  });

  const selectedNodeId = nodeIds.has(raw.selectedNodeId) ? raw.selectedNodeId : null;
  const selectedLinkId = links.some((item) => item.id === raw.selectedLinkId)
    ? raw.selectedLinkId
    : null;
  const templateId = Object.hasOwn(NETWORK_TEMPLATES, raw.template) ? raw.template : "blank";

  return {
    version: STATE_VERSION,
    template: templateId,
    name: textValue(raw.name ?? raw.architectureName, "Untitled network", 100),
    description: textValue(raw.description, "", 300),
    nodes,
    links,
    selectedNodeId,
    selectedLinkId,
  };
}

function pathArguments(graphOrNodes, linksOrSource, sourceOrTarget, possibleTarget) {
  if (Array.isArray(graphOrNodes) && Array.isArray(linksOrSource)) {
    return {
      nodes: graphOrNodes,
      links: linksOrSource,
      sourceId: sourceOrTarget,
      targetId: possibleTarget,
    };
  }
  const graph = graphOrNodes && typeof graphOrNodes === "object" ? graphOrNodes : {};
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
    links: Array.isArray(graph.links)
      ? graph.links
      : Array.isArray(graph.connections)
        ? graph.connections
        : [],
    sourceId: linksOrSource,
    targetId: sourceOrTarget,
  };
}

/**
 * Find the shortest available packet route using breadth-first search.
 *
 * Accepts either `(state, sourceId, targetId)` or
 * `(nodes, links, sourceId, targetId)`. Offline devices are unavailable.
 */
export function findNetworkPath(graphOrNodes, linksOrSource, sourceOrTarget, possibleTarget) {
  const { nodes, links, sourceId, targetId } = pathArguments(
    graphOrNodes,
    linksOrSource,
    sourceOrTarget,
    possibleTarget
  );
  const available = new Set(
    nodes.filter((item) => item?.status !== "offline").map((item) => String(item.id))
  );
  const start = String(sourceId ?? "");
  const finish = String(targetId ?? "");
  if (!available.has(start) || !available.has(finish)) return [];
  if (start === finish) return [start];

  const neighbours = new Map([...available].map((id) => [id, []]));
  links.forEach((item) => {
    const source = String(item?.source ?? item?.from ?? "");
    const target = String(item?.target ?? item?.to ?? "");
    if (!available.has(source) || !available.has(target) || source === target) return;
    neighbours.get(source).push(target);
    neighbours.get(target).push(source);
  });

  const queue = [start];
  const previous = new Map([[start, null]]);
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    for (const neighbour of neighbours.get(current) || []) {
      if (previous.has(neighbour)) continue;
      previous.set(neighbour, current);
      if (neighbour === finish) {
        const path = [finish];
        let step = current;
        while (step !== null) {
          path.push(step);
          step = previous.get(step);
        }
        return path.reverse();
      }
      queue.push(neighbour);
    }
  }
  return [];
}

function validIpv4(value) {
  const address = String(value || "").split("/")[0];
  const octets = address.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
  );
}

function validSubnet(value) {
  const subnet = String(value || "").replace(/^\//, "");
  if (/^\d{1,2}$/.test(subnet)) return Number(subnet) >= 0 && Number(subnet) <= 32;
  return validIpv4(subnet);
}

function hasCycle(nodes, links) {
  const available = new Set(nodes.map((item) => item.id));
  const adjacency = new Map([...available].map((id) => [id, []]));
  links.forEach((item) => {
    if (!available.has(item.source) || !available.has(item.target)) return;
    adjacency.get(item.source).push(item.target);
    adjacency.get(item.target).push(item.source);
  });
  const seen = new Set();

  function visit(current, parent) {
    seen.add(current);
    for (const neighbour of adjacency.get(current) || []) {
      if (!seen.has(neighbour)) {
        if (visit(neighbour, current)) return true;
      } else if (neighbour !== parent) {
        return true;
      }
    }
    return false;
  }

  return nodes.some((item) => !seen.has(item.id) && visit(item.id, null));
}

function checkResult(id, label, score, message, recommendation) {
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id,
    label,
    score: bounded,
    status: bounded >= 75 ? "good" : bounded >= 45 ? "attention" : "needs-work",
    message,
    recommendation,
  };
}

/**
 * Score a topology across four explainable fundamentals. This is an
 * educational readiness check, not a substitute for a production audit.
 */
export function scoreNetwork(input = {}) {
  const state = normalizeNetworkState(input);
  const addressable = state.nodes.filter((item) => !["internet", "cloud"].includes(item.type));
  const correctlyAddressed = addressable.filter(
    (item) => validIpv4(item.ip) && validSubnet(item.subnet)
  ).length;
  const addressScore =
    addressable.length === 0 ? 0 : Math.round((correctlyAddressed / addressable.length) * 100);

  const cycle = hasCycle(state.nodes, state.links);
  const loadBalancer = state.nodes.some((item) => item.type === "load-balancer");
  const repeatedServerType = [
    ...new Set(state.nodes.filter((item) => item.type.includes("server")).map((item) => item.type)),
  ].some((type) => state.nodes.filter((item) => item.type === type).length > 1);
  const redundancyScore = Math.min(
    100,
    (cycle ? 45 : 0) + (loadBalancer ? 30 : 0) + (repeatedServerType ? 25 : 0)
  );

  const hasExternal = state.nodes.some((item) => ["internet", "cloud"].includes(item.type));
  const hasFirewall = state.nodes.some((item) => item.type === "firewall");
  const hasVpn = state.nodes.some((item) => item.type === "vpn-gateway");
  const vlans = new Set(state.nodes.map((item) => item.vlan).filter(Boolean));
  const securityScore = Math.min(
    100,
    (hasFirewall ? 50 : 0) + (hasVpn ? 25 : 0) + (vlans.size >= 2 ? 25 : vlans.size === 1 ? 10 : 0)
  );

  const hasDns = state.nodes.some((item) => item.type === "dns-server");
  const hasDhcp = state.nodes.some((item) => item.type === "dhcp-server");
  const hasWorkload = state.nodes.some((item) =>
    ["web-server", "linux-server", "windows-server", "database-server", "mail-server"].includes(
      item.type
    )
  );
  const onlineRatio =
    state.nodes.length === 0
      ? 0
      : state.nodes.filter((item) => item.status === "online").length / state.nodes.length;
  const servicesScore = Math.min(
    100,
    (hasDns ? 30 : 0) + (hasDhcp ? 30 : 0) + (hasWorkload ? 25 : 0) + Math.round(onlineRatio * 15)
  );

  const checks = [
    checkResult(
      "addressing",
      "Addressing",
      addressScore,
      addressable.length === 0
        ? "Add a device to begin an addressing plan."
        : `${correctlyAddressed} of ${addressable.length} internal devices have a valid IP and subnet.`,
      "Give each internal device a unique IPv4 address and subnet or CIDR prefix."
    ),
    checkResult(
      "redundancy",
      "Redundancy",
      redundancyScore,
      cycle || repeatedServerType
        ? "The design includes at least one alternate path or repeated workload."
        : "Most traffic currently depends on a single path.",
      "Add a second path, switch, gateway, or workload so one failure does not stop the service."
    ),
    checkResult(
      "security",
      "Security",
      securityScore,
      hasFirewall
        ? "A firewall separates at least one trust boundary."
        : hasExternal
          ? "An external network is present without a firewall."
          : "No clear network trust boundary has been added yet.",
      hasFirewall
        ? "Use VLANs or a VPN to separate sensitive traffic further."
        : "Place a firewall between users or servers and the internet."
    ),
    checkResult(
      "services",
      "Core services",
      servicesScore,
      hasDns && hasDhcp
        ? "DNS and DHCP are both represented in the design."
        : "One or more foundational network services are missing.",
      "Add DNS for name resolution and DHCP for automatic client addressing."
    ),
  ];

  const score = Math.round(checks.reduce((total, check) => total + check.score, 0) / checks.length);
  const label =
    score >= 80
      ? "Review ready"
      : score >= 60
        ? "Solid foundation"
        : score >= 35
          ? "Keep building"
          : "Getting started";
  const recommendations = checks
    .filter((check) => check.score < 75)
    .sort((left, right) => left.score - right.score)
    .map((check) => check.recommendation);
  const summary =
    state.nodes.length === 0
      ? "Add devices or choose a starter project to see practical guidance."
      : `${label}. ${checks.filter((check) => check.score >= 75).length} of 4 fundamentals are in good shape.`;

  return { score, label, summary, checks, recommendations };
}

function createRuntimeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  createRuntimeId.counter = (createRuntimeId.counter || 0) + 1;
  return `${prefix}-${Date.now().toString(36)}-${createRuntimeId.counter.toString(36)}`;
}

function templateCopy(templateId) {
  return normalizeNetworkState(NETWORK_TEMPLATES[templateId] || NETWORK_TEMPLATES.blank);
}

function element(root, selector) {
  return root.querySelector(selector) || document.querySelector(selector);
}

function elements(root, selector) {
  return [...new Set([...root.querySelectorAll(selector), ...document.querySelectorAll(selector)])];
}

function setControlValue(control, value) {
  if (control && control.value !== String(value ?? "")) control.value = String(value ?? "");
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

/** Initialise the interactive Network Lab when its host DOM is available. */
export function initNetworkLab() {
  const root = document.querySelector("#networkLab");
  if (!root || root.dataset.networkInitialized === "true") return null;

  const canvas = element(root, "#networkCanvas");
  const nodeLayer = element(root, "#networkNodeLayer");
  const connectionLayer = element(root, "#networkConnections");
  const deviceGrid = element(root, "#networkDeviceGrid");
  if (!canvas || !nodeLayer || !connectionLayer || !deviceGrid) return null;

  const controls = {
    search: element(root, "#networkDeviceSearch"),
    deleteButton: element(root, "#networkDeleteButton"),
    undoButton: element(root, "#networkUndoButton"),
    redoButton: element(root, "#networkRedoButton"),
    autoLayoutButton: element(root, "#networkAutoLayoutButton"),
    importButton: element(root, "#networkImportButton"),
    importInput: element(root, "#networkImportInput"),
    exportButton: element(root, "#networkExportButton"),
    saveButton: element(root, "#networkSaveButton"),
    architectureName: element(root, "#networkArchitectureName"),
    nodeName: element(root, "#networkNodeName"),
    nodeIp: element(root, "#networkNodeIp"),
    nodeSubnet: element(root, "#networkNodeSubnet"),
    nodeVlan: element(root, "#networkNodeVlan"),
    nodeStatus: element(root, "#networkNodeStatus"),
    nodeNotes: element(root, "#networkNodeNotes"),
    inspectorEmpty: element(root, "#networkInspectorEmpty"),
    inspectorFields: element(root, "#networkInspectorFields"),
    nodeCount: element(root, "#networkNodeCount"),
    linkCount: element(root, "#networkLinkCount"),
    saveState: element(root, "#networkSaveState"),
    score: element(root, "#networkScore"),
    scoreRing: element(root, ".network-score-ring"),
    scoreLabel: element(root, "#networkScoreLabel"),
    scoreSummary: element(root, "#networkScoreSummary"),
    checksList: element(root, "#networkChecksList"),
    packetSource: element(root, "#networkPacketSource"),
    packetTarget: element(root, "#networkPacketTarget"),
    sendPacketButton: element(root, "#networkSendPacketButton"),
    packetStatus: element(root, "#networkPacketStatus"),
    paletteToggle: element(root, "#networkPaletteToggle"),
    inspectorToggle: element(root, "#networkInspectorToggle"),
    inspectorClose: element(root, "[data-network-inspector-close]"),
    resetButton: element(root, "#networkResetButton"),
  };
  const categoryButtons = elements(root, "[data-network-category]");
  const modeButtons = elements(root, "[data-network-mode]");
  const templateButtons = elements(root, "[data-network-template]");
  const compactInspectorMedia = window.matchMedia("(max-width: 1050px)");
  const mobilePaletteMedia = window.matchMedia("(max-width: 760px)");
  const undoStack = [];
  const redoStack = [];
  const listeners = [];
  let activeCategory = "all";
  let activeMode = "select";
  let connectSourceId = null;
  let packetPath = [];
  let packetTimer = null;
  let drag = null;
  let sceneObserver = null;

  function listen(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function readStoredState() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored ? normalizeNetworkState(JSON.parse(stored)) : null;
    } catch {
      return null;
    }
  }

  let state =
    readStoredState() ||
    templateCopy(
      Object.hasOwn(NETWORK_TEMPLATES, root.dataset.networkTemplate)
        ? root.dataset.networkTemplate
        : "small-office"
    );

  function updateSaveCopy(copy, tone = "saved") {
    if (!controls.saveState) return;
    controls.saveState.textContent = copy;
    controls.saveState.dataset.state = tone;
  }

  function syncPaletteToggle(hidden) {
    if (!controls.paletteToggle) return;
    controls.paletteToggle.setAttribute("aria-expanded", String(!hidden));
    controls.paletteToggle.setAttribute(
      "aria-label",
      hidden ? "Show device library" : "Hide device library"
    );
    controls.paletteToggle.title = hidden ? "Show device library" : "Hide device library";
  }

  function saveState(copy = "Saved locally") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      updateSaveCopy(copy, "saved");
      window.dispatchEvent(
        new CustomEvent("trust:designchange", { detail: { source: "network", reason: copy } })
      );
      return true;
    } catch {
      updateSaveCopy("Could not save in this browser", "error");
      return false;
    }
  }

  function nodeCenter(item) {
    return { x: item.x + NODE_WIDTH / 2, y: item.y + NODE_HEIGHT / 2 };
  }

  function syncSceneSize() {
    const width = Math.max(
      canvas.clientWidth,
      ...state.nodes.map((item) => item.x + NODE_WIDTH + 80),
      0
    );
    const height = Math.max(
      canvas.clientHeight,
      ...state.nodes.map((item) => item.y + NODE_HEIGHT + 80),
      0
    );
    nodeLayer.style.width = `${width}px`;
    nodeLayer.style.height = `${height}px`;
    connectionLayer.style.width = `${width}px`;
    connectionLayer.style.height = `${height}px`;
    connectionLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  function renderConnections() {
    syncSceneSize();
    connectionLayer.replaceChildren();
    const routePairs = new Set();
    packetPath.slice(1).forEach((target, index) => {
      routePairs.add([packetPath[index], target].sort().join("::"));
    });
    const nodeMap = new Map(state.nodes.map((item) => [item.id, item]));

    state.links.forEach((item) => {
      const source = nodeMap.get(item.source);
      const target = nodeMap.get(item.target);
      if (!source || !target) return;
      const start = nodeCenter(source);
      const finish = nodeCenter(target);
      const hit = document.createElementNS(SVG_NAMESPACE, "line");
      hit.setAttribute("x1", String(start.x));
      hit.setAttribute("y1", String(start.y));
      hit.setAttribute("x2", String(finish.x));
      hit.setAttribute("y2", String(finish.y));
      hit.setAttribute("class", "network-connection-hit");
      hit.setAttribute("data-network-link-id", item.id);
      hit.setAttribute("aria-hidden", "true");
      const focusTarget = document.createElementNS(SVG_NAMESPACE, "circle");
      focusTarget.setAttribute("cx", String((start.x + finish.x) / 2));
      focusTarget.setAttribute("cy", String((start.y + finish.y) / 2));
      focusTarget.setAttribute("r", "9");
      focusTarget.setAttribute("class", "network-connection-keyboard");
      focusTarget.setAttribute("data-network-link-id", item.id);
      focusTarget.setAttribute("role", "button");
      focusTarget.setAttribute("tabindex", "0");
      focusTarget.setAttribute("aria-label", `${source.name} to ${target.name}`);
      focusTarget.setAttribute("aria-pressed", String(state.selectedLinkId === item.id));
      const line = document.createElementNS(SVG_NAMESPACE, "line");
      line.setAttribute("x1", String(start.x));
      line.setAttribute("y1", String(start.y));
      line.setAttribute("x2", String(finish.x));
      line.setAttribute("y2", String(finish.y));
      line.setAttribute("data-network-link-id", item.id);
      line.setAttribute("aria-hidden", "true");
      line.classList.add("network-connection");
      if (state.selectedLinkId === item.id) line.classList.add("network-is-selected");
      if (routePairs.has([item.source, item.target].sort().join("::"))) {
        line.classList.add("network-packet-route");
      }
      connectionLayer.append(hit, line, focusTarget);
    });
  }

  function renderNodes() {
    nodeLayer.replaceChildren();
    canvas.classList.toggle("has-nodes", state.nodes.length > 0);
    state.nodes.forEach((item) => {
      const device = DEVICE_BY_ID.get(item.type);
      if (!device) return;
      const nodeButton = document.createElement("button");
      nodeButton.type = "button";
      nodeButton.className = `network-node network-node-${device.category} network-status-${item.status}`;
      nodeButton.dataset.networkNodeId = item.id;
      nodeButton.style.left = `${item.x}px`;
      nodeButton.style.top = `${item.y}px`;
      nodeButton.setAttribute("aria-label", `${item.name}, ${device.name}, ${item.status}`);
      nodeButton.setAttribute("aria-pressed", String(state.selectedNodeId === item.id));
      if (state.selectedNodeId === item.id) nodeButton.classList.add("network-is-selected");
      if (connectSourceId === item.id) nodeButton.classList.add("network-connect-source");
      if (packetPath.includes(item.id)) nodeButton.classList.add("network-packet-node");

      const glyph = document.createElement("span");
      glyph.className = "network-node-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = device.glyph;
      const copy = document.createElement("span");
      copy.className = "network-node-copy";
      const title = document.createElement("strong");
      title.className = "network-node-name";
      title.textContent = item.name;
      const detail = document.createElement("small");
      detail.className = "network-node-detail";
      detail.textContent = item.ip || device.name;
      copy.append(title, detail);
      nodeButton.append(glyph, copy);
      nodeLayer.append(nodeButton);
    });
  }

  function renderInspector() {
    const selected = state.nodes.find((item) => item.id === state.selectedNodeId);
    if (controls.inspectorEmpty) controls.inspectorEmpty.hidden = Boolean(selected);
    if (controls.inspectorFields) controls.inspectorFields.hidden = !selected;
    if (!selected) return;
    setControlValue(controls.nodeName, selected.name);
    setControlValue(controls.nodeIp, selected.ip);
    setControlValue(controls.nodeSubnet, selected.subnet);
    setControlValue(controls.nodeVlan, selected.vlan);
    setControlValue(controls.nodeStatus, selected.status);
    setControlValue(controls.nodeNotes, selected.notes);
  }

  function refillPacketSelect(control, oldValue) {
    if (!control) return;
    control.replaceChildren(option("", "Choose a device…"));
    state.nodes.forEach((item) => {
      control.append(option(item.id, `${item.name}${item.ip ? ` · ${item.ip}` : ""}`));
    });
    control.value = state.nodes.some((item) => item.id === oldValue) ? oldValue : "";
  }

  function renderPacketOptions() {
    const source = controls.packetSource?.value || "";
    const target = controls.packetTarget?.value || "";
    refillPacketSelect(controls.packetSource, source);
    refillPacketSelect(controls.packetTarget, target);
  }

  function renderScore() {
    const result = scoreNetwork(state);
    if (controls.score) controls.score.textContent = String(result.score);
    if (controls.scoreRing) {
      controls.scoreRing.style.setProperty("--network-score", String(result.score));
    }
    if (controls.scoreLabel) controls.scoreLabel.textContent = result.label;
    if (controls.scoreSummary) controls.scoreSummary.textContent = result.summary;
    if (!controls.checksList) return;
    controls.checksList.replaceChildren();
    result.checks.forEach((check) => {
      const item = document.createElement("li");
      item.className = `network-check network-check-${check.status}`;
      const heading = document.createElement("div");
      heading.className = "network-check-heading";
      const label = document.createElement("strong");
      label.textContent = check.label;
      const value = document.createElement("span");
      value.className = "network-check-score";
      value.textContent = `${check.score}/100`;
      heading.append(label, value);
      const message = document.createElement("p");
      message.textContent = check.message;
      item.append(heading, message);
      controls.checksList.append(item);
    });
  }

  function renderToolbar() {
    if (controls.nodeCount) {
      controls.nodeCount.textContent = String(state.nodes.length);
    }
    if (controls.linkCount) {
      controls.linkCount.textContent = String(state.links.length);
    }
    setControlValue(controls.architectureName, state.name);
    if (controls.deleteButton) {
      controls.deleteButton.disabled = !state.selectedNodeId && !state.selectedLinkId;
    }
    if (controls.undoButton) controls.undoButton.disabled = undoStack.length === 0;
    if (controls.redoButton) controls.redoButton.disabled = redoStack.length === 0;
    modeButtons.forEach((button) => {
      const active = button.dataset.networkMode === activeMode;
      button.classList.toggle("network-is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function render() {
    renderConnections();
    renderNodes();
    renderInspector();
    renderPacketOptions();
    renderScore();
    renderToolbar();
  }

  function historyPush(stack, snapshot) {
    stack.push(cloneState(snapshot));
    if (stack.length > HISTORY_LIMIT) stack.shift();
  }

  function replaceState(next, { history = true, save = true } = {}) {
    if (history) {
      historyPush(undoStack, state);
      redoStack.length = 0;
    }
    state = normalizeNetworkState(typeof next === "function" ? next(cloneState(state)) : next);
    packetPath = [];
    connectSourceId = null;
    render();
    if (save) saveState("Auto-saved");
    return cloneState(state);
  }

  function selectNode(id) {
    const valid = state.nodes.some((item) => item.id === id);
    state.selectedNodeId = valid ? id : null;
    state.selectedLinkId = null;
    if (valid && window.matchMedia("(max-width: 1050px)").matches) {
      root.classList.remove("network-inspector-collapsed");
      controls.inspectorToggle?.setAttribute("aria-expanded", "true");
      controls.inspectorToggle?.setAttribute("aria-pressed", "true");
    }
    render();
  }

  function selectLink(id, { restoreFocus = false } = {}) {
    if (!state.links.some((item) => item.id === id)) return;
    state.selectedLinkId = id;
    state.selectedNodeId = null;
    render();
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        connectionLayer.querySelector(`[data-network-link-id="${id}"][tabindex]`)?.focus();
      });
    }
  }

  function nextAddress() {
    const used = new Set(state.nodes.map((item) => item.ip));
    let host = 20;
    while (used.has(`192.168.1.${host}`) && host < 254) host += 1;
    return host < 254 ? `192.168.1.${host}` : "";
  }

  function addDevice(type, position = {}) {
    const device = DEVICE_BY_ID.get(type);
    if (!device) return null;
    const viewportX = canvas.scrollLeft + canvas.clientWidth / 2 - NODE_WIDTH / 2;
    const viewportY = canvas.scrollTop + canvas.clientHeight / 2 - NODE_HEIGHT / 2;
    const sameType = state.nodes.filter((item) => item.type === type).length;
    const id = createRuntimeId("network-node");
    const external = ["internet", "cloud"].includes(type);
    const created = {
      id,
      type,
      name: `${device.name}${sameType ? ` ${sameType + 1}` : ""}`,
      x: finitePosition(position.x, viewportX + (sameType % 3) * 28),
      y: finitePosition(position.y, viewportY + (sameType % 3) * 28),
      ip: external ? "" : nextAddress(),
      subnet: external ? "" : "24",
      vlan: "",
      status: "online",
      notes: "",
    };
    replaceState((draft) => {
      draft.nodes.push(created);
      draft.selectedNodeId = id;
      draft.selectedLinkId = null;
      draft.template = "blank";
      return draft;
    });
    return { ...created };
  }

  function connectDevices(source, target) {
    if (!source || !target || source === target) return false;
    if (!state.nodes.some((item) => item.id === source)) return false;
    if (!state.nodes.some((item) => item.id === target)) return false;
    if (
      state.links.some(
        (item) =>
          (item.source === source && item.target === target) ||
          (item.source === target && item.target === source)
      )
    ) {
      return false;
    }
    replaceState((draft) => {
      draft.links.push({
        id: createRuntimeId("network-link"),
        source,
        target,
        label: "Ethernet",
      });
      draft.selectedNodeId = target;
      draft.selectedLinkId = null;
      return draft;
    });
    return true;
  }

  function deleteSelection() {
    if (!state.selectedNodeId && !state.selectedLinkId) return false;
    replaceState((draft) => {
      if (draft.selectedNodeId) {
        const id = draft.selectedNodeId;
        draft.nodes = draft.nodes.filter((item) => item.id !== id);
        draft.links = draft.links.filter((item) => item.source !== id && item.target !== id);
      } else if (draft.selectedLinkId) {
        draft.links = draft.links.filter((item) => item.id !== draft.selectedLinkId);
      }
      draft.selectedNodeId = null;
      draft.selectedLinkId = null;
      return draft;
    });
    return true;
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return false;
    historyPush(redoStack, state);
    state = normalizeNetworkState(previous);
    packetPath = [];
    connectSourceId = null;
    render();
    saveState("Undo saved");
    return true;
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return false;
    historyPush(undoStack, state);
    state = normalizeNetworkState(next);
    packetPath = [];
    connectSourceId = null;
    render();
    saveState("Redo saved");
    return true;
  }

  function loadTemplate(templateId) {
    if (!Object.hasOwn(NETWORK_TEMPLATES, templateId)) return false;
    replaceState(templateCopy(templateId));
    canvas.scrollTo?.({ top: 0, left: 0 });
    if (controls.packetStatus) {
      controls.packetStatus.textContent =
        templateId === "blank"
          ? "Blank canvas ready. Choose a device on the left to add it."
          : `${NETWORK_TEMPLATES[templateId].name} loaded. Select any device to inspect it.`;
    }
    return true;
  }

  function autoLayout() {
    if (state.nodes.length === 0) return false;
    const columns = { "cloud-security": 0, network: 1, servers: 2, endpoints: 3 };
    const grouped = new Map([
      [0, []],
      [1, []],
      [2, []],
      [3, []],
    ]);
    state.nodes.forEach((item) => {
      grouped.get(columns[DEVICE_BY_ID.get(item.type)?.category] ?? 1).push(item.id);
    });
    replaceState((draft) => {
      draft.nodes.forEach((item) => {
        const column = columns[DEVICE_BY_ID.get(item.type)?.category] ?? 1;
        const row = grouped.get(column).indexOf(item.id);
        item.x = 85 + column * 255;
        item.y = 80 + row * 125;
      });
      return draft;
    });
    return true;
  }

  function renderDeviceGrid() {
    const term = (controls.search?.value || "").trim().toLowerCase();
    deviceGrid.replaceChildren();
    NETWORK_DEVICES.filter((device) => {
      const categoryMatch = activeCategory === "all" || device.category === activeCategory;
      const searchMatch =
        !term || `${device.name} ${device.description} ${device.id}`.toLowerCase().includes(term);
      return categoryMatch && searchMatch;
    }).forEach((device) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `network-device-card network-device-${device.category}`;
      button.dataset.networkDevice = device.id;
      button.title = `Add ${device.name}: ${device.description}`;
      const glyph = document.createElement("span");
      glyph.className = "network-device-glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = device.glyph;
      const label = document.createElement("span");
      label.className = "network-device-name";
      label.textContent = device.name;
      button.append(glyph, label);
      deviceGrid.append(button);
    });
    if (!deviceGrid.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "network-device-empty";
      empty.textContent = "No devices match that search. Try a broader term.";
      deviceGrid.append(empty);
    }
  }

  function changeMode(mode) {
    activeMode = mode === "connect" ? "connect" : "select";
    connectSourceId = null;
    root.dataset.networkMode = activeMode;
    if (controls.packetStatus) {
      controls.packetStatus.textContent =
        activeMode === "connect"
          ? "Connect mode: choose the first device, then choose the device it connects to."
          : "Select mode: click a device to inspect it, or drag it to move it.";
    }
    render();
  }

  function sendPacket() {
    const source = controls.packetSource?.value || "";
    const target = controls.packetTarget?.value || "";
    if (!source || !target) {
      if (controls.packetStatus) {
        controls.packetStatus.textContent = "Choose both a starting device and a destination.";
      }
      return [];
    }
    packetPath = findNetworkPath(state, source, target);
    if (packetTimer) window.clearTimeout(packetTimer);
    const names = new Map(state.nodes.map((item) => [item.id, item.name]));
    if (controls.packetStatus) {
      controls.packetStatus.textContent =
        packetPath.length > 0
          ? `Packet delivered in ${Math.max(0, packetPath.length - 1)} hops: ${packetPath
              .map((id) => names.get(id))
              .join(" → ")}.`
          : "No available route. Check the links and make sure every device on the path is online.";
    }
    renderConnections();
    renderNodes();
    if (packetPath.length) {
      packetTimer = window.setTimeout(() => {
        packetPath = [];
        renderConnections();
        renderNodes();
      }, 4200);
    }
    return [...packetPath];
  }

  function exportJson() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const download = document.createElement("a");
    const filename =
      state.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "network";
    download.href = url;
    download.download = `${filename}.network.json`;
    document.body.append(download);
    download.click();
    download.remove();
    URL.revokeObjectURL(url);
  }

  function updateSelectedField(field, value) {
    if (!state.selectedNodeId) return;
    replaceState((draft) => {
      const selected = draft.nodes.find((item) => item.id === draft.selectedNodeId);
      if (selected) selected[field] = value;
      return draft;
    });
  }

  listen(deviceGrid, "click", (event) => {
    const button = event.target.closest("[data-network-device]");
    if (!button) return;
    const created = addDevice(button.dataset.networkDevice);
    if (created && event.detail === 0) {
      window.requestAnimationFrame(() => {
        nodeLayer.querySelector(`[data-network-node-id="${created.id}"]`)?.focus();
      });
    }
  });
  listen(deviceGrid, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const button = event.target.closest("[data-network-device]");
    if (!button) return;
    event.preventDefault();
    button.click();
  });
  listen(controls.search, "input", renderDeviceGrid);
  categoryButtons.forEach((button) => {
    listen(button, "click", () => {
      const requested = button.dataset.networkCategory || "all";
      activeCategory =
        requested === "cloud" || requested === "cloud/security" ? "cloud-security" : requested;
      if (!DEVICE_CATEGORIES.includes(activeCategory)) activeCategory = "all";
      categoryButtons.forEach((item) => {
        const category = item.dataset.networkCategory;
        const active =
          category === activeCategory ||
          (activeCategory === "cloud-security" &&
            (category === "cloud" || category === "cloud/security"));
        item.classList.toggle("network-is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderDeviceGrid();
    });
  });
  modeButtons.forEach((button) => {
    listen(button, "click", () => changeMode(button.dataset.networkMode));
  });
  templateButtons.forEach((button) => {
    listen(button, "click", () => loadTemplate(button.dataset.networkTemplate));
  });

  listen(nodeLayer, "click", (event) => {
    if (drag?.moved) return;
    const target = event.target.closest("[data-network-node-id]");
    if (!target) return;
    const id = target.dataset.networkNodeId;
    if (activeMode === "connect") {
      if (!connectSourceId) {
        connectSourceId = id;
        state.selectedNodeId = id;
        if (controls.packetStatus) {
          controls.packetStatus.textContent =
            "First device selected. Now choose the device it connects to.";
        }
        render();
      } else {
        const source = connectSourceId;
        connectSourceId = null;
        if (source === id) {
          if (controls.packetStatus) {
            controls.packetStatus.textContent =
              "Choose a different second device to create a connection.";
          }
          render();
        } else if (!connectDevices(source, id) && controls.packetStatus) {
          controls.packetStatus.textContent = "Those devices are already connected.";
        } else if (controls.packetStatus) {
          controls.packetStatus.textContent =
            "Connection added. Choose another first device, or switch back to Select.";
        }
      }
    } else {
      selectNode(id);
    }
    if (event.detail === 0) {
      window.requestAnimationFrame(() => {
        nodeLayer.querySelector(`[data-network-node-id="${id}"]`)?.focus();
      });
    }
  });
  listen(nodeLayer, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("[data-network-node-id]");
    if (!target) return;
    event.preventDefault();
    target.click();
  });

  listen(nodeLayer, "pointerdown", (event) => {
    if (activeMode !== "select" || event.button !== 0) return;
    const target = event.target.closest("[data-network-node-id]");
    if (!target) return;
    const selected = state.nodes.find((item) => item.id === target.dataset.networkNodeId);
    if (!selected) return;
    event.preventDefault();
    target.setPointerCapture?.(event.pointerId);
    drag = {
      id: selected.id,
      target,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      nodeX: selected.x,
      nodeY: selected.y,
      before: cloneState(state),
      moved: false,
    };
    state.selectedNodeId = selected.id;
    state.selectedLinkId = null;
    if (window.matchMedia("(max-width: 1050px)").matches) {
      root.classList.remove("network-inspector-collapsed");
      controls.inspectorToggle?.setAttribute("aria-expanded", "true");
      controls.inspectorToggle?.setAttribute("aria-pressed", "true");
    }
    target.classList.add("network-is-selected");
    renderInspector();
    renderToolbar();
  });

  listen(nodeLayer, "pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    const selected = state.nodes.find((item) => item.id === drag.id);
    if (!selected) return;
    selected.x = Math.max(0, Math.round(drag.nodeX + dx));
    selected.y = Math.max(0, Math.round(drag.nodeY + dy));
    drag.target.style.left = `${selected.x}px`;
    drag.target.style.top = `${selected.y}px`;
    renderConnections();
  });

  function finishDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completed = drag;
    drag = null;
    if (completed.moved) {
      historyPush(undoStack, completed.before);
      redoStack.length = 0;
      render();
      saveState("Position auto-saved");
    } else {
      render();
    }
  }

  listen(nodeLayer, "pointerup", finishDrag);
  listen(nodeLayer, "pointercancel", finishDrag);

  listen(connectionLayer, "click", (event) => {
    const target = event.target.closest("[data-network-link-id]");
    if (!target) return;
    selectLink(target.getAttribute("data-network-link-id"));
  });
  listen(connectionLayer, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("[data-network-link-id]");
    if (!target) return;
    event.preventDefault();
    selectLink(target.getAttribute("data-network-link-id"), { restoreFocus: true });
  });
  listen(controls.deleteButton, "click", deleteSelection);
  listen(controls.undoButton, "click", undo);
  listen(controls.redoButton, "click", redo);
  listen(controls.autoLayoutButton, "click", autoLayout);
  listen(controls.saveButton, "click", () => saveState("Saved just now"));
  listen(controls.exportButton, "click", exportJson);
  listen(controls.importButton, "click", () => controls.importInput?.click());
  listen(controls.importInput, "change", () => {
    const file = controls.importInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        replaceState(JSON.parse(String(reader.result)));
        if (controls.packetStatus) {
          controls.packetStatus.textContent = "Network imported successfully. Review the canvas.";
        }
      } catch {
        if (controls.packetStatus) {
          controls.packetStatus.textContent =
            "That file could not be imported. Choose a Network Lab JSON file.";
        }
      }
      controls.importInput.value = "";
    });
    reader.readAsText(file);
  });
  listen(controls.architectureName, "change", () => {
    replaceState((draft) => {
      draft.name = controls.architectureName.value;
      return draft;
    });
  });
  [
    [controls.nodeName, "name"],
    [controls.nodeIp, "ip"],
    [controls.nodeSubnet, "subnet"],
    [controls.nodeVlan, "vlan"],
    [controls.nodeStatus, "status"],
    [controls.nodeNotes, "notes"],
  ].forEach(([control, field]) => {
    listen(control, "change", () => updateSelectedField(field, control.value));
  });
  listen(controls.sendPacketButton, "click", sendPacket);
  listen(controls.paletteToggle, "click", () => {
    const hidden = root.classList.toggle("network-palette-collapsed");
    syncPaletteToggle(hidden);
    window.requestAnimationFrame(renderConnections);
  });
  listen(controls.inspectorToggle, "click", () => {
    const hidden = root.classList.toggle("network-inspector-collapsed");
    controls.inspectorToggle.setAttribute("aria-expanded", String(!hidden));
    controls.inspectorToggle.setAttribute("aria-pressed", String(!hidden));
    window.requestAnimationFrame(renderConnections);
  });
  listen(controls.inspectorClose, "click", () => {
    root.classList.add("network-inspector-collapsed");
    controls.inspectorToggle?.setAttribute("aria-expanded", "false");
    controls.inspectorToggle?.setAttribute("aria-pressed", "false");
    window.requestAnimationFrame(renderConnections);
    window.requestAnimationFrame(() => controls.inspectorToggle?.focus());
  });
  listen(controls.resetButton, "click", () => loadTemplate("blank"));
  listen(document, "keydown", (event) => {
    if (!root.closest(".view")?.classList.contains("is-active")) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (["input", "textarea", "select"].includes(tag) || event.target?.isContentEditable) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (deleteSelection()) event.preventDefault();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (event.key === "Escape") {
      connectSourceId = null;
      state.selectedNodeId = null;
      state.selectedLinkId = null;
      if (window.matchMedia("(max-width: 1050px)").matches) {
        root.classList.add("network-inspector-collapsed");
        controls.inspectorToggle?.setAttribute("aria-expanded", "false");
        controls.inspectorToggle?.setAttribute("aria-pressed", "false");
      }
      render();
    }
  });

  if (compactInspectorMedia.matches) {
    root.classList.add("network-inspector-collapsed");
    controls.inspectorToggle?.setAttribute("aria-expanded", "false");
    controls.inspectorToggle?.setAttribute("aria-pressed", "false");
  }
  if (mobilePaletteMedia.matches) {
    root.classList.add("network-palette-collapsed");
    syncPaletteToggle(true);
  } else {
    syncPaletteToggle(false);
  }
  compactInspectorMedia.addEventListener?.("change", (event) => {
    if (!event.matches) return;
    root.classList.add("network-inspector-collapsed");
    controls.inspectorToggle?.setAttribute("aria-expanded", "false");
    controls.inspectorToggle?.setAttribute("aria-pressed", "false");
    window.requestAnimationFrame(renderConnections);
  });
  mobilePaletteMedia.addEventListener?.("change", (event) => {
    if (!event.matches) return;
    root.classList.add("network-palette-collapsed");
    syncPaletteToggle(true);
    window.requestAnimationFrame(renderConnections);
  });
  renderDeviceGrid();
  render();
  if (typeof ResizeObserver === "function") {
    sceneObserver = new ResizeObserver(renderConnections);
    sceneObserver.observe(canvas);
  }
  saveState("Auto-saved");
  root.dataset.networkInitialized = "true";
  root.dataset.networkMode = activeMode;

  function reveal(target = {}) {
    if (target.kind === "library") {
      activeCategory = "all";
      categoryButtons.forEach((button) => {
        const active = button.dataset.networkCategory === "all";
        button.classList.toggle("network-is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      root.classList.remove("network-palette-collapsed");
      syncPaletteToggle(false);
      controls.search.value = String(target.query || "");
      renderDeviceGrid();
      window.requestAnimationFrame(() => controls.search?.focus());
      window.requestAnimationFrame(renderConnections);
      return true;
    }

    if (target.kind === "link" && target.id) {
      if (!state.links.some((item) => item.id === target.id)) return false;
      selectLink(target.id);
      return true;
    }

    if (target.kind === "device") {
      const requested = target.id && state.nodes.find((item) => item.id === target.id);
      const invalidAddress = state.nodes.find(
        (item) =>
          !["internet", "cloud"].includes(item.type) &&
          (!validIpv4(item.ip) || !validSubnet(item.subnet))
      );
      const selected = requested || invalidAddress || state.nodes[0];
      if (!selected) return false;
      root.classList.remove("network-inspector-collapsed");
      controls.inspectorToggle?.setAttribute("aria-expanded", "true");
      controls.inspectorToggle?.setAttribute("aria-pressed", "true");
      selectNode(selected.id);
      window.requestAnimationFrame(() => {
        const field = target.field === "subnet" ? controls.nodeSubnet : controls.nodeIp;
        field?.focus();
      });
      return true;
    }

    return false;
  }

  return {
    getState: () => cloneState(state),
    setState: (next) => replaceState(next),
    loadTemplate,
    addDevice,
    connectDevices,
    deleteSelection,
    autoLayout,
    sendPacket,
    reveal,
    undo,
    redo,
    save: saveState,
    refreshLayout: renderConnections,
    destroy() {
      listeners.splice(0).forEach((remove) => remove());
      if (packetTimer) window.clearTimeout(packetTimer);
      sceneObserver?.disconnect();
      delete root.dataset.networkInitialized;
    },
  };
}
