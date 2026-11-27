// 「有一笔生成在等你点头」的**跨进程契约**。
//
// 为什么住在 `electron/shared/contracts/` 而不是 `electron/productionRun/`：
// 这份形状的两端各在一个进程里——主进程按目录算出它，渲染层的付费确认卡照着画。
// 渲染层不许 import `electron/` 的实现层（`check:boundaries` 的 `src-no-import-electron`），
// 而两侧各写一份类型就得再写一张两份之间的映射表，那正是 R14.1 要横扫的「同一语义两份定义」。
// 中立契约层是两边都认识、谁也不拥有实现的那一层。
import type { ResidentSurfaceDisabledReason, ResidentSurfaceOffPhase } from "./residentSurfaceLifecycle";
import type { GenerationShotKind } from "../generationShotKind";
import type { ProjectAgentApprovalPolicy } from "../agentCapabilities/capabilityApprovalPolicy";
import type { GenerationReference } from '../agentCapabilities/generationPlanSchemas';
import type { GenerationHandOverFailure } from "../../productionRun/productionRunTypes";
import type { OfferShotState } from "../productionGenerationPresentation";

/** 交给画布的一镜为什么没发出去（卡与交接预检读同一份语义码）。渲染层经这份契约拿它，不伸手进 productionRun。 */
export type { GenerationHandOverFailure };

/** 一条参考在派发那一刻的键（供应商适配层按它找上传后的地址；与卡无关，只是住在这份契约里）。 */
export function spendReferenceKey(reference: GenerationReference): string {
  return JSON.stringify([reference.assetId, reference.contentHash, reference.version, reference.kind ?? null, reference.role ?? null]);
}

/**
 * 付费卡上的一镜（D2 第③步）。卡**不**带这一镜要发什么（提示词、参数、参考、价格）——那些只住在画布节点上，
 * 卡上的指向元素和那一行只读摘要都读节点本身（一个东西一个家）。这里只有节点读不到的事实：它是出价里的第几镜、
 * 指向哪个节点、Agent 起草时选的模型（「Nomi 选的」判据）、在这一次出价里走到了哪一步。绝不含密钥或供应商 URL。
 */
export type PendingSpendShot = Readonly<{
  shotId: string;
  /** 已落地的画布节点（指向元素指的就是它）。缺席 = 这一镜还没放到画布上：卡不算它、不交它。 */
  nodeId?: string;
  /** 1 基的镜序（按计划顺序），指向元素与「去改镜 N」印的那个数。 */
  index: number;
  /** 图片还是视频（宿主按 `generationShotKind` 算，和画布节点、派发同一个答案）。卡标题说「张 / 段」只读它。 */
  kind: GenerationShotKind;
  /** Agent 起草时这一镜选的模型。节点当前的模型在这里面 → 卡上说「Nomi 选的」。 */
  draftedModel: Readonly<{ providerId: string; modelId: string }>;
  /** 这一镜在这一次出价里的样子（`productionGenerationPresentation.offerShots`；制作流程批过的旧镜读作 `sent`）。 */
  offer: Exclude<OfferShotState, "approved">;
  /** `not_sent` 时为什么没发出去：卡据此给「再试一次」还是「去改镜 N」。 */
  failure?: GenerationHandOverFailure;
}>;

export type PendingSpendConfirm = Readonly<{
  projectId: string;
  runId: string;
  operationId: string;
  planVersion: number;
  /** 这张卡此刻的身份（出价、摆着哪几镜、每镜候选的版本、指向哪个节点；不含交接走到哪一步）。卡上的动作带着它来，对不上就拒。 */
  quoteId: string;
  /** Append position in this presentation's handover ledger. With quoteId it identifies one confirmation attempt. */
  handOverRevision: number;
  /** Durable identity of the exact presentation that produced this card. */
  presentationId?: string;
  /** Conditional-write epoch for actions originating from this card. */
  presentationEpoch?: number;
  /** Policy captured when this presentation opened. */
  policySnapshot?: ProjectAgentApprovalPolicy;
  /** Read-side deadline or durable failure marker requires an explicit user decision. */
  manualDecisionRequired?: true;
  /**
   * 「直接生成」档本来会代答、但刹车成立所以退回这张卡的原因（只多一行说明为什么停，卡本身和请求批准档一模一样）。
   * 由 `directGenerationBrakes.directGenerationBrakeForRun` 按 Run 现派生，不落盘；没有刹车 = 缺席。
   */
  brake?: Readonly<{ reason: "stopped" | "retry-limit" | "out-of-plan"; shotId?: string }>;
  /** 卡上逐镜价格（节点按画布批量估价同一个函数算出来的数）用哪种币种印。 */
  currency: string;
  shots: readonly PendingSpendShot[];
  /** Projection failure card; identity remains tied to the same presentation. */
  error?: Readonly<{ code: string; message: string }>;
}>;

export type PendingSpendHandOverInput = Pick<PendingSpendConfirm, 'projectId' | 'operationId' | 'quoteId' | 'handOverRevision'>
  & Readonly<{ presentationId?: string; presentationEpoch?: number; planVersion?: number; shotIds: readonly string[] }>;

/**
 * 「有没有待确认的一笔」的**完整**答案（2026-09-14；2026-10-05 起它随对话投影推给面板，不再被轮询）。
 *
 * 三种现实必须是三种不同的值，而不是一个数组加一个异常：
 *   · `ready` + rows        —— 面装着，这些就是要确认的（空数组 = 真的没有）；
 *   · `off`                 —— 本会话按配置没装这条面 / 还在起 / 已停。**不是失败**：这种相下
 *                              没有任何一面能 announce「有一笔在等你」，所以也没有卡可画；
 *   · `unreadable`          —— 读不到：装配抛了（`surface-unavailable`），或投影本身抛了
 *                              （`projection-failed`）。那才是要一路传到用户眼前的失败。它以前是一个
 *                              被拒的 IPC，现在住在推送里，所以必须是一个值而不是一个异常。
 *
 * 2026-09-12 的修法只把「null」改成「抛」，于是「按配置关掉」也成了失败（Canvas Performance
 * 18 个场景每 1.5s 一条 console error）；2026-09-13 又在渲染层把那个错吞回去（而且没接上线）。
 * 两头各修一次都不对，因为两头都不是这份状态的 owner。
 */
export type PendingSpendRead =
  | Readonly<{ surface: "ready"; rows: readonly PendingSpendConfirm[] }>
  | Readonly<{ surface: "off"; phase: ResidentSurfaceOffPhase; reason?: ResidentSurfaceDisabledReason }>
  | Readonly<{ surface: "unreadable"; reason: "surface-unavailable" | "projection-failed"; card?: PendingSpendConfirm }>;
