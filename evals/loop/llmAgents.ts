// LLM 升级版 查/修 agent —— 让诊断/修复更聪明(规则版只覆盖已知模式)。架构铁律不变:查 ≠ 修。
// 三种 LLM 来源,按优先级,任一可用即启用,全无 → 返回 null 让上层回退规则版(诚实,不假装):
//   ① env 直连:配 NOMI_LOOP_LLM_{KEY,BASE_URL,MODEL}(走 OpenAI 兼容 fetch,绕 Mastra ai@6)。
//   ② 复用 app 已配模型:设 NOMI_LOOP_USE_APP_LLM=1 → 启真 Nomi app 解密已配文本模型 key
//      (见 llmViaApp.mjs;⚠️ 会启真 app,运行时 Nomi 须关着;effect-first:用户不必手填 key)。
//   ③ 都没 → 规则版。
import type { Row } from "./metrics";
import type { Diagnosis } from "./diagnose";
import type { LearnedDefaults } from "./learnedDefaults";
import { cloneDefaults } from "./learnedDefaults";
import { chatText, textAvailable, modelLabels } from "./appBridge.mjs";

function envConfigured(): boolean {
  return !!(
    process.env.NOMI_LOOP_LLM_KEY &&
    process.env.NOMI_LOOP_LLM_BASE_URL &&
    process.env.NOMI_LOOP_LLM_MODEL
  );
}
function appConfigured(): boolean {
  return process.env.NOMI_LOOP_USE_APP_LLM === "1" && textAvailable();
}
export function loopLlmEnabled(): boolean {
  return envConfigured() || appConfigured();
}
export function loopLlmMode(): string {
  if (envConfigured()) return `env(${process.env.NOMI_LOOP_LLM_MODEL})`;
  if (appConfigured()) return `app复用(${modelLabels().text})`;
  return "规则版(未配 LLM)";
}

async function chat(system: string, user: string): Promise<string> {
  if (envConfigured()) {
    const res = await fetch(`${process.env.NOMI_LOOP_LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NOMI_LOOP_LLM_KEY}` },
      body: JSON.stringify({
        model: process.env.NOMI_LOOP_LLM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(`loop LLM ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "{}";
  }
  // 复用 app 已配模型(主进程解密+fetch,明文 key 不出主进程)。
  return await chatText(system, user);
}

/** 查 agent(LLM 版):从轨迹里找弱点。null = 未启用/失败 → 上层回退规则版。 */
export async function diagnoseLLM(rows: Row[]): Promise<Diagnosis | null> {
  if (!loopLlmEnabled()) return null;
  try {
    const summary = rows.map((r) => ({
      persona: r.persona,
      scores: r.scores,
      refEdges: r.traj.refEdges,
      semanticCorrectEdges: r.traj.semanticCorrectEdges,
      expects: r.traj.expects,
    }));
    const out = await chat(
      "你是诊断 agent:只找问题,不提改、不评判。" +
        "当前修复杠杆只有一个:refEdgeMode——把参考边(character_ref/style_ref/image_ref)的边模式改成语义正确的、避免泛用 reference。" +
        "请在这个杠杆够得着的范围内找最该修的:看哪些人格 semantic-edge-correctness 低、且 refEdges>0 但 semanticCorrectEdges<refEdges,列出受影响的能力族(只从 character_ref/style_ref/image_ref 里取)。" +
        '严格只回 JSON:{"weakestMetric":"semantic-edge-correctness","avg":number,"pattern":string,"affectedCaps":string[]}',
      JSON.stringify(summary),
    );
    return JSON.parse(out) as Diagnosis;
  } catch {
    return null; // 失败即回退规则版(诚实:不假装诊断)
  }
}

/** 修 agent(LLM 版):据诊断提 refEdgeMode patch。不自评——交 loop 客观裁决。 */
export async function fixLLM(diagnosis: Diagnosis, current: LearnedDefaults): Promise<LearnedDefaults | null> {
  if (!loopLlmEnabled()) return null;
  try {
    const out = await chat(
      "你是修复 agent。问题:参考边在用泛用 'reference' 模式、丢了语义。" +
        "请把每个受影响能力族的参考边改成**语义匹配**的边模式(绝不是 reference!):" +
        "character_ref 的边→'character_ref'、style_ref 的边→'style_ref'、image_ref 的边→'composition_ref'(image_ref 无同名边模式,语义上归 composition_ref)。" +
        "合法边模式仅:reference/first_frame/last_frame/style_ref/character_ref/composition_ref。只提改,不评判自己的 patch。" +
        '严格只回 JSON:{"refEdgeMode":{"<cap>":"<mode>"}}',
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
