/**
 * SQL schema ⇄ model.
 *
 * `parseSchema` reads DDL — `CREATE TABLE`, `ALTER TABLE … ADD`, inline and
 * table-level primary, unique and foreign keys — from PostgreSQL, MySQL,
 * SQLite and SQL Server flavoured SQL into a plain model. `toDDL` writes that
 * model back out as clean, dependency-ordered DDL for a chosen dialect.
 *
 * Both run entirely in the browser. The parser is deliberately forgiving: it
 * skips what it does not understand (indexes, checks, options, data
 * statements) and reports it, rather than failing a whole schema over one
 * vendor-specific clause.
 */

export const DIALECTS = {
  postgres: { label: "PostgreSQL", quote: '"' },
  mysql: { label: "MySQL", quote: "`" },
  sqlite: { label: "SQLite", quote: '"' },
};

const RESERVED = new Set(
  (
    "all and any as asc between by case check collate column constraint create cross current_date " +
    "current_time current_timestamp default desc distinct drop else end except false fetch for foreign " +
    "from full grant group having in index inner insert intersect into is join key left like limit not " +
    "null offset on or order outer primary references right select set table then to true union unique " +
    "update user using values when where with"
  ).split(" ")
);

// ------------------------------------------------------------- tokenizer

/**
 * Tokenise SQL, dropping comments. Identifiers keep their exact spelling;
 * quoted identifiers ("x", `x`, [x]) are unwrapped and flagged.
 *
 * @returns {Array<{type: string, value: string, upper: string, quoted?: boolean}>}
 */
export function tokenize(sql) {
  const source = String(sql ?? "");
  const tokens = [];
  let i = 0;
  const push = (type, value, extra = {}) =>
    tokens.push({ type, value, upper: value.toUpperCase(), ...extra });
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (char === "#" && (i === 0 || source[i - 1] === "\n")) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (char === "[" && next === "]") {
      push("op", "[]");
      i += 2;
      continue;
    }
    if (char === "$") {
      // PostgreSQL dollar quoting: $$ … $$ or $tag$ … $tag$.
      const tag = /^\$[A-Za-z_]*\$/.exec(source.slice(i));
      if (tag) {
        const end = source.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? source.length : end + tag[0].length;
        push("string", source.slice(i + tag[0].length, end === -1 ? source.length : end), {
          raw: source.slice(i, stop),
        });
        i = stop;
        continue;
      }
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      let j = i + 1;
      let value = "";
      while (j < source.length) {
        if (source[j] === "\\" && char === "'") {
          value += source[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (source[j] === close && source[j + 1] === close && close !== "]") {
          value += close;
          j += 2;
          continue;
        }
        if (source[j] === close) break;
        value += source[j];
        j += 1;
      }
      if (char === "'") push("string", value, { raw: source.slice(i, j + 1) });
      else push("ident", value, { quoted: true });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(next || ""))) {
      const match = /^[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?/i.exec(source.slice(i));
      push("number", match[0]);
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_À-￿$@]/.test(char)) {
      const match = /^[A-Za-z_À-￿$@#][A-Za-z0-9_À-￿$@#]*/.exec(source.slice(i));
      push("ident", match[0]);
      i += match[0].length;
      continue;
    }
    if (char === ":" && next === ":") {
      push("op", "::");
      i += 2;
      continue;
    }
    push(/[(),;.]/.test(char) ? "punct" : "op", char);
    i += 1;
  }
  return tokens;
}

function splitTokens(tokens, separator) {
  const parts = [];
  let depth = 0;
  let current = [];
  for (const token of tokens) {
    if (token.value === "(" && token.type === "punct") depth += 1;
    if (token.value === ")" && token.type === "punct") depth -= 1;
    if (depth === 0 && token.type === "punct" && token.value === separator) {
      if (current.length) parts.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length) parts.push(current);
  return parts;
}

/** Render tokens back to readable SQL text. */
export function joinTokens(tokens) {
  let text = "";
  let previous = null;
  for (const token of tokens) {
    const value =
      token.type === "string"
        ? token.raw || `'${token.value.replace(/'/g, "''")}'`
        : token.quoted
          ? quoteAlways(token.value)
          : token.value;
    const tight =
      !previous ||
      previous.value === "(" ||
      previous.value === "." ||
      previous.value === "::" ||
      token.value === ")" ||
      token.value === "," ||
      token.value === "." ||
      token.value === "::" ||
      (token.value === "(" && previous.type === "ident") ||
      token.value === "[]";
    text += (tight ? "" : " ") + value;
    previous = token;
  }
  return text.replace(/,(?=\S)/g, ", ");
}

function quoteAlways(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------- parser

class Cursor {
  constructor(tokens) {
    this.tokens = tokens;
    this.index = 0;
  }
  peek(offset = 0) {
    return this.tokens[this.index + offset];
  }
  done() {
    return this.index >= this.tokens.length;
  }
  next() {
    return this.tokens[this.index++];
  }
  is(...words) {
    return words.every(
      (word, offset) => this.peek(offset)?.upper === word && !this.peek(offset)?.quoted
    );
  }
  accept(...words) {
    if (!this.is(...words)) return false;
    this.index += words.length;
    return true;
  }
  /** Consume a balanced parenthesised group, returning its inner tokens. */
  group() {
    if (this.peek()?.value !== "(") return null;
    this.next();
    const inner = [];
    let depth = 1;
    while (!this.done()) {
      const token = this.next();
      if (token.value === "(" && token.type === "punct") depth += 1;
      if (token.value === ")" && token.type === "punct") {
        depth -= 1;
        if (depth === 0) break;
      }
      inner.push(token);
    }
    return inner;
  }
  /** A possibly schema-qualified name. */
  qualifiedName() {
    const parts = [];
    const first = this.peek();
    if (!first || first.type !== "ident") return null;
    parts.push(this.next().value);
    while (this.peek()?.value === "." && this.peek(1)?.type === "ident") {
      this.next();
      parts.push(this.next().value);
    }
    return {
      name: parts[parts.length - 1],
      schema: parts.length > 1 ? parts.slice(0, -1).join(".") : null,
    };
  }
}

function identList(tokens) {
  return splitTokens(tokens || [], ",")
    .map((part) => part.find((token) => token.type === "ident"))
    .filter(Boolean)
    .map((token) => token.value);
}

const COLUMN_STOP = new Set([
  "NOT",
  "NULL",
  "PRIMARY",
  "UNIQUE",
  "DEFAULT",
  "REFERENCES",
  "CHECK",
  "CONSTRAINT",
  "AUTO_INCREMENT",
  "AUTOINCREMENT",
  "IDENTITY",
  "GENERATED",
  "COLLATE",
  "COMMENT",
  "ON",
  "AS",
]);

const TYPE_WORDS = new Set([
  "UNSIGNED",
  "SIGNED",
  "ZEROFILL",
  "VARYING",
  "PRECISION",
  "WITH",
  "WITHOUT",
  "TIME",
  "ZONE",
  "LOCAL",
  "CHARACTER",
  "CHAR",
  "INTERVAL",
  "BYTE",
]);

function parseReference(cursor) {
  const target = cursor.qualifiedName();
  const columns = identList(cursor.group());
  const reference = {
    refTable: target?.name || "",
    refSchema: target?.schema || null,
    refColumns: columns,
  };
  for (;;) {
    if (cursor.accept("ON", "DELETE") || cursor.accept("ON", "UPDATE")) {
      const which = cursor.tokens[cursor.index - 1].upper === "DELETE" ? "onDelete" : "onUpdate";
      const words = [];
      while (
        !cursor.done() &&
        ["CASCADE", "RESTRICT", "NO", "ACTION", "SET", "NULL", "DEFAULT"].includes(
          cursor.peek().upper
        )
      ) {
        words.push(cursor.next().upper);
      }
      reference[which] = words.join(" ");
      continue;
    }
    if (cursor.accept("MATCH")) {
      cursor.next();
      continue;
    }
    if (cursor.accept("DEFERRABLE") || cursor.accept("NOT", "DEFERRABLE")) {
      if (cursor.accept("INITIALLY")) cursor.next();
      continue;
    }
    break;
  }
  return reference;
}

function parseColumn(tokens) {
  const cursor = new Cursor(tokens);
  const nameToken = cursor.next();
  const column = {
    name: nameToken.value,
    type: "",
    nullable: true,
    pk: false,
    unique: false,
    default: null,
    autoIncrement: false,
    comment: "",
  };
  const typeTokens = [];
  while (!cursor.done()) {
    const token = cursor.peek();
    if (
      token.type === "ident" &&
      !token.quoted &&
      COLUMN_STOP.has(token.upper) &&
      !(token.upper === "CHARACTER" || TYPE_WORDS.has(token.upper))
    )
      break;
    if (token.value === "(") {
      typeTokens.push(cursor.next());
      let depth = 1;
      while (!cursor.done() && depth) {
        const inner = cursor.next();
        if (inner.value === "(") depth += 1;
        if (inner.value === ")") depth -= 1;
        typeTokens.push(inner);
      }
      continue;
    }
    // SET and ENUM value lists stay with the type; charset clauses join it.
    typeTokens.push(cursor.next());
  }
  column.type = joinTokens(typeTokens);
  const reference = { value: null };
  while (!cursor.done()) {
    if (cursor.accept("NOT", "NULL")) column.nullable = false;
    else if (cursor.accept("NULL")) column.nullable = true;
    else if (cursor.accept("PRIMARY", "KEY")) {
      column.pk = true;
      column.nullable = false;
      cursor.accept("ASC") || cursor.accept("DESC");
      if (cursor.accept("AUTOINCREMENT")) column.autoIncrement = true;
    } else if (cursor.accept("UNIQUE")) {
      column.unique = true;
      cursor.accept("KEY");
    } else if (cursor.accept("DEFAULT")) {
      const expression = [];
      let depth = 0;
      while (!cursor.done()) {
        const token = cursor.peek();
        if (
          depth === 0 &&
          token.type === "ident" &&
          !token.quoted &&
          COLUMN_STOP.has(token.upper) &&
          token.upper !== "NULL"
        )
          break;
        if (depth === 0 && token.upper === "NULL" && expression.length) break;
        if (token.value === "(") depth += 1;
        if (token.value === ")") depth -= 1;
        expression.push(cursor.next());
      }
      column.default = joinTokens(expression);
    } else if (cursor.accept("REFERENCES")) {
      reference.value = parseReference(cursor);
    } else if (cursor.accept("CHECK")) {
      cursor.group();
    } else if (cursor.accept("CONSTRAINT")) {
      cursor.next();
    } else if (cursor.accept("AUTO_INCREMENT") || cursor.accept("AUTOINCREMENT")) {
      column.autoIncrement = true;
    } else if (cursor.accept("IDENTITY")) {
      column.autoIncrement = true;
      cursor.group();
    } else if (cursor.accept("GENERATED")) {
      const identity = [];
      while (!cursor.done() && !cursor.is("IDENTITY") && cursor.peek().value !== "(")
        identity.push(cursor.next().upper);
      if (cursor.accept("IDENTITY")) {
        column.autoIncrement = true;
        cursor.group();
      } else {
        cursor.group();
        cursor.accept("STORED") || cursor.accept("VIRTUAL");
      }
    } else if (cursor.accept("AS")) {
      cursor.group();
      cursor.accept("STORED") || cursor.accept("VIRTUAL") || cursor.accept("PERSISTED");
    } else if (cursor.accept("COLLATE")) {
      cursor.next();
    } else if (cursor.accept("COMMENT")) {
      const comment = cursor.next();
      column.comment = comment?.type === "string" ? comment.value : "";
    } else if (cursor.accept("ON", "UPDATE")) {
      cursor.next();
      cursor.group();
    } else {
      cursor.next();
    }
  }
  if (/^(small|big)?serial\d?$/i.test(column.type)) column.autoIncrement = true;
  return { column, reference: reference.value };
}

function parseTableElements(tokens, table, warnings) {
  for (const element of splitTokens(tokens, ",")) {
    const cursor = new Cursor(element);
    let constraintName = null;
    if (cursor.accept("CONSTRAINT")) constraintName = cursor.next()?.value || null;
    if (cursor.accept("PRIMARY", "KEY")) {
      table.primaryKey = identList(cursor.group());
      continue;
    }
    if (cursor.is("UNIQUE")) {
      cursor.next();
      cursor.accept("KEY") || cursor.accept("INDEX");
      if (cursor.peek()?.type === "ident") cursor.next();
      const columns = identList(cursor.group());
      if (columns.length) table.uniques.push(columns);
      continue;
    }
    if (cursor.accept("FOREIGN", "KEY")) {
      if (cursor.peek()?.type === "ident") cursor.next();
      const columns = identList(cursor.group());
      if (!cursor.accept("REFERENCES")) continue;
      table.foreignKeys.push({ name: constraintName, columns, ...parseReference(cursor) });
      continue;
    }
    if (cursor.is("CHECK") || cursor.is("EXCLUDE")) continue;
    if (
      ["KEY", "INDEX", "FULLTEXT", "SPATIAL"].includes(cursor.peek()?.upper) &&
      !cursor.peek()?.quoted
    )
      continue;
    if (cursor.is("LIKE")) {
      warnings.push(`${table.name}: LIKE copies are not expanded.`);
      continue;
    }
    if (constraintName) continue;
    if (!element.length || element[0].type !== "ident") continue;
    const { column, reference } = parseColumn(element);
    table.columns.push(column);
    if (reference) table.foreignKeys.push({ name: null, columns: [column.name], ...reference });
  }
}

/**
 * Parse DDL into a schema model.
 *
 * @param {string} sql
 * @returns {{tables: Array, warnings: string[], statements: {tables: number, alters: number, skipped: number}}}
 */
export function parseSchema(sql) {
  const tokens = tokenize(sql);
  const statements = splitTokens(tokens, ";");
  const tables = [];
  const warnings = [];
  const counts = { tables: 0, alters: 0, skipped: 0 };
  const find = (name) =>
    tables.find((table) => table.name.toLowerCase() === String(name).toLowerCase());

  for (const statement of statements) {
    const cursor = new Cursor(statement);
    if (cursor.accept("CREATE")) {
      cursor.accept("OR", "REPLACE");
      while (
        ["TEMP", "TEMPORARY", "UNLOGGED", "GLOBAL", "LOCAL", "VIRTUAL"].includes(
          cursor.peek()?.upper
        )
      )
        cursor.next();
      if (!cursor.accept("TABLE")) {
        counts.skipped += 1;
        continue;
      }
      cursor.accept("IF", "NOT", "EXISTS");
      const target = cursor.qualifiedName();
      if (!target) continue;
      if (cursor.is("AS") || cursor.peek()?.value !== "(") {
        warnings.push(`${target.name}: CREATE TABLE … AS / USING is not expanded.`);
        continue;
      }
      const table = {
        name: target.name,
        schema: target.schema,
        columns: [],
        primaryKey: [],
        uniques: [],
        foreignKeys: [],
        comment: "",
      };
      parseTableElements(cursor.group(), table, warnings);
      while (!cursor.done()) {
        if (cursor.accept("COMMENT")) {
          cursor.accept("=");
          const comment = cursor.next();
          if (comment?.type === "string") table.comment = comment.value;
        } else cursor.next();
      }
      const existing = find(table.name);
      if (existing) tables.splice(tables.indexOf(existing), 1, table);
      else tables.push(table);
      counts.tables += 1;
      continue;
    }
    if (cursor.accept("ALTER", "TABLE")) {
      cursor.accept("ONLY");
      cursor.accept("IF", "EXISTS");
      const target = cursor.qualifiedName();
      const table = target && find(target.name);
      if (!table) {
        counts.skipped += 1;
        continue;
      }
      counts.alters += 1;
      for (const action of splitTokens(statement.slice(cursor.index), ",")) {
        const inner = new Cursor(action);
        if (!inner.accept("ADD")) continue;
        if (inner.accept("COLUMN")) inner.accept("IF", "NOT", "EXISTS");
        const rest = action.slice(inner.index);
        const constraintWords = [
          "CONSTRAINT",
          "PRIMARY",
          "FOREIGN",
          "UNIQUE",
          "CHECK",
          "INDEX",
          "KEY",
        ];
        if (constraintWords.includes(rest[0]?.upper) && !rest[0]?.quoted)
          parseTableElements(rest, table, warnings);
        else if (rest.length) {
          const { column, reference } = parseColumn(rest);
          table.columns.push(column);
          if (reference)
            table.foreignKeys.push({ name: null, columns: [column.name], ...reference });
        }
      }
      continue;
    }
    if (statement.length) counts.skipped += 1;
  }

  // Fold table-level keys onto columns, resolve implicit reference columns.
  for (const table of tables) {
    for (const name of table.primaryKey) {
      const column = table.columns.find(
        (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
      );
      if (column) {
        column.pk = true;
        column.nullable = false;
      }
    }
    if (!table.primaryKey.length)
      table.primaryKey = table.columns.filter((column) => column.pk).map((column) => column.name);
    for (const unique of table.uniques) {
      if (unique.length !== 1) continue;
      const column = table.columns.find(
        (candidate) => candidate.name.toLowerCase() === unique[0].toLowerCase()
      );
      if (column && !column.pk) column.unique = true;
    }
    for (const foreignKey of table.foreignKeys) {
      if (!foreignKey.refColumns.length) {
        const parent = find(foreignKey.refTable);
        foreignKey.refColumns = parent?.primaryKey.length ? [...parent.primaryKey] : ["id"];
      }
      if (!find(foreignKey.refTable)) {
        warnings.push(
          `${table.name}.${foreignKey.columns.join(", ")} references ${foreignKey.refTable}, which is not defined here.`
        );
      }
    }
  }
  return { tables, warnings, statements: counts };
}

/** True when text contains at least one CREATE TABLE statement. */
export function looksLikeSchema(sql) {
  return /\bcreate\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|unlogged|global|local)\s+)*table\b/i.test(
    String(sql || "")
  );
}

// ------------------------------------------------------------- generator

export function quoteIdentifier(name, dialect = "postgres") {
  const text = String(name ?? "");
  if (/^[a-z_][a-z0-9_]*$/.test(text) && !RESERVED.has(text)) return text;
  const quote = DIALECTS[dialect]?.quote || '"';
  return `${quote}${text.split(quote).join(quote + quote)}${quote}`;
}

/** Order tables so referenced tables are created first; report cycles. */
export function dependencyOrder(tables) {
  const byName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
  const ordered = [];
  const state = new Map();
  const deferred = new Set();
  const visit = (table, path = new Set()) => {
    const key = table.name.toLowerCase();
    if (state.get(key) === 2) return;
    state.set(key, 1);
    path.add(key);
    for (const foreignKey of table.foreignKeys || []) {
      const parent = byName.get(String(foreignKey.refTable).toLowerCase());
      if (!parent || parent === table) continue;
      if (state.get(parent.name.toLowerCase()) === 1) {
        deferred.add(foreignKey);
        continue;
      }
      visit(parent, path);
    }
    state.set(key, 2);
    ordered.push(table);
  };
  tables.forEach((table) => visit(table));
  return { ordered, deferred };
}

function mapType(type, column, dialect) {
  let text = String(type || "").trim() || (dialect === "mysql" ? "varchar(255)" : "text");
  if (dialect === "mysql") {
    text = text
      .replace(/^bigserial$/i, "bigint")
      .replace(/^serial$/i, "int")
      .replace(/^timestamptz$/i, "timestamp");
    text = text
      .replace(/^uuid$/i, "char(36)")
      .replace(/^jsonb$/i, "json")
      .replace(/^boolean$/i, "tinyint(1)");
  } else if (dialect === "sqlite") {
    if (/int|serial/i.test(text)) text = "integer";
    else if (/char|text|uuid|json|enum/i.test(text)) text = "text";
    else if (/real|floa|doub|numeric|decimal/i.test(text)) text = "real";
  } else if (column.autoIncrement && /^int(eger)?$/i.test(text)) {
    text = "integer";
  }
  return text;
}

/**
 * Write a schema model as DDL.
 *
 * @param {{tables: Array}} schema
 * @param {{dialect?: "postgres"|"mysql"|"sqlite", header?: string}} options
 */
export function toDDL(schema, { dialect = "postgres", header = "" } = {}) {
  const tables = schema?.tables || [];
  const q = (name) => quoteIdentifier(name, dialect);
  const { ordered, deferred } = dependencyOrder(tables);
  const lines = [];
  if (header) lines.push(...header.split("\n").map((line) => `-- ${line}`), "");
  for (const table of ordered) {
    const body = [];
    const pk = table.primaryKey?.length
      ? table.primaryKey
      : table.columns.filter((column) => column.pk).map((column) => column.name);
    const inlinePk = pk.length === 1;
    for (const column of table.columns) {
      const type = mapType(column.type, column, dialect);
      const parts = [q(column.name), type];
      const isPk = inlinePk && column.name === pk[0];
      if (!isPk && column.nullable === false) parts.push("NOT NULL");
      if (column.default !== null && column.default !== undefined && column.default !== "")
        parts.push(`DEFAULT ${column.default}`);
      // Identity comes before the key everywhere except SQLite, whose
      // AUTOINCREMENT is only legal straight after PRIMARY KEY.
      if (column.autoIncrement && !/serial/i.test(type)) {
        if (dialect === "mysql") parts.push("AUTO_INCREMENT");
        else if (dialect === "postgres") parts.push("GENERATED BY DEFAULT AS IDENTITY");
      }
      if (isPk) parts.push("PRIMARY KEY");
      if (column.autoIncrement && dialect === "sqlite" && isPk && !/serial/i.test(type))
        parts.push("AUTOINCREMENT");
      if (column.unique && !isPk) parts.push("UNIQUE");
      if (column.comment && dialect === "mysql")
        parts.push(`COMMENT '${column.comment.replace(/'/g, "''")}'`);
      body.push(`  ${parts.join(" ")}`);
    }
    if (pk.length > 1) body.push(`  PRIMARY KEY (${pk.map(q).join(", ")})`);
    for (const unique of table.uniques || []) {
      if (unique.length > 1) body.push(`  UNIQUE (${unique.map(q).join(", ")})`);
    }
    for (const foreignKey of table.foreignKeys || []) {
      if (deferred.has(foreignKey)) continue;
      body.push(`  ${foreignKeyClause(table, foreignKey, q)}`);
    }
    const name = table.schema ? `${q(table.schema)}.${q(table.name)}` : q(table.name);
    lines.push(`CREATE TABLE ${name} (`, body.join(",\n"), `);`, "");
  }
  for (const table of ordered) {
    for (const foreignKey of table.foreignKeys || []) {
      if (!deferred.has(foreignKey)) continue;
      const name = table.schema ? `${q(table.schema)}.${q(table.name)}` : q(table.name);
      lines.push(`ALTER TABLE ${name} ADD ${foreignKeyClause(table, foreignKey, q)};`);
    }
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

function foreignKeyClause(table, foreignKey, q) {
  const name =
    foreignKey.name ||
    `fk_${table.name}_${foreignKey.columns.join("_")}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const target = foreignKey.refSchema
    ? `${q(foreignKey.refSchema)}.${q(foreignKey.refTable)}`
    : q(foreignKey.refTable);
  let clause = `CONSTRAINT ${q(name)} FOREIGN KEY (${foreignKey.columns.map(q).join(", ")}) REFERENCES ${target} (${foreignKey.refColumns.map(q).join(", ")})`;
  if (foreignKey.onDelete) clause += ` ON DELETE ${foreignKey.onDelete}`;
  if (foreignKey.onUpdate) clause += ` ON UPDATE ${foreignKey.onUpdate}`;
  return clause;
}

/** `categories` → `category`, `people` → `person`, `status` → `status`. */
export function singular(name) {
  const text = String(name || "");
  const lower = text.toLowerCase();
  if (lower.endsWith("ies") && text.length > 4) return `${text.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(lower)) return text;
  if (/(xes|ches|shes|sses)$/.test(lower)) return text.slice(0, -2);
  if (lower === "people") return `${text.slice(0, -6)}person`;
  if (lower.endsWith("s") && text.length > 2) return text.slice(0, -1);
  return text;
}

export const SAMPLE_SCHEMA = `-- A small commerce schema. Paste your own CREATE TABLE statements.
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  sku VARCHAR(64) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0)
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (order_id, product_id),
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products (id)
);
`;
