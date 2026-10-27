import { describe, expect, test } from "vitest";
import { selectJourneys } from "./eval-journey-selection.mjs";

const agent = { id: "j1", needsAgent: true };
const local = { id: "j3", needsAgent: false };

describe("selectJourneys", () => {
  test("CI requires at least one zero-cost journey", () => {
    expect(() => selectJourneys([agent], { ci: true })).toThrow(/zero selected journeys/i);
  });

  test("an explicitly missing id is an error", () => {
    expect(() => selectJourneys([local], { ids: new Set(["missing"]) })).toThrow(/missing requested journeys: missing/i);
  });

  test("returns discovery and selection counts", () => {
    expect(selectJourneys([agent, local], { ci: true })).toEqual({
      discovered: 2,
      selected: [local],
      selectedCount: 1,
      excluded: [{ id: "j1", reason: "needs-agent" }],
    });
  });

  test("CI leaves out journeys that need private real media and says why", () => {
    const media = { id: "j4", needsAgent: false, realMedia: ["image-4k-png"] };
    const selection = selectJourneys([agent, media, local], { ci: true });
    expect(selection.selected).toEqual([local]);
    expect(selection.excluded).toEqual([
      { id: "j1", reason: "needs-agent" },
      { id: "j4", reason: "needs-real-media" },
    ]);
    // 本机跑全部时照选：缺素材由旅程自己起步就报红
    expect(selectJourneys([media], {}).selected).toEqual([media]);
  });

  test("smoke includes explicit smoke journeys and every zero-cost journey", () => {
    const smokeAgent = { ...agent, smoke: true };
    const slowAgent = { id: "j2", needsAgent: true, smoke: false };
    expect(selectJourneys([smokeAgent, slowAgent, local], { smoke: true }).selected).toEqual([smokeAgent, local]);
  });
});
