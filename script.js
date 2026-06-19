const scenarios = {
  steady: {
    title: "Cloud services keep serving while the command atlas rebalances risk.",
    meta: "9 services, 7 trust paths",
    routeHealth: "87%",
    fallbackReady: "58%",
    dataDurability: "99.95",
    recoveryEta: "07m",
    scores: {
      "CloudFront edge": 82,
      "EKS compute fleet": 88,
      "IAM trust broker": 64,
      "Aurora data mesh": 76,
      "Step Functions core": 93,
      "Manual approval lane": 58
    }
  },
  surge: {
    title: "Traffic pressure shifts through CloudFront while EKS capacity expands.",
    meta: "22k requests/sec, 3 autoscale events",
    routeHealth: "79%",
    fallbackReady: "61%",
    dataDurability: "99.92",
    recoveryEta: "11m",
    scores: {
      "CloudFront edge": 74,
      "EKS compute fleet": 81,
      "IAM trust broker": 69,
      "Aurora data mesh": 73,
      "Step Functions core": 89,
      "Manual approval lane": 61
    }
  },
  identity: {
    title: "Identity drift tightens IAM permissions before recovery lanes open.",
    meta: "4 role changes, 2 approval gates",
    routeHealth: "73%",
    fallbackReady: "67%",
    dataDurability: "99.96",
    recoveryEta: "14m",
    scores: {
      "CloudFront edge": 84,
      "EKS compute fleet": 76,
      "IAM trust broker": 51,
      "Aurora data mesh": 79,
      "Step Functions core": 86,
      "Manual approval lane": 67
    }
  },
  recovery: {
    title: "A recovery drill proves workflow state, data, and approvals stay aligned.",
    meta: "5 replayed incidents, 0 customer-impacting writes",
    routeHealth: "92%",
    fallbackReady: "83%",
    dataDurability: "99.99",
    recoveryEta: "04m",
    scores: {
      "CloudFront edge": 90,
      "EKS compute fleet": 91,
      "IAM trust broker": 78,
      "Aurora data mesh": 88,
      "Step Functions core": 96,
      "Manual approval lane": 83
    }
  }
};

const failureModes = {
  edge: {
    id: "edge",
    label: "Edge flood",
    summary: "Cache misses and hostile traffic saturate the public entry path.",
    scoreDeltas: {
      "CloudFront edge": -24,
      "EKS compute fleet": -10,
      "IAM trust broker": -4
    },
    impactedNodes: ["CloudFront edge", "EKS compute fleet", "EventBridge mesh"],
    routeHealthDelta: -18,
    fallbackDelta: 4,
    durabilityDelta: -0.01,
    recoveryMinutes: 5,
    recommendation: "Rate-limit at the edge, preserve cache capacity, and scale compute only after request quality is visible."
  },
  identity: {
    id: "identity",
    label: "Identity breach",
    summary: "Federated trust expands beyond the intended emergency boundary.",
    scoreDeltas: {
      "IAM trust broker": -30,
      "Step Functions core": -9,
      "Manual approval lane": 8
    },
    impactedNodes: ["IAM trust broker", "Step Functions core", "Manual approval lane", "Lambda decision agent"],
    routeHealthDelta: -10,
    fallbackDelta: 7,
    durabilityDelta: 0,
    recoveryMinutes: 8,
    recommendation: "Freeze role changes, route elevation through manual approval, and diff trust relationships before restoring speed."
  },
  data: {
    id: "data",
    label: "Data lag",
    summary: "Replica delay and write pressure weaken recovery-point confidence.",
    scoreDeltas: {
      "Aurora data mesh": -28,
      "Step Functions core": -7,
      "EKS compute fleet": -5
    },
    impactedNodes: ["Aurora data mesh", "Step Functions core", "S3 evidence vault"],
    routeHealthDelta: -8,
    fallbackDelta: -4,
    durabilityDelta: -0.12,
    recoveryMinutes: 10,
    recommendation: "Throttle writes, protect the last known recovery point, and prove replay order before reopening mutation paths."
  },
  workflow: {
    id: "workflow",
    label: "Workflow backlog",
    summary: "Retries and compensations accumulate faster than state can settle.",
    scoreDeltas: {
      "Step Functions core": -25,
      "EKS compute fleet": -7,
      "Manual approval lane": -5
    },
    impactedNodes: ["Step Functions core", "Lambda decision agent", "EventBridge mesh", "Manual approval lane"],
    routeHealthDelta: -12,
    fallbackDelta: -6,
    durabilityDelta: -0.02,
    recoveryMinutes: 7,
    recommendation: "Quarantine poison work, cap retries, and drain one compensation lane at a time with evidence attached."
  }
};

const runbooks = {
  steady: {
    title: "Steady state watch",
    steps: [
      {
        state: "observe",
        label: "Observe edge",
        detail: "Keep CloudFront, WAF, and Shield signals inside normal latency bands."
      },
      {
        state: "ready",
        label: "Check capacity",
        detail: "Confirm EKS target groups have spare room before the next deployment."
      },
      {
        state: "ready",
        label: "Verify state",
        detail: "Sample Step Functions executions and Aurora replica lag for drift."
      },
      {
        state: "log",
        label: "Archive proof",
        detail: "Store the current confidence snapshot in the S3 evidence vault."
      }
    ]
  },
  surge: {
    title: "Traffic surge response",
    steps: [
      {
        state: "active",
        label: "Raise edge guard",
        detail: "Tighten WAF rules and watch CloudFront cache-miss pressure."
      },
      {
        state: "active",
        label: "Scale compute",
        detail: "Let EKS expand hot services while Lambda scores noisy requests."
      },
      {
        state: "ready",
        label: "Protect data",
        detail: "Throttle write-heavy paths before Aurora replica lag widens."
      },
      {
        state: "log",
        label: "Capture timeline",
        detail: "Send EventBridge surge events to the audit stream for replay."
      }
    ]
  },
  identity: {
    title: "Identity drift containment",
    steps: [
      {
        state: "active",
        label: "Freeze roles",
        detail: "Pause risky IAM changes and require manual approval for elevation."
      },
      {
        state: "active",
        label: "Trace callers",
        detail: "Map suspicious role sessions through Lambda and EventBridge events."
      },
      {
        state: "ready",
        label: "Narrow trust",
        detail: "Reduce temporary permissions until Step Functions validates recovery."
      },
      {
        state: "log",
        label: "Preserve evidence",
        detail: "Write IAM diffs and approval notes into the encrypted S3 vault."
      }
    ]
  },
  recovery: {
    title: "Recovery drill checklist",
    steps: [
      {
        state: "active",
        label: "Replay workflow",
        detail: "Run Step Functions through retry and compensation branches."
      },
      {
        state: "ready",
        label: "Shift traffic",
        detail: "Confirm CloudFront can drain traffic toward the healthy lane."
      },
      {
        state: "active",
        label: "Restore data",
        detail: "Validate Aurora recovery points before writes return to normal."
      },
      {
        state: "log",
        label: "Close drill",
        detail: "Publish the EventBridge replay summary and operator signoff."
      }
    ]
  }
};

const postures = {
  steady: {
    title: "Balanced watch",
    lenses: [
      {
        name: "Prevent",
        score: 82,
        lever: "Edge policy hygiene",
        detail: "WAF, Shield, and IAM controls are stable, with no elevated policy drift."
      },
      {
        name: "Absorb",
        score: 76,
        lever: "Spare compute room",
        detail: "EKS can absorb routine bursts while CloudFront keeps cache pressure contained."
      },
      {
        name: "Recover",
        score: 84,
        lever: "Workflow replay",
        detail: "Step Functions and Aurora have enough recovery context to replay common failures."
      },
      {
        name: "Learn",
        score: 71,
        lever: "Evidence freshness",
        detail: "S3 evidence is current, but the manual approval lane still deserves rehearsal."
      }
    ]
  },
  surge: {
    title: "Absorb first",
    lenses: [
      {
        name: "Prevent",
        score: 68,
        lever: "WAF rate tuning",
        detail: "Edge controls need sharper thresholds while cache misses climb."
      },
      {
        name: "Absorb",
        score: 88,
        lever: "EKS expansion",
        detail: "The primary move is capacity absorption before customer-facing degradation."
      },
      {
        name: "Recover",
        score: 74,
        lever: "Replica protection",
        detail: "Aurora remains healthy if write-heavy paths are throttled early."
      },
      {
        name: "Learn",
        score: 66,
        lever: "Traffic replay",
        detail: "EventBridge should capture the surge timeline before autoscaling hides the shape."
      }
    ]
  },
  identity: {
    title: "Constrain trust",
    lenses: [
      {
        name: "Prevent",
        score: 61,
        lever: "Role freeze",
        detail: "Policy drift is the main weakness, so change control beats extra capacity."
      },
      {
        name: "Absorb",
        score: 70,
        lever: "Scoped fallback",
        detail: "Manual approvals can absorb exceptions while broader access is narrowed."
      },
      {
        name: "Recover",
        score: 78,
        lever: "Permission rollback",
        detail: "Step Functions has enough state to coordinate staged permission recovery."
      },
      {
        name: "Learn",
        score: 86,
        lever: "IAM evidence",
        detail: "Identity diffs and caller traces are strong learning artifacts for the incident."
      }
    ]
  },
  recovery: {
    title: "Prove recovery",
    lenses: [
      {
        name: "Prevent",
        score: 79,
        lever: "Guardrail replay",
        detail: "Preventive controls are checked by rerunning the guardrails under known load."
      },
      {
        name: "Absorb",
        score: 83,
        lever: "Traffic drain",
        detail: "CloudFront can steer traffic while compute and data services settle."
      },
      {
        name: "Recover",
        score: 94,
        lever: "State validation",
        detail: "Workflow, data, and approval state line up strongly during the drill."
      },
      {
        name: "Learn",
        score: 91,
        lever: "Drill summary",
        detail: "Replay evidence is ready to become a precise follow-up backlog."
      }
    ]
  }
};

const doctrines = {
  steady: {
    title: "Keep the system legible",
    cards: [
      {
        label: "Failure model",
        value: "Ambiguity drift",
        detail: "The quiet risk is not outage, but losing track of which controls still explain the system."
      },
      {
        label: "Operating stance",
        value: "Observe and rehearse",
        detail: "Keep dashboards calm while exercising the approval lane before it becomes urgent."
      },
      {
        label: "Decision rule",
        value: "Proof before change",
        detail: "Treat every policy or routing change as a hypothesis that needs evidence."
      },
      {
        label: "Recovery proof",
        value: "Fresh replay",
        detail: "A recent Step Functions replay plus S3 evidence snapshot proves the map is trustworthy."
      }
    ]
  },
  surge: {
    title: "Preserve optionality under load",
    cards: [
      {
        label: "Failure model",
        value: "Capacity cascade",
        detail: "A cache miss wave can turn compute, data, and identity into one coupled bottleneck."
      },
      {
        label: "Operating stance",
        value: "Absorb first",
        detail: "Scale and shed pressure before reaching for broad architectural changes."
      },
      {
        label: "Decision rule",
        value: "Throttle writes early",
        detail: "Protect Aurora before replica lag becomes the hidden cost of serving traffic."
      },
      {
        label: "Recovery proof",
        value: "Replay the surge",
        detail: "EventBridge should preserve the shape of demand so autoscaling does not erase the lesson."
      }
    ]
  },
  identity: {
    title: "Constrain authority before velocity",
    cards: [
      {
        label: "Failure model",
        value: "Trust expansion",
        detail: "Incident pressure can widen permissions faster than teams can reason about them."
      },
      {
        label: "Operating stance",
        value: "Freeze and trace",
        detail: "Hold role changes steady, then trace callers before granting more authority."
      },
      {
        label: "Decision rule",
        value: "Least temporary privilege",
        detail: "Every emergency permission needs a narrow scope, owner, and expiry path."
      },
      {
        label: "Recovery proof",
        value: "Diff the graph",
        detail: "IAM diffs plus approval notes show whether trust returned to its intended shape."
      }
    ]
  },
  recovery: {
    title: "Turn drills into control memory",
    cards: [
      {
        label: "Failure model",
        value: "Unproven recovery",
        detail: "A plan that has not been replayed is only documentation, not resilience."
      },
      {
        label: "Operating stance",
        value: "Exercise the loop",
        detail: "Make traffic shift, workflow replay, data restore, and signoff happen together."
      },
      {
        label: "Decision rule",
        value: "No proof, no close",
        detail: "Do not close the drill until each control lens produces evidence."
      },
      {
        label: "Recovery proof",
        value: "Signed timeline",
        detail: "A timestamped replay summary becomes the next resilience backlog."
      }
    ]
  }
};

const nodeHints = {
  "CloudFront edge": "Global traffic entry with WAF and Shield controls.",
  "EKS compute fleet": "Container workloads shift across zones as target groups heat up.",
  "IAM trust broker": "Federated identity contracts are reviewed before emergency permissions widen.",
  "Aurora data mesh": "Read replicas and event streams keep product state moving through recovery.",
  "Step Functions core": "Workflow state machine coordinates retries, compensations, and audit events.",
  "Manual approval lane": "Human review gates can take over if automated confidence dips.",
  "Lambda decision agent": "Short-lived decision functions score incidents without carrying state.",
  "S3 evidence vault": "Immutable recovery evidence lands in an encrypted audit bucket.",
  "EventBridge mesh": "Partner and internal events are normalized before fan-out."
};

const nodeLinks = {
  "CloudFront edge": {
    href: "https://aws.amazon.com/cloudfront/",
    label: "AWS CloudFront"
  },
  "EKS compute fleet": {
    href: "https://aws.amazon.com/eks/",
    label: "Amazon EKS"
  },
  "IAM trust broker": {
    href: "https://aws.amazon.com/iam/",
    label: "AWS IAM"
  },
  "Aurora data mesh": {
    href: "https://aws.amazon.com/rds/aurora/",
    label: "Amazon Aurora"
  },
  "Step Functions core": {
    href: "https://aws.amazon.com/step-functions/",
    label: "AWS Step Functions"
  },
  "Manual approval lane": {
    href: "https://aws.amazon.com/sns/",
    label: "Amazon SNS"
  },
  "Lambda decision agent": {
    href: "https://aws.amazon.com/lambda/",
    label: "AWS Lambda"
  },
  "S3 evidence vault": {
    href: "https://aws.amazon.com/s3/",
    label: "Amazon S3"
  },
  "EventBridge mesh": {
    href: "https://aws.amazon.com/eventbridge/",
    label: "Amazon EventBridge"
  }
};

const scenarioButtons = document.querySelectorAll(".scenario");
const root = document.querySelector(".grid-window");
const replayButton = document.querySelector("#replayButton");
const incidentButton = document.querySelector("#incidentButton");
const serviceNodes = document.querySelectorAll(".service-node");

const textTargets = {
  scenarioTitle: document.querySelector("#scenarioTitle"),
  scenarioMeta: document.querySelector("#scenarioMeta"),
  routeHealth: document.querySelector("#routeHealth"),
  fallbackReady: document.querySelector("#fallbackReady"),
  dataDurability: document.querySelector("#dataDurability"),
  recoveryEta: document.querySelector("#recoveryEta"),
  nodeName: document.querySelector("#nodeName"),
  nodeScore: document.querySelector("#nodeScore"),
  nodeCopy: document.querySelector("#nodeCopy"),
  nodeLink: document.querySelector("#nodeLink"),
  runbookTitle: document.querySelector("#runbookTitle"),
  runbookSteps: document.querySelector("#runbookSteps"),
  postureTitle: document.querySelector("#postureTitle"),
  postureGrid: document.querySelector("#postureGrid"),
  doctrineTitle: document.querySelector("#doctrineTitle"),
  doctrineGrid: document.querySelector("#doctrineGrid"),
  failureComposerSummary: document.querySelector("#failureComposerSummary"),
  failureControls: document.querySelector("#failureControls"),
  blastRadius: document.querySelector("#blastRadius"),
  weakestNode: document.querySelector("#weakestNode"),
  composedRecovery: document.querySelector("#composedRecovery"),
  failureRecommendation: document.querySelector("#failureRecommendation"),
  clearFailuresButton: document.querySelector("#clearFailuresButton")
};

let activeScenario = "steady";
let selectedNode = "Step Functions core";
const activeFailures = new Set();

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deriveComposedState(name) {
  const scenario = scenarios[name] || scenarios.steady;
  const scores = { ...scenario.scores };
  const impactedNodes = new Set();
  let routeHealth = Number.parseFloat(scenario.routeHealth);
  let fallbackReady = Number.parseFloat(scenario.fallbackReady);
  let dataDurability = Number.parseFloat(scenario.dataDurability);
  let recoveryMinutes = Number.parseInt(scenario.recoveryEta, 10);
  const activeModeObjects = Array.from(activeFailures).map((id) => failureModes[id]).filter(Boolean);

  activeModeObjects.forEach((mode) => {
    Object.entries(mode.scoreDeltas).forEach(([nodeName, delta]) => {
      scores[nodeName] = clampNumber((scores[nodeName] || 78) + delta, 12, 99);
    });
    mode.impactedNodes.forEach((nodeName) => impactedNodes.add(nodeName));
    routeHealth += mode.routeHealthDelta;
    fallbackReady += mode.fallbackDelta;
    dataDurability += mode.durabilityDelta;
    recoveryMinutes += mode.recoveryMinutes;
  });

  routeHealth = Math.round(clampNumber(routeHealth, 12, 99));
  fallbackReady = Math.round(clampNumber(fallbackReady, 10, 99));
  dataDurability = clampNumber(dataDurability, 95, 99.99);
  recoveryMinutes = Math.round(clampNumber(recoveryMinutes, 1, 99));

  const weakestEntry = Object.entries(scores).sort((a, b) => a[1] - b[1])[0];
  let blastRadius = "Contained";
  if (activeModeObjects.length === 1) {
    blastRadius = impactedNodes.size >= 4 ? "Domain-wide" : "Localized";
  } else if (activeModeObjects.length === 2) {
    blastRadius = "Cross-domain";
  } else if (activeModeObjects.length >= 3) {
    blastRadius = "Systemic";
  }

  const summary = activeModeObjects.length
    ? `${activeModeObjects.length} fault${activeModeObjects.length === 1 ? "" : "s"} injected: ${activeModeObjects.map((mode) => mode.label).join(" + ")}`
    : "No faults injected";
  const recommendation = activeModeObjects.length
    ? activeModeObjects.map((mode) => mode.recommendation).join(" ")
    : "Inject one or more faults to test how resilience controls interact.";

  return {
    scores,
    impactedNodes,
    routeHealth,
    fallbackReady,
    dataDurability,
    recoveryMinutes,
    weakestNode: weakestEntry ? weakestEntry[0] : "Unknown",
    weakestScore: weakestEntry ? weakestEntry[1] : 0,
    blastRadius,
    summary,
    recommendation,
    activeModeObjects
  };
}

function updateScoreLabels(scores, impactedNodes) {
  serviceNodes.forEach((node) => {
    const name = node.dataset.node;
    const score = scores[name] || node.dataset.score;
    node.dataset.score = score;
    node.classList.toggle("is-impacted", impactedNodes.has(name));
    const scoreLabel = node.querySelector(".score");

    if (scoreLabel) {
      scoreLabel.textContent = `${score}%`;
    }
  });
}

function renderComposedState(name) {
  const composed = deriveComposedState(name);
  textTargets.routeHealth.textContent = `${composed.routeHealth}%`;
  textTargets.fallbackReady.textContent = `${composed.fallbackReady}%`;
  textTargets.dataDurability.textContent = composed.dataDurability.toFixed(2);
  textTargets.recoveryEta.textContent = `${String(composed.recoveryMinutes).padStart(2, "0")}m`;
  textTargets.failureComposerSummary.textContent = composed.summary;
  textTargets.blastRadius.textContent = composed.blastRadius;
  textTargets.weakestNode.textContent = `${composed.weakestNode} (${composed.weakestScore}%)`;
  textTargets.composedRecovery.textContent = `${String(composed.recoveryMinutes).padStart(2, "0")}m`;
  textTargets.failureRecommendation.textContent = composed.recommendation;
  textTargets.clearFailuresButton.disabled = activeFailures.size === 0;
  root.classList.toggle("has-injected-failures", activeFailures.size > 0);
  textTargets.failureControls.querySelectorAll("[data-failure-mode]").forEach((button) => {
    const isActive = activeFailures.has(button.dataset.failureMode);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  updateScoreLabels(composed.scores, composed.impactedNodes);
  return composed;
}

function setScenario(name) {
  const scenario = scenarios[name];
  activeScenario = name;

  scenarioButtons.forEach((button) => {
    const isActive = button.dataset.scenario === name;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  textTargets.scenarioTitle.textContent = scenario.title;
  textTargets.scenarioMeta.textContent = scenario.meta;
  renderRunbook(name);
  renderPosture(name);
  renderDoctrine(name);
  renderComposedState(name);
  setNode(selectedNode);
}

function renderRunbook(name) {
  const runbook = runbooks[name] || runbooks.steady;
  textTargets.runbookTitle.textContent = runbook.title;
  textTargets.runbookSteps.innerHTML = runbook.steps.map((step, index) => `
    <article class="runbook-step ${step.state}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${step.label}</strong>
      <p>${step.detail}</p>
    </article>
  `).join("");
}

function renderPosture(name) {
  const posture = postures[name] || postures.steady;
  textTargets.postureTitle.textContent = posture.title;
  textTargets.postureGrid.innerHTML = posture.lenses.map((lens) => {
    const tone = lens.score >= 85 ? "strong" : lens.score >= 72 ? "watch" : "strained";
    return `
      <article class="posture-card ${tone}" style="--score:${lens.score}%">
        <div>
          <span>${lens.name}</span>
          <strong>${lens.score}%</strong>
        </div>
        <p>${lens.detail}</p>
        <small>Lever: ${lens.lever}</small>
        <span class="posture-bar"><span></span></span>
      </article>
    `;
  }).join("");
}

function renderDoctrine(name) {
  const doctrine = doctrines[name] || doctrines.steady;
  textTargets.doctrineTitle.textContent = doctrine.title;
  textTargets.doctrineGrid.innerHTML = doctrine.cards.map((card) => `
    <article class="doctrine-card">
      <span>${card.label}</span>
      <strong>${card.value}</strong>
      <p>${card.detail}</p>
    </article>
  `).join("");
}

function setNode(name) {
  const composed = deriveComposedState(activeScenario);
  selectedNode = name;
  const score = composed.scores[name] || document.querySelector(`[data-node="${name}"]`)?.dataset.score || "84";

  serviceNodes.forEach((node) => {
    node.classList.toggle("is-selected", node.dataset.node === name);
  });

  textTargets.nodeName.textContent = name;
  textTargets.nodeScore.textContent = `${score}%`;
  textTargets.nodeCopy.textContent = nodeHints[name] || "Signal is moving cleanly through this trust path.";

  const link = nodeLinks[name] || {
    href: "https://aws.amazon.com/",
    label: "AWS"
  };
  textTargets.nodeLink.href = link.href;
  textTargets.nodeLink.textContent = link.label;
}

scenarioButtons.forEach((button) => {
  button.addEventListener("click", () => setScenario(button.dataset.scenario));
});

textTargets.failureControls.addEventListener("click", (event) => {
  const button = event.target.closest("[data-failure-mode]");
  if (!button || !failureModes[button.dataset.failureMode]) {
    return;
  }
  const modeId = button.dataset.failureMode;
  if (activeFailures.has(modeId)) {
    activeFailures.delete(modeId);
  } else {
    activeFailures.add(modeId);
  }
  renderComposedState(activeScenario);
  setNode(selectedNode);
});

textTargets.clearFailuresButton.addEventListener("click", () => {
  activeFailures.clear();
  renderComposedState(activeScenario);
  setNode(selectedNode);
});

serviceNodes.forEach((node) => {
  node.setAttribute("tabindex", "0");
  node.addEventListener("click", () => setNode(node.dataset.node));
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setNode(node.dataset.node);
    }
  });
});

replayButton.addEventListener("click", () => {
  root.classList.remove("is-replaying");
  window.requestAnimationFrame(() => {
    root.classList.add("is-replaying");
  });
});

incidentButton.addEventListener("click", () => {
  root.classList.toggle("is-incident");
  setScenario(root.classList.contains("is-incident") ? "identity" : "steady");
});

window.addEventListener("animationend", (event) => {
  if (event.animationName === "nodePing") {
    root.classList.remove("is-replaying");
  }
});

setScenario(activeScenario);
