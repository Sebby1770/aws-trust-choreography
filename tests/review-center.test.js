// @vitest-environment jsdom
/* global document, DOMParser, window */

import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_TEMPLATES } from "../src/network-lab.js";
import { initReviewCenter } from "../src/review-center.js";

const awsState = {
  name: "Checkout API",
  region: "ap-southeast-2",
  nodes: [
    {
      id: "api",
      name: "Public API",
      serviceName: "Amazon API Gateway",
      environment: "Production",
      criticality: "high",
    },
    {
      id: "worker",
      name: "Processor",
      serviceName: "AWS Lambda",
      environment: "Production",
      criticality: "high",
    },
  ],
  connections: [{ id: "request", from: "api", to: "worker", encrypted: false, type: "request" }],
};

describe("Review Center interface", () => {
  beforeEach(() => {
    const html = readFileSync("index.html", "utf8");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.body.innerHTML = parsed.body.innerHTML;
    window.requestAnimationFrame = vi.fn((callback) => callback());
  });

  it("renders live evidence and sends the top finding back to the exact editor target", async () => {
    const navigate = vi.fn();
    const revealTarget = vi.fn(() => true);
    const review = initReviewCenter({
      getAwsState: () => awsState,
      getNetworkState: () => NETWORK_TEMPLATES["small-office"],
      navigate,
      revealTarget,
    });

    expect(document.querySelector("#reviewScore").textContent).not.toBe("—");
    expect(document.querySelectorAll(".review-lens")).toHaveLength(5);
    expect(document.querySelector(".review-finding.is-must")).not.toBeNull();

    document.querySelector("#reviewFixTopButton").click();
    await vi.waitFor(() => expect(revealTarget).toHaveBeenCalled());
    expect(navigate).toHaveBeenCalledWith("studio");
    expect(revealTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        view: "studio",
        kind: "connection",
        id: "request",
        field: "encrypted",
      })
    );

    document.querySelector('[data-review-mode="evidence"]').click();
    expect(document.querySelectorAll(".review-finding")).toHaveLength(
      review.getSnapshot().findings.length
    );
  });
});
