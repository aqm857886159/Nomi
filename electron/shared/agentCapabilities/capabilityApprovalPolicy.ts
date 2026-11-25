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
import type { CapabilityEffect, CapabilityEffectClass } from "./capabilityContract";

/**
 * User-facing execution posture (#194 §14.1 三档：Ask / 编辑选中 / Agent). This
 * axis describes what surface of the project the Agent may touch while shaping a
 * task — read-only advice, only the frozen selection, or cross-object planning —
 * and is intentionally independent from approval/spend policy, which remains an
 * explicit Host-owned snapshot. Changing the work mode never widens approval.
 *   - `ask`           解释/比较/建议，不写项目
 *   - `editSelection` 只对当前冻结的选中范围提修改（受选区约束的编辑模式）
 *   - `agent`         跨对象规划并执行允许的多步任务
 */
export const PROJECT_AGENT_WORK_MODES = ["ask", "editSelection", "agent"] as const;
export type ProjectAgentWorkMode = (typeof PROJECT_AGENT_WORK_MODES)[number];

/** Safe default for legacy turns that predate the resident work-mode picker. */
const DEFAULT_PROJECT_AGENT_WORK_MODE: ProjectAgentWorkMode = "agent";

function projectAgentWorkModeOf(value: ProjectAgentWorkMode | undefined): ProjectAgentWorkMode {
  return value ?? DEFAULT_PROJECT_AGENT_WORK_MODE;
}

/**
 * 用户在 Agent 面板上选的挡位（2026-10-12 用户拍板：只有两档）。快照而非授权——领域 / ProductionRun 的闸仍是权威。
 *   - `request`（请求批准，默认）：能撤销的本地改动直接做；花钱的生成每次先看确认；撤销不了的每次问。
 *   - `direct`（直接生成）：同上，但花钱的生成不再逐次问、由挡位代答；撤销不了的仍每次问。
 *     刹车（同一镜连续失败 / 超出已说好的计划）住在 `directGenerationBrakes.ts`，成立时这一次退回 `request` 的确认路径。
 *
 * 旧词表 `step / safe-auto / project` 和 `spend` 轴（`confirm / within-budget`）已删：`spend` 轴没有任何读者，
 * 「每步问」与「自动改」在花钱 / 不可逆上行为一样，用户的原话是「相当于没有挡位」。盘上旧值的迁移只发生在
 * `electron/settings/agentApprovalPolicyContract.ts#normalizeAgentApprovalPolicySettings` 一处。
 */
export const PROJECT_AGENT_APPROVAL_MODES = ["request", "direct"] as const;
export type ProjectAgentApprovalMode = (typeof PROJECT_AGENT_APPROVAL_MODES)[number];

export type ProjectAgentApprovalPolicy = Readonly<{
  mode: ProjectAgentApprovalMode;
}>;

/** 缺字段 / 认不出 / 旧记录一律是更常问的那一档。 */
export const DEFAULT_PROJECT_AGENT_APPROVAL_POLICY: ProjectAgentApprovalPolicy = Object.freeze({
  mode: "request",
});

export function projectAgentApprovalPolicyOf(
  value: ProjectAgentApprovalPolicy | undefined,
): ProjectAgentApprovalPolicy {
  return value ?? DEFAULT_PROJECT_AGENT_APPROVAL_POLICY;
}

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
   * 契约自己说「这个能力的全部内容就是问用户一句话」（`CapabilityContract.alwaysAsksUser`）。
   * 缺省 `undefined` = 不是。它只抬不降，且**没有任何档位或会话级授权能降**——见
   * `capabilityIsHardGated` 的第 ⑥ 条。
   */
  alwaysAsksUser?: true;
  /** False means this specific plan must be reviewed each time, even with a session grant. */
  planReviewAllowsReuse?: boolean;
  /**
   * 外部 MCP 服务器在工具声明上打的 `destructiveHint`。
   *
   * **它只能抬高摩擦，不能降低。** MCP 规范说这些 hint 不可信、除非服务器本身受信
   * （`https://modelcontextprotocol.io/specification/2025-06-18/server/tools` §Tool Annotations），
   * 所以 `true` 会把一次调用抬进硬闸，而 `false` 什么都不做——一个说自己无害的
   * 外部工具不会因此少问一次。原生能力这里恒 `false`。
   */
  destructiveHint: boolean;
  /**
   * 受信的**宿主**判定：这一次调用必须当次确认，不管用户选的是哪一档。
   *
   * 今天只有一个来源——沙箱逃逸档的 shell 命令（`laneNativeApproval.ts`：分类器判它跑出了
   * 项目目录/沙箱）。它是一条**关于这次调用**的事实，和 `destructiveHint` 一样**只抬不降**：
   * `true` 抬进逐次确认，`false` 什么都不做。
   *
   * 为什么它长在这里，而不是由调用方换掉档位（2026-09-12 修）：`laneApprovalGate` 原来写的是
   * `forceConfirmation ? 更严的假档位 : policy`——一个调用点**伪造出一份
   * 用户从没选过的档位**，塞给下游所有读档位的判据。于是「用户现在在哪一档」在这条路上有了
   * 第二个答案，而档位恰恰是「全自动下付费不再逐笔问」的唯一依据（`spendDecidedByPolicy`）：
   * 一份伪造的档位能把那个问题也一起答错。事实归事实、档位归档位，判据仍只有这里一个 owner。
   *
   * 它不进 `capabilityIsHardGated`：硬闸那一族连「本会话别再问这类」的按钮都不给，而逃逸命令
   * 恰恰要留着那个按钮（用户答应过的那条命令模式可以复用，见 `codingCommandPolicy` 的
   * `rememberablePattern`）。所以它只夺走「不问就放行」，不夺走「用户自己说以后别问」。
   */
  hostMustConfirm?: boolean;
}>;

type CapabilityWorkModeDecision = Readonly<{ allowed: boolean; reason?: string }>;

/**
 * 谁都不能自动批的那一族（方案 §1.1「硬清单独立于档位」）。
 *
 * 三条来源各不相同，但后果相同——**任何档位下都要用户当次点头**：
 *   ① 花钱（`spend`）：钱花出去撤不回来，档位说的是「多快能改完」，不是「多快能花完」；
 *   ② 不可逆（`irreversible`）：`canvas.delete` / `export.write` 这一族；
 *   ③ 外部工具的 `destructiveHint`（只抬不降，见上）。
 * 外加 ④ **解不出效果类**：未登记的别名，我们证明不了它安全。
 * 以及 ⑤ 契约声明的逐次计划审阅：这一次的载荷必须当次确认，不能借用别的计划的授权。
 */
/**
 * 「这一笔付费，宿主自己决定还是先问用户？」——**挡位这一半**只有这一个函数回答（2026-09-12 起；2026-10-12 用户把三档收成两档）。
 *
 * 它和下面 `capabilityIsHardGated` 问的不是同一个问题：`capabilityIsHardGated` 管**模型面**——任何档位下模型都不能自己发起
 * 一次付费调用（付费能力压根不投影进模型的工具表，`paidBoundary.ts`）；这里管**宿主面**——草稿已经建好、闸已经在那里了，
 * 是弹一张报价卡等用户点，还是由他此前选的「直接生成」代答：
 *   · `request`（请求批准）—— 逐次弹卡；
 *   · `direct`（直接生成）—— 不弹卡，闸在同一个边界上由挡位决定，收据照铸照签（`decidedBy: "policy:full_auto"`）。
 *
 * 带 Run 的入口不直接用它，而是问 `directGenerationBrakes.ts#spendDecisionByPolicy`——后者先问这一个，再问刹车；
 * 这个函数只剩没有 Run 可看的调用（模型接入试跑 `tryModel`）和那个函数自己。
 */
export function spendDecidedByPolicy(policy: ProjectAgentApprovalPolicy | undefined): boolean {
  return projectAgentApprovalPolicyOf(policy).mode === "direct";
}

export function capabilityIsHardGated(subject: CapabilityApprovalSubject): boolean {
  if (subject.destructiveHint) return true;
  // ⑥ 「这个能力就是问用户一句」（`CapabilityContract.alwaysAsksUser`）。它是**唯一**一条
  //    不是因为后果严重而硬闸的：不问就没有答案，自动放行等于替用户编一句他没说过的话。
  if (subject.alwaysAsksUser) return true;
  if (subject.requiresPlanReview && subject.planReviewAllowsReuse === false) return true;
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
 * 两档（`request` / `direct`）都允许契约标记的本地可撤销动作不弹确认卡。花钱、不可逆、
 * 认不出的动作在**每一档**都保留逐次闸（花钱的宿主面代答另见 `spendDecidedByPolicy`）。
 *
 * 一个例外由能力自己声明、不在这里裁决：带 `requiresPlanReview` 的契约，它的载荷是一份
 * 用户必须先读的计划（一次时间轴编辑是一笔多操作事务，效果从调用本身根本看不出来）。
 * 这一族在 `request` 下每次执行先问一次，之后的复用只能由用户自己的「本会话 / 不再问」
 * 答案授予——否则计划会在高亮画出来之前就提交，介入槽里那几个逐级升级的选项也就没东西可改了。
 */
export function capabilityMayReuseSafeApproval(
  policy: ProjectAgentApprovalPolicy | undefined,
  subject: CapabilityApprovalSubject,
  safeApprovalGranted: boolean,
): boolean {
  const normalized = projectAgentApprovalPolicyOf(policy);
  // 宿主说这一次必须当次确认（逃逸档 shell 命令）。用户自己答过「这类以后别问」的那一条
  // 仍然算数——那是他本人给的授权，不是档位替他给的。
  if (subject.hostMustConfirm && !safeApprovalGranted) return false;
  if (capabilityIsHardGated(subject)) return false;
  if (normalized.mode === "direct") return true;
  return !subject.requiresPlanReview || safeApprovalGranted;
}

/**
 * 放行矩阵的单一可读出口：这一次调用在这个挡位下是直接做（`run`）还是先问用户（`ask`）。
 * 它只是把已有判据排成一个答案，**不另立判据**：
 *   · 硬闸（花钱 / 不可逆 / 解不出效果类 / destructiveHint / 逐次计划审阅）→ 两档都 `ask`；
 *   · 花钱的**宿主面**代答由 `spendDecidedByPolicy` 回答（`direct` 档），这里的 `paid` 在 `direct` 下为 `run` 指的就是它；
 *   · 其余可撤销的本地改动 → 两档都 `run`。
 */
export function capabilityApprovalDecision(
  policy: ProjectAgentApprovalPolicy | undefined,
  subject: CapabilityApprovalSubject,
): "run" | "ask" {
  if (subject.effectClass === "spend" && !subject.destructiveHint && !subject.alwaysAsksUser) {
    return spendDecidedByPolicy(policy) ? "run" : "ask";
  }
  return capabilityMayReuseSafeApproval(policy, subject, false) ? "run" : "ask";
}
