// 视频拆解的钱的闸（编排 → 那条唯一的确认链之间的一层薄接线）。
//
// 单独成模块的理由和 `shotVerifyDeps` 一样：`deconstructVideo` 保持「纯编排 + 注入依赖」，
// 可以在裸 node 单测里用假闸跑完整条链；真闸（弹卡 / 铸令牌 / 读项目名）住在这里。
//
// 语义（2026-09-12 用户拍板的「钱的闸」在本动作上的形状）：
//   · 用户点一次「拆解」= 一次动作 → **一张报价卡、一次确认**，卡上是这一批的总价（N 镜 + 转写）；
//   · 确认后铸的令牌只覆盖这一批：`assertAndConsumeQuotedSpend` 逐次扣，扣完为止，
//     既不会为第 2 镜再弹一张卡，也不会让报价之外的第 N+1 次调用白跑；
//   · 没确认 / 窗口没了 → 返回 null，编排层整次拒发并把原因摆到分镜表顶上（fail-closed）。
import { confirmSpendAndMintGrant } from "../spendConfirmGrant";
import { readProject } from "../projects/repository";
import type { DeconstructSpendPlan } from "./deconstructVideo";

/** 取项目名给卡上那一行（读不到就不显示，绝不编一个）。 */
function projectNameOf(projectId: string): string | undefined {
  try {
    const record = readProject(projectId);
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    return name || undefined;
  } catch {
    return undefined;
  }
}

export async function authorizeDeconstructSpend(plan: DeconstructSpendPlan): Promise<string | null> {
  const projectName = projectNameOf(plan.projectId);
  return confirmSpendAndMintGrant({
    projectId: plan.projectId,
    ...(projectName ? { projectName } : {}),
    nodeId: plan.nodeId,
    intent: "deconstruct",
    vendor: plan.vision.vendorKey,
    modelKey: plan.vision.modelKey,
    lines: plan.lines,
    // 报价有几行，这颗令牌就允许发起几次——多一次都没有报过价。
    maxAttemptsPerNode: plan.lines.length,
  });
}
