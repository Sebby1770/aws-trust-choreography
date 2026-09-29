import { describe, expect, it } from "vitest";
import {
  dependencyOrder,
  looksLikeSchema,
  parseSchema,
  quoteIdentifier,
  SAMPLE_SCHEMA,
  singular,
  toDDL,
  tokenize,
} from "../src/sql-schema.js";

const table = (schema, name) => schema.tables.find((candidate) => candidate.name === name);
const column = (entry, name) => entry.columns.find((candidate) => candidate.name === name);

describe("tokenize", () => {
  it("drops comments, unwraps quoted identifiers, and keeps strings", () => {
    const tokens = tokenize(
      `-- note\nCREATE TABLE "Order Items" /* x */ (a text DEFAULT 'it''s', b int[]);`
    );
    expect(tokens.map((token) => token.value)).toEqual([
      "CREATE",
      "TABLE",
      "Order Items",
      "(",
      "a",
      "text",
      "DEFAULT",
      "it's",
      ",",
      "b",
      "int",
      "[]",
      ")",
      ";",
    ]);
    expect(tokens[2].quoted).toBe(true);
  });

  it("treats dollar-quoted bodies as one string", () => {
    const tokens = tokenize("CREATE FUNCTION f() RETURNS void AS $$ BEGIN; END; $$ LANGUAGE sql;");
    expect(tokens.filter((token) => token.value === ";")).toHaveLength(1);
  });
});

describe("parseSchema", () => {
  const schema = parseSchema(SAMPLE_SCHEMA);

  it("reads every table, column, type and constraint", () => {
    expect(schema.tables.map((entry) => entry.name)).toEqual([
      "customers",
      "products",
      "orders",
      "order_items",
    ]);
    expect(column(table(schema, "customers"), "email")).toMatchObject({
      type: "VARCHAR(255)",
      nullable: false,
      unique: true,
    });
    expect(column(table(schema, "customers"), "id")).toMatchObject({
      pk: true,
      autoIncrement: true,
      nullable: false,
    });
    expect(column(table(schema, "orders"), "status").default).toBe("'pending'");
    expect(schema.warnings).toEqual([]);
  });

  it("folds composite primary keys and table-level foreign keys", () => {
    const items = table(schema, "order_items");
    expect(items.primaryKey).toEqual(["order_id", "product_id"]);
    expect(items.foreignKeys.map((fk) => `${fk.columns}->${fk.refTable}.${fk.refColumns}`)).toEqual(
      ["order_id->orders.id", "product_id->products.id"]
    );
    expect(items.foreignKeys[0].onDelete).toBe("CASCADE");
  });

  it("reads inline REFERENCES", () => {
    expect(table(schema, "orders").foreignKeys[0]).toMatchObject({
      columns: ["customer_id"],
      refTable: "customers",
      refColumns: ["id"],
    });
  });

  it("copes with MySQL and SQL Server flavours", () => {
    const parsed = parseSchema(`
      CREATE TABLE \`users\` (
        \`id\` int unsigned NOT NULL AUTO_INCREMENT,
        \`email\` varchar(255) CHARACTER SET utf8mb4 NOT NULL,
        updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_email\` (\`email\`),
        KEY \`idx_updated\` (\`updated_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='people';
      CREATE TABLE [dbo].[Posts] ([Id] INT IDENTITY(1,1) PRIMARY KEY, [UserId] INT NOT NULL);
      ALTER TABLE [dbo].[Posts] ADD CONSTRAINT FK_Posts_Users FOREIGN KEY ([UserId]) REFERENCES users(id);
    `);
    const users = table(parsed, "users");
    expect(users.comment).toBe("people");
    expect(column(users, "id")).toMatchObject({
      type: "int unsigned",
      pk: true,
      autoIncrement: true,
    });
    expect(column(users, "email")).toMatchObject({ unique: true, nullable: false });
    expect(column(users, "updated_at").default).toBe("CURRENT_TIMESTAMP");
    const posts = table(parsed, "Posts");
    expect(posts.schema).toBe("dbo");
    expect(column(posts, "Id").autoIncrement).toBe(true);
    expect(posts.foreignKeys[0]).toMatchObject({
      name: "FK_Posts_Users",
      refTable: "users",
      columns: ["UserId"],
    });
    expect(parsed.statements.alters).toBe(1);
  });

  it("resolves an implicit referenced column to the parent's primary key", () => {
    const parsed = parseSchema(
      "CREATE TABLE a (code text PRIMARY KEY); CREATE TABLE b (a_code text REFERENCES a);"
    );
    expect(table(parsed, "b").foreignKeys[0].refColumns).toEqual(["code"]);
  });

  it("warns about references to undefined tables and ignores data statements", () => {
    const parsed = parseSchema(
      "SELECT 1; CREATE TABLE x (y_id int REFERENCES y(id)); INSERT INTO x VALUES (1);"
    );
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.statements.skipped).toBe(2);
    expect(parsed.warnings[0]).toMatch(/references y/);
  });

  it("recognises schema SQL", () => {
    expect(looksLikeSchema("create temporary table t (a int)")).toBe(true);
    expect(looksLikeSchema("select * from t")).toBe(false);
  });
});

describe("toDDL", () => {
  it("creates referenced tables first and round-trips through the parser", () => {
    const shuffled = parseSchema(SAMPLE_SCHEMA);
    shuffled.tables.reverse();
    const ddl = toDDL(shuffled);
    expect(ddl.indexOf("CREATE TABLE customers")).toBeLessThan(ddl.indexOf("CREATE TABLE orders"));
    expect(ddl.indexOf("CREATE TABLE orders")).toBeLessThan(
      ddl.indexOf("CREATE TABLE order_items")
    );
    expect(ddl).toContain("PRIMARY KEY (order_id, product_id)");
    const again = parseSchema(ddl);
    expect(again.tables.map((entry) => entry.name).sort()).toEqual([
      "customers",
      "order_items",
      "orders",
      "products",
    ]);
    expect(table(again, "order_items").foreignKeys).toHaveLength(2);
  });

  it("speaks each dialect", () => {
    const schema = parseSchema(
      'CREATE TABLE t (id bigserial PRIMARY KEY, doc jsonb, flag boolean, "select" text);'
    );
    const mysql = toDDL(schema, { dialect: "mysql" });
    expect(mysql).toContain("id bigint AUTO_INCREMENT PRIMARY KEY");
    expect(mysql).toContain("doc json");
    expect(mysql).toContain("`select` text");
    const sqlite = toDDL(schema, { dialect: "sqlite" });
    expect(sqlite).toContain("id integer PRIMARY KEY AUTOINCREMENT");
    const postgres = toDDL(schema);
    expect(postgres).toContain("id bigserial PRIMARY KEY");
    expect(postgres).toContain('"select" text');
  });

  it("breaks foreign-key cycles with ALTER TABLE", () => {
    const schema = parseSchema(
      "CREATE TABLE a (id int PRIMARY KEY, b_id int REFERENCES b(id)); CREATE TABLE b (id int PRIMARY KEY, a_id int REFERENCES a(id));"
    );
    const { deferred } = dependencyOrder(schema.tables);
    expect(deferred.size).toBe(1);
    expect(toDDL(schema)).toMatch(/ALTER TABLE \w+ ADD CONSTRAINT/);
  });

  it("quotes only when needed", () => {
    expect(quoteIdentifier("orders")).toBe("orders");
    expect(quoteIdentifier("Order Items")).toBe('"Order Items"');
    expect(quoteIdentifier("user", "mysql")).toBe("`user`");
  });

  it("singularises table names for key columns", () => {
    expect(singular("customers")).toBe("customer");
    expect(singular("categories")).toBe("category");
    expect(singular("addresses")).toBe("address");
    expect(singular("status")).toBe("status");
  });
});
