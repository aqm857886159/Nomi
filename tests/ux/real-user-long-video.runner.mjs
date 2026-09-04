import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(HERE, "real-user-long-video.manifest.json");
export const REAL_USER_LONG_VIDEO_MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const FORBIDDEN_DRIVER_KEYS = /(^|[^a-z])(inject|set|get|read|use|dispatch).*(store|zustand|state)|store|zustand/i;
const VALID_EVIDENCE_STATES = new Set(["loopback", "recorded", "blocked-live"]);

function uiBoundaryRequired(driver) {
  if (!driver || typeof driver.perform !== "function") return true;
  return Object.keys(driver).some((key) => FORBIDDEN_DRIVER_KEYS.test(key));
}

function assertUiBoundaryDriver(driver) {
  if (uiBoundaryRequired(driver)) {
    throw new Error("ui_boundary_required: journey drivers may only expose visible UI boundary actions");
  }
}

function normalizeResult(step, result) {
  const normalized = result && typeof result === "object" ? result : {};
  const status = normalized.status === "pass" || normalized.status === "blocked" ? normalized.status : "blocked";
  const evidenceState = VALID_EVIDENCE_STATES.has(normalized.evidenceState)
    ? normalized.evidenceState
    : "blocked-live";
  if (status === "pass" && evidenceState === "blocked-live") {
    throw new Error(`invalid_evidence: ${step.id} cannot pass with blocked-live evidence`);
  }
  return {
    stepId: step.id,
    action: step.action,
    classification: step.classification,
    status,
    evidenceState,
    detail: typeof normalized.detail === "string" ? normalized.detail : "",
    evidence: normalized.evidence && typeof normalized.evidence === "object" ? normalized.evidence : {},
  };
}

export async function runRealUserLongVideoJourney({ driver, record = () => {} } = {}) {
  assertUiBoundaryDriver(driver);
  const steps = [];
  let blockedBy = null;

  for (const step of REAL_USER_LONG_VIDEO_MANIFEST.steps) {
    if (blockedBy) {
      const skipped = {
        stepId: step.id,
        action: step.action,
        classification: step.classification,
        status: "blocked",
        evidenceState: "blocked-live",
        detail: `blocked_by:${blockedBy}`,
        evidence: {},
      };
      steps.push(skipped);
      record(skipped);
      continue;
    }
    const result = normalizeResult(step, await driver.perform({ ...step }));
    steps.push(result);
    record(result);
    if (result.status === "blocked") blockedBy = step.id;
  }

  return {
    manifestId: REAL_USER_LONG_VIDEO_MANIFEST.id,
    terminalStatus: blockedBy ? "blocked" : "pass",
    blockedBy,
    steps,
  };
}

export function liveCanaryReadiness(env = process.env) {
  const profile = JSON.parse(fs.readFileSync(path.join(HERE, "real-user-long-video.live-canary.json"), "utf8"));
  const has = (name) => typeof env[name] === "string" && env[name].trim().length > 0;
  const ready = env["NOMI_LONG_VIDEO_LIVE_CANARY"] === "1"
    && env["NOMI_LONG_VIDEO_BUDGET_CONFIRM"] === "I_UNDERSTAND_ONE_REQUEST"
    && has(profile.credentialEnv)
    && has(profile.samplePathEnv);
  return {
    ready,
    provider: profile.provider,
    model: profile.model,
    credentialEnv: profile.credentialEnv,
    credentialPresent: has(profile.credentialEnv),
    samplePathEnv: profile.samplePathEnv,
    samplePathPresent: has(profile.samplePathEnv),
    liveCanaryEnabled: env.NOMI_LONG_VIDEO_LIVE_CANARY === "1",
    budgetConfirmed: env.NOMI_LONG_VIDEO_BUDGET_CONFIRM === "I_UNDERSTAND_ONE_REQUEST",
  };
}

export function blockedLiveReport(reason, extra = {}) {
  return {
    manifestId: REAL_USER_LONG_VIDEO_MANIFEST.id,
    terminalStatus: "blocked",
    blockedBy: null,
    steps: REAL_USER_LONG_VIDEO_MANIFEST.steps.map((step) => ({
      stepId: step.id,
      action: step.action,
      classification: step.classification,
      status: "blocked",
      evidenceState: "blocked-live",
      detail: reason,
      evidence: {},
    })),
    ...extra,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--execute")) {
    console.log(JSON.stringify(blockedLiveReport("contract-only: pass --execute to run an explicit UI walk"), null, 2));
    process.exit(0);
  }
  if (args.has("--live")) {
    const readiness = liveCanaryReadiness();
    console.log(JSON.stringify({ mode: "live", readiness }, null, 2));
    if (!readiness.ready) {
      console.log(JSON.stringify(blockedLiveReport("live_canary_prerequisites_missing", { readiness }), null, 2));
      process.exit(0);
    }
  }
  console.error("UI driver not attached: use real-user-long-video.e2e.mjs for the Electron boundary walk");
  process.exit(2);
}
