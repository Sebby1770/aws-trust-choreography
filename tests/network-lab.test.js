import { describe, expect, it } from "vitest";
import {
  NETWORK_DEVICES,
  NETWORK_TEMPLATES,
  findNetworkPath,
  normalizeNetworkState,
  scoreNetwork,
} from "../src/network-lab.js";

describe("Network Lab device catalogue", () => {
  it("covers every supported device family", () => {
    expect(new Set(NETWORK_DEVICES.map((device) => device.category))).toEqual(
      new Set(["endpoints", "network", "servers", "cloud-security"])
    );

    const ids = new Set(NETWORK_DEVICES.map((device) => device.id));
    [
      "pc",
      "laptop",
      "printer",
      "ip-phone",
      "router",
      "l2-switch",
      "l3-switch",
      "wireless-ap",
      "firewall",
      "load-balancer",
      "web-server",
      "dns-server",
      "dhcp-server",
      "database-server",
      "mail-server",
      "linux-server",
      "windows-server",
      "internet",
      "cloud",
      "vpn-gateway",
    ].forEach((id) => expect(ids.has(id), `${id} should be available`).toBe(true));
  });

  it("uses text glyphs and unique ids for every device", () => {
    const ids = NETWORK_DEVICES.map((device) => device.id);
    expect(new Set(ids).size).toBe(ids.length);
    NETWORK_DEVICES.forEach((device) => {
      expect(device.glyph).toEqual(expect.any(String));
      expect(device.glyph.length).toBeGreaterThan(0);
      expect(device.glyph).not.toContain("<svg");
    });
  });
});

describe("Network Lab starter templates", () => {
  it("provides all five requested starters", () => {
    expect(Object.keys(NETWORK_TEMPLATES).sort()).toEqual(
      ["blank", "campus", "hybrid", "small-office", "three-tier"].sort()
    );
  });

  it("keeps every starter internally valid and immutable", () => {
    Object.entries(NETWORK_TEMPLATES).forEach(([id, starter]) => {
      expect(Object.isFrozen(starter)).toBe(true);
      expect(starter.template).toBe(id);
      const normalized = normalizeNetworkState(starter);
      expect(normalized.nodes).toHaveLength(starter.nodes.length);
      expect(normalized.links).toHaveLength(starter.links.length);
      expect(new Set(normalized.nodes.map((node) => node.id)).size).toBe(normalized.nodes.length);
    });
  });

  it("models the defining concepts in each guided starter", () => {
    const types = (template) => NETWORK_TEMPLATES[template].nodes.map((node) => node.type);
    expect(types("small-office")).toEqual(
      expect.arrayContaining(["internet", "firewall", "l2-switch", "wireless-ap", "dhcp-server"])
    );
    expect(types("three-tier")).toEqual(
      expect.arrayContaining(["load-balancer", "web-server", "linux-server", "database-server"])
    );
    expect(types("campus")).toEqual(
      expect.arrayContaining(["l3-switch", "l2-switch", "wireless-ap", "ip-phone"])
    );
    expect(types("hybrid")).toEqual(expect.arrayContaining(["cloud", "vpn-gateway", "firewall"]));
    expect(NETWORK_TEMPLATES.blank.nodes).toHaveLength(0);
  });
});

describe("normalizeNetworkState", () => {
  it("normalizes partial imports without mutating them", () => {
    const imported = {
      architectureName: "  Branch network  ",
      nodes: [
        { id: "pc-a", deviceId: "pc", name: "  Accounts PC ", x: -20, y: "130", ip: 123 },
        { id: "edge", type: "router", status: "unexpected", notes: " uplink " },
      ],
      connections: [{ from: "pc-a", to: "edge" }],
    };
    const before = structuredClone(imported);
    const result = normalizeNetworkState(imported);

    expect(imported).toEqual(before);
    expect(result.name).toBe("Branch network");
    expect(result.nodes[0]).toMatchObject({
      id: "pc-a",
      type: "pc",
      name: "Accounts PC",
      x: 0,
      y: 130,
      ip: "123",
      status: "online",
    });
    expect(result.links[0]).toMatchObject({
      source: "pc-a",
      target: "edge",
      label: "Ethernet",
    });
  });

  it("drops unknown devices, broken links, self-links, and duplicate links", () => {
    const result = normalizeNetworkState({
      nodes: [
        { id: "a", type: "pc" },
        { id: "b", type: "router" },
        { id: "mystery", type: "time-machine" },
      ],
      links: [
        { id: "one", source: "a", target: "b" },
        { id: "two", source: "b", target: "a" },
        { id: "three", source: "a", target: "a" },
        { id: "four", source: "a", target: "missing" },
      ],
      selectedNodeId: "missing",
      selectedLinkId: "missing",
    });

    expect(result.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(result.links).toHaveLength(1);
    expect(result.selectedNodeId).toBeNull();
    expect(result.selectedLinkId).toBeNull();
  });

  it("repairs duplicate identifiers deterministically", () => {
    const result = normalizeNetworkState({
      nodes: [{ id: "same", type: "pc" }, { id: "same", type: "laptop" }, { type: "printer" }],
    });
    expect(result.nodes.map((node) => node.id)).toEqual(["same", "same-2", "node-3"]);
  });

  it("returns a useful blank state for malformed input", () => {
    expect(normalizeNetworkState(null)).toMatchObject({
      version: 1,
      template: "blank",
      name: "Untitled network",
      nodes: [],
      links: [],
    });
  });
});

describe("findNetworkPath", () => {
  const nodes = ["a", "b", "c", "d", "e"].map((id) => ({ id, status: "online" }));
  const links = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "a", target: "d" },
    { source: "d", target: "e" },
    { source: "e", target: "c" },
  ];

  it("uses breadth-first search to return the shortest route", () => {
    expect(findNetworkPath({ nodes, links }, "a", "c")).toEqual(["a", "b", "c"]);
  });

  it("treats ordinary network links as bidirectional", () => {
    expect(findNetworkPath({ nodes, links }, "c", "a")).toEqual(["c", "b", "a"]);
  });

  it("also supports separate nodes and links arguments", () => {
    expect(findNetworkPath(nodes, links, "a", "e")).toEqual(["a", "d", "e"]);
  });

  it("returns an empty path when an offline hop blocks the only route", () => {
    const offlineNodes = nodes.map((item) =>
      item.id === "b" || item.id === "d" ? { ...item, status: "offline" } : item
    );
    expect(findNetworkPath({ nodes: offlineNodes, links }, "a", "c")).toEqual([]);
  });

  it("handles a same-device packet and unknown endpoints", () => {
    expect(findNetworkPath({ nodes, links }, "a", "a")).toEqual(["a"]);
    expect(findNetworkPath({ nodes, links }, "a", "unknown")).toEqual([]);
  });
});

describe("scoreNetwork", () => {
  it("returns four explainable architecture checks", () => {
    const result = scoreNetwork(NETWORK_TEMPLATES["small-office"]);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.checks.map((check) => check.id)).toEqual([
      "addressing",
      "redundancy",
      "security",
      "services",
    ]);
    result.checks.forEach((check) => {
      expect(check.score).toBeGreaterThanOrEqual(0);
      expect(check.score).toBeLessThanOrEqual(100);
      expect(check.message.length).toBeGreaterThan(10);
      expect(check.recommendation.length).toBeGreaterThan(10);
    });
  });

  it("recognises addressing, security boundaries, services, and redundant designs", () => {
    const smallOffice = scoreNetwork(NETWORK_TEMPLATES["small-office"]);
    const campus = scoreNetwork(NETWORK_TEMPLATES.campus);
    const check = (result, id) => result.checks.find((item) => item.id === id);

    expect(check(smallOffice, "addressing").score).toBeGreaterThanOrEqual(90);
    expect(check(smallOffice, "security").score).toBeGreaterThan(0);
    expect(check(smallOffice, "services").score).toBeGreaterThanOrEqual(75);
    expect(check(campus, "redundancy").score).toBeGreaterThanOrEqual(45);
  });

  it("gives a beginner-friendly starting result for a blank design", () => {
    const result = scoreNetwork(NETWORK_TEMPLATES.blank);
    expect(result.score).toBe(0);
    expect(result.label).toBe("Getting started");
    expect(result.summary).toContain("Add devices");
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});
