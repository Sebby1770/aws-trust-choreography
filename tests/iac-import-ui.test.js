// @vitest-environment jsdom
/* global document, window */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initIacImport, renderPreview } from "../src/iac-import-ui.js";

const TERRAFORM = `
  provider "aws" { region = "eu-west-2" }
  resource "aws_apigatewayv2_api" "public" { tags = { Name = "Public API" } }
  resource "aws_apigatewayv2_integration" "i" {
    api_id = aws_apigatewayv2_api.public.id
    integration_uri = aws_lambda_function.handler.invoke_arn
  }
  resource "aws_lambda_function" "handler" { tags = { Name = "Handler" } }
  resource "aws_iam_role_policy_attachment" "basic" { role = aws_iam_role.r.name }
  resource "aws_iam_role" "r" { tags = { Name = "Exec role" } }
`;

function mountDom() {
  document.body.innerHTML = `
    <button id="flowIacImportButton"></button>
    <p id="flowStatusMessage"></p>
    <dialog id="iacDialog">
      <button id="iacDialogClose"></button>
      <span id="iacFormat"></span>
      <button id="iacFileButton"></button>
      <input id="iacFileInput" type="file" />
      <textarea id="iacSource"></textarea>
      <div id="iacPreview"></div>
      <button id="iacDialogSubmit" disabled></button>
    </dialog>`;
}

function makeStudio() {
  return {
    adoptArchitecture: vi.fn(() => ({ imported: 3, skipped: [], connections: 2 })),
    refreshLayout: vi.fn(),
  };
}

describe("renderPreview", () => {
  it("shows counts, region, and the services that will be drawn", () => {
    const container = document.createElement("div");
    renderPreview(container, {
      result: {
        name: "Checkout",
        region: "eu-west-2",
        nodes: [{ name: "Public API", serviceName: "Amazon API Gateway" }],
        connections: [{ encrypted: true }],
        warnings: [],
        stats: { resources: 4, services: 1, plumbing: 2, connections: 1 },
      },
    });
    expect(container.textContent).toMatch(/Public API/);
    expect(container.textContent).toMatch(/eu-west-2/);
    expect(container.textContent).toMatch(/plumbing hidden/);
    expect(container.querySelector(".is-alert")).toBe(null);
  });

  it("calls out unencrypted paths and warnings", () => {
    const container = document.createElement("div");
    renderPreview(container, {
      result: {
        name: "Legacy",
        region: "us-east-1",
        nodes: [],
        connections: [{ encrypted: false }],
        warnings: ['Module "network" was not expanded'],
        stats: { resources: 2, services: 0, plumbing: 1, connections: 1 },
      },
    });
    expect(container.querySelector(".is-alert").textContent).toMatch(/1unencrypted/);
    expect(container.querySelector(".iac-warnings").textContent).toMatch(/network/);
  });

  it("renders errors as an alert", () => {
    const container = document.createElement("div");
    renderPreview(container, { error: "That template has no `Resources` section." });
    expect(container.querySelector(".iac-error").getAttribute("role")).toBe("alert");
  });

  it("escapes untrusted text from the parsed file", () => {
    const container = document.createElement("div");
    renderPreview(container, { error: "<img src=x onerror=alert(1)>" });
    expect(container.querySelector("img")).toBe(null);
    expect(container.textContent).toMatch(/<img/);
  });
});

describe("IaC import dialog", () => {
  beforeEach(() => {
    mountDom();
    window.requestAnimationFrame = vi.fn((callback) => callback());
  });

  it("does nothing without the studio API or markup", () => {
    expect(initIacImport(null)).toBe(null);
    document.body.innerHTML = "";
    expect(initIacImport(makeStudio())).toBe(null);
  });

  it("opens the dialog from the toolbar button", () => {
    const dialog = document.querySelector("#iacDialog");
    dialog.showModal = vi.fn(() => {
      dialog.open = true;
    });
    initIacImport(makeStudio());
    document.querySelector("#flowIacImportButton").click();
    expect(dialog.showModal).toHaveBeenCalled();
  });

  it("previews a parsed stack and enables import", () => {
    const controller = initIacImport(makeStudio());
    controller.parse(TERRAFORM);
    expect(document.querySelector("#iacFormat").textContent).toBe("Terraform");
    expect(document.querySelector("#iacDialogSubmit").disabled).toBe(false);
    const preview = document.querySelector("#iacPreview").textContent;
    expect(preview).toMatch(/Public API/);
    expect(preview).toMatch(/eu-west-2/);
  });

  it("reports an unrecognised format and blocks import", () => {
    const controller = initIacImport(makeStudio());
    controller.parse("just some prose");
    expect(document.querySelector("#iacFormat").textContent).toBe("Unrecognised format");
    expect(document.querySelector("#iacDialogSubmit").disabled).toBe(true);
    expect(document.querySelector("#iacPreview").querySelector(".iac-error")).toBeTruthy();
  });

  it("resets to the empty state when the textarea is cleared", () => {
    const controller = initIacImport(makeStudio());
    controller.parse(TERRAFORM);
    controller.parse("   ");
    expect(document.querySelector("#iacPreview").querySelector(".iac-empty")).toBeTruthy();
    expect(document.querySelector("#iacDialogSubmit").disabled).toBe(true);
  });

  it("applies the architecture and reports the outcome", () => {
    const studio = makeStudio();
    const dialog = document.querySelector("#iacDialog");
    dialog.close = vi.fn();
    const controller = initIacImport(studio);
    controller.parse(TERRAFORM);
    document.querySelector("#iacDialogSubmit").click();

    expect(studio.adoptArchitecture).toHaveBeenCalledTimes(1);
    const [architecture, label] = studio.adoptArchitecture.mock.calls[0];
    expect(label).toBe("Infrastructure imported");
    expect(architecture.nodes.map((n) => n.name)).toContain("Handler");
    expect(document.querySelector("#flowStatusMessage").textContent).toBe(
      "3 services imported · 2 paths"
    );
    expect(studio.refreshLayout).toHaveBeenCalled();
  });

  it("mentions services the catalog could not match", () => {
    const studio = makeStudio();
    studio.adoptArchitecture = vi.fn(() => ({
      imported: 2,
      skipped: ["Mystery service"],
      connections: 1,
    }));
    const controller = initIacImport(studio);
    controller.parse(TERRAFORM);
    document.querySelector("#iacDialogSubmit").click();
    expect(document.querySelector("#flowStatusMessage").textContent).toMatch(
      /1 without an icon skipped/
    );
  });

  it("surfaces a failure from the studio instead of throwing", () => {
    const studio = makeStudio();
    studio.adoptArchitecture = vi.fn(() => {
      throw new Error("Canvas is locked");
    });
    const controller = initIacImport(studio);
    controller.parse(TERRAFORM);
    expect(() => document.querySelector("#iacDialogSubmit").click()).not.toThrow();
    expect(document.querySelector("#iacPreview").textContent).toMatch(/Canvas is locked/);
  });

  it("does not import when nothing has parsed", () => {
    const studio = makeStudio();
    initIacImport(studio);
    document.querySelector("#iacDialogSubmit").click();
    expect(studio.adoptArchitecture).not.toHaveBeenCalled();
  });
});
