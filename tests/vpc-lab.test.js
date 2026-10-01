// @vitest-environment jsdom
/* global document, window, DOMParser */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initVpcLab, VPC_PRESETS } from "../src/vpc-lab.js";
import { DEFAULT_PLAN, vpcBlueprint, vpcTerraform } from "../src/cidr.js";
import { NETWORK_TEMPLATES } from "../src/network-lab.js";

// ------------------------------------------------------------------ fixtures

const STORAGE_KEY = "trust-choreography:vpc-plan:v1";

/** The real page markup, so the tests fail if index.html and the controller drift apart. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const PAGE = new DOMParser().parseFromString(INDEX_HTML, "text/html");
const VPC_VIEW = PAGE.querySelector(".view-vpc");
const SOURCE = readFileSync(join(ROOT, "src", "vpc-lab.js"), "utf8");

const DEFAULT_SNAPSHOT = JSON.parse(JSON.stringify(DEFAULT_PLAN));
const PRESETS_SNAPSHOT = JSON.parse(JSON.stringify(VPC_PRESETS));

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: vi.fn((key, value) => data.set(key, String(value))),
  };
}

const stored = (plan) => fakeStorage({ [STORAGE_KEY]: JSON.stringify(plan) });

// ------------------------------------------------------------------ helpers

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const text = (selector) => $(selector).textContent;
const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

function mount() {
  document.body.replaceChildren(document.importNode(VPC_VIEW, true));
}

function setup(options = {}) {
  mount();
  const storage = "storage" in options ? options.storage : fakeStorage();
  const lab = initVpcLab({ ...options, storage });
  return { lab, storage };
}

/** Set a control's value and fire the event the browser would. */
function set(element, value, event = element.tagName === "SELECT" ? "change" : "input") {
  element.value = value;
  element.dispatchEvent(new window.Event(event, { bubbles: true }));
}

const saved = (storage) => JSON.parse(storage.data.get(STORAGE_KEY));
const tierRows = () => $$("#vpcTiers .vpc-tier");
const tierField = (index, selector) => tierRows()[index].querySelector(selector);
const tierName = (index) => tierRows()[index].querySelector("input");
const tierKind = (index) => tierRows()[index].querySelectorAll("select")[0];
const tierSize = (index) => tierRows()[index].querySelectorAll("select")[1];
const tierRemove = (index) => tierField(index, ".vpc-tier-remove");
const tableRows = () => $$("#vpcTable tbody tr");
const cells = (row) => [...row.children].map((cell) => cell.textContent);
const figures = () =>
  $$("#vpcSummary .vpc-figure").map((figure) => [
    figure.querySelector("strong").textContent,
    figure.querySelector("span").textContent,
  ]);
const messages = () =>
  $$("#vpcMessages .vpc-message").map((message) => [message.className, message.textContent]);
const outputButtons = () => ["#vpcOpen", "#vpcTerraform", "#vpcCopy"].map((id) => $(id));
const mapCells = () => $$("#vpcMap .vpc-map-cell");
const checkMessages = () =>
  [...$("#vpcCheckResults").children].map((node) => [node.className, node.textContent]);
const auditMessages = () =>
  [...$("#vpcAuditResults").children].map((node) => [node.className, node.textContent]);

/** Dotted quad → number, independent of the module under test. */
const ip = (dotted) => dotted.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);

function stubClipboard(writeText) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.navigator.clipboard;
  document.body.replaceChildren();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

// ------------------------------------------------------------------ tests

describe("markup contract", () => {
  it("finds every element the controller looks up in the real VPC view", () => {
    expect(VPC_VIEW).not.toBeNull();
    const ids = [...new Set([...SOURCE.matchAll(/"#([A-Za-z][\w-]*)/g)].map((m) => m[1]))];
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids.filter((id) => !VPC_VIEW.querySelector(`#${id}`))).toEqual([]);
    expect(VPC_VIEW.querySelector("#vpcTable tbody")).not.toBeNull();
  });

  it("offers exactly the presets and NAT modes the controller understands", () => {
    const presets = [...VPC_VIEW.querySelectorAll("[data-vpc-preset]")].map(
      (button) => button.dataset.vpcPreset
    );
    expect(presets.sort()).toEqual(Object.keys(VPC_PRESETS).sort());
    const options = (id) => [...VPC_VIEW.querySelectorAll(`#${id} option`)].map((o) => o.value);
    expect(options("vpcNat")).toEqual(["per-az", "single", "none"]);
    expect(options("vpcAzs")).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(options("vpcSpare")).toEqual(["0", "1", "2", "3"]);
  });

  it("returns null when the VPC markup is missing", () => {
    const storage = fakeStorage();
    expect(initVpcLab({ root: document.createElement("div"), storage })).toBeNull();
    expect(initVpcLab({ storage })).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});

describe("form sync", () => {
  it("fills the form from DEFAULT_PLAN when nothing is stored", () => {
    const { lab, storage } = setup();
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect($("#vpcCidr").value).toBe("10.0.0.0/16");
    expect($("#vpcRegion").value).toBe("us-east-1");
    expect($("#vpcAzs").value).toBe("3");
    expect($("#vpcSpare").value).toBe("1");
    expect($("#vpcNat").value).toBe("per-az");
    expect(tierRows().map((row) => row.dataset.kind)).toEqual(["public", "private", "data"]);
    expect(tierRows().map((_, index) => tierName(index).value)).toEqual(["Public", "App", "Data"]);
    expect(tierRows().map((_, index) => tierKind(index).value)).toEqual([
      "public",
      "private",
      "data",
    ]);
    expect(tierRows().map((_, index) => tierSize(index).value)).toEqual(["24", "20", "24"]);
    expect(lab.plan.subnets).toHaveLength(9);
    // The first render saves the (default) plan.
    expect(saved(storage)).toEqual(DEFAULT_PLAN);
  });

  it("labels each tier's controls and lists every AWS subnet size", () => {
    setup();
    expect(tierName(1).getAttribute("aria-label")).toBe("Tier 2 name");
    expect(tierName(1).maxLength).toBe(40);
    expect(tierKind(1).getAttribute("aria-label")).toBe("Tier 2 type");
    expect([...tierKind(0).options].map((option) => option.textContent)).toEqual([
      "Public",
      "Private",
      "Isolated",
    ]);
    const sizes = [...tierSize(0).options];
    expect(tierSize(0).getAttribute("aria-label")).toBe("Tier 1 subnet size");
    expect(sizes.map((option) => option.value)).toEqual(
      Array.from({ length: 13 }, (_, index) => String(16 + index))
    );
    // Five addresses are reserved in every AWS subnet.
    expect(sizes.find((option) => option.value === "24").textContent).toBe("/24 (251 IPs)");
    expect(sizes.find((option) => option.value === "28").textContent).toBe("/28 (11 IPs)");
    expect(sizes.find((option) => option.value === "16").textContent).toBe(
      `/16 (${(65531).toLocaleString()} IPs)`
    );
    expect(tierRemove(0).getAttribute("aria-label")).toBe("Remove Public");
    expect(tierRemove(0).disabled).toBe(false);
  });

  it("restores a stored plan", () => {
    const plan = {
      cidr: "172.16.0.0/20",
      region: "eu-west-2",
      azs: 2,
      spareAzs: 0,
      natGateways: "single",
      tiers: [
        { name: "Web", kind: "public", prefix: 24 },
        { name: "Db", kind: "data", prefix: 26 },
      ],
    };
    const { lab } = setup({ storage: stored(plan) });
    expect($("#vpcCidr").value).toBe("172.16.0.0/20");
    expect($("#vpcRegion").value).toBe("eu-west-2");
    expect($("#vpcAzs").value).toBe("2");
    expect($("#vpcSpare").value).toBe("0");
    expect($("#vpcNat").value).toBe("single");
    expect(tierRows().map((_, index) => tierName(index).value)).toEqual(["Web", "Db"]);
    expect(tierKind(1).value).toBe("data");
    expect(tierSize(1).value).toBe("26");
    expect(lab.plan.subnets.map((subnet) => subnet.az)).toEqual([
      "eu-west-2a",
      "eu-west-2b",
      "eu-west-2a",
      "eu-west-2b",
    ]);
  });

  it("fills gaps in a stored plan from the defaults", () => {
    const { lab } = setup({
      storage: stored({
        cidr: "10.9.0.0/16",
        tiers: [{ name: "Only", kind: "private", prefix: 22 }],
        spareAzs: null,
        natGateways: null,
      }),
    });
    expect($("#vpcCidr").value).toBe("10.9.0.0/16");
    expect($("#vpcRegion").value).toBe("us-east-1");
    expect($("#vpcAzs").value).toBe("3");
    expect($("#vpcSpare").value).toBe("0");
    expect($("#vpcNat").value).toBe("per-az");
    expect(lab.plan.subnets.map((subnet) => subnet.text)).toEqual([
      "10.9.0.0/22",
      "10.9.4.0/22",
      "10.9.8.0/22",
    ]);
  });

  it.each([
    ["corrupt JSON", fakeStorage({ [STORAGE_KEY]: "{not json" })],
    ["a plan without tiers", stored({ cidr: "10.5.0.0/16" })],
    ["a plan without a CIDR", stored({ tiers: [{ name: "A", kind: "public", prefix: 24 }] })],
  ])("ignores %s and starts from the defaults", (_label, storage) => {
    setup({ storage });
    expect($("#vpcCidr").value).toBe(DEFAULT_PLAN.cidr);
    expect(tierRows()).toHaveLength(DEFAULT_PLAN.tiers.length);
  });

  it("works when storage throws, is missing, or is the browser's", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const { lab } = setup({ storage: hostile });
    expect($("#vpcCidr").value).toBe(DEFAULT_PLAN.cidr);
    set($("#vpcCidr"), "10.3.0.0/16");
    expect(lab.plan.vpc.text).toBe("10.3.0.0/16");

    const { lab: bare } = setup({ storage: null });
    expect(bare.plan.vpc.text).toBe(DEFAULT_PLAN.cidr);

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_PLAN, cidr: "10.77.0.0/16" })
    );
    mount();
    const browser = initVpcLab();
    expect(browser.plan.vpc.text).toBe("10.77.0.0/16");
    set($("#vpcRegion"), "eu-north-1");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).region).toBe("eu-north-1");
  });

  it("never edits the shared default plan", () => {
    setup();
    set(tierName(0), "Edge");
    set($("#vpcCidr"), "10.8.0.0/16");
    expect(DEFAULT_PLAN).toEqual(DEFAULT_SNAPSHOT);
  });
});

describe("live updates", () => {
  it("re-plans as the CIDR is typed and saves the trimmed value", () => {
    const { lab, storage } = setup();
    set($("#vpcCidr"), "  10.1.0.0/16 ");
    expect(lab.plan.vpc.text).toBe("10.1.0.0/16");
    expect(saved(storage).cidr).toBe("10.1.0.0/16");
    expect(figures()[0][0]).toBe("10.1.0.0/16");
    expect(cells(tableRows()[0])[2]).toBe("10.1.64.0/24");
  });

  it("uses the region for AZ names and falls back to us-east-1 when blank", () => {
    const { storage } = setup();
    set($("#vpcRegion"), "eu-central-1");
    expect(
      tableRows()
        .map((row) => cells(row)[1])
        .slice(0, 3)
    ).toEqual(["eu-central-1a", "eu-central-1b", "eu-central-1c"]);
    expect(figures()[0][1]).toBe("eu-central-1 · 3 AZs");

    set($("#vpcRegion"), "   ");
    expect(saved(storage).region).toBe("us-east-1");
    expect(cells(tableRows()[0])[1]).toBe("us-east-1a");
  });

  it("changes the number of Availability Zones", () => {
    const { lab, storage } = setup();
    set($("#vpcAzs"), "2");
    expect(saved(storage).azs).toBe(2);
    expect(lab.plan.subnets).toHaveLength(6);
    expect(figures()[0][1]).toBe("us-east-1 · 2 AZs");
    // Spare capacity is reserved for the next AZ, us-east-1c.
    expect($$("#vpcTable tbody tr.is-reserved").map((row) => cells(row)[1])).toEqual([
      "us-east-1c",
      "us-east-1c",
      "us-east-1c",
    ]);

    set($("#vpcAzs"), "1");
    expect(figures()[0][1]).toBe("us-east-1 · 1 AZ");
    expect(messages()).toContainEqual([
      "vpc-message is-warn",
      "A single Availability Zone has no redundancy: an AZ outage takes the whole VPC down.",
    ]);
  });

  it("reserves (or stops reserving) room for spare AZs", () => {
    const { lab, storage } = setup();
    set($("#vpcSpare"), "0");
    expect(saved(storage).spareAzs).toBe(0);
    expect($$("#vpcTable tbody tr.is-reserved")).toHaveLength(0);
    expect(mapCells().filter((cell) => cell.classList.contains("is-reserved"))).toHaveLength(0);

    set($("#vpcSpare"), "2");
    expect(lab.plan.reserved).toHaveLength(6);
    expect($$("#vpcTable tbody tr.is-reserved")).toHaveLength(6);
  });

  it("follows the NAT gateway choice into the drawing and the Terraform", () => {
    const openBlueprint = vi.fn();
    const { lab, storage } = setup({ openBlueprint });
    const natNodes = () =>
      openBlueprint.mock.lastCall[0].nodes.filter((node) => node.key.startsWith("nat-"));
    const natGateways = () => lab.terraform().match(/resource "aws_nat_gateway"/g)?.length ?? 0;

    lab.openInStudio();
    expect(natNodes()).toHaveLength(3);
    expect(natGateways()).toBe(3);

    set($("#vpcNat"), "single");
    expect(saved(storage).natGateways).toBe("single");
    lab.openInStudio();
    expect(natNodes()).toHaveLength(1);
    expect(natGateways()).toBe(1);

    set($("#vpcNat"), "none");
    lab.openInStudio();
    expect(natNodes()).toHaveLength(0);
    expect(natGateways()).toBe(0);
  });
});

describe("tiers", () => {
  it("renames a tier as you type", () => {
    const { storage } = setup();
    set(tierName(0), "Edge");
    expect(saved(storage).tiers[0].name).toBe("Edge");
    expect(cells(tableRows()[0])[0]).toBe("Edge");
    // The rename does not rebuild the row, so the field keeps focus and caret.
    expect(tierRows()[0].querySelector("input")).toBe(tierName(0));
  });

  it("changes a tier's kind", () => {
    const { storage } = setup();
    set(tierKind(2), "public");
    expect(tierRows()[2].dataset.kind).toBe("public");
    expect(saved(storage).tiers[2].kind).toBe("public");
    expect(
      tableRows()
        .filter((row) => cells(row)[0] === "Data")
        .map((row) => row.dataset.kind)
    ).toEqual(["public", "public", "public"]);
  });

  it("changes a tier's subnet size", () => {
    const { storage } = setup();
    set(tierSize(0), "26");
    expect(saved(storage).tiers[0].prefix).toBe(26);
    const publicRows = tableRows().filter((row) => cells(row)[0] === "Public");
    expect(publicRows.map((row) => cells(row)[2].split("/")[1])).toEqual(["26", "26", "26"]);
    expect(publicRows.map((row) => cells(row)[4])).toEqual(["59", "59", "59"]);
  });

  it("removes a tier and keeps later rows wired to the right tier", () => {
    const { storage } = setup();
    tierRemove(0).click();
    expect(tierRows()).toHaveLength(2);
    expect(saved(storage).tiers.map((tier) => tier.name)).toEqual(["App", "Data"]);
    expect(tableRows().some((row) => cells(row)[0] === "Public")).toBe(false);
    expect(tierName(0).getAttribute("aria-label")).toBe("Tier 1 name");

    set(tierName(1), "Records");
    expect(saved(storage).tiers.map((tier) => tier.name)).toEqual(["App", "Records"]);
  });

  it("never removes the last tier", () => {
    setup();
    tierRemove(2).click();
    tierRemove(1).click();
    expect(tierRows()).toHaveLength(1);
    expect(tierRemove(0).disabled).toBe(true);
    tierRemove(0).click();
    expect(tierRows()).toHaveLength(1);
  });

  it("adds a private /24 tier with a fresh name and selects the name", () => {
    const { storage } = setup();
    $("#vpcAddTier").click();
    expect(tierRows()).toHaveLength(4);
    expect(saved(storage).tiers[3]).toEqual({ name: "Tier", kind: "private", prefix: 24 });
    expect(tierKind(3).value).toBe("private");
    expect(tierSize(3).value).toBe("24");
    const name = tierName(3);
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, "Tier".length]);
    expect(tableRows().filter((row) => cells(row)[0] === "Tier")).toHaveLength(3);

    $("#vpcAddTier").click();
    expect(tierName(4).value).toBe("Tier 5");
  });

  it("re-enables removal once a second tier is added", () => {
    setup({ storage: stored({ ...DEFAULT_PLAN, tiers: [DEFAULT_PLAN.tiers[0]] }) });
    expect(tierRemove(0).disabled).toBe(true);
    $("#vpcAddTier").click();
    expect(tierRemove(0).disabled).toBe(false);
  });

  it("warns about a missing public tier and small private subnets", () => {
    setup();
    set(tierKind(0), "private");
    set(tierSize(1), "26");
    expect(messages()).toEqual([
      [
        "vpc-message is-warn",
        "No public tier: the VPC has no route to the internet unless you add a Transit Gateway or endpoints.",
      ],
      [
        "vpc-message is-warn",
        "App subnets (/26, 59 usable) are small for workloads that scale out; Lambda, EKS and ECS each take an IP per task or ENI.",
      ],
    ]);
  });
});

describe("presets", () => {
  it("applies the Simple preset", () => {
    const { lab, storage } = setup();
    $('[data-vpc-preset="simple"]').click();
    expect($("#vpcCidr").value).toBe("10.0.0.0/20");
    expect($("#vpcRegion").value).toBe("us-east-1");
    expect($("#vpcAzs").value).toBe("2");
    expect($("#vpcSpare").value).toBe("0");
    expect($("#vpcNat").value).toBe("single");
    expect(tierRows().map((_, index) => tierName(index).value)).toEqual(["Public", "Private"]);
    expect(lab.plan.subnets).toHaveLength(4);
    expect(saved(storage)).toEqual(VPC_PRESETS.simple.plan);
  });

  it("applies the EKS preset", () => {
    const { lab } = setup();
    $('[data-vpc-preset="eks"]').click();
    expect($("#vpcCidr").value).toBe("10.20.0.0/16");
    expect($("#vpcRegion").value).toBe("eu-west-1");
    expect(tierSize(1).value).toBe("18");
    expect(lab.plan.errors).toEqual([]);
    expect([...new Set(lab.plan.subnets.map((subnet) => subnet.az))]).toEqual([
      "eu-west-1a",
      "eu-west-1b",
      "eu-west-1c",
    ]);
  });

  it("restores the three-tier default after edits", () => {
    const { storage } = setup();
    set($("#vpcCidr"), "10.4.0.0/16");
    $("#vpcAddTier").click();
    $('[data-vpc-preset="three-tier"]').click();
    expect(saved(storage)).toEqual(DEFAULT_PLAN);
    expect(tierRows()).toHaveLength(3);
  });

  it("copies presets instead of editing them", () => {
    setup();
    $('[data-vpc-preset="simple"]').click();
    set(tierName(0), "Changed");
    $("#vpcAddTier").click();
    $('[data-vpc-preset="simple"]').click();
    expect(tierName(0).value).toBe("Public");
    expect(tierRows()).toHaveLength(2);
    expect(VPC_PRESETS).toEqual(PRESETS_SNAPSHOT);
  });

  it("ignores an unknown preset", () => {
    const { lab, storage } = setup();
    storage.setItem.mockClear();
    expect(lab.applyPreset("nope")).toBeUndefined();
    expect($("#vpcCidr").value).toBe(DEFAULT_PLAN.cidr);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("error state", () => {
  it("shows the problem, clears the plan and disables the outputs", () => {
    const { lab } = setup();
    set($("#vpcCidr"), "nope");
    expect(lab.plan.vpc).toBeNull();
    expect(text("#vpcSummary strong")).toBe("No plan");
    expect(text("#vpcSummary span")).toBe("Fix the problems below to see the plan.");
    expect(outputButtons().map((button) => button.disabled)).toEqual([true, true, true]);
    expect(mapCells()).toHaveLength(0);
    expect(tableRows()).toHaveLength(0);
    expect(messages()).toEqual([
      ["vpc-message is-error", "“nope” is not a CIDR block — expected a.b.c.d/nn"],
    ]);
  });

  it("names the block when it parses but is out of range", () => {
    setup();
    set($("#vpcCidr"), "10.0.0.0/8");
    expect(text("#vpcSummary strong")).toBe("10.0.0.0/8");
    expect(messages()).toEqual([
      ["vpc-message is-error", "A VPC block must be between /16 and /28 (got /8)."],
    ]);
  });

  it("lists errors before warnings", () => {
    setup();
    set($("#vpcCidr"), "11.0.0.1/24");
    expect(messages().map(([className]) => className)).toEqual([
      "vpc-message is-error",
      "vpc-message is-warn",
      "vpc-message is-warn",
    ]);
    expect(messages()[0][1]).toBe("App subnets (/20) are larger than the VPC (/24).");
    expect(messages()[1][1]).toBe("11.0.0.1/24 has host bits set — using 11.0.0.0/24.");
  });

  it("recovers when the problem is fixed", () => {
    setup();
    set($("#vpcCidr"), "nope");
    set($("#vpcCidr"), "10.0.0.0/16");
    expect(outputButtons().map((button) => button.disabled)).toEqual([false, false, false]);
    expect(tableRows()).toHaveLength(12);
    expect(messages()).toEqual([]);
  });

  it("produces no Terraform or drawing for a broken plan", () => {
    const openBlueprint = vi.fn();
    const download = vi.fn();
    const { lab } = setup({ openBlueprint, download });
    set($("#vpcCidr"), "nope");
    expect(lab.terraform()).toBe("");
    expect(lab.openInStudio()).toBeNull();
    $("#vpcTerraform").click();
    $("#vpcOpen").click();
    expect(openBlueprint).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("keeps the legend hidden when a stored plan starts broken", () => {
    setup({ storage: stored({ ...DEFAULT_PLAN, cidr: "nope" }) });
    expect($("#vpcLegend").hidden).toBe(true);
  });

  it("hides the legend again when the map empties", () => {
    setup();
    expect($("#vpcLegend").hidden).toBe(false);
    set($("#vpcCidr"), "nope");
    expect(mapCells()).toHaveLength(0);
    expect($("#vpcLegend").hidden).toBe(true);
  });
});

describe("summary", () => {
  it("shows the block, subnet count, usable IPs and utilisation", () => {
    const { lab } = setup();
    const { stats } = lab.plan;
    expect(stats.usable).toBe(3 * 251 + 3 * 4091 + 3 * 251);
    expect(figures()).toEqual([
      ["10.0.0.0/16", "us-east-1 · 3 AZs"],
      ["9", "subnets"],
      [(13779).toLocaleString(), "usable IPs"],
      ["21%", `allocated · ${(47104).toLocaleString()} free`],
    ]);
    expect(outputButtons().map((button) => button.disabled)).toEqual([false, false, false]);
    expect(messages()).toEqual([]);
  });
});

describe("address map", () => {
  it("draws subnets, reserved and free space in address order", () => {
    const { lab } = setup();
    const { subnets, reserved, free } = lab.plan;
    expect(mapCells()).toHaveLength(subnets.length + reserved.length + free.length);
    const count = (role) => mapCells().filter((cell) => cell.classList.contains(role)).length;
    expect([
      count("is-public"),
      count("is-private"),
      count("is-data"),
      count("is-reserved"),
      count("is-free"),
    ]).toEqual([3, 3, 3, 3, 4]);

    const starts = mapCells().map((cell) => ip(cell.title.split("\n")[1].split("/")[0]));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts[0]).toBe(ip("10.0.0.0"));
    // The cells tile the whole VPC: their sizes add up to a /16.
    expect(mapCells().reduce((sum, cell) => sum + Number(cell.style.flexGrow), 0)).toBe(65536);
    expect($("#vpcLegend").hidden).toBe(false);
  });

  it("describes every cell and labels only the ones wide enough", () => {
    setup();
    const [first] = mapCells();
    expect(first.className).toBe("vpc-map-cell is-private");
    expect(first.style.flexGrow).toBe("4096");
    expect(first.title).toBe(
      `App · us-east-1a\n10.0.0.0/20 (${(4096).toLocaleString()} addresses)`
    );
    expect(first.textContent).toBe("App a");

    const byCidr = (cidr) => mapCells().find((cell) => cell.title.includes(`\n${cidr} `));
    const spare = byCidr("10.0.48.0/20");
    expect(spare.className).toBe("vpc-map-cell is-reserved");
    expect(spare.title).toBe(
      `Reserved for us-east-1d\n10.0.48.0/20 (${(4096).toLocaleString()} addresses)`
    );
    expect(spare.textContent).toBe("App d");

    // A /24 is under 4% of a /16: too narrow for a label.
    expect(byCidr("10.0.64.0/24").textContent).toBe("");
    expect(byCidr("10.0.64.0/24").title).toBe("Public · us-east-1a\n10.0.64.0/24 (256 addresses)");

    // Free space is labelled only when it is a fifth of the VPC or more.
    const bigFree = byCidr("10.0.128.0/17");
    expect(bigFree.title).toBe(`Free\n10.0.128.0/17 (${(32768).toLocaleString()} addresses)`);
    expect(bigFree.textContent).toBe("10.0.128.0/17");
    expect(byCidr("10.0.96.0/19").textContent).toBe("");
  });
});

describe("subnet table", () => {
  it("lists subnets by tier and AZ, then the reserved blocks", () => {
    const { lab } = setup();
    const rows = tableRows();
    expect(rows).toHaveLength(12);
    expect(cells(rows[0])).toEqual([
      "Public",
      "us-east-1a",
      "10.0.64.0/24",
      "10.0.64.4 – 10.0.64.254",
      "251",
    ]);
    expect(rows[0].dataset.kind).toBe("public");
    expect(rows[0].querySelector("td i.vpc-dot")).not.toBeNull();
    expect(rows.slice(0, 9).map((row) => `${cells(row)[0]} ${cells(row)[1].slice(-1)}`)).toEqual(
      lab.plan.subnets.map((subnet) => `${subnet.tier} ${subnet.az.slice(-1)}`)
    );
    expect(rows.slice(0, 9).map((row) => cells(row)[0])).toEqual([
      "Public",
      "Public",
      "Public",
      "App",
      "App",
      "App",
      "Data",
      "Data",
      "Data",
    ]);
    expect(rows.slice(9).map((row) => [row.className, ...cells(row)])).toEqual([
      [
        "is-reserved",
        "App (spare)",
        "us-east-1d",
        "10.0.48.0/20",
        "Reserved to add an AZ later",
        (4091).toLocaleString(),
      ],
      [
        "is-reserved",
        "Public (spare)",
        "us-east-1d",
        "10.0.67.0/24",
        "Reserved to add an AZ later",
        "251",
      ],
      [
        "is-reserved",
        "Data (spare)",
        "us-east-1d",
        "10.0.71.0/24",
        "Reserved to add an AZ later",
        "251",
      ],
    ]);
  });

  it("follows AWS's five reserved addresses in every subnet", () => {
    setup();
    for (const row of tableRows().filter((candidate) => !candidate.className)) {
      const [, , cidr, range, usable] = cells(row);
      const [network, prefix] = cidr.split("/");
      const size = 2 ** (32 - Number(prefix));
      const [first, last] = range.split(" – ").map(ip);
      // .0 network, .1 router, .2 DNS, .3 reserved; the broadcast address is the last.
      expect(first).toBe(ip(network) + 4);
      expect(last).toBe(ip(network) + size - 2);
      expect(usable).toBe((size - 5).toLocaleString());
    }
  });
});

describe("Terraform", () => {
  it("Copy Terraform puts the plan on the clipboard", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const download = vi.fn();
    const { lab } = setup({ download });
    const button = $("#vpcCopy");
    button.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(lab.terraform());
    expect(button.textContent).toBe("Copied");
    expect(download).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1400);
    expect(button.textContent).toBe("Copy Terraform");
  });

  it("Copy Terraform downloads the file when the clipboard refuses", async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn(() => Promise.reject(new Error("denied"))));
    const download = vi.fn();
    const { lab } = setup({ download });
    const button = $("#vpcCopy");
    button.click();
    await flush();
    expect(download).toHaveBeenCalledWith(lab.terraform(), "vpc.tf");
    expect(button.textContent).toBe("Downloaded");
    vi.advanceTimersByTime(1400);
    expect(button.textContent).toBe("Copy Terraform");
  });

  it("Copy Terraform downloads the file when there is no Clipboard API", async () => {
    const download = vi.fn();
    setup({ download });
    $("#vpcCopy").click();
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
    expect($("#vpcCopy").textContent).toBe("Downloaded");
  });

  it("Download .tf hands the Terraform to the download option", () => {
    const download = vi.fn();
    const { lab } = setup({ download });
    $("#vpcTerraform").click();
    expect(download).toHaveBeenCalledTimes(1);
    const [terraform, name] = download.mock.calls[0];
    expect(name).toBe("vpc.tf");
    expect(terraform).toBe(vpcTerraform(lab.plan, { name: "vpc-us-east-1" }));
    expect(terraform).toMatch(/^# 10\.0\.0\.0\/16 in us-east-1/);
    expect(terraform).toContain('resource "aws_vpc" "vpc_us_east_1" {');
    expect(terraform).toContain('tags = { Name = "vpc-us-east-1" }');
    expect(terraform.match(/resource "aws_subnet"/g)).toHaveLength(9);
  });

  it("names the Terraform after the region", () => {
    const { lab } = setup();
    set($("#vpcRegion"), "eu-west-2");
    expect(lab.terraform()).toContain('resource "aws_vpc" "vpc_eu_west_2" {');
  });

  it("Download .tf falls back to a browser download link", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:vpc-plan");
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    let clicked = null;
    vi.spyOn(window.HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clicked = this;
    });
    try {
      const { lab } = setup();
      $("#vpcTerraform").click();
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const [blob] = createObjectURL.mock.calls[0];
      expect(blob.type).toBe("text/plain");
      expect(blob.size).toBe(new window.Blob([lab.terraform()]).size);
      expect(clicked.download).toBe("vpc.tf");
      expect(clicked.href).toBe("blob:vpc-plan");
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:vpc-plan");
    } finally {
      delete window.URL.createObjectURL;
      delete window.URL.revokeObjectURL;
    }
  });
});

describe("Open in AWS Studio", () => {
  it("draws the plan as a blueprint", () => {
    const openBlueprint = vi.fn(() => "drawn");
    const { lab } = setup({ openBlueprint });
    $("#vpcOpen").click();
    expect(openBlueprint).toHaveBeenCalledTimes(1);
    const [blueprint, message] = openBlueprint.mock.calls[0];
    expect(message).toBe("Drew 10.0.0.0/16 with 9 subnets");
    expect(blueprint).toEqual(vpcBlueprint(lab.plan));
    expect(blueprint.name).toBe("VPC plan 10.0.0.0/16");
    expect(blueprint.region).toBe("us-east-1");
    expect(lab.openInStudio()).toBe("drawn");
  });

  it("uses the singular for a one-subnet plan", () => {
    const openBlueprint = vi.fn();
    setup({
      openBlueprint,
      storage: stored({
        ...DEFAULT_PLAN,
        azs: 1,
        spareAzs: 0,
        tiers: [{ name: "Solo", kind: "public", prefix: 24 }],
      }),
    });
    $("#vpcOpen").click();
    expect(openBlueprint.mock.calls[0][1]).toBe("Drew 10.0.0.0/16 with 1 subnet");
  });

  it("is harmless when AWS Studio is not wired", () => {
    const { lab } = setup();
    expect(lab.openInStudio()).toBeUndefined();
  });
});

describe("CIDR checker", () => {
  it("asks for input when the list is empty or only comments", () => {
    const { lab } = setup();
    $("#vpcCheckRun").click();
    expect(checkMessages()).toEqual([["vpc-muted", "Add CIDR blocks, one per line."]]);
    set($("#vpcCheckInput"), "# nothing yet\n\n");
    expect(lab.runCheck().entries).toEqual([]);
    expect(checkMessages()).toEqual([["vpc-muted", "Add CIDR blocks, one per line."]]);
  });

  it("confirms blocks that do not overlap and summarises them", () => {
    setup();
    set($("#vpcCheckInput"), "10.0.0.0/16 prod\n10.1.0.0/16 staging");
    $("#vpcCheckRun").click();
    expect(checkMessages()).toEqual([
      ["vpc-message is-good", "2 blocks, no overlaps. Safe to peer or route together."],
      ["vpc-muted", "Summarised: 10.0.0.0/15"],
    ]);
  });

  it("uses the singular for a single block", () => {
    setup();
    set($("#vpcCheckInput"), "10.0.0.0/16 prod");
    $("#vpcCheckRun").click();
    expect(checkMessages()[0]).toEqual([
      "vpc-message is-good",
      "1 block, no overlaps. Safe to peer or route together.",
    ]);
  });

  it("loads the example and reports the nested block", () => {
    const { lab } = setup();
    $("#vpcCheckSample").click();
    expect($("#vpcCheckInput").value).toMatch(/^# One block per line/);
    expect($("#vpcCheckInput").value.split("\n")).toHaveLength(6);
    expect(checkMessages()).toEqual([
      [
        "vpc-message is-error",
        "Line 4: 10.0.128.0/20 (legacy VPC (peered)) sits inside 10.0.0.0/16 (production VPC).",
      ],
      ["vpc-muted", "Summarised: 10.0.0.0/15, 172.31.0.0/16, 192.168.0.0/16"],
    ]);
    expect(lab.runCheck().ok).toBe(false);
  });

  it("separates warnings from errors", () => {
    setup();
    set($("#vpcCheckInput"), "10.0.0.1/16 a\n10.1.0.0/16 b");
    $("#vpcCheckRun").click();
    expect(checkMessages()).toEqual([
      ["vpc-message is-good", "2 blocks, no overlaps. Safe to peer or route together."],
      [
        "vpc-message is-warn",
        "Line 1: 10.0.0.1/16 has host bits set — the network is 10.0.0.0/16.",
      ],
      ["vpc-muted", "Summarised: 10.0.0.0/15"],
    ]);

    set($("#vpcCheckInput"), "bogus\n10.2.0.0/16");
    $("#vpcCheckRun").click();
    expect(checkMessages()).toEqual([
      ["vpc-message is-error", "Line 1: “bogus” is not a CIDR block — expected a.b.c.d/nn"],
      ["vpc-muted", "Summarised: 10.2.0.0/16"],
    ]);
  });

  it("shows only the errors when no line parses", () => {
    setup();
    set($("#vpcCheckInput"), "bogus");
    $("#vpcCheckRun").click();
    expect(checkMessages()).toEqual([
      ["vpc-message is-error", "Line 1: “bogus” is not a CIDR block — expected a.b.c.d/nn"],
    ]);
  });

  it("Add this VPC puts the planned block first and checks it against the list", () => {
    setup();
    $("#vpcCheckSample").click();
    $("#vpcCheckPlan").click();
    const lines = $("#vpcCheckInput").value.split("\n");
    expect(lines[0]).toBe("10.0.0.0/16 planned VPC");
    expect(lines).toHaveLength(7);
    expect(checkMessages()).toContainEqual([
      "vpc-message is-error",
      "Line 3: 10.0.0.0/16 (planned VPC) is listed twice (lines 1 and 3).",
    ]);
  });

  it("Add this VPC does not duplicate the planned block, and follows plan changes", () => {
    setup();
    set($("#vpcCheckInput"), "10.1.0.0/16 staging");
    $("#vpcCheckPlan").click();
    $("#vpcCheckPlan").click();
    expect($("#vpcCheckInput").value).toBe("10.0.0.0/16 planned VPC\n10.1.0.0/16 staging");

    set($("#vpcCidr"), "10.5.0.0/16");
    $("#vpcCheckPlan").click();
    expect($("#vpcCheckInput").value).toBe("10.5.0.0/16 planned VPC\n10.1.0.0/16 staging");
    expect(checkMessages()[0]).toEqual([
      "vpc-message is-good",
      "2 blocks, no overlaps. Safe to peer or route together.",
    ]);
  });

  it("Add this VPC works on an empty list", () => {
    setup();
    $("#vpcCheckPlan").click();
    expect($("#vpcCheckInput").value).toBe("10.0.0.0/16 planned VPC");
    expect(checkMessages()[0][0]).toBe("vpc-message is-good");
  });

  it("Add this VPC does nothing without a valid VPC block", () => {
    setup();
    set($("#vpcCheckInput"), "10.1.0.0/16 staging");
    set($("#vpcCidr"), "nope");
    $("#vpcCheckPlan").click();
    expect($("#vpcCheckInput").value).toBe("10.1.0.0/16 staging");
    expect($("#vpcCheckResults").childElementCount).toBe(0);
  });
});

describe("Network Lab audit", () => {
  const EMPTY = "The Network Lab is empty — build or load a topology there first.";

  it.each([
    ["is not wired", undefined],
    ["returns null", () => null],
    ["returns an empty topology", () => ({ nodes: [], links: [] })],
  ])("asks for a topology when the lab %s", (_label, getNetworkState) => {
    const { lab } = setup({ getNetworkState });
    $("#vpcAuditRun").click();
    expect(auditMessages()).toEqual([["vpc-muted", EMPTY]]);
    expect(lab.runAudit()).toBeNull();
  });

  it("audits a real topology with consistent addressing", () => {
    const topology = NETWORK_TEMPLATES["small-office"];
    const { lab } = setup({ getNetworkState: () => topology });
    $("#vpcAuditRun").click();
    const out = $("#vpcAuditResults");
    expect(out.firstElementChild.textContent).toBe(
      "9 addressed devices in 2 subnets · 1 without an address."
    );
    const networks = [...out.querySelectorAll(".vpc-audit-network")];
    expect(networks).toHaveLength(2);
    const lan = networks[0];
    expect(lan.querySelector("strong").textContent).toBe("192.168.10.0/24");
    expect(lan.querySelector("span").textContent).toBe("8 / 254 hosts");
    expect(lan.querySelector("small").textContent.split(", ")).toHaveLength(8);
    expect(out.querySelector(".vpc-message.is-good").textContent).toBe(
      "Addressing is consistent: no duplicates, overlaps or stranded hosts."
    );
    expect(lab.runAudit().devices).toBe(9);
  });

  it("lists the problems in a topology that has them", () => {
    const topology = {
      nodes: [
        { id: "sw", type: "l2-switch", name: "Switch" },
        { id: "a", type: "pc", name: "A", ip: "10.0.1.10", subnet: "24" },
        { id: "b", type: "pc", name: "B", ip: "10.0.2.10", subnet: "24" },
      ],
      links: [
        { source: "a", target: "sw" },
        { source: "b", target: "sw" },
      ],
    };
    const { lab } = setup({ getNetworkState: () => topology });
    const audit = lab.runAudit();
    expect(audit.issues.length).toBeGreaterThan(0);
    const warnings = $$("#vpcAuditResults .vpc-message.is-warn");
    expect(warnings.map((node) => node.textContent)).toEqual(
      audit.issues.map((issue) => issue.message)
    );
    expect($("#vpcAuditResults .vpc-message.is-good")).toBeNull();
  });

  it("marks duplicate addresses as errors and pluralises the headline", () => {
    const { lab } = setup({
      getNetworkState: () => ({
        nodes: [
          { id: "a", name: "Alpha", type: "pc", ip: "10.0.0.5", subnet: "255.255.255.0" },
          { id: "b", name: "Beta", type: "pc", ip: "10.0.0.5", subnet: "/24" },
        ],
        links: [],
      }),
    });
    lab.runAudit();
    expect(auditMessages()[0]).toEqual(["vpc-muted", "2 addressed devices in 1 subnet."]);
    expect(auditMessages()).toContainEqual([
      "vpc-message is-error",
      "10.0.0.5 is used by Alpha and Beta.",
    ]);
  });

  it("uses the singular for one device and replaces the previous result", () => {
    const { lab } = setup({
      getNetworkState: () => ({
        nodes: [{ id: "a", name: "Alpha", type: "pc", ip: "10.0.0.5", subnet: "24" }],
        links: [],
      }),
    });
    lab.runAudit();
    lab.runAudit();
    expect(auditMessages()).toEqual([
      ["vpc-muted", "1 addressed device in 1 subnet."],
      expect.arrayContaining([]),
      [
        "vpc-message is-good",
        "Addressing is consistent: no duplicates, overlaps or stranded hosts.",
      ],
    ]);
    expect($$("#vpcAuditResults .vpc-audit-networks")).toHaveLength(1);
  });

  it("leaves out the subnet list when nothing is addressed", () => {
    const { lab } = setup({
      getNetworkState: () => ({
        nodes: [
          { id: "a", name: "Alpha", type: "pc" },
          { id: "b", name: "Beta", type: "pc", ip: "" },
        ],
        links: [],
      }),
    });
    const audit = lab.runAudit();
    expect(audit.devices).toBe(0);
    expect(auditMessages()[0]).toEqual([
      "vpc-muted",
      "0 addressed devices in 0 subnets · 2 without an address.",
    ]);
    expect($("#vpcAuditResults .vpc-audit-networks")).toBeNull();
  });
});
