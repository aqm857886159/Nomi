// LLM 升级版 查/修 agent —— 让诊断/修复更聪明(规则版只覆盖已知模式)。
// ⚠️ 需 API key(用户独有资源):配 NOMI_LOOP_LLM_{KEY,BASE_URL,MODEL} 才启用,
//    缺任一 → 返回 null,loop 自动回退规则版(diagnose/fix)。
// 设计:走 OpenAI 兼容 chat/completions **直连 fetch**,不引 Mastra Agent ——
//   规避 Mastra peer 要 ai@6 / Nomi ai@4 的冲突(见 plan 回填)。架构铁律不变:查 ≠ 修。
import type { Row } from "./metrics";
import type { Diagnosis } from "./diagnose";
import type { LearnedDefaults } from "./learnedDefaults";
import { cloneDefaults } from "./learnedDefaults";

export function loopLlmConfigured(): boolean {
  return !!(
    process.env.NOMI_LOOP_LLM_KEY &&
    process.env.NOMI_LOOP_LLM_BASE_URL &&
    process.env.NOMI_LOOP_LLM_MODEL
  );
}

async function chat(system: string, user: string): Promise<string> {
  const res = await fetch(
    `${process.env.NOMI_LOOP_LLM_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.NOMI_LOOP_LLM_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.NOMI_LOOP_LLM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    },
  );
  if (!res.ok) throw new Error(`loop LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "{}";
}

/** 查 agent(LLM 版):从轨迹里找弱点。返回 null = 未配置/失败 → 上层回退规则版。 */
export async function diagnoseLLM(rows: Row[]): Promise<Diagnosis | null> {
  if (!loopLlmConfigured()) return null;
  try {
    const summary = rows.map((r) => ({ persona: r.persona, scores: r.scores }));
    const out = await chat(
      "你是诊断 agent:只找问题,不提改、不评判。读各人格×客观指标,定位最弱维度和具体失败模式。" +
        '严格返回 JSON:{"weakestMetric":string,"avg":number,"pattern":string,"affectedCaps":string[]}',
      JSON.stringify(summary),
    );
    return JSON.parse(out) as Diagnosis;
  } catch {
    return null; // 失败即回退规则版(诚实:不假装诊断)
  }
}

/** 修 agent(LLM 版):据诊断提 LearnedDefaults patch。不自评——交 loop 客观裁决。 */
export async function fixLLM(
  diagnosis: Diagnosis,
  current: LearnedDefaults,
): Promise<LearnedDefaults | null> {
  if (!loopLlmConfigured()) return null;
  try {
    const out = await chat(
      "你是修复 agent:据诊断提一个 refEdgeMode patch(能力族→边模式)。只提改,不评判自己的 patch。" +
        '合法边模式仅:reference/first_frame/last_frame/style_ref/character_ref/composition_ref。' +
        '严格返回 JSON:{"refEdgeMode":{"<cap>":"<mode>"}}',
      JSON.stringify({ diagnosis, current }),
    );
    const patch = JSON.parse(out) as { refEdgeMode?: Record<string, string> };
    const next = cloneDefaults(current);
    for (const [k, v] of Object.entries(patch.refEdgeMode ?? {})) next.refEdgeMode[k] = v;
    return next;
  } catch {
    return null;
  }
}
