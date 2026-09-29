/**
 * Format panel — the right-hand inspector, like draw.io's Format sidebar.
 *
 * It is rebuilt whenever the selection changes and refreshed after edits,
 * except while one of its own controls has focus (so typing into a field is
 * never interrupted by the re-render it causes). Every control edits through
 * `editor.updateSelected`, so each change is one undoable step and bursts of
 * edits from a single control coalesce.
 */

import { ZONES, ZONE_IDS, zoneOf } from "../trust-zones.js";
import {
  ARROW_KINDS,
  CONTAINER_PRESETS,
  PALETTE,
  resolveEdgeStyle,
  resolveServiceStyle,
  resolveShapeStyle,
} from "./shapes.js";
import {
  CRITICALITIES,
  ENVIRONMENTS,
  inheritedZone,
  isContainer,
  isServiceNode,
  TRAFFIC_TYPES,
} from "./model.js";
import { ER_ENDS, fitTable, inferRelation, isTable, relationEnds } from "./er.js";

const COMMON_TYPES = [
  "bigint",
  "bigserial",
  "integer",
  "smallint",
  "serial",
  "numeric(10, 2)",
  "real",
  "boolean",
  "text",
  "varchar(255)",
  "char(36)",
  "uuid",
  "date",
  "timestamp",
  "timestamptz",
  "json",
  "jsonb",
  "bytea",
];

const CARDINALITY_LABELS = {
  "many-to-one": "Many to one",
  "optional-many-to-one": "Zero or many to one",
  "one-to-one": "One to one",
  "optional-one-to-one": "Zero or one to one",
};

const DELETE_ACTIONS = [
  ["", "No action"],
  ["CASCADE", "Cascade"],
  ["SET NULL", "Set null"],
  ["RESTRICT", "Restrict"],
  ["SET DEFAULT", "Set default"],
];

const TRAFFIC_LABELS = {
  request: "Synchronous request",
  event: "Event / queue",
  data: "Data access",
  telemetry: "Telemetry",
  replication: "Replication",
};

const ARROW_LABELS = {
  none: "None",
  arrow: "Arrow",
  open: "Open arrow",
  diamond: "Diamond",
  circle: "Circle",
  one: "One (||)",
  many: "Many (crow's foot)",
  oneMany: "One or many",
  zeroMany: "Zero or many",
  zeroOne: "Zero or one",
};

let uid = 0;
const nextId = (prefix) => `${prefix}-${(uid += 1)}`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function section(title, ...content) {
  return el("section", { class: "dg-format-section" }, el("h3", { text: title }), ...content);
}

function row(label, control, hint = null) {
  const id = control.id || nextId("dgf");
  control.id = id;
  return el(
    "div",
    { class: "dg-format-row" },
    el("label", { for: id, text: label }),
    control,
    hint ? el("p", { class: "dg-format-hint", text: hint }) : null
  );
}

function select(value, options, onChange) {
  const node = el("select", { onchange: () => onChange(node.value) });
  for (const [optionValue, label] of options) {
    node.append(el("option", { value: optionValue, text: label, selected: optionValue === value }));
  }
  node.value = value;
  return node;
}

function numberInput(value, { min, max, step = 1, onCommit }) {
  const node = el("input", {
    type: "number",
    value: Number.isFinite(value) ? Math.round(value * 100) / 100 : "",
    min,
    max,
    step,
    inputmode: "decimal",
  });
  const commit = () => {
    const number = Number(node.value);
    if (node.value !== "" && Number.isFinite(number))
      onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, number)));
  };
  node.addEventListener("change", commit);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter") commit();
  });
  return node;
}

function toggle(label, checked, onChange) {
  const input = el("input", {
    type: "checkbox",
    checked: Boolean(checked),
    onchange: () => onChange(input.checked),
  });
  return el("label", { class: "dg-format-toggle" }, input, el("span", { text: label }));
}

function segmented(value, options, onChange, label) {
  const group = el("div", { class: "dg-segmented", role: "group", "aria-label": label });
  for (const [optionValue, text, title] of options) {
    const button = el("button", {
      type: "button",
      class: optionValue === value ? "is-active" : "",
      "aria-pressed": String(optionValue === value),
      title: title || text,
      onclick: () => onChange(optionValue),
    });
    button.innerHTML = text;
    group.append(button);
  }
  return group;
}

/** Colour control: a swatch that opens the palette, plus "none" and custom. */
function colourControl(label, value, { allowNone = true, onChange }) {
  const id = nextId("dgc");
  const current = value && value !== "none" ? value : null;
  const swatch = el("button", {
    type: "button",
    class: `dg-swatch-button${current ? "" : " is-none"}`,
    id,
    "data-focus-key": `swatch:${label}`,
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
    title: `${label}: ${current || "none"}`,
  });
  swatch.style.setProperty("--swatch", current || "transparent");
  const valueText = el("span", { class: "dg-swatch-value", text: current || "None" });
  const popover = el("div", {
    class: "dg-palette",
    role: "dialog",
    "aria-label": `${label} colours`,
    hidden: true,
  });
  const grid = el("div", { class: "dg-palette-grid" });
  for (const colour of PALETTE) {
    const chip = el("button", {
      type: "button",
      class: `dg-palette-chip${colour === current ? " is-active" : ""}`,
      title: colour,
      "aria-label": colour,
      "data-focus-key": `swatch:${label}`,
      onclick: () => {
        close();
        onChange(colour);
      },
    });
    chip.style.setProperty("--swatch", colour);
    grid.append(chip);
  }
  const custom = el("input", {
    type: "color",
    value: current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#0972d3",
    "aria-label": "Custom colour",
  });
  custom.addEventListener("input", () => onChange(custom.value, { coalesce: true }));
  const footer = el(
    "div",
    { class: "dg-palette-footer" },
    allowNone
      ? el("button", { type: "button", text: "None", onclick: () => (onChange("none"), close()) })
      : null,
    el("label", {}, "Custom ", custom)
  );
  popover.append(grid, footer);
  function close() {
    popover.hidden = true;
    swatch.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
  }
  function outside(event) {
    if (!popover.contains(event.target) && event.target !== swatch) close();
  }
  swatch.addEventListener("click", () => {
    const opening = popover.hidden;
    popover.hidden = !opening;
    swatch.setAttribute("aria-expanded", String(opening));
    if (opening) {
      document.addEventListener("pointerdown", outside, true);
      popover.querySelector(".dg-palette-chip")?.focus();
    }
  });
  popover.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      swatch.focus();
    }
  });
  return el(
    "div",
    { class: "dg-format-row dg-colour-row" },
    el("label", { for: id, text: label }),
    el("div", { class: "dg-colour-control" }, swatch, valueText),
    popover
  );
}

function iconButton(label, glyph, onClick, { disabled = false, pressed } = {}) {
  const button = el("button", {
    type: "button",
    class: "dg-icon-button",
    title: label,
    "aria-label": label,
    disabled,
    "aria-pressed": pressed === undefined ? undefined : String(pressed),
    onclick: onClick,
  });
  button.innerHTML = glyph;
  return button;
}

const ALIGN_ICONS = {
  left: '<svg viewBox="0 0 20 20"><path d="M3 2v16M6 5h9v3H6zM6 12h6v3H6z"/></svg>',
  center: '<svg viewBox="0 0 20 20"><path d="M10 2v16M5 5h10v3H5zM7 12h6v3H7z"/></svg>',
  right: '<svg viewBox="0 0 20 20"><path d="M17 2v16M5 5h9v3H5zM8 12h6v3H8z"/></svg>',
  top: '<svg viewBox="0 0 20 20"><path d="M2 3h16M5 6h3v9H5zM12 6h3v6h-3z"/></svg>',
  middle: '<svg viewBox="0 0 20 20"><path d="M2 10h16M5 5h3v10H5zM12 7h3v6h-3z"/></svg>',
  bottom: '<svg viewBox="0 0 20 20"><path d="M2 17h16M5 5h3v9H5zM12 8h3v6h-3z"/></svg>',
  horizontal: '<svg viewBox="0 0 20 20"><path d="M2 3v14M18 3v14M7 6h2v8H7zM11 6h2v8h-2z"/></svg>',
  vertical: '<svg viewBox="0 0 20 20"><path d="M3 2h14M3 18h14M6 7h8v2H6zM6 11h8v2H6z"/></svg>',
};

/**
 * @param {object} options
 * @param {HTMLElement} options.container
 * @param {object} options.editor  the diagram editor API
 * @param {object} options.studio  studio hooks: {regions, getOverlays, setOverlay, applyZone, describe}
 */
export function mountFormatPanel({ container, editor, studio }) {
  container.classList.add("dg-format");
  let pendingRender = false;

  const update = (label, mutate, opts = {}) => editor.updateSelected(label, mutate, opts);
  const styleUpdate =
    (key, label) =>
    (value, extra = {}) =>
      update(
        label,
        (element) => {
          element.style = { ...(element.style || {}), [key]: value };
        },
        { coalesce: extra.coalesce ? `style:${key}` : null }
      );

  function diagramSections() {
    const doc = editor.doc;
    const name = el("input", { type: "text", value: doc.name, maxlength: 80 });
    name.addEventListener("input", () => studio.rename(name.value));
    const region = select(
      doc.region,
      studio.regions.map((r) => [r, r]),
      (value) => studio.setRegion(value)
    );
    const overlays = studio.getOverlays();
    return [
      section(
        "Diagram",
        row("Name", name),
        row("Region", region),
        el(
          "div",
          { class: "dg-format-toggles" },
          toggle("Grid", doc.grid !== false, (checked) =>
            editor.commit(checked ? "Grid shown" : "Grid hidden", (d) => void (d.grid = checked))
          ),
          toggle("Snap to grid", doc.snap !== false, (checked) =>
            editor.commit(checked ? "Snapping on" : "Snapping off", (d) => void (d.snap = checked))
          )
        ),
        row(
          "Grid size",
          select(
            String(doc.gridSize || 10),
            [
              ["5", "5 px"],
              ["10", "10 px"],
              ["20", "20 px"],
              ["40", "40 px"],
            ],
            (value) => editor.commit("Grid size changed", (d) => void (d.gridSize = Number(value)))
          )
        )
      ),
      section(
        "Trust overlays",
        el(
          "div",
          { class: "dg-format-toggles is-stacked" },
          toggle("Trust-zone badges on services", overlays.zones, (checked) =>
            studio.setOverlay("zones", checked)
          ),
          toggle("Boundary crossings and plaintext", overlays.trust !== false, (checked) =>
            studio.setOverlay("trust", checked)
          ),
          toggle("High-criticality markers", overlays.criticality, (checked) =>
            studio.setOverlay("criticality", checked)
          )
        ),
        el("p", {
          class: "dg-format-hint",
          text: "Drop services into a public or private subnet (or a trust-zone container) and they take on that zone automatically.",
        })
      ),
      section(
        "Get started",
        el("p", {
          class: "dg-format-hint",
          text: "Double-click the canvas to add anything. Hover a shape and drag a blue arrow to connect it, or click an arrow to add a connected copy.",
        })
      ),
    ];
  }

  function serviceSection(node) {
    const doc = editor.doc;
    const name = el("input", { type: "text", value: node.name, maxlength: 80 });
    name.addEventListener("input", () =>
      update("Renamed service", (n) => void (n.name = name.value), { coalesce: "service-name" })
    );
    const inherited = inheritedZone(doc, node.id);
    const zone = select(
      zoneOf(node),
      ZONE_IDS.map((id) => [id, `${ZONES[id].label}`]),
      (value) => update("Trust zone changed", (n) => void (n.zone = value))
    );
    const zoneHint =
      ZONES[zoneOf(node)]?.hint +
      (inherited ? ` — inherited from “${inherited.container.label || "container"}”.` : "");
    const notes = el("textarea", { rows: 3, maxlength: 280 });
    notes.value = node.notes || "";
    notes.addEventListener("input", () =>
      update("Edited notes", (n) => void (n.notes = notes.value), { coalesce: "service-notes" })
    );
    return section(
      "Architecture",
      el(
        "div",
        { class: "dg-format-service" },
        el("img", { src: node.iconPath, alt: "" }),
        el(
          "div",
          {},
          el("strong", { text: node.serviceName }),
          el("small", { text: node.category || "" })
        )
      ),
      row("Name", name),
      el(
        "div",
        { class: "dg-format-pair" },
        row(
          "Environment",
          select(
            node.environment,
            ENVIRONMENTS.map((e) => [e, e]),
            (value) => update("Environment changed", (n) => void (n.environment = value))
          )
        ),
        row(
          "Criticality",
          select(
            node.criticality,
            CRITICALITIES.map((c) => [c, c[0].toUpperCase() + c.slice(1)]),
            (value) => update("Criticality changed", (n) => void (n.criticality = value))
          )
        )
      ),
      row("Trust zone", zone, zoneHint),
      row("Notes", notes),
      el(
        "div",
        { class: "dg-format-actions" },
        el("button", {
          type: "button",
          text: "Rehearse failure",
          onclick: () => studio.killNode(node.id),
        }),
        el("button", {
          type: "button",
          text: "Swap icon…",
          onclick: () => studio.swapIcon(node.id),
        })
      )
    );
  }

  function styleSection(elements) {
    const vertexStyles = elements.map((element) =>
      isServiceNode(element) ? resolveServiceStyle(element) : resolveShapeStyle(element)
    );
    const first = vertexStyles[0];
    const shapesOnly = elements.every((element) => !isServiceNode(element));
    const parts = [];
    if (shapesOnly) {
      parts.push(
        colourControl("Fill", first.fill, { onChange: styleUpdate("fill", "Fill changed") }),
        colourControl("Line", first.stroke, {
          onChange: styleUpdate("stroke", "Line colour changed"),
        }),
        el(
          "div",
          { class: "dg-format-pair" },
          row(
            "Line width",
            numberInput(first.strokeWidth, {
              min: 0,
              max: 12,
              step: 0.5,
              onCommit: styleUpdate("strokeWidth", "Line width changed"),
            })
          ),
          row(
            "Pattern",
            select(
              first.dash || "solid",
              [
                ["solid", "Solid"],
                ["dashed", "Dashed"],
                ["dotted", "Dotted"],
              ],
              styleUpdate("dash", "Line pattern changed")
            )
          )
        ),
        el(
          "div",
          { class: "dg-format-toggles" },
          elements.every((element) => ["rect", "rounded"].includes(element.kind))
            ? toggle("Rounded", first.rounded, (checked) =>
                styleUpdate("rounded", "Corners changed")(checked)
              )
            : null,
          toggle("Shadow", first.shadow, (checked) =>
            styleUpdate("shadow", "Shadow changed")(checked)
          )
        )
      );
    }
    const opacity = el("input", {
      type: "range",
      min: 10,
      max: 100,
      step: 5,
      value: Math.round((first.opacity ?? 1) * 100),
    });
    opacity.addEventListener("input", () =>
      styleUpdate("opacity", "Opacity changed")(Number(opacity.value) / 100, { coalesce: true })
    );
    parts.push(row("Opacity", opacity));
    return section("Style", ...parts);
  }

  function textSection(elements) {
    const styles = elements.map((element) =>
      isServiceNode(element) ? resolveServiceStyle(element) : resolveShapeStyle(element)
    );
    const first = styles[0];
    const labelled =
      elements.length === 1 && !isServiceNode(elements[0]) && elements[0].kind !== "group";
    const parts = [];
    if (labelled) {
      const label = el("textarea", { rows: 2, maxlength: 400 });
      label.value = elements[0].label || "";
      label.addEventListener("input", () =>
        update("Edited label", (e) => void (e.label = label.value), { coalesce: "shape-label" })
      );
      parts.push(row("Label", label));
    }
    parts.push(
      el(
        "div",
        { class: "dg-format-pair" },
        row(
          "Size",
          numberInput(first.fontSize, {
            min: 6,
            max: 96,
            onCommit: styleUpdate("fontSize", "Font size changed"),
          })
        ),
        colourControl("Colour", first.fontColor, {
          allowNone: false,
          onChange: styleUpdate("fontColor", "Text colour changed"),
        })
      ),
      el(
        "div",
        { class: "dg-format-inline", role: "group", "aria-label": "Text style" },
        iconButton("Bold", "<b>B</b>", () => styleUpdate("bold", "Bold toggled")(!first.bold), {
          pressed: Boolean(first.bold),
        }),
        iconButton(
          "Italic",
          "<i>I</i>",
          () => styleUpdate("italic", "Italic toggled")(!first.italic),
          { pressed: Boolean(first.italic) }
        ),
        iconButton(
          "Underline",
          "<u>U</u>",
          () => styleUpdate("underline", "Underline toggled")(!first.underline),
          { pressed: Boolean(first.underline) }
        )
      )
    );
    if (!elements.some(isServiceNode)) {
      parts.push(
        el(
          "div",
          { class: "dg-format-inline" },
          segmented(
            first.align || "center",
            [
              ["left", "⇤", "Align left"],
              ["center", "↔", "Align centre"],
              ["right", "⇥", "Align right"],
            ],
            styleUpdate("align", "Text alignment changed"),
            "Horizontal alignment"
          ),
          segmented(
            first.valign || "middle",
            [
              ["top", "⤒", "Top"],
              ["middle", "↕", "Middle"],
              ["bottom", "⤓", "Bottom"],
            ],
            styleUpdate("valign", "Text alignment changed"),
            "Vertical alignment"
          )
        )
      );
    }
    return section("Text", ...parts);
  }

  function arrangeSection(vertices) {
    const parts = [];
    if (vertices.length === 1) {
      const v = vertices[0];
      const geometry = (key, label) =>
        numberInput(v[key], {
          min: key === "w" || key === "h" ? 8 : -100000,
          max: 100000,
          onCommit: (value) =>
            update(label, (element) => {
              if (key === "x" || key === "y") {
                const delta = value - element[key];
                element[key] = value;
                // Contents travel with a container moved from the panel.
                for (const child of [...editor.doc.nodes, ...editor.doc.shapes]) {
                  if (studio.isInside(child.id, element.id)) child[key] += delta;
                }
              } else {
                element[key] = value;
              }
            }),
        });
      parts.push(
        el(
          "div",
          { class: "dg-format-grid4" },
          row("X", geometry("x", "Moved")),
          row("Y", geometry("y", "Moved")),
          row("W", geometry("w", "Resized")),
          row("H", geometry("h", "Resized"))
        )
      );
    }
    if (vertices.length > 1) {
      parts.push(
        el(
          "div",
          { class: "dg-format-inline dg-align-row", role: "group", "aria-label": "Align" },
          ...["left", "center", "right", "top", "middle", "bottom"].map((mode) =>
            iconButton(`Align ${mode}`, ALIGN_ICONS[mode], () => editor.align(mode))
          )
        ),
        el(
          "div",
          { class: "dg-format-inline", role: "group", "aria-label": "Distribute" },
          iconButton(
            "Distribute horizontally",
            ALIGN_ICONS.horizontal,
            () => editor.distribute("horizontal"),
            { disabled: vertices.length < 3 }
          ),
          iconButton(
            "Distribute vertically",
            ALIGN_ICONS.vertical,
            () => editor.distribute("vertical"),
            { disabled: vertices.length < 3 }
          ),
          el("button", {
            type: "button",
            class: "dg-text-button",
            text: "Group",
            onclick: () => editor.group(),
          })
        )
      );
    }
    const locked = vertices.every((v) => v.locked);
    parts.push(
      el(
        "div",
        { class: "dg-format-actions" },
        el("button", { type: "button", text: "To front", onclick: () => editor.toFront() }),
        el("button", { type: "button", text: "To back", onclick: () => editor.toBack() }),
        vertices.some((v) => v.kind === "group")
          ? el("button", { type: "button", text: "Ungroup", onclick: () => editor.ungroup() })
          : null,
        el("button", {
          type: "button",
          text: locked ? "Unlock" : "Lock",
          onclick: () => editor.toggleLock(),
        })
      )
    );
    return section("Arrange", ...parts);
  }

  function containerSection(container) {
    const presetOptions = Object.entries(CONTAINER_PRESETS).map(([id, preset]) => [
      id,
      preset.label,
    ]);
    const zoneValue = container.zone || "";
    const presetZone = CONTAINER_PRESETS[container.preset]?.zone;
    return section(
      "Container",
      row(
        "Type",
        select(container.preset || "generic", presetOptions, (value) =>
          update("Container type changed", (element) => {
            const previousDefault = CONTAINER_PRESETS[element.preset]?.label;
            element.preset = value;
            if (!element.label || element.label === previousDefault)
              element.label = CONTAINER_PRESETS[value].label;
            element.style = {};
          })
        )
      ),
      row(
        "Trust zone",
        select(
          zoneValue,
          [
            ["", presetZone ? `From type (${ZONES[presetZone].label})` : "None"],
            ...ZONE_IDS.map((id) => [id, ZONES[id].label]),
          ],
          (value) => studio.applyZone(container.id, value || null)
        ),
        "Services inside take on this zone, so the trust review sees your subnets."
      ),
      el("p", {
        class: "dg-format-hint",
        text: `${studio.childCount(container.id)} item(s) inside.`,
      })
    );
  }

  function tableSection(table) {
    const measure = editor.measure;
    const name = el("input", {
      type: "text",
      value: table.label || "",
      maxlength: 64,
      spellcheck: "false",
    });
    name.addEventListener("input", () =>
      update(
        "Renamed table",
        (t) => {
          t.label = name.value;
          fitTable(t, measure);
        },
        { coalesce: "table-name" }
      )
    );
    const setColumns = (label, change, coalesce = null) =>
      update(
        label,
        (t) => {
          const columns = (t.columns || []).map((column) => ({ ...column }));
          change(columns);
          t.columns = columns.filter((column) => column.name);
          fitTable(t, measure, { shrink: true });
        },
        { coalesce }
      );
    const listId = nextId("dg-types");
    const datalist = el(
      "datalist",
      { id: listId },
      ...COMMON_TYPES.map((type) => el("option", { value: type }))
    );
    const rows = (table.columns || []).map((column, index) => {
      const toggleButton = (flag, text, title) => {
        const button = el("button", {
          type: "button",
          class: `dg-col-flag${column[flag] ? " is-on" : ""}`,
          title,
          "aria-label": `${title} — ${column.name}`,
          "aria-pressed": String(Boolean(column[flag])),
          text,
          onclick: () =>
            setColumns(`${title} toggled`, (columns) => {
              const target = columns[index];
              target[flag] = !target[flag];
              if (flag === "pk" && target.pk) {
                target.nullable = false;
                target.unique = false;
              }
              if (flag === "nullable" && target.pk) target.nullable = false;
            }),
        });
        return button;
      };
      const nameInput = el("input", {
        type: "text",
        value: column.name,
        "aria-label": "Column name",
        spellcheck: "false",
        maxlength: 64,
      });
      nameInput.addEventListener("change", () =>
        setColumns(
          "Renamed column",
          (columns) => void (columns[index].name = nameInput.value.trim() || columns[index].name)
        )
      );
      const typeInput = el("input", {
        type: "text",
        value: column.type || "",
        list: listId,
        "aria-label": `Type of ${column.name}`,
        spellcheck: "false",
        maxlength: 64,
      });
      typeInput.addEventListener("change", () =>
        setColumns(
          "Changed column type",
          (columns) => void (columns[index].type = typeInput.value.trim())
        )
      );
      const notNull = el("button", {
        type: "button",
        class: `dg-col-flag${column.nullable === false ? " is-on" : ""}`,
        title: "Not null",
        "aria-label": `Not null — ${column.name}`,
        "aria-pressed": String(column.nullable === false),
        text: "NN",
        onclick: () =>
          setColumns("Nullability toggled", (columns) => {
            const target = columns[index];
            if (!target.pk) target.nullable = target.nullable === false;
          }),
      });
      const remove = el("button", {
        type: "button",
        class: "dg-col-remove",
        title: "Remove column",
        "aria-label": `Remove ${column.name}`,
        text: "×",
        onclick: () => setColumns("Removed column", (columns) => columns.splice(index, 1)),
      });
      return el(
        "div",
        { class: "dg-col-row" },
        toggleButton("pk", "PK", "Primary key"),
        nameInput,
        typeInput,
        notNull,
        toggleButton("unique", "UQ", "Unique"),
        remove
      );
    });
    const add = el("button", {
      type: "button",
      class: "dg-text-button",
      text: "+ Add column",
      onclick: () =>
        setColumns("Added column", (columns) => {
          let n = columns.length + 1;
          while (columns.some((column) => column.name === `column_${n}`)) n += 1;
          columns.push({
            name: `column_${n}`,
            type: "text",
            pk: false,
            nullable: true,
            unique: false,
            default: null,
            autoIncrement: false,
          });
        }),
    });
    return section(
      "Table",
      row("Name", name),
      el(
        "div",
        { class: "dg-col-head", "aria-hidden": "true" },
        el("span", { text: "Key" }),
        el("span", { text: "Column" }),
        el("span", { text: "Type" }),
        el("span", { text: "" })
      ),
      el("div", { class: "dg-col-list" }, ...rows),
      datalist,
      el(
        "div",
        { class: "dg-format-actions" },
        add,
        el("button", {
          type: "button",
          text: "Copy SQL",
          onclick: () => studio.copyTableSql([table.id]),
        })
      ),
      el("p", {
        class: "dg-format-hint",
        text: "Drag a connector from this table to another to add a foreign key.",
      })
    );
  }

  function relationshipSection(edge, source, target) {
    const relation = edge.relation?.fromColumns?.length
      ? edge.relation
      : inferRelation(source, target);
    const fromColumn = relation.fromColumns[0] || "";
    const toColumn = relation.toColumns[0] || "";
    const setRelation = (label, change) =>
      update(label, (connection) => {
        const next = { ...(connection.relation || relation) };
        change(next);
        connection.relation = next;
      });
    const current =
      Object.entries(ER_ENDS).find(
        ([, ends]) =>
          ends.startArrow === (edge.style?.startArrow || "many") &&
          ends.endArrow === (edge.style?.endArrow || "one")
      )?.[0] || "many-to-one";
    return section(
      "Relationship",
      el("p", {
        class: "dg-format-hint",
        text: `${source.label}.${fromColumn || "?"} → ${target.label}.${toColumn || "?"}`,
      }),
      row(
        "Foreign key column",
        select(
          fromColumn,
          [
            ["", "— choose —"],
            ...(source.columns || []).map((column) => [
              column.name,
              `${column.name} ${column.type || ""}`,
            ]),
          ],
          (value) =>
            setRelation("Foreign key changed", (next) => {
              next.fromColumns = value ? [value] : [];
            })
        )
      ),
      row(
        "References",
        select(
          toColumn,
          [
            ["", "— choose —"],
            ...(target.columns || []).map((column) => [
              column.name,
              `${target.label}.${column.name}`,
            ]),
          ],
          (value) =>
            setRelation("Referenced column changed", (next) => {
              next.toColumns = value ? [value] : [];
            })
        )
      ),
      el(
        "div",
        { class: "dg-format-pair" },
        row(
          "Cardinality",
          select(current, Object.entries(CARDINALITY_LABELS), (value) =>
            update(
              "Cardinality changed",
              (connection) =>
                void (connection.style = { ...(connection.style || {}), ...ER_ENDS[value] })
            )
          )
        ),
        row(
          "On delete",
          select(relation.onDelete || "", DELETE_ACTIONS, (value) =>
            setRelation("Delete rule changed", (next) => {
              if (value) next.onDelete = value;
              else delete next.onDelete;
            })
          )
        )
      ),
      el(
        "div",
        { class: "dg-format-actions" },
        el("button", {
          type: "button",
          text: "Match ends to columns",
          title: "Set crow's-foot ends from the key column's nullability and uniqueness",
          onclick: () =>
            update(
              "Relationship ends updated",
              (connection) =>
                void (connection.style = {
                  ...(connection.style || {}),
                  ...relationEnds(source, relation.fromColumns),
                })
            ),
        })
      )
    );
  }

  function connectionSections(edges) {
    const edge = edges[0];
    const style = resolveEdgeStyle(edge);
    const parts = [];
    const doc = editor.doc;
    const both = edges.every(
      (e) => doc.nodes.some((n) => n.id === e.from) && doc.nodes.some((n) => n.id === e.to)
    );
    const sections = [];
    const tableSource =
      edges.length === 1
        ? doc.shapes.find((shape) => shape.id === edge.from && isTable(shape))
        : null;
    const tableTarget =
      edges.length === 1
        ? doc.shapes.find((shape) => shape.id === edge.to && isTable(shape))
        : null;
    if (tableSource && tableTarget)
      sections.push(relationshipSection(edge, tableSource, tableTarget));
    if (edges.length === 1) {
      const label = el("input", { type: "text", value: edge.label || "", maxlength: 120 });
      label.addEventListener("input", () =>
        update("Edited label", (e) => void (e.label = label.value), { coalesce: "edge-label" })
      );
      const fields = [row("Label", label)];
      if (both) {
        fields.push(
          row(
            "Traffic",
            select(
              edge.type || "request",
              TRAFFIC_TYPES.map((t) => [t, TRAFFIC_LABELS[t]]),
              (value) => update("Traffic type changed", (e) => void (e.type = value))
            )
          ),
          toggle("Encrypted in transit", edge.encrypted !== false, (checked) =>
            update(
              checked ? "Marked encrypted" : "Marked plaintext",
              (e) => void (e.encrypted = checked)
            )
          )
        );
        const from = doc.nodes.find((n) => n.id === edge.from);
        const to = doc.nodes.find((n) => n.id === edge.to);
        fields.push(
          el("p", {
            class: "dg-format-hint",
            text: `${from?.name} → ${to?.name} · ${studio.describeCrossing(from, to)}`,
          })
        );
      }
      sections.push(section("Connection", ...fields));
    }
    parts.push(
      row(
        "Routing",
        segmented(
          style.routing,
          [
            ["orthogonal", "⌐", "Orthogonal (routes around shapes)"],
            ["straight", "╱", "Straight"],
            ["curved", "∿", "Curved"],
          ],
          (value) =>
            update("Routing changed", (e) => {
              e.style = { ...(e.style || {}), routing: value };
              e.waypoints = [];
            }),
          "Routing"
        )
      ),
      colourControl("Line", style.stroke, {
        allowNone: false,
        onChange: (value, extra = {}) =>
          update(
            "Line colour changed",
            (e) => void (e.style = { ...(e.style || {}), stroke: value }),
            { coalesce: extra.coalesce ? "edge-stroke" : null }
          ),
      }),
      el(
        "div",
        { class: "dg-format-pair" },
        row(
          "Width",
          numberInput(style.strokeWidth, {
            min: 0.5,
            max: 12,
            step: 0.5,
            onCommit: (value) =>
              update(
                "Line width changed",
                (e) => void (e.style = { ...(e.style || {}), strokeWidth: value })
              ),
          })
        ),
        row(
          "Pattern",
          select(
            style.dash || "solid",
            [
              ["solid", "Solid"],
              ["dashed", "Dashed"],
              ["dotted", "Dotted"],
            ],
            (value) =>
              update(
                "Line pattern changed",
                (e) => void (e.style = { ...(e.style || {}), dash: value })
              )
          )
        )
      ),
      el(
        "div",
        { class: "dg-format-pair" },
        row(
          "Start",
          select(
            style.startArrow,
            ARROW_KINDS.map((a) => [a, ARROW_LABELS[a]]),
            (value) =>
              update(
                "Arrow changed",
                (e) => void (e.style = { ...(e.style || {}), startArrow: value })
              )
          )
        ),
        row(
          "End",
          select(
            style.endArrow,
            ARROW_KINDS.map((a) => [a, ARROW_LABELS[a]]),
            (value) =>
              update(
                "Arrow changed",
                (e) => void (e.style = { ...(e.style || {}), endArrow: value })
              )
          )
        )
      ),
      el(
        "div",
        { class: "dg-format-toggles" },
        toggle("Rounded", style.rounded !== false, (checked) =>
          update(
            "Corners changed",
            (e) => void (e.style = { ...(e.style || {}), rounded: checked })
          )
        ),
        toggle("Animate flow", style.animated, (checked) =>
          update(
            checked ? "Flow animation on" : "Flow animation off",
            (e) => void (e.style = { ...(e.style || {}), animated: checked })
          )
        )
      ),
      row(
        "Label size",
        numberInput(style.fontSize, {
          min: 6,
          max: 48,
          onCommit: (value) =>
            update(
              "Label size changed",
              (e) => void (e.style = { ...(e.style || {}), fontSize: value })
            ),
        })
      ),
      el(
        "div",
        { class: "dg-format-actions" },
        el("button", {
          type: "button",
          text: "Reset route",
          onclick: () =>
            update("Reset connector route", (e) => {
              e.waypoints = [];
              e.fromPort = "auto";
              e.toPort = "auto";
            }),
        }),
        el("button", {
          type: "button",
          text: "Reverse",
          onclick: () =>
            update("Reversed connector", (e) => {
              [e.from, e.to] = [e.to, e.from];
              [e.fromPoint, e.toPoint] = [e.toPoint, e.fromPoint];
              if (!e.fromPoint) delete e.fromPoint;
              if (!e.toPoint) delete e.toPoint;
              [e.fromPort, e.toPort] = [e.toPort, e.fromPort];
              e.waypoints = [...(e.waypoints || [])].reverse();
            }),
        })
      )
    );
    sections.push(section("Line", ...parts));
    return sections;
  }

  // Re-rendering replaces every control, so wait while someone is typing in
  // a field (or dragging a slider or colour well) — but not after a button
  // or swatch click, which would otherwise leave the panel stale.
  const EDITING_SELECTOR =
    'input:not([type]), input[type="text"], input[type="number"], input[type="range"], input[type="color"], input[type="search"], textarea';

  function render() {
    const active = document.activeElement;
    if (active && container.contains(active) && active.matches?.(EDITING_SELECTOR)) {
      pendingRender = true;
      return;
    }
    pendingRender = false;
    // Remember which control had focus so keyboard users land back on it.
    const focusKey =
      active && container.contains(active)
        ? active.dataset?.focusKey || active.getAttribute("aria-label")
        : null;
    const doc = editor.doc;
    if (!doc) return;
    const selected = editor.selectedElements();
    const vertices = selected.filter((element) => "w" in element);
    const edges = selected.filter((element) => !("w" in element));
    const sections = [];
    const heading = el("div", { class: "dg-format-heading" });
    if (!selected.length) {
      heading.append(el("strong", { text: "Diagram" }), el("small", { text: "Nothing selected" }));
      sections.push(...diagramSections());
    } else {
      const summary = studio.describe(selected);
      heading.append(el("strong", { text: summary.title }), el("small", { text: summary.detail }));
      if (vertices.length === 1 && isServiceNode(vertices[0]))
        sections.push(serviceSection(vertices[0]));
      if (vertices.length === 1 && isContainer(vertices[0]))
        sections.push(containerSection(vertices[0]));
      if (vertices.length === 1 && isTable(vertices[0])) sections.push(tableSection(vertices[0]));
      if (vertices.length && !edges.length) {
        const styled = vertices.filter((v) => v.kind !== "group");
        if (styled.length) sections.push(styleSection(styled));
        if (styled.length && !styled.every(isTable))
          sections.push(textSection(styled.filter((v) => !isTable(v))));
        sections.push(arrangeSection(vertices));
      }
      if (edges.length && !vertices.length) sections.push(...connectionSections(edges));
      if (edges.length && vertices.length) {
        sections.push(
          section(
            "Mixed selection",
            el("p", {
              class: "dg-format-hint",
              text: "Select only shapes or only connectors to edit their style.",
            })
          ),
          arrangeSection(vertices)
        );
      }
    }
    container.replaceChildren(heading, ...sections);
    if (focusKey) {
      const match = [...container.querySelectorAll("[data-focus-key], [aria-label]")].find(
        (node) => (node.dataset.focusKey || node.getAttribute("aria-label")) === focusKey
      );
      match?.focus({ preventScroll: true });
    }
  }

  container.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (pendingRender && !container.contains(document.activeElement)) render();
    });
  });

  return { render };
}
