import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { JOURNEYS } from "./index.mjs";
import { selectJourneys } from "../../scripts/eval-journey-selection.mjs";

const journeysDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(journeysDir, "../..");

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

  test("journeys that read private real media declare it, so CI never selects them", () => {
    const fixtures = JSON.parse(fs.readFileSync(path.join(repoRoot, "tests/ux/real-media-fixtures.json"), "utf8"));
    const registered = new Set(fixtures.assets.map((asset: { id: string }) => asset.id));
    const journeys = JOURNEYS as Array<{ id: string; realMedia?: string[] }>;
    const files = fs.readdirSync(journeysDir).filter((name) => /^j\d[\w-]*\.mjs$/.test(name));
    expect(files.length).toBe(journeys.length);
    for (const file of files) {
      const source = fs.readFileSync(path.join(journeysDir, file), "utf8");
      const journey = journeys.find((candidate) => `${candidate.id}.mjs` === file);
      expect(journey, file).toBeTruthy();
      expect(Boolean(journey?.realMedia?.length), file).toBe(source.includes("requireRealMediaAssets("));
      for (const id of journey?.realMedia ?? []) expect(registered.has(id), `${file}: ${id}`).toBe(true);
    }
    const ciSelected = selectJourneys(journeys, { ci: true }).selected as typeof journeys;
    expect(ciSelected.filter((journey) => journey.realMedia?.length)).toEqual([]);
  });

  test("zero-cost journeys do not contain agent prompts", () => {
    for (const journey of JOURNEYS.filter((candidate) => !candidate.needsAgent)) {
      expect(journey.milestones.every((milestone) => !("say" in milestone) || !milestone.say), journey.id).toBe(true);
    }
  });
});
