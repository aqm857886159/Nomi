// 草稿摘要投影（Run → ProductionRunSummary.draft）。纯函数，住在自己的文件里：
// repository 只负责存取，「一份草稿该给用户看哪几件事」是产品判断，值得被单测钉死。
//
// 它修的是这个用户可见缺口：agent 建完草稿，任务面板上只有一句「等待开始」——
// 模型是哪个、提示词是什么、几个镜，结构上就投影不出来（Summary 里根本没有 generationPlan）。
import type { ProductionRun, ProductionRunDraftSummary } from "./productionRunTypes";

/**
 * 画幅比例参数在各模型档案里叫法不同（gpt-image 系叫 size，seedance 系叫 aspect_ratio，
 * 还有 ratio / resolution）。固定优先序取第一个命中的字符串值——不硬认某一个键，也不猜。
 */
const ASPECT_PARAM_KEYS = ["aspect_ratio", "aspectRatio", "ratio", "size", "resolution"] as const;

const PROMPT_LINE_MAX = 80;

function aspectFrom(parameters: Record<string, unknown>): string | undefined {
  for (const key of ASPECT_PARAM_KEYS) {
    const value = parameters[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/** 提示词首行（去掉空行前缀），超长按字符裁剪并加省略号。列表行只放一行。 */
export function promptFirstLine(prompt: string, max: number = PROMPT_LINE_MAX): string {
  const line = prompt.split("\n").map((part) => part.trim()).find((part) => part.length > 0) ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/**
 * 仍是草稿的计划 → 摘要；已封存/已提交/已取消/无计划 → undefined（那些状态另有自己的行文案，
 * 不该被草稿摘要盖过）。多镜计划的模型身份取**第一个被勾选的镜**（列表只有一行的位置，
 * 详情面才逐镜展开）；单镜计划走顶层 candidate。
 */
export function buildProductionRunDraftSummary(run: ProductionRun): ProductionRunDraftSummary | undefined {
  const plan = run.generationPlan;
  if (!plan || plan.state !== "draft") return undefined;
  const included = (plan.shots ?? []).filter((shot) => shot.included !== false);
  const candidate = included[0]?.candidate ?? plan.candidate;
  if (!candidate) return undefined;
  const aspect = aspectFrom(candidate.parameters ?? {});
  return {
    candidateId: candidate.candidateId,
    revision: candidate.revision,
    vendor: candidate.providerId,
    modelKey: candidate.modelId,
    mode: candidate.mode,
    ...(candidate.modeId ? { modeId: candidate.modeId } : {}),
    promptLine: promptFirstLine(candidate.prompt ?? ""),
    ...(aspect ? { aspectRatio: aspect } : {}),
    shotCount: included.length > 0 ? included.length : 1,
  };
}
