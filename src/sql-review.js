/**
 * SQL review — a pure, dependency-free static analyser.
 *
 * Everything here runs locally with no network and no key: paste SQL, get a
 * structural read of it plus findings you can act on. The optional Claude
 * assist (src/sql-assist.js) is layered on top and never required.
 *
 * The analysis works on a *masked* copy of the SQL where comments and string
 * literals are blanked out but every character offset is preserved. That is
 * what stops a rule matching the word "delete" inside a comment, or a `%`
 * inside a quoted string reading as a leading wildcard, while still letting
 * findings report accurate line numbers against the original text.
 */

export const SEVERITIES = Object.freeze(["critical", "warning", "info"]);

const SEVERITY_WEIGHT = { critical: 25, warning: 10, info: 3 };

/**
 * Replace comments and string/identifier literals with spaces, preserving
 * length and newlines so offsets and line numbers still line up.
 */
export function maskLiterals(sql) {
  const source = String(sql ?? "");
  let out = "";
  let i = 0;

  const blank = (text) => text.replace(/[^\n]/g, " ");

  while (i < source.length) {
    const two = source.slice(i, i + 2);

    if (two === "--") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }

    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }

    const char = source[i];
    if (char === "'" || char === '"' || char === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        // Doubled quote is an escaped quote inside the literal.
        if (source[j] === char && source[j + 1] === char) {
          j += 2;
          continue;
        }
        if (source[j] === char) {
          j += 1;
          break;
        }
        j += 1;
      }
      // Keep the delimiters so `'...'` is still recognisable as a literal.
      out +=
        char +
        blank(source.slice(i + 1, Math.max(i + 1, j - 1))) +
        (source[j - 1] === char ? char : "");
      i = j;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

/**
 * Blank comments only, keeping string contents intact.
 *
 * Some rules have to inspect the literal itself — a leading `%` in a LIKE
 * pattern is invisible once strings are masked — but must still not match
 * inside a comment.
 */
export function maskComments(sql) {
  const source = String(sql ?? "");
  let out = "";
  let i = 0;
  const blank = (text) => text.replace(/[^\n]/g, " ");

  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "--") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    // Skip over string literals wholesale so a `--` inside one is preserved.
    const char = source[i];
    if (char === "'" || char === '"' || char === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === char && source[j + 1] === char) {
          j += 2;
          continue;
        }
        if (source[j] === char) {
          j += 1;
          break;
        }
        j += 1;
      }
      out += source.slice(i, j);
      i = j;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Split on semicolons that are not inside a literal or comment. */
export function splitStatements(sql) {
  const masked = maskLiterals(sql);
  const parts = [];
  let start = 0;

  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ";") {
      parts.push({ text: String(sql).slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (start < String(sql).length) {
    parts.push({ text: String(sql).slice(start), offset: start });
  }

  return parts.filter((part) => part.text.trim().length > 0);
}

export function lineOf(sql, offset) {
  if (offset <= 0) return 1;
  let line = 1;
  const text = String(sql);
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

const STATEMENT_KINDS = [
  ["select", /^\s*(?:with\b[\s\S]*?)?\bselect\b/i],
  ["insert", /^\s*insert\b/i],
  ["update", /^\s*update\b/i],
  ["delete", /^\s*delete\b/i],
  ["create", /^\s*create\b/i],
  ["alter", /^\s*alter\b/i],
  ["drop", /^\s*drop\b/i],
  ["truncate", /^\s*truncate\b/i],
  ["grant", /^\s*(?:grant|revoke)\b/i],
];

export function statementKind(text) {
  const masked = maskLiterals(text);
  for (const [kind, pattern] of STATEMENT_KINDS) {
    if (pattern.test(masked)) return kind;
  }
  return "unknown";
}

/** Structural read of one statement: tables, joins, CTEs, clauses present. */
export function describeStatement(text) {
  const masked = maskLiterals(text);
  const kind = statementKind(text);

  const tables = new Set();
  const tablePattern = /\b(?:from|join|into|update)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)*)/gi;
  for (const match of masked.matchAll(tablePattern)) {
    const name = match[1];
    if (!/^(select|values|set|where)$/i.test(name)) tables.add(name);
  }

  const ctes = new Set();
  const cteBlock = masked.match(/\bwith\b([\s\S]*?)\bselect\b/i);
  if (cteBlock) {
    for (const match of cteBlock[1].matchAll(/([a-zA-Z_][\w$]*)\s+as\s*\(/gi)) {
      ctes.add(match[1]);
    }
  }

  const joins = [...masked.matchAll(/\b(inner|left|right|full|cross|natural)?\s*join\b/gi)].map(
    (m) => (m[1] || "inner").toLowerCase()
  );

  return {
    kind,
    tables: [...tables],
    ctes: [...ctes],
    joins,
    joinCount: joins.length,
    hasWhere: /\bwhere\b/i.test(masked),
    hasGroupBy: /\bgroup\s+by\b/i.test(masked),
    hasOrderBy: /\border\s+by\b/i.test(masked),
    hasLimit: /\b(limit|fetch\s+first|top)\b/i.test(masked),
    hasDistinct: /\bselect\s+distinct\b/i.test(masked),
    subqueryCount: (masked.match(/\(\s*select\b/gi) || []).length,
  };
}

function finding(id, severity, title, detail, fix, line) {
  return { id, severity, title, detail, fix, line };
}

/**
 * The rule set. Each rule sees the original statement text, the masked copy,
 * and the structural description, and returns zero or more findings.
 */
const RULES = [
  {
    id: "destructive-without-where",
    run({ masked, info, lineAt }) {
      if (!["update", "delete"].includes(info.kind) || info.hasWhere) return [];
      const at = masked.search(/\b(update|delete)\b/i);
      return [
        finding(
          "destructive-without-where",
          "critical",
          `${info.kind.toUpperCase()} with no WHERE clause`,
          `This ${info.kind}s every row in ${info.tables[0] || "the table"}.`,
          "Add a WHERE clause, and run it as a SELECT first to see exactly which rows match.",
          lineAt(at)
        ),
      ];
    },
  },
  {
    id: "drop-or-truncate",
    run({ masked, info, lineAt }) {
      if (!["drop", "truncate"].includes(info.kind)) return [];
      return [
        finding(
          "drop-or-truncate",
          "critical",
          `${info.kind.toUpperCase()} statement`,
          "This is irreversible on most engines and will not be caught by a transaction on some (DDL auto-commits in MySQL and Oracle).",
          "Confirm you have a backup or a tested restore path before running this outside a scratch database.",
          lineAt(masked.search(/\b(drop|truncate)\b/i))
        ),
      ];
    },
  },
  {
    id: "cartesian-join",
    run({ masked, info, lineAt }) {
      const results = [];
      // JOIN with no ON/USING — every row against every row.
      // The alias is optional — but ON/USING must never be mistaken for one,
      // or `JOIN b USING (id)` reads as an un-joined table.
      const joinPattern =
        /\b(?:inner|left|right|full)?\s*join\s+[a-zA-Z_][\w$.]*(?:\s+(?:as\s+)?(?!on\b|using\b)[a-zA-Z_][\w$]*)?/gi;
      for (const match of masked.matchAll(joinPattern)) {
        const after = masked.slice(
          match.index + match[0].length,
          match.index + match[0].length + 40
        );
        if (/^\s*(on|using)\b/i.test(after)) continue;
        if (/\bcross\s+join\b/i.test(match[0])) continue;
        results.push(
          finding(
            "cartesian-join",
            "critical",
            "JOIN without an ON or USING condition",
            "Every row of one table is paired with every row of the other, so the result set is the product of both row counts.",
            "Add the join key: `JOIN other ON other.id = base.other_id`. If a cross join is genuinely intended, write CROSS JOIN so it reads as deliberate.",
            lineAt(match.index)
          )
        );
      }
      // Old-style comma joins with no WHERE to relate them.
      if (
        info.kind === "select" &&
        !info.hasWhere &&
        /\bfrom\s+[a-zA-Z_][\w$.]*\s*(?:as\s+\w+\s*)?,/i.test(masked)
      ) {
        results.push(
          finding(
            "cartesian-join",
            "critical",
            "Comma join with no WHERE clause",
            "Listing tables separated by commas without a WHERE that relates them produces a cartesian product.",
            "Use explicit `JOIN ... ON ...` syntax so the join condition cannot be forgotten.",
            lineAt(masked.search(/\bfrom\b/i))
          )
        );
      }
      return results;
    },
  },
  {
    id: "not-in-nullable",
    run({ masked, lineAt }) {
      const at = masked.search(/\bnot\s+in\s*\(\s*select\b/i);
      if (at === -1) return [];
      return [
        finding(
          "not-in-nullable",
          "warning",
          "NOT IN with a subquery",
          "If the subquery returns even one NULL, NOT IN evaluates to UNKNOWN for every row and the query silently returns zero rows.",
          "Prefer `NOT EXISTS (SELECT 1 FROM ... WHERE ...)`, which is NULL-safe and usually plans better.",
          lineAt(at)
        ),
      ];
    },
  },
  {
    id: "select-star",
    run({ masked, info, lineAt }) {
      const at = masked.search(/\bselect\s+(?:distinct\s+)?\*/i);
      if (at === -1) return [];
      return [
        finding(
          "select-star",
          info.joinCount > 0 ? "warning" : "info",
          "SELECT *",
          "Fetches every column, including ones you do not use, and quietly changes shape when a column is added. Across a join it also duplicates the join keys.",
          "List the columns you actually need — it reduces I/O and makes the query resilient to schema changes.",
          lineAt(at)
        ),
      ];
    },
  },
  {
    id: "leading-wildcard",
    run({ commentMasked, lineAt }) {
      // Needs the literal's contents, so it reads the comment-masked copy.
      const at = commentMasked.search(/\blike\s+'%/i);
      if (at === -1) return [];
      return [
        finding(
          "leading-wildcard",
          "warning",
          "LIKE pattern starting with a wildcard",
          "A leading `%` means a B-tree index on that column cannot be used, so this scans the table.",
          "Anchor the pattern (`LIKE 'foo%'`) if you can, or move to a full-text or trigram index for genuine substring search.",
          lineAt(at)
        ),
      ];
    },
  },
  {
    id: "non-sargable-function",
    run({ masked, lineAt }) {
      const pattern =
        /\bwhere\b[\s\S]*?\b(year|month|day|date|upper|lower|trim|cast|coalesce|substring)\s*\(\s*[a-zA-Z_][\w$.]*\s*\)?[^)]*\)\s*(=|<|>|<=|>=|between|like)/i;
      const match = masked.match(pattern);
      if (!match) return [];
      return [
        finding(
          "non-sargable-function",
          "warning",
          `Function applied to a column in WHERE (${match[1].toUpperCase()})`,
          "Wrapping a column in a function stops the planner using an index on it — the function has to be evaluated for every row.",
          "Rewrite as a range over the raw column, e.g. `created_at >= '2024-01-01' AND created_at < '2025-01-01'` instead of `YEAR(created_at) = 2024`. Otherwise add an expression index.",
          lineAt(match.index)
        ),
      ];
    },
  },
  {
    id: "order-by-without-limit",
    run({ info, masked, lineAt }) {
      if (info.kind !== "select" || !info.hasOrderBy || info.hasLimit) return [];
      return [
        finding(
          "order-by-without-limit",
          "info",
          "ORDER BY without LIMIT",
          "The engine sorts the entire result set even if the caller only reads the first rows.",
          "Add a LIMIT when you only need the top rows — it lets the planner use a top-N sort instead of sorting everything.",
          lineAt(masked.search(/\border\s+by\b/i))
        ),
      ];
    },
  },
  {
    id: "distinct-over-join",
    run({ info, masked, lineAt }) {
      if (!info.hasDistinct || info.joinCount === 0) return [];
      return [
        finding(
          "distinct-over-join",
          "warning",
          "SELECT DISTINCT over a join",
          "DISTINCT after a join is often there to hide duplicate rows produced by a one-to-many join, at the cost of a full sort or hash of the result.",
          "Check whether the join fans out. If it does, an EXISTS subquery or aggregating the child rows expresses the intent directly and avoids the dedupe.",
          lineAt(masked.search(/\bdistinct\b/i))
        ),
      ];
    },
  },
  {
    id: "union-vs-union-all",
    run({ masked, lineAt }) {
      const at = masked.search(/\bunion\b(?!\s+all\b)/i);
      if (at === -1) return [];
      return [
        finding(
          "union-vs-union-all",
          "info",
          "UNION deduplicates",
          "UNION sorts or hashes both sides to remove duplicates, which is often wasted work when the branches cannot overlap.",
          "Use UNION ALL when duplicates are impossible or acceptable.",
          lineAt(at)
        ),
      ];
    },
  },
  {
    id: "correlated-subquery-in-select",
    run({ masked, lineAt }) {
      const selectList = masked.match(/\bselect\b([\s\S]*?)\bfrom\b/i);
      if (!selectList) return [];
      const at = selectList[1].search(/\(\s*select\b/i);
      if (at === -1) return [];
      return [
        finding(
          "correlated-subquery-in-select",
          "warning",
          "Subquery in the SELECT list",
          "A correlated subquery in the select list is evaluated once per returned row — the SQL equivalent of an N+1 query.",
          "Move it to a LEFT JOIN against a grouped subquery, or a window function, so it is computed once.",
          lineAt(selectList.index + at)
        ),
      ];
    },
  },
  {
    id: "implicit-string-comparison",
    run({ masked, lineAt }) {
      const match = masked.match(/\b([a-zA-Z_][\w$]*(?:id|_id|count|qty|number))\s*=\s*'/i);
      if (!match) return [];
      return [
        finding(
          "implicit-string-comparison",
          "info",
          `Numeric-looking column compared to a string (${match[1]})`,
          "Comparing a numeric column to a quoted literal forces an implicit cast, which on several engines disables the index on that column.",
          "Drop the quotes if the column is numeric, or confirm the column really is text.",
          lineAt(match.index)
        ),
      ];
    },
  },
  {
    id: "large-offset",
    run({ masked, lineAt }) {
      const match = masked.match(/\boffset\s+(\d+)/i);
      if (!match || Number(match[1]) < 1000) return [];
      return [
        finding(
          "large-offset",
          "warning",
          `Large OFFSET (${match[1]})`,
          "The engine still reads and discards every skipped row, so deep pages get linearly slower.",
          "Use keyset pagination — `WHERE id > :last_seen_id ORDER BY id LIMIT n` — which stays constant-time at any depth.",
          lineAt(match.index)
        ),
      ];
    },
  },
  {
    id: "interpolated-value",
    run({ text, lineAt }) {
      // Concatenation or template markers inside the SQL string itself.
      const match = text.match(/(\$\{[^}]*\}|'\s*\+\s*\w+|\+\s*\w+\s*\+\s*'|%s\b|\?\?)/);
      if (!match) return [];
      return [
        finding(
          "interpolated-value",
          "critical",
          "Value looks interpolated into the SQL",
          "String-built SQL is how injection happens, and it also defeats the statement cache because every call is a new query text.",
          "Use bound parameters — `WHERE email = $1` / `?` — and pass values separately. Never concatenate user input.",
          lineAt(match.index)
        ),
      ];
    },
  },
  {
    id: "having-without-group-by",
    run({ info, masked, lineAt }) {
      if (info.hasGroupBy || !/\bhaving\b/i.test(masked)) return [];
      return [
        finding(
          "having-without-group-by",
          "info",
          "HAVING without GROUP BY",
          "HAVING filters after aggregation. With no GROUP BY it applies to the single implicit group, which is usually not what was meant.",
          "If you are filtering individual rows, use WHERE — it runs before aggregation and can use indexes.",
          lineAt(masked.search(/\bhaving\b/i))
        ),
      ];
    },
  },
  {
    id: "natural-join",
    run({ masked, lineAt }) {
      const at = masked.search(/\bnatural\s+join\b/i);
      if (at === -1) return [];
      return [
        finding(
          "natural-join",
          "warning",
          "NATURAL JOIN",
          "It joins on whatever columns happen to share a name, so adding a column to either table can silently change the join and the result.",
          "Write the join condition explicitly with ON.",
          lineAt(at)
        ),
      ];
    },
  },
];

/** Deterministic ordering: worst first, then by line, then by id. */
function sortFindings(findings) {
  const rank = { critical: 0, warning: 1, info: 2 };
  return [...findings].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || a.line - b.line || a.id.localeCompare(b.id)
  );
}

export function scoreFindings(findings) {
  const penalty = findings.reduce(
    (total, item) => total + (SEVERITY_WEIGHT[item.severity] ?? 0),
    0
  );
  return Math.max(0, 100 - penalty);
}

export function gradeFor(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Review a SQL script.
 *
 * @param {string} sql
 * @returns {{empty: boolean, statements: object[], findings: object[],
 *            score: number, grade: string, counts: object}}
 */
export function reviewSql(sql) {
  const text = String(sql ?? "");
  if (!text.trim()) {
    return {
      empty: true,
      statements: [],
      findings: [],
      score: 100,
      grade: "A",
      counts: { critical: 0, warning: 0, info: 0 },
    };
  }

  const parts = splitStatements(text);
  const statements = [];
  const findings = [];

  for (const part of parts) {
    const info = describeStatement(part.text);
    const masked = maskLiterals(part.text);
    const commentMasked = maskComments(part.text);
    const lineAt = (localOffset) =>
      lineOf(text, part.offset + Math.max(0, localOffset === -1 ? 0 : localOffset));

    statements.push({
      ...info,
      line: lineOf(text, part.offset + (part.text.match(/^\s*/)?.[0].length ?? 0)),
    });

    for (const rule of RULES) {
      try {
        findings.push(...rule.run({ text: part.text, masked, commentMasked, info, lineAt }));
      } catch {
        // A malformed fragment must never take the whole review down.
      }
    }
  }

  const sorted = sortFindings(findings);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const item of sorted) counts[item.severity] += 1;

  const score = scoreFindings(sorted);
  return {
    empty: false,
    statements,
    findings: sorted,
    score,
    grade: gradeFor(score),
    counts,
  };
}
