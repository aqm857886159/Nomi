// 修(fix)agent —— 据诊断提一个 LearnedDefaults patch,**不评判自己的 patch**。
// 架构铁律:裁决权在 loop 的「重跑 + eval-diff 客观指标差」,不在修 agent 的嘴(防自偏)。
// 规则版(零 LLM)。LLM 升级版 fixLLM 见 llmAgents.ts(需 key,缺 key 回退本规则版)。
import type { Diagnosis } from "./diagnose";
import { cloneDefaults, type LearnedDefaults } from "./learnedDefaults";
import { SEMANTIC_EDGE_MODE } from "./driver";

export function fix(diagnosis: Diagnosis, current: LearnedDefaults): LearnedDefaults {
  const next = cloneDefaults(current);
  if (diagnosis.weakestMetric === "semantic-edge-correctness") {
    // 让受影响能力族的参考边改用规范语义模式(image_ref→composition_ref…)。
    for (const cap of diagnosis.affectedCaps) {
      next.refEdgeMode[cap] = SEMANTIC_EDGE_MODE[cap] ?? cap;
    }
  }
  return next;
}
