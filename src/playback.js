/**
 * Incident Playback — a scripted, narrated walkthrough that auto-drives the
 * atlas through a story: steady state, a traffic surge, an edge flood, identity
 * drift, a compounding failure, and finally a clean recovery drill.
 *
 * The script is data-only (no DOM) so it can be validated against the resilience
 * model in tests; the atlas controller drives the UI from it.
 */

export const PLAYBACK_SCRIPT = [
  {
    scenario: "steady",
    faults: [],
    node: "Step Functions core",
    title: "Steady state",
    narration:
      "Every service is serving and confidence is balanced. This is the baseline we defend.",
    ms: 4200,
  },
  {
    scenario: "surge",
    faults: [],
    node: "CloudFront edge",
    title: "Traffic surge",
    narration:
      "Demand climbs. CloudFront absorbs the wave at the edge while EKS scales out behind it.",
    ms: 4200,
  },
  {
    scenario: "surge",
    faults: ["edge"],
    node: "CloudFront edge",
    title: "Edge flood",
    narration:
      "Cache misses and hostile traffic saturate the entry path — watch the blast radius widen.",
    ms: 4600,
  },
  {
    scenario: "identity",
    faults: ["identity"],
    node: "IAM trust broker",
    title: "Identity drift",
    narration: "Federated trust expands past its boundary. IAM tightens and approvals take over.",
    ms: 4600,
  },
  {
    scenario: "identity",
    faults: ["identity", "data"],
    node: "Aurora data mesh",
    title: "Compounding failure",
    narration:
      "A second fault stacks on the first. Two coupled domains push the system toward systemic risk.",
    ms: 4600,
  },
  {
    scenario: "recovery",
    faults: [],
    node: "Step Functions core",
    title: "Recovery drill",
    narration:
      "The recovery loop proves workflow, data, and approvals realign. Confidence is restored.",
    ms: 4600,
  },
];

/** Total number of steps in the playback script. */
export const PLAYBACK_LENGTH = PLAYBACK_SCRIPT.length;

/**
 * Clamp a step index into the valid range, returning the step (or null when the
 * script has ended).
 * @param {number} index
 * @returns {object|null}
 */
export function playbackStep(index) {
  if (!Number.isInteger(index) || index < 0 || index >= PLAYBACK_SCRIPT.length) return null;
  return PLAYBACK_SCRIPT[index];
}
