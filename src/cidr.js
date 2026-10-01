/**
 * IPv4 CIDR arithmetic and VPC subnet planning.
 *
 *  - parse, format, contain and overlap checks for CIDR blocks,
 *  - `planVpc`: carve a VPC into per-AZ subnets for each tier (public, app,
 *    data…) with AWS's five reserved addresses taken into account, leaving
 *    the rest as free blocks you can see and grow into,
 *  - `checkCidrs`: find overlaps, duplicates and misaligned blocks in any
 *    list (peered VPCs, on-prem ranges, Transit Gateway attachments),
 *  - `auditAddressing`: the same checks for the devices in the Network Lab,
 *  - `vpcBlueprint` / `vpcTerraform`: draw the plan in AWS Studio or write it
 *    out as Terraform.
 *
 * Addresses are handled as unsigned 32-bit numbers. Pure — no DOM.
 */

export const AWS_RESERVED = 5;
export const VPC_MIN_PREFIX = 16;
export const VPC_MAX_PREFIX = 28;

export const TIER_KINDS = {
  public: { label: "Public", preset: "public-subnet", zone: "public" },
  private: { label: "Private", preset: "private-subnet", zone: "private" },
  data: { label: "Isolated", preset: "private-subnet", zone: "data" },
};

export const DEFAULT_PLAN = {
  cidr: "10.0.0.0/16",
  region: "us-east-1",
  azs: 3,
  spareAzs: 1,
  natGateways: "per-az",
  tiers: [
    { name: "Public", kind: "public", prefix: 24 },
    { name: "App", kind: "private", prefix: 20 },
    { name: "Data", kind: "data", prefix: 24 },
  ],
};

const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];

// ------------------------------------------------------------ primitives

export function parseIp(text) {
  const parts = String(text ?? "")
    .trim()
    .split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function formatIp(value) {
  const n = Math.trunc(value) >>> 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export const blockSize = (prefix) => 2 ** (32 - prefix);

/** Prefix length from "24", "/24" or a dotted mask ("255.255.255.0"); null when invalid. */
export function prefixFromMask(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^\//, "");
  if (/^\d{1,2}$/.test(text)) {
    const prefix = Number(text);
    return prefix <= 32 ? prefix : null;
  }
  const mask = parseIp(text);
  if (mask === null) return null;
  const inverted = ~mask >>> 0;
  // A valid mask is ones then zeros: its inverse plus one is a power of two.
  if ((inverted & (inverted + 1)) !== 0) return null;
  return 32 - Math.round(Math.log2(inverted + 1));
}

/**
 * Parse "10.0.1.0/24". A block with host bits set is still parsed (to the
 * network it lies in) but flagged `aligned: false`, since AWS and most
 * routers reject it.
 */
export function parseCidr(text) {
  const input = String(text ?? "").trim();
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})$/.exec(input);
  if (!match) return { input, error: `“${input}” is not a CIDR block — expected a.b.c.d/nn` };
  const address = parseIp(match[1]);
  const prefix = Number(match[2]);
  if (address === null) return { input, error: `“${match[1]}” is not an IPv4 address` };
  if (prefix > 32) return { input, error: `/${prefix} is not a prefix length (0–32)` };
  const size = blockSize(prefix);
  const network = Math.floor(address / size) * size;
  return {
    input,
    network,
    prefix,
    size,
    last: network + size - 1,
    aligned: network === address,
    text: `${formatIp(network)}/${prefix}`,
  };
}

export function cidrText(network, prefix) {
  return `${formatIp(network)}/${prefix}`;
}

export const contains = (outer, inner) =>
  inner.network >= outer.network && inner.last <= outer.last;

export const overlaps = (a, b) => a.network <= b.last && b.network <= a.last;

export function isPrivate(block) {
  return PRIVATE_RANGES.some((range) => contains(parseCidr(range), block));
}

/** Usable addresses in an AWS subnet (five are reserved in every one). */
export function awsUsable(prefix) {
  return Math.max(0, blockSize(prefix) - AWS_RESERVED);
}

/** Smallest subnet prefix whose AWS-usable address count holds `hosts`. */
export function prefixForHosts(hosts) {
  for (let prefix = VPC_MAX_PREFIX; prefix >= VPC_MIN_PREFIX; prefix -= 1) {
    if (awsUsable(prefix) >= hosts) return prefix;
  }
  return null;
}

/**
 * Cover the addresses from `start` to `end` (inclusive) with the fewest
 * aligned CIDR blocks.
 */
export function rangeToCidrs(start, end) {
  const blocks = [];
  let cursor = start;
  while (cursor <= end) {
    let prefix = 32;
    while (prefix > 0) {
      const size = blockSize(prefix - 1);
      if (cursor % size !== 0 || cursor + size - 1 > end) break;
      prefix -= 1;
    }
    blocks.push(parseCidr(cidrText(cursor, prefix)));
    cursor += blockSize(prefix);
  }
  return blocks;
}

/** Merge blocks into the fewest CIDRs covering exactly the same addresses. */
export function summarize(blocks) {
  const sorted = blocks
    .filter((block) => block && !block.error)
    .map((block) => [block.network, block.last])
    .sort((a, b) => a[0] - b[0]);
  const ranges = [];
  for (const [start, end] of sorted) {
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  return ranges.flatMap(([start, end]) => rangeToCidrs(start, end));
}

// --------------------------------------------------------------- planning

/**
 * Availability Zone letters for regions whose zones are not simply a, b, c…
 * and how many each region offers. Unlisted regions are assumed to have
 * three, lettered from a.
 */
export const REGION_AZS = {
  "us-east-1": "abcdef",
  "us-east-2": "abc",
  "us-west-1": "ab",
  "us-west-2": "abcd",
  "ca-central-1": "abd",
  "sa-east-1": "abc",
  "eu-west-1": "abc",
  "eu-west-2": "abc",
  "eu-west-3": "abc",
  "eu-central-1": "abc",
  "eu-north-1": "abc",
  "eu-south-1": "abc",
  "ap-south-1": "abc",
  "ap-southeast-1": "abc",
  "ap-southeast-2": "abc",
  "ap-northeast-1": "acd",
  "ap-northeast-2": "abcd",
  "ap-northeast-3": "abc",
};

const regionLetters = (region) => REGION_AZS[region] || "abc";

function azName(region, index) {
  const letters = regionLetters(region);
  if (index < letters.length) return `${region}${letters[index]}`;
  // Past the known zones: keep counting letters after the last one.
  return `${region}${String.fromCharCode(letters.charCodeAt(letters.length - 1) + index - letters.length + 1)}`;
}

/**
 * Carve a VPC into subnets.
 *
 * Every tier gets one subnet per AZ at its prefix length. Blocks are packed
 * largest first so each lands on its natural boundary with no gaps; spare AZs
 * (room to add an AZ later without renumbering) are reserved the same way.
 *
 * @param {{cidr: string, region?: string, azs: number, spareAzs?: number,
 *   tiers: {name: string, kind: string, prefix: number}[]}} input
 */
export function planVpc(input) {
  const errors = [];
  const warnings = [];
  const region = String(input?.region || "us-east-1").trim() || "us-east-1";
  const azs = Math.min(6, Math.max(1, Math.trunc(Number(input?.azs) || 1)));
  const spareAzs = Math.min(6 - azs, Math.max(0, Math.trunc(Number(input?.spareAzs) || 0)));
  const vpc = parseCidr(input?.cidr);
  const tiers = (input?.tiers || [])
    .map((tier, index) => ({
      name:
        String(tier.name || `Tier ${index + 1}`)
          .trim()
          .slice(0, 40) || `Tier ${index + 1}`,
      kind: TIER_KINDS[tier.kind] ? tier.kind : "private",
      prefix: Math.trunc(Number(tier.prefix)),
      index,
    }))
    .filter((tier) => Number.isFinite(tier.prefix));

  if (vpc.error) {
    return {
      vpc: null,
      subnets: [],
      reserved: [],
      free: [],
      errors: [vpc.error],
      warnings,
      azs,
      region,
      tiers,
    };
  }
  if (!vpc.aligned) {
    warnings.push(`${vpc.input} has host bits set — using ${vpc.text}.`);
  }
  if (vpc.prefix < VPC_MIN_PREFIX || vpc.prefix > VPC_MAX_PREFIX) {
    errors.push(
      `A VPC block must be between /${VPC_MIN_PREFIX} and /${VPC_MAX_PREFIX} (got /${vpc.prefix}).`
    );
  }
  if (!isPrivate(vpc)) {
    warnings.push(
      `${vpc.text} is not in an RFC 1918 private range, so it may clash with real internet addresses.`
    );
  }
  if (overlaps(vpc, parseCidr("172.17.0.0/16"))) {
    warnings.push(
      "172.17.0.0/16 is Docker's default bridge network; services such as SageMaker and Cloud9 can misroute inside it."
    );
  }
  if (!tiers.length) errors.push("Add at least one subnet tier.");
  for (const tier of tiers) {
    if (tier.prefix < vpc.prefix) {
      errors.push(
        `${tier.name} subnets (/${tier.prefix}) are larger than the VPC (/${vpc.prefix}).`
      );
    } else if (tier.prefix > VPC_MAX_PREFIX || tier.prefix < VPC_MIN_PREFIX) {
      errors.push(`${tier.name}: AWS subnets must be /${VPC_MIN_PREFIX} to /${VPC_MAX_PREFIX}.`);
    }
  }
  if (errors.length)
    return { vpc, subnets: [], reserved: [], free: [], errors, warnings, azs, region, tiers };

  const requests = [];
  for (const tier of tiers) {
    for (let az = 0; az < azs + spareAzs; az += 1) {
      requests.push({ tier, az, spare: az >= azs });
    }
  }
  // Largest first, then tier order, then AZ order: keeps each tier's AZs adjacent.
  requests.sort(
    (a, b) => a.tier.prefix - b.tier.prefix || a.tier.index - b.tier.index || a.az - b.az
  );

  const needed = requests.reduce((sum, request) => sum + blockSize(request.tier.prefix), 0);
  if (needed > vpc.size) {
    const inUse = requests
      .filter((request) => !request.spare)
      .reduce((sum, r) => sum + blockSize(r.tier.prefix), 0);
    errors.push(
      inUse > vpc.size
        ? `These tiers need ${needed.toLocaleString()} addresses${spareAzs ? " including spare AZs" : ""}, but ${vpc.text} only has ${vpc.size.toLocaleString()}. Use a larger VPC or smaller subnets.`
        : `The spare AZ capacity does not fit in ${vpc.text}. Reduce spare AZs or subnet sizes.`
    );
    return { vpc, subnets: [], reserved: [], free: [], errors, warnings, azs, region, tiers };
  }

  let cursor = vpc.network;
  const subnets = [];
  const reserved = [];
  for (const request of requests) {
    const size = blockSize(request.tier.prefix);
    const network = Math.ceil(cursor / size) * size;
    const block = parseCidr(cidrText(network, request.tier.prefix));
    const entry = {
      ...block,
      tier: request.tier.name,
      kind: request.tier.kind,
      tierIndex: request.tier.index,
      az: azName(region, request.az),
      azIndex: request.az,
      usable: awsUsable(request.tier.prefix),
      firstUsable: formatIp(network + 4),
      lastUsable: formatIp(network + size - 2),
      router: formatIp(network + 1),
    };
    (request.spare ? reserved : subnets).push(entry);
    cursor = network + size;
  }
  const byAddress = (a, b) => a.network - b.network;
  subnets.sort((a, b) => a.tierIndex - b.tierIndex || a.azIndex - b.azIndex);
  reserved.sort(byAddress);

  const used = [...subnets, ...reserved].sort(byAddress);
  const free = [];
  let next = vpc.network;
  for (const block of used) {
    if (block.network > next) free.push(...rangeToCidrs(next, block.network - 1));
    next = block.last + 1;
  }
  if (next <= vpc.last) free.push(...rangeToCidrs(next, vpc.last));

  const allocated = subnets.reduce((sum, subnet) => sum + subnet.size, 0);
  const usable = subnets.reduce((sum, subnet) => sum + subnet.usable, 0);
  const available = regionLetters(region).length;
  if (azs > available) {
    warnings.push(
      `${region} has ${available} Availability Zones${REGION_AZS[region] ? "" : " in most accounts"}, but this plan uses ${azs}; the extra subnets cannot be created there.`
    );
  } else if (azs + spareAzs > available) {
    warnings.push(
      `${region} has ${available} Availability Zones${REGION_AZS[region] ? "" : " in most accounts"}, so ${azs + spareAzs - available} of the spare AZ reservations can never be used there.`
    );
  }
  if (azs === 1)
    warnings.push(
      "A single Availability Zone has no redundancy: an AZ outage takes the whole VPC down."
    );
  if (!tiers.some((tier) => tier.kind === "public"))
    warnings.push(
      "No public tier: the VPC has no route to the internet unless you add a Transit Gateway or endpoints."
    );
  for (const tier of tiers) {
    if (tier.kind === "private" && tier.prefix > 24) {
      warnings.push(
        `${tier.name} subnets (/${tier.prefix}, ${awsUsable(tier.prefix)} usable) are small for workloads that scale out; Lambda, EKS and ECS each take an IP per task or ENI.`
      );
    }
  }

  return {
    vpc,
    region,
    azs,
    spareAzs,
    natGateways: ["per-az", "single", "none"].includes(input?.natGateways)
      ? input.natGateways
      : "per-az",
    tiers,
    subnets,
    reserved,
    free,
    errors,
    warnings,
    stats: {
      allocated,
      reserved: reserved.reduce((sum, block) => sum + block.size, 0),
      free: free.reduce((sum, block) => sum + block.size, 0),
      usable,
      total: vpc.size,
      utilisation: allocated / vpc.size,
    },
  };
}

// ----------------------------------------------------------------- checks

/**
 * Check a list of CIDR blocks (one per line, `#` comments and trailing
 * labels allowed: `10.1.0.0/16 prod-vpc`).
 */
export function checkCidrs(text) {
  const entries = [];
  const issues = [];
  String(text ?? "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw
        .replace(/#.*$/, "")
        .replace(/\s*\/\s*/g, "/")
        .trim();
      if (!line) return;
      // Every CIDR on the line is checked ("10.0.0.0/16, 10.1.0.0/16"); the
      // remaining words become their label.
      const tokens = line.split(/[\s,;]+/).filter(Boolean);
      const isCidr = (token) => /^\d{1,3}(\.\d{1,3}){3}\/\d{1,3}$/.test(token);
      const cidrs = tokens.filter(isCidr);
      const label = tokens.filter((token) => !isCidr(token)).join(" ") || null;
      if (!cidrs.length) {
        issues.push({ severity: "error", line: index + 1, message: parseCidr(tokens[0]).error });
        return;
      }
      for (const cidr of cidrs) {
        const block = parseCidr(cidr);
        if (block.error) {
          issues.push({ severity: "error", line: index + 1, message: block.error });
          continue;
        }
        if (!block.aligned) {
          issues.push({
            severity: "warn",
            line: index + 1,
            message: `${block.input} has host bits set — the network is ${block.text}.`,
          });
        }
        entries.push({ ...block, label, line: index + 1 });
      }
    });

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (!overlaps(a, b)) continue;
      const name = (entry) => `${entry.text}${entry.label ? ` (${entry.label})` : ""}`;
      const message =
        a.network === b.network && a.prefix === b.prefix
          ? `${name(a)} is listed twice (lines ${a.line} and ${b.line}).`
          : contains(a, b)
            ? `${name(b)} sits inside ${name(a)}.`
            : contains(b, a)
              ? `${name(a)} sits inside ${name(b)}.`
              : `${name(a)} overlaps ${name(b)}.`;
      issues.push({ severity: "error", line: b.line, message, pair: [a.line, b.line] });
    }
  }

  const clean = entries.filter(
    (entry) =>
      !issues.some((issue) => issue.severity === "error" && issue.pair?.includes(entry.line))
  );
  return {
    entries,
    issues,
    summary: summarize(entries),
    ok: entries.length > 0 && !issues.some((issue) => issue.severity === "error"),
    clean,
  };
}

/** Device types that route (or sit outside the LAN) rather than bridge or host. */
const LAYER3 = new Set([
  "router",
  "l3-switch",
  "firewall",
  "vpn-gateway",
  "load-balancer",
  "internet",
  "cloud",
]);
/** Transparent layer-2 devices: hosts behind them share a broadcast domain. */
const BRIDGES = new Set(["l2-switch", "wireless-ap"]);
/** Addresses that summarise somewhere else (a WAN, a cloud VPC), not a LAN segment. */
const EXTERNAL = new Set(["internet", "cloud"]);

/**
 * Audit Network Lab addressing: duplicate addresses, hosts on network or
 * broadcast addresses, LAN subnets that overlap without matching, and hosts
 * on the same switch (and VLAN) that sit in different subnets — or in the
 * same subnet on different VLANs.
 *
 * Network Lab devices carry one address each, so a router's other
 * interfaces are unknown; the audit never guesses at gateways.
 */
export function auditAddressing(state) {
  const nodes = (state?.nodes || []).filter((node) => node.ip);
  const issues = [];
  const addressed = [];
  // Every parsable address counts towards duplicates, masked or not.
  const byIp = new Map();
  for (const node of nodes) {
    // "10.0.0.5/24" in the address field carries its own prefix.
    const [address, suffix] = String(node.ip).trim().split("/");
    const ip = parseIp(address);
    const fromSubnet = node.subnet ? prefixFromMask(node.subnet) : null;
    const fromAddress = suffix !== undefined ? prefixFromMask(suffix) : null;
    const prefix = fromSubnet ?? fromAddress;
    if (ip !== null) byIp.set(ip, [...(byIp.get(ip) || []), node]);
    if (ip === null) {
      issues.push({
        severity: "error",
        node: node.id,
        message: `${node.name}: “${node.ip}” is not an IPv4 address.`,
      });
      continue;
    }
    if (fromSubnet !== null && fromAddress !== null && fromSubnet !== fromAddress) {
      issues.push({
        severity: "warn",
        node: node.id,
        message: `${node.name}'s address says /${fromAddress} but its subnet is /${fromSubnet}; using /${fromSubnet}.`,
      });
    }
    if (prefix === null) {
      issues.push({
        severity: "warn",
        node: node.id,
        message: `${node.name} has no valid subnet mask, so its network is unknown.`,
      });
      continue;
    }
    const block = parseCidr(`${formatIp(ip)}/${prefix}`);
    if (prefix < 31 && (ip === block.network || ip === block.last)) {
      issues.push({
        severity: "error",
        node: node.id,
        message: `${node.name} uses ${formatIp(ip)}, the ${ip === block.network ? "network" : "broadcast"} address of ${block.text}.`,
      });
    }
    addressed.push({ node, ip, block });
  }

  for (const [ip, list] of byIp) {
    if (list.length > 1) {
      issues.push({
        severity: "error",
        node: list[1].id,
        message: `${formatIp(ip)} is used by ${list.map((node) => node.name).join(" and ")}.`,
      });
    }
  }

  const networks = new Map();
  for (const entry of addressed) {
    const current = networks.get(entry.block.text) || {
      ...entry.block,
      devices: [],
      external: true,
    };
    current.devices.push(entry.node.name);
    current.external = current.external && EXTERNAL.has(entry.node.type);
    networks.set(entry.block.text, current);
  }
  const blocks = [...networks.values()].sort(
    (a, b) => a.network - b.network || a.prefix - b.prefix
  );
  // A cloud or internet node's block summarises the networks behind it, so
  // containing them is expected; only LAN segments must not overlap.
  const lan = blocks.filter((block) => !block.external);
  for (let i = 0; i < lan.length; i += 1) {
    for (let j = i + 1; j < lan.length; j += 1) {
      if (overlaps(lan[i], lan[j])) {
        issues.push({
          severity: "warn",
          message: `${lan[i].text} and ${lan[j].text} overlap: devices in them disagree about who is on-link (check the masks).`,
        });
      }
    }
  }

  const byId = new Map(addressed.map((entry) => [entry.node.id, entry]));
  const allNodes = new Map((state?.nodes || []).map((node) => [node.id, node]));
  const adjacency = new Map();
  for (const link of state?.links || []) {
    if (!adjacency.has(link.source)) adjacency.set(link.source, []);
    if (!adjacency.has(link.target)) adjacency.set(link.target, []);
    adjacency.get(link.source).push(link.target);
    adjacency.get(link.target).push(link.source);
  }
  const reported = new Set();
  for (const entry of addressed) {
    if (LAYER3.has(entry.node.type) || BRIDGES.has(entry.node.type)) continue;
    // Walk out through switches and access points only. A direct host-to-host
    // link is an application flow in the lab, not a shared segment.
    const seen = new Set([entry.node.id]);
    const queue = (adjacency.get(entry.node.id) || []).map((id) => ({ id, viaBridge: false }));
    while (queue.length) {
      const { id, viaBridge } = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const neighbour = allNodes.get(id);
      if (!neighbour || LAYER3.has(neighbour.type)) continue;
      if (BRIDGES.has(neighbour.type)) {
        for (const next of adjacency.get(id) || []) queue.push({ id: next, viaBridge: true });
        continue;
      }
      const other = byId.get(id);
      if (!other || !viaBridge) continue;
      const key = [entry.node.id, id].sort().join("|");
      if (reported.has(key)) continue;
      const vlanA = String(entry.node.vlan || "").trim();
      const vlanB = String(other.node.vlan || "").trim();
      const sameVlan = !vlanA || !vlanB || vlanA === vlanB;
      const sameSubnet = entry.block.text === other.block.text;
      if (sameVlan && !sameSubnet) {
        reported.add(key);
        issues.push({
          severity: "warn",
          node: entry.node.id,
          message: `${entry.node.name} (${entry.block.text}) and ${other.node.name} (${other.block.text}) share a switch${vlanA && vlanA === vlanB ? ` and VLAN ${vlanA}` : ""} but not a subnet, so they need a router to talk.`,
        });
      } else if (!sameVlan && sameSubnet) {
        reported.add(key);
        issues.push({
          severity: "warn",
          node: entry.node.id,
          message: `${entry.node.name} and ${other.node.name} are both in ${entry.block.text} but on VLANs ${vlanA} and ${vlanB}, so they cannot reach each other.`,
        });
      }
    }
  }

  return {
    networks: blocks.map(({ external, ...block }) => ({
      ...block,
      external,
      hosts: block.devices.length,
      capacity: block.prefix >= 31 ? block.size : block.size - 2,
    })),
    issues,
    devices: addressed.length,
    unaddressed: (state?.nodes || []).length - nodes.length,
  };
}

// ---------------------------------------------------------------- output

const TIER_ORDER = ["public", "private", "data"];

/**
 * A diagram of the plan: AWS Cloud → Region → VPC → one column per AZ with a
 * subnet container per tier, an internet gateway and (optionally) NAT
 * gateways in the public subnets.
 */
export function vpcBlueprint(plan, { name = null } = {}) {
  if (!plan?.vpc || plan.errors?.length) return null;
  const tiers = [...plan.tiers].sort(
    (a, b) => TIER_ORDER.indexOf(a.kind) - TIER_ORDER.indexOf(b.kind) || a.index - b.index
  );
  const azCount = plan.azs;
  const subW = 250;
  const subH = 118;
  const gap = 22;
  const azW = subW + 40;
  const azH = 58 + tiers.length * (subH + gap);
  const vpcX = 250;
  const vpcY = 150;
  const vpcW = 40 + azCount * (azW + 30);
  const vpcH = azH + 130;
  const hasPublic = tiers.some((tier) => tier.kind === "public");
  const hasPrivate = tiers.some((tier) => tier.kind === "private");
  const nat = hasPublic && hasPrivate && plan.natGateways !== "none";
  // NAT gateways live in the first public tier only, one per AZ (or one in total).
  const natTier = tiers.find((tier) => tier.kind === "public");

  const groups = [
    { key: "cloud", preset: "aws-cloud", x: 170, y: 20, w: vpcW + 180, h: vpcH + 250 },
    {
      key: "region",
      preset: "region",
      label: `Region ${plan.region}`,
      x: 200,
      y: 70,
      w: vpcW + 120,
      h: vpcH + 170,
      parent: "cloud",
    },
    {
      key: "vpc",
      preset: "vpc",
      label: `VPC ${plan.vpc.text}`,
      x: vpcX,
      y: vpcY,
      w: vpcW,
      h: vpcH,
      parent: "region",
    },
  ];
  const nodes = [];
  const links = [];
  for (let az = 0; az < azCount; az += 1) {
    const azX = vpcX + 30 + az * (azW + 30);
    // Below the internet gateway and its label in the VPC's top band.
    const azY = vpcY + 90;
    const azKey = `az-${az}`;
    groups.push({
      key: azKey,
      preset: "availability-zone",
      label: `Availability Zone ${plan.subnets.find((subnet) => subnet.azIndex === az)?.az || az + 1}`,
      x: azX,
      y: azY,
      w: azW,
      h: azH,
      parent: "vpc",
    });
    tiers.forEach((tier, row) => {
      const subnet = plan.subnets.find(
        (candidate) => candidate.tierIndex === tier.index && candidate.azIndex === az
      );
      if (!subnet) return;
      const key = `subnet-${tier.index}-${az}`;
      const kind = TIER_KINDS[tier.kind];
      const x = azX + 20;
      const y = azY + 46 + row * (subH + gap);
      groups.push({
        key,
        preset: kind.preset,
        label: `${tier.name} ${subnet.text}`,
        zone: tier.kind === "data" ? "data" : undefined,
        x,
        y,
        w: subW,
        h: subH,
        parent: azKey,
      });
      if (tier === natTier && nat && (plan.natGateways === "per-az" || az === 0)) {
        nodes.push({
          key: `nat-${az}`,
          service: "Amazon VPC NAT Gateway",
          type: "resource",
          name: `NAT ${subnet.az}`,
          x: x + subW / 2 - 24,
          y: y + 44,
          parent: key,
          notes: `${subnet.usable} usable addresses in ${subnet.text}.`,
        });
      }
    });
  }
  if (hasPublic) {
    nodes.push({
      key: "igw",
      service: "Amazon VPC Internet Gateway",
      type: "resource",
      name: "Internet gateway",
      x: vpcX + vpcW / 2 - 24,
      // Inside the VPC's top band, above the AZ columns (which start 90px down).
      y: vpcY + 12,
      parent: "vpc",
      zone: "edge",
    });
    nodes.push({
      key: "internet",
      service: "Users 48 Light",
      type: "resource",
      name: "Internet",
      x: 60,
      y: vpcY + 12,
      zone: "internet",
    });
    // NAT egress to the gateway is implied by the public subnets' route
    // table; drawing it would only cross every AZ column.
    links.push({ from: "internet", to: "igw", label: "0.0.0.0/0" });
  }

  const summary = `${plan.subnets.length} subnets across ${plan.azs} AZ${plan.azs === 1 ? "" : "s"} · ${plan.stats.usable.toLocaleString()} usable IPs · ${Math.round(plan.stats.utilisation * 100)}% of ${plan.vpc.text} allocated${plan.reserved.length ? ` · ${plan.reserved.length} blocks reserved for ${plan.spareAzs} more AZ${plan.spareAzs === 1 ? "" : "s"}` : ""}.`;
  return {
    name: name || `VPC plan ${plan.vpc.text}`,
    region: plan.region,
    groups,
    nodes,
    links,
    shapes: [
      {
        kind: "note",
        x: vpcX,
        y: vpcY + vpcH + 18,
        w: Math.min(vpcW, 560),
        h: 64,
        label: summary,
        parent: "region",
      },
    ],
  };
}

/** A Terraform identifier: letters, digits and underscores, never starting with a digit. */
function tfName(text) {
  const name =
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "subnet";
  return /^[0-9]/.test(name) ? `t_${name}` : name;
}

/** A double-quoted HCL string body: escapes quotes, backslashes and template sequences. */
function hcl(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, () => "$${")
    .replace(/%\{/g, "%%{")
    .replace(/[\r\n]+/g, " ");
}

/** One identifier per tier, suffixed when two tier names normalise alike ("App", "app"). */
function tierKeys(plan) {
  const keys = new Map();
  const used = new Set();
  for (const tier of [...plan.tiers].sort((a, b) => a.index - b.index)) {
    const base = tfName(tier.name);
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}_${n}`;
    used.add(key);
    keys.set(tier.index, key);
  }
  return keys;
}

/** Terraform for the plan: VPC, subnets, IGW/NAT and route tables. */
export function vpcTerraform(plan, { name = "main" } = {}) {
  if (!plan?.vpc || plan.errors?.length) return "";
  const id = tfName(name);
  const lines = [
    `# ${plan.vpc.text} in ${plan.region} — generated by Trust Choreography's VPC Planner`,
    "",
    `resource "aws_vpc" "${id}" {`,
    `  cidr_block           = "${plan.vpc.text}"`,
    "  enable_dns_support   = true",
    "  enable_dns_hostnames = true",
    "",
    `  tags = { Name = "${hcl(name)}" }`,
    "}",
    "",
  ];
  // AZ letters map to different physical zones per account (and some
  // regions skip letters), so subnets take the account's own AZ list.
  lines.push(
    'data "aws_availability_zones" "available" {',
    '  state = "available"',
    "",
    "  filter {",
    '    name   = "opt-in-status"',
    '    values = ["opt-in-not-required"]',
    "  }",
    "}",
    ""
  );
  const hasPublic = plan.subnets.some((subnet) => subnet.kind === "public");
  const hasPrivate = plan.subnets.some((subnet) => subnet.kind === "private");
  const nat = hasPublic && hasPrivate && plan.natGateways !== "none";
  const keys = tierKeys(plan);
  const subnetKey = (subnet) => `${keys.get(subnet.tierIndex)}_${subnet.az.slice(-1)}`;
  for (const subnet of plan.subnets) {
    const key = subnetKey(subnet);
    lines.push(
      `resource "aws_subnet" "${key}" {`,
      `  vpc_id            = aws_vpc.${id}.id`,
      `  cidr_block        = "${subnet.text}"`,
      `  availability_zone = data.aws_availability_zones.available.names[${subnet.azIndex}] # planned as ${hcl(subnet.az)}`,
      ...(subnet.kind === "public" ? ["  map_public_ip_on_launch = true"] : []),
      "",
      `  tags = { Name = "${hcl(`${name}-${keys.get(subnet.tierIndex)}-${subnet.az}`)}", Tier = "${hcl(subnet.tier)}" }`,
      "}",
      ""
    );
  }
  if (hasPublic) {
    const publics = plan.subnets.filter((subnet) => subnet.kind === "public");
    lines.push(
      `resource "aws_internet_gateway" "${id}" {`,
      `  vpc_id = aws_vpc.${id}.id`,
      "}",
      "",
      `resource "aws_route_table" "public" {`,
      `  vpc_id = aws_vpc.${id}.id`,
      "",
      "  route {",
      '    cidr_block = "0.0.0.0/0"',
      `    gateway_id = aws_internet_gateway.${id}.id`,
      "  }",
      "}",
      ""
    );
    for (const subnet of publics) {
      const key = subnetKey(subnet);
      lines.push(
        `resource "aws_route_table_association" "${key}" {`,
        `  subnet_id      = aws_subnet.${key}.id`,
        "  route_table_id = aws_route_table.public.id",
        "}",
        ""
      );
    }
    if (nat) {
      // NAT gateways go in the first public tier: one per AZ, or a single one.
      const natTier = Math.min(...publics.map((subnet) => subnet.tierIndex));
      const natPool = publics.filter((subnet) => subnet.tierIndex === natTier);
      const natSubnets = plan.natGateways === "per-az" ? natPool : natPool.slice(0, 1);
      for (const subnet of natSubnets) {
        const az = subnet.az.slice(-1);
        const key = subnetKey(subnet);
        lines.push(
          `resource "aws_eip" "nat_${az}" {`,
          '  domain = "vpc"',
          "}",
          "",
          `resource "aws_nat_gateway" "${az}" {`,
          `  allocation_id = aws_eip.nat_${az}.id`,
          `  subnet_id     = aws_subnet.${key}.id`,
          "",
          `  depends_on = [aws_internet_gateway.${id}]`,
          "}",
          ""
        );
      }
      for (const subnet of plan.subnets.filter((candidate) => candidate.kind === "private")) {
        const az = subnet.az.slice(-1);
        const key = subnetKey(subnet);
        const natAz = plan.natGateways === "per-az" ? az : natSubnets[0].az.slice(-1);
        lines.push(
          `resource "aws_route_table" "${key}" {`,
          `  vpc_id = aws_vpc.${id}.id`,
          "",
          "  route {",
          '    cidr_block     = "0.0.0.0/0"',
          `    nat_gateway_id = aws_nat_gateway.${natAz}.id`,
          "  }",
          "}",
          "",
          `resource "aws_route_table_association" "${key}" {`,
          `  subnet_id      = aws_subnet.${key}.id`,
          `  route_table_id = aws_route_table.${key}.id`,
          "}",
          ""
        );
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
