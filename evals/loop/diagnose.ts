// 查(diagnose)agent —— 只查问题,不提改、不评判(架构铁律:查 ≠ 修)。
// 规则版(零 LLM):找最弱客观维度 + 具体失败模式 + 受影响能力族。
// LLM 升级版 diagnoseLLM 见 llmAgents.ts(需 API key,缺 key 由 loop 回退本规则版)。
import type { Row } from "./metrics";
import { METRIC_IDS } from "./metrics";
import { REF_CAPS } from "./driver";

export type Diagnosis = {
  weakestMetric: string;
  avg: number;
  pattern: string;
  affectedCaps: string[];
};

export function diagnose(rows: Row[]): Diagnosis {
  const avgs = METRIC_IDS.map((m) => ({
    m,
    a: rows.reduce((s, r) => s + (r.scores[m] ?? 0), 0) / rows.length,
  }));
  avgs.sort((x, y) => x.a - y.a);
  const weakest = avgs[0];

  let pattern = `最弱维度 ${weakest.m}(规则查暂只深挖语义边;接 LLM 查可扩更多模式)`;
  let affectedCaps: string[] = [];
  if (weakest.m === "semantic-edge-correctness") {
    const caps = new Set<string>();
    for (const r of rows) {
      if (r.traj.refEdges > 0 && r.traj.semanticCorrectEdges < r.traj.refEdges) {
        for (const c of r.traj.expects) if (REF_CAPS.includes(c)) caps.add(c);
      }
    }
    affectedCaps = [...caps];
    pattern = `参考边用泛用 'reference' 而非语义模式(${affectedCaps.join("/")})→ 角色/风格/构图参考语义丢失`;
  }
  return { weakestMetric: weakest.m, avg: weakest.a, pattern, affectedCaps };
}
