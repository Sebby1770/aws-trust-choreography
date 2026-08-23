import { describe, it, expect } from "vitest";
import { matchIcon } from "../src/icon-match.js";
import {
  CLOUDFORMATION_SERVICES,
  TERRAFORM_PREFIX_FALLBACKS,
  TERRAFORM_TYPES,
} from "../src/iac-service-map.js";
import { AWS_ICON_CATALOG } from "../assets/aws-icons/catalog.js";

/** Every service name the IaC importer is capable of emitting. */
function emittableServiceNames() {
  const names = new Set();
  for (const entry of Object.values(TERRAFORM_TYPES)) names.add(entry.service);
  for (const [, entry] of TERRAFORM_PREFIX_FALLBACKS) names.add(entry.service);
  for (const entry of Object.values(CLOUDFORMATION_SERVICES)) names.add(entry.service);
  return [...names].sort();
}

describe("matchIcon", () => {
  const catalog = [
    { name: "AWS Lambda", type: "service" },
    { name: "AWS Lambda Lambda Function", type: "resource" },
    { name: "Amazon DynamoDB", type: "service" },
  ];

  it("prefers an exact match on the preferred type", () => {
    expect(matchIcon(catalog, "AWS Lambda").name).toBe("AWS Lambda");
  });

  it("falls back to a substring match on the preferred type", () => {
    expect(matchIcon(catalog, "Lambda").name).toBe("AWS Lambda");
  });

  it("falls back to any type before giving up", () => {
    expect(matchIcon(catalog, "Lambda Function").type).toBe("resource");
  });

  it("is case insensitive", () => {
    expect(matchIcon(catalog, "aws lambda").name).toBe("AWS Lambda");
  });

  it("returns undefined for an unknown or empty name", () => {
    expect(matchIcon(catalog, "Amazon Braket")).toBeUndefined();
    expect(matchIcon(catalog, "")).toBeUndefined();
    expect(matchIcon(catalog, null)).toBeUndefined();
  });

  it("tolerates a missing catalog", () => {
    expect(matchIcon(null, "AWS Lambda")).toBeUndefined();
  });
});

describe("IaC service map resolves against the real icon catalog", () => {
  // A service name that does not resolve makes Flow Studio silently DROP the
  // node on import — the node simply never appears. `AWS X-Ray` shipped broken
  // this way because the catalog spells it `AWS X Ray`, so this walks the whole
  // map rather than spot-checking.
  it("maps every emittable service name to an icon", () => {
    const unresolved = emittableServiceNames().filter((name) => !matchIcon(AWS_ICON_CATALOG, name));
    expect(unresolved).toEqual([]);
  });

  it("covers a meaningful number of services", () => {
    expect(emittableServiceNames().length).toBeGreaterThan(40);
  });

  it("resolves the service names that regressed before", () => {
    for (const name of ["AWS X Ray", "NAT Gateway", "Amazon EFS", "Amazon Data Firehose"]) {
      expect(matchIcon(AWS_ICON_CATALOG, name), `${name} must resolve`).toBeTruthy();
    }
  });
});
