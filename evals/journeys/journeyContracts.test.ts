import { describe, expect, test } from "vitest";
import { JOURNEYS } from "./index.mjs";

describe("journey registry contracts", () => {
  test("contains all five standard product journeys", () => {
    expect(JOURNEYS.map((journey) => journey.id)).toEqual(expect.arrayContaining([
      "j1-promo",
      "j2-story-styling",
      "j3-first-success",
      "j4-reference",
      "j5-edit-export",
    ]));
  });

  test("every journey has executable milestones and a success criterion", () => {
    for (const journey of JOURNEYS) {
      expect(journey.successCriterion, journey.id).toBeTruthy();
      expect(journey.milestones.length, journey.id).toBeGreaterThan(0);
      for (const milestone of journey.milestones) {
        expect(milestone.id, journey.id).toBeTruthy();
        expect(milestone.title, journey.id).toBeTruthy();
        expect(typeof milestone.verify, `${journey.id}/${milestone.id}`).toBe("function");
      }
    }
  });

  test("zero-cost journeys do not contain agent prompts", () => {
    for (const journey of JOURNEYS.filter((candidate) => !candidate.needsAgent)) {
      expect(journey.milestones.every((milestone) => !milestone.say), journey.id).toBe(true);
    }
  });
});
