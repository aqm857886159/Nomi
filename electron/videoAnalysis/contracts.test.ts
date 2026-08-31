import { describe, expect, it } from "vitest";

import {
  parseEcutHealthResponse,
  parseEcutTaskResponse,
  supportsRequestedInference,
} from "./contracts";

const storyboard = {
  schema_version: "reference-video-deconstruction-v1",
  video_title_summary: "A real workflow",
  hook_strategy_analysis: "Starts from a concrete use case.",
  scenes: [
    {
      scene_index: 1,
      marketing_role: "HOOK",
      scene_title: "Open the project",
      time_range: "00:00:00.000-00:00:04.000",
      role_analysis: "Establishes context.",
      shots: [
        {
          shot_id: 1,
          time_range: "00:00:00.000 - 00:00:01.500",
          visual_description: "A creator opens a laptop.",
          spoken_text: "",
          ocr_text: "Codex",
          camera_shot: "medium",
          camera_move: "static",
          psychological_effect: "Grounds the claim in a real action.",
          evidence: {
            visual_ms: [300, 1100],
            spoken_text_ref: "aligned.shots[1].spoken_text",
            ocr_text_ref: "aligned.shots[1].ocr_text",
          },
        },
      ],
    },
  ],
  patterns: [],
};

describe("e-cut response contracts", () => {
  it("accepts the current legacy health response but does not invent deterministic support", () => {
    const health = parseEcutHealthResponse({
      ok: true,
      engine: "eccut-local",
      pipeline_ready: true,
      missing_dependencies: [],
    });

    expect(health.engine).toBe("eccut-local");
    expect(health.analysisModes).toEqual([]);
    expect(supportsRequestedInference(health, true)).toBe(true);
    expect(supportsRequestedInference(health, false)).toBe(false);
  });

  it("honours an explicit deterministic capability", () => {
    const health = parseEcutHealthResponse({
      ok: true,
      engine: "eccut-local",
      pipeline_ready: true,
      analysis_modes: ["deterministic", "model"],
    });

    expect(supportsRequestedInference(health, false)).toBe(true);
  });

  it("preserves raw OCR/ASR separately from model interpretation", () => {
    const task = parseEcutTaskResponse({
      task_id: "20260808-160102-1234",
      done: true,
      stage: 6,
      stage_total: 6,
      stage_text: "模式提炼",
      error: null,
      storyboard_source: "model",
      storyboard,
      raw_evidence: [{
        shot_id: 1,
        visual_ms: [300, 1100],
        spoken_text_ref: "aligned.shots[1].spoken_text",
        spoken_text: "immutable speech",
        ocr_text_ref: "aligned.shots[1].ocr_text",
        ocr_text: "immutable OCR",
      }],
      metrics: { llm: { calls: 2 } },
      logs: ["/private/path/must/not/be/persisted"],
    });

    expect(task.storyboard?.scenes[0]?.shots[0]?.ocrText).toBe("Codex");
    expect(task.rawEvidence[0]?.ocrText).toBe("immutable OCR");
    expect(task.storyboard?.scenes[0]?.roleAnalysis).toBe("Establishes context.");
    expect("logs" in task).toBe(false);
  });

  it.each([
    { task_id: "../../escape", done: false, stage: 1, stage_total: 6 },
    { task_id: "20260808-160102-1234", done: true, stage: 6, stage_total: 6, storyboard: { scenes: "nope" } },
    { task_id: "20260808-160102-1234", done: "yes", stage: 6, stage_total: 6 },
  ])("rejects malformed task payloads", (payload) => {
    expect(() => parseEcutTaskResponse(payload)).toThrow(/invalid|response|task|storyboard/i);
  });
});
