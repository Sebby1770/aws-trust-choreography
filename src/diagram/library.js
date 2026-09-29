/**
 * Shape library — the left sidebar.
 *
 * One search box across everything, then collapsible sections the way
 * draw.io's sidebar works: recently used, general and flowchart shapes, AWS
 * group containers, AI building blocks, network devices, and every official
 * AWS service and resource icon grouped by category. Sections only build
 * their tiles when opened, so 800+ icons cost nothing until you look.
 *
 * Items are plain descriptors (`{type: "shape"|"icon", …}`) that the studio
 * turns into vertices; the same descriptor travels through drag and drop.
 */

import { DEVICE_ICON_PATHS } from "../network-icons.js";
import {
  CONTAINER_PRESETS,
  FLOWCHART_SHAPES,
  GENERAL_SHAPES,
  resolveShapeStyle,
  shapeOutline,
  SHAPE_KINDS,
} from "./shapes.js";
import { h, toDom } from "./vdom.js";

const RECENT_KEY = "trust-choreography:diagram-recent:v1";
const OPEN_KEY = "trust-choreography:diagram-library-open:v1";
const DEFAULT_OPEN = [
  "recent",
  "general",
  "aws-groups",
  "database",
  "ai",
  "service:Compute",
  "service:Databases",
  "service:Networking Content Delivery",
];

const DEVICE_NAMES = {
  pc: "PC",
  laptop: "Laptop",
  printer: "Printer",
  "ip-phone": "IP phone",
  router: "Router",
  "l2-switch": "Switch",
  "l3-switch": "L3 switch",
  "wireless-ap": "Wireless AP",
  "web-server": "Web server",
  "dns-server": "DNS server",
  "dhcp-server": "DHCP server",
  "database-server": "Database server",
  "mail-server": "Mail server",
  "linux-server": "Linux server",
  "windows-server": "Windows server",
  firewall: "Firewall",
  "load-balancer": "Load balancer",
  internet: "Internet",
  cloud: "Cloud",
  "vpn-gateway": "VPN gateway",
};

/** A data URL for a network device icon, drawn in slate ink for white paper. */
export function deviceIconDataUrl(id) {
  const paths = DEVICE_ICON_PATHS[id];
  if (!paths) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1f3a5f" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => `<path d="${d}"/>`)
    .join("")}</svg>`;
  return `data:image/svg+xml;base64,${globalThis.btoa(svg)}`;
}

export function networkItems() {
  return Object.keys(DEVICE_ICON_PATHS).map((id) => ({
    type: "shape",
    kind: "image",
    key: `net:${id}`,
    title: DEVICE_NAMES[id] || id,
    label: DEVICE_NAMES[id] || id,
    src: deviceIconDataUrl(id),
    w: 48,
    h: 48,
    search: `${DEVICE_NAMES[id] || id} ${id} network device`.toLowerCase(),
  }));
}

function shapeItem(entry, index, section) {
  const title = entry.label || SHAPE_KINDS[entry.kind]?.label || entry.kind;
  return {
    type: "shape",
    kind: entry.kind,
    key: `${section}:${entry.kind}:${index}`,
    title:
      SHAPE_KINDS[entry.kind]?.label === title
        ? title
        : `${SHAPE_KINDS[entry.kind]?.label || entry.kind} — ${title}`,
    label: entry.label,
    preset: entry.preset,
    search:
      `${title} ${entry.kind} ${SHAPE_KINDS[entry.kind]?.label || ""} ${section}`.toLowerCase(),
  };
}

export function containerItems() {
  return Object.entries(CONTAINER_PRESETS).map(([preset, definition]) => ({
    type: "shape",
    kind: "container",
    preset,
    key: `group:${preset}`,
    title: definition.label + (definition.zone ? " (trust zone)" : ""),
    label: definition.label,
    search:
      `${definition.label} ${preset} group container aws zone ${definition.zone || ""}`.toLowerCase(),
  }));
}

/** Shorthand people actually type, keyed by catalog service name. */
export const SERVICE_ALIASES = {
  "Amazon Simple Queue Service": "sqs queue",
  "Amazon Simple Notification Service": "sns topic pubsub",
  "Amazon Simple Storage Service": "s3 bucket object storage",
  "Amazon Simple Storage Service Glacier": "s3 glacier archive",
  "Amazon Simple Email Service": "ses email",
  "Amazon EC2": "ec2 instance vm server",
  "Amazon EC2 Auto Scaling": "asg ec2 autoscaling",
  "Amazon RDS": "rds postgres mysql sql database",
  "Amazon Aurora": "aurora postgres mysql sql database",
  "Amazon DynamoDB": "ddb dynamo nosql table",
  "Amazon ElastiCache": "redis memcached cache",
  "AWS Identity and Access Management": "iam role policy",
  "AWS Key Management Service": "kms key encryption",
  "AWS Certificate Manager": "acm tls ssl certificate",
  "Elastic Load Balancing": "elb alb nlb load balancer",
  "Amazon Elastic Container Service": "ecs containers docker",
  "Amazon Elastic Kubernetes Service": "eks kubernetes k8s",
  "Amazon Elastic Container Registry": "ecr docker registry",
  "Amazon EFS": "efs nfs file system",
  "Amazon Elastic Block Store": "ebs volume disk",
  "Amazon Virtual Private Cloud": "vpc network",
  "AWS WAF": "waf firewall",
  "Amazon API Gateway": "apigw api rest http",
  "Amazon CloudFront": "cdn edge",
  "Amazon Route 53": "dns domain",
  "Amazon CloudWatch": "cw logs metrics alarms monitoring",
  "AWS Step Functions": "sfn state machine workflow",
  "Amazon Managed Streaming for Apache Kafka": "msk kafka stream",
  "Amazon MQ": "rabbitmq activemq broker",
  "Amazon Kinesis Data Streams": "kinesis stream",
  "Amazon Data Firehose": "firehose kinesis",
  "Amazon OpenSearch Service": "elasticsearch search",
  "AWS Lambda": "function serverless faas",
  "AWS Secrets Manager": "secrets password",
  "AWS Systems Manager": "ssm parameter store",
  "AWS X Ray": "xray tracing",
  "Amazon Cognito": "auth login identity users",
  "AWS Transit Gateway": "tgw",
  "AWS Direct Connect": "dx",
  "Amazon Bedrock": "llm genai foundation model",
};

export function databaseItems() {
  return [
    {
      type: "shape",
      kind: "table",
      key: "db:table",
      title: "Table — drag a connector to another table to add a foreign key",
      label: "Table",
      search: "table entity database sql schema er erd relation",
    },
    {
      type: "shape",
      kind: "table",
      key: "db:join",
      title: "Join table (many-to-many)",
      label: "Join table",
      join: true,
      search: "join junction link table many to many database sql er",
    },
  ];
}

function iconItem(icon) {
  return {
    type: "icon",
    key: `icon:${icon.id}`,
    id: icon.id,
    title: `${icon.name}${icon.category && icon.type !== "ai" ? ` · ${icon.category}` : ""}`,
    label: icon.name.replace(/ 48 (Light|Dark)$/, ""),
    path: icon.path,
    search: `${icon.search || icon.name.toLowerCase()} ${SERVICE_ALIASES[icon.name] || ""}`.trim(),
  };
}

/** Build the section model from the catalog. Pure, so it is unit-testable. */
export function librarySections(catalog) {
  const sections = [
    { id: "recent", title: "Recently used", items: [] },
    {
      id: "general",
      title: "General",
      items: GENERAL_SHAPES.map((entry, i) => shapeItem(entry, i, "general")),
    },
    {
      id: "flowchart",
      title: "Flowchart",
      items: FLOWCHART_SHAPES.map((entry, i) => shapeItem(entry, i, "flowchart")),
    },
    { id: "aws-groups", title: "AWS groups & trust zones", items: containerItems() },
    { id: "database", title: "Database (ER)", items: databaseItems() },
    {
      id: "ai",
      title: "AI & LLM",
      items: catalog.filter((icon) => icon.type === "ai").map(iconItem),
    },
    { id: "network", title: "Network devices", items: networkItems() },
  ];
  const byCategory = (type) => {
    const groups = new Map();
    for (const icon of catalog) {
      if (icon.type !== type) continue;
      if (type === "resource" && / 48 Dark$/.test(icon.name)) continue;
      if (!groups.has(icon.category)) groups.set(icon.category, []);
      groups.get(icon.category).push(iconItem(icon));
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  for (const [category, items] of byCategory("service")) {
    sections.push({ id: `service:${category}`, title: `AWS — ${category}`, items, aws: true });
  }
  for (const [category, items] of byCategory("resource")) {
    sections.push({
      id: `resource:${category}`,
      title: `AWS resources — ${category}`,
      items,
      aws: true,
      resource: true,
    });
  }
  return sections;
}

/** Rank items against a query: name prefix beats word match beats substring. */
export function searchItems(sections, query, limit = 120) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const seen = new Set();
  const scored = [];
  for (const section of sections) {
    if (section.id === "recent") continue;
    for (const item of section.items) {
      if (seen.has(item.key)) continue;
      const name = item.label?.toLowerCase() || item.title.toLowerCase();
      if (!words.every((word) => item.search.includes(word) || name.includes(word))) continue;
      seen.add(item.key);
      const bare = name.replace(/^(amazon|aws)\s+/, "");
      let score = 10;
      const aliasHit =
        item.type === "icon" &&
        new RegExp(`(^|\\s)${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(
          SERVICE_ALIASES[item.label] || ""
        );
      if (aliasHit) score = 95;
      else if (bare.startsWith(q) || name.startsWith(q)) score = 100 - bare.length * 0.2;
      else if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name))
        score = 60 - bare.length * 0.2;
      else if (name.includes(q)) score = 40;
      if (section.resource) score -= 15;
      scored.push({ item, score });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** A small SVG preview of a general shape, drawn with the real outline code. */
function shapePreview(item) {
  const kind = item.kind;
  if (kind === "container") {
    const preset = CONTAINER_PRESETS[item.preset] || CONTAINER_PRESETS.generic;
    const style = resolveShapeStyle({ kind, preset: item.preset });
    return h(
      "svg",
      { viewBox: "0 0 44 32", width: 44, height: 32, "aria-hidden": "true" },
      h("rect", {
        x: 1,
        y: 1,
        width: 42,
        height: 30,
        fill: style.fill === "none" ? "#ffffff" : style.fill,
        stroke: preset.stroke,
        "stroke-width": 1.5,
        "stroke-dasharray": preset.dash === "dashed" ? "4 3" : undefined,
      }),
      preset.icon ? h("image", { href: preset.icon, x: 1, y: 1, width: 10, height: 10 }) : null
    );
  }
  if (kind === "table") {
    return h(
      "svg",
      { viewBox: "0 0 44 32", width: 44, height: 32, "aria-hidden": "true" },
      h("rect", {
        x: 3,
        y: 2,
        width: 38,
        height: 28,
        rx: 3,
        fill: "#ffffff",
        stroke: "#3b6fb6",
        "stroke-width": 1.3,
      }),
      h("path", {
        d: "M3 5a3 3 0 0 1 3-3h32a3 3 0 0 1 3 3v5H3z",
        fill: "#e3eefc",
        stroke: "#3b6fb6",
        "stroke-width": 1.3,
      }),
      h("path", {
        d: "M8 16h8M20 16h15M8 23h8M20 23h15",
        stroke: "#7f99b8",
        "stroke-width": 1.6,
        "stroke-linecap": "round",
      }),
      h("path", { d: "M6 16h0", stroke: "#b7791f", "stroke-width": 2.4, "stroke-linecap": "round" })
    );
  }
  const definition = SHAPE_KINDS[kind];
  const w = 40;
  const hgt = Math.max(14, Math.min(30, (definition.h / definition.w) * 40));
  const style = resolveShapeStyle({ kind, style: {} });
  if (kind === "text") {
    return h(
      "svg",
      { viewBox: "0 0 44 32", width: 44, height: 32, "aria-hidden": "true" },
      h(
        "text",
        {
          x: 22,
          y: 21,
          "text-anchor": "middle",
          "font-size": 13,
          "font-weight": 700,
          fill: "#334155",
        },
        "Aa"
      )
    );
  }
  const parts = shapeOutline(kind, kind === "actor" ? 16 : w, kind === "actor" ? 28 : hgt, style);
  const offsetX = kind === "actor" ? 14 : 2;
  const offsetY = kind === "actor" ? 2 : (32 - hgt) / 2;
  return h(
    "svg",
    { viewBox: "0 0 44 32", width: 44, height: 32, "aria-hidden": "true" },
    h(
      "g",
      { transform: `translate(${offsetX} ${offsetY})` },
      parts.map((part, index) =>
        h(part.tag, {
          ...part.attrs,
          fill:
            index === 0 || part.tag === "circle"
              ? style.fill === "none"
                ? "#ffffff"
                : style.fill
              : "none",
          stroke: "#475569",
          "stroke-width": 1.3,
        })
      )
    )
  );
}

/**
 * Mount the library into `container`.
 *
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {Array} options.catalog
 * @param {(item: object, event: MouseEvent) => void} options.onActivate
 */
export function mountLibrary({ container, catalog, onActivate }) {
  const sections = librarySections(catalog);
  const itemsByKey = new Map(
    sections.flatMap((section) => section.items.map((item) => [item.key, item]))
  );
  let recent = readJson(RECENT_KEY, [])
    .filter((key) => itemsByKey.has(key))
    .slice(0, 12);
  const open = new Set(readJson(OPEN_KEY, DEFAULT_OPEN));

  container.classList.add("dg-library");
  container.innerHTML = "";
  const search = document.createElement("div");
  search.className = "dg-library-search";
  search.innerHTML = `<label class="visually-hidden" for="dgLibrarySearch">Search shapes</label>
    <input id="dgLibrarySearch" type="search" placeholder="Search ${catalog.length + 40} shapes" autocomplete="off" spellcheck="false" />
    <kbd aria-hidden="true">/</kbd>`;
  const input = search.querySelector("input");
  const results = document.createElement("div");
  results.className = "dg-library-results";
  results.hidden = true;
  const list = document.createElement("div");
  list.className = "dg-library-sections";
  container.append(search, results, list);

  function tile(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dg-tile dg-tile-${item.type === "icon" ? "icon" : item.kind}`;
    button.dataset.key = item.key;
    button.draggable = true;
    button.title = `${item.title}\nClick to add · drag to place${item.type === "icon" || item.kind !== "container" ? " · with a shape selected, click adds it connected" : ""}`;
    button.setAttribute("aria-label", item.title);
    if (item.type === "icon" || item.kind === "image") {
      const image = document.createElement("img");
      image.src = item.path || item.src;
      image.alt = "";
      image.loading = "lazy";
      image.draggable = false;
      button.append(image);
    } else {
      button.append(toDom(shapePreview(item)));
    }
    const caption = document.createElement("span");
    caption.textContent =
      item.type === "icon" ? item.label.replace(/^(Amazon|AWS)\s+/, "") : item.label || item.title;
    button.append(caption);
    return button;
  }

  function renderSection(section, body) {
    const items =
      section.id === "recent"
        ? recent.map((key) => itemsByKey.get(key)).filter(Boolean)
        : section.items;
    body.replaceChildren(...items.map(tile));
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "dg-library-empty";
      empty.textContent = section.id === "recent" ? "Shapes you add appear here." : "Nothing here.";
      body.append(empty);
    }
  }

  const sectionBodies = new Map();
  for (const section of sections) {
    const details = document.createElement("details");
    details.className = "dg-library-section";
    details.dataset.section = section.id;
    const summary = document.createElement("summary");
    summary.innerHTML = `<span></span><small></small>`;
    summary.querySelector("span").textContent = section.title;
    summary.querySelector("small").textContent =
      section.id === "recent" ? "" : String(section.items.length);
    const body = document.createElement("div");
    body.className = "dg-tiles";
    details.append(summary, body);
    sectionBodies.set(section.id, { details, body, section });
    if (open.has(section.id)) {
      details.open = true;
      renderSection(section, body);
    }
    details.addEventListener("toggle", () => {
      if (details.open) {
        open.add(section.id);
        renderSection(section, body);
      } else {
        open.delete(section.id);
        body.replaceChildren();
      }
      writeJson(OPEN_KEY, [...open]);
    });
    list.append(details);
  }

  function renderResults() {
    const query = input.value;
    const matches = searchItems(sections, query);
    results.hidden = !query.trim();
    list.hidden = Boolean(query.trim());
    if (!query.trim()) return;
    const header = document.createElement("p");
    header.className = "dg-library-count";
    header.textContent = matches.length
      ? `${matches.length}${matches.length === 120 ? "+" : ""} matches`
      : "No shapes match.";
    const grid = document.createElement("div");
    grid.className = "dg-tiles";
    grid.append(...matches.map(tile));
    results.replaceChildren(header, grid);
  }
  input.addEventListener("input", renderResults);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const first = results.querySelector(".dg-tile");
      if (first) {
        event.preventDefault();
        activate(first, event);
      }
    } else if (event.key === "Escape") {
      input.value = "";
      renderResults();
    }
  });

  function remember(item) {
    recent = [item.key, ...recent.filter((key) => key !== item.key)].slice(0, 12);
    writeJson(RECENT_KEY, recent);
    const entry = sectionBodies.get("recent");
    if (entry?.details.open) renderSection(entry.section, entry.body);
  }

  function activate(button, event) {
    const item = itemsByKey.get(button.dataset.key);
    if (!item) return;
    remember(item);
    onActivate(item, event);
  }

  container.addEventListener("click", (event) => {
    const button = event.target.closest(".dg-tile");
    if (button) activate(button, event);
  });
  container.addEventListener("dragstart", (event) => {
    const button = event.target.closest(".dg-tile");
    const item = button && itemsByKey.get(button.dataset.key);
    if (!item || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-diagram-item", JSON.stringify(item));
    event.dataTransfer.setData("text/plain", item.label || item.title);
    const preview = button.querySelector("img, svg");
    if (preview) event.dataTransfer.setDragImage(preview, 20, 20);
    remember(item);
  });

  return {
    focusSearch(query = null) {
      if (query !== null) {
        input.value = query;
        renderResults();
      }
      input.focus();
      input.select();
    },
    item: (key) => itemsByKey.get(key),
    remember,
    sections,
  };
}
