import { describe, expect, test } from "vitest";
import { PROFILES, STAGES } from "./profiles.mjs";
import { projectMatrixEvidence } from "../../scripts/test-agent-m0-m5-matrix.mjs";

const milestones = ["M0", "M1", "M2", "M3", "M4", "M5"];

describe("Agent M0-M5 executable test matrix", () => {
  test.each(milestones)("registers an executable profile for %s", (milestone) => {
    const profileName = `agent-${milestone.toLowerCase()}`;
    expect(PROFILES[profileName], `${profileName} profile`).toBeDefined();
    expect(PROFILES[profileName]).toHaveLength(1);
    const stageId = PROFILES[profileName][0];
    expect(STAGES[stageId], `${stageId} stage`).toMatchObject({
      command: "node",
      args: ["scripts/test-agent-m0-m5-matrix.mjs", milestone],
      required: true,
    });
  });

  test("registers an all-milestones profile that runs the matrix executor", () => {
    expect(PROFILES["agent-m0-m5"]).toEqual(["agent-m0-m5-matrix"]);
    expect(STAGES["agent-m0-m5-matrix"]).toMatchObject({
      command: "node",
      args: ["scripts/test-agent-m0-m5-matrix.mjs"],
      required: true,
    });
  });

  test("projects each ready dimension to its command result while retaining blocked evidence", () => {
    const stages = [{
      id: "TEST.STAGE",
      dimensions: {
        happy: { status: "ready", commandRef: "happy-command", assertions: ["H"] },
        boundary: { status: "blocked", reason: "missing", alternative: "keep blocked" },
        error: { status: "ready", commandRef: "error-command", assertions: ["E"] },
        timeout: { status: "ready", commandRef: "timeout-command", assertions: ["T"] },
        network: { status: "ready", commandRef: "network-command", assertions: ["N"] },
      },
      persistence: { status: "ready", coldStart: true, commandRef: "happy-command", assertions: ["R"] },
    }];
    const results = [
      { ref: "happy-command", status: "passed", exitCode: 0, stdout: "happy.log", stderr: "happy.err" },
      { ref: "error-command", status: "failed", exitCode: 1, stdout: "error.log", stderr: "error.err" },
      { ref: "timeout-command", status: "timeout", exitCode: 1, stdout: "timeout.log", stderr: "timeout.err" },
      { ref: "network-command", status: "passed", exitCode: 0, stdout: "network.log", stderr: "network.err" },
    ];

    const [evidence] = projectMatrixEvidence(stages, results);
    expect(evidence.dimensions.happy).toMatchObject({ status: "passed", commandRef: "happy-command", result: { status: "passed", exitCode: 0 } });
    expect(evidence.dimensions.boundary).toEqual(stages[0].dimensions.boundary);
    expect(evidence.dimensions.error).toMatchObject({ status: "failed", result: { status: "failed", exitCode: 1 } });
    expect(evidence.dimensions.timeout).toMatchObject({ status: "timeout", result: { status: "timeout" } });
    expect(evidence.dimensions.network).toMatchObject({ status: "passed", result: { status: "passed" } });
    expect(evidence.persistence).toMatchObject({ status: "passed", result: { status: "passed" } });
  });
});
