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
  runbookSteps: document.querySelector("#runbookSteps")
};

let activeScenario = "steady";
let selectedNode = "Step Functions core";

function updateScoreLabels(scores) {
  serviceNodes.forEach((node) => {
    const name = node.dataset.node;
    const score = scores[name] || node.dataset.score;
    node.dataset.score = score;
    const scoreLabel = node.querySelector(".score");

    if (scoreLabel) {
      scoreLabel.textContent = `${score}%`;
    }
  });
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
  textTargets.routeHealth.textContent = scenario.routeHealth;
  textTargets.fallbackReady.textContent = scenario.fallbackReady;
  textTargets.dataDurability.textContent = scenario.dataDurability;
  textTargets.recoveryEta.textContent = scenario.recoveryEta;

  updateScoreLabels(scenario.scores);
  renderRunbook(name);
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

function setNode(name) {
  const scenario = scenarios[activeScenario];
  selectedNode = name;
  const score = scenario.scores[name] || document.querySelector(`[data-node="${name}"]`)?.dataset.score || "84";

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
