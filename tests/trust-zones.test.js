import { describe, expect, it } from "vitest";
import {
  analyzeTrust,
  classifyCrossing,
  DEFAULT_ZONE,
  inferZone,
  isBoundaryCrossing,
  normalizeZone,
  ZONE_IDS,
  ZONES,
  zoneOf,
  zoneTrust,
} from "../src/trust-zones.js";

const node = (id, serviceName, extra = {}) => ({ id, name: id, serviceName, ...extra });
const link = (from, to, extra = {}) => ({ id: `${from}-${to}`, from, to, ...extra });

describe("zone model", () => {
  it("orders trust from the internet inward", () => {
    expect(zoneTrust("internet")).toBeLessThan(zoneTrust("edge"));
    expect(zoneTrust("edge")).toBeLessThan(zoneTrust("public"));
    expect(zoneTrust("public")).toBeLessThan(zoneTrust("private"));
    expect(zoneTrust("private")).toBeLessThan(zoneTrust("data"));
  });

  it("gives every zone a label and a hint", () => {
    for (const id of ZONE_IDS) {
      expect(ZONES[id].label).toBeTruthy();
      expect(ZONES[id].hint).toBeTruthy();
    }
  });

  it("normalises unknown values to the default zone", () => {
    expect(normalizeZone("PRIVATE")).toBe("private");
    expect(normalizeZone("nonsense")).toBe(DEFAULT_ZONE);
    expect(normalizeZone(undefined)).toBe(DEFAULT_ZONE);
    expect(normalizeZone(null, "data")).toBe("data");
  });
});

describe("inferZone", () => {
  it("places edge and managed entry services at the edge", () => {
    expect(inferZone("Amazon CloudFront")).toBe("edge");
    expect(inferZone("Amazon API Gateway")).toBe("edge");
    expect(inferZone("AWS WAF")).toBe("edge");
    expect(inferZone("Amazon Route 53")).toBe("edge");
  });

  it("places load balancers and NAT in the public subnet", () => {
    expect(inferZone("Elastic Load Balancing")).toBe("public");
    expect(inferZone("NAT Gateway")).toBe("public");
  });

  it("places stores in the data tier", () => {
    expect(inferZone("Amazon DynamoDB")).toBe("data");
    expect(inferZone("Amazon Simple Storage Service")).toBe("data");
    expect(inferZone("Amazon Aurora")).toBe("data");
    expect(inferZone("Amazon RDS")).toBe("data");
  });

  it("places the control plane in management", () => {
    expect(inferZone("AWS Identity and Access Management")).toBe("management");
    expect(inferZone("Amazon CloudWatch")).toBe("management");
    expect(inferZone("AWS Key Management Service")).toBe("management");
    expect(inferZone("AWS X Ray")).toBe("management");
  });

  it("defaults compute to the private subnet", () => {
    expect(inferZone("AWS Lambda")).toBe("private");
    expect(inferZone("Amazon EC2")).toBe("private");
    expect(inferZone("Something Unheard Of")).toBe(DEFAULT_ZONE);
    expect(inferZone("")).toBe(DEFAULT_ZONE);
  });

  it("prefers an explicitly declared zone over the inferred one", () => {
    expect(zoneOf({ serviceName: "AWS Lambda", zone: "public" })).toBe("public");
    expect(zoneOf({ serviceName: "AWS Lambda", zone: "bogus" })).toBe("private");
    expect(zoneOf(null)).toBe(DEFAULT_ZONE);
  });
});

describe("classifyCrossing", () => {
  it("calls same-zone traffic internal", () => {
    expect(classifyCrossing("private", "private").kind).toBe("internal");
    expect(isBoundaryCrossing("private", "private")).toBe(false);
  });

  it("treats the management control plane as cross-cutting, never a tier jump", () => {
    expect(classifyCrossing("data", "management").kind).toBe("management");
    expect(classifyCrossing("management", "private").kind).toBe("management");
    expect(classifyCrossing("internet", "management").kind).toBe("management");
  });

  it("names inward traffic a step", () => {
    expect(classifyCrossing("public", "private").kind).toBe("step");
    expect(classifyCrossing("private", "data").kind).toBe("step");
  });

  it("does not call skipping a subnet tier a bypass", () => {
    // API Gateway → Lambda never touches a subnet. It is the canonical
    // serverless shape, so it must not be reported as a boundary bypass.
    expect(classifyCrossing("edge", "private").kind).toBe("step");
    expect(classifyCrossing("edge", "private").jump).toBe(2);
  });

  it("reserves bypass for reaching storage with no application tier in front", () => {
    expect(classifyCrossing("edge", "data").kind).toBe("bypass");
    expect(classifyCrossing("public", "data").kind).toBe("bypass");
    expect(classifyCrossing("private", "data").kind).toBe("step");
  });

  it("names traffic from and to the internet ingress and egress", () => {
    expect(classifyCrossing("internet", "edge").kind).toBe("ingress");
    expect(classifyCrossing("internet", "data").kind).toBe("ingress");
    expect(classifyCrossing("data", "internet").kind).toBe("egress");
  });

  it("names inward-to-outward traffic outbound", () => {
    expect(classifyCrossing("private", "public").kind).toBe("outbound");
    expect(classifyCrossing("data", "private").kind).toBe("outbound");
  });
});

describe("analyzeTrust", () => {
  /** A conventional three-tier design: edge → compute → store, all encrypted. */
  const healthy = {
    nodes: [
      node("waf", "AWS WAF"),
      node("cdn", "Amazon CloudFront"),
      node("api", "Amazon API Gateway"),
      node("fn", "AWS Lambda"),
      node("db", "Amazon DynamoDB"),
      node("iam", "AWS Identity and Access Management"),
    ],
    connections: [
      link("waf", "cdn", { encrypted: true }),
      link("cdn", "api", { encrypted: true }),
      link("api", "fn", { encrypted: true }),
      link("fn", "db", { encrypted: true }),
      link("fn", "iam", { encrypted: true }),
    ],
  };

  it("survives empty and malformed input", () => {
    for (const input of [{}, { nodes: "bad", connections: null }, { nodes: [], connections: [] }]) {
      const result = analyzeTrust(input);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(result.threats)).toBe(true);
    }
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(healthy);
    analyzeTrust(healthy);
    expect(JSON.stringify(healthy)).toBe(before);
  });

  it("scores a guarded, encrypted, tiered design highly", () => {
    const result = analyzeTrust(healthy);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.guardedIngress).toBe(true);
    expect(result.identifiedIngress).toBe(true);
    expect(result.threats).toEqual([]);
  });

  it("counts services per zone", () => {
    expect(analyzeTrust(healthy).zones).toMatchObject({ edge: 3, private: 1, data: 1 });
  });

  it("finds the entry point and what untrusted traffic can reach", () => {
    const result = analyzeTrust(healthy);
    expect(result.entries).toContain("waf");
    expect(result.reachable).toContain("db");
  });

  it("flags a datastore that answers the internet directly", () => {
    const result = analyzeTrust({
      nodes: [node("net", "Internet", { zone: "internet" }), node("db", "Amazon RDS")],
      connections: [link("net", "db", { encrypted: true })],
    });
    const exposed = result.threats.find((t) => t.id.startsWith("exposed-data"));
    expect(exposed).toBeTruthy();
    expect(exposed.severity).toBe("critical");
    expect(exposed.target).toEqual({ kind: "node", id: "db" });
    expect(result.score).toBeLessThan(60);
  });

  it("flags internet traffic reaching internal compute unmediated", () => {
    const result = analyzeTrust({
      nodes: [node("net", "Internet", { zone: "internet" }), node("fn", "AWS Lambda")],
      connections: [link("net", "fn", { encrypted: true })],
    });
    expect(result.threats.some((t) => t.id.startsWith("unmediated-private"))).toBe(true);
  });

  it("flags plaintext on a boundary and points at the connection", () => {
    const result = analyzeTrust({
      nodes: [node("api", "Amazon API Gateway"), node("fn", "AWS Lambda")],
      connections: [link("api", "fn", { encrypted: false })],
    });
    const plaintext = result.threats.find((t) => t.id.startsWith("plaintext-"));
    expect(plaintext).toBeTruthy();
    expect(plaintext.target).toMatchObject({ kind: "connection", field: "encrypted" });
  });

  it("does not flag plaintext inside a single zone", () => {
    const result = analyzeTrust({
      nodes: [node("a", "AWS Lambda"), node("b", "AWS Lambda")],
      connections: [link("a", "b", { encrypted: false })],
    });
    expect(result.threats.some((t) => t.id.startsWith("plaintext-"))).toBe(false);
  });

  it("treats an unconnected WAF as protecting nothing", () => {
    const result = analyzeTrust({
      nodes: [
        node("api", "Amazon API Gateway"),
        node("fn", "AWS Lambda"),
        node("waf", "AWS WAF"), // present but wired to nothing
      ],
      connections: [link("api", "fn", { encrypted: true })],
    });
    expect(result.guardedIngress).toBe(false);
    const finding = result.threats.find((t) => t.id === "guard-off-path");
    expect(finding).toBeTruthy();
    expect(finding.target).toEqual({ kind: "node", id: "waf" });
  });

  it("asks for edge protection when none exists at all", () => {
    const result = analyzeTrust({
      nodes: [node("api", "Amazon API Gateway"), node("fn", "AWS Lambda")],
      connections: [link("api", "fn", { encrypted: true })],
    });
    expect(result.threats.some((t) => t.id === "guard-missing")).toBe(true);
    expect(result.threats.some((t) => t.id === "identity-missing")).toBe(true);
  });

  it("accepts edge-to-origin as a recognised pattern rather than a bypass", () => {
    const result = analyzeTrust({
      nodes: [
        node("waf", "AWS WAF"),
        node("cdn", "Amazon CloudFront"),
        node("bucket", "Amazon Simple Storage Service"),
        node("iam", "Amazon Cognito"),
      ],
      connections: [
        link("waf", "cdn", { encrypted: true }),
        link("cdn", "bucket", { encrypted: true }),
        link("cdn", "iam", { encrypted: true }),
      ],
    });
    expect(result.threats).toEqual([]);
    expect(result.recognised.join(" ")).toMatch(/edge-to-origin/);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("flags an outbound path from the data tier", () => {
    const result = analyzeTrust({
      nodes: [node("db", "Amazon RDS"), node("out", "Internet", { zone: "internet" })],
      connections: [link("db", "out", { encrypted: true })],
    });
    expect(result.threats.some((t) => t.id.startsWith("data-egress"))).toBe(true);
  });

  it("caps a multi-service design that declares no boundaries at all", () => {
    const result = analyzeTrust({
      nodes: [node("a", "AWS Lambda"), node("b", "AWS Lambda"), node("c", "AWS Lambda")],
      connections: [link("a", "b", { encrypted: true }), link("b", "c", { encrypted: true })],
    });
    expect(result.boundaryCount).toBe(0);
    expect(result.score).toBeLessThanOrEqual(70);
  });

  it("ignores connections referencing missing nodes", () => {
    const result = analyzeTrust({
      nodes: [node("a", "AWS Lambda")],
      connections: [link("a", "ghost"), link("ghost", "a")],
    });
    expect(result.crossings).toEqual([]);
  });

  it("keeps node ids and zone ids in separate fields", () => {
    const crossing = analyzeTrust(healthy).crossings.find((c) => c.fromId === "api");
    expect(crossing).toMatchObject({
      fromId: "api",
      toId: "fn",
      fromZone: "edge",
      toZone: "private",
      kind: "step",
      encrypted: true,
    });
    expect(crossing.toName).toBe("fn");
  });

  it("targets a real node id, not a zone id", () => {
    const result = analyzeTrust({
      nodes: [node("net", "Internet", { zone: "internet" }), node("store", "Amazon RDS")],
      connections: [link("net", "store", { encrypted: true })],
    });
    const exposed = result.threats.find((t) => t.id.startsWith("exposed-data"));
    expect(exposed.target.id).toBe("store");
    expect(ZONE_IDS).not.toContain(exposed.target.id);
  });
});
