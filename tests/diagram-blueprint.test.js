import { describe, expect, it, vi } from "vitest";
import {
  buildBlueprint,
  buildTemplate,
  TEMPLATE_IDS,
  TEMPLATES,
} from "../src/diagram/templates.js";
import {
  createDocument,
  inheritedZone,
  isContainer,
  isServiceNode,
  makeConnection,
  makeServiceNode,
  makeShape,
  normalizeDocument,
  renderOrder,
  reparent,
} from "../src/diagram/model.js";
import { ARROW_KINDS, DASH_PATTERNS, SHAPE_KINDS } from "../src/diagram/shapes.js";
import { ZONE_IDS } from "../src/trust-zones.js";
import { matchIcon } from "../src/icon-match.js";
import { AI_ICONS } from "../src/ai-icons.js";
import { AWS_ICON_CATALOG } from "../assets/aws-icons/catalog.js";
import {
  accessMapBlueprint,
  analyzePolicy,
  SAMPLE_POLICY,
  SAMPLE_TRUST_POLICY,
} from "../src/iam-policy.js";
import { DEFAULT_PLAN, planVpc, vpcBlueprint } from "../src/cidr.js";

// ------------------------------------------------------------------ helpers

/** A deterministic stand-in icon for any service name. */
const fakeIcon = (name, type = "service") => ({
  id: `icon:${type}:${name}`,
  path: `assets/${name}.svg`,
  type,
  category: "Test",
  name,
});
const anyIcon = (name, type = "service") => fakeIcon(name, type);
/** Resolves every service except the ones listed. */
const iconsExcept =
  (...missing) =>
  (name, type = "service") =>
    missing.includes(name) ? null : fakeIcon(name, type);

/** The catalog Flow Studio actually boots with (see src/main.js). */
const CATALOG = [...AI_ICONS, ...AWS_ICON_CATALOG];
const ICON_BY_ID = new Map(CATALOG.map((icon) => [icon.id, icon]));
const realIcon = (name, type = "service") => matchIcon(CATALOG, name, type) || null;

const nodeNamed = (doc, name) => doc.nodes.find((node) => node.name === name);
const shapeLabelled = (doc, label) => doc.shapes.find((shape) => shape.label === label);
const vertexById = (doc, id) =>
  doc.nodes.find((node) => node.id === id) || doc.shapes.find((shape) => shape.id === id);
const allVertices = (doc) => [...doc.shapes, ...doc.nodes];

/** Structural problems that would make a document invalid for the editor. */
function structuralProblems(doc) {
  const problems = [];
  const ids = new Set(allVertices(doc).map((vertex) => vertex.id));
  for (const connection of doc.connections) {
    if (!ids.has(connection.from))
      problems.push(`${connection.id}: unknown from ${connection.from}`);
    if (!ids.has(connection.to)) problems.push(`${connection.id}: unknown to ${connection.to}`);
  }
  for (const vertex of allVertices(doc)) {
    if (!vertex.parent) continue;
    const parent = vertexById(doc, vertex.parent);
    if (!parent) problems.push(`${vertex.label || vertex.name}: missing parent ${vertex.parent}`);
    else if (!isContainer(parent))
      problems.push(`${vertex.label || vertex.name}: parent ${vertex.parent} is not a container`);
  }
  // No parent cycles.
  for (const vertex of allVertices(doc)) {
    const seen = new Set([vertex.id]);
    let current = vertex;
    while (current?.parent) {
      if (seen.has(current.parent)) {
        problems.push(`${vertex.id}: parent cycle`);
        break;
      }
      seen.add(current.parent);
      current = vertexById(doc, current.parent);
    }
  }
  return problems;
}

/** Children whose rectangle is not fully inside their parent's rectangle. */
function escapedChildren(doc) {
  const escaped = [];
  for (const vertex of allVertices(doc)) {
    const parent = vertex.parent ? vertexById(doc, vertex.parent) : null;
    if (!parent) continue;
    const inside =
      vertex.x >= parent.x &&
      vertex.y >= parent.y &&
      vertex.x + vertex.w <= parent.x + parent.w &&
      vertex.y + vertex.h <= parent.y + parent.h;
    if (!inside) {
      escaped.push(
        `${vertex.name || vertex.label} (${vertex.x},${vertex.y} ${vertex.w}x${vertex.h}) outside ` +
          `${parent.label} (${parent.x},${parent.y} ${parent.w}x${parent.h})`
      );
    }
  }
  return escaped;
}

/** Vertices the editor would move to another container the first time they are touched. */
function reparentDrift(doc) {
  const drift = [];
  for (const vertex of allVertices(doc)) {
    const copy = structuredClone(doc);
    for (const change of reparent(copy, [vertex.id])) {
      drift.push(`${vertex.name || vertex.label}: ${change.from} -> ${change.to}`);
    }
  }
  return drift;
}

/** Load a built document the way Flow Studio reloads a saved one. */
function reload(doc) {
  return normalizeDocument(JSON.parse(JSON.stringify(doc)), {
    resolveIcon: (node) => ICON_BY_ID.get(node.iconId) || realIcon(node.serviceName),
  });
}

/** Replace generated ids with positional tokens so two builds can be compared. */
function canonical(doc) {
  const tokens = new Map();
  doc.shapes.forEach((shape, index) => tokens.set(shape.id, `shape#${index}`));
  doc.nodes.forEach((node, index) => tokens.set(node.id, `node#${index}`));
  doc.connections.forEach((connection, index) => tokens.set(connection.id, `link#${index}`));
  return JSON.parse(
    JSON.stringify(doc, (_key, value) =>
      typeof value === "string" && tokens.has(value) ? tokens.get(value) : value
    )
  );
}

/**
 * The template builder exactly as it shipped before buildBlueprint existed
 * (HEAD of src/diagram/templates.js), kept here as the regression oracle.
 */
function legacyBuildTemplate(
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

/** A small VPC-shaped blueprint used across the unit tests. */
function vpcSketch() {
  return {
    name: "Sketch",
    groups: [
      { key: "cloud", preset: "aws-cloud", x: 0, y: 0, w: 1000, h: 700 },
      { key: "vpc", preset: "vpc", x: 40, y: 40, w: 900, h: 600, parent: "cloud" },
      { key: "public", preset: "public-subnet", x: 80, y: 100, w: 240, h: 400, parent: "vpc" },
      { key: "app", preset: "private-subnet", x: 360, y: 100, w: 240, h: 400, parent: "vpc" },
      {
        key: "data",
        preset: "private-subnet",
        label: "Data subnet",
        zone: "data",
        x: 640,
        y: 100,
        w: 240,
        h: 400,
        parent: "vpc",
      },
      { key: "asg", preset: "auto-scaling-group", x: 380, y: 200, w: 200, h: 200, parent: "app" },
    ],
    nodes: [
      {
        key: "alb",
        service: "Elastic Load Balancing",
        name: "ALB",
        x: 170,
        y: 250,
        parent: "public",
      },
      { key: "fleet", service: "Amazon EC2", name: "Fleet", x: 450, y: 280, parent: "asg" },
      { key: "db", service: "Amazon RDS", name: "DB", x: 730, y: 250, parent: "data" },
      { key: "fn", service: "AWS Lambda", name: "Worker", x: 450, y: 420, parent: "app" },
    ],
    links: [
      ["alb", "fleet"],
      ["fleet", "db"],
    ],
  };
}

// ----------------------------------------------------------- the basics

describe("buildBlueprint — document", () => {
  it("builds an empty v3 document from an empty blueprint", () => {
    const doc = buildBlueprint({});
    expect(doc.version).toBe(3);
    expect(doc.name).toBe("Generated diagram");
    expect(doc.region).toBe("us-east-1");
    expect(doc.nodes).toEqual([]);
    expect(doc.shapes).toEqual([]);
    expect(doc.connections).toEqual([]);
  });

  it("uses the blueprint name and copies its region", () => {
    const doc = buildBlueprint({ name: "Access map", region: "eu-west-2" }, { findIcon: anyIcon });
    expect(doc.name).toBe("Access map");
    expect(doc.region).toBe("eu-west-2");
  });

  it("keeps the default region when the blueprint has none", () => {
    expect(buildBlueprint({ name: "No region" }).region).toBe("us-east-1");
    expect(buildBlueprint({ name: "Blank region", region: "" }).region).toBe("us-east-1");
  });

  it("does not mutate the blueprint it is given", () => {
    const blueprint = {
      ...vpcSketch(),
      links: [
        ["alb", "fleet"],
        { from: "fleet", to: "db", label: "SQL", style: { stroke: "#123456" } },
      ],
      shapes: [{ kind: "note", key: "n", x: 1, y: 2, label: "hi", style: { fill: "#ffffff" } }],
    };
    const before = structuredClone(blueprint);
    buildBlueprint(blueprint, {
      findIcon: anyIcon,
      connectionDefaults: () => ({ style: { dash: "dashed" } }),
    });
    expect(blueprint).toEqual(before);
  });

  it("gives every vertex and connection a unique id", () => {
    const doc = buildBlueprint(
      { ...vpcSketch(), shapes: [{ kind: "note", x: 0, y: 0 }] },
      { findIcon: anyIcon }
    );
    const ids = [...allVertices(doc), ...doc.connections].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --------------------------------------------------------------- groups

describe("buildBlueprint — groups", () => {
  it("turns each group into a container with its preset, geometry and label", () => {
    const doc = buildBlueprint(vpcSketch(), { findIcon: anyIcon });
    expect(doc.shapes).toHaveLength(6);
    expect(doc.shapes.every((shape) => shape.kind === "container")).toBe(true);
    const data = shapeLabelled(doc, "Data subnet");
    expect(data).toMatchObject({
      preset: "private-subnet",
      x: 640,
      y: 100,
      w: 240,
      h: 400,
      zone: "data",
    });
  });

  it("falls back to the preset label and the generic preset", () => {
    const doc = buildBlueprint({
      groups: [
        { key: "vpc", preset: "vpc", x: 0, y: 0, w: 300, h: 200 },
        { key: "odd", preset: "not-a-preset", x: 0, y: 0, w: 100, h: 100 },
      ],
    });
    expect(doc.shapes[0].label).toBe("VPC");
    expect(doc.shapes[1].preset).toBe("generic");
  });

  it("uses the preset size when a group gives none", () => {
    const doc = buildBlueprint({ groups: [{ key: "sub", preset: "public-subnet", x: 5, y: 6 }] });
    expect(doc.shapes[0]).toMatchObject({ x: 5, y: 6, w: 240, h: 180 });
  });

  it("copies a group style onto the container", () => {
    const style = { fill: "#fafafa", stroke: "#000000" };
    const doc = buildBlueprint({
      groups: [{ key: "g", preset: "generic", x: 0, y: 0, w: 10, h: 10, style }],
    });
    expect(doc.shapes[0].style).toEqual(style);
    expect(doc.shapes[0].style).not.toBe(style);
  });

  it("stacks groups below the connector layer, earlier groups further back", () => {
    const doc = buildBlueprint(vpcSketch(), { findIcon: anyIcon });
    expect(doc.shapes.map((shape) => shape.z)).toEqual([-6, -5, -4, -3, -2, -1]);
    const { below, above } = renderOrder(doc);
    expect(below.map((shape) => shape.id)).toEqual(doc.shapes.map((shape) => shape.id));
    expect(above.every((vertex) => isServiceNode(vertex))).toBe(true);
  });

  it("paints every container before the things inside it", () => {
    const doc = buildBlueprint(vpcSketch(), { findIcon: anyIcon });
    const { below, above } = renderOrder(doc);
    const order = [...below, ...above].map((vertex) => vertex.id);
    for (const vertex of allVertices(doc)) {
      if (vertex.parent)
        expect(order.indexOf(vertex.parent)).toBeLessThan(order.indexOf(vertex.id));
    }
  });

  it("resolves group parents by key", () => {
    const doc = buildBlueprint(vpcSketch(), { findIcon: anyIcon });
    const byPreset = (preset) => doc.shapes.filter((shape) => shape.preset === preset);
    const [cloud] = byPreset("aws-cloud");
    const [vpc] = byPreset("vpc");
    const [asg] = byPreset("auto-scaling-group");
    expect(cloud.parent).toBeNull();
    expect(vpc.parent).toBe(cloud.id);
    expect(byPreset("private-subnet").every((subnet) => subnet.parent === vpc.id)).toBe(true);
    expect(asg.parent).toBe(shapeLabelled(doc, "Private subnet").id);
  });

  it("resolves a parent declared after its child", () => {
    const doc = buildBlueprint({
      groups: [
        { key: "inner", preset: "public-subnet", x: 20, y: 20, w: 100, h: 100, parent: "outer" },
        { key: "outer", preset: "vpc", x: 0, y: 0, w: 300, h: 300 },
      ],
    });
    expect(doc.shapes[0].parent).toBe(doc.shapes[1].id);
    expect(structuralProblems(doc)).toEqual([]);
  });

  it("leaves a group at the top level when its parent key is unknown", () => {
    const doc = buildBlueprint({
      groups: [{ key: "lost", preset: "vpc", x: 0, y: 0, w: 10, h: 10, parent: "nowhere" }],
    });
    expect(doc.shapes[0].parent ?? null).toBeNull();
    expect(structuralProblems(doc)).toEqual([]);
  });

  it("ignores a zone that is not a trust zone on the container itself", () => {
    const doc = buildBlueprint({
      groups: [{ key: "g", preset: "generic", x: 0, y: 0, w: 10, h: 10, zone: "dmz" }],
    });
    expect(doc.shapes[0]).not.toHaveProperty("zone");
  });
});

// ----------------------------------------------------------------- zones

describe("buildBlueprint — zone inheritance", () => {
  const build = (blueprint = vpcSketch()) => buildBlueprint(blueprint, { findIcon: anyIcon });

  it("puts a service in a public subnet in the public zone", () => {
    expect(nodeNamed(build(), "ALB").zone).toBe("public");
  });

  it("puts a service in a private subnet in the private zone", () => {
    expect(nodeNamed(build(), "Worker").zone).toBe("private");
  });

  it("walks up through unzoned containers to the nearest zoned one", () => {
    // Fleet sits in an Auto Scaling group inside the private App subnet.
    expect(nodeNamed(build(), "Fleet").zone).toBe("private");
  });

  it("lets a group's zone override its preset's zone", () => {
    expect(nodeNamed(build(), "DB").zone).toBe("data");
  });

  it("takes the zone of the innermost zoned container", () => {
    const doc = build({
      groups: [
        { key: "mgmt", preset: "generic", zone: "management", x: 0, y: 0, w: 600, h: 600 },
        { key: "pub", preset: "public-subnet", x: 50, y: 50, w: 300, h: 300, parent: "mgmt" },
      ],
      nodes: [
        { key: "a", service: "AWS Lambda", name: "Inner", x: 100, y: 100, parent: "pub" },
        { key: "b", service: "AWS Lambda", name: "Outer", x: 450, y: 450, parent: "mgmt" },
      ],
    });
    expect(nodeNamed(doc, "Inner").zone).toBe("public");
    expect(nodeNamed(doc, "Outer").zone).toBe("management");
  });

  it("gives a zone to services in a non-subnet container that declares one", () => {
    const doc = build({
      groups: [{ key: "ops", preset: "generic", zone: "management", x: 0, y: 0, w: 300, h: 300 }],
      nodes: [
        { key: "a", service: "Amazon DynamoDB", name: "Audit", x: 100, y: 100, parent: "ops" },
      ],
    });
    expect(doc.shapes[0].zone).toBe("management");
    expect(nodeNamed(doc, "Audit").zone).toBe("management");
  });

  it("keeps the zone inferred from the service when no container confers one", () => {
    const doc = build({
      groups: [{ key: "vpc", preset: "vpc", x: 0, y: 0, w: 600, h: 600 }],
      nodes: [
        { key: "db", service: "Amazon DynamoDB", name: "Table", x: 100, y: 100, parent: "vpc" },
        { key: "cdn", service: "Amazon CloudFront", name: "Edge", x: 300, y: 100, parent: "vpc" },
        { key: "free", service: "AWS Key Management Service", name: "Keys", x: 900, y: 100 },
      ],
    });
    expect(nodeNamed(doc, "Table").zone).toBe("data");
    expect(nodeNamed(doc, "Edge").zone).toBe("edge");
    expect(nodeNamed(doc, "Keys").zone).toBe("management");
  });

  it("lets an explicit node zone win over its container", () => {
    const blueprint = vpcSketch();
    blueprint.nodes[0].zone = "edge"; // ALB in the public subnet
    blueprint.nodes[2].zone = "management"; // DB in the data subnet
    const doc = build(blueprint);
    expect(nodeNamed(doc, "ALB").zone).toBe("edge");
    expect(nodeNamed(doc, "DB").zone).toBe("management");
  });

  it("agrees with the editor's own container-zone rule", () => {
    const doc = build();
    for (const node of doc.nodes) {
      const inherited = inheritedZone(doc, node.id);
      if (inherited) expect(node.zone).toBe(inherited.zone);
    }
  });

  it("never stores a zone that is not a trust zone", () => {
    // The container drops "DMZ" (not a zone id); its services must not pick it up either.
    const doc = build({
      groups: [{ key: "g", preset: "public-subnet", zone: "DMZ", x: 0, y: 0, w: 300, h: 300 }],
      nodes: [{ key: "a", service: "AWS Lambda", name: "Fn", x: 100, y: 100, parent: "g" }],
    });
    expect(ZONE_IDS).toContain(nodeNamed(doc, "Fn").zone);
    expect(nodeNamed(doc, "Fn").zone).toBe("public");
  });
});

// ------------------------------------------------------------- services

describe("buildBlueprint — services", () => {
  it("creates service nodes from the resolved icon", () => {
    const findIcon = vi.fn(anyIcon);
    const doc = buildBlueprint(
      {
        name: "Svc",
        nodes: [
          { key: "u", service: "Users 48 Light", type: "resource", name: "Users", x: 1, y: 2 },
          { key: "f", service: "AWS Lambda", name: "Fn", x: 3, y: 4 },
        ],
      },
      { findIcon }
    );
    expect(findIcon).toHaveBeenNthCalledWith(1, "Users 48 Light", "resource");
    expect(findIcon).toHaveBeenNthCalledWith(2, "AWS Lambda", "service");
    expect(doc.nodes).toHaveLength(2);
    expect(doc.nodes[0]).toMatchObject({
      iconId: "icon:resource:Users 48 Light",
      iconType: "resource",
      serviceName: "Users 48 Light",
      name: "Users",
      x: 1,
      y: 2,
      w: 48,
      h: 48,
      z: 1,
      parent: null,
    });
    expect(doc.nodes[1]).toMatchObject({ serviceName: "AWS Lambda", name: "Fn", z: 2 });
    expect(doc.nodes.every(isServiceNode)).toBe(true);
  });

  it("names a node after its service when no name is given", () => {
    const doc = buildBlueprint(
      { nodes: [{ key: "f", service: "AWS Lambda", x: 0, y: 0 }] },
      { findIcon: anyIcon }
    );
    expect(doc.nodes[0].name).toBe("AWS Lambda");
  });

  it("applies the environment option, defaulting to Production", () => {
    const blueprint = { nodes: [{ key: "f", service: "AWS Lambda", name: "Fn", x: 0, y: 0 }] };
    expect(buildBlueprint(blueprint, { findIcon: anyIcon }).nodes[0].environment).toBe(
      "Production"
    );
    expect(
      buildBlueprint(blueprint, { findIcon: anyIcon, environment: "Staging" }).nodes[0].environment
    ).toBe("Staging");
    expect(
      buildBlueprint(blueprint, { findIcon: anyIcon, environment: "Moon" }).nodes[0].environment
    ).toBe("Production");
  });

  it("marks the first four services high criticality unless told otherwise", () => {
    const nodes = Array.from({ length: 6 }, (_, index) => ({
      key: `n${index}`,
      service: "AWS Lambda",
      name: `Fn ${index}`,
      x: index * 100,
      y: 0,
    }));
    nodes[1].criticality = "low";
    nodes[5].criticality = "high";
    const doc = buildBlueprint({ nodes }, { findIcon: anyIcon });
    expect(doc.nodes.map((node) => node.criticality)).toEqual([
      "high",
      "low",
      "high",
      "high",
      "medium",
      "high",
    ]);
  });

  it("uses explicit notes, including an empty string", () => {
    const doc = buildBlueprint(
      {
        name: "Notes",
        nodes: [
          { key: "a", service: "AWS Lambda", name: "A", x: 0, y: 0, notes: "Runs the jobs." },
          { key: "b", service: "AWS Lambda", name: "B", x: 0, y: 0, notes: "" },
          { key: "c", service: "AWS Lambda", name: "C", x: 0, y: 0 },
        ],
      },
      { findIcon: anyIcon }
    );
    expect(nodeNamed(doc, "A").notes).toBe("Runs the jobs.");
    expect(nodeNamed(doc, "B").notes).toBe("");
    expect(nodeNamed(doc, "C").notes).toBe("AWS Lambda in the Notes reference architecture.");
  });

  it("writes default notes that name the diagram even when the blueprint is unnamed", () => {
    const doc = buildBlueprint(
      { nodes: [{ key: "a", service: "AWS Lambda", name: "A", x: 0, y: 0 }] },
      { findIcon: anyIcon }
    );
    expect(doc.nodes[0].notes).not.toContain("undefined");
    expect(doc.nodes[0].notes).toContain(doc.name);
  });

  it("resolves a node's parent by group key", () => {
    const doc = buildBlueprint(vpcSketch(), { findIcon: anyIcon });
    expect(nodeNamed(doc, "Fleet").parent).toBe(
      doc.shapes.find((shape) => shape.preset === "auto-scaling-group").id
    );
    expect(nodeNamed(doc, "DB").parent).toBe(shapeLabelled(doc, "Data subnet").id);
  });

  it("leaves a node at the top level when its parent key is unknown", () => {
    const doc = buildBlueprint(
      { nodes: [{ key: "a", service: "AWS Lambda", name: "A", x: 0, y: 0, parent: "ghost" }] },
      { findIcon: anyIcon }
    );
    expect(doc.nodes[0].parent).toBeNull();
  });
});

// ---------------------------------------------------------- missing icons

describe("buildBlueprint — services without an icon", () => {
  const blueprint = () => ({
    name: "Fallback",
    groups: [{ key: "vpc", preset: "vpc", x: 0, y: 0, w: 600, h: 400 }],
    nodes: [
      { key: "fn", service: "AWS Lambda", name: "Worker", x: 40, y: 40, parent: "vpc" },
      { key: "mystery", service: "Quantum Router", name: "Router", x: 200, y: 60, parent: "vpc" },
      { key: "unnamed", service: "Mystery Box", x: 300, y: 300 },
    ],
    links: [["fn", "mystery"], { from: "mystery", to: "unnamed", label: "tunnel" }],
  });

  it("draws a labelled rounded box instead (non-strict)", () => {
    const doc = buildBlueprint(blueprint(), {
      findIcon: iconsExcept("Quantum Router", "Mystery Box"),
    });
    expect(doc.nodes.map((node) => node.name)).toEqual(["Worker"]);
    const router = shapeLabelled(doc, "Router");
    expect(router).toMatchObject({ kind: "rounded", x: 200, y: 60, w: 120, h: 48, z: 2 });
    expect(router.parent).toBe(doc.shapes[0].id);
    expect(isServiceNode(router)).toBe(false);
  });

  it("labels the box with the service when the node has no name", () => {
    const doc = buildBlueprint(blueprint(), {
      findIcon: iconsExcept("Quantum Router", "Mystery Box"),
    });
    expect(shapeLabelled(doc, "Mystery Box")).toMatchObject({
      kind: "rounded",
      z: 3,
      parent: null,
    });
  });

  it("still connects links to and from the fallback box", () => {
    const connectionDefaults = vi.fn(() => ({}));
    const doc = buildBlueprint(blueprint(), {
      findIcon: iconsExcept("Quantum Router", "Mystery Box"),
      connectionDefaults,
    });
    const router = shapeLabelled(doc, "Router");
    const box = shapeLabelled(doc, "Mystery Box");
    expect(doc.connections).toHaveLength(2);
    expect(doc.connections[0]).toMatchObject({ from: nodeNamed(doc, "Worker").id, to: router.id });
    expect(doc.connections[1]).toMatchObject({ from: router.id, to: box.id, label: "tunnel" });
    expect(connectionDefaults).toHaveBeenCalledWith(nodeNamed(doc, "Worker"), router);
    expect(structuralProblems(doc)).toEqual([]);
  });

  it("builds without any findIcon at all", () => {
    const doc = buildBlueprint(blueprint());
    expect(doc.nodes).toEqual([]);
    expect(doc.shapes.filter((shape) => shape.kind === "rounded")).toHaveLength(3);
    expect(doc.connections).toHaveLength(2);
  });

  it("throws in strict mode, naming the service", () => {
    expect(() =>
      buildBlueprint(blueprint(), { findIcon: iconsExcept("Quantum Router"), strict: true })
    ).toThrow("Missing icon for template service: Quantum Router");
  });

  it("throws in strict mode when no findIcon is supplied", () => {
    expect(() => buildBlueprint(blueprint(), { strict: true })).toThrow(
      /Missing icon for template service: AWS Lambda/
    );
  });

  it("survives a reload unchanged", () => {
    const doc = buildBlueprint(blueprint(), {
      findIcon: iconsExcept("Quantum Router", "Mystery Box"),
    });
    const { doc: reloaded, skipped } = normalizeDocument(JSON.parse(JSON.stringify(doc)), {
      resolveIcon: (node) => fakeIcon(node.serviceName, node.iconType),
    });
    expect(skipped).toEqual([]);
    expect(reloaded).toEqual(doc);
  });
});

// ----------------------------------------------------------- free shapes

describe("buildBlueprint — free shapes", () => {
  it("adds notes and text with their geometry, label and style", () => {
    const doc = buildBlueprint({
      shapes: [
        {
          kind: "note",
          x: 10,
          y: 20,
          w: 300,
          h: 90,
          label: "Grade A",
          style: { fill: "#fff8c5" },
        },
        { kind: "text", x: 5, y: 6, label: "Caption" },
      ],
    });
    expect(doc.shapes[0]).toMatchObject({
      kind: "note",
      x: 10,
      y: 20,
      w: 300,
      h: 90,
      label: "Grade A",
      style: { fill: "#fff8c5" },
      parent: null,
    });
    expect(doc.shapes[1]).toMatchObject({
      kind: "text",
      label: "Caption",
      w: SHAPE_KINDS.text.w,
      h: SHAPE_KINDS.text.h,
    });
  });

  it("stacks free shapes above services by default and honours an explicit z", () => {
    const doc = buildBlueprint({
      shapes: [
        { kind: "note", x: 0, y: 0 },
        { kind: "text", x: 0, y: 0, z: 0 },
        { kind: "note", x: 0, y: 0, z: -7 },
        { kind: "note", x: 0, y: 0 },
      ],
    });
    expect(doc.shapes.map((shape) => shape.z)).toEqual([100, 0, -7, 103]);
  });

  it("places free shapes inside a group by key", () => {
    const doc = buildBlueprint({
      groups: [{ key: "region", preset: "region", x: 0, y: 0, w: 500, h: 500 }],
      shapes: [{ kind: "note", x: 20, y: 400, w: 200, h: 60, label: "Summary", parent: "region" }],
    });
    expect(shapeLabelled(doc, "Summary").parent).toBe(doc.shapes[0].id);
    expect(structuralProblems(doc)).toEqual([]);
  });

  it("falls back to a rectangle for an unknown kind", () => {
    const doc = buildBlueprint({ shapes: [{ kind: "hexagon-ish", x: 0, y: 0, label: "?" }] });
    expect(doc.shapes[0].kind).toBe("rect");
  });

  it("registers a keyed shape so links can use it", () => {
    const doc = buildBlueprint(
      {
        nodes: [{ key: "fn", service: "AWS Lambda", name: "Fn", x: 0, y: 0 }],
        shapes: [
          { kind: "note", key: "why", x: 200, y: 0, label: "Why" },
          { kind: "text", x: 0, y: 200, label: "Unkeyed" },
        ],
        links: [["why", "fn"], { from: "fn", to: "why", label: "explains" }],
      },
      { findIcon: anyIcon }
    );
    const note = shapeLabelled(doc, "Why");
    const fn = nodeNamed(doc, "Fn");
    expect(doc.connections.map((c) => [c.from, c.to])).toEqual([
      [note.id, fn.id],
      [fn.id, note.id],
    ]);
  });
});

// ----------------------------------------------------------------- links

describe("buildBlueprint — links", () => {
  const two = (links, options = {}) =>
    buildBlueprint(
      {
        nodes: [
          { key: "a", service: "AWS Lambda", name: "A", x: 0, y: 0 },
          { key: "b", service: "Amazon DynamoDB", name: "B", x: 200, y: 0 },
        ],
        links,
      },
      { findIcon: anyIcon, ...options }
    );

  it("accepts [from, to] pairs", () => {
    const doc = two([["a", "b"]]);
    expect(doc.connections).toHaveLength(1);
    expect(doc.connections[0]).toMatchObject({
      from: nodeNamed(doc, "A").id,
      to: nodeNamed(doc, "B").id,
      type: "request",
      label: "",
      encrypted: true,
      style: {},
    });
  });

  it("asks connectionDefaults about the two vertices and applies its answer", () => {
    const connectionDefaults = vi.fn(() => ({
      type: "data",
      label: "default",
      encrypted: false,
      style: { stroke: "#111111", dash: "dashed" },
    }));
    const doc = two([["a", "b"]], { connectionDefaults });
    expect(connectionDefaults).toHaveBeenCalledTimes(1);
    expect(connectionDefaults).toHaveBeenCalledWith(nodeNamed(doc, "A"), nodeNamed(doc, "B"));
    expect(doc.connections[0]).toMatchObject({
      type: "data",
      label: "default",
      encrypted: false,
      style: { stroke: "#111111", dash: "dashed" },
    });
  });

  it("merges an object link's label, type and style over the defaults", () => {
    const defaults = {
      type: "data",
      label: "default",
      style: { stroke: "#111111", dash: "dashed" },
    };
    const doc = two(
      [{ from: "a", to: "b", label: "writes", type: "event", style: { stroke: "#dd344c" } }],
      { connectionDefaults: () => defaults }
    );
    expect(doc.connections[0]).toMatchObject({
      type: "event",
      label: "writes",
      style: { stroke: "#dd344c", dash: "dashed" },
    });
    // The defaults object is not modified by the merge.
    expect(defaults.style).toEqual({ stroke: "#111111", dash: "dashed" });
  });

  it("keeps the default style when an object link has none", () => {
    const doc = two([{ from: "a", to: "b", label: "reads" }], {
      connectionDefaults: () => ({ style: { routing: "straight" } }),
    });
    expect(doc.connections[0].style).toEqual({ routing: "straight" });
    expect(doc.connections[0].label).toBe("reads");
  });

  it("passes encrypted: false and other connection options through", () => {
    const doc = two([{ from: "a", to: "b", encrypted: false, fromPort: "e", toPort: "w" }]);
    expect(doc.connections[0]).toMatchObject({ encrypted: false, fromPort: "e", toPort: "w" });
  });

  it("normalises an unknown traffic type to request", () => {
    const doc = two([{ from: "a", to: "b", type: "carrier-pigeon" }]);
    expect(doc.connections[0].type).toBe("request");
  });

  it("skips links whose ends are not in the blueprint", () => {
    const connectionDefaults = vi.fn(() => ({}));
    const doc = two(
      [
        ["a", "ghost"],
        ["ghost", "b"],
        { from: "nobody", to: "nowhere" },
        { from: "a" },
        ["a", "b"],
      ],
      { connectionDefaults }
    );
    expect(doc.connections).toHaveLength(1);
    expect(connectionDefaults).toHaveBeenCalledTimes(1);
    expect(structuralProblems(doc)).toEqual([]);
  });

  it("can link to a group by its key", () => {
    const doc = buildBlueprint(
      {
        groups: [{ key: "vpc", preset: "vpc", x: 100, y: 0, w: 300, h: 300 }],
        nodes: [{ key: "a", service: "AWS Lambda", name: "A", x: 0, y: 0 }],
        links: [["a", "vpc"]],
      },
      { findIcon: anyIcon }
    );
    expect(doc.connections[0].to).toBe(doc.shapes[0].id);
  });

  it("allows several links between the same pair", () => {
    const doc = two([
      { from: "a", to: "b", label: "allow" },
      { from: "a", to: "b", label: "deny", style: { dash: "dashed" } },
    ]);
    expect(doc.connections.map((c) => c.label)).toEqual(["allow", "deny"]);
    expect(doc.connections[0].id).not.toBe(doc.connections[1].id);
  });
});

// ------------------------------------------------------------- templates

describe("buildTemplate on top of buildBlueprint", () => {
  const connectionDefaults = (from, to) => ({
    type: from.zone === to.zone ? "request" : "data",
    style: { stroke: "#232f3e" },
  });

  it("returns null for an unknown template", () => {
    expect(buildTemplate("nope", { findIcon: anyIcon })).toBeNull();
  });

  it.each(TEMPLATE_IDS)("builds %s exactly as the previous implementation did", (id) => {
    for (const options of [
      { findIcon: anyIcon },
      { findIcon: anyIcon, connectionDefaults, environment: "Staging" },
    ]) {
      expect(canonical(buildTemplate(id, options))).toEqual(
        canonical(legacyBuildTemplate(id, options))
      );
    }
  });

  it.each(TEMPLATE_IDS)("keeps %s's node, container and connection counts", (id) => {
    const template = TEMPLATES[id];
    const doc = buildTemplate(id, { findIcon: anyIcon });
    expect(doc.name).toBe(template.title);
    expect(doc.nodes).toHaveLength(template.nodes.length);
    expect(doc.shapes).toHaveLength(template.groups.length);
    expect(doc.connections).toHaveLength(template.links.length);
    expect(doc.nodes.every((node) => ZONE_IDS.includes(node.zone))).toBe(true);
    for (const entry of template.nodes.filter((candidate) => candidate.zone)) {
      expect(nodeNamed(doc, entry.name).zone).toBe(entry.zone);
    }
  });

  it("zones the resilient web app from its subnets", () => {
    const doc = buildTemplate("web", { findIcon: anyIcon });
    const zones = Object.fromEntries(doc.nodes.map((node) => [node.name, node.zone]));
    expect(zones).toEqual({
      Customers: "internet",
      "Global DNS": "edge",
      "Global edge": "edge",
      "Edge protection": "edge",
      "Application load balancer": "public",
      "Application fleet": "private",
      "Primary database": "data",
      "Static assets": "data",
      "Operations telemetry": "management",
      "Recovery vault": "data",
    });
  });

  it("writes the template title into the default notes", () => {
    const doc = buildTemplate("serverless", { findIcon: anyIcon });
    expect(nodeNamed(doc, "Request processor").notes).toBe(
      "AWS Lambda in the Serverless API reference architecture."
    );
  });

  it("is always strict about missing icons, whatever the caller passes", () => {
    expect(() =>
      buildTemplate("serverless", { findIcon: iconsExcept("AWS WAF"), strict: false })
    ).toThrow("Missing icon for template service: AWS WAF");
    expect(() => buildTemplate("events")).toThrow(/Missing icon for template service/);
  });

  it.each(TEMPLATE_IDS)("resolves every %s service against the real icon catalog", (id) => {
    const doc = buildTemplate(id, { findIcon: realIcon });
    expect(doc.nodes).toHaveLength(TEMPLATES[id].nodes.length);
    expect(structuralProblems(doc)).toEqual([]);
    expect(escapedChildren(doc)).toEqual([]);
    expect(reparentDrift(doc)).toEqual([]);
    const { doc: reloaded, skipped } = reload(doc);
    expect(skipped).toEqual([]);
    expect(reloaded).toEqual(doc);
  });
});

// ------------------------------------------- generated IAM and VPC diagrams

const identityAnalysis = analyzePolicy(SAMPLE_POLICY);
const trustAnalysis = analyzePolicy(SAMPLE_TRUST_POLICY);

const RESOURCE_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "Website",
      Effect: "Allow",
      Principal: "*",
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::site/*",
    },
    {
      Sid: "Cdn",
      Effect: "Allow",
      Principal: { Service: "cloudfront.amazonaws.com" },
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::site/*",
      Condition: {
        StringEquals: { "AWS:SourceArn": "arn:aws:cloudfront::111122223333:distribution/ABC" },
      },
    },
    {
      Sid: "Deployer",
      Effect: "Allow",
      Principal: { AWS: "arn:aws:iam::111122223333:role/deployer" },
      Action: "s3:PutObject",
      Resource: "arn:aws:s3:::site/*",
    },
    {
      Sid: "TlsOnly",
      Effect: "Deny",
      Principal: "*",
      Action: "s3:*",
      Resource: ["arn:aws:s3:::site", "arn:aws:s3:::site/*"],
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    },
  ],
});

const IDENTITY_WITH_DENY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    { Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::reports/*" },
    { Effect: "Deny", Action: "s3:DeleteObject", Resource: "*" },
  ],
});

const TRUST_WITH_DENY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
    {
      Effect: "Deny",
      Principal: { AWS: "*" },
      Action: "sts:AssumeRole",
      Condition: { StringNotEquals: { "aws:PrincipalOrgID": "o-abc123" } },
    },
  ],
});

const GENERATED = {
  "IAM access map (SAMPLE_POLICY)": () => accessMapBlueprint(identityAnalysis),
  "IAM trust map (SAMPLE_TRUST_POLICY)": () =>
    accessMapBlueprint(trustAnalysis, { name: "IAM trust map" }),
  "IAM access map (resource policy with deny)": () =>
    accessMapBlueprint(analyzePolicy(RESOURCE_POLICY)),
  "IAM access map (identity policy with deny)": () =>
    accessMapBlueprint(analyzePolicy(IDENTITY_WITH_DENY)),
  "IAM trust map (with deny)": () => accessMapBlueprint(analyzePolicy(TRUST_WITH_DENY)),
  "VPC plan (DEFAULT_PLAN)": () => vpcBlueprint(planVpc(DEFAULT_PLAN)),
  "VPC plan (single NAT, one AZ)": () =>
    vpcBlueprint(planVpc({ ...DEFAULT_PLAN, azs: 1, spareAzs: 0, natGateways: "single" })),
  "VPC plan (six AZs, no NAT)": () =>
    vpcBlueprint(
      planVpc({ ...DEFAULT_PLAN, cidr: "10.8.0.0/16", azs: 6, spareAzs: 0, natGateways: "none" })
    ),
  "VPC plan (private tiers only)": () =>
    vpcBlueprint(
      planVpc({
        cidr: "172.20.0.0/20",
        region: "eu-west-1",
        azs: 2,
        tiers: [
          { name: "App", kind: "private", prefix: 24 },
          { name: "Data", kind: "data", prefix: 26 },
        ],
      })
    ),
};
const CASES = Object.keys(GENERATED);
const buildGenerated = (label, options = {}) =>
  buildBlueprint(GENERATED[label](), { findIcon: realIcon, ...options });

describe("generated blueprints build into valid documents", () => {
  it.each(CASES)("%s: every service resolves to a real catalog icon", (label) => {
    const blueprint = GENERATED[label]();
    expect(() => buildBlueprint(blueprint, { findIcon: realIcon, strict: true })).not.toThrow();
    const doc = buildGenerated(label);
    expect(doc.nodes).toHaveLength(blueprint.nodes.length);
    expect(doc.shapes.filter((shape) => shape.kind === "rounded")).toEqual([]);
  });

  it.each(CASES)("%s: every connection joins two existing vertices", (label) => {
    const blueprint = GENERATED[label]();
    const doc = buildGenerated(label);
    expect(doc.connections).toHaveLength(blueprint.links.length);
    // A VPC with no public tier has no internet gateway, so nothing to connect.
    if (!label.includes("private tiers only")) expect(doc.connections.length).toBeGreaterThan(0);
    expect(structuralProblems(doc)).toEqual([]);
  });

  it.each(CASES)("%s: every parent exists and is a container", (label) => {
    const doc = buildGenerated(label);
    for (const vertex of allVertices(doc)) {
      if (!vertex.parent) continue;
      const parent = vertexById(doc, vertex.parent);
      expect(parent, `${vertex.name || vertex.label}`).toBeDefined();
      expect(isContainer(parent)).toBe(true);
    }
  });

  it.each(CASES)("%s: no child lies outside its parent's rectangle", (label) => {
    expect(escapedChildren(buildGenerated(label))).toEqual([]);
  });

  it.each(CASES)("%s: the editor keeps every vertex in the container it was drawn in", (label) => {
    expect(reparentDrift(buildGenerated(label))).toEqual([]);
  });

  it.each(CASES)("%s: reloads through normalizeDocument unchanged", (label) => {
    const doc = buildGenerated(label);
    const { doc: reloaded, skipped } = reload(doc);
    expect(skipped).toEqual([]);
    expect(reloaded).toEqual(doc);
  });

  it.each(CASES)("%s: only uses arrowheads and dashes the diagram supports", (label) => {
    const doc = buildGenerated(label);
    for (const connection of doc.connections) {
      const { startArrow, endArrow, dash } = connection.style;
      if (startArrow !== undefined) expect(ARROW_KINDS).toContain(startArrow);
      if (endArrow !== undefined) expect(ARROW_KINDS).toContain(endArrow);
      if (dash !== undefined) expect(Object.keys(DASH_PATTERNS)).toContain(dash);
    }
  });

  it.each(CASES)("%s: gives every service a trust zone the editor agrees with", (label) => {
    const blueprint = GENERATED[label]();
    const doc = buildGenerated(label);
    for (const node of doc.nodes) {
      expect(ZONE_IDS).toContain(node.zone);
      const entry = blueprint.nodes.find((candidate) => candidate.name === node.name);
      const inherited = inheritedZone(doc, node.id);
      if (!entry?.zone && inherited) expect(node.zone).toBe(inherited.zone);
    }
  });

  it.each(CASES)("%s: draws containers below connectors and services above", (label) => {
    const doc = buildGenerated(label);
    const { below, above } = renderOrder(doc);
    expect(below.every(isContainer)).toBe(true);
    expect(below).toHaveLength(doc.shapes.filter(isContainer).length);
    expect(above).toHaveLength(doc.nodes.length + doc.shapes.filter((s) => !isContainer(s)).length);
  });

  it.each(CASES)("%s: stays valid when no icon can be found", (label) => {
    const blueprint = GENERATED[label]();
    const doc = buildBlueprint(blueprint, { findIcon: () => null });
    expect(doc.nodes).toEqual([]);
    expect(doc.shapes.filter((shape) => shape.kind === "rounded")).toHaveLength(
      blueprint.nodes.length
    );
    expect(doc.connections).toHaveLength(blueprint.links.length);
    expect(structuralProblems(doc)).toEqual([]);
    const { doc: reloaded } = normalizeDocument(JSON.parse(JSON.stringify(doc)), {
      resolveIcon: () => null,
    });
    expect(reloaded).toEqual(doc);
  });
});

describe("generated blueprints — what they draw", () => {
  it("draws the SAMPLE_POLICY access map: the role, its account and seven services", () => {
    const doc = buildGenerated("IAM access map (SAMPLE_POLICY)");
    expect(doc.name).toBe("IAM access map");
    const account = doc.shapes.find((shape) => shape.preset === "aws-account");
    expect(account.label).toBe("AWS Account");
    const role = nodeNamed(doc, "This role");
    expect(role).toMatchObject({
      serviceName: "AWS Identity Access Management Role",
      zone: "management",
      parent: null,
    });
    const services = doc.nodes.filter((node) => node.parent === account.id);
    expect(services).toHaveLength(7);
    expect(services.map((node) => node.serviceName)).toEqual(
      expect.arrayContaining(["Amazon Simple Storage Service", "AWS Lambda", "Amazon DynamoDB"])
    );
    expect(doc.connections).toHaveLength(7);
    expect(doc.connections.every((c) => c.from === role.id)).toBe(true);
    const note = doc.shapes.find((shape) => shape.kind === "note");
    expect(note.label).toMatch(/^Grade F \(\d+\/100\)/);
  });

  it("keeps the access map's risk colours on the arrows", () => {
    const doc = buildGenerated("IAM access map (SAMPLE_POLICY)");
    const s3 = doc.nodes.find((node) => node.serviceName === "Amazon Simple Storage Service");
    const link = doc.connections.find((c) => c.to === s3.id);
    expect(link.label).toBe("full access · all resources");
    expect(link.style).toEqual({ stroke: "#d13212", strokeWidth: 2.2 });
    const dynamo = doc.nodes.find((node) => node.serviceName === "Amazon DynamoDB");
    expect(doc.connections.find((c) => c.to === dynamo.id).style.stroke).toBe("#1d8102");
  });

  it("draws the SAMPLE_TRUST_POLICY map: two principals that can assume the role", () => {
    const doc = buildGenerated("IAM trust map (SAMPLE_TRUST_POLICY)");
    expect(doc.name).toBe("IAM trust map");
    const account = doc.shapes.find((shape) => shape.preset === "aws-account");
    const role = nodeNamed(doc, "This role");
    expect(role.parent).toBe(account.id);
    expect(nodeNamed(doc, "token.actions.githubusercontent.com").serviceName).toBe(
      "Authenticated User 48 Light"
    );
    expect(nodeNamed(doc, "Account 444455556666").serviceName).toBe("AWS Organizations");
    expect(doc.connections).toHaveLength(2);
    expect(doc.connections.every((c) => c.to === role.id && c.label === "can assume")).toBe(true);
  });

  it("draws the public principal of a resource policy in the internet zone", () => {
    const doc = buildGenerated("IAM access map (resource policy with deny)");
    expect(nodeNamed(doc, "Anyone (public)")).toMatchObject({
      serviceName: "Users 48 Light",
      zone: "internet",
    });
    // Conditions are shown on the arrows, per statement.
    const cloudfront = nodeNamed(doc, "cloudfront");
    const arrows = doc.connections.filter((connection) => connection.from === cloudfront.id);
    expect(arrows.length).toBeGreaterThan(0);
    expect(arrows.every((connection) => /conditional/.test(connection.label))).toBe(true);
  });

  it("draws the default VPC plan: cloud, region, VPC, three AZs and nine subnets", () => {
    const doc = buildGenerated("VPC plan (DEFAULT_PLAN)");
    expect(doc.name).toBe("VPC plan 10.0.0.0/16");
    expect(doc.region).toBe("us-east-1");
    const count = (preset) => doc.shapes.filter((shape) => shape.preset === preset).length;
    expect(count("aws-cloud")).toBe(1);
    expect(count("region")).toBe(1);
    expect(count("vpc")).toBe(1);
    expect(count("availability-zone")).toBe(3);
    expect(count("public-subnet")).toBe(3);
    expect(count("private-subnet")).toBe(6);
    expect(doc.shapes.filter((shape) => shape.zone === "data")).toHaveLength(3);
    expect(shapeLabelled(doc, "VPC 10.0.0.0/16").parent).toBe(
      shapeLabelled(doc, "Region us-east-1").id
    );
  });

  it("puts one NAT gateway in each public subnet, zoned public", () => {
    const doc = buildGenerated("VPC plan (DEFAULT_PLAN)");
    const nats = doc.nodes.filter((node) => node.serviceName === "Amazon VPC NAT Gateway");
    expect(nats).toHaveLength(3);
    for (const nat of nats) {
      expect(vertexById(doc, nat.parent).preset).toBe("public-subnet");
      expect(nat.zone).toBe("public");
    }
  });

  it("connects the internet to the internet gateway on the VPC", () => {
    const doc = buildGenerated("VPC plan (DEFAULT_PLAN)");
    const internet = nodeNamed(doc, "Internet");
    const igw = nodeNamed(doc, "Internet gateway");
    expect(internet).toMatchObject({ zone: "internet", parent: null });
    expect(igw).toMatchObject({ zone: "edge", parent: shapeLabelled(doc, "VPC 10.0.0.0/16").id });
    expect(doc.connections).toHaveLength(1);
    expect(doc.connections[0]).toMatchObject({ from: internet.id, to: igw.id, label: "0.0.0.0/0" });
  });

  it("carries the plan's region and a summary note inside the region", () => {
    const doc = buildGenerated("VPC plan (private tiers only)");
    expect(doc.region).toBe("eu-west-1");
    const note = doc.shapes.find((shape) => shape.kind === "note");
    expect(vertexById(doc, note.parent).preset).toBe("region");
    expect(note.label).toMatch(/^4 subnets across 2 AZs/);
    expect(doc.nodes).toEqual([]);
  });

  it("adds a single NAT gateway to the first AZ only when asked", () => {
    const doc = buildGenerated("VPC plan (single NAT, one AZ)");
    expect(doc.nodes.filter((node) => node.serviceName === "Amazon VPC NAT Gateway")).toHaveLength(
      1
    );
  });
});
