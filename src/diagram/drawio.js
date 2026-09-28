/**
 * draw.io (diagrams.net) interchange.
 *
 * Export writes a native `.drawio` file: real draw.io AWS group shapes for
 * VPCs, subnets and regions, the exact AWS icons embedded as images, and
 * connectors with their routing, arrows, and waypoints. Every element also
 * carries `tc_*` attributes, so a diagram that goes out to draw.io and comes
 * back keeps its trust zones, criticality, and traffic types.
 *
 * Import reads `.drawio` / `.xml` files (compressed or not, any number of
 * pages) and editable `.drawio.svg` files. draw.io's own AWS shapes are
 * mapped onto the official icon catalog, so an existing draw.io AWS diagram
 * opens as a live, analysable architecture.
 */

import { ZONE_IDS } from "../trust-zones.js";
import { CONTAINER_PRESETS, SHAPE_KINDS } from "./shapes.js";
import { escapeXml } from "./vdom.js";
import { DOC_VERSION, isContainer, isServiceNode, renderOrder } from "./model.js";
import { cleanColumns, cleanRelation, tableHeight } from "./table.js";

// ---------------------------------------------------------------- styles

/** draw.io style string → object. `ellipse;fillColor=#fff` → {ellipse: "1", fillColor: "#fff"} */
export function parseStyle(style) {
  const result = {};
  for (const part of String(style || "").split(";")) {
    if (!part) continue;
    const index = part.indexOf("=");
    if (index < 0) result[part.trim()] = "1";
    else result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

export function formatStyle(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => (value === true ? key : `${key}=${value}`))
    .join(";")
    .concat(";");
}

// draw.io's native AWS group icons, keyed by our container presets.
const GROUP_ICONS = {
  "aws-cloud": "group_aws_cloud_alt",
  "aws-account": "group_account",
  region: "group_region",
  vpc: "group_vpc2",
  "public-subnet": "group_security_group",
  "private-subnet": "group_security_group",
  "auto-scaling-group": "group_auto_scaling_group",
  "ec2-contents": "group_ec2_instance_contents",
  "spot-fleet": "group_spot_fleet",
  "corporate-data-center": "group_corporate_data_center",
  "server-contents": "group_on_premise",
};

const ARROW_TO_DRAWIO = {
  none: { arrow: "none", fill: 0 },
  arrow: { arrow: "block", fill: 1 },
  open: { arrow: "open", fill: 0 },
  diamond: { arrow: "diamond", fill: 1 },
  circle: { arrow: "oval", fill: 1 },
  one: { arrow: "ERmandOne", fill: 0 },
  many: { arrow: "ERmany", fill: 0 },
  oneMany: { arrow: "ERoneToMany", fill: 0 },
  zeroMany: { arrow: "ERzeroToMany", fill: 0 },
  zeroOne: { arrow: "ERzeroToOne", fill: 0 },
};

const PORT_TO_XY = { n: [0.5, 0], e: [1, 0.5], s: [0.5, 1], w: [0, 0.5] };

function fontStyleBits(style) {
  return (style.bold ? 1 : 0) | (style.italic ? 2 : 0) | (style.underline ? 4 : 0);
}

function dashEntries(dash) {
  if (dash === "dashed") return { dashed: 1, dashPattern: "8 5" };
  if (dash === "dotted") return { dashed: 1, dashPattern: "1 4" };
  return {};
}

function htmlLabel(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

/** draw.io spells data URIs without ";base64" because ";" separates styles. */
export function toDrawioDataUri(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ""));
  return match ? `data:${match[1]},${match[2]}` : null;
}

export function fromDrawioDataUri(value) {
  const match = /^data:(image\/[a-z0-9.+-]+),([A-Za-z0-9+/=\s]+)$/i.exec(String(value || ""));
  if (match) return `data:${match[1]};base64,${match[2].replace(/\s+/g, "")}`;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(value || ""))) return String(value);
  return null;
}

function shapeStyle(shape) {
  const style = shape.style || {};
  const common = {
    whiteSpace: "wrap",
    html: 1,
    fillColor: style.fill,
    strokeColor: style.stroke,
    strokeWidth: style.strokeWidth,
    fontColor: style.fontColor,
    fontSize: style.fontSize,
    fontStyle: fontStyleBits(style) || undefined,
    align: style.align,
    verticalAlign: style.valign === "middle" ? undefined : style.valign,
    opacity:
      style.opacity !== undefined && style.opacity < 1
        ? Math.round(style.opacity * 100)
        : undefined,
    shadow: style.shadow ? 1 : undefined,
    ...dashEntries(style.dash),
  };
  switch (shape.kind) {
    case "rounded":
      return { rounded: 1, ...common };
    case "pill":
      return { rounded: 1, arcSize: 50, ...common };
    case "ellipse":
      return { ellipse: true, ...common };
    case "diamond":
      return { rhombus: true, ...common };
    case "hexagon":
      return { shape: "hexagon", perimeter: "hexagonPerimeter2", size: 0.25, ...common };
    case "triangle":
      return { triangle: true, direction: "north", ...common };
    case "parallelogram":
      return { shape: "parallelogram", perimeter: "parallelogramPerimeter", size: 0.2, ...common };
    case "predefined":
      return { shape: "process", size: 0.1, ...common };
    case "cylinder":
      return { shape: "cylinder3", boundedLbl: 1, backgroundOutline: 1, size: 12, ...common };
    case "document":
      return { shape: "document", boundedLbl: 1, ...common };
    case "note":
      return {
        shape: "note",
        size: 16,
        fillColor: style.fill || "#fef3c7",
        strokeColor: style.stroke || "#d6a524",
        ...common,
      };
    case "cloud":
      return { ellipse: true, shape: "cloud", ...common };
    case "actor":
      return {
        shape: "umlActor",
        verticalLabelPosition: "bottom",
        verticalAlign: "top",
        outlineConnect: 0,
        ...common,
      };
    case "text":
      return { text: true, ...common, strokeColor: "none", fillColor: "none" };
    case "group":
      return { group: true };
    default:
      return { rounded: style.rounded ? 1 : 0, ...common };
  }
}

function containerStyle(shape) {
  const preset = CONTAINER_PRESETS[shape.preset] || CONTAINER_PRESETS.generic;
  const style = shape.style || {};
  const stroke = style.stroke || preset.stroke;
  const base = {
    container: 1,
    collapsible: 0,
    recursiveResize: 0,
    pointerEvents: 0,
    whiteSpace: "wrap",
    html: 1,
    fillColor: style.fill || preset.fill || "none",
    strokeColor: stroke,
    fontColor: style.fontColor || stroke,
    fontSize: style.fontSize || 12,
    verticalAlign: "top",
    ...dashEntries(style.dash || preset.dash),
  };
  const icon = GROUP_ICONS[shape.preset];
  if (icon) {
    return {
      points:
        "[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]]",
      outlineConnect: 0,
      gradientColor: "none",
      shape: "mxgraph.aws4.group",
      grIcon: `mxgraph.aws4.${icon}`,
      grStroke: shape.preset.endsWith("subnet") ? 0 : undefined,
      align: "left",
      spacingLeft: 30,
      ...base,
    };
  }
  return {
    rounded: 0,
    align: preset.align === "center" ? "center" : "left",
    spacingLeft: preset.align === "center" ? undefined : 8,
    ...base,
  };
}

// ---------------------------------------------------------------- export

/**
 * Serialise a document as a draw.io file.
 *
 * @param {object} doc
 * @param {{iconDataUrl?: (path: string) => string|null}} options
 *   `iconDataUrl` returns a base64 data URL for an icon path, so the exact
 *   AWS artwork travels inside the file.
 */
export function toDrawio(doc, { iconDataUrl = () => null } = {}) {
  const index = new Map([...doc.nodes, ...doc.shapes].map((vertex) => [vertex.id, vertex]));
  const cellId = new Map();
  let counter = 2;
  const idFor = (id) => {
    if (!cellId.has(id)) cellId.set(id, `tc-${counter++}`);
    return cellId.get(id);
  };
  const parentOf = (vertex) => (vertex.parent && index.has(vertex.parent) ? vertex.parent : null);
  const origin = (id) => {
    const vertex = id ? index.get(id) : null;
    return vertex ? { x: vertex.x, y: vertex.y } : { x: 0, y: 0 };
  };

  // Parents must precede their children in the file.
  const { below, above } = renderOrder(doc);
  const orderedVertices = [];
  const emitted = new Set();
  const emit = (vertex) => {
    if (emitted.has(vertex.id)) return;
    const parent = parentOf(vertex);
    if (parent) emit(index.get(parent));
    emitted.add(vertex.id);
    orderedVertices.push(vertex);
  };
  [...below, ...above].forEach(emit);

  const cells = [];
  const geometry = (vertex) => {
    const base = origin(parentOf(vertex));
    return `<mxGeometry x="${round(vertex.x - base.x)}" y="${round(vertex.y - base.y)}" width="${round(vertex.w)}" height="${round(vertex.h)}" as="geometry"/>`;
  };
  const wrap = (attributes, cell) => {
    const attrs = Object.entries(attributes)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
      .join("");
    return `<UserObject${attrs}>${cell}</UserObject>`;
  };

  for (const vertex of orderedVertices) {
    const id = idFor(vertex.id);
    const parent = parentOf(vertex) ? idFor(vertex.parent) : "1";
    if (isServiceNode(vertex)) {
      const data = toDrawioDataUri(iconDataUrl(vertex.iconPath));
      const style = vertex.style || {};
      const drawStyle = data
        ? {
            shape: "image",
            html: 1,
            verticalLabelPosition: "bottom",
            verticalAlign: "top",
            labelBackgroundColor: "#ffffff",
            imageAspect: 0,
            aspect: "fixed",
            image: data,
            fontSize: style.fontSize || 12,
            fontColor: style.fontColor || "#232F3E",
          }
        : {
            shape: "mxgraph.aws4.resourceIcon",
            resIcon: `mxgraph.aws4.${awsSlug(vertex.serviceName)}`,
            fillColor: "#ED7100",
            strokeColor: "#ffffff",
            verticalLabelPosition: "bottom",
            verticalAlign: "top",
            html: 1,
            aspect: "fixed",
          };
      cells.push(
        wrap(
          {
            label: htmlLabel(vertex.name),
            tc_kind: "service",
            tc_icon: vertex.iconId,
            tc_service: vertex.serviceName,
            tc_environment: vertex.environment,
            tc_criticality: vertex.criticality,
            tc_zone: vertex.zone,
            tc_notes: vertex.notes,
            id,
          },
          `<mxCell style="${escapeXml(formatStyle(drawStyle))}" vertex="1" parent="${parent}">${geometry(vertex)}</mxCell>`
        )
      );
      continue;
    }
    if (vertex.kind === "image") {
      const data =
        toDrawioDataUri(vertex.src) ||
        (vertex.src?.startsWith("assets/") ? toDrawioDataUri(iconDataUrl(vertex.src)) : null);
      cells.push(
        wrap(
          { label: htmlLabel(vertex.label), tc_kind: "image", id },
          `<mxCell style="${escapeXml(formatStyle({ shape: "image", html: 1, verticalLabelPosition: "bottom", verticalAlign: "top", imageAspect: 0, image: data || undefined }))}" vertex="1" parent="${parent}">${geometry(vertex)}</mxCell>`
        )
      );
      continue;
    }
    if (vertex.kind === "table") {
      // A draw.io entity list: a swimlane header with one text row per column.
      const tableStyle = {
        swimlane: true,
        fontStyle: 1,
        childLayout: "stackLayout",
        horizontal: 1,
        startSize: 30,
        horizontalStack: 0,
        resizeParent: 1,
        resizeParentMax: 0,
        resizeLast: 0,
        collapsible: 0,
        marginBottom: 0,
        whiteSpace: "wrap",
        html: 1,
        rounded: 1,
        arcSize: 4,
        fillColor: vertex.style?.headerFill || "#e3eefc",
        swimlaneFillColor: "#ffffff",
        strokeColor: vertex.style?.stroke || "#3b6fb6",
      };
      cells.push(
        wrap(
          {
            label: htmlLabel(vertex.label),
            tc_kind: "table",
            tc_columns: JSON.stringify(vertex.columns || []),
            id,
          },
          `<mxCell style="${escapeXml(formatStyle(tableStyle))}" vertex="1" parent="${parent}">${geometry(vertex)}</mxCell>`
        )
      );
      const rowHeight = Math.max(20, (vertex.h - 30) / Math.max(1, (vertex.columns || []).length));
      (vertex.columns || []).forEach((column, index) => {
        const badge = column.pk ? "PK " : column.unique ? "UQ " : "";
        const rowStyle =
          "text;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;spacingLeft=6;spacingRight=6;overflow=hidden;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;rotatable=0;whiteSpace=wrap;html=1;";
        cells.push(
          wrap(
            {
              label: htmlLabel(
                `${badge}${column.name}: ${column.type || ""}${column.nullable === false || column.pk ? "" : "?"}`
              ),
              tc_role: "table-row",
              id: `${id}-c${index}`,
            },
            `<mxCell style="${escapeXml(rowStyle)}" vertex="1" parent="${id}"><mxGeometry y="${round(30 + index * rowHeight)}" width="${round(vertex.w)}" height="${round(rowHeight)}" as="geometry"/></mxCell>`
          )
        );
      });
      continue;
    }
    const style = vertex.kind === "container" ? containerStyle(vertex) : shapeStyle(vertex);
    cells.push(
      wrap(
        {
          label: htmlLabel(vertex.label),
          tc_kind: vertex.kind,
          tc_preset: vertex.preset,
          tc_zone: vertex.kind === "container" ? vertex.zone : undefined,
          id,
        },
        `<mxCell style="${escapeXml(formatStyle(style))}" vertex="1" parent="${parent}"${vertex.kind === "group" ? ' connectable="0"' : ""}>${geometry(vertex)}</mxCell>`
      )
    );
  }

  for (const connection of doc.connections) {
    const style = connection.style || {};
    const routing = style.routing || "orthogonal";
    const end = ARROW_TO_DRAWIO[style.endArrow || "arrow"] || ARROW_TO_DRAWIO.arrow;
    const start = ARROW_TO_DRAWIO[style.startArrow || "none"] || ARROW_TO_DRAWIO.none;
    const [exitX, exitY] = PORT_TO_XY[connection.fromPort] || [];
    const [entryX, entryY] = PORT_TO_XY[connection.toPort] || [];
    const drawStyle = {
      edgeStyle: routing === "straight" ? "none" : "orthogonalEdgeStyle",
      curved: routing === "curved" ? 1 : undefined,
      rounded: style.rounded === false ? 0 : 1,
      orthogonalLoop: 1,
      jettySize: "auto",
      html: 1,
      strokeColor: style.stroke,
      strokeWidth: style.strokeWidth,
      endArrow: end.arrow,
      endFill: end.fill,
      startArrow: start.arrow,
      startFill: start.fill,
      exitX,
      exitY,
      entryX,
      entryY,
      fontSize: style.fontSize,
      labelBackgroundColor: "#ffffff",
      ...dashEntries(
        style.dash ||
          (connection.type === "event" || connection.type === "replication"
            ? "dashed"
            : connection.type === "telemetry"
              ? "dotted"
              : undefined)
      ),
    };
    const points = (connection.waypoints || [])
      .map((point) => `<mxPoint x="${round(point.x)}" y="${round(point.y)}"/>`)
      .join("");
    const free = [
      connection.from
        ? ""
        : connection.fromPoint
          ? `<mxPoint x="${round(connection.fromPoint.x)}" y="${round(connection.fromPoint.y)}" as="sourcePoint"/>`
          : "",
      connection.to
        ? ""
        : connection.toPoint
          ? `<mxPoint x="${round(connection.toPoint.x)}" y="${round(connection.toPoint.y)}" as="targetPoint"/>`
          : "",
    ].join("");
    const labelX = round(((connection.labelT ?? 0.5) - 0.5) * 2);
    const geometryXml = `<mxGeometry${labelX ? ` x="${labelX}"` : ""} relative="1" as="geometry">${free}${points ? `<Array as="points">${points}</Array>` : ""}</mxGeometry>`;
    const source =
      connection.from && index.has(connection.from) ? ` source="${idFor(connection.from)}"` : "";
    const target =
      connection.to && index.has(connection.to) ? ` target="${idFor(connection.to)}"` : "";
    cells.push(
      wrap(
        {
          label: htmlLabel(connection.label),
          tc_kind: "connection",
          tc_type: connection.type,
          tc_encrypted: connection.encrypted === false ? "false" : "true",
          tc_relation: connection.relation ? JSON.stringify(connection.relation) : undefined,
          id: idFor(connection.id),
        },
        `<mxCell style="${escapeXml(formatStyle(drawStyle))}" edge="1" parent="1"${source}${target}>${geometryXml}</mxCell>`
      )
    );
  }

  const pageName = escapeXml(doc.name || "Page-1");
  return (
    `<mxfile host="Trust Choreography" type="device" version="24.7.0">` +
    `<diagram id="trust-choreography" name="${pageName}">` +
    `<mxGraphModel dx="1200" dy="800" grid="${doc.grid === false ? 0 : 1}" gridSize="${doc.gridSize || 10}" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1600" pageHeight="1000" math="0" shadow="0">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root>` +
    `</mxGraphModel></diagram></mxfile>`
  );
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** Best-effort draw.io aws4 shape name for a service (used only without artwork). */
export function awsSlug(name) {
  return String(name || "")
    .replace(/^(Amazon|AWS)\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// ---------------------------------------------------------------- import

/** draw.io aws4 names that do not match a catalog name by substring. */
const AWS_ALIASES = {
  s3: "Amazon Simple Storage Service",
  simple_storage_service: "Amazon Simple Storage Service",
  simple_storage_service_s3: "Amazon Simple Storage Service",
  bucket: "Amazon Simple Storage Service",
  glacier: "Amazon Simple Storage Service Glacier",
  s3_glacier: "Amazon Simple Storage Service Glacier",
  ec2: "Amazon EC2",
  instance: "Amazon EC2",
  instances: "Amazon EC2",
  instance2: "Amazon EC2",
  lambda: "AWS Lambda",
  lambda_function: "AWS Lambda",
  rds: "Amazon RDS",
  rds_instance: "Amazon RDS",
  aurora: "Amazon Aurora",
  aurora_instance: "Amazon Aurora",
  dynamodb: "Amazon DynamoDB",
  dynamodb_table: "Amazon DynamoDB",
  api_gateway: "Amazon API Gateway",
  endpoint: "Amazon API Gateway",
  cloudfront: "Amazon CloudFront",
  route_53: "Amazon Route 53",
  hosted_zone: "Amazon Route 53",
  elb: "Elastic Load Balancing",
  elastic_load_balancing: "Elastic Load Balancing",
  application_load_balancer: "Elastic Load Balancing Application Load Balancer",
  network_load_balancer: "Elastic Load Balancing Network Load Balancer",
  classic_load_balancer: "Elastic Load Balancing Classic Load Balancer",
  sqs: "Amazon Simple Queue Service",
  queue: "Amazon Simple Queue Service",
  sns: "Amazon Simple Notification Service",
  topic: "Amazon Simple Notification Service",
  eventbridge: "Amazon EventBridge",
  step_functions: "AWS Step Functions",
  kinesis: "Amazon Kinesis",
  kinesis_data_streams: "Amazon Kinesis Data Streams",
  kinesis_data_firehose: "Amazon Data Firehose",
  cloudwatch: "Amazon CloudWatch",
  cloudwatch_2: "Amazon CloudWatch",
  iam: "AWS Identity and Access Management",
  identity_and_access_management: "AWS Identity and Access Management",
  role: "AWS Identity and Access Management",
  cognito: "Amazon Cognito",
  waf: "AWS WAF",
  shield: "AWS Shield",
  kms: "AWS Key Management Service",
  key_management_service: "AWS Key Management Service",
  secrets_manager: "AWS Secrets Manager",
  certificate_manager: "AWS Certificate Manager",
  certificate_manager_3: "AWS Certificate Manager",
  vpc: "Amazon Virtual Private Cloud",
  virtual_private_cloud: "Amazon Virtual Private Cloud",
  internet_gateway: "Amazon VPC Internet Gateway",
  nat_gateway: "Amazon VPC NAT Gateway",
  vpn_gateway: "Amazon VPC VPN Gateway",
  customer_gateway: "Amazon VPC Customer Gateway",
  endpoints: "Amazon VPC Endpoints",
  ecs: "Amazon Elastic Container Service",
  elastic_container_service: "Amazon Elastic Container Service",
  eks: "Amazon Elastic Kubernetes Service",
  elastic_kubernetes_service: "Amazon Elastic Kubernetes Service",
  ecr: "Amazon Elastic Container Registry",
  elastic_container_registry: "Amazon Elastic Container Registry",
  fargate: "AWS Fargate",
  efs: "Amazon EFS",
  elastic_file_system: "Amazon EFS",
  ebs: "Amazon Elastic Block Store",
  elastic_block_store: "Amazon Elastic Block Store",
  elasticache: "Amazon ElastiCache",
  elasticache_for_redis: "Amazon ElastiCache",
  auto_scaling: "Amazon EC2 Auto Scaling",
  auto_scaling2: "Amazon EC2 Auto Scaling",
  ec2_auto_scaling: "Amazon EC2 Auto Scaling",
  x_ray: "AWS X Ray",
  xray: "AWS X Ray",
  systems_manager: "AWS Systems Manager",
  opensearch_service: "Amazon OpenSearch Service",
  elasticsearch_service: "Amazon OpenSearch Service",
  msk: "Amazon Managed Streaming for Apache Kafka",
  managed_streaming_for_kafka: "Amazon Managed Streaming for Apache Kafka",
  users: "Users 48 Light",
  user: "User 48 Light",
  client: "Client 48 Light",
  mobile_client: "Mobile client 48 Light",
  traditional_server: "Server 48 Light",
  generic_database: "Database 48 Light",
  internet: "Internet 48 Light",
  internet_alt1: "Internet alt1 48 Light",
  internet_alt2: "Internet alt2 48 Light",
  corporate_data_center: "Office building 48 Light",
};

const GROUP_ICON_TO_PRESET = {
  group_aws_cloud: "aws-cloud",
  group_aws_cloud_alt: "aws-cloud",
  group_account: "aws-account",
  group_region: "region",
  group_vpc: "vpc",
  group_vpc2: "vpc",
  group_auto_scaling_group: "auto-scaling-group",
  group_ec2_instance_contents: "ec2-contents",
  group_spot_fleet: "spot-fleet",
  group_corporate_data_center: "corporate-data-center",
  group_on_premise: "server-contents",
  group_elastic_beanstalk: "generic",
  group_iot_greengrass: "generic",
  group_iot_greengrass_deployment: "generic",
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** draw.io labels are often HTML; reduce them to plain text with line breaks. */
export function htmlToText(value) {
  const source = String(value ?? "");
  if (!/[<&]/.test(source)) return source.trim();
  const text = source
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : "";
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function base64ToBytes(text) {
  const binary = globalThis.atob(String(text).replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Browser inflate for draw.io's compressed pages. */
export async function inflateRawBrowser(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot open compressed draw.io files.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

function parseXml(text) {
  const parser = new globalThis.DOMParser();
  const xml = parser.parseFromString(text, "application/xml");
  if (xml.getElementsByTagName("parsererror").length) {
    throw new Error("This file is not valid draw.io XML.");
  }
  return xml;
}

function childElements(element, name) {
  return [...element.childNodes].filter(
    (node) => node.nodeType === 1 && (!name || node.nodeName === name)
  );
}

/**
 * Extract the pages of a draw.io file (or an editable draw.io SVG).
 *
 * @param {string} text file contents
 * @param {{inflateRaw?: (bytes: Uint8Array) => Promise<string>|string}} options
 * @returns {Promise<Array<{name: string, model: Element}>>}
 */
export async function readDrawioPages(text, { inflateRaw = inflateRawBrowser } = {}) {
  const source = String(text || "").trim();
  if (!source) throw new Error("The file is empty.");
  const xml = parseXml(source);
  const root = xml.documentElement;
  if (root.nodeName === "svg") {
    const content = root.getAttribute("content");
    if (!content) throw new Error("This SVG does not contain an editable draw.io diagram.");
    return readDrawioPages(content, { inflateRaw });
  }
  if (root.nodeName === "mxGraphModel") return [{ name: "Page-1", model: root }];
  if (root.nodeName !== "mxfile") throw new Error("This is not a draw.io file.");
  const pages = [];
  for (const [position, diagram] of childElements(root, "diagram").entries()) {
    const name = diagram.getAttribute("name") || `Page-${position + 1}`;
    let model = childElements(diagram, "mxGraphModel")[0];
    if (!model) {
      const packed = diagram.textContent.trim();
      if (!packed) continue;
      const inflated = await inflateRaw(base64ToBytes(packed));
      let decoded = inflated;
      try {
        decoded = decodeURIComponent(inflated);
      } catch {
        /* Already plain XML. */
      }
      model = parseXml(decoded).documentElement;
    }
    if (model?.nodeName === "mxGraphModel") pages.push({ name, model });
  }
  if (!pages.length) throw new Error("This draw.io file has no pages.");
  return pages;
}

function readCells(model) {
  const root = childElements(model, "root")[0];
  if (!root) return [];
  const cells = [];
  for (const node of childElements(root)) {
    let cell = node;
    const attributes = {};
    if (node.nodeName === "UserObject" || node.nodeName === "object") {
      cell = childElements(node, "mxCell")[0];
      if (!cell) continue;
      for (const attr of node.attributes) attributes[attr.name] = attr.value;
    } else if (node.nodeName !== "mxCell") {
      continue;
    }
    const geometryNode = childElements(cell, "mxGeometry")[0];
    const geometry = geometryNode
      ? {
          x: Number(geometryNode.getAttribute("x")) || 0,
          y: Number(geometryNode.getAttribute("y")) || 0,
          width: Number(geometryNode.getAttribute("width")) || 0,
          height: Number(geometryNode.getAttribute("height")) || 0,
          relative: geometryNode.getAttribute("relative") === "1",
          points: childElements(geometryNode, "Array")
            .filter((array) => array.getAttribute("as") === "points")
            .flatMap((array) => childElements(array, "mxPoint"))
            .map((point) => ({
              x: Number(point.getAttribute("x")) || 0,
              y: Number(point.getAttribute("y")) || 0,
            })),
          sourcePoint: pointAs(geometryNode, "sourcePoint"),
          targetPoint: pointAs(geometryNode, "targetPoint"),
        }
      : null;
    cells.push({
      id: attributes.id || cell.getAttribute("id"),
      value: attributes.label ?? cell.getAttribute("value") ?? "",
      style: parseStyle(cell.getAttribute("style")),
      vertex: cell.getAttribute("vertex") === "1",
      edge: cell.getAttribute("edge") === "1",
      parent: cell.getAttribute("parent"),
      source: cell.getAttribute("source"),
      target: cell.getAttribute("target"),
      geometry,
      attributes,
    });
  }
  return cells;
}

function pointAs(geometry, as) {
  const point = childElements(geometry, "mxPoint").find(
    (candidate) => candidate.getAttribute("as") === as
  );
  return point
    ? { x: Number(point.getAttribute("x")) || 0, y: Number(point.getAttribute("y")) || 0 }
    : null;
}

function colour(value) {
  if (!value) return undefined;
  if (value === "none") return "none";
  if (value === "default") return undefined;
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value.toLowerCase() : undefined;
}

function styleFromDrawio(style) {
  const bits = Number(style.fontStyle) || 0;
  const result = {
    fill: colour(style.fillColor),
    stroke: colour(style.strokeColor),
    fontColor: colour(style.fontColor),
    fontSize: style.fontSize ? Number(style.fontSize) : undefined,
    strokeWidth: style.strokeWidth ? Number(style.strokeWidth) : undefined,
    opacity: style.opacity ? Number(style.opacity) / 100 : undefined,
    shadow: style.shadow === "1" ? true : undefined,
    bold: bits & 1 ? true : undefined,
    italic: bits & 2 ? true : undefined,
    underline: bits & 4 ? true : undefined,
    align: ["left", "center", "right"].includes(style.align) ? style.align : undefined,
    valign: ["top", "middle", "bottom"].includes(style.verticalAlign)
      ? style.verticalAlign
      : undefined,
    dash:
      style.dashed === "1"
        ? /^1\s|^2\s/.test(style.dashPattern || "")
          ? "dotted"
          : "dashed"
        : undefined,
  };
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined && !Number.isNaN(value))
  );
}

function shapeKindFromStyle(style) {
  const shape = style.shape || "";
  if (style.text === "1" || shape === "text") return "text";
  if (style.group === "1") return "group";
  if (shape === "cloud") return "cloud";
  if (style.ellipse === "1" || shape === "ellipse" || shape === "doubleEllipse") return "ellipse";
  if (style.rhombus === "1" || shape === "rhombus") return "diamond";
  if (shape === "hexagon") return "hexagon";
  if (style.triangle === "1" || shape === "triangle") return "triangle";
  if (shape === "parallelogram") return "parallelogram";
  if (shape === "process") return "predefined";
  if (/cylinder|datastore/.test(shape)) return "cylinder";
  if (shape === "document") return "document";
  if (shape === "note" || shape === "note2") return "note";
  if (shape === "umlActor") return "actor";
  if (style.swimlane === "1" || shape === "swimlane" || style.container === "1") return "container";
  if (style.rounded === "1") return Number(style.arcSize) >= 40 ? "pill" : "rounded";
  return "rect";
}

function awsShapeName(style) {
  const shape = style.shape || "";
  if (/^mxgraph\.aws4\.(resourceIcon|productIcon)$/.test(shape)) {
    return (style.resIcon || style.prIcon || "").replace(/^mxgraph\.aws4\./, "");
  }
  const match = /^mxgraph\.aws[34]?\.(.+)$/.exec(shape);
  if (match && !/^group/.test(match[1])) return match[1];
  return "";
}

const PORT_BY_XY = (x, y) => {
  if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) return "auto";
  if (y <= 0.1) return "n";
  if (y >= 0.9) return "s";
  if (x <= 0.1) return "w";
  if (x >= 0.9) return "e";
  return "auto";
};

const ARROW_FROM_DRAWIO = {
  none: "none",
  block: "arrow",
  classic: "arrow",
  classicThin: "arrow",
  blockThin: "arrow",
  open: "open",
  openThin: "open",
  diamond: "diamond",
  diamondThin: "diamond",
  oval: "circle",
  dash: "none",
  ERmandOne: "one",
  ERone: "one",
  ERmany: "many",
  ERoneToMany: "oneMany",
  ERzeroToMany: "zeroMany",
  ERzeroToOne: "zeroOne",
};

/** "PK id: bigint", "id INT NOT NULL", "+ email : varchar" → a column. */
export function parseColumnLabel(text) {
  let value = String(text || "")
    .trim()
    .replace(/^[+#-]\s*/, "");
  let pk = false;
  let unique = false;
  const badge = /^(PK|FK|UQ|U)\b[\s|,:]*/i.exec(value);
  if (badge) {
    pk = /^PK/i.test(badge[1]);
    unique = /^U/i.test(badge[1]);
    value = value.slice(badge[0].length);
  }
  const optional = /\?\s*$/.test(value);
  value = value.replace(/\?\s*$/, "");
  const parts = value.includes(":") ? value.split(":") : value.split(/\s+/);
  const name = (parts.shift() || "").trim().replace(/[|,]+$/, "");
  const type = parts
    .join(value.includes(":") ? ":" : " ")
    .trim()
    .replace(/\bNOT NULL\b/i, "")
    .trim();
  if (!name) return null;
  return {
    name,
    type,
    pk,
    unique: unique && !pk,
    nullable: pk ? false : optional || !/not null/i.test(value),
    default: null,
    autoIncrement: false,
  };
}

/**
 * Convert one draw.io page into an architecture document (v3 shape, not yet
 * validated — pass it through `normalizeDocument`).
 *
 * @param {Element} model an <mxGraphModel>
 * @param {{resolveService: (name: string) => object|null, name?: string}} options
 *   `resolveService` maps a service name to a catalog icon.
 * @returns {{architecture: object, warnings: string[], stats: object}}
 */
export function drawioToArchitecture(
  model,
  { resolveService, resolveIconId, name = "Imported diagram" } = {}
) {
  const cells = readCells(model);
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const warnings = [];
  const skipped = { images: 0, edges: 0, unknownAws: new Set() };
  const layerIds = new Set(
    cells.filter((cell) => !cell.vertex && !cell.edge).map((cell) => cell.id)
  );

  // Absolute origin of a cell's coordinate space (its parent chain of vertices).
  const originCache = new Map();
  const originOf = (id) => {
    if (!id || layerIds.has(id)) return { x: 0, y: 0 };
    if (originCache.has(id)) return originCache.get(id);
    originCache.set(id, { x: 0, y: 0 });
    const cell = byId.get(id);
    if (!cell?.vertex || !cell.geometry) return { x: 0, y: 0 };
    const parent = originOf(cell.parent);
    const value = { x: parent.x + cell.geometry.x, y: parent.y + cell.geometry.y };
    originCache.set(id, value);
    return value;
  };

  const nodes = [];
  const shapes = [];
  const idMap = new Map();
  const edgeLabels = new Map();
  const tables = new Map();
  const rowOwner = new Map();
  let order = 0;

  for (const cell of cells) {
    if (!cell.vertex || !cell.geometry) continue;
    const parentCell = byId.get(cell.parent);
    if (parentCell?.edge) {
      // A label cell attached to a connector.
      const text = htmlToText(cell.value);
      if (text)
        edgeLabels.set(cell.parent, {
          text,
          t: (Math.max(-1, Math.min(1, cell.geometry.x)) + 1) / 2,
        });
      continue;
    }
    order += 1;
    const origin = originOf(cell.id);
    const box = {
      x: origin.x,
      y: origin.y,
      w: Math.max(4, cell.geometry.width),
      h: Math.max(4, cell.geometry.height),
    };
    const label = htmlToText(cell.value);
    const attrs = cell.attributes;
    const style = cell.style;
    const parent = cell.parent && !layerIds.has(cell.parent) ? cell.parent : null;
    idMap.set(cell.id, cell.id);

    if (attrs.tc_role === "container-icon" || attrs.tc_role === "table-row") continue;
    const tableParent = tables.get(cell.parent);
    if (tableParent) {
      // A row of a draw.io entity list becomes a column of its table, and a
      // connector drawn to the row lands on the table with that column.
      const column = tableParent.native ? parseColumnLabel(label) : null;
      if (column) tableParent.shape.columns.push(column);
      const rowIndex = Number(/-c(\d+)$/.exec(cell.id)?.[1]);
      const name = column?.name || tableParent.shape.columns[rowIndex]?.name || null;
      rowOwner.set(cell.id, { table: tableParent.shape.id, column: name });
      continue;
    }
    if (
      attrs.tc_kind === "table" ||
      (style.swimlane === "1" && style.childLayout === "stackLayout" && !attrs.tc_kind)
    ) {
      let columns = [];
      try {
        columns = attrs.tc_columns ? JSON.parse(attrs.tc_columns) : [];
      } catch {
        columns = [];
      }
      const shape = {
        id: cell.id,
        kind: "table",
        label: label || "table",
        ...box,
        z: order,
        parent,
        columns: cleanColumns(columns),
        style: {},
      };
      tables.set(cell.id, { shape, native: !attrs.tc_kind });
      shapes.push(shape);
      continue;
    }

    // 1. Services: our own export, draw.io AWS icons, or embedded images we exported.
    let icon = null;
    if (attrs.tc_kind === "service") {
      icon = resolveIconId?.(attrs.tc_icon) || resolveService(attrs.tc_service || label);
    } else if (!attrs.tc_kind) {
      const awsName = awsShapeName(style);
      if (awsName) {
        icon = resolveService(
          AWS_ALIASES[awsName] ||
            AWS_ALIASES[awsName.replace(/_\d+$/, "")] ||
            awsName.replace(/_/g, " ")
        );
        if (!icon) skipped.unknownAws.add(awsName);
      }
    }
    if (icon) {
      nodes.push({
        id: cell.id,
        iconId: icon.id,
        serviceName: icon.name,
        name: label || icon.name.replace(/ 48 (Light|Dark)$/, ""),
        x: box.x,
        y: box.y,
        w: Math.min(box.w, 200),
        h: Math.min(box.h, 200),
        z: order,
        parent,
        environment: attrs.tc_environment,
        criticality: attrs.tc_criticality,
        zone: ZONE_IDS.includes(attrs.tc_zone) ? attrs.tc_zone : undefined,
        notes: attrs.tc_notes || attrs.tooltip || "",
        style: {
          fontSize: style.fontSize ? Number(style.fontSize) : undefined,
          fontColor: colour(style.fontColor),
        },
      });
      continue;
    }

    // 2. AWS group containers.
    if (
      style.shape === "mxgraph.aws4.group" ||
      style.shape === "mxgraph.aws4.groupCenter" ||
      attrs.tc_kind === "container"
    ) {
      const grIcon = String(style.grIcon || "").replace(/^mxgraph\.aws4\./, "");
      let preset =
        attrs.tc_preset && CONTAINER_PRESETS[attrs.tc_preset]
          ? attrs.tc_preset
          : GROUP_ICON_TO_PRESET[grIcon];
      if (!preset && grIcon === "group_security_group") {
        preset =
          String(style.strokeColor).toLowerCase() === "#7aa116" || /public/i.test(label)
            ? "public-subnet"
            : "private-subnet";
      }
      if (!preset && /availability zone/i.test(label)) preset = "availability-zone";
      shapes.push({
        id: cell.id,
        kind: "container",
        preset: preset || "generic",
        zone: ZONE_IDS.includes(attrs.tc_zone) ? attrs.tc_zone : undefined,
        label,
        ...box,
        z: -1000 + order,
        parent,
        style: styleFromDrawio(style),
      });
      continue;
    }

    // 3. Images: keep embedded artwork, skip anything that would load remotely.
    if (style.shape === "image" || style.image) {
      const src = fromDrawioDataUri(style.image);
      if (!src) {
        skipped.images += 1;
        shapes.push({
          id: cell.id,
          kind: "rect",
          label: label || "Image",
          ...box,
          z: order,
          parent,
          style: { dash: "dashed" },
        });
        continue;
      }
      shapes.push({ id: cell.id, kind: "image", src, label, ...box, z: order, parent, style: {} });
      continue;
    }

    // 4. Everything else is a general shape.
    const kind =
      attrs.tc_kind && SHAPE_KINDS[attrs.tc_kind] ? attrs.tc_kind : shapeKindFromStyle(style);
    const shape = {
      id: cell.id,
      kind,
      label,
      ...box,
      z: SHAPE_KINDS[kind]?.container ? -1000 + order : order,
      parent,
      style: kind === "group" ? {} : styleFromDrawio(style),
    };
    if (kind === "container") {
      shape.preset =
        attrs.tc_preset && CONTAINER_PRESETS[attrs.tc_preset]
          ? attrs.tc_preset
          : /availability zone/i.test(label)
            ? "availability-zone"
            : "generic";
      if (ZONE_IDS.includes(attrs.tc_zone)) shape.zone = attrs.tc_zone;
      if (style.swimlane === "1" && !shape.style.fill)
        shape.style.fill = colour(style.swimlaneFillColor) || "none";
    }
    shapes.push(shape);
  }

  for (const { shape } of tables.values()) {
    shape.columns = cleanColumns(shape.columns);
    shape.h = tableHeight(shape.columns);
  }

  // Only containers can own children in this editor.
  const containerIds = new Set(
    shapes.filter((shape) => SHAPE_KINDS[shape.kind]?.container).map((shape) => shape.id)
  );
  const nearestContainer = (id) => {
    let current = id;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      if (containerIds.has(current)) return current;
      current = byId.get(current)?.parent;
    }
    return null;
  };
  for (const vertex of [...nodes, ...shapes])
    vertex.parent = vertex.parent ? nearestContainer(vertex.parent) : null;

  const vertexIds = new Set([...nodes, ...shapes].map((vertex) => vertex.id));
  const connections = [];
  for (const cell of cells) {
    if (!cell.edge) continue;
    const style = cell.style;
    const origin = originOf(cell.parent);
    const absolute = (point) => (point ? { x: point.x + origin.x, y: point.y + origin.y } : null);
    const sourceRow = rowOwner.get(cell.source);
    const targetRow = rowOwner.get(cell.target);
    const from = vertexIds.has(cell.source) ? cell.source : sourceRow?.table || null;
    const to = vertexIds.has(cell.target) ? cell.target : targetRow?.table || null;
    const fromPoint = from ? null : absolute(cell.geometry?.sourcePoint);
    const toPoint = to ? null : absolute(cell.geometry?.targetPoint);
    if ((!from && !fromPoint) || (!to && !toPoint)) {
      skipped.edges += 1;
      continue;
    }
    const attached = edgeLabels.get(cell.id);
    const ownLabel = htmlToText(cell.value);
    const routing =
      style.curved === "1"
        ? "curved"
        : !style.edgeStyle || style.edgeStyle === "none"
          ? "straight"
          : "orthogonal";
    const endArrow = style.endArrow ? ARROW_FROM_DRAWIO[style.endArrow] || "arrow" : "arrow";
    const startArrow = style.startArrow ? ARROW_FROM_DRAWIO[style.startArrow] || "none" : "none";
    const own = cell.attributes;
    let relation = null;
    try {
      relation = own.tc_relation ? cleanRelation(JSON.parse(own.tc_relation)) : null;
    } catch {
      relation = null;
    }
    if (!relation && sourceRow?.column && targetRow?.column) {
      relation = cleanRelation({ fromColumns: [sourceRow.column], toColumns: [targetRow.column] });
    }
    connections.push({
      relation,
      id: cell.id,
      from,
      to,
      fromPoint,
      toPoint,
      type: own.tc_type,
      label: ownLabel || attached?.text || "",
      encrypted: own.tc_encrypted !== "false",
      fromPort: PORT_BY_XY(Number(style.exitX), Number(style.exitY)),
      toPort: PORT_BY_XY(Number(style.entryX), Number(style.entryY)),
      waypoints: (cell.geometry?.points || []).map(absolute),
      labelT:
        attached && !ownLabel
          ? attached.t
          : Math.max(0, Math.min(1, ((cell.geometry?.x || 0) + 1) / 2)),
      style: {
        routing,
        rounded: style.rounded === "0" ? false : undefined,
        stroke: own.tc_type ? colour(style.strokeColor) : colour(style.strokeColor) || "#1f2937",
        strokeWidth: style.strokeWidth ? Number(style.strokeWidth) : undefined,
        dash:
          style.dashed === "1"
            ? /^1\s|^2\s/.test(style.dashPattern || "")
              ? "dotted"
              : "dashed"
            : own.tc_type
              ? undefined
              : "solid",
        endArrow: style.endArrow === "none" ? "none" : endArrow,
        startArrow,
        fontSize: style.fontSize ? Number(style.fontSize) : undefined,
      },
    });
  }

  if (skipped.images)
    warnings.push(
      `${skipped.images} linked image${skipped.images === 1 ? "" : "s"} replaced with placeholders (only embedded images are imported).`
    );
  if (skipped.edges)
    warnings.push(
      `${skipped.edges} connector${skipped.edges === 1 ? "" : "s"} without both ends were skipped.`
    );
  if (skipped.unknownAws.size) {
    warnings.push(
      `Unrecognised AWS shapes drawn as boxes: ${[...skipped.unknownAws].slice(0, 6).join(", ")}${skipped.unknownAws.size > 6 ? "…" : ""}.`
    );
  }

  const gridSize = Number(model.getAttribute("gridSize")) || 10;
  return {
    architecture: {
      version: DOC_VERSION,
      name,
      region: "us-east-1",
      grid: model.getAttribute("grid") !== "0",
      gridSize,
      nodes,
      shapes,
      connections,
    },
    warnings,
    stats: {
      services: nodes.length,
      shapes: shapes.filter((shape) => !isContainer(shape)).length,
      containers: shapes.filter(isContainer).length,
      connections: connections.length,
    },
  };
}

/** Sniff whether text looks like a draw.io document. */
export function looksLikeDrawio(text) {
  const head = String(text || "").slice(0, 4000);
  return (
    /<mxfile[\s>]|<mxGraphModel[\s>]/.test(head) ||
    (/<svg[\s>]/.test(head) && /content="[^"]*mxfile/.test(String(text)))
  );
}
