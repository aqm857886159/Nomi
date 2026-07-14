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
    });
  });

  test("smoke includes explicit smoke journeys and every zero-cost journey", () => {
    const smokeAgent = { ...agent, smoke: true };
    const slowAgent = { id: "j2", needsAgent: true, smoke: false };
    expect(selectJourneys([smokeAgent, slowAgent, local], { smoke: true }).selected).toEqual([smokeAgent, local]);
  });
});
