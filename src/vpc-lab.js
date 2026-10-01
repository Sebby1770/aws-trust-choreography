/**
 * VPC Planner workspace controller.
 *
 * The form on the left describes a VPC (block, region, AZs, tiers); the plan
 * on the right updates live: an address-space map, the subnet table, and
 * warnings. From there the plan opens in AWS Studio as a drawn VPC or leaves
 * as Terraform. Two checkers sit underneath: CIDR overlaps for any list of
 * ranges, and the addressing of whatever is built in the Network Lab.
 */

import {
  auditAddressing,
  awsUsable,
  checkCidrs,
  DEFAULT_PLAN,
  planVpc,
  TIER_KINDS,
  VPC_MAX_PREFIX,
  VPC_MIN_PREFIX,
  vpcBlueprint,
  vpcTerraform,
} from "./cidr.js";

const STORAGE_KEY = "trust-choreography:vpc-plan:v1";

export const VPC_PRESETS = {
  "three-tier": { label: "Three-tier", plan: DEFAULT_PLAN },
  simple: {
    label: "Simple",
    plan: {
      cidr: "10.0.0.0/20",
      region: "us-east-1",
      azs: 2,
      spareAzs: 0,
      natGateways: "single",
      tiers: [
        { name: "Public", kind: "public", prefix: 24 },
        { name: "Private", kind: "private", prefix: 23 },
      ],
    },
  },
  eks: {
    label: "EKS cluster",
    plan: {
      cidr: "10.20.0.0/16",
      region: "eu-west-1",
      azs: 3,
      spareAzs: 0,
      natGateways: "per-az",
      tiers: [
        { name: "Load balancers", kind: "public", prefix: 24 },
        { name: "Nodes and pods", kind: "private", prefix: 18 },
        { name: "Databases", kind: "data", prefix: 24 },
      ],
    },
  },
};

const SAMPLE_CIDRS = `# One block per line; add a label after it.
10.0.0.0/16   production VPC
10.1.0.0/16   staging VPC
10.0.128.0/20 legacy VPC (peered)
192.168.0.0/16 office network
172.31.0.0/16 default VPC`;

function make(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

const clonePlan = (plan) => JSON.parse(JSON.stringify(plan));

/**
 * @param {object} [options]
 * @param {(blueprint: object, message: string) => unknown} [options.openBlueprint]
 * @param {() => object|null} [options.getNetworkState] the Network Lab's topology
 */
export function initVpcLab({
  root = document,
  storage = globalThis.localStorage,
  openBlueprint,
  getNetworkState,
  download,
} = {}) {
  const form = root.querySelector("#vpcForm");
  if (!form) return null;
  const doc = form.ownerDocument;
  const el = (selector) => root.querySelector(selector);
  const cidrInput = el("#vpcCidr");
  const regionInput = el("#vpcRegion");
  const azInput = el("#vpcAzs");
  const spareInput = el("#vpcSpare");
  const natInput = el("#vpcNat");
  const tierList = el("#vpcTiers");
  const summary = el("#vpcSummary");
  const mapBox = el("#vpcMap");
  const legend = el("#vpcLegend");
  const table = el("#vpcTable tbody");
  const messages = el("#vpcMessages");
  const status = el("#vpcStatus");
  const actions = [el("#vpcOpen"), el("#vpcTerraform"), el("#vpcCopy")].filter(Boolean);
  const checkInput = el("#vpcCheckInput");
  const checkOut = el("#vpcCheckResults");
  const auditOut = el("#vpcAuditResults");

  let state = clonePlan(DEFAULT_PLAN);
  let plan = null;

  try {
    const stored = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (stored?.cidr && Array.isArray(stored.tiers))
      state = { ...clonePlan(DEFAULT_PLAN), ...stored };
  } catch {
    /* ignore a corrupt saved plan */
  }

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }

  // --------------------------------------------------------------- form

  function prefixOptions(select, selected) {
    select.replaceChildren();
    for (let prefix = VPC_MIN_PREFIX; prefix <= VPC_MAX_PREFIX; prefix += 1) {
      const option = make(
        doc,
        "option",
        "",
        `/${prefix} (${awsUsable(prefix).toLocaleString()} IPs)`
      );
      option.value = String(prefix);
      option.selected = prefix === Number(selected);
      select.append(option);
    }
  }

  function renderTiers() {
    tierList.replaceChildren();
    state.tiers.forEach((tier, index) => {
      const row = make(doc, "div", "vpc-tier");
      row.dataset.kind = tier.kind;
      const name = make(doc, "input");
      name.type = "text";
      name.value = tier.name;
      name.maxLength = 40;
      name.setAttribute("aria-label", `Tier ${index + 1} name`);
      name.addEventListener("input", () => {
        state.tiers[index].name = name.value;
        remove.setAttribute("aria-label", `Remove ${name.value || `tier ${index + 1}`}`);
        update();
      });
      const kind = make(doc, "select");
      kind.setAttribute("aria-label", `Tier ${index + 1} type`);
      for (const [value, definition] of Object.entries(TIER_KINDS)) {
        const option = make(doc, "option", "", definition.label);
        option.value = value;
        option.selected = value === tier.kind;
        kind.append(option);
      }
      kind.addEventListener("change", () => {
        state.tiers[index].kind = kind.value;
        row.dataset.kind = kind.value;
        update();
      });
      const size = make(doc, "select");
      size.setAttribute("aria-label", `Tier ${index + 1} subnet size`);
      prefixOptions(size, tier.prefix);
      size.addEventListener("change", () => {
        state.tiers[index].prefix = Number(size.value);
        update();
      });
      const remove = make(doc, "button", "vpc-tier-remove", "×");
      remove.type = "button";
      remove.title = "Remove this tier";
      remove.setAttribute("aria-label", `Remove ${tier.name || `tier ${index + 1}`}`);
      remove.disabled = state.tiers.length === 1;
      remove.addEventListener("click", () => {
        state.tiers.splice(index, 1);
        renderTiers();
        update();
        // Keep keyboard users in place: the row that moved up, else the one above.
        const rows = tierList.querySelectorAll(".vpc-tier-remove:not(:disabled)");
        (rows[Math.min(index, rows.length - 1)] || el("#vpcAddTier"))?.focus();
      });
      row.append(name, kind, size, remove);
      tierList.append(row);
    });
  }

  function syncForm() {
    cidrInput.value = state.cidr;
    regionInput.value = state.region;
    azInput.value = String(state.azs);
    spareInput.value = String(state.spareAzs ?? 0);
    natInput.value = state.natGateways || "per-az";
    renderTiers();
  }

  // ------------------------------------------------------------ output

  function renderMap() {
    mapBox.replaceChildren();
    legend.hidden = true;
    if (!plan?.vpc || plan.errors.length) return;
    const blocks = [
      ...plan.subnets.map((subnet) => ({ ...subnet, role: subnet.kind })),
      ...plan.reserved.map((block) => ({ ...block, role: "reserved" })),
      ...plan.free.map((block) => ({ ...block, role: "free" })),
    ].sort((a, b) => a.network - b.network);
    for (const block of blocks) {
      const cell = make(doc, "span", `vpc-map-cell is-${block.role}`);
      cell.style.flexGrow = String(block.size);
      const who =
        block.role === "free"
          ? "Free"
          : block.role === "reserved"
            ? `Reserved for ${block.az}`
            : `${block.tier} · ${block.az}`;
      cell.title = `${who}\n${block.text} (${block.size.toLocaleString()} addresses)`;
      // Only label blocks wide enough to hold their text.
      const share = block.size / plan.vpc.size;
      if (block.role === "free" ? share >= 0.2 : share >= 0.035)
        cell.textContent =
          block.role === "free" ? block.text : `${block.tier} ${block.az.slice(-1)}`;
      mapBox.append(cell);
    }
    legend.hidden = false;
  }

  function renderTable() {
    table.replaceChildren();
    if (!plan?.vpc || plan.errors.length) return;
    for (const subnet of plan.subnets) {
      const row = make(doc, "tr");
      row.dataset.kind = subnet.kind;
      const tier = make(doc, "td");
      tier.append(make(doc, "i", "vpc-dot", ""), doc.createTextNode(subnet.tier));
      row.append(
        tier,
        make(doc, "td", "", subnet.az),
        make(doc, "td", "vpc-mono", subnet.text),
        make(doc, "td", "vpc-mono", `${subnet.firstUsable} – ${subnet.lastUsable}`),
        make(doc, "td", "vpc-num", subnet.usable.toLocaleString())
      );
      table.append(row);
    }
    for (const block of plan.reserved) {
      const row = make(doc, "tr", "is-reserved");
      row.append(
        make(doc, "td", "", `${block.tier} (spare)`),
        make(doc, "td", "", block.az),
        make(doc, "td", "vpc-mono", block.text),
        make(doc, "td", "vpc-muted", "Reserved to add an AZ later"),
        make(doc, "td", "vpc-num", block.usable.toLocaleString())
      );
      table.append(row);
    }
  }

  function renderMessages() {
    messages.replaceChildren();
    for (const error of plan?.errors || [])
      messages.append(make(doc, "p", "vpc-message is-error", error));
    for (const warning of plan?.warnings || [])
      messages.append(make(doc, "p", "vpc-message is-warn", warning));
  }

  function renderSummary() {
    summary.replaceChildren();
    const ok = plan?.vpc && !plan.errors.length;
    for (const button of actions) button.disabled = !ok;
    if (!ok) {
      summary.append(
        make(doc, "strong", "", plan?.vpc ? plan.vpc.text : "No plan"),
        make(doc, "span", "", "Fix the problems below to see the plan.")
      );
      return;
    }
    const figure = (value, label) => {
      const box = make(doc, "div", "vpc-figure");
      box.append(make(doc, "strong", "", value), make(doc, "span", "", label));
      return box;
    };
    summary.append(
      figure(plan.vpc.text, `${plan.region} · ${plan.azs} AZ${plan.azs === 1 ? "" : "s"}`),
      figure(String(plan.subnets.length), "subnets"),
      figure(plan.stats.usable.toLocaleString(), "usable IPs"),
      figure(
        `${Math.round(plan.stats.utilisation * 100)}%`,
        `allocated · ${plan.stats.free.toLocaleString()} free`
      )
    );
  }

  function update() {
    state.cidr = cidrInput.value.trim();
    state.region = regionInput.value.trim() || "us-east-1";
    state.azs = Number(azInput.value) || 1;
    state.spareAzs = Number(spareInput.value) || 0;
    state.natGateways = natInput.value;
    plan = planVpc(state);
    renderSummary();
    renderMap();
    renderTable();
    renderMessages();
    announce();
    save();
    return plan;
  }

  /** One short live status, spoken only when it changes. */
  function announce() {
    if (!status) return;
    const text = !plan?.vpc
      ? "No plan"
      : plan.errors.length
        ? plan.errors[0]
        : `${plan.subnets.length} subnet${plan.subnets.length === 1 ? "" : "s"}, ${Math.round(plan.stats.utilisation * 100)}% of ${plan.vpc.text} allocated${plan.warnings.length ? `, ${plan.warnings.length} warning${plan.warnings.length === 1 ? "" : "s"}` : ""}`;
    if (status.textContent !== text) status.textContent = text;
  }

  // ------------------------------------------------------------ actions

  function terraform() {
    return vpcTerraform(plan, { name: `vpc-${state.region}` });
  }

  function saveFile(text, name) {
    if (download) return download(text, name);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = make(doc, "a");
    link.href = url;
    link.download = name;
    link.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  async function copyTerraform(button) {
    const text = terraform();
    if (!text) return;
    try {
      await globalThis.navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      saveFile(text, "vpc.tf");
      button.textContent = "Downloaded";
    }
    globalThis.setTimeout(() => (button.textContent = "Copy Terraform"), 1400);
  }

  function openInStudio() {
    const blueprint = vpcBlueprint(plan);
    if (!blueprint) return null;
    const count = plan.subnets.length;
    return openBlueprint?.(
      blueprint,
      `Drew ${plan.vpc.text} with ${count} subnet${count === 1 ? "" : "s"}`
    );
  }

  function runCheck() {
    const result = checkCidrs(checkInput.value);
    checkOut.replaceChildren();
    if (!result.entries.length && !result.issues.length) {
      checkOut.append(make(doc, "p", "vpc-muted", "Add CIDR blocks, one per line."));
      return result;
    }
    if (result.ok) {
      checkOut.append(
        make(
          doc,
          "p",
          "vpc-message is-good",
          `${result.entries.length} block${result.entries.length === 1 ? "" : "s"}, no overlaps. Safe to peer or route together.`
        )
      );
    }
    for (const issue of result.issues) {
      checkOut.append(
        make(
          doc,
          "p",
          `vpc-message is-${issue.severity === "error" ? "error" : "warn"}`,
          `Line ${issue.line}: ${issue.message}`
        )
      );
    }
    if (result.summary.length) {
      checkOut.append(
        make(
          doc,
          "p",
          "vpc-muted",
          `Summarised: ${result.summary.map((block) => block.text).join(", ")}`
        )
      );
    }
    return result;
  }

  function runAudit() {
    auditOut.replaceChildren();
    const state = getNetworkState?.();
    if (!state?.nodes?.length) {
      auditOut.append(
        make(
          doc,
          "p",
          "vpc-muted",
          "The Network Lab is empty — build or load a topology there first."
        )
      );
      return null;
    }
    const audit = auditAddressing(state);
    const head = make(
      doc,
      "p",
      "vpc-muted",
      `${audit.devices} addressed device${audit.devices === 1 ? "" : "s"} in ${audit.networks.length} subnet${audit.networks.length === 1 ? "" : "s"}${audit.unaddressed ? ` · ${audit.unaddressed} without an address` : ""}.`
    );
    auditOut.append(head);
    if (audit.networks.length) {
      const list = make(doc, "div", "vpc-audit-networks");
      for (const network of audit.networks) {
        const row = make(doc, "div", "vpc-audit-network");
        row.append(
          make(doc, "strong", "vpc-mono", network.text),
          make(doc, "span", "", `${network.hosts} / ${network.capacity.toLocaleString()} hosts`),
          make(doc, "small", "", network.devices.join(", "))
        );
        list.append(row);
      }
      auditOut.append(list);
    }
    if (!audit.issues.length) {
      auditOut.append(
        make(
          doc,
          "p",
          "vpc-message is-good",
          "Addressing is consistent: no duplicates, overlaps or stranded hosts."
        )
      );
    }
    for (const issue of audit.issues) {
      auditOut.append(
        make(
          doc,
          "p",
          `vpc-message is-${issue.severity === "error" ? "error" : "warn"}`,
          issue.message
        )
      );
    }
    return audit;
  }

  function applyPreset(id) {
    const preset = VPC_PRESETS[id];
    if (!preset) return;
    state = clonePlan(preset.plan);
    syncForm();
    update();
  }

  // ------------------------------------------------------------- wiring

  for (const control of [cidrInput, regionInput, azInput, spareInput, natInput]) {
    control.addEventListener("input", update);
    control.addEventListener("change", update);
  }
  form.addEventListener("submit", (event) => event.preventDefault());
  el("#vpcAddTier")?.addEventListener("click", () => {
    const used = new Set(state.tiers.map((tier) => tier.name));
    let name = "Tier";
    for (let index = state.tiers.length + 1; used.has(name); index += 1) name = `Tier ${index}`;
    state.tiers.push({ name, kind: "private", prefix: 24 });
    renderTiers();
    update();
    tierList.lastElementChild?.querySelector("input")?.select();
  });
  root
    .querySelectorAll("[data-vpc-preset]")
    .forEach((button) =>
      button.addEventListener("click", () => applyPreset(button.dataset.vpcPreset))
    );
  el("#vpcOpen")?.addEventListener("click", openInStudio);
  el("#vpcTerraform")?.addEventListener("click", () => {
    const text = terraform();
    if (text) saveFile(text, "vpc.tf");
  });
  el("#vpcCopy")?.addEventListener("click", (event) => copyTerraform(event.currentTarget));
  el("#vpcCheckRun")?.addEventListener("click", runCheck);
  el("#vpcCheckSample")?.addEventListener("click", () => {
    checkInput.value = SAMPLE_CIDRS;
    runCheck();
  });
  el("#vpcCheckPlan")?.addEventListener("click", () => {
    if (!plan?.vpc) return;
    const others = checkInput.value.split("\n").filter((line) => !/planned VPC$/.test(line.trim()));
    checkInput.value = [`${plan.vpc.text} planned VPC`, ...others].join("\n").trim();
    runCheck();
  });
  el("#vpcAuditRun")?.addEventListener("click", runAudit);

  syncForm();
  update();

  return {
    update,
    applyPreset,
    openInStudio,
    terraform,
    runCheck,
    runAudit,
    get plan() {
      return plan;
    },
  };
}
