// 纯 driver/诊断/修复单测(零 Mastra、零网络)—— 守住自我改进 loop 的核心机制不回归。
import { describe, it, expect } from "vitest";
import { driveScenario, SEMANTIC_EDGE_MODE } from "./driver";
import { baselineDefaults } from "./learnedDefaults";
import { fix } from "./fix";
import type { Diagnosis } from "./diagnose";

const CAPS = new Set(["t2i", "i2v", "character_ref", "image_ref", "style_ref", "timeline"]);

describe("driver(真 canvasGraph 领域逻辑)", () => {
  it("无参考的场景:无参考边、语义满分", () => {
    const t = driveScenario({ intent: "x", expects: ["t2i", "i2v", "timeline"] }, baselineDefaults(), CAPS);
    expect(t.refEdges).toBe(0);
    expect(t.nodesBuilt).toBe(2); // 两个 shot
  });

  it("基线下参考边语义错误(用泛用 reference)", () => {
    const t = driveScenario({ intent: "x", expects: ["t2i", "character_ref", "i2v"] }, baselineDefaults(), CAPS);
    expect(t.refEdges).toBeGreaterThan(0);
    expect(t.semanticCorrectEdges).toBe(0);
  });

  it("学到语义模式后,参考边全部语义正确", () => {
    const learned = { refEdgeMode: { character_ref: SEMANTIC_EDGE_MODE.character_ref } };
    const t = driveScenario({ intent: "x", expects: ["t2i", "character_ref", "i2v"] }, learned, CAPS);
    expect(t.semanticCorrectEdges).toBe(t.refEdges);
  });

  it("缺失能力计入缺口与报错", () => {
    const t = driveScenario({ intent: "x", expects: ["t2i", "beat_sync"] }, baselineDefaults(), CAPS);
    expect(t.missing).toContain("beat_sync");
    expect(t.producedAsset).toBe(false);
  });
});

describe("fix(修 agent 规则版)", () => {
  it("据诊断把受影响能力族映射到规范语义模式(image_ref→composition_ref)", () => {
    const diag: Diagnosis = {
      weakestMetric: "semantic-edge-correctness",
      avg: 0.5,
      pattern: "参考边泛用",
      affectedCaps: ["character_ref", "image_ref", "style_ref"],
    };
    const patched = fix(diag, baselineDefaults());
    expect(patched.refEdgeMode.character_ref).toBe("character_ref");
    expect(patched.refEdgeMode.image_ref).toBe("composition_ref");
    expect(patched.refEdgeMode.style_ref).toBe("style_ref");
  });
});
