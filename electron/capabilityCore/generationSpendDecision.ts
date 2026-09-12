// 付费门决议的**唯一那条链**（2026-09-12）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 「要不要花这笔钱」今天有两个答法：用户在 Agent 面板的报价卡上点「生成 ¥X」，
// 或者——2026-09-12 用户拍板之后——他早先把档位切到了「全自动」，于是由那条策略代答。
//
// 两个答法**后面那一段必须一模一样**：封印 → 铸收据 → 决门 → 一次性消费 → 开跑。
// 顺序里没有一步可以省，也没有一步可以有第二个版本：
//
//   requestGenerationGate（封印 + 开门，钱的额度在这里被冻住）
//     → 铸收据（把「谁决定的」变成主进程签过、可验证的事实）
//     → authorizeGeneration（只认对得上的收据）→ 消费收据（同一张再也批不动第二次）
//     → start
//
// 如果让「全自动」另写一条，两条链就会各自漂移，而漂移的地方是**钱**。所以这一层只有一个
// 函数，两个调用方传进来的唯一差别是**那张 attestation 怎么来的**：
//   · `human-gesture` —— 真人在 Nomi 自己的窗口里点了那一下（`appIntegrationSpendConfirm.ts`）；
//   · `policy-full-auto` —— 「全自动」档代答（`generationTransportAdapters.ts`）。
//
// 两者铸出来的收据都带 `decidedBy`，账本上一眼看得出这一笔是谁批的。
//
// ── 这里为什么不判档位 ──
//
// 判据只有一个 owner：`capabilityApprovalPolicy.ts` 的 `spendDecidedByPolicy`。这一层收到的
// 已经是**决定**，不是策略。把「要不要问」和「怎么放行」搅在一起，就会出现第二个地方
// 也能回答「这一档要不要问」——那正是 2026-09-10 审计里「同一语义有几份定义」的形状。
import type { ApprovalReceiptAuthority } from "./approvalReceipt";
import type { DispatchContext } from "./dispatcher";
import type { ProjectLeaseV2 } from "./projectLease";

/** 一次付费决议的凭证来源。两种，没有第三种；缺席不是一种。 */
export type GenerationSpendDecision =
  | Readonly<{
    kind: "human-gesture";
    /** 真人点下去的那个渲染窗口。缺席 = 没有窗口可以代表真人 → 调用方必须 fail-closed。 */
    target: Readonly<{ webContentsId: number; frameId: number; origin: string }>;
  }>
  | Readonly<{
    kind: "policy-full-auto";
    /** 哪个宿主面按「全自动」代答的。进收据、进账本。 */
    surface: string;
  }>;

export type GenerationSpendDecisionDeps = Readonly<{
  requestGenerationGate: NonNullable<DispatchContext["requestGenerationGate"]>;
  authorizeGeneration: NonNullable<DispatchContext["authorizeGeneration"]>;
  planning: NonNullable<DispatchContext["generationPlanning"]>;
  receipts: ApprovalReceiptAuthority;
}>;

export type GenerationSpendDecisionInput = Readonly<{
  operationId: string;
  lease: ProjectLeaseV2;
  decision: GenerationSpendDecision;
  /** 写进 Run 的 origin（面板是 `agent-panel`，lane 自动档是 `agent-lane`）。 */
  actorId: string;
}>;

export type GenerationSpendDecisionOutcome = Readonly<{
  receiptId: string;
  decidedBy: string;
  started: unknown;
}>;

/** 门里那把挑战令牌。拿不到就是这条链的前提不成立——不许接着往下走。 */
export function generationChallengeTokenOf(value: unknown): string {
  const token = value && typeof value === "object" && !Array.isArray(value)
    && (value as { handoff?: { challengeToken?: unknown } }).handoff?.challengeToken;
  if (typeof token !== "string" || !token.trim()) {
    throw Object.assign(new Error("generation_challenge_unavailable"), { code: "generation_challenge_unavailable" });
  }
  return token.trim();
}

/**
 * 决一次付费门并开跑。抛出即失败——**这一层不吞任何错**：吞掉的结果是用户（或模型）
 * 看着一个什么都没发生的界面，而钱到底花没花只有日志知道。
 */
export async function decideGenerationSpend(
  deps: GenerationSpendDecisionDeps,
  input: GenerationSpendDecisionInput,
): Promise<GenerationSpendDecisionOutcome> {
  const params = { operationId: input.operationId };
  const gate = await deps.requestGenerationGate({ params, lease: input.lease });
  const token = generationChallengeTokenOf(gate);
  const attestation = input.decision.kind === "human-gesture"
    ? deps.receipts.createMainProcessGestureAttestation(token, { ...input.decision.target, decision: "accept" })
    : deps.receipts.createPolicyDecisionAttestation(token, { policyMode: "project", policySurface: input.decision.surface });
  const minted = deps.receipts.mintReceipt(token, attestation);
  await deps.authorizeGeneration({ params, lease: input.lease, receipt: minted.receipt });
  deps.receipts.consumeReceipt(minted.token);
  const started = await deps.planning({
    capability: "start",
    params,
    lease: input.lease,
    origin: { host: "nomi", actorId: input.actorId },
  });
  return Object.freeze({ receiptId: minted.receipt.receiptId, decidedBy: minted.receipt.decidedBy, started });
}
