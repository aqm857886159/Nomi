// 半客观层(S3)—— 独立批评 agent(VLM)检查画面元素/角色一致性等。
// ⚠️ 三重门,缺任一 → semiObjectiveEnabled()=false,loop 跳过本层、只用客观脊梁(诚实,不假装判主观):
//   ① 需 额度(真生成才有图供 VLM 看)② 需 VLM key(NOMI_LOOP_VLM_{KEY,BASE_URL,MODEL})
//   ③ 需人工校准 P/R≥80% 才采信(对齐 scripts/eval-judge-calibrate.mjs)。
// 设计纪律(plan §3.2):独立批评 agent(治自偏)+ 校准(治代理漂移);**永不当唯一优化靶子**;
//   走直连 fetch(不引 Mastra Agent,规避 ai@6 冲突)。
import { createScorer } from "@mastra/core/evals";

export function semiObjectiveEnabled() {
  return !!(
    process.env.NOMI_LOOP_VLM_KEY &&
    process.env.NOMI_LOOP_VLM_BASE_URL &&
    process.env.NOMI_LOOP_VLM_MODEL
  );
}

/** 校准门:接入正式打分前,必须先用人工标注集验证该 judge 的查准/查全 ≥ 此阈值。 */
export const CALIBRATION_THRESHOLD = 0.8;

async function vlmCheck(imageUrl, question) {
  const res = await fetch(`${process.env.NOMI_LOOP_VLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.NOMI_LOOP_VLM_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.NOMI_LOOP_VLM_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `${question} 只回 JSON {"pass":boolean,"confidence":number}` },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`VLM ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content ?? '{"pass":false,"confidence":0}');
}

// 元素出现 judge:生成图是否体现了场景意图(prompt-adherence)。返回 null = 本层未启用 → 被排除。
export const elementPresence = createScorer({
  id: "element-presence",
  description: "半客观:生成图是否含要求元素(独立批评 agent,需 VLM+校准)",
}).generateScore(async ({ run }) => {
  if (!semiObjectiveEnabled()) return null; // 跳过:不假装判主观
  const t = run.output ?? {};
  if (!t.assetUrl) return null; // 无真生成图(额度门)→ 跳过
  const v = await vlmCheck(t.assetUrl, `画面是否体现了:${t.intent ?? ""}?`);
  return v.pass ? Math.max(0.5, v.confidence ?? 0.5) : (1 - (v.confidence ?? 0)) * 0.5;
});

export const SEMI_OBJECTIVE_SCORERS = [elementPresence];
