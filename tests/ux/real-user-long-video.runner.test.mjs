import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  REAL_USER_LONG_VIDEO_MANIFEST,
  liveCanaryReadiness,
  runRealUserLongVideoJourney,
} from "./real-user-long-video.runner.mjs";

describe("real user long-video runner contract", () => {
  it("keeps the user-visible action order in the manifest", () => {
    assert.deepEqual(
      REAL_USER_LONG_VIDEO_MANIFEST.steps.map((step) => step.action),
      [
        "enterNomi", "loadSkill", "selectModel", "applySkill", "importVideo", "deconstructVideo",
        "produceStoryboard", "sendToCanvas", "openPreview", "approveResult", "rejectResult",
        "verifyPersistence", "restartReadback", "repeatIdempotently", "failureRollback",
      ],
    );
  });

  it("does not allow a blocked-live result to be reported as pass", async () => {
    await assert.rejects(
      () => runRealUserLongVideoJourney({
        driver: { perform: async () => ({ status: "pass", evidenceState: "blocked-live" }) },
      }),
      /invalid_evidence/,
    );
  });

  it("stops executing after the first real UI boundary blocker", async () => {
    const executed = [];
    const report = await runRealUserLongVideoJourney({
      driver: {
        perform: async ({ action }) => {
          executed.push(action);
          return action === "deconstructVideo"
            ? { status: "blocked", evidenceState: "blocked-live", detail: "no live provider" }
            : { status: "pass", evidenceState: "loopback", detail: "visible UI action" };
        },
      },
    });
    assert.deepEqual(executed, ["enterNomi", "loadSkill", "selectModel", "applySkill", "importVideo", "deconstructVideo"]);
    assert.equal(report.terminalStatus, "blocked");
    assert.equal(report.steps.at(-1).detail, "blocked_by:deconstruct-video");
  });

  it("requires explicit live flag, budget confirmation, provider key, and real sample path", () => {
    const base = {
      NOMI_LONG_VIDEO_LIVE_CANARY: "1",
      NOMI_LONG_VIDEO_BUDGET_CONFIRM: "I_UNDERSTAND_ONE_REQUEST",
      APIMART_API_KEY: "redacted-placeholder-for-test",
      NOMI_LONG_VIDEO_PATH: "/tmp/user-video.mp4",
    };
    assert.equal(liveCanaryReadiness(base).ready, true);
    assert.equal(liveCanaryReadiness({ ...base, APIMART_API_KEY: "" }).ready, false);
    assert.equal(liveCanaryReadiness({ ...base, NOMI_LONG_VIDEO_BUDGET_CONFIRM: "yes" }).ready, false);
    assert.equal(liveCanaryReadiness(base).credentialPresent, true);
  });
});
