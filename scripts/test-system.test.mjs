import { describe, expect, test } from "vitest";
import { expandProfile, summarizeStages } from "./test-system.mjs";

describe("system test profiles", () => {
  test("quick is deterministic and inexpensive", () => {
    expect(expandProfile("quick").map((stage) => stage.id)).toEqual(["matrix", "unit"]);
  });

  test("CI includes the zero-cost Electron journey gate", () => {
    expect(expandProfile("ci").map((stage) => stage.id)).toContain("journeys-ci");
  });

  test.each(["ci", "full-local", "release"])("%s cannot skip the B6 MCP and Surface journeys", (profile) => {
    expect(expandProfile(profile).map((stage) => stage.id)).toEqual(
      expect.arrayContaining(["project-agent-mcp", "project-agent-surface"]),
    );
  });

  test("B6 stages execute the real zero-cost transports", () => {
    expect(expandProfile("full-local").find((stage) => stage.id === "project-agent-mcp")).toMatchObject({
      command: "pnpm",
      args: ["run", "test:mcp"],
    });
    expect(expandProfile("full-local").find((stage) => stage.id === "project-agent-surface")).toMatchObject({
      command: "node",
      args: ["tests/ux/project-agent-canvas-isolation.e2e.mjs"],
    });
  });

  test("release contains local, real-generation, and repository gates", () => {
    expect(expandProfile("release").map((stage) => stage.id)).toEqual(expect.arrayContaining(["gates", "e2e", "journeys-all", "real-generation"]));
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
