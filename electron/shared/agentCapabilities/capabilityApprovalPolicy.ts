// 能力审批策略 · **决定那一半**（纯函数，唯一 owner）
//
// 为什么它住在 `electron/shared/agentCapabilities/` 而不是某个宿主里：**「这个动作要不要
// 停下来问用户」只能有一个答案。** 今天它住在 `projectAgentHost/projectAgentExecutionPolicy.ts`
// ——那是即将被删掉的旧宿主（方案 §2.2）。新 lane 要用同一条判据，两条路只有两个选择：
// 新宿主 import 旧宿主（阶段 4 删旧时当场断），或者再写一份（P1 明令禁止的并行版）。
// 所以把**决定**搬到两条路都认识的那一层，两个宿主各留一层薄薄的**名字解析**。
//
// 分界画在哪：
//   · **决定**（本文件）——只认能力契约上的事实（`effect` / `effectClass` / `requiresPlanReview`）。
//   · **名字解析**（各宿主）——旧宿主按 pi 别名查（`resolveCapabilityAlias`），
//     lane 按契约 id 查（lane 的工具名 `nomi_storyboard_write` 不是别名，是这个面自己的名字）。
//     这一半**本来就该**各写各的：不同的面对同一个能力有不同的名字，那是投影不是分歧。
import type { ProjectAgentApprovalPolicy, ProjectAgentWorkMode } from "../projectAgentContracts";
import {
  projectAgentApprovalPolicyOf,
  projectAgentWorkModeOf,
} from "../projectAgentContracts";
import type { CapabilityEffect, CapabilityEffectClass } from "./capabilityContract";

/**
 * 一次调用在**审批**眼里的全部事实。
 *
 * 三个字段全部来自能力契约，没有一个是调用方现编的——这正是「效果声明住在档案里、
 * 通用系统负责读」（P4）。`effectClass` 允许 `undefined`：未登记的别名解不出效果类，
 * 而**解不出就是最危险的那一档**（下面每条规则都对它 fail-closed）。
 */
export type CapabilityApprovalSubject = Readonly<{
  /** 契约的 `effect`（`read` / `reversible_write` / `destructive` / `paid`）。 */
  effect: CapabilityEffect | undefined;
  /** 契约（或它的 `operationEffectClasses`）为这次调用定的效果类。 */
  effectClass: CapabilityEffectClass | undefined;
  /** 契约自己说「这份载荷是一份用户必须先读的计划」。 */
  requiresPlanReview: boolean;
  /**
   * 外部 MCP 服务器在工具声明上打的 `destructiveHint`。
   *
   * **它只能抬高摩擦，不能降低。** MCP 规范说这些 hint 不可信、除非服务器本身受信
   * （`https://modelcontextprotocol.io/specification/2025-06-18/server/tools` §Tool Annotations），
   * 所以 `true` 会把一次调用抬进硬闸，而 `false` 什么都不做——一个说自己无害的
   * 外部工具不会因此少问一次。原生能力这里恒 `false`。
   */
  destructiveHint: boolean;
}>;

export type CapabilityWorkModeDecision = Readonly<{ allowed: boolean; reason?: string }>;

/**
 * 谁都不能自动批的那一族（方案 §1.1「硬清单独立于档位」）。
 *
 * 三条来源各不相同，但后果相同——**任何档位下都要用户当次点头**：
 *   ① 花钱（`spend`）：钱花出去撤不回来，档位说的是「多快能改完」，不是「多快能花完」；
 *   ② 不可逆（`irreversible`）：`canvas.delete` / `export.write` 这一族；
 *   ③ 外部工具的 `destructiveHint`（只抬不降，见上）。
 * 外加 ④ **解不出效果类**：未登记的别名，我们证明不了它安全。
 */
export function capabilityIsHardGated(subject: CapabilityApprovalSubject): boolean {
  if (subject.destructiveHint) return true;
  return subject.effectClass !== "reversible_local";
}

/**
 * 把渲染层选的工作姿态在**宿主边界**上执行一次。模型提示词只是引导，这里才是拦得住的地方。
 *
 * 未登记的别名对两个窄档 fail-closed：宿主证明不了它是只读的，也证明不了它只碰选区。
 */
export function capabilityWorkModeDecision(
  mode: ProjectAgentWorkMode | undefined,
  subject: CapabilityApprovalSubject,
): CapabilityWorkModeDecision {
  const workMode = projectAgentWorkModeOf(mode);
  if (workMode === "agent") return { allowed: true };
  if (workMode === "ask") {
    return subject.effect === "read"
      ? { allowed: true }
      : { allowed: false, reason: "Ask mode only permits read-only Agent actions" };
  }
  // 编辑选中：可以读、可以提可撤销的改动，但不许开始付费/破坏性的活。
  // 具体的冻结选区仍由 target/precondition 那道闸负责，这里只管效果类。
  if (subject.effect === "read" || subject.effectClass === "reversible_local") {
    return { allowed: true };
  }
  return { allowed: false, reason: "Edit-selection mode only permits read or reversible selection edits" };
}

/**
 * `safe-auto` / `project` 允许契约标记的本地可撤销动作不弹确认卡。花钱、不可逆、
 * 认不出的动作在**每一档**都保留逐次闸；`step` 连本地写入也每次问。
 *
 * 一个例外由能力自己声明、不在这里裁决：带 `requiresPlanReview` 的契约，它的载荷是一份
 * 用户必须先读的计划（一次时间轴编辑是一笔多操作事务，效果从调用本身根本看不出来）。
 * 这一族在 `safe-auto` 下每次执行先问一次，之后的复用只能由用户自己的「本会话 / 不再问」
 * 答案授予——否则计划会在高亮画出来之前就提交，介入槽里那几个逐级升级的选项也就没东西可改了。
 */
export function capabilityMayReuseSafeApproval(
  policy: ProjectAgentApprovalPolicy | undefined,
  subject: CapabilityApprovalSubject,
  safeApprovalGranted: boolean,
): boolean {
  const normalized = projectAgentApprovalPolicyOf(policy);
  if (normalized.mode === "step") return false;
  if (capabilityIsHardGated(subject)) return false;
  if (normalized.mode === "project") return true;
  return !subject.requiresPlanReview || safeApprovalGranted;
}
