/**
 * Project-first launch experience.
 *
 * The launchpad turns a blueprint choice into a normalized project draft, then
 * hands it to the existing Flow Studio. Pure helpers are exported so the
 * project-selection behavior can be tested without a browser.
 */

export const PROJECT_TEMPLATES = Object.freeze([
  "blank",
  "serverless",
  "web",
  "events",
  "claude-rag",
  "ai-agent",
  "chatbot",
]);

const REGIONS = Object.freeze([
  "ap-southeast-2",
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "ap-northeast-1",
]);

const STAGES = Object.freeze(["production", "prototype", "migration", "learning"]);

const DEFAULT_NAMES = Object.freeze({
  blank: "My AWS architecture",
  serverless: "My serverless product API",
  web: "My resilient web platform",
  events: "My event processing pipeline",
  "claude-rag": "My Claude RAG assistant",
  "ai-agent": "My AI agent platform",
  chatbot: "My generative AI chatbot",
});

function allowed(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

/** Normalize untrusted form data into a Flow Studio project draft. */
export function normalizeProjectDraft(input = {}) {
  const template = allowed(input.template, PROJECT_TEMPLATES, "blank");
  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  return {
    name: (rawName || DEFAULT_NAMES[template]).slice(0, 80),
    template,
    region: allowed(input.region, REGIONS, "ap-southeast-2"),
    stage: allowed(input.stage, STAGES, "production"),
  };
}

/** Whether a gallery card category belongs in the selected filter. */
export function projectMatchesFilter(category, filter) {
  return filter === "all" || category === filter || category === "all";
}

export function initProjectLaunchpad({ launch } = {}) {
  const dialog = document.querySelector("#projectWizard");
  const form = document.querySelector("#projectWizardForm");
  const nameInput = document.querySelector("#projectName");
  const createButton = document.querySelector("#createArchitectureButton");
  const browseButton = document.querySelector("#browseProjectsButton");
  const closeButton = document.querySelector("#projectWizardClose");
  const submitButton = form?.querySelector(".dialog-submit");
  const templateButtons = [...document.querySelectorAll("[data-project-template]")];
  const filterButtons = [...document.querySelectorAll("[data-project-filter]")];
  const cards = [...document.querySelectorAll("[data-project-category]")];

  if (!dialog || !form) return null;

  function setTemplate(template) {
    const safeTemplate = allowed(template, PROJECT_TEMPLATES, "blank");
    const radio = form.querySelector(
      `input[name="projectTemplate"][value="${CSS.escape(safeTemplate)}"]`
    );
    if (radio) radio.checked = true;
    if (nameInput) nameInput.value = DEFAULT_NAMES[safeTemplate];
  }

  function open(template = "blank") {
    setTemplate(template);
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    window.requestAnimationFrame(() => {
      nameInput?.focus();
      nameInput?.select();
    });
  }

  function close() {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  createButton?.addEventListener("click", () => open("blank"));
  browseButton?.addEventListener("click", () => {
    document.querySelector("#blueprints")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  closeButton?.addEventListener("click", close);

  templateButtons.forEach((button) => {
    button.addEventListener("click", () => open(button.dataset.projectTemplate));
  });

  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.projectFilter || "all";
      filterButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      cards.forEach((card) => {
        card.hidden = !projectMatchesFilter(card.dataset.projectCategory, filter);
      });
    });
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const draft = normalizeProjectDraft({
      name: data.get("projectName"),
      region: data.get("projectRegion"),
      stage: data.get("projectStage"),
      template: data.get("projectTemplate"),
    });

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Preparing your studio…";
    }

    try {
      await launch?.(draft);
      close();
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.innerHTML = 'Create architecture <span aria-hidden="true">↗</span>';
      }
    }
  });

  return { open, close };
}
