// Agent lane · 审批状态机的**预检那一半**（纯函数，不认识 pi、不认识 electron）
//
// 状态机全图（方案 §1.2）：
//
//   proposed ──► preflight ──┬─► auto-granted ────────────► executing ──► settled
//   (pi 的真相)  (本文件)      ├─► awaiting-user ──┬─► granted-once ──► executing
//                            │  (laneHost 内存    ├─► granted-session ► executing + 写 grant
//                            │   + projection     ├─► denied(reason) ─► {block:{reason}}
//                            │   .pending)        └─► cancelled ──────► lane.abort
//                            └─► denied-by-policy ► {block:{reason}}
//
// **本文件只负责那个分叉**：给定一次调用的契约事实 + 用户当前的档位，它落在
// `auto-granted` / `awaiting-user` / `denied-by-policy` 三条里的哪一条。等待、超时、
// 用户答了什么、grant 表怎么变——全在 `electron/agentLane/laneApprovalGate.ts`，
// 因为那些要一个活着的运行时。拆开的理由和 `laneToolContract.ts` 一样：判据不需要起 App
// 才能测，焊在一起就没人测。
//
// **判据本身一个字都不在这里**：它住在 `../agentCapabilities/capabilityApprovalPolicy.ts`，
// 和旧宿主共用同一份。这里做的是「lane 这个面怎么把自己的工具名换成契约事实」以及
// 「三条分叉各配一句可行动的话」。
import {
  capabilityIsHardGated,
  capabilityMayReuseSafeApproval,
  capabilityWorkModeDecision,
  type CapabilityApprovalSubject,
} from "../agentCapabilities/capabilityApprovalPolicy";
import type { ProjectAgentApprovalPolicy, ProjectAgentWorkMode } from "../projectAgentContracts";
import { projectAgentApprovalPolicyOf } from "../projectAgentContracts";

/** 一次 lane 上的调用，在审批眼里的全部事实。前两个是身份，后四个来自能力契约。 */
export type LaneApprovalSubject = CapabilityApprovalSubject & Readonly<{
  /** lane 这个面上的工具名（`nomi_storyboard_write`）。只用来写记录与画卡。 */
  toolName: string;
  /** 它投影的那个能力契约 id（`canvas.write`）。**「本会话允许这类」按它记**，不按工具名。 */
  capabilityId: string;
}>;

export type LaneApprovalContext = Readonly<{
  policy: ProjectAgentApprovalPolicy | undefined;
  workMode: ProjectAgentWorkMode | undefined;
  /**
   * 这条 lane 现在有没有一个能问的人。
   *
   * MCP stdio 进来的调用、走查脚本、后台批处理都是 `false`——它们**没有窗口**。
   * 抄 pi 参考扩展的三层保险（一致性核对 §7.6）：显式信号 + 默认拒 + 示例里就写 `if (!hasUI) block`。
   * 悄悄放行才是最坏的那一种：没人看见的地方替用户点了头。
   */
  hasUserInterface: boolean;
  /** 本会话已经答过「这类以后不用问」的能力 id。**内存表，不落盘**——「本会话」是字面意思。 */
  sessionGrants: ReadonlySet<string>;
}>;

export type LaneApprovalPreflight =
  | Readonly<{ state: "auto-granted"; grantable: false }>
  | Readonly<{ state: "awaiting-user"; grantable: boolean }>
  | Readonly<{ state: "denied-by-policy"; grantable: false; reason: string }>;

/**
 * 无 UI 时给模型的那句话。
 *
 * 它必须**可行动**：模型读完要知道下一步做什么，而不是知道自己被拒了。
 * 「`[error] E_DENIED`」那种写法在真机上等于什么都没说（#547 §2.2⑤）。
 */
const NO_UI_REASON =
  "This action needs the user to confirm it in the Nomi window, and this session has no window to ask in. "
  + "Do not retry it here: describe what you would have done and let the user run it from the Nomi app.";

/**
 * 「本会话允许这类」该不该有按钮。
 *
 * 门槛与现役介入槽逐字一致，**不加宽**：只有本地可撤销的改动有它；花钱的、不可逆的、
 * 以及 `step` 档下的一律逐次问——`step` 的字面意思就是每一步都问，给它一个会话级放行
 * 等于把用户刚选的档位偷偷改掉。
 */
export function laneApprovalGrantable(
  subject: LaneApprovalSubject,
  policy: ProjectAgentApprovalPolicy | undefined,
): boolean {
  if (capabilityIsHardGated(subject)) return false;
  return projectAgentApprovalPolicyOf(policy).mode !== "step";
}

/** 预检一次调用：它落在状态机的哪一条分叉上。 */
export function preflightLaneApproval(
  subject: LaneApprovalSubject,
  context: LaneApprovalContext,
): LaneApprovalPreflight {
  // ① 工作模式先于档位判。`ask` 只放 read，`editSelection` 不放付费/破坏性的活。
  const workMode = capabilityWorkModeDecision(context.workMode, subject);
  if (!workMode.allowed) {
    return Object.freeze({
      state: "denied-by-policy" as const,
      grantable: false as const,
      reason: `${workMode.reason ?? "This work mode does not permit that action"}. `
        + "Answer with what you found or would propose instead, or ask the user to switch the work mode.",
    });
  }

  // ② 档位 + 硬清单 + 本会话 grant，全部交给两个宿主共用的那一份判据。
  const granted = context.sessionGrants.has(subject.capabilityId);
  if (capabilityMayReuseSafeApproval(context.policy, subject, granted)) {
    return Object.freeze({ state: "auto-granted" as const, grantable: false as const });
  }

  // ③ 要问人了——先确认这里有没有人可问。**fail-closed**，不是「没人就当批了」。
  if (!context.hasUserInterface) {
    return Object.freeze({ state: "denied-by-policy" as const, grantable: false as const, reason: NO_UI_REASON });
  }

  return Object.freeze({
    state: "awaiting-user" as const,
    grantable: laneApprovalGrantable(subject, context.policy),
  });
}
