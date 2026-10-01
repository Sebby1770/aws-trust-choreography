import { describe, expect, it } from "vitest";
import {
  AWS_RESERVED,
  DEFAULT_PLAN,
  TIER_KINDS,
  VPC_MAX_PREFIX,
  VPC_MIN_PREFIX,
  auditAddressing,
  awsUsable,
  blockSize,
  checkCidrs,
  cidrText,
  contains,
  formatIp,
  isPrivate,
  overlaps,
  parseCidr,
  parseIp,
  planVpc,
  prefixForHosts,
  prefixFromMask,
  rangeToCidrs,
  summarize,
  vpcBlueprint,
  vpcTerraform,
} from "../src/cidr.js";
import { NETWORK_TEMPLATES } from "../src/network-lab.js";

// ------------------------------------------------------------------ helpers

/** Small deterministic PRNG so the property-style checks are reproducible. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ip = (text) => parseIp(text);
const texts = (blocks) => blocks.map((block) => block.text);
const cidr = (text) => parseCidr(text);

/** `resource "type" "name" { … }` blocks of generated Terraform. */
function tfResources(tf) {
  const resources = [];
  const pattern = /^resource "([^"]+)" "([^"]+)" \{\n([\s\S]*?)^\}$/gm;
  let match;
  while ((match = pattern.exec(tf))) {
    resources.push({
      type: match[1],
      name: match[2],
      address: `${match[1]}.${match[2]}`,
      body: match[3],
    });
  }
  return resources;
}

const duplicates = (values) => values.filter((value, index) => values.indexOf(value) !== index);

function braceBalance(text) {
  let depth = 0;
  let neverNegative = true;
  for (const char of text) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) neverNegative = false;
  }
  return { depth, neverNegative };
}

/** Network Lab device shorthand: the name doubles as the id for readable messages. */
const dev = (id, type, ipText = "", subnet = "") => ({ id, type, name: id, ip: ipText, subnet });
const wire = (source, target) => ({ source, target });

function tieredPlan(overrides = {}) {
  return {
    cidr: "10.0.0.0/16",
    region: "us-east-1",
    azs: 3,
    spareAzs: 0,
    natGateways: "per-az",
    tiers: [
      { name: "Public", kind: "public", prefix: 24 },
      { name: "App", kind: "private", prefix: 20 },
      { name: "Data", kind: "data", prefix: 24 },
    ],
    ...overrides,
  };
}

// --------------------------------------------------------------- constants

describe("module constants", () => {
  it("encodes AWS's reserved addresses and VPC prefix limits", () => {
    expect(AWS_RESERVED).toBe(5);
    expect(VPC_MIN_PREFIX).toBe(16);
    expect(VPC_MAX_PREFIX).toBe(28);
  });

  it("maps tier kinds to diagram presets and zones", () => {
    expect(TIER_KINDS.public).toEqual({ label: "Public", preset: "public-subnet", zone: "public" });
    expect(TIER_KINDS.private.preset).toBe("private-subnet");
    expect(TIER_KINDS.data).toEqual({ label: "Isolated", preset: "private-subnet", zone: "data" });
  });

  it("ships a sensible three-tier default plan", () => {
    expect(DEFAULT_PLAN.cidr).toBe("10.0.0.0/16");
    expect(DEFAULT_PLAN.azs).toBe(3);
    expect(DEFAULT_PLAN.spareAzs).toBe(1);
    expect(DEFAULT_PLAN.tiers.map((tier) => tier.kind)).toEqual(["public", "private", "data"]);
  });
});

// -------------------------------------------------------------- parseIp

describe("parseIp / formatIp", () => {
  it("parses dotted quads into unsigned 32-bit numbers", () => {
    expect(parseIp("0.0.0.0")).toBe(0);
    expect(parseIp("0.0.0.1")).toBe(1);
    expect(parseIp("0.0.1.0")).toBe(256);
    expect(parseIp("10.0.0.1")).toBe(167772161);
    expect(parseIp("192.168.1.1")).toBe(3232235777);
    expect(parseIp("255.255.255.255")).toBe(4294967295);
  });

  it("never returns a negative number for high addresses", () => {
    expect(parseIp("128.0.0.0")).toBe(2 ** 31);
    expect(parseIp("255.255.255.255")).toBeGreaterThan(0);
  });

  it("trims surrounding whitespace", () => {
    expect(parseIp(" 10.0.0.1")).toBe(167772161);
    expect(parseIp("10.0.0.1 ")).toBe(167772161);
    expect(parseIp("\t10.0.0.1\n")).toBe(167772161);
  });

  it("accepts zero-padded octets up to three digits", () => {
    expect(parseIp("010.000.000.005")).toBe(parseIp("10.0.0.5"));
  });

  it.each([
    ["octet above 255", "256.0.0.1"],
    ["last octet above 255", "10.0.0.256"],
    ["too few parts", "10.0.1"],
    ["too many parts", "10.0.0.0.1"],
    ["empty octet", "10..0.1"],
    ["trailing dot", "10.0.0."],
    ["four-digit octet", "0010.0.0.1"],
    ["negative octet", "-1.0.0.0"],
    ["signed octet", "+1.0.0.0"],
    ["letters", "a.b.c.d"],
    ["hex octet", "0x0a.0.0.1"],
    ["inner whitespace", "10. 0.0.1"],
    ["CIDR suffix", "10.0.0.0/8"],
    ["empty string", ""],
    ["only spaces", "   "],
  ])("rejects %s", (_label, text) => {
    expect(parseIp(text)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(parseIp(null)).toBeNull();
    expect(parseIp(undefined)).toBeNull();
  });

  it("formats numbers back into dotted quads", () => {
    expect(formatIp(0)).toBe("0.0.0.0");
    expect(formatIp(4294967295)).toBe("255.255.255.255");
    expect(formatIp(167772161)).toBe("10.0.0.1");
    expect(formatIp(2 ** 31)).toBe("128.0.0.0");
  });

  it("truncates fractions and wraps modulo 2^32 like an unsigned 32-bit value", () => {
    expect(formatIp(3.7)).toBe("0.0.0.3");
    expect(formatIp(2 ** 32)).toBe("0.0.0.0");
    expect(formatIp(-1)).toBe("255.255.255.255");
  });

  it("round trips edge addresses", () => {
    for (const text of ["0.0.0.0", "255.255.255.255", "127.0.0.1", "172.16.254.3", "1.2.3.4"]) {
      expect(formatIp(parseIp(text))).toBe(text);
    }
  });

  it("round trips random 32-bit values", () => {
    const random = mulberry32(42);
    for (let i = 0; i < 500; i += 1) {
      const value = Math.floor(random() * 2 ** 32);
      expect(parseIp(formatIp(value))).toBe(value);
    }
  });
});

// ------------------------------------------------------------ blockSize

describe("blockSize / cidrText", () => {
  it("returns the address count of a prefix", () => {
    expect(blockSize(32)).toBe(1);
    expect(blockSize(31)).toBe(2);
    expect(blockSize(24)).toBe(256);
    expect(blockSize(16)).toBe(65536);
    expect(blockSize(0)).toBe(2 ** 32);
  });

  it("formats a network and prefix as CIDR text", () => {
    expect(cidrText(ip("10.1.2.0"), 24)).toBe("10.1.2.0/24");
    expect(cidrText(0, 0)).toBe("0.0.0.0/0");
  });
});

// ------------------------------------------------------- prefixFromMask

describe("prefixFromMask", () => {
  it.each([
    [24, 24],
    [0, 0],
    [32, 32],
    ["24", 24],
    ["8", 8],
    ["/24", 24],
    ["/0", 0],
    [" /16 ", 16],
    ["255.255.255.0", 24],
    ["255.255.254.0", 23],
    ["255.255.255.252", 30],
    ["255.255.255.254", 31],
    ["255.255.255.255", 32],
    ["255.0.0.0", 8],
    ["128.0.0.0", 1],
    ["0.0.0.0", 0],
  ])("reads %j as /%i", (value, expected) => {
    expect(prefixFromMask(value)).toBe(expected);
  });

  it.each([
    ["prefix above 32", "33"],
    ["numeric prefix above 32", 64],
    ["three-digit prefix", "100"],
    ["non-contiguous mask", "255.0.255.0"],
    ["mask with a stray low bit", "255.255.255.1"],
    ["inverted mask", "0.255.255.255"],
    ["wildcard mask", "0.0.0.255"],
    ["gap in the ones", "255.255.253.0"],
    ["octet above 255", "256.0.0.0"],
    ["three-part mask", "255.255.0"],
    ["bare slash", "/"],
    ["empty string", ""],
    ["letters", "abc"],
    ["negative", "-1"],
    ["fraction", "24.5"],
  ])("rejects a %s", (_label, value) => {
    expect(prefixFromMask(value)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(prefixFromMask(null)).toBeNull();
    expect(prefixFromMask(undefined)).toBeNull();
  });

  it("agrees with the dotted form of every prefix length", () => {
    for (let prefix = 0; prefix <= 32; prefix += 1) {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      expect(prefixFromMask(formatIp(mask))).toBe(prefix);
      expect(prefixFromMask(`/${prefix}`)).toBe(prefix);
    }
  });
});

// ------------------------------------------------------------ parseCidr

describe("parseCidr", () => {
  it("parses an aligned block", () => {
    expect(parseCidr("10.0.1.0/24")).toEqual({
      input: "10.0.1.0/24",
      network: ip("10.0.1.0"),
      prefix: 24,
      size: 256,
      last: ip("10.0.1.255"),
      aligned: true,
      text: "10.0.1.0/24",
    });
  });

  it("parses a block with host bits set to its network but flags it unaligned", () => {
    const block = parseCidr("10.0.1.77/24");
    expect(block.error).toBeUndefined();
    expect(block.input).toBe("10.0.1.77/24");
    expect(block.network).toBe(ip("10.0.1.0"));
    expect(block.last).toBe(ip("10.0.1.255"));
    expect(block.aligned).toBe(false);
    expect(block.text).toBe("10.0.1.0/24");
  });

  it("handles /0 as the whole address space", () => {
    const block = parseCidr("0.0.0.0/0");
    expect(block.network).toBe(0);
    expect(block.size).toBe(2 ** 32);
    expect(block.last).toBe(2 ** 32 - 1);
    expect(block.aligned).toBe(true);

    const unaligned = parseCidr("8.8.8.8/0");
    expect(unaligned.network).toBe(0);
    expect(unaligned.aligned).toBe(false);
    expect(unaligned.text).toBe("0.0.0.0/0");
  });

  it("handles /32 as a single address", () => {
    const block = parseCidr("255.255.255.255/32");
    expect(block.size).toBe(1);
    expect(block.network).toBe(2 ** 32 - 1);
    expect(block.last).toBe(2 ** 32 - 1);
    expect(block.aligned).toBe(true);
  });

  it("handles a high /1 without sign problems", () => {
    const block = parseCidr("200.0.0.0/1");
    expect(block.network).toBe(2 ** 31);
    expect(block.last).toBe(2 ** 32 - 1);
    expect(block.text).toBe("128.0.0.0/1");
  });

  it("trims the input and tolerates spaces around the slash", () => {
    const block = parseCidr("  10.0.0.0 / 8  ");
    expect(block.input).toBe("10.0.0.0 / 8");
    expect(block.text).toBe("10.0.0.0/8");
  });

  it.each([
    ["missing prefix", "10.0.0.0"],
    ["three-part address", "10.0.0/24"],
    ["three-digit prefix", "10.0.0.0/024"],
    ["negative prefix", "10.0.0.0/-1"],
    ["letters", "a.b.c.d/8"],
    ["trailing junk", "10.0.0.0/8x"],
    ["empty string", ""],
  ])("rejects a %s as not a CIDR block", (_label, text) => {
    const result = parseCidr(text);
    expect(result.error).toBe(`“${text.trim()}” is not a CIDR block — expected a.b.c.d/nn`);
    expect(result.network).toBeUndefined();
  });

  it("rejects null and undefined with an empty input", () => {
    expect(parseCidr(null)).toEqual({
      input: "",
      error: "“” is not a CIDR block — expected a.b.c.d/nn",
    });
    expect(parseCidr(undefined).input).toBe("");
  });

  it("rejects an out-of-range octet", () => {
    expect(parseCidr("10.0.0.256/24")).toEqual({
      input: "10.0.0.256/24",
      error: "“10.0.0.256” is not an IPv4 address",
    });
  });

  it("rejects a prefix longer than 32", () => {
    expect(parseCidr("10.0.0.0/33").error).toBe("/33 is not a prefix length (0–32)");
    expect(parseCidr("10.0.0.0/99").error).toBe("/99 is not a prefix length (0–32)");
  });

  it("always yields an aligned network whose size matches its prefix", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 300; i += 1) {
      const address = Math.floor(random() * 2 ** 32);
      const prefix = Math.floor(random() * 33);
      const block = parseCidr(`${formatIp(address)}/${prefix}`);
      expect(block.network % block.size).toBe(0);
      expect(block.network).toBeLessThanOrEqual(address);
      expect(block.last).toBeGreaterThanOrEqual(address);
      expect(block.last - block.network + 1).toBe(block.size);
      expect(block.aligned).toBe(block.network === address);
    }
  });
});

// ----------------------------------------------------- contains/overlaps

describe("contains / overlaps", () => {
  const big = cidr("10.0.0.0/8");
  const mid = cidr("10.1.0.0/16");
  const small = cidr("10.1.2.0/24");
  const other = cidr("192.168.0.0/16");

  it("detects containment in one direction only", () => {
    expect(contains(big, mid)).toBe(true);
    expect(contains(mid, small)).toBe(true);
    expect(contains(big, small)).toBe(true);
    expect(contains(mid, big)).toBe(false);
    expect(contains(big, other)).toBe(false);
  });

  it("treats a block as containing itself", () => {
    expect(contains(mid, cidr("10.1.0.0/16"))).toBe(true);
  });

  it("contains single addresses at both edges", () => {
    expect(contains(small, { network: ip("10.1.2.0"), last: ip("10.1.2.0") })).toBe(true);
    expect(contains(small, { network: ip("10.1.2.255"), last: ip("10.1.2.255") })).toBe(true);
    expect(contains(small, { network: ip("10.1.3.0"), last: ip("10.1.3.0") })).toBe(false);
  });

  it("detects overlaps symmetrically", () => {
    expect(overlaps(big, small)).toBe(true);
    expect(overlaps(small, big)).toBe(true);
    expect(overlaps(big, other)).toBe(false);
    expect(overlaps(other, big)).toBe(false);
    expect(overlaps(mid, mid)).toBe(true);
  });

  it("does not treat adjacent blocks as overlapping", () => {
    expect(overlaps(cidr("10.0.0.0/24"), cidr("10.0.1.0/24"))).toBe(false);
    expect(overlaps(cidr("10.0.1.0/24"), cidr("10.0.0.0/24"))).toBe(false);
  });

  it("works on plain ranges that share a single address", () => {
    expect(overlaps({ network: 5, last: 10 }, { network: 10, last: 20 })).toBe(true);
    expect(overlaps({ network: 5, last: 9 }, { network: 10, last: 20 })).toBe(false);
  });

  it("CIDR blocks are always nested or disjoint, never partially overlapping", () => {
    const random = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const a = cidr(
        `${formatIp(Math.floor(random() * 4096) * 256)}/${16 + Math.floor(random() * 9)}`
      );
      const b = cidr(
        `${formatIp(Math.floor(random() * 4096) * 256)}/${16 + Math.floor(random() * 9)}`
      );
      if (overlaps(a, b)) expect(contains(a, b) || contains(b, a)).toBe(true);
    }
  });
});

// ------------------------------------------------------------ isPrivate

describe("isPrivate", () => {
  it.each([
    "10.0.0.0/8",
    "10.255.0.0/16",
    "172.16.0.0/12",
    "172.31.255.0/24",
    "192.168.0.0/16",
    "192.168.1.0/24",
    "10.0.0.1/32",
  ])("treats %s as RFC 1918", (text) => {
    expect(isPrivate(cidr(text))).toBe(true);
  });

  it.each([
    "172.15.0.0/16",
    "172.32.0.0/16",
    "192.169.0.0/16",
    "100.64.0.0/10",
    "8.8.8.0/24",
    "11.0.0.0/8",
    "0.0.0.0/0",
    "10.0.0.0/7",
    "172.16.0.0/11",
  ])("treats %s as not private", (text) => {
    expect(isPrivate(cidr(text))).toBe(false);
  });
});

// ------------------------------------------------ awsUsable / prefixForHosts

describe("awsUsable", () => {
  it("subtracts AWS's five reserved addresses", () => {
    expect(awsUsable(28)).toBe(11);
    expect(awsUsable(27)).toBe(27);
    expect(awsUsable(24)).toBe(251);
    expect(awsUsable(20)).toBe(4091);
    expect(awsUsable(16)).toBe(65531);
    expect(awsUsable(29)).toBe(3);
  });

  it("never goes negative for tiny blocks", () => {
    expect(awsUsable(30)).toBe(0);
    expect(awsUsable(31)).toBe(0);
    expect(awsUsable(32)).toBe(0);
  });
});

describe("prefixForHosts", () => {
  it.each([
    [0, 28],
    [-5, 28],
    [1, 28],
    [11, 28],
    [12, 27],
    [27, 27],
    [28, 26],
    [59, 26],
    [60, 25],
    [251, 24],
    [252, 23],
    [4091, 20],
    [4092, 19],
    [65531, 16],
  ])("fits %i hosts in a /%i", (hosts, prefix) => {
    expect(prefixForHosts(hosts)).toBe(prefix);
  });

  it("returns null when even a /16 is too small", () => {
    expect(prefixForHosts(65532)).toBeNull();
    expect(prefixForHosts(1e6)).toBeNull();
  });

  it("always picks the smallest subnet that fits", () => {
    for (let hosts = 1; hosts <= 70000; hosts += 97) {
      const prefix = prefixForHosts(hosts);
      if (prefix === null) {
        expect(awsUsable(VPC_MIN_PREFIX)).toBeLessThan(hosts);
        continue;
      }
      expect(awsUsable(prefix)).toBeGreaterThanOrEqual(hosts);
      if (prefix < VPC_MAX_PREFIX) expect(awsUsable(prefix + 1)).toBeLessThan(hosts);
    }
  });
});

// --------------------------------------------------------- rangeToCidrs

describe("rangeToCidrs", () => {
  it("covers a single address with a /32", () => {
    expect(texts(rangeToCidrs(ip("10.0.0.7"), ip("10.0.0.7")))).toEqual(["10.0.0.7/32"]);
  });

  it("covers the whole address space with a single /0", () => {
    expect(texts(rangeToCidrs(0, 2 ** 32 - 1))).toEqual(["0.0.0.0/0"]);
  });

  it("covers the top of the address space", () => {
    expect(texts(rangeToCidrs(2 ** 32 - 2, 2 ** 32 - 1))).toEqual(["255.255.255.254/31"]);
    expect(texts(rangeToCidrs(2 ** 32 - 1, 2 ** 32 - 1))).toEqual(["255.255.255.255/32"]);
  });

  it("returns an empty list for an empty range", () => {
    expect(rangeToCidrs(10, 9)).toEqual([]);
  });

  it("returns a single block for an aligned range", () => {
    expect(texts(rangeToCidrs(ip("10.0.0.0"), ip("10.0.255.255")))).toEqual(["10.0.0.0/16"]);
  });

  it("splits an odd range into the fewest aligned blocks", () => {
    expect(texts(rangeToCidrs(5, 20))).toEqual([
      "0.0.0.5/32",
      "0.0.0.6/31",
      "0.0.0.8/29",
      "0.0.0.16/30",
      "0.0.0.20/32",
    ]);
    expect(texts(rangeToCidrs(ip("10.0.0.0"), ip("10.0.2.255")))).toEqual([
      "10.0.0.0/23",
      "10.0.2.0/24",
    ]);
    expect(texts(rangeToCidrs(ip("192.168.0.1"), ip("192.168.0.254")))).toEqual([
      "192.168.0.1/32",
      "192.168.0.2/31",
      "192.168.0.4/30",
      "192.168.0.8/29",
      "192.168.0.16/28",
      "192.168.0.32/27",
      "192.168.0.64/26",
      "192.168.0.128/26",
      "192.168.0.192/27",
      "192.168.0.224/28",
      "192.168.0.240/29",
      "192.168.0.248/30",
      "192.168.0.252/31",
      "192.168.0.254/32",
    ]);
  });

  it("returns parsed, aligned blocks", () => {
    for (const block of rangeToCidrs(5, 20)) {
      expect(block.aligned).toBe(true);
      expect(block.error).toBeUndefined();
    }
  });

  it("tiles random ranges exactly with aligned, non-mergeable blocks", () => {
    const random = mulberry32(2024);
    for (let i = 0; i < 200; i += 1) {
      const a = Math.floor(random() * 2 ** 32);
      const b = Math.min(
        2 ** 32 - 1,
        a + Math.floor(random() * 2 ** (1 + Math.floor(random() * 24)))
      );
      const blocks = rangeToCidrs(a, b);
      expect(blocks[0].network).toBe(a);
      expect(blocks[blocks.length - 1].last).toBe(b);
      for (let k = 0; k < blocks.length; k += 1) {
        expect(blocks[k].network % blocks[k].size).toBe(0);
        if (k > 0) {
          expect(blocks[k].network).toBe(blocks[k - 1].last + 1);
          // Two equal-size neighbours that form an aligned pair would be one block.
          const [left, right] = [blocks[k - 1], blocks[k]];
          const mergeable = left.prefix === right.prefix && left.network % (left.size * 2) === 0;
          expect(mergeable).toBe(false);
        }
      }
    }
  });
});

// ------------------------------------------------------------ summarize

describe("summarize", () => {
  it("merges adjacent aligned blocks", () => {
    expect(texts(summarize([cidr("10.0.0.0/24"), cidr("10.0.1.0/24")]))).toEqual(["10.0.0.0/23"]);
    expect(
      texts(summarize(["10.0.3.0/24", "10.0.1.0/24", "10.0.0.0/24", "10.0.2.0/24"].map(cidr)))
    ).toEqual(["10.0.0.0/22"]);
    expect(texts(summarize([cidr("0.0.0.0/1"), cidr("128.0.0.0/1")]))).toEqual(["0.0.0.0/0"]);
  });

  it("keeps adjacent blocks separate when they cannot form one aligned CIDR", () => {
    expect(texts(summarize([cidr("10.0.1.0/24"), cidr("10.0.2.0/24")]))).toEqual([
      "10.0.1.0/24",
      "10.0.2.0/24",
    ]);
  });

  it("absorbs blocks that overlap or are contained", () => {
    expect(texts(summarize([cidr("10.0.5.0/24"), cidr("10.0.0.0/16")]))).toEqual(["10.0.0.0/16"]);
    expect(texts(summarize([cidr("10.0.0.0/24"), cidr("10.0.0.0/24")]))).toEqual(["10.0.0.0/24"]);
    expect(
      texts(summarize([cidr("10.0.0.0/23"), cidr("10.0.1.0/24"), cidr("10.0.2.0/23")]))
    ).toEqual(["10.0.0.0/22"]);
  });

  it("keeps gaps and sorts the output", () => {
    expect(
      texts(summarize([cidr("192.168.0.0/24"), cidr("10.0.2.0/24"), cidr("10.0.0.0/24")]))
    ).toEqual(["10.0.0.0/24", "10.0.2.0/24", "192.168.0.0/24"]);
  });

  it("uses the network of blocks with host bits set", () => {
    expect(texts(summarize([cidr("10.0.0.9/24"), cidr("10.0.1.200/24")]))).toEqual(["10.0.0.0/23"]);
  });

  it("ignores invalid, null and undefined entries", () => {
    expect(
      texts(summarize([cidr("nope"), null, undefined, cidr("10.0.0.0/24"), cidr("1.2.3.4/40")]))
    ).toEqual(["10.0.0.0/24"]);
    expect(summarize([])).toEqual([]);
    expect(summarize([cidr("bad")])).toEqual([]);
  });

  it("covers exactly the union of random inputs with non-overlapping blocks", () => {
    const random = mulberry32(5);
    const base = ip("10.0.0.0");
    for (let round = 0; round < 60; round += 1) {
      const covered = new Array(1024).fill(false);
      const blocks = [];
      const count = 1 + Math.floor(random() * 8);
      for (let n = 0; n < count; n += 1) {
        const prefix = 24 + Math.floor(random() * 7);
        const block = cidr(`${formatIp(base + Math.floor(random() * 1024))}/${prefix}`);
        blocks.push(block);
        for (let a = block.network; a <= block.last; a += 1) covered[a - base] = true;
      }
      const result = summarize(blocks);
      const got = new Array(1024).fill(false);
      for (const block of result) {
        for (let a = block.network; a <= block.last; a += 1) {
          expect(got[a - base]).toBe(false);
          got[a - base] = true;
        }
      }
      expect(got).toEqual(covered);
      for (let k = 1; k < result.length; k += 1) {
        expect(result[k].network).toBeGreaterThan(result[k - 1].last);
      }
    }
  });
});

// -------------------------------------------------------------- planVpc

describe("planVpc: the default plan", () => {
  const plan = planVpc(DEFAULT_PLAN);

  it("has no errors or warnings", () => {
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("echoes the normalised inputs", () => {
    expect(plan.vpc.text).toBe("10.0.0.0/16");
    expect(plan.region).toBe("us-east-1");
    expect(plan.azs).toBe(3);
    expect(plan.spareAzs).toBe(1);
    expect(plan.natGateways).toBe("per-az");
    expect(plan.tiers).toEqual([
      { name: "Public", kind: "public", prefix: 24, index: 0 },
      { name: "App", kind: "private", prefix: 20, index: 1 },
      { name: "Data", kind: "data", prefix: 24, index: 2 },
    ]);
  });

  it("allocates exactly these subnets, ordered by tier then AZ", () => {
    expect(plan.subnets.map((subnet) => `${subnet.tier} ${subnet.az} ${subnet.text}`)).toEqual([
      "Public us-east-1a 10.0.64.0/24",
      "Public us-east-1b 10.0.65.0/24",
      "Public us-east-1c 10.0.66.0/24",
      "App us-east-1a 10.0.0.0/20",
      "App us-east-1b 10.0.16.0/20",
      "App us-east-1c 10.0.32.0/20",
      "Data us-east-1a 10.0.68.0/24",
      "Data us-east-1b 10.0.69.0/24",
      "Data us-east-1c 10.0.70.0/24",
    ]);
  });

  it("reserves the spare AZ's blocks next to each tier, sorted by address", () => {
    expect(plan.reserved.map((block) => `${block.tier} ${block.az} ${block.text}`)).toEqual([
      "App us-east-1d 10.0.48.0/20",
      "Public us-east-1d 10.0.67.0/24",
      "Data us-east-1d 10.0.71.0/24",
    ]);
    expect(plan.reserved.every((block) => block.azIndex === 3)).toBe(true);
  });

  it("leaves the rest of the VPC as free aligned blocks", () => {
    expect(texts(plan.free)).toEqual([
      "10.0.72.0/21",
      "10.0.80.0/20",
      "10.0.96.0/19",
      "10.0.128.0/17",
    ]);
  });

  it("computes AWS addressing details for each subnet", () => {
    const app = plan.subnets.find((subnet) => subnet.tier === "App" && subnet.azIndex === 0);
    expect(app).toMatchObject({
      text: "10.0.0.0/20",
      kind: "private",
      tierIndex: 1,
      azIndex: 0,
      usable: 4091,
      router: "10.0.0.1",
      firstUsable: "10.0.0.4",
      lastUsable: "10.0.15.254",
      aligned: true,
    });
    const publicB = plan.subnets.find((subnet) => subnet.tier === "Public" && subnet.azIndex === 1);
    expect(publicB).toMatchObject({
      text: "10.0.65.0/24",
      kind: "public",
      usable: 251,
      router: "10.0.65.1",
      firstUsable: "10.0.65.4",
      lastUsable: "10.0.65.254",
    });
  });

  it("sums the statistics", () => {
    expect(plan.stats).toEqual({
      allocated: 3 * 4096 + 6 * 256,
      reserved: 4096 + 2 * 256,
      free: 65536 - 13824 - 4608,
      usable: 3 * 4091 + 6 * 251,
      total: 65536,
      utilisation: 13824 / 65536,
    });
  });

  it("does not mutate DEFAULT_PLAN", () => {
    expect(DEFAULT_PLAN.tiers[0]).toEqual({ name: "Public", kind: "public", prefix: 24 });
  });
});

describe("planVpc: spare AZs", () => {
  it("reserves nothing without spare AZs and frees the space instead", () => {
    const plan = planVpc({ ...DEFAULT_PLAN, spareAzs: 0 });
    expect(plan.reserved).toEqual([]);
    expect(plan.spareAzs).toBe(0);
    expect(plan.subnets.map((subnet) => subnet.text)).toEqual([
      "10.0.48.0/24",
      "10.0.49.0/24",
      "10.0.50.0/24",
      "10.0.0.0/20",
      "10.0.16.0/20",
      "10.0.32.0/20",
      "10.0.51.0/24",
      "10.0.52.0/24",
      "10.0.53.0/24",
    ]);
    expect(texts(plan.free)).toEqual([
      "10.0.54.0/23",
      "10.0.56.0/21",
      "10.0.64.0/18",
      "10.0.128.0/17",
    ]);
    expect(plan.stats.reserved).toBe(0);
  });

  it("reserves one block per tier for each spare AZ, named after the next AZ letters", () => {
    const plan = planVpc({ ...DEFAULT_PLAN, spareAzs: 2 });
    expect(plan.reserved).toHaveLength(6);
    expect(plan.reserved.map((block) => `${block.tier} ${block.az} ${block.text}`)).toEqual([
      "App us-east-1d 10.0.48.0/20",
      "App us-east-1e 10.0.64.0/20",
      "Public us-east-1d 10.0.83.0/24",
      "Public us-east-1e 10.0.84.0/24",
      "Data us-east-1d 10.0.88.0/24",
      "Data us-east-1e 10.0.89.0/24",
    ]);
    expect(plan.subnets.every((subnet) => subnet.azIndex < 3)).toBe(true);
    expect(plan.stats.reserved).toBe(2 * 4096 + 4 * 256);
  });

  it("clamps spare AZs so the total never exceeds six", () => {
    expect(planVpc({ ...DEFAULT_PLAN, azs: 6, spareAzs: 2 }).spareAzs).toBe(0);
    expect(planVpc({ ...DEFAULT_PLAN, azs: 4, spareAzs: 5 }).spareAzs).toBe(2);
    expect(planVpc({ ...DEFAULT_PLAN, spareAzs: -1 }).spareAzs).toBe(0);
    expect(planVpc({ ...DEFAULT_PLAN, spareAzs: "junk" }).spareAzs).toBe(0);
    expect(planVpc({ ...DEFAULT_PLAN, spareAzs: 1.9 }).spareAzs).toBe(1);
  });

  it("reports when only the spare AZ capacity does not fit", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/24",
      azs: 2,
      spareAzs: 1,
      tiers: [{ name: "Only", kind: "public", prefix: 25 }],
    });
    expect(plan.errors).toEqual([
      "The spare AZ capacity does not fit in 10.0.0.0/24. Reduce spare AZs or subnet sizes.",
    ]);
    expect(plan.subnets).toEqual([]);
    expect(plan.reserved).toEqual([]);
    expect(plan.free).toEqual([]);
  });
});

describe("planVpc: availability zones and region", () => {
  it.each([
    [0, 1],
    [-3, 1],
    [1, 1],
    [2.9, 2],
    ["4", 4],
    [6, 6],
    [9, 6],
    [undefined, 1],
    ["many", 1],
  ])("clamps azs %j to %i", (azs, expected) => {
    const plan = planVpc({ ...tieredPlan(), azs });
    expect(plan.azs).toBe(expected);
    if (!plan.errors.length) expect(plan.subnets).toHaveLength(expected * 3);
  });

  it("names AZs after the region with letters a–f", () => {
    const plan = planVpc({ ...tieredPlan(), region: "eu-west-2", azs: 6 });
    expect([...new Set(plan.subnets.map((subnet) => subnet.az))]).toEqual([
      "eu-west-2a",
      "eu-west-2b",
      "eu-west-2c",
      "eu-west-2d",
      "eu-west-2e",
      "eu-west-2f",
    ]);
  });

  it("trims the region and falls back to us-east-1", () => {
    expect(planVpc({ ...tieredPlan(), region: "  ap-south-1 " }).region).toBe("ap-south-1");
    expect(planVpc({ ...tieredPlan(), region: "   " }).region).toBe("us-east-1");
    expect(planVpc({ ...tieredPlan(), region: undefined }).region).toBe("us-east-1");
  });
});

describe("planVpc: validation errors", () => {
  it("rejects missing input and an unparseable CIDR", () => {
    for (const input of [undefined, null, {}]) {
      const plan = planVpc(input);
      expect(plan.vpc).toBeNull();
      expect(plan.errors).toEqual(["“” is not a CIDR block — expected a.b.c.d/nn"]);
      expect(plan.subnets).toEqual([]);
      expect(plan.reserved).toEqual([]);
      expect(plan.free).toEqual([]);
    }
    const bad = planVpc({ ...tieredPlan(), cidr: "10.0.0.999/16" });
    expect(bad.vpc).toBeNull();
    expect(bad.errors).toEqual(["“10.0.0.999” is not an IPv4 address"]);
    expect(bad.region).toBe("us-east-1");
    expect(bad.azs).toBe(3);
  });

  it("rejects VPC blocks outside /16–/28", () => {
    const wide = planVpc({ ...tieredPlan(), cidr: "10.0.0.0/8" });
    expect(wide.errors).toEqual(["A VPC block must be between /16 and /28 (got /8)."]);
    expect(wide.subnets).toEqual([]);
    expect(wide.vpc.text).toBe("10.0.0.0/8");

    const narrow = planVpc({
      cidr: "10.0.0.0/29",
      azs: 1,
      tiers: [{ name: "T", kind: "public", prefix: 29 }],
    });
    expect(narrow.errors).toEqual([
      "A VPC block must be between /16 and /28 (got /29).",
      "T: AWS subnets must be /16 to /28.",
    ]);
  });

  it("accepts the boundary VPC sizes /16 and /28", () => {
    expect(
      planVpc({ cidr: "10.0.0.0/16", azs: 1, tiers: [{ name: "A", prefix: 16 }] }).errors
    ).toEqual([]);
    const tiny = planVpc({ cidr: "10.0.0.0/28", azs: 1, tiers: [{ name: "A", prefix: 28 }] });
    expect(tiny.errors).toEqual([]);
    expect(tiny.subnets[0]).toMatchObject({ text: "10.0.0.0/28", usable: 11 });
  });

  it("rejects a tier larger than the VPC", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/20",
      azs: 1,
      tiers: [{ name: "Huge", kind: "private", prefix: 16 }],
    });
    expect(plan.errors).toEqual(["Huge subnets (/16) are larger than the VPC (/20)."]);
    expect(plan.subnets).toEqual([]);
  });

  it("rejects tier prefixes outside /16–/28", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/16",
      azs: 1,
      tiers: [
        { name: "Tiny", kind: "private", prefix: 29 },
        { name: "Point", kind: "public", prefix: 32 },
        { name: "Ok", kind: "public", prefix: 24 },
      ],
    });
    expect(plan.errors).toEqual([
      "Tiny: AWS subnets must be /16 to /28.",
      "Point: AWS subnets must be /16 to /28.",
    ]);
  });

  it("reports a tier wider than /16 in a wider-than-allowed VPC as outside the subnet range", () => {
    const plan = planVpc({ cidr: "10.0.0.0/14", azs: 1, tiers: [{ name: "Wide", prefix: 15 }] });
    expect(plan.errors).toContain("Wide: AWS subnets must be /16 to /28.");
    expect(plan.errors).toContain("A VPC block must be between /16 and /28 (got /14).");
  });

  it("requires at least one tier", () => {
    expect(planVpc({ cidr: "10.0.0.0/16", tiers: [] }).errors).toEqual([
      "Add at least one subnet tier.",
    ]);
    expect(planVpc({ cidr: "10.0.0.0/16" }).errors).toEqual(["Add at least one subnet tier."]);
    // A tier whose prefix is not a number is dropped, leaving none.
    expect(
      planVpc({ cidr: "10.0.0.0/16", tiers: [{ name: "Bad", prefix: "wide" }] }).errors
    ).toEqual(["Add at least one subnet tier."]);
  });

  it("reports when the tiers themselves do not fit", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/24",
      azs: 2,
      spareAzs: 0,
      tiers: [{ name: "A", kind: "public", prefix: 24 }],
    });
    expect(plan.errors).toEqual([
      "These tiers need 512 addresses, but 10.0.0.0/24 only has 256. Use a larger VPC or smaller subnets.",
    ]);
    expect(plan.subnets).toEqual([]);
  });

  it("mentions spare AZs in the size error when they are part of the need", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/24",
      azs: 2,
      spareAzs: 1,
      tiers: [{ name: "A", kind: "public", prefix: 24 }],
    });
    expect(plan.errors).toEqual([
      "These tiers need 768 addresses including spare AZs, but 10.0.0.0/24 only has 256. Use a larger VPC or smaller subnets.",
    ]);
  });

  it("fills a VPC exactly when the tiers need all of it", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/24",
      azs: 2,
      tiers: [{ name: "Half", kind: "public", prefix: 25 }],
    });
    expect(plan.errors).toEqual([]);
    expect(texts(plan.subnets)).toEqual(["10.0.0.0/25", "10.0.0.128/25"]);
    expect(plan.free).toEqual([]);
    expect(plan.stats.utilisation).toBe(1);
  });
});

describe("planVpc: warnings", () => {
  it("warns when the VPC CIDR has host bits set and plans the aligned network", () => {
    const plan = planVpc({ ...tieredPlan(), cidr: "10.0.0.5/16" });
    expect(plan.warnings).toContain("10.0.0.5/16 has host bits set — using 10.0.0.0/16.");
    expect(plan.vpc.text).toBe("10.0.0.0/16");
    expect(plan.errors).toEqual([]);
    expect(plan.subnets.every((subnet) => contains(plan.vpc, subnet))).toBe(true);
  });

  it("warns about non-RFC 1918 ranges", () => {
    const plan = planVpc({ ...tieredPlan(), cidr: "100.64.0.0/16" });
    expect(plan.warnings).toContain(
      "100.64.0.0/16 is not in an RFC 1918 private range, so it may clash with real internet addresses."
    );
    expect(plan.errors).toEqual([]);
  });

  it("does not warn about RFC 1918 ranges", () => {
    for (const range of ["10.20.0.0/16", "172.20.0.0/16", "192.168.0.0/16"]) {
      expect(
        planVpc({
          ...tieredPlan(),
          cidr: range,
          tiers: [{ name: "P", kind: "public", prefix: 24 }],
        }).warnings
      ).toEqual([]);
    }
  });

  it("warns about Docker's 172.17.0.0/16 bridge network, including blocks inside it", () => {
    const docker =
      "172.17.0.0/16 is Docker's default bridge network; services such as SageMaker and Cloud9 can misroute inside it.";
    expect(planVpc({ ...tieredPlan(), cidr: "172.17.0.0/16" }).warnings).toContain(docker);
    expect(
      planVpc({
        cidr: "172.17.128.0/20",
        azs: 2,
        tiers: [{ name: "P", kind: "public", prefix: 24 }],
      }).warnings
    ).toContain(docker);
    expect(planVpc({ ...tieredPlan(), cidr: "172.16.0.0/16" }).warnings).not.toContain(docker);
    expect(planVpc({ ...tieredPlan(), cidr: "172.18.0.0/16" }).warnings).not.toContain(docker);
  });

  it("warns about a single AZ", () => {
    const plan = planVpc({ ...tieredPlan(), azs: 1 });
    expect(plan.warnings).toContain(
      "A single Availability Zone has no redundancy: an AZ outage takes the whole VPC down."
    );
    expect(planVpc({ ...tieredPlan(), azs: 2 }).warnings).toEqual([]);
  });

  it("warns when there is no public tier", () => {
    const plan = planVpc({
      ...tieredPlan(),
      tiers: [
        { name: "App", kind: "private", prefix: 20 },
        { name: "Data", kind: "data", prefix: 24 },
      ],
    });
    expect(plan.warnings).toEqual([
      "No public tier: the VPC has no route to the internet unless you add a Transit Gateway or endpoints.",
    ]);
  });

  it("warns about private tiers smaller than /24, but not isolated or public ones", () => {
    const plan = planVpc({
      ...tieredPlan(),
      tiers: [
        { name: "Public", kind: "public", prefix: 28 },
        { name: "App", kind: "private", prefix: 25 },
        { name: "Workers", kind: "private", prefix: 24 },
        { name: "Data", kind: "data", prefix: 28 },
      ],
    });
    expect(plan.warnings).toEqual([
      "App subnets (/25, 123 usable) are small for workloads that scale out; Lambda, EKS and ECS each take an IP per task or ENI.",
    ]);
  });

  it("does not emit post-planning warnings when the plan fails", () => {
    const plan = planVpc({ cidr: "10.0.0.0/24", azs: 1, tiers: [{ name: "A", prefix: 16 }] });
    expect(plan.errors).toHaveLength(1);
    expect(plan.warnings).toEqual([]);
  });
});

describe("planVpc: tier normalisation", () => {
  it("falls back to private for unknown kinds", () => {
    const plan = planVpc({
      ...tieredPlan(),
      tiers: [{ name: "Mystery", kind: "dmz", prefix: 24 }],
    });
    expect(plan.tiers[0].kind).toBe("private");
    expect(plan.subnets.every((subnet) => subnet.kind === "private")).toBe(true);
  });

  it("names blank tiers by position and truncates long names to 40 characters", () => {
    const plan = planVpc({
      ...tieredPlan(),
      tiers: [
        { name: "   ", kind: "public", prefix: 24 },
        { kind: "private", prefix: 24 },
        { name: "x".repeat(60), kind: "data", prefix: 24 },
      ],
    });
    expect(plan.tiers.map((tier) => tier.name)).toEqual(["Tier 1", "Tier 2", "x".repeat(40)]);
  });

  it("truncates numeric prefixes and keeps the original tier index after dropping bad tiers", () => {
    const plan = planVpc({
      ...tieredPlan(),
      tiers: [
        { name: "Bad", kind: "public", prefix: "nope" },
        { name: "Good", kind: "public", prefix: "24.9" },
      ],
    });
    expect(plan.tiers).toEqual([{ name: "Good", kind: "public", prefix: 24, index: 1 }]);
    expect(plan.subnets.every((subnet) => subnet.tierIndex === 1)).toBe(true);
  });
});

describe("planVpc: NAT gateway option", () => {
  it.each([
    ["per-az", "per-az"],
    ["single", "single"],
    ["none", "none"],
    ["two", "per-az"],
    [undefined, "per-az"],
    [null, "per-az"],
  ])("normalises %j to %s", (value, expected) => {
    expect(planVpc({ ...tieredPlan(), natGateways: value }).natGateways).toBe(expected);
  });
});

describe("planVpc: packing", () => {
  it("packs largest blocks first so each tier's AZs sit together", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/16",
      azs: 2,
      spareAzs: 1,
      tiers: [
        { name: "Small", kind: "public", prefix: 26 },
        { name: "Big", kind: "private", prefix: 18 },
        { name: "Mid", kind: "data", prefix: 22 },
      ],
    });
    const ordered = [...plan.subnets, ...plan.reserved].sort((a, b) => a.network - b.network);
    expect(ordered.map((block) => `${block.tier}-${block.azIndex}`)).toEqual([
      "Big-0",
      "Big-1",
      "Big-2",
      "Mid-0",
      "Mid-1",
      "Mid-2",
      "Small-0",
      "Small-1",
      "Small-2",
    ]);
    for (let k = 1; k < ordered.length; k += 1) {
      expect(ordered[k].network).toBe(ordered[k - 1].last + 1);
    }
  });

  it("breaks ties between equal-size tiers by tier order", () => {
    const plan = planVpc({
      cidr: "10.0.0.0/16",
      azs: 2,
      tiers: [
        { name: "First", kind: "public", prefix: 24 },
        { name: "Second", kind: "data", prefix: 24 },
      ],
    });
    expect(texts(plan.subnets)).toEqual([
      "10.0.0.0/24",
      "10.0.1.0/24",
      "10.0.2.0/24",
      "10.0.3.0/24",
    ]);
  });

  it("satisfies packing invariants for many random plans", () => {
    const random = mulberry32(1234);
    const kinds = ["public", "private", "data"];
    let planned = 0;
    let rejected = 0;
    for (let round = 0; round < 400; round += 1) {
      const vpcPrefix = 16 + Math.floor(random() * 9);
      const size = blockSize(vpcPrefix);
      const network = Math.floor((ip("10.0.0.0") + Math.floor(random() * 2 ** 24)) / size) * size;
      const tierCount = 1 + Math.floor(random() * 4);
      const tiers = Array.from({ length: tierCount }, (_, index) => ({
        name: `T${index}`,
        kind: kinds[Math.floor(random() * 3)],
        prefix: vpcPrefix + Math.floor(random() * (VPC_MAX_PREFIX - vpcPrefix + 1)),
      }));
      const azs = 1 + Math.floor(random() * 6);
      const spareAzs = Math.floor(random() * 4);
      const plan = planVpc({ cidr: cidrText(network, vpcPrefix), azs, spareAzs, tiers });

      const effectiveSpare = Math.min(6 - azs, spareAzs);
      const needed = tiers.reduce(
        (sum, tier) => sum + blockSize(tier.prefix) * (azs + effectiveSpare),
        0
      );
      expect(plan.errors.length > 0).toBe(needed > size);
      if (plan.errors.length) {
        rejected += 1;
        expect(plan.subnets).toEqual([]);
        expect(plan.reserved).toEqual([]);
        expect(plan.free).toEqual([]);
        continue;
      }
      planned += 1;

      expect(plan.subnets).toHaveLength(tierCount * azs);
      expect(plan.reserved).toHaveLength(tierCount * effectiveSpare);

      const blocks = [...plan.subnets, ...plan.reserved, ...plan.free];
      for (const block of blocks) {
        expect(contains(plan.vpc, block)).toBe(true);
        expect(block.network % block.size).toBe(0);
      }
      for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
          expect(overlaps(blocks[i], blocks[j])).toBe(false);
        }
      }
      // Subnets, reservations and free blocks tile the VPC with no gaps.
      const sorted = [...blocks].sort((a, b) => a.network - b.network);
      expect(sorted[0].network).toBe(plan.vpc.network);
      expect(sorted[sorted.length - 1].last).toBe(plan.vpc.last);
      for (let k = 1; k < sorted.length; k += 1) {
        expect(sorted[k].network).toBe(sorted[k - 1].last + 1);
      }

      for (const subnet of plan.subnets) {
        expect(subnet.prefix).toBe(tiers[subnet.tierIndex].prefix);
        expect(subnet.usable).toBe(subnet.size - AWS_RESERVED);
        expect(ip(subnet.router)).toBe(subnet.network + 1);
        expect(ip(subnet.firstUsable)).toBe(subnet.network + 4);
        expect(ip(subnet.lastUsable)).toBe(subnet.last - 1);
      }

      const sum = (list) => list.reduce((total, block) => total + block.size, 0);
      expect(plan.stats.allocated).toBe(sum(plan.subnets));
      expect(plan.stats.reserved).toBe(sum(plan.reserved));
      expect(plan.stats.free).toBe(sum(plan.free));
      expect(plan.stats.allocated + plan.stats.reserved + plan.stats.free).toBe(plan.stats.total);
      expect(plan.stats.total).toBe(size);
      expect(plan.stats.usable).toBe(plan.subnets.reduce((total, s) => total + s.usable, 0));
      expect(plan.stats.utilisation).toBeCloseTo(plan.stats.allocated / size, 12);
    }
    expect(planned).toBeGreaterThan(40);
    expect(rejected).toBeGreaterThan(40);
  });
});

// ------------------------------------------------------------ checkCidrs

describe("checkCidrs", () => {
  it("returns an empty, not-ok result for empty input", () => {
    for (const input of ["", null, undefined, "\n\n  \n", "# just a comment"]) {
      const result = checkCidrs(input);
      expect(result.entries).toEqual([]);
      expect(result.issues).toEqual([]);
      expect(result.summary).toEqual([]);
      expect(result.clean).toEqual([]);
      expect(result.ok).toBe(false);
    }
  });

  it("parses lines, labels and comments, keeping original line numbers", () => {
    const result = checkCidrs(
      [
        "# peering plan",
        "10.1.0.0/16 prod-vpc",
        "",
        "10.2.0.0/16   staging east   # comment",
        "10.3.0.0/16, dev",
        "10.4.0.0/16;sandbox",
        "192.168.0.0/24 # on-prem",
      ].join("\n")
    );
    expect(result.entries.map((entry) => [entry.line, entry.text, entry.label])).toEqual([
      [2, "10.1.0.0/16", "prod-vpc"],
      [4, "10.2.0.0/16", "staging east"],
      [5, "10.3.0.0/16", "dev"],
      [6, "10.4.0.0/16", "sandbox"],
      [7, "192.168.0.0/24", null],
    ]);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.clean).toHaveLength(5);
  });

  it("handles Windows line endings", () => {
    const result = checkCidrs("10.0.0.0/16 a\r\n10.1.0.0/16 b\r\n");
    expect(result.entries.map((entry) => entry.label)).toEqual(["a", "b"]);
    expect(result.ok).toBe(true);
  });

  it("reports invalid lines as errors and skips them", () => {
    const result = checkCidrs("10.0.0.0/16\nnot-a-cidr\n10.0.0.300/24\n10.9.0.0/40");
    expect(result.entries).toHaveLength(1);
    expect(result.issues).toEqual([
      {
        severity: "error",
        line: 2,
        message: "“not-a-cidr” is not a CIDR block — expected a.b.c.d/nn",
      },
      { severity: "error", line: 3, message: "“10.0.0.300” is not an IPv4 address" },
      { severity: "error", line: 4, message: "/40 is not a prefix length (0–32)" },
    ]);
    expect(result.ok).toBe(false);
    // Parse errors are not tied to a pair, so the valid entry is still clean.
    expect(texts(result.clean)).toEqual(["10.0.0.0/16"]);
  });

  it("warns about misaligned blocks without failing the check", () => {
    const result = checkCidrs("10.0.0.1/24 lab");
    expect(result.issues).toEqual([
      {
        severity: "warn",
        line: 1,
        message: "10.0.0.1/24 has host bits set — the network is 10.0.0.0/24.",
      },
    ]);
    expect(result.entries[0]).toMatchObject({ text: "10.0.0.0/24", aligned: false, label: "lab" });
    expect(result.ok).toBe(true);
    expect(result.clean).toHaveLength(1);
  });

  it("reports duplicates with both line numbers", () => {
    const result = checkCidrs("10.0.0.0/16 prod\n10.1.0.0/16\n10.0.0.0/16 copy");
    expect(result.issues).toEqual([
      {
        severity: "error",
        line: 3,
        message: "10.0.0.0/16 (prod) is listed twice (lines 1 and 3).",
        pair: [1, 3],
      },
    ]);
    expect(result.ok).toBe(false);
    expect(texts(result.clean)).toEqual(["10.1.0.0/16"]);
  });

  it("treats a misaligned block that normalises to an existing one as a duplicate", () => {
    const result = checkCidrs("10.0.0.0/24\n10.0.0.9/24");
    expect(result.issues.map((issue) => issue.severity)).toEqual(["warn", "error"]);
    expect(result.issues[1].message).toBe("10.0.0.0/24 is listed twice (lines 1 and 2).");
  });

  it("reports a later block inside an earlier one", () => {
    const result = checkCidrs("10.0.0.0/8 corp\n10.5.0.0/16 team");
    expect(result.issues).toEqual([
      {
        severity: "error",
        line: 2,
        message: "10.5.0.0/16 (team) sits inside 10.0.0.0/8 (corp).",
        pair: [1, 2],
      },
    ]);
  });

  it("reports an earlier block inside a later one", () => {
    const result = checkCidrs("10.5.0.0/16\n10.0.0.0/8");
    expect(result.issues).toEqual([
      {
        severity: "error",
        line: 2,
        message: "10.5.0.0/16 sits inside 10.0.0.0/8.",
        pair: [1, 2],
      },
    ]);
  });

  it("reports what looks like a partial overlap as containment once normalised", () => {
    // 10.0.0.128/23 is really 10.0.0.0/23, which fully contains 10.0.1.0/24.
    const result = checkCidrs("10.0.0.128/23\n10.0.1.0/24");
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors).toEqual([
      {
        severity: "error",
        line: 2,
        message: "10.0.1.0/24 sits inside 10.0.0.0/23.",
        pair: [1, 2],
      },
    ]);
  });

  it("reports every conflicting pair and excludes all of them from clean", () => {
    const result = checkCidrs("10.0.0.0/8\n10.1.0.0/16\n10.1.2.0/24\n192.168.0.0/16");
    expect(result.issues.map((issue) => issue.pair)).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(texts(result.clean)).toEqual(["192.168.0.0/16"]);
    expect(result.ok).toBe(false);
  });

  it("does not flag adjacent blocks and summarises them", () => {
    const result = checkCidrs("10.0.0.0/24\n10.0.1.0/24\n10.0.3.0/24");
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(texts(result.summary)).toEqual(["10.0.0.0/23", "10.0.3.0/24"]);
  });

  it("summarises across overlapping entries too", () => {
    expect(texts(checkCidrs("10.0.0.0/16\n10.0.5.0/24\n10.1.0.0/16").summary)).toEqual([
      "10.0.0.0/15",
    ]);
  });
});

// ------------------------------------------------------- auditAddressing

describe("auditAddressing: basics", () => {
  it("returns an empty report for a missing or empty state", () => {
    const empty = { networks: [], issues: [], devices: 0, unaddressed: 0 };
    expect(auditAddressing()).toEqual(empty);
    expect(auditAddressing(null)).toEqual(empty);
    expect(auditAddressing({})).toEqual(empty);
    expect(auditAddressing({ nodes: [], links: [] })).toEqual(empty);
  });

  it("counts devices without an address separately", () => {
    const audit = auditAddressing({
      nodes: [dev("net", "internet"), dev("pc", "pc", "10.0.0.10", "24"), dev("sw", "l2-switch")],
      links: [],
    });
    expect(audit.devices).toBe(1);
    expect(audit.unaddressed).toBe(2);
    expect(audit.issues).toEqual([]);
  });

  it("groups devices into networks with host counts and capacity", () => {
    const audit = auditAddressing({
      nodes: [
        dev("b", "pc", "10.0.0.11", "255.255.255.0"),
        dev("a", "pc", "10.0.0.10", "/24"),
        dev("p2p", "router", "10.1.0.1", "31"),
        dev("loop", "router", "10.2.0.1", "32"),
        dev("wan", "firewall", "203.0.113.2", "30"),
      ],
      links: [],
    });
    expect(audit.devices).toBe(5);
    expect(
      audit.networks.map((network) => [
        network.text,
        network.hosts,
        network.capacity,
        network.devices,
      ])
    ).toEqual([
      ["10.0.0.0/24", 2, 254, ["b", "a"]],
      ["10.1.0.0/31", 1, 2, ["p2p"]],
      ["10.2.0.1/32", 1, 1, ["loop"]],
      ["203.0.113.0/30", 1, 2, ["wan"]],
    ]);
  });

  it("sorts networks sharing a base address by prefix", () => {
    const audit = auditAddressing({
      nodes: [dev("x", "pc", "10.0.0.10", "24"), dev("y", "pc", "10.0.0.20", "16")],
      links: [],
    });
    expect(texts(audit.networks)).toEqual(["10.0.0.0/16", "10.0.0.0/24"]);
  });
});

describe("auditAddressing: address validity", () => {
  it("flags an invalid IP as an error and leaves it out of the networks", () => {
    const audit = auditAddressing({ nodes: [dev("bad", "pc", "10.0.0.300", "24")], links: [] });
    expect(audit.issues).toEqual([
      { severity: "error", node: "bad", message: "bad: “10.0.0.300” is not an IPv4 address." },
    ]);
    expect(audit.devices).toBe(0);
    expect(audit.networks).toEqual([]);
  });

  it.each([
    ["missing", ""],
    ["undefined", undefined],
    ["non-contiguous", "255.0.255.0"],
    ["out of range", "40"],
  ])("warns about a %s mask", (_label, subnet) => {
    const audit = auditAddressing({ nodes: [dev("pc", "pc", "10.0.0.10", subnet)], links: [] });
    expect(audit.issues).toEqual([
      {
        severity: "warn",
        node: "pc",
        message: "pc has no valid subnet mask, so its network is unknown.",
      },
    ]);
    expect(audit.devices).toBe(0);
  });

  it("accepts a numeric mask", () => {
    const audit = auditAddressing({ nodes: [dev("pc", "pc", "10.0.0.10", 24)], links: [] });
    expect(texts(audit.networks)).toEqual(["10.0.0.0/24"]);
  });

  it("flags a host on the network address", () => {
    const audit = auditAddressing({ nodes: [dev("pc", "pc", "10.0.0.0", "24")], links: [] });
    expect(audit.issues).toEqual([
      {
        severity: "error",
        node: "pc",
        message: "pc uses 10.0.0.0, the network address of 10.0.0.0/24.",
      },
    ]);
    // It is still counted as a device on that network.
    expect(audit.devices).toBe(1);
  });

  it("flags a host on the broadcast address", () => {
    const audit = auditAddressing({
      nodes: [dev("pc", "pc", "192.168.1.255", "255.255.255.0")],
      links: [],
    });
    expect(audit.issues).toEqual([
      {
        severity: "error",
        node: "pc",
        message: "pc uses 192.168.1.255, the broadcast address of 192.168.1.0/24.",
      },
    ]);
  });

  it("checks both ends of a /30", () => {
    const messages = (address) =>
      auditAddressing({ nodes: [dev("r", "router", address, "30")], links: [] }).issues.map(
        (issue) => issue.message
      );
    expect(messages("10.0.0.4")).toEqual(["r uses 10.0.0.4, the network address of 10.0.0.4/30."]);
    expect(messages("10.0.0.5")).toEqual([]);
    expect(messages("10.0.0.6")).toEqual([]);
    expect(messages("10.0.0.7")).toEqual([
      "r uses 10.0.0.7, the broadcast address of 10.0.0.4/30.",
    ]);
  });

  it("allows both addresses of a /31 point-to-point link (RFC 3021)", () => {
    const audit = auditAddressing({
      nodes: [dev("r1", "router", "10.0.0.0", "31"), dev("r2", "router", "10.0.0.1", "31")],
      links: [wire("r1", "r2")],
    });
    expect(audit.issues).toEqual([]);
    expect(audit.networks[0]).toMatchObject({ text: "10.0.0.0/31", hosts: 2, capacity: 2 });
  });

  it("allows a /32 host route", () => {
    const audit = auditAddressing({ nodes: [dev("lo", "router", "10.9.9.9", "32")], links: [] });
    expect(audit.issues).toEqual([]);
  });
});

describe("auditAddressing: duplicates and overlaps", () => {
  it("flags a duplicate address once, on the second device", () => {
    const audit = auditAddressing({
      nodes: [dev("a", "pc", "10.0.0.5", "24"), dev("b", "pc", "10.0.0.5", "24")],
      links: [],
    });
    expect(audit.issues).toEqual([
      { severity: "error", node: "b", message: "10.0.0.5 is used by a and b." },
    ]);
  });

  it("lists every device sharing an address", () => {
    const audit = auditAddressing({
      nodes: [
        dev("a", "pc", "10.0.0.5", "24"),
        dev("b", "pc", "10.0.0.5", "24"),
        dev("c", "laptop", "10.0.0.5", "24"),
      ],
      links: [],
    });
    expect(audit.issues).toEqual([
      { severity: "error", node: "b", message: "10.0.0.5 is used by a and b and c." },
    ]);
  });

  it("recognises the same address written with zero padding", () => {
    const audit = auditAddressing({
      nodes: [dev("a", "pc", "10.0.0.5", "24"), dev("b", "pc", "010.000.000.005", "24")],
      links: [],
    });
    expect(audit.issues.map((issue) => issue.message)).toEqual(["10.0.0.5 is used by a and b."]);
  });

  it("flags duplicates even when the masks disagree", () => {
    const audit = auditAddressing({
      nodes: [dev("a", "pc", "10.0.0.5", "24"), dev("b", "pc", "10.0.0.5", "16")],
      links: [],
    });
    expect(audit.issues.map((issue) => issue.severity).sort()).toEqual(["error", "warn"]);
    expect(audit.issues.find((issue) => issue.severity === "error").message).toBe(
      "10.0.0.5 is used by a and b."
    );
  });

  it("flags a duplicate address even when one of the devices has no mask", () => {
    // The address is in use twice whatever the mask; a missing mask only hides the network.
    const audit = auditAddressing({
      nodes: [dev("a", "pc", "10.0.0.5", "24"), dev("b", "pc", "10.0.0.5", "")],
      links: [],
    });
    expect(audit.issues).toContainEqual(
      expect.objectContaining({ severity: "error", message: "10.0.0.5 is used by a and b." })
    );
  });

  it("warns when two networks overlap without matching", () => {
    const audit = auditAddressing({
      nodes: [dev("a", "pc", "10.0.0.10", "16"), dev("b", "pc", "10.0.1.10", "24")],
      links: [],
    });
    expect(audit.issues).toEqual([
      {
        severity: "warn",
        message:
          "10.0.0.0/16 and 10.0.1.0/24 overlap: devices in them disagree about who is on-link (check the masks).",
      },
    ]);
  });

  it("does not warn about disjoint or identical networks", () => {
    const audit = auditAddressing({
      nodes: [
        dev("a", "pc", "10.0.0.10", "24"),
        dev("b", "pc", "10.0.0.11", "24"),
        dev("c", "pc", "10.0.1.10", "24"),
      ],
      links: [],
    });
    expect(audit.issues).toEqual([]);
  });
});

describe("auditAddressing: layer-2 reachability", () => {
  const shareWarnings = (audit) =>
    audit.issues.filter((issue) => /share a switch/.test(issue.message));

  it("is quiet for hosts in one subnet behind a switch with an in-subnet gateway", () => {
    const audit = auditAddressing({
      nodes: [
        dev("gw", "router", "10.0.1.1", "24"),
        dev("sw", "l2-switch", "10.0.1.2", "24"),
        dev("pc1", "pc", "10.0.1.10", "24"),
        dev("pc2", "pc", "10.0.1.11", "255.255.255.0"),
      ],
      links: [wire("gw", "sw"), wire("sw", "pc1"), wire("sw", "pc2")],
    });
    expect(audit.issues).toEqual([]);
  });

  it("warns once when two hosts on the same switch are in different subnets", () => {
    const audit = auditAddressing({
      nodes: [
        dev("sw", "l2-switch"),
        dev("pc1", "pc", "10.0.1.10", "24"),
        dev("pc2", "pc", "10.0.2.10", "24"),
      ],
      links: [wire("sw", "pc1"), wire("sw", "pc2")],
    });
    expect(audit.issues).toEqual([
      {
        severity: "warn",
        node: "pc1",
        message:
          "pc1 (10.0.1.0/24) and pc2 (10.0.2.0/24) share a switch but not a subnet, so they need a router to talk.",
      },
    ]);
  });

  it("names the VLAN when both hosts are on the same one", () => {
    const audit = auditAddressing({
      nodes: [
        dev("sw", "l2-switch"),
        { ...dev("pc1", "pc", "10.0.1.10", "24"), vlan: "10" },
        { ...dev("pc2", "pc", "10.0.2.10", "24"), vlan: "10" },
      ],
      links: [wire("sw", "pc1"), wire("sw", "pc2")],
    });
    expect(shareWarnings(audit).map((issue) => issue.message)).toEqual([
      "pc1 (10.0.1.0/24) and pc2 (10.0.2.0/24) share a switch and VLAN 10 but not a subnet, so they need a router to talk.",
    ]);
  });

  it("accepts hosts in different subnets when they are on different VLANs", () => {
    const audit = auditAddressing({
      nodes: [
        dev("sw", "l2-switch"),
        { ...dev("pc1", "pc", "10.0.10.21", "24"), vlan: "10" },
        { ...dev("pc2", "laptop", "10.0.30.41", "24"), vlan: "30" },
      ],
      links: [wire("sw", "pc1"), wire("sw", "pc2")],
    });
    expect(audit.issues).toEqual([]);
  });

  it("warns about one subnet split across two VLANs", () => {
    const audit = auditAddressing({
      nodes: [
        dev("sw", "l2-switch"),
        { ...dev("pc1", "pc", "10.0.1.10", "24"), vlan: "10" },
        { ...dev("pc2", "pc", "10.0.1.11", "24"), vlan: "20" },
      ],
      links: [wire("sw", "pc1"), wire("sw", "pc2")],
    });
    expect(audit.issues).toEqual([
      {
        severity: "warn",
        node: "pc1",
        message:
          "pc1 and pc2 are both in 10.0.1.0/24 but on VLANs 10 and 20, so they cannot reach each other.",
      },
    ]);
  });

  it("treats a missing VLAN as matching any VLAN", () => {
    const audit = auditAddressing({
      nodes: [
        dev("sw", "l2-switch"),
        { ...dev("pc1", "pc", "10.0.1.10", "24"), vlan: "10" },
        dev("pc2", "pc", "10.0.2.10", "24"),
      ],
      links: [wire("sw", "pc1"), wire("sw", "pc2")],
    });
    expect(shareWarnings(audit)).toHaveLength(1);
  });

  it("does not compare directly linked hosts (application flows, not a shared segment)", () => {
    const audit = auditAddressing({
      nodes: [
        dev("a", "linux-server", "10.0.1.10", "24"),
        dev("b", "database-server", "10.0.2.10", "24"),
      ],
      links: [wire("a", "b")],
    });
    expect(audit.issues).toEqual([]);
  });

  it("never guesses at gateways: a single-address router may route other subnets", () => {
    const audit = auditAddressing({
      nodes: [dev("gw", "router", "10.0.9.1", "24"), dev("pc", "pc", "10.0.1.10", "24")],
      links: [wire("gw", "pc"), wire("pc", "gw")],
    });
    expect(audit.issues).toEqual([]);
  });

  it.each(["router", "l3-switch", "firewall", "vpn-gateway", "internet", "cloud", "load-balancer"])(
    "stops at a %s instead of treating it as a peer host",
    (type) => {
      const audit = auditAddressing({
        nodes: [
          dev("pc1", "pc", "10.0.1.10", "24"),
          dev("sw", "l2-switch"),
          dev("edge", type, "192.168.0.1", "24"),
          dev("pc2", "pc", "10.0.2.10", "24"),
        ],
        links: [wire("pc1", "sw"), wire("sw", "edge"), wire("edge", "pc2")],
      });
      expect(audit.issues).toEqual([]);
    }
  );

  it("walks through chains of switches and wireless access points", () => {
    const audit = auditAddressing({
      nodes: [
        dev("pc", "pc", "10.0.1.10", "24"),
        dev("sw1", "l2-switch", "10.0.1.2", "24"),
        dev("sw2", "l2-switch"),
        dev("ap", "wireless-ap", "10.0.1.3", "24"),
        dev("laptop", "laptop", "10.0.3.40", "24"),
        dev("gw", "router", "10.0.9.1", "24"),
      ],
      links: [
        wire("pc", "sw1"),
        wire("sw1", "sw2"),
        wire("sw2", "ap"),
        wire("ap", "laptop"),
        wire("sw2", "gw"),
      ],
    });
    expect(audit.issues.map((issue) => issue.message)).toEqual([
      "pc (10.0.1.0/24) and laptop (10.0.3.0/24) share a switch but not a subnet, so they need a router to talk.",
    ]);
  });

  it("ignores a bridge's own management address when comparing hosts", () => {
    const audit = auditAddressing({
      nodes: [
        dev("pc1", "pc", "10.0.1.10", "24"),
        dev("sw", "l2-switch", "192.168.99.2", "24"),
        dev("pc2", "pc", "10.0.1.11", "24"),
      ],
      links: [wire("pc1", "sw"), wire("sw", "pc2")],
    });
    expect(audit.issues).toEqual([]);
  });

  it("does not walk through ordinary hosts", () => {
    const audit = auditAddressing({
      nodes: [
        dev("a", "pc", "10.0.1.10", "24"),
        dev("sw", "l2-switch"),
        dev("b", "linux-server", "10.0.1.11", "24"),
        dev("c", "pc", "10.0.2.10", "24"),
      ],
      links: [wire("a", "sw"), wire("sw", "b"), wire("b", "c")],
    });
    expect(audit.issues).toEqual([]);
  });

  it("copes with switching loops, dangling links and unaddressed neighbours", () => {
    const audit = auditAddressing({
      nodes: [
        dev("pc1", "pc", "10.0.1.10", "24"),
        dev("sw1", "l2-switch"),
        dev("sw2", "l2-switch"),
        dev("printer", "printer"),
        dev("pc2", "pc", "10.0.1.11", "24"),
      ],
      links: [
        wire("pc1", "sw1"),
        wire("sw1", "sw2"),
        wire("sw2", "sw1"),
        wire("sw2", "printer"),
        wire("sw2", "ghost"),
        wire("ghost", "pc2"),
        wire("sw2", "pc2"),
      ],
    });
    expect(audit.issues).toEqual([]);
    expect(audit.unaddressed).toBe(3);
  });

  it("reports a neighbour whose own mask is unusable", () => {
    const audit = auditAddressing({
      nodes: [dev("pc", "pc", "10.0.1.10", "24"), dev("gw", "router", "10.0.9.1", "")],
      links: [wire("pc", "gw")],
    });
    expect(audit.issues.map((issue) => issue.severity)).toEqual(["warn"]);
    expect(audit.issues[0].node).toBe("gw");
  });

  it("reads a prefix written into the address field", () => {
    const audit = auditAddressing({
      nodes: [
        { id: "gw", type: "router", name: "gw", ip: "10.0.0.1/24", subnet: "" },
        { id: "pc", type: "pc", name: "pc", ip: "10.0.0.5/24", subnet: "" },
      ],
      links: [],
    });
    expect(audit.issues).toEqual([]);
    expect(audit.networks.map((network) => [network.text, network.hosts])).toEqual([
      ["10.0.0.0/24", 2],
    ]);
  });

  it("warns when the address's prefix disagrees with the subnet field", () => {
    const audit = auditAddressing({
      nodes: [{ id: "pc", type: "pc", name: "pc", ip: "10.0.0.5/16", subnet: "24" }],
      links: [],
    });
    expect(audit.issues).toEqual([
      {
        severity: "warn",
        node: "pc",
        message: "pc's address says /16 but its subnet is /24; using /24.",
      },
    ]);
    expect(audit.networks[0].text).toBe("10.0.0.0/24");
  });
});

describe("auditAddressing: built-in Network Lab templates", () => {
  const audits = Object.fromEntries(
    Object.entries(NETWORK_TEMPLATES).map(([id, template]) => [id, auditAddressing(template)])
  );

  it("covers every template", () => {
    expect(Object.keys(audits).sort()).toEqual(
      ["blank", "campus", "hybrid", "small-office", "three-tier"].sort()
    );
  });

  it.each(Object.keys(NETWORK_TEMPLATES))("accounts for every device in %s", (id) => {
    const template = NETWORK_TEMPLATES[id];
    const audit = audits[id];
    expect(audit.devices + audit.unaddressed).toBe(template.nodes.length);
    expect(audit.networks.reduce((sum, network) => sum + network.hosts, 0)).toBe(audit.devices);
  });

  // The templates are correct designs, so the audit must not cry wolf on them.
  it.each(Object.keys(NETWORK_TEMPLATES))("raises no issues for the %s template", (id) => {
    expect(audits[id].issues).toEqual([]);
  });

  it("reports nothing for the blank template", () => {
    expect(audits.blank).toEqual({ networks: [], issues: [], devices: 0, unaddressed: 0 });
  });

  it("summarises the small office's networks", () => {
    expect(audits["small-office"].devices).toBe(9);
    expect(audits["small-office"].unaddressed).toBe(1);
    expect(
      audits["small-office"].networks.map((network) => [
        network.text,
        network.hosts,
        network.capacity,
      ])
    ).toEqual([
      ["192.168.10.0/24", 8, 254],
      ["203.0.113.0/30", 1, 2],
    ]);
  });

  it("keeps the campus VLANs apart rather than flagging them", () => {
    const networks = audits.campus.networks.map((network) => network.text);
    expect(networks).toEqual(expect.arrayContaining(["10.0.10.0/24", "10.0.30.0/24"]));
  });

  it("treats the hybrid cloud's /16 as a summary of the subnets behind it", () => {
    const cloud = audits.hybrid.networks.find((network) => network.text === "10.80.0.0/16");
    expect(cloud).toMatchObject({ external: true });
    expect(
      audits.hybrid.networks.find((network) => network.text === "169.254.20.0/30")
    ).toMatchObject({ hosts: 2, capacity: 2 });
  });

  it("still flags a genuine LAN overlap next to a cloud summary", () => {
    const audit = auditAddressing({
      nodes: [
        dev("cloud", "cloud", "10.80.0.1", "16"),
        dev("a", "pc", "10.80.1.10", "24"),
        dev("b", "pc", "10.80.1.20", "25"),
      ],
      links: [],
    });
    expect(audit.issues.map((issue) => issue.message)).toEqual([
      "10.80.1.0/24 and 10.80.1.0/25 overlap: devices in them disagree about who is on-link (check the masks).",
    ]);
  });
});

describe("Availability Zones per region", () => {
  it("uses the region's real AZ letters where they skip one", () => {
    const azs = (region) => [
      ...new Set(planVpc({ ...DEFAULT_PLAN, region, spareAzs: 0 }).subnets.map((s) => s.az)),
    ];
    expect(azs("ca-central-1")).toEqual(["ca-central-1a", "ca-central-1b", "ca-central-1d"]);
    expect(azs("ap-northeast-1")).toEqual([
      "ap-northeast-1a",
      "ap-northeast-1c",
      "ap-northeast-1d",
    ]);
    expect(azs("us-east-1")).toEqual(["us-east-1a", "us-east-1b", "us-east-1c"]);
  });

  it("warns when a plan uses more AZs than the region has", () => {
    const plan = planVpc({ ...DEFAULT_PLAN, region: "eu-west-1", azs: 4, spareAzs: 0 });
    expect(plan.warnings).toContain(
      "eu-west-1 has 3 Availability Zones, but this plan uses 4; the extra subnets cannot be created there."
    );
  });

  it("warns when spare AZ reservations exceed what the region offers", () => {
    const plan = planVpc({ ...DEFAULT_PLAN, region: "eu-west-1", azs: 3, spareAzs: 2 });
    expect(plan.warnings).toContain(
      "eu-west-1 has 3 Availability Zones, so 2 of the spare AZ reservations can never be used there."
    );
    expect(planVpc({ ...DEFAULT_PLAN, region: "us-east-1", azs: 3, spareAzs: 2 }).warnings).toEqual(
      []
    );
  });

  it("assumes three AZs for regions it does not know", () => {
    const plan = planVpc({ ...DEFAULT_PLAN, region: "xx-test-9", azs: 4, spareAzs: 0 });
    expect(plan.warnings[0]).toMatch(/^xx-test-9 has 3 Availability Zones in most accounts/);
    expect([...new Set(plan.subnets.map((subnet) => subnet.az))]).toEqual([
      "xx-test-9a",
      "xx-test-9b",
      "xx-test-9c",
      "xx-test-9d",
    ]);
  });

  it("makes NAT gateways wait for the internet gateway", () => {
    const tf = vpcTerraform(planVpc(DEFAULT_PLAN));
    const nats = tf.split("resource ").filter((block) => block.startsWith('"aws_nat_gateway"'));
    expect(nats).toHaveLength(3);
    for (const block of nats) expect(block).toContain("depends_on = [aws_internet_gateway.main]");
    expect(tf).toContain('data "aws_availability_zones" "available"');
  });
});

describe("checkCidrs: several blocks on one line", () => {
  it("checks every CIDR on a comma-separated line", () => {
    const result = checkCidrs("10.0.0.0/16, 10.0.1.0/24");
    expect(result.entries.map((entry) => entry.text)).toEqual(["10.0.0.0/16", "10.0.1.0/24"]);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toEqual([
      "10.0.1.0/24 sits inside 10.0.0.0/16.",
    ]);
  });

  it("accepts spaces around the slash and keeps the words as the label", () => {
    const result = checkCidrs("10.0.0.0 / 16 prod vpc");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ text: "10.0.0.0/16", label: "prod vpc" });
  });
});

// ----------------------------------------------------------- vpcBlueprint

describe("vpcBlueprint", () => {
  it("returns null for missing or failed plans", () => {
    expect(vpcBlueprint(null)).toBeNull();
    expect(vpcBlueprint(undefined)).toBeNull();
    expect(vpcBlueprint({ vpc: null })).toBeNull();
    expect(vpcBlueprint(planVpc({ cidr: "nope" }))).toBeNull();
    expect(
      vpcBlueprint(planVpc({ cidr: "10.0.0.0/24", azs: 3, tiers: [{ name: "A", prefix: 24 }] }))
    ).toBeNull();
  });

  const plan = planVpc(DEFAULT_PLAN);
  const blueprint = vpcBlueprint(plan);

  it("names the diagram and region", () => {
    expect(blueprint.name).toBe("VPC plan 10.0.0.0/16");
    expect(blueprint.region).toBe("us-east-1");
    expect(vpcBlueprint(plan, { name: "Prod network" }).name).toBe("Prod network");
  });

  it("nests cloud → region → VPC → AZ → subnet groups", () => {
    const [cloud, region, vpc] = blueprint.groups;
    expect(cloud).toMatchObject({ key: "cloud", preset: "aws-cloud" });
    expect(cloud.parent).toBeUndefined();
    expect(region).toMatchObject({
      key: "region",
      preset: "region",
      label: "Region us-east-1",
      parent: "cloud",
    });
    expect(vpc).toMatchObject({
      key: "vpc",
      preset: "vpc",
      label: "VPC 10.0.0.0/16",
      parent: "region",
    });

    const azGroups = blueprint.groups.filter((group) => group.preset === "availability-zone");
    expect(azGroups.map((group) => [group.key, group.label, group.parent])).toEqual([
      ["az-0", "Availability Zone us-east-1a", "vpc"],
      ["az-1", "Availability Zone us-east-1b", "vpc"],
      ["az-2", "Availability Zone us-east-1c", "vpc"],
    ]);

    const subnets = blueprint.groups.filter((group) => group.key.startsWith("subnet-"));
    expect(subnets).toHaveLength(9);
    expect(blueprint.groups).toHaveLength(3 + 3 + 9);
    expect(subnets.find((group) => group.key === "subnet-0-0")).toMatchObject({
      preset: "public-subnet",
      label: "Public 10.0.64.0/24",
      parent: "az-0",
    });
    expect(subnets.find((group) => group.key === "subnet-1-2")).toMatchObject({
      preset: "private-subnet",
      label: "App 10.0.32.0/20",
      parent: "az-2",
    });
    const data = subnets.find((group) => group.key === "subnet-2-1");
    expect(data).toMatchObject({
      preset: "private-subnet",
      zone: "data",
      label: "Data 10.0.69.0/24",
    });
    expect(subnets.find((group) => group.key === "subnet-1-1").zone).toBeUndefined();
  });

  it("does not draw spare AZ reservations", () => {
    expect(blueprint.groups.some((group) => /us-east-1d/.test(group.label || ""))).toBe(false);
    expect(blueprint.groups.some((group) => /10\.0\.48\.0/.test(group.label || ""))).toBe(false);
  });

  it("keeps every key unique and every parent resolvable", () => {
    const keys = [...blueprint.groups, ...blueprint.nodes].map((item) => item.key);
    expect(duplicates(keys)).toEqual([]);
    const groupKeys = new Set(blueprint.groups.map((group) => group.key));
    for (const item of [...blueprint.groups, ...blueprint.nodes, ...blueprint.shapes]) {
      if (item.parent) expect(groupKeys.has(item.parent)).toBe(true);
    }
    for (const link of blueprint.links) {
      expect(keys).toContain(link.from);
      expect(keys).toContain(link.to);
    }
  });

  it("places each subnet inside its AZ column, public on top and isolated at the bottom", () => {
    const reordered = vpcBlueprint(
      planVpc({
        ...tieredPlan(),
        tiers: [
          { name: "Data", kind: "data", prefix: 24 },
          { name: "App", kind: "private", prefix: 20 },
          { name: "Public", kind: "public", prefix: 24 },
        ],
      })
    );
    const group = (key) => reordered.groups.find((candidate) => candidate.key === key);
    // Tier indexes: Data 0, App 1, Public 2.
    expect(group("subnet-2-0").y).toBeLessThan(group("subnet-1-0").y);
    expect(group("subnet-1-0").y).toBeLessThan(group("subnet-0-0").y);
    for (const subnet of reordered.groups.filter((candidate) =>
      candidate.key.startsWith("subnet-")
    )) {
      const az = group(subnet.parent);
      expect(subnet.x).toBeGreaterThanOrEqual(az.x);
      expect(subnet.x + subnet.w).toBeLessThanOrEqual(az.x + az.w);
      expect(subnet.y).toBeGreaterThanOrEqual(az.y);
      expect(subnet.y + subnet.h).toBeLessThanOrEqual(az.y + az.h);
    }
    const vpc = group("vpc");
    for (const az of reordered.groups.filter((candidate) => candidate.key.startsWith("az-"))) {
      expect(az.x + az.w).toBeLessThanOrEqual(vpc.x + vpc.w);
      expect(az.y + az.h).toBeLessThanOrEqual(vpc.y + vpc.h);
    }
  });

  it("draws one NAT gateway per AZ in the public subnets by default", () => {
    const nats = blueprint.nodes.filter((node) => node.service === "Amazon VPC NAT Gateway");
    expect(nats.map((node) => [node.key, node.name, node.parent])).toEqual([
      ["nat-0", "NAT us-east-1a", "subnet-0-0"],
      ["nat-1", "NAT us-east-1b", "subnet-0-1"],
      ["nat-2", "NAT us-east-1c", "subnet-0-2"],
    ]);
    expect(nats[0].notes).toBe("251 usable addresses in 10.0.64.0/24.");
  });

  it("draws a single NAT gateway in the first AZ", () => {
    const single = vpcBlueprint(planVpc({ ...DEFAULT_PLAN, natGateways: "single" }));
    const nats = single.nodes.filter((node) => node.service === "Amazon VPC NAT Gateway");
    expect(nats.map((node) => node.key)).toEqual(["nat-0"]);
    expect(nats[0].parent).toBe("subnet-0-0");
  });

  it("draws no NAT gateway when disabled or when nothing is private", () => {
    const none = vpcBlueprint(planVpc({ ...DEFAULT_PLAN, natGateways: "none" }));
    expect(none.nodes.map((node) => node.key)).toEqual(["igw", "internet"]);

    const isolatedOnly = vpcBlueprint(
      planVpc({
        ...tieredPlan(),
        tiers: [
          { name: "Public", kind: "public", prefix: 24 },
          { name: "Data", kind: "data", prefix: 24 },
        ],
      })
    );
    expect(isolatedOnly.nodes.map((node) => node.key)).toEqual(["igw", "internet"]);
  });

  it("connects the internet to the internet gateway only when there is a public tier", () => {
    expect(blueprint.nodes.find((node) => node.key === "igw")).toMatchObject({
      service: "Amazon VPC Internet Gateway",
      parent: "vpc",
      zone: "edge",
    });
    expect(blueprint.nodes.find((node) => node.key === "internet")).toMatchObject({
      zone: "internet",
    });
    expect(blueprint.links).toEqual([{ from: "internet", to: "igw", label: "0.0.0.0/0" }]);

    const privateOnly = vpcBlueprint(
      planVpc({
        ...tieredPlan(),
        tiers: [
          { name: "App", kind: "private", prefix: 20 },
          { name: "Data", kind: "data", prefix: 24 },
        ],
      })
    );
    expect(privateOnly.nodes).toEqual([]);
    expect(privateOnly.links).toEqual([]);
    expect(privateOnly.groups).toHaveLength(3 + 3 + 6);
  });

  it("adds a summary note under the VPC", () => {
    expect(blueprint.shapes).toHaveLength(1);
    expect(blueprint.shapes[0]).toMatchObject({ kind: "note", parent: "region" });
    expect(blueprint.shapes[0].label).toBe(
      `9 subnets across 3 AZs · ${(13779).toLocaleString()} usable IPs · 21% of 10.0.0.0/16 allocated · 3 blocks reserved for 1 more AZ.`
    );
  });

  it("uses singular wording and omits reservations when there are none", () => {
    const one = vpcBlueprint(planVpc({ ...tieredPlan(), azs: 1, spareAzs: 0 }));
    expect(one.shapes[0].label).toMatch(/^3 subnets across 1 AZ · /);
    expect(one.shapes[0].label).not.toMatch(/reserved/);

    const two = vpcBlueprint(planVpc({ ...tieredPlan(), azs: 2, spareAzs: 2 }));
    expect(two.shapes[0].label).toMatch(/ · 6 blocks reserved for 2 more AZs\.$/);
  });

  it("widens the VPC with the AZ count", () => {
    const narrow = vpcBlueprint(planVpc({ ...tieredPlan(), azs: 2 }));
    const wide = vpcBlueprint(planVpc({ ...tieredPlan(), azs: 4 }));
    const width = (bp) => bp.groups.find((group) => group.key === "vpc").w;
    expect(width(wide)).toBeGreaterThan(width(narrow));
  });

  it("draws exactly one NAT gateway per AZ even with two public tiers", () => {
    const plan2 = planVpc({
      ...tieredPlan(),
      tiers: [
        { name: "Public", kind: "public", prefix: 24 },
        { name: "Edge", kind: "public", prefix: 26 },
        { name: "App", kind: "private", prefix: 20 },
      ],
    });
    const drawn = vpcBlueprint(plan2);
    const keys = [...drawn.groups, ...drawn.nodes].map((item) => item.key);
    expect(duplicates(keys)).toEqual([]);
    expect(drawn.nodes.filter((node) => node.service === "Amazon VPC NAT Gateway")).toHaveLength(3);
  });
});

// ----------------------------------------------------------- vpcTerraform

describe("vpcTerraform", () => {
  it("returns an empty string for missing or failed plans", () => {
    expect(vpcTerraform(null)).toBe("");
    expect(vpcTerraform(undefined)).toBe("");
    expect(vpcTerraform({ vpc: null })).toBe("");
    expect(vpcTerraform(planVpc({ cidr: "10.0.0.0/8", tiers: [{ name: "A", prefix: 24 }] }))).toBe(
      ""
    );
  });

  const plan = planVpc(DEFAULT_PLAN);
  const tf = vpcTerraform(plan);
  const resources = tfResources(tf);
  const byType = (type) => resources.filter((resource) => resource.type === type);

  it("starts with a header comment and ends with exactly one newline", () => {
    expect(tf.split("\n")[0]).toBe(
      "# 10.0.0.0/16 in us-east-1 — generated by Trust Choreography's VPC Planner"
    );
    expect(tf.endsWith("}\n")).toBe(true);
    expect(tf.endsWith("\n\n")).toBe(false);
  });

  it("has balanced braces", () => {
    expect(braceBalance(tf)).toEqual({ depth: 0, neverNegative: true });
  });

  it("declares the VPC with DNS enabled", () => {
    const [vpc] = byType("aws_vpc");
    expect(vpc.name).toBe("main");
    expect(vpc.body).toContain('cidr_block           = "10.0.0.0/16"');
    expect(vpc.body).toContain("enable_dns_support   = true");
    expect(vpc.body).toContain("enable_dns_hostnames = true");
    expect(vpc.body).toContain('tags = { Name = "main" }');
  });

  it("declares one subnet per planned subnet and none for spare AZs", () => {
    const subnets = byType("aws_subnet");
    expect(subnets.map((subnet) => subnet.name)).toEqual([
      "public_a",
      "public_b",
      "public_c",
      "app_a",
      "app_b",
      "app_c",
      "data_a",
      "data_b",
      "data_c",
    ]);
    for (const subnet of plan.subnets) {
      expect(tf).toContain(`cidr_block        = "${subnet.text}"`);
      expect(tf).toContain(
        `availability_zone = data.aws_availability_zones.available.names[${subnet.azIndex}] # planned as ${subnet.az}`
      );
    }
    for (const reserved of plan.reserved) expect(tf).not.toContain(reserved.text);
    expect(subnets[3].body).toContain('tags = { Name = "main-app-us-east-1a", Tier = "App" }');
  });

  it("maps public IPs on launch only in public subnets", () => {
    for (const subnet of byType("aws_subnet")) {
      expect(subnet.body.includes("map_public_ip_on_launch = true")).toBe(
        subnet.name.startsWith("public_")
      );
    }
    expect(tf.match(/map_public_ip_on_launch/g)).toHaveLength(3);
  });

  it("routes public subnets to an internet gateway", () => {
    expect(byType("aws_internet_gateway").map((resource) => resource.name)).toEqual(["main"]);
    const publicTable = byType("aws_route_table").find((table) => table.name === "public");
    expect(publicTable.body).toMatch(
      /cidr_block = "0\.0\.0\.0\/0"\n\s+gateway_id = aws_internet_gateway\.main\.id/
    );
    const associations = byType("aws_route_table_association").filter((association) =>
      association.body.includes("aws_route_table.public.id")
    );
    expect(associations.map((association) => association.name)).toEqual([
      "public_a",
      "public_b",
      "public_c",
    ]);
  });

  it("creates a NAT gateway and elastic IP per AZ and routes each private subnet to its own AZ's NAT", () => {
    expect(byType("aws_eip").map((resource) => resource.name)).toEqual(["nat_a", "nat_b", "nat_c"]);
    expect(byType("aws_eip")[0].body).toContain('domain = "vpc"');
    const nats = byType("aws_nat_gateway");
    expect(nats.map((resource) => resource.name)).toEqual(["a", "b", "c"]);
    expect(nats[1].body).toContain("allocation_id = aws_eip.nat_b.id");
    expect(nats[1].body).toContain("subnet_id     = aws_subnet.public_b.id");

    const privateTables = byType("aws_route_table").filter((table) => table.name !== "public");
    expect(privateTables.map((table) => table.name)).toEqual(["app_a", "app_b", "app_c"]);
    for (const table of privateTables) {
      const az = table.name.slice(-1);
      expect(table.body).toContain(`nat_gateway_id = aws_nat_gateway.${az}.id`);
    }
  });

  it("leaves isolated subnets without a route to the internet", () => {
    expect(tf).not.toMatch(/aws_route_table" "data_/);
    expect(tf).not.toMatch(/aws_route_table_association" "data_/);
  });

  it("only references resources it declares, and declares each address once", () => {
    const declared = resources.map((resource) => resource.address);
    expect(duplicates(declared)).toEqual([]);
    const references = [...tf.matchAll(/\b(aws_[a-z_]+\.[a-z0-9_]+)\.id\b/g)].map(
      (match) => match[1]
    );
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(declared).toContain(reference);
  });

  it("routes every private subnet through one NAT gateway in single mode", () => {
    const single = vpcTerraform(planVpc({ ...DEFAULT_PLAN, natGateways: "single" }));
    const singleResources = tfResources(single);
    expect(singleResources.filter((r) => r.type === "aws_nat_gateway").map((r) => r.name)).toEqual([
      "a",
    ]);
    expect(singleResources.filter((r) => r.type === "aws_eip").map((r) => r.name)).toEqual([
      "nat_a",
    ]);
    expect(single.match(/nat_gateway_id = aws_nat_gateway\.a\.id/g)).toHaveLength(3);
    expect(single).not.toContain("aws_nat_gateway.b");
    expect(braceBalance(single)).toEqual({ depth: 0, neverNegative: true });
  });

  it("creates no NAT gateways or private routes when NAT is disabled", () => {
    const none = vpcTerraform(planVpc({ ...DEFAULT_PLAN, natGateways: "none" }));
    expect(none).not.toContain("aws_nat_gateway");
    expect(none).not.toContain("aws_eip");
    expect(
      tfResources(none)
        .filter((r) => r.type === "aws_route_table")
        .map((r) => r.name)
    ).toEqual(["public"]);
    expect(none).toContain('resource "aws_internet_gateway" "main"');
  });

  it("creates no internet gateway, public route table or NAT without a public tier", () => {
    const privateOnly = vpcTerraform(
      planVpc({
        ...tieredPlan(),
        tiers: [
          { name: "App", kind: "private", prefix: 20 },
          { name: "Data", kind: "data", prefix: 24 },
        ],
      })
    );
    expect(privateOnly).not.toContain("aws_internet_gateway");
    expect(privateOnly).not.toContain("aws_route_table");
    expect(privateOnly).not.toContain("aws_nat_gateway");
    expect(privateOnly).not.toContain("map_public_ip_on_launch");
    expect(tfResources(privateOnly).filter((r) => r.type === "aws_subnet")).toHaveLength(6);
    expect(braceBalance(privateOnly)).toEqual({ depth: 0, neverNegative: true });
  });

  it("creates no NAT when there is nothing private to route", () => {
    const publicOnly = vpcTerraform(
      planVpc({ ...tieredPlan(), tiers: [{ name: "Web", kind: "public", prefix: 24 }] })
    );
    expect(publicOnly).toContain("aws_internet_gateway");
    expect(publicOnly).not.toContain("aws_nat_gateway");
  });

  it("derives a safe resource name from the name option and keeps it in tags", () => {
    const named = vpcTerraform(plan, { name: "Prod VPC!" });
    expect(named).toContain('resource "aws_vpc" "prod_vpc" {');
    expect(named).toContain("vpc_id            = aws_vpc.prod_vpc.id");
    expect(named).toContain('tags = { Name = "Prod VPC!" }');
    expect(named).toContain('Name = "Prod VPC!-public-us-east-1a"');
    expect(named).toContain('resource "aws_internet_gateway" "prod_vpc"');
    expect(vpcTerraform(plan, { name: "***" })).toContain('resource "aws_vpc" "subnet" {');
  });

  it("uses the region's AZ letters and snake-cased tier names", () => {
    const eu = vpcTerraform(
      planVpc({
        ...tieredPlan(),
        region: "eu-central-1",
        azs: 2,
        tiers: [
          { name: "Web Tier", kind: "public", prefix: 24 },
          { name: "App-Servers", kind: "private", prefix: 22 },
        ],
      })
    );
    expect(eu).toContain('resource "aws_subnet" "web_tier_a"');
    expect(eu).toContain('resource "aws_subnet" "app_servers_b"');
    expect(eu).toContain(
      "availability_zone = data.aws_availability_zones.available.names[1] # planned as eu-central-1b"
    );
    expect(eu).toContain("nat_gateway_id = aws_nat_gateway.b.id");
  });

  it("stays well-formed for random valid plans", () => {
    const random = mulberry32(77);
    const kinds = ["public", "private", "data"];
    const nat = ["per-az", "single", "none"];
    let checked = 0;
    for (let round = 0; round < 80; round += 1) {
      const tiers = ["Alpha", "Bravo", "Charlie"]
        .slice(0, 1 + Math.floor(random() * 3))
        .map((name) => ({
          name,
          kind: kinds[Math.floor(random() * 3)],
          prefix: 20 + Math.floor(random() * 9),
        }));
      const candidate = planVpc({
        cidr: "10.10.0.0/16",
        azs: 1 + Math.floor(random() * 6),
        tiers,
        natGateways: nat[Math.floor(random() * 3)],
      });
      if (candidate.errors.length) continue;
      checked += 1;
      const out = vpcTerraform(candidate);
      expect(braceBalance(out)).toEqual({ depth: 0, neverNegative: true });
      const found = tfResources(out);
      const declared = found.map((resource) => resource.address);
      expect(duplicates(declared)).toEqual([]);
      for (const [, reference] of out.matchAll(/\b(aws_[a-z_]+\.[a-z0-9_]+)\.id\b/g)) {
        expect(declared).toContain(reference);
      }
      expect(found.filter((resource) => resource.type === "aws_subnet")).toHaveLength(
        candidate.subnets.length
      );
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("declares one NAT gateway per AZ even with two public tiers", () => {
    const out = vpcTerraform(
      planVpc({
        ...tieredPlan(),
        tiers: [
          { name: "Public", kind: "public", prefix: 24 },
          { name: "Edge", kind: "public", prefix: 26 },
          { name: "App", kind: "private", prefix: 20 },
        ],
      })
    );
    const found = tfResources(out);
    expect(duplicates(found.map((resource) => resource.address))).toEqual([]);
    expect(found.filter((resource) => resource.type === "aws_nat_gateway")).toHaveLength(3);
    expect(found.filter((resource) => resource.type === "aws_eip")).toHaveLength(3);
  });

  it("never emits two resources with the same address when tier names normalise alike", () => {
    const collision = planVpc({
      ...tieredPlan(),
      tiers: [
        { name: "Public", kind: "public", prefix: 24 },
        { name: "App", kind: "private", prefix: 24 },
        { name: "app", kind: "private", prefix: 24 },
      ],
    });
    const out = vpcTerraform(collision);
    // Either the planner rejects the clash, or the Terraform keeps addresses unique.
    const clashes = duplicates(tfResources(out).map((resource) => resource.address));
    expect(collision.errors.length > 0 || clashes.length === 0).toBe(true);
  });
});
