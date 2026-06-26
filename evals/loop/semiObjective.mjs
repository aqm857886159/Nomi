// 半客观层(S3)—— 独立批评 agent(VLM)检查画面元素/一致性。复用 Nomi app 已配**视觉模型**
// (appBridge.chatVision,免手填 key;现解析到 moonshot-v1-128k-vision-preview)。
// 设计纪律(plan §3.2):独立批评 agent(治自偏)+ 校准(治代理漂移);**永不当唯一优化靶子**。
// ⚠️ 两重门,缺则跳过(返回 null)、不假装判主观:
//   ① 真图(需 runTask 真生成出 assetUrl;真生成是 headless 全链路收尾,见 appBridge.genImage 注释)
//   ② 人工校准 P/R≥80% 才正式采信(对齐 scripts/eval-judge-calibrate.mjs)——这步需用户几条标注。
import { createScorer } from "@mastra/core/evals";
import { chatVision, modelLabels } from "./appBridge.mjs";

export function visionAvailable() {
  return modelLabels().vision != null;
}

/** 半客观层是否就绪(有视觉模型即可出图判;真采信仍需真图+校准,见文件头两重门)。report.ts 标注用。 */
export function semiObjectiveEnabled() {
  return visionAvailable();
}

/** 校准门:正式采信前,须用人工标注集验证该 judge 的查准/查全 ≥ 此阈值。 */
export const CALIBRATION_THRESHOLD = 0.8;

/** 对一张图问一个是非题,返回 {pass, confidence}。复用已配视觉模型(主进程解密+fetch)。 */
export async function vlmJudge(imageUrl, question) {
  const out = await chatVision(
    imageUrl,
    `${question} 只回 JSON {"pass":boolean,"confidence":number}`,
  );
  const m = out.match(/\{[\s\S]*\}/); // 稳健抽 JSON(vision 模型可能裹文字)
  try {
    return JSON.parse(m ? m[0] : out);
  } catch {
    return { pass: false, confidence: 0, raw: out.slice(0, 120) };
  }
}

// 元素出现 judge:生成图是否体现场景意图(prompt-adherence)。null = 无真图/无视觉模型 → 跳过。
export const elementPresence = createScorer({
  id: "element-presence",
  description: "半客观:生成图是否含要求元素(独立批评 agent,复用已配视觉模型,需真图+校准)",
}).generateScore(async ({ run }) => {
  const t = run.output ?? {};
  if (!visionAvailable() || !t.assetUrl) return null; // 跳过:不假装判主观
  const v = await vlmJudge(t.assetUrl, `画面是否体现了:${t.intent ?? ""}?`);
  return v.pass ? Math.max(0.5, v.confidence ?? 0.5) : (1 - (v.confidence ?? 0)) * 0.5;
});

export const SEMI_OBJECTIVE_SCORERS = [elementPresence];
