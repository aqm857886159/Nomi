import { describe, expect, test } from "vitest";
import { expandProfile, summarizeStages } from "./test-system.mjs";

describe("system test profiles", () => {
  test("quick is deterministic and inexpensive", () => {
    expect(expandProfile("quick").map((stage) => stage.id)).toEqual(["matrix", "unit"]);
  });

  test("CI includes the zero-cost Electron journey gate", () => {
    expect(expandProfile("ci").map((stage) => stage.id)).toContain("journeys-ci");
    expect(expandProfile("ci").map((stage) => stage.id)).toContain("real-user-journeys");
  });

  test("desktop CI requires the critical real-canvas suite", () => {
    expect(expandProfile("ci-desktop").map((stage) => stage.id)).toEqual(["build", "e2e"]);
    expect(expandProfile("ci-journeys").map((stage) => stage.id)).toEqual(["journeys-ci", "real-user-journeys"]);
    expect(expandProfile("ci-canvas-critical").map((stage) => stage.id)).toEqual(["canvas-critical"]);
    expect(expandProfile("ci-canvas-full").map((stage) => stage.id)).toEqual(["canvas-full"]);
    expect(expandProfile("ci-performance").map((stage) => stage.id)).toEqual(["canvas-performance"]);
  });

  test("the real-user journey stage is loopback-only and has an explicit package script", () => {
    expect(expandProfile("ci-journeys").map((stage) => stage.id)).toEqual(["journeys-ci", "real-user-journeys"]);
    expect(expandProfile("ci-journeys").find((stage) => stage.id === "real-user-journeys")).toMatchObject({
      command: "pnpm",
      args: ["run", "test:real-user-journeys:ci"],
      env: { NOMI_REAL_USER_PROVIDER: "loopback" },
    });
  });

  test("full local keeps functional canvas and performance as separately reported stages", () => {
    const stages = expandProfile("full-local").map((stage) => stage.id);
    expect(stages).toContain("canvas-full");
    expect(stages).toContain("canvas-performance");
  });

  test("release contains local, real-generation, and repository gates", () => {
    expect(expandProfile("release").map((stage) => stage.id)).toEqual(expect.arrayContaining(["gates", "e2e", "canvas-full", "journeys-all", "real-generation"]));
    expect(expandProfile("release").find((stage) => stage.id === "real-generation")).toMatchObject({
      args: ["tests/ux/camera-move-render-e2e.mjs"],
      env: { NOMI_SPEND_OK: "1" },
    });
  });

  test("any failed required stage makes the run fail", () => {
    const summary = summarizeStages([{ id: "unit", required: true, status: "failed", exitCode: 1 }]);
    expect(summary).toMatchObject({ passed: 0, failed: 1, ok: false });
  });
});
