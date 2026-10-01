// @vitest-environment jsdom
/* global document, window */

import { describe, expect, it } from "vitest";
import {
  createDeviceIcon,
  DEVICE_ICON_IDS,
  DEVICE_ICONS,
  DEVICE_TONES,
  deviceIconDataUrl,
  deviceIconMarkup,
  deviceIconParts,
  deviceTone,
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
    const orphans = DEVICE_ICON_IDS.filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it("builds an inline svg tile in the device family colour", () => {
    const icon = createDeviceIcon("router", document);
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("viewBox")).toBe("0 0 48 48");
    // Decorative: the device name is already on the node.
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("focusable")).toBe("false");
    const tile = icon.querySelector("rect");
    expect(tile.getAttribute("width")).toBe("48");
    expect(tile.getAttribute("fill")).toBe(DEVICE_TONES.network);
  });

  it("gives each family its own colour", () => {
    expect(deviceTone("pc")).toBe(DEVICE_TONES.endpoints);
    expect(deviceTone("firewall")).toBe(DEVICE_TONES.security);
    expect(deviceTone("database-server")).toBe(DEVICE_TONES.database);
    expect(deviceTone("web-server")).toBe(DEVICE_TONES.servers);
    expect(deviceTone("teleporter")).toBe(DEVICE_TONES.network);
    for (const id of DEVICE_ICON_IDS) {
      expect(DEVICE_TONES[DEVICE_ICONS[id].tone], id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("draws a glyph on top of the tile for every device", () => {
    for (const id of DEVICE_ICON_IDS) {
      const parts = deviceIconParts(id);
      // Tile + sheen, then at least one glyph element.
      expect(parts.length, id).toBeGreaterThan(2);
      for (const { tag, attrs } of parts) {
        expect(["rect", "path", "circle", "ellipse"], id).toContain(tag);
        if (tag === "path") expect(attrs.d.trim().startsWith("M"), `${id}: ${attrs.d}`).toBe(true);
        // Nothing is left unresolved: colours are concrete by the time we draw.
        for (const key of ["fill", "stroke"]) {
          if (attrs[key] !== undefined) {
            expect(["white", "soft", "tone", "tone-dark"], `${id} ${key}`).not.toContain(
              attrs[key]
            );
          }
        }
      }
      const drawn = createDeviceIcon(id, document);
      expect(drawn.children, id).toHaveLength(parts.length);
    }
  });

  it("keeps coordinates on the 48-unit grid", () => {
    // Paths mix absolute and relative commands, so a negative number can be a
    // legitimate relative delta (`v-6`). This bounds the magnitude instead,
    // which still catches a coordinate that escaped the viewBox entirely.
    for (const id of DEVICE_ICON_IDS) {
      for (const { attrs } of deviceIconParts(id)) {
        const numbers = Object.entries(attrs)
          .filter(([key]) => ["d", "x", "y", "cx", "cy", "width", "height", "r"].includes(key))
          .flatMap(
            ([, value]) =>
              String(value)
                .match(/-?\d+(\.\d+)?/g)
                ?.map(Number) ?? []
          );
        for (const value of numbers) {
          expect(Math.abs(value), id).toBeLessThanOrEqual(48);
        }
      }
    }
  });

  it("serialises standalone markup and data urls for images", () => {
    const markup = deviceIconMarkup("firewall");
    expect(markup.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"')).toBe(
      true
    );
    expect(markup).toContain(DEVICE_TONES.security);
    const parsed = new window.DOMParser().parseFromString(markup, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    const url = deviceIconDataUrl("firewall");
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(atob(url.split(",")[1])).toBe(markup);
    expect(deviceIconMarkup("teleporter")).toBeNull();
    expect(deviceIconDataUrl("teleporter")).toBeNull();
    expect(deviceIconParts("teleporter")).toBeNull();
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
