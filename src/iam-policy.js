/**
 * IAM policy review — a local, offline analyser for AWS policy documents.
 *
 * Paste an identity policy, a resource policy (bucket, queue, key…) or a role
 * trust policy and get back:
 *
 *  - validation problems with line numbers (bad JSON, unknown Effect, an
 *    action without a service prefix…),
 *  - findings ranked by severity: administrator access, service wildcards,
 *    privilege-escalation paths, public or cross-account principals, log
 *    tampering, secrets readable everywhere, and more,
 *  - a score and grade, the same scale the SQL review uses,
 *  - an access map: which services the policy reaches and at what level
 *    (list / read / write / permissions / full), ready to draw as a diagram.
 *
 * The inverse lives here too: `leastPrivilegeFromDiagram` reads the arrows
 * drawn in AWS Studio and writes the narrowest policies that allow them.
 *
 * Everything is pure: no DOM, no network.
 */

// ------------------------------------------------------------ constants

export const SAMPLE_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AppData",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"],
      "Resource": "arn:aws:dynamodb:us-east-1:111122223333:table/orders"
    },
    {
      "Sid": "Uploads",
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    },
    {
      "Sid": "Deploy",
      "Effect": "Allow",
      "Action": ["iam:PassRole", "lambda:CreateFunction", "lambda:UpdateFunctionCode"],
      "Resource": "*"
    },
    {
      "Sid": "Config",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "ssm:GetParameter"],
      "Resource": "*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DeleteLogGroup"],
      "Resource": "*"
    }
  ]
}`;

export const SAMPLE_TRUST_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com" },
      "Action": "sts:AssumeRoleWithWebIdentity"
    },
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::444455556666:root" },
      "Action": "sts:AssumeRole"
    }
  ]
}`;

export const SEVERITIES = ["invalid", "critical", "high", "medium", "low", "info"];
const PENALTY = { invalid: 25, critical: 35, high: 15, medium: 6, low: 2, info: 0 };

export const ACCESS_LEVELS = ["list", "read", "tagging", "write", "permissions", "all"];
const LEVEL_RANK = Object.fromEntries(ACCESS_LEVELS.map((level, index) => [level, index]));

/** Service prefix → icon catalog name and a short label. */
export const SERVICE_PREFIXES = {
  "*": { name: "AWS Identity and Access Management", label: "Every AWS service" },
  s3: { name: "Amazon Simple Storage Service", label: "Amazon S3" },
  dynamodb: { name: "Amazon DynamoDB", label: "DynamoDB" },
  lambda: { name: "AWS Lambda", label: "Lambda" },
  ec2: { name: "Amazon EC2", label: "EC2" },
  iam: { name: "AWS Identity and Access Management", label: "IAM" },
  sts: { name: "AWS Identity and Access Management", label: "STS" },
  kms: { name: "AWS Key Management Service", label: "KMS" },
  secretsmanager: { name: "AWS Secrets Manager", label: "Secrets Manager" },
  ssm: { name: "AWS Systems Manager", label: "Systems Manager" },
  sqs: { name: "Amazon Simple Queue Service", label: "SQS" },
  sns: { name: "Amazon Simple Notification Service", label: "SNS" },
  logs: { name: "Amazon CloudWatch", label: "CloudWatch Logs" },
  cloudwatch: { name: "Amazon CloudWatch", label: "CloudWatch" },
  events: { name: "Amazon EventBridge", label: "EventBridge" },
  states: { name: "AWS Step Functions", label: "Step Functions" },
  rds: { name: "Amazon RDS", label: "RDS" },
  "rds-db": { name: "Amazon RDS", label: "RDS IAM auth" },
  apigateway: { name: "Amazon API Gateway", label: "API Gateway" },
  "execute-api": { name: "Amazon API Gateway", label: "API Gateway (invoke)" },
  ecr: { name: "Amazon Elastic Container Registry", label: "ECR" },
  ecs: { name: "Amazon Elastic Container Service", label: "ECS" },
  eks: { name: "Amazon Elastic Kubernetes Service", label: "EKS" },
  cloudfront: { name: "Amazon CloudFront", label: "CloudFront" },
  route53: { name: "Amazon Route 53", label: "Route 53" },
  kinesis: { name: "Amazon Kinesis Data Streams", label: "Kinesis" },
  firehose: { name: "Amazon Data Firehose", label: "Firehose" },
  glue: { name: "AWS Glue", label: "Glue" },
  athena: { name: "Amazon Athena", label: "Athena" },
  sagemaker: { name: "Amazon SageMaker", label: "SageMaker" },
  bedrock: { name: "Amazon Bedrock", label: "Bedrock" },
  "cognito-idp": { name: "Amazon Cognito", label: "Cognito" },
  elasticloadbalancing: { name: "Elastic Load Balancing", label: "Load balancing" },
  autoscaling: { name: "Amazon EC2 Auto Scaling", label: "Auto Scaling" },
  cloudformation: { name: "AWS CloudFormation", label: "CloudFormation" },
  cloudtrail: { name: "AWS CloudTrail", label: "CloudTrail" },
  es: { name: "Amazon OpenSearch Service", label: "OpenSearch" },
  elasticache: { name: "Amazon ElastiCache", label: "ElastiCache" },
  redshift: { name: "Amazon Redshift", label: "Redshift" },
  codebuild: { name: "AWS CodeBuild", label: "CodeBuild" },
  codepipeline: { name: "AWS CodePipeline", label: "CodePipeline" },
  organizations: { name: "AWS Organizations", label: "Organizations" },
  guardduty: { name: "Amazon GuardDuty", label: "GuardDuty" },
  config: { name: "AWS Config", label: "AWS Config" },
  wafv2: { name: "AWS WAF", label: "WAF" },
  acm: { name: "AWS Certificate Manager", label: "ACM" },
  backup: { name: "AWS Backup", label: "AWS Backup" },
  ses: { name: "Amazon Simple Email Service", label: "SES" },
  xray: { name: "AWS X-Ray", label: "X-Ray" },
};

/**
 * Actions that let a principal grant itself more access (the well-known IAM
 * privilege-escalation paths). A policy holding any of these is only as
 * narrow as the widest role it can reach.
 */
export const ESCALATION_ACTIONS = [
  "iam:CreatePolicyVersion",
  "iam:SetDefaultPolicyVersion",
  "iam:CreateAccessKey",
  "iam:CreateLoginProfile",
  "iam:UpdateLoginProfile",
  "iam:AttachUserPolicy",
  "iam:AttachGroupPolicy",
  "iam:AttachRolePolicy",
  "iam:PutUserPolicy",
  "iam:PutGroupPolicy",
  "iam:PutRolePolicy",
  "iam:AddUserToGroup",
  "iam:UpdateAssumeRolePolicy",
  "lambda:UpdateFunctionCode",
  "ssm:SendCommand",
  "ssm:StartSession",
  "ec2-instance-connect:SendSSHPublicKey",
  "glue:UpdateDevEndpoint",
];

/** Services that run code as a role you pass them: PassRole + one of these = escalation. */
const PASSROLE_LAUNCHERS = [
  "lambda:CreateFunction",
  "ec2:RunInstances",
  "cloudformation:CreateStack",
  "cloudformation:UpdateStack",
  "glue:CreateDevEndpoint",
  "glue:CreateJob",
  "ecs:RunTask",
  "ecs:RegisterTaskDefinition",
  "sagemaker:CreateNotebookInstance",
  "codebuild:CreateProject",
  "datapipeline:CreatePipeline",
];

/** Turning off the audit trail: defence evasion, never routine. */
const LOG_TAMPERING = [
  "cloudtrail:StopLogging",
  "cloudtrail:DeleteTrail",
  "cloudtrail:UpdateTrail",
  "cloudtrail:PutEventSelectors",
  "logs:DeleteLogGroup",
  "logs:DeleteLogStream",
  "logs:DeleteRetentionPolicy",
  "guardduty:DeleteDetector",
  "guardduty:UpdateDetector",
  "config:StopConfigurationRecorder",
  "config:DeleteConfigurationRecorder",
  "config:DeleteDeliveryChannel",
];

/** Irreversible deletes of data or keys. */
const DESTRUCTIVE = [
  "s3:DeleteBucket",
  "s3:DeleteObject",
  "s3:DeleteObjectVersion",
  "dynamodb:DeleteTable",
  "rds:DeleteDBInstance",
  "rds:DeleteDBCluster",
  "kms:ScheduleKeyDeletion",
  "kms:DisableKey",
  "ec2:TerminateInstances",
  "ec2:DeleteVolume",
  "ec2:DeleteSnapshot",
  "backup:DeleteRecoveryPoint",
  "secretsmanager:DeleteSecret",
];

/** Reads that return secrets or decrypt data. */
const SECRET_READS = [
  "secretsmanager:GetSecretValue",
  "ssm:GetParameter",
  "ssm:GetParameters",
  "ssm:GetParametersByPath",
  "kms:Decrypt",
];

/** Actions AWS only authorises against `"Resource": "*"`, so a wildcard there is not a finding. */
const STAR_ONLY = [
  "cloudwatch:PutMetricData",
  "xray:PutTraceSegments",
  "xray:PutTelemetryRecords",
  "sts:GetCallerIdentity",
  "s3:ListAllMyBuckets",
  "ecr:GetAuthorizationToken",
  "logs:DescribeLogGroups",
  "ec2:CreateNetworkInterface",
  "ec2:DeleteNetworkInterface",
  "ec2:AssignPrivateIpAddresses",
  "ec2:UnassignPrivateIpAddresses",
];

const TRUST_ACTIONS =
  /^sts:(AssumeRole|AssumeRoleWithWebIdentity|AssumeRoleWithSAML|TagSession|SetSourceIdentity|SetContext)$/i;

// ------------------------------------------------------------- helpers

const list = (value) =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** Does an IAM glob (`s3:Get*`, `*`) cover a concrete action? Case-insensitive, as IAM is. */
export function actionMatches(pattern, action) {
  const source = String(pattern)
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(String(action).toLowerCase());
}

const coversAny = (patterns, actions) =>
  actions.filter((action) => patterns.some((pattern) => actionMatches(pattern, action)));

export function serviceOf(action) {
  const text = String(action);
  if (text === "*") return "*";
  const index = text.indexOf(":");
  return index > 0 ? text.slice(0, index).toLowerCase() : "";
}

/** Concrete verbs a wildcard is tested against, per service, to judge what it can reach. */
const SAMPLE_VERBS = {
  "*": [
    "List",
    "Describe",
    "Get",
    "Head",
    "Query",
    "Scan",
    "Put",
    "Create",
    "Delete",
    "Update",
    "Tag",
    "Untag",
  ],
  iam: [
    "PutRolePolicy",
    "PutUserPolicy",
    "AttachRolePolicy",
    "AttachUserPolicy",
    "CreatePolicyVersion",
    "SetDefaultPolicyVersion",
    "UpdateAssumeRolePolicy",
    "PassRole",
  ],
  s3: [
    "GetObject",
    "PutObject",
    "DeleteObject",
    "ListBucket",
    "PutBucketPolicy",
    "PutBucketAcl",
    "PutObjectAcl",
  ],
  kms: ["PutKeyPolicy", "CreateGrant", "Decrypt", "Encrypt"],
  lambda: ["AddPermission", "InvokeFunction"],
  sqs: ["AddPermission", "SendMessage", "ReceiveMessage"],
  sns: ["AddPermission", "Publish"],
  secretsmanager: ["PutResourcePolicy", "GetSecretValue"],
  dynamodb: ["PutResourcePolicy", "GetItem", "PutItem"],
  ecr: ["SetRepositoryPolicy"],
  logs: ["PutResourcePolicy"],
};

function verbLevel(verb) {
  if (!verb) return "all";
  if (
    /^(put|attach|detach|create|delete|set|update|add|remove|pass|revoke|retire|replace)/i.test(
      verb
    ) &&
    /(policy|permission|grant|acl|passrole|publicaccessblock)/i.test(verb) &&
    !/(retention|lifecycle|scaling|backup|replication)policy/i.test(verb)
  )
    return "permissions";
  if (/^passrole$/i.test(verb)) return "permissions";
  if (/^(tag|untag)/i.test(verb)) return "tagging";
  if (/^(list|describe)/i.test(verb)) return "list";
  if (
    /^(get|head|query|scan|batchget|select|search|lookup|receive|download|retrieve|view|read|decrypt|filter|test|check|validate)/i.test(
      verb
    )
  )
    return "read";
  return "write";
}

/**
 * The access level an action grants, following the IAM console's buckets.
 * A wildcard is judged by the most powerful verb it can match, so `s3:Get*`
 * is read, `iam:Attach*` is permissions and `s3:*Object` is write.
 */
export function actionAccessLevel(action) {
  const text = String(action);
  if (text === "*" || text === "*:*") return "all";
  const colon = text.indexOf(":");
  const verb = text.slice(colon + 1);
  if (!/[*?]/.test(verb)) return verbLevel(verb);
  if (/^[*?]+$/.test(verb)) return "all";
  const service = text.slice(0, colon).toLowerCase();
  const reached = [...SAMPLE_VERBS["*"], ...(SAMPLE_VERBS[service] || [])].filter((candidate) =>
    actionMatches(`x:${verb}`, `x:${candidate}`)
  );
  return reached.length ? maxLevel(reached.map(verbLevel)) : verbLevel(verb.split(/[*?]/)[0]);
}

function maxLevel(levels) {
  return [...levels].sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0] || "list";
}

/** 1-based line and column for a character offset. */
function lineColumn(text, offset) {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/**
 * The line each statement starts on, found by scanning the Statement array's
 * top-level objects (string-aware, so braces inside values don't count).
 */
function statementLines(text) {
  const key = text.search(/"Statement"\s*:/);
  let index = key >= 0 ? text.indexOf(":", key) + 1 : 0;
  while (/\s/.test(text[index] || "")) index += 1;
  if (text[index] === "{") return [lineColumn(text, index).line];
  if (text[index] !== "[") return [];
  const lines = [];
  let depth = 0;
  let inString = false;
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[" || char === "{") {
      if (depth === 1 && char === "{") lines.push(lineColumn(text, index).line);
      depth += 1;
    } else if (char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return lines;
}

// -------------------------------------------------------------- parsing

/**
 * Parse policy text. Accepts a full policy document, a bare statement, an
 * array of statements, or a wrapper that holds one (`PolicyDocument`,
 * `AssumeRolePolicyDocument`, `policy`) such as CloudFormation or CLI output.
 */
export function parsePolicy(input) {
  const text = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  if (!text || !text.trim()) return { empty: true, errors: [], statements: [], text: "" };
  let raw;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(text);
    } catch (error) {
      const message = String(error.message || error);
      const position = Number(/position (\d+)/.exec(message)?.[1]);
      const where = /line (\d+) column (\d+)/.exec(message);
      const location = where
        ? { line: Number(where[1]), column: Number(where[2]) }
        : Number.isFinite(position)
          ? lineColumn(text, position)
          : { line: null, column: null };
      return {
        empty: false,
        errors: [
          {
            message: `Not valid JSON: ${message.replace(/^JSON\.parse: /, "").replace(/ in JSON at position \d+.*$/, "")}`,
            ...location,
          },
        ],
        statements: [],
        text,
      };
    }
  } else {
    raw = input;
  }

  for (const key of ["PolicyDocument", "AssumeRolePolicyDocument", "policy", "Policy"]) {
    if (raw && typeof raw === "object" && !Array.isArray(raw) && raw[key] && !raw.Statement) {
      raw = typeof raw[key] === "string" ? (safeJson(raw[key]) ?? raw) : raw[key];
    }
  }

  const errors = [];
  let version = null;
  let rawStatements;
  if (Array.isArray(raw)) rawStatements = raw;
  else if (raw && typeof raw === "object" && "Statement" in raw) {
    version = raw.Version ?? null;
    rawStatements = list(raw.Statement);
  } else if (raw && typeof raw === "object" && ("Effect" in raw || "Action" in raw)) {
    rawStatements = [raw];
  } else {
    return {
      empty: false,
      errors: [
        { message: "No Statement found — paste an IAM policy document", line: 1, column: 1 },
      ],
      statements: [],
      text,
    };
  }

  if (!rawStatements.length) {
    errors.push({ message: "The Statement list is empty — this policy grants nothing", line: 1 });
  }
  const lines = statementLines(text);
  const statements = rawStatements.map((statement, index) =>
    normalizeStatement(statement, index, lines[index] ?? null, errors)
  );
  return { empty: false, errors, version, hasVersion: version !== null, statements, text };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** A Condition block with at least one operator, or null. */
function cleanCondition(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return null;
  return Object.keys(condition).length ? condition : null;
}

function normalizeStatement(raw, index, line, errors) {
  const object = raw && typeof raw === "object" && !Array.isArray(raw);
  const label = object && raw.Sid ? `“${raw.Sid}”` : `#${index + 1}`;
  const invalid = {
    index,
    line,
    sid: null,
    label,
    effect: "Allow",
    actions: [],
    notActions: [],
    resources: [],
    notResources: [],
    hasResource: true,
    principals: [],
    notPrincipals: [],
    hasPrincipal: false,
    condition: null,
    valid: false,
  };
  if (!object) {
    errors.push({ message: `Statement ${label} is not an object`, line });
    return invalid;
  }
  // Effect is case-sensitive in IAM; anything else makes the statement unusable.
  const effect = String(raw.Effect ?? "");
  const effectValid = effect === "Allow" || effect === "Deny";
  if (!effectValid) {
    errors.push({
      message: `Statement ${label}: Effect must be "Allow" or "Deny"${effect ? ` (got "${effect}")` : ""}`,
      line,
    });
  }
  const actions = list(raw.Action).map(String);
  const notActions = list(raw.NotAction).map(String);
  if (!actions.length && !notActions.length) {
    errors.push({ message: `Statement ${label} has no Action`, line });
  }
  for (const action of [...actions, ...notActions]) {
    if (action !== "*" && !/^[a-z0-9-]+:[a-z0-9*?]+$/i.test(action)) {
      errors.push({
        message: `Statement ${label}: "${action}" is not an action — expected service:Action, e.g. s3:GetObject`,
        line,
      });
    }
  }
  const principal = raw.Principal ?? null;
  const notPrincipal = raw.NotPrincipal ?? null;
  return {
    index,
    line,
    sid: raw.Sid ? String(raw.Sid) : null,
    label,
    effect: effect === "Deny" ? "Deny" : "Allow",
    actions,
    notActions,
    resources: list(raw.Resource).map(String),
    notResources: list(raw.NotResource).map(String),
    hasResource: "Resource" in raw || "NotResource" in raw,
    principals: principalList(principal),
    notPrincipals: principalList(notPrincipal),
    hasPrincipal: principal !== null || notPrincipal !== null,
    condition: cleanCondition(raw.Condition),
    valid: effectValid,
  };
}

/** Flatten a Principal block into `{type, value}` records. */
export function principalList(principal) {
  if (principal === null || principal === undefined) return [];
  if (principal === "*") return [{ type: "AWS", value: "*" }];
  if (typeof principal === "string") return [{ type: "AWS", value: principal }];
  return Object.entries(principal).flatMap(([type, values]) =>
    list(values).map((value) => ({ type, value: String(value) }))
  );
}

function policyKind(statements) {
  const withPrincipal = statements.filter(
    (statement) => statement.valid !== false && statement.hasPrincipal
  );
  if (!withPrincipal.length) return "identity";
  const trust = withPrincipal.every(
    (statement) => statement.actions.length && statement.actions.every((a) => TRUST_ACTIONS.test(a))
  );
  return trust ? "trust" : "resource";
}

const accountOf = (arn) =>
  /^arn:aws[a-z-]*:iam::(\d{12}):/.exec(arn)?.[1] || (/^\d{12}$/.test(arn) ? arn : null);

/** A principal naming a whole account: its :root ARN or the bare 12-digit ID. */
export const isAccountPrincipal = (value) =>
  /^arn:aws[a-z-]*:iam::\d{12}:root$/.test(value) || /^\d{12}$/.test(value);

/**
 * Condition keys that pin down who the caller is (or where the call comes
 * from). Only these make a public or whole-account grant narrow.
 */
const LIMITING_KEYS =
  /^(aws:(principalorgid|principalorgpaths|principalaccount|principalarn|sourceaccount|sourcearn|sourceowner|sourcevpce|sourcevpc|sourceip|vpcsourceip|userid|username|principalservicename|calledvia)|sts:externalid)$/i;

function conditionValues(condition, test) {
  if (!condition) return [];
  return Object.values(condition).flatMap((block) =>
    block && typeof block === "object"
      ? Object.entries(block)
          .filter(([key]) => test(key))
          .flatMap(([, value]) => list(value).map(String))
      : []
  );
}

/** Does this Condition actually restrict the caller (with a non-wildcard value)? */
export function limitsCaller(condition) {
  return conditionValues(condition, (key) => LIMITING_KEYS.test(key)).some(
    (value) => value.trim() && value !== "*"
  );
}

/** Services a statement's resources can belong to; "*" when any resource is open. */
function resourceServices(statement) {
  if (statement.notResources.length || !statement.hasResource) return new Set(["*"]);
  return new Set(
    statement.resources.map((resource) => {
      if (resource === "*") return "*";
      const service = /^arn:[^:]*:([^:]*):/.exec(resource)?.[1];
      return !service || /[*?]/.test(service) ? "*" : service.toLowerCase();
    })
  );
}

// ------------------------------------------------------------- analysis

/**
 * Review a policy.
 *
 * @param {string|object} input - policy JSON text or an already-parsed object
 * @returns {{empty: boolean, errors: object[], kind: string, statements: object[],
 *   findings: object[], score: number|null, grade: string, counts: object,
 *   services: object[], principals: object[], summary: object}}
 */
export function analyzePolicy(input) {
  const parsed = parsePolicy(input);
  const base = {
    empty: parsed.empty,
    errors: parsed.errors,
    statements: parsed.statements,
    kind: "identity",
    findings: [],
    services: [],
    principals: [],
    counts: Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])),
    summary: { allow: 0, deny: 0, actions: 0, services: 0 },
    score: null,
    grade: "—",
  };
  if (parsed.empty) return base;
  if (!parsed.statements.length) {
    const findings = parsed.errors.map(invalidFinding);
    const counts = { ...base.counts, invalid: findings.length };
    return { ...base, findings, counts, grade: "F", score: 0 };
  }

  const kind = policyKind(parsed.statements);
  const usable = parsed.statements.filter((statement) => statement.valid !== false);
  const findings = parsed.errors.map(invalidFinding);
  const add = (finding, statement) =>
    findings.push({
      ...finding,
      statement: statement?.index ?? null,
      sid: statement?.sid ?? null,
      line: statement?.line ?? null,
    });

  if (!parsed.hasVersion) {
    add({
      id: "version-missing",
      severity: "low",
      title: "No policy Version",
      detail:
        'Without "Version": "2012-10-17", IAM falls back to the 2008 grammar and policy variables such as ${aws:username} are treated as literal text.',
      fix: 'Add "Version": "2012-10-17" at the top of the document.',
    });
  } else if (parsed.version !== "2012-10-17") {
    add({
      id: "version-old",
      severity: "low",
      title: `Old policy Version (${parsed.version})`,
      detail: "The 2008-10-17 grammar does not support policy variables.",
      fix: 'Use "Version": "2012-10-17".',
    });
  }

  const sids = new Map();
  for (const statement of parsed.statements) {
    if (!statement.sid) continue;
    if (sids.has(statement.sid)) {
      add(
        {
          id: "duplicate-sid",
          severity: "invalid",
          title: `Duplicate Sid “${statement.sid}”`,
          detail: "Statement IDs must be unique within a policy; IAM rejects duplicates on save.",
          fix: "Rename one of the statements.",
        },
        statement
      );
    }
    sids.set(statement.sid, statement.index);
  }

  const allowed = usable.filter((statement) => statement.effect === "Allow");
  const allAllowedActions = allowed.flatMap((statement) => statement.actions);

  for (const statement of allowed) {
    reviewAllowStatement(statement, kind, add);
  }

  // PassRole on its own is only half an escalation; with a launcher it is the whole thing.
  const passRole =
    kind === "identity" &&
    allowed.find(
      (statement) =>
        coversAny(statement.actions, ["iam:PassRole"]).length &&
        (statement.resources.includes("*") || statement.notResources.length)
    );
  const launchers = [...new Set(coversAny(allAllowedActions, PASSROLE_LAUNCHERS))];
  if (passRole && launchers.length && !isAdminStatement(passRole)) {
    add(
      {
        id: "passrole-launch",
        severity: "high",
        title: "Can pass any role to new compute",
        detail: `iam:PassRole on "*" together with ${launchers.join(", ")} lets this principal start code running as any role in the account — including administrator roles.`,
        fix: 'Scope iam:PassRole to the specific role ARNs it needs and add a "iam:PassedToService" condition.',
      },
      passRole
    );
  }

  const denies = usable.filter((statement) => statement.effect === "Deny");
  if (denies.length && allowed.length) {
    add({
      id: "deny-guardrails",
      severity: "info",
      title: `${plural(denies.length, "explicit Deny guardrail")}`,
      detail: "Explicit denies win over any allow, including ones granted by other policies.",
      fix: null,
    });
  }

  if (kind === "resource") {
    const s3 = allowed.some((statement) => statement.actions.some((a) => serviceOf(a) === "s3"));
    const secure = denies.some((statement) =>
      JSON.stringify(statement.condition || {}).includes("aws:SecureTransport")
    );
    if (s3 && !secure) {
      add({
        id: "insecure-transport",
        severity: "low",
        title: "Plain HTTP is not denied",
        detail: "This bucket policy does not refuse requests made without TLS.",
        fix: 'Add a Deny for "s3:*" with Condition {"Bool": {"aws:SecureTransport": "false"}}.',
      });
    }
  }

  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of findings) counts[finding.severity] += 1;
  const penalty = findings.reduce((sum, finding) => sum + PENALTY[finding.severity], 0);
  // Administrator access is an F whatever else the policy does well; a policy
  // IAM would refuse to save is an F too; any other critical holds it at D.
  const cap = findings.some((finding) => ["admin", "near-admin"].includes(finding.id))
    ? 20
    : counts.invalid
      ? 30
      : counts.critical
        ? 45
        : 100;
  const score = Math.max(0, Math.min(cap, 100 - penalty));
  findings.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      (a.statement ?? -1) - (b.statement ?? -1)
  );

  const services = accessMap(usable);
  return {
    ...base,
    kind,
    findings,
    counts,
    score,
    grade: gradeFor(score),
    services,
    principals: principalSummary(usable),
    summary: {
      allow: allowed.length,
      deny: denies.length,
      actions: new Set(usable.flatMap((statement) => statement.actions)).size,
      services: services.filter((service) => service.allow).length,
    },
  };
}

function invalidFinding(error) {
  return {
    id: "invalid",
    severity: "invalid",
    title: error.message,
    detail: "IAM will refuse to save this policy until it is fixed.",
    fix: null,
    statement: null,
    sid: null,
    line: error.line ?? null,
  };
}

export function gradeFor(score) {
  if (score === null) return "—";
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function isAdminStatement(statement) {
  return (
    statement.effect === "Allow" &&
    statement.actions.some((action) => action === "*" || action === "*:*") &&
    (statement.resources.includes("*") || !statement.hasResource)
  );
}

/** OIDC identity providers whose tokens must be pinned to a subject. */
const OIDC_PROVIDER =
  /oidc-provider\/|^(accounts\.google\.com|graph\.facebook\.com|www\.amazon\.com)$/;

function reviewPrincipals(statement, kind, add) {
  for (const principal of statement.principals) {
    if (principal.value === "*" && ["AWS", "CanonicalUser"].includes(principal.type)) {
      add(
        limitsCaller(statement.condition)
          ? {
              id: "public-conditional",
              severity: "medium",
              title: "Open to any AWS principal, narrowed by a condition",
              detail: `Principal "*" is limited by ${conditionValues(statement.condition, (key) => LIMITING_KEYS.test(key)).length ? "a condition on the caller" : "its Condition"}. Check it pins an account, organisation, VPC endpoint or source ARN you control.`,
              fix: "Prefer a condition on aws:PrincipalOrgID, aws:SourceAccount or aws:SourceVpce.",
            }
          : {
              id: "public",
              severity: "critical",
              title: "Open to anyone on the internet",
              detail: `Principal "*" grants ${describeActions(statement.actions)} to every AWS account and anonymous callers${statement.condition ? " — its Condition does not restrict who the caller is" : ""}.`,
              fix: "Name the principals that need access, or add a condition on aws:PrincipalOrgID, aws:SourceAccount or aws:SourceVpce.",
            },
        statement
      );
    } else if (principal.type === "AWS" && isAccountPrincipal(principal.value)) {
      add(
        {
          id: "cross-account-root",
          severity: kind === "trust" && !limitsCaller(statement.condition) ? "medium" : "low",
          title: `Trusts all of account ${accountOf(principal.value)}`,
          detail:
            kind === "resource"
              ? "An account principal delegates the decision to that account's IAM policies: any user or role there that is granted permission can use this."
              : "An account principal delegates the decision to that account: any user or role there that is granted sts:AssumeRole can assume this role.",
          fix:
            kind === "trust"
              ? 'Name the specific role ARN, and require "sts:ExternalId" for third parties.'
              : "Name the specific role ARNs that need access, unless this is your own account.",
        },
        statement
      );
    } else if (principal.type === "Federated") {
      const provider = principal.value.split("/").pop();
      const github = /githubusercontent/.test(principal.value);
      const githubFix =
        'Add Condition {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"}, "StringLike": {"token.actions.githubusercontent.com:sub": "repo:ORG/REPO:*"}}.';
      if (!statement.condition) {
        add(
          {
            id: "federated-no-condition",
            severity: "high",
            title: "Federated sign-in with no condition",
            detail: `Anyone who can get a token from ${provider} can assume this role${github ? " — for GitHub OIDC that means any repository on GitHub" : ""}.`,
            fix: github ? githubFix : "Add conditions on the token's audience and subject.",
          },
          statement
        );
        continue;
      }
      if (!OIDC_PROVIDER.test(principal.value)) continue;
      // An audience check only proves the token was minted for AWS; the
      // subject says *whose* token it is.
      const subjects = conditionValues(statement.condition, (key) => /:sub$/i.test(key));
      const open = (value) => !value.trim() || value === "*" || /^repo:\*/.test(value);
      if (!subjects.length || subjects.every(open)) {
        add(
          {
            id: "federated-no-subject",
            severity: "high",
            title: "Federated trust doesn't pin the token subject",
            detail: `The Condition ${subjects.length ? "allows any subject" : "never checks the token's subject"}, so any identity ${provider} issues a token to can assume this role${github ? " — any GitHub repository's workflows" : ""}.`,
            fix: github
              ? githubFix
              : `Add a StringEquals / StringLike condition on ${provider}:sub.`,
          },
          statement
        );
      }
    }
  }
}

function reviewAllowStatement(statement, kind, add) {
  // In a resource policy "Resource": "*" means the resource it is attached
  // to, not every resource in the account.
  const anyResource =
    kind !== "resource" && (statement.resources.includes("*") || statement.notResources.length > 0);
  const services = resourceServices(statement);
  // Actions this statement grants from a list, limited to services its
  // resources can belong to (an S3 ARN can't authorise iam:PutRolePolicy).
  const granted = (candidates) => {
    const covered = statement.actions.length
      ? coversAny(statement.actions, candidates)
      : statement.notActions.length
        ? candidates.filter(
            (action) => !statement.notActions.some((pattern) => actionMatches(pattern, action))
          )
        : [];
    return [...new Set(covered)].filter(
      (action) => services.has("*") || services.has(serviceOf(action))
    );
  };

  // Principals first: who the statement lets in matters more than what.
  reviewPrincipals(statement, kind, add);

  if (statement.notPrincipals.length) {
    add(
      {
        id: "not-principal",
        severity: "high",
        title: "Allow with NotPrincipal",
        detail:
          "Allow + NotPrincipal grants access to everyone except the listed principals — almost never intended.",
        fix: "Use Principal with the specific principals instead.",
      },
      statement
    );
  }

  if (statement.notResources.length) {
    add(
      {
        id: "not-resource",
        severity: "medium",
        title: "Allow with NotResource",
        detail: `Applies to every resource except ${statement.notResources.join(", ")}, including resources created later.`,
        fix: "List the resources that are needed with Resource instead.",
      },
      statement
    );
  }

  if (isAdminStatement(statement)) {
    add(
      {
        id: "admin",
        severity: "critical",
        title: "Full administrator access",
        detail:
          '"Action": "*" on "Resource": "*" can do anything in the account, including changing its own permissions.',
        fix: "Replace with the specific actions and resources this principal uses — the “From diagram” generator can start you off.",
      },
      statement
    );
    return;
  }

  if (statement.notActions.length) {
    // Allow + NotAction on everything is administrator access unless the
    // exclusions remove every way to grant yourself more.
    const escalationLeft = granted(ESCALATION_ACTIONS.filter((a) => serviceOf(a) === "iam"));
    if (anyResource && escalationLeft.length) {
      add(
        {
          id: "near-admin",
          severity: "critical",
          title: "Allow with NotAction is effectively administrator access",
          detail: `Everything except ${statement.notActions.join(", ")} is allowed on every resource — including ${escalationLeft.slice(0, 3).join(", ")}, which can grant the rest back.`,
          fix: "List the actions that are needed with Action instead.",
        },
        statement
      );
      return;
    }
    add(
      {
        id: "not-action",
        severity: anyResource ? "high" : "medium",
        title: "Allow with NotAction",
        detail: `Grants every action except ${statement.notActions.join(", ")} — including actions AWS adds later.`,
        fix: "List the actions that are needed with Action instead.",
      },
      statement
    );
  }

  if (statement.actions.some((action) => action === "*")) {
    add(
      {
        id: "all-actions",
        severity: "high",
        title: "Every action on these resources",
        detail: `"Action": "*" on ${statement.resources.join(", ")} includes deletes and permission changes.`,
        fix: "List the specific actions needed.",
      },
      statement
    );
  }

  const serviceWildcards = statement.actions.filter((action) => /^[a-z0-9-]+:\*$/i.test(action));
  // A resource policy granting a service to whole accounts (the default KMS
  // key policy) hands the decision to those accounts' IAM policies.
  const delegated =
    kind === "resource" &&
    statement.principals.length > 0 &&
    statement.principals.every((p) => p.type === "AWS" && isAccountPrincipal(p.value));
  if (serviceWildcards.length && !delegated) {
    const risky = serviceWildcards.some((action) =>
      ["iam", "sts", "kms", "organizations"].includes(serviceOf(action))
    );
    add(
      {
        id: "service-wildcard",
        severity: anyResource || risky ? "high" : "medium",
        title: `Every action in ${serviceWildcards.map((action) => labelFor(serviceOf(action))).join(", ")}`,
        detail: `${serviceWildcards.join(", ")}${anyResource ? ' on "Resource": "*"' : ""} includes deletes and ${serviceWildcards.length === 1 ? "its" : "their"} permission-management actions.`,
        fix: "List the actions the workload calls; the access map shows which levels are in use.",
      },
      statement
    );
  }

  const partial = statement.actions.filter(
    (action) => /[*?]/.test(action) && action !== "*" && !/^[a-z0-9-]+:\*$/i.test(action)
  );
  if (partial.length) {
    add(
      {
        id: "action-wildcard",
        severity: "low",
        title: `Wildcard action ${partial.length === 1 ? "name" : "names"}`,
        detail: `${partial.join(", ")} will also match actions AWS adds to ${partial.length === 1 ? "that service" : "those services"} in future.`,
        fix: "Spell out the actions in use.",
      },
      statement
    );
  }

  // Managing your own credentials on user/${aws:username} is the standard
  // self-service pattern, not escalation.
  const iamResources = statement.resources.filter((r) => /^arn:[^:]*:iam:/.test(r));
  const selfService =
    iamResources.length > 0 && iamResources.every((r) => r.includes("${aws:username}"));
  const escalation = granted(ESCALATION_ACTIONS).filter(
    (action) =>
      !(
        selfService &&
        ["iam:CreateAccessKey", "iam:CreateLoginProfile", "iam:UpdateLoginProfile"].includes(action)
      )
  );
  if (escalation.length) {
    add(
      {
        id: "privilege-escalation",
        severity: "high",
        title: "Privilege-escalation path",
        detail: `${escalation.slice(0, 4).join(", ")}${escalation.length > 4 ? ` and ${escalation.length - 4} more` : ""} can be used to grant this principal more access than the policy shows.`,
        fix: anyResource
          ? "Scope these actions to named resources, or move them to a break-glass role."
          : "Keep these actions only on a tightly controlled deployment role.",
      },
      statement
    );
  }

  if (anyResource && granted(["sts:AssumeRole"]).length) {
    add(
      {
        id: "assume-any-role",
        severity: "high",
        title: "Can assume any role",
        detail: 'sts:AssumeRole on "*" is limited only by the target roles\' trust policies.',
        fix: "Name the role ARNs this principal is expected to assume.",
      },
      statement
    );
  }

  const tampering = granted(LOG_TAMPERING);
  if (tampering.length) {
    add(
      {
        id: "log-tampering",
        severity: "high",
        title: "Can switch off the audit trail",
        detail: `${tampering.slice(0, 4).join(", ")}${tampering.length > 4 ? "…" : ""} can erase the evidence of what this principal did.`,
        fix: "Remove these from workload roles; deny them with an SCP outside the security team.",
      },
      statement
    );
  }

  if (anyResource) {
    const secrets = granted(SECRET_READS);
    if (secrets.length) {
      add(
        {
          id: "secrets-everywhere",
          severity: "medium",
          title: "Reads every secret",
          detail: `${secrets.join(", ")} on "*" returns every secret, parameter or decryptable value in the account.`,
          fix: "Scope to the ARNs (or a path prefix such as parameter/app/*) the workload uses.",
        },
        statement
      );
    }
    const destructive = granted(DESTRUCTIVE);
    if (destructive.length) {
      add(
        {
          id: "destructive-everywhere",
          severity: "medium",
          title: "Can delete data anywhere",
          detail: `${destructive.slice(0, 4).join(", ")}${destructive.length > 4 ? "…" : ""} on "*" can destroy resources this workload does not own.`,
          fix: "Scope deletes to the workload's own resources, or drop them.",
        },
        statement
      );
    }
    const broadWrites = statement.actions.filter(
      (action) =>
        !/[*?]/.test(action) &&
        ["write", "permissions"].includes(actionAccessLevel(action)) &&
        !STAR_ONLY.some((pattern) => actionMatches(pattern, action)) &&
        !coversAny([action], [...ESCALATION_ACTIONS, ...LOG_TAMPERING, ...DESTRUCTIVE]).length
    );
    if (broadWrites.length && statement.resources.includes("*")) {
      add(
        {
          id: "wildcard-resource",
          severity: "medium",
          title: 'Writes on "Resource": "*"',
          detail: `${broadWrites.slice(0, 5).join(", ")}${broadWrites.length > 5 ? ` and ${broadWrites.length - 5} more` : ""} apply to every matching resource in the account.`,
          fix: "Replace * with the ARNs of the resources this workload owns.",
        },
        statement
      );
    }
  }

  if (kind === "identity" && !statement.hasResource) {
    add(
      {
        id: "missing-resource",
        severity: "invalid",
        title: `Statement ${statement.label} has no Resource`,
        detail: "Identity policies need a Resource (or NotResource) on every statement.",
        fix: 'Add "Resource" with the ARNs this statement applies to.',
      },
      statement
    );
  }
}

function describeActions(actions) {
  if (!actions.length) return "access";
  if (actions.includes("*")) return "every action";
  return actions.length > 3
    ? `${actions.slice(0, 3).join(", ")} and ${actions.length - 3} more`
    : actions.join(", ");
}

export function labelFor(prefix) {
  return SERVICE_PREFIXES[prefix]?.label || prefix;
}

/** Short name for a resource ARN: the part after the service and account. */
export function resourceName(arn) {
  const text = String(arn);
  if (text === "*") return "*";
  const parts = text.split(":");
  if (parts.length < 6) return text;
  const tail = parts.slice(5).join(":");
  return (
    tail.replace(
      /^(table|function|key|secret|parameter|stateMachine|role|user|log-group|event-bus|repository|cluster|db|topic)[/:]/,
      ""
    ) || tail
  );
}

/**
 * Per service: the access levels granted, the actions, the resources, and
 * whether any Deny touches it. Sorted by how much the policy grants.
 */
function accessMap(statements) {
  const byService = new Map();
  const entry = (prefix) => {
    if (!byService.has(prefix)) {
      byService.set(prefix, {
        prefix,
        name: SERVICE_PREFIXES[prefix]?.name || null,
        label: labelFor(prefix),
        levels: new Set(),
        actions: new Set(),
        resources: new Set(),
        conditional: false,
        allow: false,
        deny: false,
        denied: new Set(),
      });
    }
    return byService.get(prefix);
  };
  for (const statement of statements) {
    if (statement.notActions.length && statement.effect === "Allow") {
      const service = entry("*");
      service.allow = true;
      service.levels.add("all");
      service.actions.add(`NotAction ${statement.notActions.join(", ")}`);
      for (const resource of statement.resources) service.resources.add(resource);
    }
    for (const action of statement.actions) {
      const prefix = serviceOf(action);
      if (!prefix) continue;
      const service = entry(prefix);
      if (statement.effect === "Deny") {
        service.deny = true;
        service.denied.add(action);
        continue;
      }
      service.allow = true;
      service.levels.add(actionAccessLevel(action));
      service.actions.add(action);
      for (const resource of statement.resources) service.resources.add(resource);
      for (const resource of statement.notResources) service.resources.add(`not ${resource}`);
      if (statement.condition) service.conditional = true;
    }
  }
  return [...byService.values()]
    .map((service) => {
      const level = service.allow ? maxLevel(service.levels) : null;
      const resources = [...service.resources];
      // Actions AWS only authorises on "*" don't make a service "everywhere".
      const starOnly =
        service.actions.size > 0 &&
        [...service.actions].every((action) =>
          STAR_ONLY.some((pattern) => actionMatches(pattern, action))
        );
      const everywhere =
        !starOnly && (resources.includes("*") || resources.some((r) => r.startsWith("not ")));
      return {
        ...service,
        levels: ACCESS_LEVELS.filter((candidate) => service.levels.has(candidate)),
        actions: [...service.actions].sort(),
        resources,
        denied: [...service.denied].sort(),
        level,
        everywhere,
        risk: riskFor(level, everywhere, service.prefix),
      };
    })
    .sort(
      (a, b) =>
        Number(b.allow) - Number(a.allow) ||
        (LEVEL_RANK[b.level] ?? -1) - (LEVEL_RANK[a.level] ?? -1) ||
        a.label.localeCompare(b.label)
    );
}

function riskFor(level, everywhere, prefix) {
  if (!level) return "none";
  if (level === "all") return prefix === "*" || everywhere ? "critical" : "high";
  if (level === "permissions") return "high";
  if (level === "write") return everywhere ? "medium" : "low";
  if (level === "read")
    return everywhere && ["s3", "dynamodb", "secretsmanager", "ssm", "kms"].includes(prefix)
      ? "medium"
      : "low";
  return "low";
}

/**
 * Who the policy names, one entry per principal and effect, so a principal
 * that is both allowed and explicitly denied appears twice.
 */
function principalSummary(statements) {
  const seen = new Map();
  for (const statement of statements) {
    for (const principal of statement.principals) {
      const key = `${statement.effect}:${principal.type}:${principal.value}`;
      if (!seen.has(key)) {
        seen.set(key, {
          ...principal,
          key: `${principal.type}:${principal.value}`,
          label: principalLabel(principal),
          effect: statement.effect,
          conditional: true,
          limited: true,
          statements: [],
          actions: new Set(),
        });
      }
      const entry = seen.get(key);
      entry.statements.push(statement.index);
      // Unconditional if any statement for it is unconditional.
      entry.conditional = entry.conditional && Boolean(statement.condition);
      entry.limited = entry.limited && limitsCaller(statement.condition);
      for (const action of statement.actions) entry.actions.add(action);
    }
  }
  return [...seen.values()].map((principal) => ({ ...principal, actions: [...principal.actions] }));
}

export function principalLabel({ type, value }) {
  if (value === "*") return "Anyone (public)";
  if (type === "Service") return value.replace(/\.amazonaws\.com(\.cn)?$/, "");
  if (type === "Federated") return value.split("/").pop();
  const account = accountOf(value);
  if (/:root$/.test(value) || /^\d{12}$/.test(value)) return `Account ${account}`;
  const name = value.split("/").pop();
  return account ? `${name} (${account})` : name;
}

// ---------------------------------------------------------- access map

const RISK_STROKE = {
  critical: "#d13212",
  high: "#dd344c",
  medium: "#ed7100",
  low: "#1d8102",
  none: "#7890ab",
};

const LEVEL_LABEL = {
  list: "list",
  read: "read",
  tagging: "tag",
  write: "write",
  permissions: "permissions",
  all: "full access",
};

/** Service principal host → catalog name, for drawing who a resource policy lets in. */
const SERVICE_PRINCIPALS = {
  lambda: "AWS Lambda",
  ec2: "Amazon EC2",
  "ecs-tasks": "Amazon Elastic Container Service",
  states: "AWS Step Functions",
  events: "Amazon EventBridge",
  sns: "Amazon Simple Notification Service",
  s3: "Amazon Simple Storage Service",
  cloudfront: "Amazon CloudFront",
  apigateway: "Amazon API Gateway",
  logs: "Amazon CloudWatch",
  glue: "AWS Glue",
  sagemaker: "Amazon SageMaker",
  codebuild: "AWS CodeBuild",
  firehose: "Amazon Data Firehose",
  edgelambda: "AWS Lambda",
};

function principalNode(principal) {
  if (principal.value === "*") return { service: "Users 48 Light", type: "resource" };
  if (principal.type === "Service") {
    const host = principal.value.replace(/\.amazonaws\.com(\.cn)?$/, "");
    return {
      service: SERVICE_PRINCIPALS[host] || "AWS Identity and Access Management",
      type: "service",
    };
  }
  if (principal.type === "Federated")
    return { service: "Authenticated User 48 Light", type: "resource" };
  if (/:role\//.test(principal.value))
    return { service: "AWS Identity Access Management Role", type: "resource" };
  return { service: "AWS Organizations", type: "service" };
}

const RISK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const PRINCIPAL_FINDINGS = new Set([
  "public",
  "public-conditional",
  "cross-account-root",
  "federated-no-condition",
  "federated-no-subject",
  "not-principal",
]);

/** The worst principal-related finding raised on any of these statements. */
function principalRisk(analysis, statements) {
  const indexes = new Set(statements);
  return analysis.findings
    .filter((finding) => PRINCIPAL_FINDINGS.has(finding.id) && indexes.has(finding.statement))
    .map((finding) => (RISK_RANK[finding.severity] ? finding.severity : "low"))
    .reduce((worst, risk) => (RISK_RANK[risk] > RISK_RANK[worst] ? risk : worst), "low");
}

const worse = (a, b) => (RISK_RANK[a] >= RISK_RANK[b] ? a : b);

function allowStyle(risk) {
  return {
    stroke: RISK_STROKE[risk],
    strokeWidth: risk === "critical" || risk === "high" ? 2.2 : 1.6,
  };
}

// Denies are drawn dashed grey (see the note), with an open arrowhead.
const DENY_STYLE = { stroke: RISK_STROKE.none, dash: "dashed", endArrow: "open" };

/**
 * Resource policies: one arrow per (principal, effect, service) built from
 * the statements that actually name that principal, so an allowed role and
 * an explicitly denied "*" are drawn differently.
 */
function resourceLinks(analysis) {
  const links = new Map();
  for (const statement of analysis.statements) {
    if (statement.valid === false) continue;
    const byService = new Map();
    if (statement.notActions.length)
      byService.set("*", [`NotAction ${statement.notActions.join(", ")}`]);
    for (const action of statement.actions) {
      const prefix = serviceOf(action);
      if (prefix) byService.set(prefix, [...(byService.get(prefix) || []), action]);
    }
    for (const principal of statement.principals) {
      for (const [prefix, actions] of byService) {
        const key = `${principal.type}:${principal.value}|${statement.effect}|${prefix}`;
        const entry = links.get(key) || {
          principal: `${principal.type}:${principal.value}`,
          effect: statement.effect,
          prefix,
          actions: new Set(),
          levels: new Set(),
          statements: [],
          conditional: true,
        };
        for (const action of actions) {
          entry.actions.add(action);
          entry.levels.add(action.startsWith("NotAction") ? "all" : actionAccessLevel(action));
        }
        entry.statements.push(statement.index);
        entry.conditional = entry.conditional && Boolean(statement.condition);
        links.set(key, entry);
      }
    }
  }
  return [...links.values()];
}

function principalNodes(analysis) {
  const seen = new Map();
  for (const principal of analysis.principals) {
    if (seen.has(principal.key)) continue;
    seen.set(principal.key, {
      key: `principal-${seen.size}`,
      id: principal.key,
      ...principalNode(principal),
      name: principalLabel(principal).slice(0, 60),
      zone: principal.value === "*" ? "internet" : "management",
      criticality: "high",
    });
  }
  return [...seen.values()];
}

/**
 * A diagram blueprint of the access a policy grants: principals on the left,
 * the services they reach on the right, one arrow per principal and service
 * coloured by risk and labelled with the access level. Denies are dashed.
 */
export function accessMapBlueprint(
  analysis,
  { name = "IAM access map", subject = "This role" } = {}
) {
  if (analysis.kind === "trust") return trustBlueprint(analysis, { name, subject });
  const rowGap = 110;
  const top = 120;
  const serviceX = 560;
  const servicesByPrefix = new Map(analysis.services.map((service) => [service.prefix, service]));

  let principals;
  let links;
  let prefixes;
  if (analysis.kind === "identity" || !analysis.principals.length) {
    principals = [
      {
        key: "principal",
        service: "AWS Identity Access Management Role",
        type: "resource",
        name: subject,
        zone: "management",
        criticality: "high",
      },
    ];
    const services = analysis.services.filter((service) => service.allow || service.deny);
    prefixes = services.map((service) => service.prefix);
    links = services.flatMap((service) => [
      ...(service.allow
        ? [
            {
              from: "principal",
              to: `svc-${service.prefix}`,
              label: `${LEVEL_LABEL[service.level]}${service.level === "all" ? "" : ` · ${plural(service.actions.length, "action")}`}${service.everywhere ? " · all resources" : ""}`,
              type: service.level === "read" || service.level === "list" ? "data" : "request",
              style: allowStyle(service.risk),
            },
          ]
        : []),
      ...(service.deny
        ? [
            {
              from: "principal",
              to: `svc-${service.prefix}`,
              label: `deny · ${plural(service.denied.length, "action")}`,
              type: "request",
              style: DENY_STYLE,
            },
          ]
        : []),
    ]);
  } else {
    principals = principalNodes(analysis);
    const keyOf = new Map(principals.map((principal) => [principal.id, principal.key]));
    const entries = resourceLinks(analysis);
    prefixes = [...new Set(entries.map((entry) => entry.prefix))].sort(
      (a, b) =>
        (servicesByPrefix.has(b) ? 1 : 0) - (servicesByPrefix.has(a) ? 1 : 0) ||
        labelFor(a).localeCompare(labelFor(b))
    );
    links = entries.map((entry) => {
      const count = [...entry.actions].length;
      if (entry.effect === "Deny") {
        return {
          from: keyOf.get(entry.principal),
          to: `svc-${entry.prefix}`,
          label: `deny · ${plural(count, "action")}${entry.conditional ? " · conditional" : ""}`,
          type: "request",
          style: DENY_STYLE,
        };
      }
      const level = maxLevel(entry.levels);
      const risk = worse(
        principalRisk(analysis, entry.statements),
        riskFor(level, false, entry.prefix)
      );
      return {
        from: keyOf.get(entry.principal),
        to: `svc-${entry.prefix}`,
        label: `${LEVEL_LABEL[level]}${level === "all" ? "" : ` · ${plural(count, "action")}`}${entry.conditional ? " · conditional" : ""}`,
        type: level === "read" || level === "list" ? "data" : "request",
        style: allowStyle(risk),
      };
    });
  }

  const height = Math.max(prefixes.length, principals.length, 1) * rowGap + 80;
  const principalTop = top + ((Math.max(prefixes.length, 1) - principals.length) * rowGap) / 2;
  const nodes = [
    ...principals.map((principal, index) => ({
      key: principal.key,
      service: principal.service,
      type: principal.type,
      name: principal.name,
      x: 80,
      y: Math.max(top, principalTop) + index * rowGap,
      zone: principal.zone,
      criticality: "high",
    })),
    ...prefixes.map((prefix, index) => {
      const service = servicesByPrefix.get(prefix);
      const label = service?.label || labelFor(prefix);
      const resources = service?.resources || [];
      return {
        key: `svc-${prefix}`,
        service:
          service?.name || SERVICE_PREFIXES[prefix]?.name || "AWS Identity and Access Management",
        name: (resources.length === 1 && resources[0] !== "*"
          ? `${label} · ${resourceName(resources[0])}`
          : label
        ).slice(0, 60),
        x: serviceX,
        y: top + index * rowGap,
        parent: "account",
        notes: [
          service?.actions.length
            ? `Allowed: ${service.actions.slice(0, 8).join(", ")}${service.actions.length > 8 ? "…" : ""}`
            : "",
          service?.denied.length ? `Denied: ${service.denied.slice(0, 6).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 280),
        criticality: service?.risk === "critical" || service?.risk === "high" ? "high" : "medium",
      };
    }),
  ];

  return {
    name,
    groups: [
      {
        key: "account",
        preset: "aws-account",
        label: "AWS Account",
        x: serviceX - 90,
        y: top - 70,
        w: 420,
        h: height,
      },
    ],
    nodes,
    links,
    shapes: [
      {
        kind: "note",
        x: 40,
        y: top + height - 40,
        w: 330,
        h: 96,
        label: `Grade ${analysis.grade} (${analysis.score ?? "—"}/100) · ${plural(analysis.findings.filter((f) => f.severity !== "info").length, "finding")}. Arrow colour shows risk: red high, orange medium, green low. Dashed = explicit deny.`,
      },
    ],
  };
}

/** Trust policies: who can become this role, one arrow per principal and effect. */
function trustBlueprint(analysis, { name, subject }) {
  const rowGap = 110;
  const top = 120;
  const principals = principalNodes(analysis);
  const keyOf = new Map(principals.map((principal) => [principal.id, principal.key]));
  const roleY = top + ((Math.max(principals.length, 1) - 1) * rowGap) / 2;
  return {
    name,
    groups: [
      {
        key: "account",
        preset: "aws-account",
        label: "AWS Account",
        x: 470,
        y: roleY - 70,
        w: 280,
        h: 200,
      },
    ],
    nodes: [
      ...principals.map((principal, index) => ({
        key: principal.key,
        service: principal.service,
        type: principal.type,
        name: principal.name,
        x: 80,
        y: top + index * rowGap,
        zone: principal.zone,
        criticality: "high",
      })),
      {
        key: "role",
        service: "AWS Identity Access Management Role",
        type: "resource",
        name: subject,
        x: 586,
        y: roleY,
        parent: "account",
        zone: "management",
        criticality: "high",
      },
    ],
    links: analysis.principals.map((principal) => ({
      from: keyOf.get(principal.key),
      to: "role",
      label: `${principal.effect === "Deny" ? "denied" : "can assume"}${principal.conditional ? " · with condition" : ""}`,
      type: "request",
      style:
        principal.effect === "Deny"
          ? DENY_STYLE
          : { ...allowStyle(principalRisk(analysis, principal.statements)), strokeWidth: 1.8 },
    })),
    shapes: [
      {
        kind: "note",
        x: 40,
        y: top + Math.max(principals.length, 1) * rowGap + 10,
        w: 330,
        h: 80,
        label: `Trust policy · grade ${analysis.grade} (${analysis.score ?? "—"}/100). Arrow colour shows risk: red high, orange medium, green low. Dashed = explicit deny.`,
      },
    ],
  };
}

// ------------------------------------------------- least privilege from a diagram

/** Compute services that run as an IAM role, with the service principal that assumes it. */
const ROLE_HOLDERS = [
  { match: /lambda/i, principal: "lambda.amazonaws.com", kind: "Lambda execution role" },
  { match: /step functions/i, principal: "states.amazonaws.com", kind: "Step Functions role" },
  {
    match: /elastic container service|fargate/i,
    principal: "ecs-tasks.amazonaws.com",
    kind: "ECS task role",
  },
  { match: /kubernetes/i, principal: "pods.eks.amazonaws.com", kind: "EKS pod identity role" },
  {
    match: /\bec2\b|auto scaling|elastic beanstalk/i,
    principal: "ec2.amazonaws.com",
    kind: "EC2 instance profile role",
  },
  {
    match: /app runner/i,
    principal: "tasks.apprunner.amazonaws.com",
    kind: "App Runner instance role",
  },
  { match: /\bglue\b/i, principal: "glue.amazonaws.com", kind: "Glue job role" },
  { match: /sagemaker/i, principal: "sagemaker.amazonaws.com", kind: "SageMaker execution role" },
  { match: /codebuild/i, principal: "codebuild.amazonaws.com", kind: "CodeBuild service role" },
  { match: /\bbatch\b/i, principal: "ecs-tasks.amazonaws.com", kind: "Batch job role" },
  { match: /firehose/i, principal: "firehose.amazonaws.com", kind: "Firehose delivery role" },
  {
    match: /api gateway/i,
    principal: "apigateway.amazonaws.com",
    kind: "API Gateway integration role",
  },
  { match: /eventbridge/i, principal: "events.amazonaws.com", kind: "EventBridge target role" },
];

/**
 * What a caller needs to use a target service. `read`/`write` split storage
 * access so a connection labelled "read" or "write" narrows it further.
 */
const TARGET_ACCESS = [
  {
    match: /dynamodb/i,
    read: ["dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query"],
    write: [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
    ],
    arn: (ctx) => [
      `arn:aws:dynamodb:${ctx.region}:${ctx.account}:table/${ctx.name}`,
      `arn:aws:dynamodb:${ctx.region}:${ctx.account}:table/${ctx.name}/index/*`,
    ],
  },
  {
    match: /simple storage service(?! glacier)|\bs3\b/i,
    read: ["s3:GetObject"],
    write: ["s3:PutObject"],
    extra: [{ actions: ["s3:ListBucket"], arn: (ctx) => [`arn:aws:s3:::${ctx.name}`] }],
    arn: (ctx) => [`arn:aws:s3:::${ctx.name}/*`],
  },
  {
    match: /simple queue service|\bsqs\b/i,
    write: ["sqs:SendMessage"],
    arn: (ctx) => [`arn:aws:sqs:${ctx.region}:${ctx.account}:${ctx.name}`],
  },
  {
    match: /simple notification service|\bsns\b/i,
    write: ["sns:Publish"],
    arn: (ctx) => [`arn:aws:sns:${ctx.region}:${ctx.account}:${ctx.name}`],
  },
  {
    match: /eventbridge/i,
    write: ["events:PutEvents"],
    arn: (ctx) => [`arn:aws:events:${ctx.region}:${ctx.account}:event-bus/${ctx.name}`],
  },
  {
    match: /step functions/i,
    write: ["states:StartExecution"],
    arn: (ctx) => [`arn:aws:states:${ctx.region}:${ctx.account}:stateMachine:${ctx.name}`],
  },
  {
    match: /lambda/i,
    write: ["lambda:InvokeFunction"],
    arn: (ctx) => [`arn:aws:lambda:${ctx.region}:${ctx.account}:function:${ctx.name}`],
  },
  {
    match: /kinesis/i,
    write: ["kinesis:PutRecord", "kinesis:PutRecords"],
    arn: (ctx) => [`arn:aws:kinesis:${ctx.region}:${ctx.account}:stream/${ctx.name}`],
  },
  {
    match: /firehose/i,
    write: ["firehose:PutRecord", "firehose:PutRecordBatch"],
    arn: (ctx) => [`arn:aws:firehose:${ctx.region}:${ctx.account}:deliverystream/${ctx.name}`],
  },
  {
    match: /secrets manager/i,
    read: ["secretsmanager:GetSecretValue"],
    arn: (ctx) => [`arn:aws:secretsmanager:${ctx.region}:${ctx.account}:secret:${ctx.name}-*`],
  },
  {
    match: /key management/i,
    read: ["kms:Decrypt"],
    write: ["kms:GenerateDataKey"],
    arn: (ctx) => [`arn:aws:kms:${ctx.region}:${ctx.account}:key/REPLACE-WITH-KEY-ID`],
  },
  {
    match: /systems manager/i,
    read: ["ssm:GetParameter", "ssm:GetParameters"],
    arn: (ctx) => [`arn:aws:ssm:${ctx.region}:${ctx.account}:parameter/${ctx.name}/*`],
  },
  {
    match: /cloudwatch/i,
    write: ["logs:CreateLogStream", "logs:PutLogEvents"],
    extra: [
      {
        actions: ["cloudwatch:PutMetricData"],
        arn: () => ["*"],
        condition: (ctx) => ({ StringEquals: { "cloudwatch:namespace": ctx.name } }),
      },
    ],
    arn: (ctx) => [
      `arn:aws:logs:${ctx.region}:${ctx.account}:log-group:/aws/${ctx.source}/${ctx.sourceSlug}:*`,
    ],
  },
  {
    match: /\brds\b|aurora/i,
    write: ["rds-db:connect"],
    arn: (ctx) => [
      `arn:aws:rds-db:${ctx.region}:${ctx.account}:dbuser:REPLACE-WITH-RESOURCE-ID/${ctx.sourceSlug}`,
    ],
  },
  {
    match: /bedrock/i,
    write: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    arn: (ctx) => [`arn:aws:bedrock:${ctx.region}::foundation-model/*`],
  },
  {
    match: /opensearch/i,
    read: ["es:ESHttpGet", "es:ESHttpHead"],
    write: ["es:ESHttpPost", "es:ESHttpPut"],
    arn: (ctx) => [`arn:aws:es:${ctx.region}:${ctx.account}:domain/${ctx.name}/*`],
  },
  {
    match: /elasticache/i,
    write: ["elasticache:Connect"],
    arn: (ctx) => [`arn:aws:elasticache:${ctx.region}:${ctx.account}:replicationgroup:${ctx.name}`],
  },
  {
    match: /simple email service/i,
    write: ["ses:SendEmail", "ses:SendRawEmail"],
    arn: (ctx) => [`arn:aws:ses:${ctx.region}:${ctx.account}:identity/*`],
  },
  {
    match: /api gateway/i,
    write: ["execute-api:Invoke"],
    arn: (ctx) => [`arn:aws:execute-api:${ctx.region}:${ctx.account}:REPLACE-WITH-API-ID/*`],
  },
  {
    match: /x-?ray/i,
    write: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
    arn: () => ["*"],
  },
];

/** Event sources that poll on the consumer's behalf, so the consumer's role needs read access. */
const POLLED_SOURCES = [
  {
    match: /simple queue service|\bsqs\b/i,
    actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
    arn: (ctx) => [`arn:aws:sqs:${ctx.region}:${ctx.account}:${ctx.name}`],
  },
  {
    match: /kinesis/i,
    actions: [
      "kinesis:GetRecords",
      "kinesis:GetShardIterator",
      "kinesis:DescribeStream",
      "kinesis:ListShards",
    ],
    arn: (ctx) => [`arn:aws:kinesis:${ctx.region}:${ctx.account}:stream/${ctx.name}`],
  },
  {
    match: /dynamodb/i,
    actions: [
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:DescribeStream",
      "dynamodb:ListStreams",
    ],
    arn: (ctx) => [`arn:aws:dynamodb:${ctx.region}:${ctx.account}:table/${ctx.name}/stream/*`],
  },
];

/** Services that push to a target and need the target's resource policy to let them in. */
const PUSH_PRINCIPALS = [
  { match: /cloudfront/i, principal: "cloudfront.amazonaws.com" },
  { match: /api gateway/i, principal: "apigateway.amazonaws.com" },
  { match: /eventbridge/i, principal: "events.amazonaws.com" },
  { match: /simple notification service|\bsns\b/i, principal: "sns.amazonaws.com" },
  { match: /simple storage service|\bs3\b/i, principal: "s3.amazonaws.com" },
];

export const PLACEHOLDER_ACCOUNT = "111122223333";

export function slug(text, fallback = "resource") {
  const value = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return value || fallback;
}

function statementSid(text) {
  return (
    String(text)
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join("")
      .slice(0, 60) || "Access"
  );
}

const READ_WORDS =
  /\b(read|reads|reading|query|queries|fetch|fetches|get|gets|load|loads|lookup|lookups|scan|scans|list|lists|download|downloads)\b/;
const WRITE_WORDS =
  /\b(write|writes|writing|put|puts|store|stores|save|saves|upload|uploads|send|sends|publish|publishes|insert|inserts|update|updates|delete|deletes|record|records)\b/;

/** Narrow storage access from an arrow's label: "Reads orders" → read, "Upload" → write. */
export function directionFor(connection) {
  const text = `${connection?.label || ""}`.toLowerCase();
  const read = READ_WORDS.test(text);
  const write = WRITE_WORDS.test(text);
  if (read && !write) return "read";
  if (write && !read) return "write";
  return "both";
}

/**
 * Write least-privilege policies for the arrows drawn in AWS Studio.
 *
 * Each compute node (Lambda, ECS, EC2, Step Functions…) with outgoing arrows
 * gets a role: a trust policy for its service principal and an identity
 * policy naming exactly the target resources. Queues and streams that feed a
 * consumer grant the consumer's role their read actions, and services that
 * push into a Lambda or bucket get the matching resource-policy statement.
 *
 * @param {{nodes: object[], connections: object[], region?: string}} doc
 * @returns {{roles: object[], resourcePolicies: object[], skipped: string[]}}
 */
export function leastPrivilegeFromDiagram(doc, { account = PLACEHOLDER_ACCOUNT } = {}) {
  const region = doc?.region || "us-east-1";
  const nodes = new Map((doc?.nodes || []).map((node) => [node.id, node]));
  const roles = new Map();
  const resourcePolicies = new Map();
  const skipped = [];
  const holderOf = (node) =>
    ROLE_HOLDERS.find((holder) => holder.match.test(node.serviceName || ""));

  const roleFor = (node) => {
    const holder = holderOf(node);
    if (!holder) return null;
    if (!roles.has(node.id)) {
      roles.set(node.id, {
        nodeId: node.id,
        name: node.name,
        service: node.serviceName,
        roleName: `${slug(node.name, "workload")}-role`.slice(0, 64),
        kind: holder.kind,
        trust: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: holder.principal },
              Action:
                holder.principal === "pods.eks.amazonaws.com"
                  ? ["sts:AssumeRole", "sts:TagSession"]
                  : "sts:AssumeRole",
              Condition: { StringEquals: { "aws:SourceAccount": account } },
            },
          ],
        },
        statements: new Map(),
        targets: [],
      });
    }
    return roles.get(node.id);
  };

  const grant = (role, sid, actions, resources, condition = null) => {
    const key = `${sid}|${resources.join(",")}`;
    const existing = role.statements.get(key);
    if (existing) {
      existing.Action = [...new Set([...existing.Action, ...actions])];
      return;
    }
    role.statements.set(key, {
      Sid: sid,
      Effect: "Allow",
      Action: [...actions],
      Resource: resources.length === 1 ? resources[0] : resources,
      ...(condition ? { Condition: condition } : {}),
    });
  };

  for (const connection of doc?.connections || []) {
    const source = nodes.get(connection.from);
    const target = nodes.get(connection.to);
    if (!source || !target) continue;
    const ctx = {
      region,
      account,
      name: slug(target.name),
      source: slug(source.serviceName?.replace(/^(AWS|Amazon) /, "")),
      sourceSlug: slug(source.name),
    };

    let handled = false;

    // A service pushing into a Lambda, queue, topic or bucket is let in by
    // the target's resource policy rather than by a role.
    const pusher = PUSH_PRINCIPALS.find((candidate) =>
      candidate.match.test(source.serviceName || "")
    );
    if (pusher) {
      const policy = resourcePolicyFor(source, target, pusher.principal, {
        region,
        account,
        source: slug(source.name),
        name: slug(target.name),
      });
      if (policy) {
        const existing = resourcePolicies.get(target.id);
        if (existing) existing.policy.Statement.push(...policy.policy.Statement);
        else resourcePolicies.set(target.id, policy);
        handled = true;
      }
    }

    // A role holder calling a target service.
    const access = TARGET_ACCESS.find((candidate) =>
      candidate.match.test(target.serviceName || "")
    );
    const role = handled ? null : roleFor(source);
    if (role && access) {
      const direction = directionFor(connection);
      const actions = [
        ...(direction !== "write" ? access.read || [] : []),
        ...(direction !== "read" ? access.write || [] : []),
      ];
      const granted = actions.length ? actions : [...(access.read || []), ...(access.write || [])];
      const label = `${target.name} ${String(target.serviceName || "").replace(/^(AWS|Amazon) /, "")}`;
      grant(role, statementSid(label), granted, access.arn(ctx));
      for (const extra of access.extra || []) {
        grant(
          role,
          statementSid(`${label} ${extra.actions[0].split(":")[1]}`),
          extra.actions,
          extra.arn(ctx),
          extra.condition?.(ctx) || null
        );
      }
      role.targets.push(target.name);
      handled = true;
    }

    // A queue or stream feeding a consumer: the consumer's role polls it.
    const polled = POLLED_SOURCES.find((candidate) =>
      candidate.match.test(source.serviceName || "")
    );
    const consumer = polled && !holderOf(source) ? roleFor(target) : null;
    if (consumer) {
      grant(
        consumer,
        statementSid(`${source.name} consume`),
        polled.actions,
        polled.arn({ ...ctx, name: slug(source.name) })
      );
      consumer.targets.push(source.name);
      handled = true;
    }

    if (!handled && /^(AWS|Amazon|Elastic)\b/.test(source.serviceName || "")) {
      skipped.push(`${source.name} → ${target.name}`);
    }
  }

  return {
    roles: [...roles.values()]
      .filter((role) => role.statements.size)
      .map((role) => ({
        ...role,
        statements: undefined,
        policy: {
          Version: "2012-10-17",
          Statement: uniqueStatements([...role.statements.values()]),
        },
      })),
    resourcePolicies: [...resourcePolicies.values()].map((entry) => ({
      ...entry,
      policy: { ...entry.policy, Statement: uniqueStatements(entry.policy.Statement) },
    })),
    skipped,
    account,
    region,
  };
}

/**
 * Drop exact duplicate statements (the same arrow drawn twice) and make every
 * Sid unique, since IAM and resource policies reject repeated Sids.
 */
function uniqueStatements(statements) {
  const seen = new Set();
  const sids = new Map();
  const result = [];
  for (const statement of statements) {
    const { Sid, ...body } = statement;
    const signature = JSON.stringify(body);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const count = (sids.get(Sid) || 0) + 1;
    sids.set(Sid, count);
    result.push({ Sid: count === 1 ? Sid : `${Sid}${count}`, ...body });
  }
  // A suffixed Sid could collide with a real one ("Orders" + "Orders2"); re-number if so.
  const names = result.map((statement) => statement.Sid);
  if (new Set(names).size !== names.length) {
    result.forEach((statement, index) => (statement.Sid = `${statement.Sid}N${index + 1}`));
  }
  return result;
}

function resourcePolicyFor(source, target, principal, ctx) {
  const name = target.serviceName || "";
  const sourceArn = {
    "cloudfront.amazonaws.com": `arn:aws:cloudfront::${ctx.account}:distribution/REPLACE-WITH-DISTRIBUTION-ID`,
    "apigateway.amazonaws.com": `arn:aws:execute-api:${ctx.region}:${ctx.account}:REPLACE-WITH-API-ID/*`,
    "events.amazonaws.com": `arn:aws:events:${ctx.region}:${ctx.account}:rule/${ctx.source}`,
    "sns.amazonaws.com": `arn:aws:sns:${ctx.region}:${ctx.account}:${ctx.source}`,
    "s3.amazonaws.com": `arn:aws:s3:::${ctx.source}`,
  }[principal];
  const statement = (action, resource) => ({
    Sid: statementSid(`Allow ${source.name}`),
    Effect: "Allow",
    Principal: { Service: principal },
    Action: action,
    Resource: resource,
    Condition: { ArnLike: { "aws:SourceArn": sourceArn } },
  });
  if (/lambda/i.test(name) && principal !== "cloudfront.amazonaws.com") {
    return {
      nodeId: target.id,
      name: target.name,
      service: target.serviceName,
      kind: "Lambda resource policy",
      policy: {
        Version: "2012-10-17",
        Statement: [
          statement(
            "lambda:InvokeFunction",
            `arn:aws:lambda:${ctx.region}:${ctx.account}:function:${ctx.name}`
          ),
        ],
      },
    };
  }
  if (/simple storage service|\bs3\b/i.test(name) && principal === "cloudfront.amazonaws.com") {
    return {
      nodeId: target.id,
      name: target.name,
      service: target.serviceName,
      kind: "S3 bucket policy",
      policy: {
        Version: "2012-10-17",
        Statement: [statement("s3:GetObject", `arn:aws:s3:::${ctx.name}/*`)],
      },
    };
  }
  if (
    /simple queue service|\bsqs\b/i.test(name) &&
    ["sns.amazonaws.com", "events.amazonaws.com", "s3.amazonaws.com"].includes(principal)
  ) {
    return {
      nodeId: target.id,
      name: target.name,
      service: target.serviceName,
      kind: "SQS queue policy",
      policy: {
        Version: "2012-10-17",
        Statement: [
          statement("sqs:SendMessage", `arn:aws:sqs:${ctx.region}:${ctx.account}:${ctx.name}`),
        ],
      },
    };
  }
  if (
    /simple notification service|\bsns\b/i.test(name) &&
    ["events.amazonaws.com", "s3.amazonaws.com"].includes(principal)
  ) {
    return {
      nodeId: target.id,
      name: target.name,
      service: target.serviceName,
      kind: "SNS topic policy",
      policy: {
        Version: "2012-10-17",
        Statement: [
          statement("sns:Publish", `arn:aws:sns:${ctx.region}:${ctx.account}:${ctx.name}`),
        ],
      },
    };
  }
  return null;
}

export function formatPolicy(policy) {
  return JSON.stringify(policy, null, 2);
}
