/**
 * Label layout — word wrapping against a measuring function.
 *
 * SVG `<text>` does not wrap, and `<foreignObject>` does not survive being
 * drawn to a canvas for PNG export in every browser. So labels are wrapped
 * here into explicit lines and emitted as `<tspan>`s, which render the same on
 * screen, in an exported SVG, and in a PNG.
 */

export const FONT_FAMILY = "Inter, 'Helvetica Neue', Arial, sans-serif";
export const LINE_HEIGHT = 1.25;

/** Rough width when no canvas is available (tests, workers). */
export function estimateWidth(text, fontSize, bold = false) {
  let width = 0;
  for (const char of String(text)) {
    if ("iljt.,:;'|!".includes(char)) width += 0.3;
    else if ("mwMW@".includes(char)) width += 0.86;
    else if (char === " ") width += 0.28;
    else if (char >= "A" && char <= "Z") width += 0.66;
    else width += 0.54;
  }
  return width * fontSize * (bold ? 1.06 : 1);
}

let measureContext;

/**
 * A cached measuring function backed by a 2D canvas when one is available.
 * Falls back to {@link estimateWidth} so layout is deterministic in tests.
 */
export function createMeasurer(doc = globalThis.document) {
  const cache = new Map();
  if (measureContext === undefined) {
    try {
      measureContext = doc?.createElement?.("canvas")?.getContext?.("2d") || null;
    } catch {
      measureContext = null;
    }
  }
  return (text, fontSize, bold = false) => {
    const key = `${bold ? "b" : "n"}|${fontSize}|${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      if (measureContext) {
        measureContext.font = `${bold ? 700 : 400} ${fontSize}px ${FONT_FAMILY}`;
        width = measureContext.measureText(text).width;
      } else {
        width = estimateWidth(text, fontSize, bold);
      }
      if (cache.size > 4000) cache.clear();
      cache.set(key, width);
    }
    return width;
  };
}

function breakLongWord(word, maxWidth, measure) {
  const pieces = [];
  let current = "";
  for (const char of word) {
    if (current && measure(current + char) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Wrap text into lines no wider than `maxWidth`. Explicit newlines are kept,
 * and a single word too long for the line is broken across lines rather than
 * overflowing the shape.
 *
 * @param {string} text
 * @param {number} maxWidth
 * @param {(text: string) => number} measure width of a string at the label's font
 * @returns {string[]}
 */
export function wrapText(text, maxWidth, measure) {
  const source = String(text ?? "");
  if (!source) return [];
  const width = Math.max(8, maxWidth);
  const lines = [];
  for (const paragraph of source.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (measure(word) <= width) {
        line = word;
      } else {
        const pieces = breakLongWord(word, width, measure);
        lines.push(...pieces.slice(0, -1));
        line = pieces[pieces.length - 1] || "";
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Lay out a label inside a box.
 *
 * @returns {{lines: string[], x: number, y: number, anchor: string, lineHeight: number, width: number, height: number}}
 *   (x, y) is the baseline of the first line, relative to the box.
 */
export function layoutLabel(text, box, style, measure) {
  const fontSize = style.fontSize || 13;
  const padding = box.padding ?? 6;
  const lines = wrapText(text, box.w - padding * 2, (value) =>
    measure(value, fontSize, style.bold)
  );
  const lineHeight = fontSize * LINE_HEIGHT;
  const height = lines.length * lineHeight;
  const width = lines.reduce((max, line) => Math.max(max, measure(line, fontSize, style.bold)), 0);
  const anchor = style.align === "left" ? "start" : style.align === "right" ? "end" : "middle";
  const x =
    style.align === "left"
      ? box.x + padding
      : style.align === "right"
        ? box.x + box.w - padding
        : box.x + box.w / 2;
  let top;
  if (style.valign === "top") top = box.y + padding;
  else if (style.valign === "bottom") top = box.y + box.h - padding - height;
  else top = box.y + (box.h - height) / 2;
  // The baseline sits about 0.8em below the top of each line box.
  const y = top + (lineHeight - fontSize) / 2 + fontSize * 0.82;
  return { lines, x, y, anchor, lineHeight, width, height, top };
}
