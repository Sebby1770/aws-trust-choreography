import { describe, expect, it } from "vitest";
import {
  describeStatement,
  gradeFor,
  lineOf,
  maskLiterals,
  reviewSql,
  scoreFindings,
  splitStatements,
  statementKind,
} from "../src/sql-review.js";

const idsOf = (result) => result.findings.map((f) => f.id);
const has = (result, id) => idsOf(result).includes(id);

describe("literal masking", () => {
  it("blanks line and block comments but keeps length and newlines", () => {
    const sql = "SELECT 1 -- drop table users\nFROM t /* delete everything */ WHERE x = 1";
    const masked = maskLiterals(sql);
    expect(masked).toHaveLength(sql.length);
    expect(masked.split("\n")).toHaveLength(sql.split("\n").length);
    expect(masked).not.toMatch(/drop table/i);
    expect(masked).not.toMatch(/delete everything/i);
    expect(masked).toMatch(/SELECT 1/);
    expect(masked).toMatch(/WHERE x = 1/);
  });

  it("blanks string contents so keywords inside them are not analysed", () => {
    const masked = maskLiterals("SELECT 'DROP TABLE users' AS note FROM t");
    expect(masked).not.toMatch(/DROP TABLE/);
    expect(masked).toMatch(/AS note FROM t/);
  });

  it("handles escaped and doubled quotes without running off the end", () => {
    const masked = maskLiterals("SELECT 'it''s fine', 'a\\'b' FROM t WHERE x = 1");
    expect(masked).toMatch(/FROM t WHERE x = 1/);
  });

  it("does not treat a comment marker inside a string as a comment", () => {
    const masked = maskLiterals("SELECT '-- not a comment' FROM t WHERE y = 2");
    expect(masked).toMatch(/FROM t WHERE y = 2/);
  });
});

describe("statement splitting", () => {
  it("splits on top-level semicolons only", () => {
    const parts = splitStatements("SELECT 1; SELECT ';' ; -- ;\nSELECT 3;");
    expect(parts).toHaveLength(3);
  });

  it("ignores trailing whitespace-only fragments", () => {
    expect(splitStatements("SELECT 1;   \n  ")).toHaveLength(1);
  });

  it("keeps a statement with no trailing semicolon", () => {
    expect(splitStatements("SELECT 1")).toHaveLength(1);
  });
});

describe("line numbers", () => {
  it("counts from one", () => {
    const sql = "SELECT 1\nFROM t\nWHERE x = 1";
    expect(lineOf(sql, 0)).toBe(1);
    expect(lineOf(sql, sql.indexOf("FROM"))).toBe(2);
    expect(lineOf(sql, sql.indexOf("WHERE"))).toBe(3);
  });

  it("reports the line of a finding in a later statement", () => {
    const sql = "SELECT 1;\n\nDELETE FROM users";
    const result = reviewSql(sql);
    const found = result.findings.find((f) => f.id === "destructive-without-where");
    expect(found.line).toBe(3);
  });
});

describe("statement description", () => {
  it("identifies kinds", () => {
    expect(statementKind("SELECT 1")).toBe("select");
    expect(statementKind("  update t set a = 1")).toBe("update");
    expect(statementKind("WITH x AS (SELECT 1) SELECT * FROM x")).toBe("select");
    expect(statementKind("TRUNCATE TABLE t")).toBe("truncate");
    expect(statementKind("EXPLAIN ANALYZE foo")).toBe("unknown");
  });

  it("extracts tables, CTEs and joins", () => {
    const info = describeStatement(`
      WITH recent AS (SELECT * FROM orders)
      SELECT u.id FROM users u
      LEFT JOIN recent r ON r.user_id = u.id
      INNER JOIN accounts a ON a.user_id = u.id
      WHERE u.active GROUP BY u.id ORDER BY u.id LIMIT 10`);
    expect(info.kind).toBe("select");
    expect(info.tables).toEqual(expect.arrayContaining(["orders", "users", "recent", "accounts"]));
    expect(info.ctes).toContain("recent");
    expect(info.joinCount).toBe(2);
    expect(info.joins).toEqual(expect.arrayContaining(["left", "inner"]));
    expect(info.hasWhere).toBe(true);
    expect(info.hasGroupBy).toBe(true);
    expect(info.hasOrderBy).toBe(true);
    expect(info.hasLimit).toBe(true);
  });
});

describe("destructive statements", () => {
  it("flags UPDATE and DELETE without WHERE as critical", () => {
    for (const sql of ["DELETE FROM users", "UPDATE users SET active = false"]) {
      const result = reviewSql(sql);
      const found = result.findings.find((f) => f.id === "destructive-without-where");
      expect(found, sql).toBeTruthy();
      expect(found.severity).toBe("critical");
    }
  });

  it("does not flag them when a WHERE is present", () => {
    expect(has(reviewSql("DELETE FROM users WHERE id = 1"), "destructive-without-where")).toBe(
      false
    );
  });

  it("is not fooled by the word delete inside a comment or string", () => {
    const result = reviewSql("SELECT 'delete from users' AS s FROM t -- delete from t\n");
    expect(has(result, "destructive-without-where")).toBe(false);
  });

  it("flags DROP and TRUNCATE", () => {
    expect(has(reviewSql("DROP TABLE users"), "drop-or-truncate")).toBe(true);
    expect(has(reviewSql("TRUNCATE TABLE users"), "drop-or-truncate")).toBe(true);
  });
});

describe("join hazards", () => {
  it("flags a JOIN with no ON or USING", () => {
    expect(has(reviewSql("SELECT * FROM a JOIN b"), "cartesian-join")).toBe(true);
  });

  it("accepts a join with ON or USING", () => {
    expect(has(reviewSql("SELECT a.x FROM a JOIN b ON b.id = a.b_id"), "cartesian-join")).toBe(
      false
    );
    expect(has(reviewSql("SELECT a.x FROM a JOIN b USING (id)"), "cartesian-join")).toBe(false);
  });

  it("flags a comma join with no WHERE", () => {
    expect(has(reviewSql("SELECT a.x, b.y FROM a, b"), "cartesian-join")).toBe(true);
  });

  it("does not flag a comma join that is related in WHERE", () => {
    const result = reviewSql("SELECT a.x FROM a, b WHERE a.b_id = b.id");
    expect(has(result, "cartesian-join")).toBe(false);
  });

  it("flags NATURAL JOIN", () => {
    expect(has(reviewSql("SELECT * FROM a NATURAL JOIN b"), "natural-join")).toBe(true);
  });
});

describe("performance rules", () => {
  it("flags SELECT *", () => {
    expect(has(reviewSql("SELECT * FROM t"), "select-star")).toBe(true);
  });

  it("treats SELECT * across a join as more serious than on a single table", () => {
    const single = reviewSql("SELECT * FROM t").findings.find((f) => f.id === "select-star");
    const joined = reviewSql("SELECT * FROM a JOIN b ON b.id = a.b_id").findings.find(
      (f) => f.id === "select-star"
    );
    expect(single.severity).toBe("info");
    expect(joined.severity).toBe("warning");
  });

  it("flags a leading wildcard LIKE", () => {
    expect(has(reviewSql("SELECT id FROM t WHERE name LIKE '%smith'"), "leading-wildcard")).toBe(
      true
    );
    expect(has(reviewSql("SELECT id FROM t WHERE name LIKE 'smith%'"), "leading-wildcard")).toBe(
      false
    );
  });

  it("flags a function wrapped around a column in WHERE", () => {
    const result = reviewSql("SELECT id FROM t WHERE YEAR(created_at) = 2024");
    expect(has(result, "non-sargable-function")).toBe(true);
  });

  it("flags ORDER BY with no LIMIT, and accepts one with LIMIT", () => {
    expect(has(reviewSql("SELECT id FROM t ORDER BY id"), "order-by-without-limit")).toBe(true);
    expect(has(reviewSql("SELECT id FROM t ORDER BY id LIMIT 10"), "order-by-without-limit")).toBe(
      false
    );
  });

  it("flags DISTINCT over a join but not on its own", () => {
    expect(
      has(reviewSql("SELECT DISTINCT a.id FROM a JOIN b ON b.a_id = a.id"), "distinct-over-join")
    ).toBe(true);
    expect(has(reviewSql("SELECT DISTINCT id FROM a"), "distinct-over-join")).toBe(false);
  });

  it("distinguishes UNION from UNION ALL", () => {
    expect(has(reviewSql("SELECT 1 UNION SELECT 2"), "union-vs-union-all")).toBe(true);
    expect(has(reviewSql("SELECT 1 UNION ALL SELECT 2"), "union-vs-union-all")).toBe(false);
  });

  it("flags a correlated subquery in the select list", () => {
    const sql =
      "SELECT u.id, (SELECT count(*) FROM orders o WHERE o.user_id = u.id) AS n FROM users u";
    expect(has(reviewSql(sql), "correlated-subquery-in-select")).toBe(true);
  });

  it("flags a large OFFSET only past the threshold", () => {
    expect(has(reviewSql("SELECT id FROM t LIMIT 10 OFFSET 50000"), "large-offset")).toBe(true);
    expect(has(reviewSql("SELECT id FROM t LIMIT 10 OFFSET 20"), "large-offset")).toBe(false);
  });

  it("flags NOT IN against a subquery", () => {
    expect(
      has(reviewSql("SELECT id FROM a WHERE id NOT IN (SELECT a_id FROM b)"), "not-in-nullable")
    ).toBe(true);
  });

  it("flags HAVING with no GROUP BY", () => {
    expect(
      has(reviewSql("SELECT count(*) FROM t HAVING count(*) > 1"), "having-without-group-by")
    ).toBe(true);
    expect(
      has(
        reviewSql("SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > 1"),
        "having-without-group-by"
      )
    ).toBe(false);
  });
});

describe("injection risk", () => {
  it("flags interpolated values", () => {
    expect(
      has(reviewSql("SELECT * FROM users WHERE email = '${email}'"), "interpolated-value")
    ).toBe(true);
    expect(
      has(reviewSql("SELECT * FROM users WHERE email = ' + email + '"), "interpolated-value")
    ).toBe(true);
  });

  it("does not flag bound parameters", () => {
    expect(has(reviewSql("SELECT * FROM users WHERE email = $1"), "interpolated-value")).toBe(
      false
    );
    expect(has(reviewSql("SELECT * FROM users WHERE email = :email"), "interpolated-value")).toBe(
      false
    );
  });
});

describe("scoring", () => {
  it("gives clean SQL a perfect score", () => {
    const result = reviewSql("SELECT id, email FROM users WHERE id = $1 LIMIT 1");
    expect(result.findings).toEqual([]);
    expect(result.score).toBe(100);
    expect(result.grade).toBe("A");
  });

  it("weights critical findings hardest and never goes below zero", () => {
    expect(scoreFindings([{ severity: "info" }])).toBe(97);
    expect(scoreFindings([{ severity: "warning" }])).toBe(90);
    expect(scoreFindings([{ severity: "critical" }])).toBe(75);
    expect(scoreFindings(Array.from({ length: 20 }, () => ({ severity: "critical" })))).toBe(0);
  });

  it("maps scores to grades", () => {
    expect(gradeFor(100)).toBe("A");
    expect(gradeFor(80)).toBe("B");
    expect(gradeFor(65)).toBe("C");
    expect(gradeFor(45)).toBe("D");
    expect(gradeFor(10)).toBe("F");
  });

  it("counts findings by severity", () => {
    const result = reviewSql("DELETE FROM users");
    expect(result.counts.critical).toBeGreaterThan(0);
    expect(result.counts.critical + result.counts.warning + result.counts.info).toBe(
      result.findings.length
    );
  });
});

describe("review shape", () => {
  it("reports empty input without inventing findings", () => {
    for (const input of ["", "   \n ", null, undefined]) {
      const result = reviewSql(input);
      expect(result.empty).toBe(true);
      expect(result.findings).toEqual([]);
      expect(result.score).toBe(100);
    }
  });

  it("orders findings worst-first, then by line", () => {
    const sql = `SELECT * FROM a ORDER BY id;
DELETE FROM users;`;
    const result = reviewSql(sql);
    const ranks = result.findings.map((f) => ["critical", "warning", "info"].indexOf(f.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("reviews every statement in a script", () => {
    const result = reviewSql("DELETE FROM a;\nDELETE FROM b;");
    expect(result.statements).toHaveLength(2);
    expect(result.findings.filter((f) => f.id === "destructive-without-where")).toHaveLength(2);
  });

  it("is deterministic", () => {
    const sql = "SELECT * FROM a JOIN b ON b.a_id = a.id WHERE name LIKE '%x' ORDER BY a.id";
    expect(reviewSql(sql)).toEqual(reviewSql(sql));
  });

  it("gives every finding an actionable fix", () => {
    const sql = `DELETE FROM users;
SELECT * FROM a JOIN b;
SELECT id FROM t WHERE name LIKE '%x' ORDER BY id;`;
    const result = reviewSql(sql);
    expect(result.findings.length).toBeGreaterThan(3);
    for (const item of result.findings) {
      expect(item.fix, item.id).toBeTruthy();
      expect(item.detail, item.id).toBeTruthy();
      expect(SEVERITY_SET.has(item.severity), item.id).toBe(true);
      expect(item.line, item.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("survives malformed SQL without throwing", () => {
    for (const sql of [
      "SELECT FROM WHERE",
      "((((",
      "'unterminated",
      "/* unclosed",
      "SELECT 1 FROM",
    ]) {
      expect(() => reviewSql(sql), sql).not.toThrow();
    }
  });
});

const SEVERITY_SET = new Set(["critical", "warning", "info"]);
