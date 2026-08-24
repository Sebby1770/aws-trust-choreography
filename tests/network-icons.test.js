// @vitest-environment jsdom
/* global document */

import { describe, expect, it } from "vitest";
import {
  createDeviceIcon,
  DEVICE_ICON_PATHS,
  hasDeviceIcon,
  paintDeviceGlyph,
} from "../src/network-icons.js";
import { NETWORK_DEVICES } from "../src/network-lab.js";

describe("network device icons", () => {
  it("covers every device in the catalog", () => {
    // Asserted against the real catalog, so adding a device without an icon
    // fails here rather than silently falling back to a text glyph.
    const missing = NETWORK_DEVICES.filter((device) => !hasDeviceIcon(device.id)).map((d) => d.id);
    expect(missing).toEqual([]);
  });

  it("does not define icons for devices that no longer exist", () => {
    const known = new Set(NETWORK_DEVICES.map((device) => device.id));
    const orphans = Object.keys(DEVICE_ICON_PATHS).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it("builds an inline svg that inherits the device colour", () => {
    const icon = createDeviceIcon("router", document);
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(icon.getAttribute("fill")).toBe("none");
    // Decorative: the device name is already on the node.
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("focusable")).toBe("false");
  });

  it("emits one path per stroke, with non-empty geometry", () => {
    for (const [id, paths] of Object.entries(DEVICE_ICON_PATHS)) {
      const icon = createDeviceIcon(id, document);
      const drawn = [...icon.querySelectorAll("path")];
      expect(drawn, id).toHaveLength(paths.length);
      for (const path of drawn) {
        const d = path.getAttribute("d");
        expect(d, id).toBeTruthy();
        // Every path command should start with a move-to.
        expect(d.trim().startsWith("M"), `${id}: ${d}`).toBe(true);
      }
    }
  });

  it("keeps coordinates on the 24-unit grid", () => {
    // Paths mix absolute and relative commands, so a negative number can be a
    // legitimate relative delta (`v-6`). This bounds the magnitude instead,
    // which still catches a coordinate that escaped the viewBox entirely.
    for (const [id, paths] of Object.entries(DEVICE_ICON_PATHS)) {
      for (const d of paths) {
        const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
        for (const value of numbers) {
          expect(Math.abs(value), `${id}: ${d}`).toBeLessThanOrEqual(24);
        }
      }
    }
  });

  it("returns null for an unknown device", () => {
    expect(createDeviceIcon("teleporter", document)).toBeNull();
    expect(hasDeviceIcon("teleporter")).toBe(false);
  });

  it("paints the icon into a glyph element", () => {
    const span = document.createElement("span");
    span.textContent = "old glyph";
    const painted = paintDeviceGlyph(span, { id: "firewall", glyph: "▦" }, document);
    expect(painted).toBe(true);
    expect(span.textContent).toBe("");
    expect(span.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the text glyph when a device has no icon", () => {
    const span = document.createElement("span");
    const painted = paintDeviceGlyph(span, { id: "teleporter", glyph: "✦" }, document);
    expect(painted).toBe(false);
    expect(span.textContent).toBe("✦");
    expect(span.querySelector("svg")).toBeNull();
  });

  it("survives a device with neither icon nor glyph", () => {
    const span = document.createElement("span");
    expect(() => paintDeviceGlyph(span, undefined, document)).not.toThrow();
    expect(span.textContent).toBe("");
  });

  it("replaces rather than appends when painted twice", () => {
    const span = document.createElement("span");
    paintDeviceGlyph(span, { id: "router" }, document);
    paintDeviceGlyph(span, { id: "laptop" }, document);
    expect(span.querySelectorAll("svg")).toHaveLength(1);
  });
});
