import { describe, expect, it } from "vitest";
import {
  accessMapBlueprint,
  actionAccessLevel,
  actionMatches,
  analyzePolicy,
  directionFor,
  formatPolicy,
  gradeFor,
  isAccountPrincipal,
  leastPrivilegeFromDiagram,
  limitsCaller,
  parsePolicy,
  principalLabel,
  principalList,
  resourceName,
  SAMPLE_POLICY,
  SAMPLE_TRUST_POLICY,
  serviceOf,
  slug,
} from "../src/iam-policy.js";
import { buildTemplate, TEMPLATE_IDS } from "../src/diagram/templates.js";

const VERSION = "2012-10-17";
const policy = (statements) => ({ Version: VERSION, Statement: statements });
const allow = (fields) => ({ Effect: "Allow", ...fields });
const review = (input) => analyzePolicy(typeof input === "string" ? input : formatPolicy(input));
const ids = (result) => result.findings.map((finding) => finding.id);
const finding = (result, id) => result.findings.find((entry) => entry.id === id);

const GITHUB = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com";
const fakeIcon = (name, type = "service") => ({
  id: name,
  name,
  type,
  category: "x",
  path: "p",
});

// ------------------------------------------------------------ parsing

describe("parsePolicy", () => {
  it("treats blank input as empty", () => {
    expect(parsePolicy("   ")).toMatchObject({ empty: true, statements: [] });
    expect(analyzePolicy("")).toMatchObject({ empty: true, score: null, grade: "—" });
  });

  it("reports invalid JSON with a line number", () => {
    const result = review('{\n  "Version": "2012-10-17"\n  "Statement": []\n}');
    expect(result.grade).toBe("F");
    expect(result.counts.invalid).toBe(1);
    expect(result.findings[0]).toMatchObject({ id: "invalid", line: 3 });
    expect(result.findings[0].title).toMatch(/^Not valid JSON/);
  });

  it("unwraps CloudFormation and CLI wrappers, including string-encoded documents", () => {
    const document = policy([allow({ Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" })]);
    for (const wrapped of [
      { PolicyDocument: document },
      { AssumeRolePolicyDocument: document },
      { Policy: JSON.stringify(document) },
    ]) {
      expect(review(wrapped).statements).toHaveLength(1);
    }
  });

  it("accepts a bare statement or an array of statements", () => {
    const statement = allow({ Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" });
    expect(review(statement).statements).toHaveLength(1);
    expect(review([statement, statement]).statements).toHaveLength(2);
    expect(analyzePolicy(policy([statement])).statements).toHaveLength(1);
  });

  it("anchors each statement to the line it starts on, ignoring braces inside strings", () => {
    const text = `{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "Braces{in}[strings]", "Effect": "Allow", "Action": "s3:GetObject", "Resource": "arn:aws:s3:::b/{x}" },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "*"
    }
  ]
}`;
    expect(parsePolicy(text).statements.map((statement) => statement.line)).toEqual([4, 5]);
  });

  it("rejects documents with no statements", () => {
    expect(review({ Version: VERSION }).findings[0].title).toMatch(/No Statement found/);
    const empty = review(policy([]));
    expect(empty.findings.map((entry) => entry.title)).toEqual([
      "The Statement list is empty — this policy grants nothing",
    ]);
    expect(empty.grade).toBe("F");
  });
});

describe("statement validation", () => {
  it.each([['"oops"'], ["null"], ["1"]])("does not crash on a non-object statement (%s)", (raw) => {
    const result = analyzePolicy(`{"Version":"2012-10-17","Statement":[${raw}]}`);
    expect(ids(result)).toContain("invalid");
    expect(result.grade).toBe("F");
  });

  it("treats Effect as case-sensitive and does not review an invalid one as Allow", () => {
    const result = review(policy([{ Effect: "deny", Action: "*", Resource: "*" }]));
    expect(ids(result)).toEqual(["invalid"]);
    expect(result.findings[0].title).toMatch(/Effect must be "Allow" or "Deny" \(got "deny"\)/);
  });

  it("accepts action names in any case, as IAM does", () => {
    const result = review(
      policy([allow({ Action: ["ec2:describeinstances", "IAM:ListAccessKeys"], Resource: "*" })])
    );
    expect(result.findings).toEqual([]);
    expect(result.grade).toBe("A");
  });

  it("flags malformed actions and statements without an Action", () => {
    expect(ids(review(policy([allow({ Action: "s3GetObject", Resource: "*" })])))).toContain(
      "invalid"
    );
    const noAction = review(policy([allow({ Resource: "*" })]));
    expect(ids(noAction)).toEqual(["invalid"]);
  });

  it("requires a Resource in identity policies and grades unsaveable policies F", () => {
    const result = review(allow({ Action: "s3:GetObject" }));
    expect(ids(result)).toContain("missing-resource");
    expect(result.grade).toBe("F");
  });

  it("rejects duplicate Sids as invalid", () => {
    const result = review(
      policy([
        allow({ Sid: "A", Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" }),
        allow({ Sid: "A", Action: "s3:PutObject", Resource: "arn:aws:s3:::b/*" }),
      ])
    );
    // Anchored to the second statement, where the repeat appears.
    expect(finding(result, "duplicate-sid")).toMatchObject({ severity: "invalid", statement: 1 });
  });

  it("notes a missing or old Version", () => {
    expect(ids(review(allow({ Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" })))).toEqual([
      "version-missing",
    ]);
    const old = review({
      Version: "2008-10-17",
      Statement: [allow({ Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" })],
    });
    expect(ids(old)).toEqual(["version-old"]);
  });
});

// ------------------------------------------------------------ findings

describe("identity policy findings", () => {
  it("analyses the sample policy", () => {
    const result = analyzePolicy(SAMPLE_POLICY);
    expect(result.kind).toBe("identity");
    expect(result.grade).toBe("F");
    expect(ids(result)).toEqual(
      expect.arrayContaining([
        "service-wildcard",
        "privilege-escalation",
        "passrole-launch",
        "log-tampering",
        "secrets-everywhere",
        "wildcard-resource",
      ])
    );
  });

  it("caps full administrator access at F", () => {
    const result = review(policy([allow({ Action: "*", Resource: "*" })]));
    expect(ids(result)).toEqual(["admin"]);
    expect(result.score).toBe(20);
  });

  it("treats Allow + NotAction on everything as near-admin unless IAM is excluded", () => {
    const nearAdmin = review(policy([allow({ NotAction: "s3:DeleteBucket", Resource: "*" })]));
    expect(ids(nearAdmin)).toEqual(["near-admin"]);
    expect(nearAdmin.score).toBe(20);

    const noIam = review(policy([allow({ NotAction: ["iam:*", "sts:*"], Resource: "*" })]));
    expect(ids(noIam)).toContain("not-action");
    expect(ids(noIam)).not.toContain("near-admin");
    // What NotAction leaves in is still checked: deletes and audit-log tampering.
    expect(ids(noIam)).toEqual(expect.arrayContaining(["log-tampering", "destructive-everywhere"]));
  });

  it("does not count escalation actions an S3-only resource can never authorise", () => {
    const result = review(policy([allow({ Action: "*", Resource: "arn:aws:s3:::my-bucket/*" })]));
    expect(ids(result)).toEqual(["all-actions"]);
  });

  it("allows the self-service credential pattern on user/${aws:username}", () => {
    const result = review(
      policy([
        allow({
          Action: ["iam:CreateAccessKey", "iam:DeleteAccessKey", "iam:ListAccessKeys"],
          Resource: "arn:aws:iam::*:user/${aws:username}",
        }),
      ])
    );
    expect(result.findings).toEqual([]);
  });

  it("flags escalation, assume-any-role and wildcard names", () => {
    const result = review(
      policy([
        allow({ Action: ["iam:Put*", "sts:AssumeRole"], Resource: "*" }),
        allow({ Action: "s3:Get*", Resource: "arn:aws:s3:::b/*" }),
      ])
    );
    expect(ids(result)).toEqual(
      expect.arrayContaining(["privilege-escalation", "assume-any-role", "action-wildcard"])
    );
  });

  it("flags NotResource and does not double-report star-only actions", () => {
    expect(
      ids(review(policy([allow({ Action: "s3:GetObject", NotResource: "arn:aws:s3:::secret/*" })])))
    ).toContain("not-resource");
    expect(
      review(
        policy([
          allow({ Action: ["cloudwatch:PutMetricData", "xray:PutTraceSegments"], Resource: "*" }),
        ])
      ).findings
    ).toEqual([]);
  });

  it("notes explicit Deny guardrails", () => {
    const result = review(
      policy([
        allow({ Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" }),
        { Effect: "Deny", Action: "s3:DeleteObject", Resource: "*" },
      ])
    );
    expect(finding(result, "deny-guardrails").severity).toBe("info");
    expect(result.summary).toMatchObject({ allow: 1, deny: 1 });
  });
});

describe("resource policy findings", () => {
  const bucket = (fields) =>
    review(policy([allow({ Action: "s3:GetObject", Resource: "arn:aws:s3:::site/*", ...fields })]));

  it("rates an unconditioned public grant critical", () => {
    const result = bucket({ Principal: "*" });
    expect(result.kind).toBe("resource");
    expect(finding(result, "public").severity).toBe("critical");
    expect(result.score).toBeLessThanOrEqual(45);
  });

  it("does not let an empty or irrelevant Condition soften a public grant", () => {
    expect(ids(bucket({ Principal: "*", Condition: {} }))).toContain("public");
    expect(
      ids(
        bucket({
          Principal: { AWS: ["*"] },
          Condition: { Bool: { "aws:SecureTransport": "true" } },
        })
      )
    ).toContain("public");
    expect(
      ids(bucket({ Principal: "*", Condition: { StringEquals: { "aws:PrincipalOrgID": "*" } } }))
    ).toContain("public");
  });

  it("softens a public grant pinned to an organisation", () => {
    const result = bucket({
      Principal: "*",
      Condition: { StringEquals: { "aws:PrincipalOrgID": "o-abc123" } },
    });
    expect(ids(result)).toContain("public-conditional");
    expect(ids(result)).not.toContain("public");
  });

  it("asks bucket policies to deny plain HTTP", () => {
    expect(ids(bucket({ Principal: "*" }))).toContain("insecure-transport");
    const secured = review(
      policy([
        allow({
          Principal: { AWS: "arn:aws:iam::111122223333:role/app" },
          Action: "s3:GetObject",
          Resource: "arn:aws:s3:::b/*",
        }),
        {
          Effect: "Deny",
          Principal: "*",
          Action: "s3:*",
          Resource: "arn:aws:s3:::b/*",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ])
    );
    expect(ids(secured)).not.toContain("insecure-transport");
  });

  it("accepts the default KMS key policy", () => {
    const result = review(
      policy([
        {
          Sid: "EnableIAMUserPermissions",
          Effect: "Allow",
          Principal: { AWS: "arn:aws:iam::111122223333:root" },
          Action: "kms:*",
          Resource: "*",
        },
      ])
    );
    expect(ids(result)).toEqual(["cross-account-root"]);
    expect(result.grade).toBe("A");
  });

  it("flags Allow with NotPrincipal", () => {
    expect(ids(bucket({ NotPrincipal: { AWS: "arn:aws:iam::111122223333:role/x" } }))).toContain(
      "not-principal"
    );
  });
});

describe("trust policy findings", () => {
  const trust = (fields) =>
    review(policy([allow({ Action: "sts:AssumeRoleWithWebIdentity", ...fields })]));

  it("analyses the sample trust policy", () => {
    const result = analyzePolicy(SAMPLE_TRUST_POLICY);
    expect(result.kind).toBe("trust");
    expect(ids(result)).toEqual(["federated-no-condition", "cross-account-root"]);
  });

  it("requires a GitHub OIDC trust to pin the token subject", () => {
    const audOnly = trust({
      Principal: { Federated: GITHUB },
      Condition: {
        StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      },
    });
    expect(finding(audOnly, "federated-no-subject").severity).toBe("high");

    const anyRepo = trust({
      Principal: { Federated: GITHUB },
      Condition: { StringLike: { "token.actions.githubusercontent.com:sub": "repo:*" } },
    });
    expect(ids(anyRepo)).toContain("federated-no-subject");

    const pinned = trust({
      Principal: { Federated: GITHUB },
      Condition: {
        StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        StringLike: { "token.actions.githubusercontent.com:sub": "repo:acme/app:*" },
      },
    });
    expect(pinned.findings).toEqual([]);
  });

  it("does not demand a subject from SAML federation", () => {
    const saml = review(
      policy([
        allow({
          Principal: { Federated: "arn:aws:iam::111122223333:saml-provider/Okta" },
          Action: "sts:AssumeRoleWithSAML",
          Condition: { StringEquals: { "SAML:aud": "https://signin.aws.amazon.com/saml" } },
        }),
      ])
    );
    expect(saml.findings).toEqual([]);
  });

  it("recognises a bare 12-digit account ID as whole-account trust", () => {
    const result = review(
      policy([allow({ Principal: { AWS: "444455556666" }, Action: "sts:AssumeRole" })])
    );
    expect(finding(result, "cross-account-root")).toMatchObject({
      severity: "medium",
      title: "Trusts all of account 444455556666",
    });
    const withExternalId = review(
      policy([
        allow({
          Principal: { AWS: "444455556666" },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": "abc" } },
        }),
      ])
    );
    expect(finding(withExternalId, "cross-account-root").severity).toBe("low");
  });
});

// ------------------------------------------------------------ helpers

describe("action helpers", () => {
  it.each([
    ["*", "all"],
    ["s3:*", "all"],
    ["s3:GetObject", "read"],
    ["s3:Get*", "read"],
    ["dynamodb:getitem", "read"],
    ["ec2:DescribeInstances", "list"],
    ["s3:ListBucket", "list"],
    ["s3:TagResource", "tagging"],
    ["s3:PutObject", "write"],
    ["s3:*Object", "write"],
    ["sqs:Send*", "write"],
    ["iam:PassRole", "permissions"],
    ["iam:Attach*", "permissions"],
    ["iam:Put*", "permissions"],
    ["s3:PutBucketPolicy", "permissions"],
    ["logs:PutRetentionPolicy", "write"],
    ["s3:PutLifecyclePolicy", "write"],
  ])("rates %s as %s", (action, level) => {
    expect(actionAccessLevel(action)).toBe(level);
  });

  it("matches IAM globs case-insensitively", () => {
    expect(actionMatches("s3:Get*", "s3:getobject")).toBe(true);
    expect(actionMatches("s3:?etObject", "s3:GetObject")).toBe(true);
    expect(actionMatches("s3:Get*", "s3:PutObject")).toBe(false);
    expect(actionMatches("*", "anything:Here")).toBe(true);
  });

  it("finds the service prefix", () => {
    expect(serviceOf("S3:GetObject")).toBe("s3");
    expect(serviceOf("*")).toBe("*");
    expect(serviceOf("nonsense")).toBe("");
  });

  it("grades scores", () => {
    expect([100, 90, 89, 75, 74, 60, 59, 40, 39, 0, null].map(gradeFor)).toEqual([
      "A",
      "A",
      "B",
      "B",
      "C",
      "C",
      "D",
      "D",
      "F",
      "F",
      "—",
    ]);
  });

  it("decides whether a condition limits the caller", () => {
    expect(limitsCaller(null)).toBe(false);
    expect(limitsCaller({ Bool: { "aws:SecureTransport": "true" } })).toBe(false);
    expect(limitsCaller({ StringEquals: { "aws:SourceAccount": "*" } })).toBe(false);
    expect(limitsCaller({ StringEquals: { "aws:sourceaccount": ["111122223333"] } })).toBe(true);
    expect(limitsCaller({ StringEquals: { "sts:ExternalId": "x" } })).toBe(true);
  });

  it("labels principals and resources", () => {
    expect(principalList("*")).toEqual([{ type: "AWS", value: "*" }]);
    expect(principalList({ Service: ["a", "b"] })).toHaveLength(2);
    expect(principalLabel({ type: "AWS", value: "*" })).toBe("Anyone (public)");
    expect(principalLabel({ type: "Service", value: "lambda.amazonaws.com" })).toBe("lambda");
    expect(principalLabel({ type: "AWS", value: "arn:aws:iam::111122223333:role/app" })).toBe(
      "app (111122223333)"
    );
    expect(principalLabel({ type: "AWS", value: "444455556666" })).toBe("Account 444455556666");
    expect(isAccountPrincipal("arn:aws:iam::111122223333:root")).toBe(true);
    expect(isAccountPrincipal("arn:aws:iam::111122223333:role/root")).toBe(false);
    expect(resourceName("arn:aws:dynamodb:us-east-1:1:table/orders")).toBe("orders");
    expect(resourceName("arn:aws:s3:::bucket/*")).toBe(
      "arn:aws:s3:::bucket/*".split(":").slice(5).join(":")
    );
    expect(resourceName("*")).toBe("*");
    expect(slug("  Application State! ")).toBe("application-state");
    expect(slug("", "fallback")).toBe("fallback");
  });

  it("reads storage direction from arrow labels with whole words", () => {
    expect(directionFor({ label: "Upload thumbnails" })).toBe("write");
    expect(directionFor({ label: "Reads orders" })).toBe("read");
    expect(directionFor({ label: "Download reports" })).toBe("read");
    expect(directionFor({ label: "Query and update" })).toBe("both");
    expect(directionFor({ label: "" })).toBe("both");
    expect(directionFor(null)).toBe("both");
  });
});

// ------------------------------------------------------------ access maps

describe("accessMapBlueprint", () => {
  it("draws an identity policy from one role to each service", () => {
    const blueprint = accessMapBlueprint(analyzePolicy(SAMPLE_POLICY));
    expect(blueprint.nodes[0]).toMatchObject({ key: "principal", name: "This role" });
    expect(blueprint.links.every((link) => link.from === "principal")).toBe(true);
    const s3 = blueprint.links.find((link) => link.to === "svc-s3");
    expect(s3.label).toBe("full access · all resources");
    expect(s3.style.stroke).toBe("#d13212");
  });

  it("draws resource policies per statement, so a denied principal is not shown as allowed", () => {
    const result = review(
      policy([
        allow({
          Principal: { AWS: "arn:aws:iam::111122223333:role/app" },
          Action: "s3:GetObject",
          Resource: "arn:aws:s3:::b/*",
        }),
        {
          Effect: "Deny",
          Principal: "*",
          Action: "s3:*",
          Resource: "arn:aws:s3:::b/*",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
        },
      ])
    );
    const blueprint = accessMapBlueprint(result);
    const node = (name) => blueprint.nodes.find((entry) => entry.name === name);
    const from = (name) => blueprint.links.filter((link) => link.from === node(name).key);
    expect(from("app (111122223333)").map((link) => link.label)).toEqual(["read · 1 action"]);
    expect(from("Anyone (public)").map((link) => link.label)).toEqual([
      "deny · 1 action · conditional",
    ]);
    expect(from("Anyone (public)")[0].style.dash).toBe("dashed");
  });

  it("does not paint a role allowed one action at the union of every grant", () => {
    const result = review(
      policy([
        allow({
          Principal: { AWS: "arn:aws:iam::111122223333:root" },
          Action: "kms:*",
          Resource: "*",
        }),
        allow({
          Principal: { AWS: "arn:aws:iam::111122223333:role/app" },
          Action: "kms:Decrypt",
          Resource: "*",
        }),
      ])
    );
    const blueprint = accessMapBlueprint(result);
    const app = blueprint.nodes.find((entry) => entry.name === "app (111122223333)");
    const link = blueprint.links.find((entry) => entry.from === app.key);
    expect(link.label).toBe("read · 1 action");
    expect(link.style.stroke).toBe("#1d8102");
  });

  it("draws trust policies with one arrow per principal and effect", () => {
    const result = review(
      policy([
        allow({ Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }),
        {
          Effect: "Deny",
          Principal: { AWS: "*" },
          Action: "sts:AssumeRole",
          Condition: { StringNotEquals: { "aws:PrincipalOrgID": "o-123" } },
        },
      ])
    );
    const blueprint = accessMapBlueprint(result, { subject: "deploy-role" });
    expect(blueprint.nodes.find((entry) => entry.key === "role").name).toBe("deploy-role");
    expect(blueprint.links.map((link) => link.label)).toEqual([
      "can assume",
      "denied · with condition",
    ]);
    expect(blueprint.links[1].style.dash).toBe("dashed");
  });
});

// ------------------------------------------------- least privilege from a diagram

describe("leastPrivilegeFromDiagram", () => {
  it.each(TEMPLATE_IDS)("writes A-grade, valid policies for the %s template", (id) => {
    const result = leastPrivilegeFromDiagram(buildTemplate(id, { findIcon: fakeIcon }));
    for (const entry of [...result.roles, ...result.resourcePolicies]) {
      const analysis = analyzePolicy(entry.policy);
      expect(analysis.grade, entry.name).toBe("A");
      expect(
        analysis.findings.filter((f) => f.severity !== "low" && f.severity !== "info")
      ).toEqual([]);
      const sids = entry.policy.Statement.map((statement) => statement.Sid);
      expect(new Set(sids).size).toBe(sids.length);
      for (const sid of sids) expect(sid).toMatch(/^[A-Za-z0-9]+$/);
    }
    for (const role of result.roles) {
      expect(analyzePolicy(role.trust).kind).toBe("trust");
      expect(role.roleName).toMatch(/-role$/);
    }
  });

  const node = (id, serviceName, name = id) => ({ id, serviceName, name });
  const link = (from, to, label = "") => ({ from, to, label });

  it("narrows storage by the arrow label and adds ListBucket for S3", () => {
    const result = leastPrivilegeFromDiagram({
      region: "eu-west-1",
      nodes: [
        node("fn", "AWS Lambda", "thumbnailer"),
        node("s3", "Amazon Simple Storage Service", "images"),
      ],
      connections: [link("fn", "s3", "Upload thumbnails")],
    });
    const [role] = result.roles;
    const actions = role.policy.Statement.flatMap((statement) => statement.Action);
    expect(actions).toEqual(["s3:PutObject", "s3:ListBucket"]);
    expect(role.trust.Statement[0].Principal).toEqual({ Service: "lambda.amazonaws.com" });
  });

  it("gives a queue's consumer the polling permissions", () => {
    const result = leastPrivilegeFromDiagram({
      nodes: [node("q", "Amazon Simple Queue Service", "jobs"), node("fn", "AWS Lambda", "worker")],
      connections: [link("q", "fn")],
    });
    expect(result.roles[0].policy.Statement[0].Action).toEqual([
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]);
  });

  it("writes resource policies for services that push in, without duplicate Sids", () => {
    const result = leastPrivilegeFromDiagram({
      nodes: [
        node("api", "Amazon API Gateway", "api"),
        node("fn", "AWS Lambda", "handler"),
        node("sns", "Amazon Simple Notification Service", "orders"),
        node("bus", "Amazon EventBridge", "orders"),
        node("q", "Amazon Simple Queue Service", "queue"),
        node("cdn", "Amazon CloudFront", "edge"),
        node("site", "Amazon Simple Storage Service", "site"),
      ],
      connections: [
        link("api", "fn", "GET /orders"),
        link("api", "fn", "POST /orders"),
        link("sns", "q"),
        link("bus", "q"),
        link("cdn", "site"),
      ],
    });
    const byName = Object.fromEntries(result.resourcePolicies.map((entry) => [entry.name, entry]));
    expect(byName.handler.policy.Statement).toHaveLength(1);
    expect(byName.queue.policy.Statement.map((statement) => statement.Sid)).toEqual([
      "AllowOrders",
      "AllowOrders2",
    ]);
    expect(byName.site.kind).toBe("S3 bucket policy");
    expect(result.roles).toEqual([]);
  });

  it("lists AWS-to-AWS arrows that need no IAM permission", () => {
    const result = leastPrivilegeFromDiagram({
      nodes: [
        node("cdn", "Amazon CloudFront"),
        node("waf", "AWS WAF"),
        node("u", "Users 48 Light"),
      ],
      connections: [link("cdn", "waf"), link("u", "cdn")],
    });
    expect(result.skipped).toEqual(["cdn → waf"]);
  });
});
