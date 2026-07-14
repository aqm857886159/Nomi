import { describe, expect, test } from "vitest";
import { expandProfile, summarizeStages } from "./test-system.mjs";

describe("system test profiles", () => {
  test("quick is deterministic and inexpensive", () => {
    expect(expandProfile("quick").map((stage) => stage.id)).toEqual(["matrix", "unit"]);
  });

  test("CI includes the zero-cost Electron journey gate", () => {
    expect(expandProfile("ci").map((stage) => stage.id)).toContain("journeys-ci");
  });

  test("release contains local, real-generation, and repository gates", () => {
    expect(expandProfile("release").map((stage) => stage.id)).toEqual(expect.arrayContaining(["gates", "e2e", "journeys-all", "real-generation"]));
  });

  test("any failed required stage makes the run fail", () => {
    const summary = summarizeStages([{ id: "unit", required: true, status: "failed", exitCode: 1 }]);
    expect(summary).toMatchObject({ passed: 0, failed: 1, ok: false });
  });
});
