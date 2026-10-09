import type { ProductionExecutionBinding } from "./productionExecutionBinding";
import type { ProductionGenerationAuthorizationEnvelopeV1 } from "./productionGenerationAuthorization";
import type { GenerationProviderTaskState } from "../capabilityCore/generationRuntimeAdapter";
import type { ExecutionContractV1, PlanCandidate } from "../capabilityCore/executionContract";
import type { ProjectAgentApprovalPolicy } from "../shared/agentCapabilities/capabilityApprovalPolicy";

export const PRODUCTION_RUN_SCHEMA_VERSION = 1;

/**
 * B3 信任档位（run 级，写进 policy 可查证）——决定「创意门 / 样片门」打不打扰，钱门永不受影响：
 * - key_confirm（默认）：五门全开——方向门 + 样片门都停，用户逐项拍板。
 * - budget_only：跳过创意门与样片门（自动批准、事件留痕），只留预算门与不可逆动作。「别问了直接出」= 降到这档。
 * - confirm_all：控制欲最强——每镜提交给供应商前都在 Nomi 停下确认。
 * 预算门（budget_envelope）任何档位都不跳。
 */
export type TrustLevel = "key_confirm" | "budget_only" | "confirm_all";

export const DEFAULT_TRUST_LEVEL: TrustLevel = "key_confirm";

const TRUST_LEVELS: readonly TrustLevel[] = ["key_confirm", "budget_only", "confirm_all"];

/** B3：把任意输入收敛成合法档位（非法/缺省 → key_confirm）。单一收口，别在各处硬编码判断。 */
export function normalizeTrustLevel(value: unknown): TrustLevel {
  return TRUST_LEVELS.includes(value as TrustLevel) ? (value as TrustLevel) : DEFAULT_TRUST_LEVEL;
}

/** 读一个 run 的有效档位（老 run 无字段 → 默认）。 */
export function trustLevelOf(policy: Pick<AutomationPolicy, "trustLevel">): TrustLevel {
  return normalizeTrustLevel(policy.trustLevel);
}

export type AutomationPolicy = {
  trustedHosts: string[];
  allowedProviders: string[];
  allowedModels: string[];
  maxSpend: number | null;
  maxAttemptsPerJob: number;
  minimizeUploads: boolean;
  /** B3 信任档位。老 run 文件无此字段 → 读作默认 key_confirm（向后兼容）。 */
  trustLevel?: TrustLevel;
};

export type BudgetLedgerSummary = {
  currency: string;
  authorized: number;
  /** 已知价的在途预留之和。价格未知的那几笔**不在这个数里**（它们在 `unknownInFlight`）。 */
  reserved: number;
  actual: number;
  unsettled: number;
  /**
   * 价格未知、已经派出去还没结清的笔数（2026-09-21 未知价开闸）。
   *
   * 为什么是笔数不是金额：我们不知道那个金额。把它当 0 加进 `reserved` 会让账本读起来像
   * 「这几笔不花钱」，而那正是三种可能里唯一会骗人的那一种。旧账本没有这个数 → 0。
   */
  unknownInFlight: number;
};

export type ProductionRunStatus =
  | "draft"
  | "awaiting_direction"
  | "awaiting_script_review"
  | "awaiting_storyboard_review"
  | "awaiting_contract"
  | "ready"
  | "running"
  | "pausing"
  | "paused"
  | "needs_attention"
  | "awaiting_rough_cut_review"
  | "awaiting_export"
  | "exporting"
  | "completed"
  | "cancelled";

/**
 * 一次制作**为什么停下**：停的那一刻由停它的那一方写进 `run.status` 命令（`payload.reason`），界面只读这个事实。
 * 以前界面从 Run 状态反推——`needs_attention` 一律被说成「预算已用完 · 提额续拍」，而今天根本没有价格。
 * - `failed`：有镜头、审片、组装或导出没成功，这一批靠自己走不下去了；
 * - `user_paused`：用户按了急停；
 * - `user_cancelled`：用户取消了这次制作；
 * - `restart_recovery`：Nomi 重启后要先核对之前在跑的任务；
 * - `consent_expired`：批过的镜离用户最后一次点头已经过了同意窗口还没发出去，没有人替他续——停下来等他再点一次
 *   （2026-10-01 付费卡① 第 13 条，判据在 `productionDispatchConsent`）。
 * - `landing_failed`：批过的镜没能先落到画布上——「先落节点、再发请求」（架构③，2026-10-08），所以没有发出生成请求；
 *   停下来等用户打开项目后再点一次（重落、再派）。唯一写口 `shotLandingAdmission`。
 *
 * 2026-10-01 删掉了 `budget`（「批过的额度用完了」）：授权按镜存之后，一镜派不派只看批它的那一份，Run 级的额度停
 * 没有剩下的用处，今天又根本没有价格。上一版记成 `budget` 的旧 Run 读盘时当作没记原因（中性的「已停」）。
 */
export type ProductionRunStopReason = "failed" | "user_paused" | "user_cancelled" | "restart_recovery" | "consent_expired" | "landing_failed";

export type ProductionRunStop = {
  reason: ProductionRunStopReason;
  /** 停下的那一刻。 */
  at: string;
};

export type ProductionJobStatus =
  | "planned"
  | "authorization_required"
  | "authorized"
  | "submit_intent_persisted"
  | "submitting"
  | "provider_accepted"
  | "polling"
  | "retry_wait"
  | "downloading"
  | "validating_technical"
  | "validating_content"
  | "ready"
  | "adopted"
  | "submission_unknown"
  | "reconciling"
  | "needs_attention"
  | "cancel_requested"
  | "cancelled_remote"
  | "detached"
  | "too_late";

export type ProductionStageStatus =
  | "pending"
  | "running"
  | "awaiting_gate"
  | "completed"
  | "needs_attention"
  | "cancelled";

export type ProductionGateStatus = "waiting" | "approved" | "rejected" | "expired" | "revoked";

export type ProductionContract = {
  specs: {
    durationSeconds?: number;
    aspectRatio?: string;
    language?: string;
    shotCount?: number;
  };
  claims: Array<{ text: string; evidenceIds: string[] }>;
  evidence: Array<{ evidenceId: string; label: string; projectRelativePath?: string }>;
  skills: Array<{ name: string; version: string }>;
  estimatedCost?: { currency: string; minimum: number; maximum: number };
};

export type ProductionBrief = {
  goal: string;
  audience?: string;
  channel?: string;
  tone?: string;
  durationSeconds?: number;
  sellingPoints?: string[];
  referenceArtifactIds?: string[];
};

export type ProductionStage = {
  stageId: string;
  title: string;
  status: ProductionStageStatus;
  order: number;
  startedAt?: string;
  completedAt?: string;
  /**
   * W1.5 审片摘要（仅 qa 阶段）：driver 跑完审片后把「N 镜过检 · M 面红标」这类一句话人话摘要
   * 盖在 qa 阶段上，让 nomi_get_run 投影读得到（per-shot 明细走 qa.verdict 事件，此处只留总览）。
   * 文本经投影 sanitizer；老 run 无字段 → 不显。
   */
  qaSummary?: string;
};

export type ProductionJob = {
  jobId: string;
  stageId: string;
  status: ProductionJobStatus;
  attempt: number;
  provider: string;
  model: string;
  idempotencyKey: string;
  providerTaskId?: string;
  /** Last provider status observed through the provider's query/reconcile capability. */
  providerStatus?: string;
  /** Closed control-plane state derived from providerStatus; absent on legacy jobs. */
  providerState?: GenerationProviderTaskState;
  /** P1/P3 sealed execution identity; absent only on legacy jobs. */
  executionBinding?: ProductionExecutionBinding;
  requestFingerprint?: string;
  runtimeEnvelopeRef?: string;
  providerIdempotencyKey?: string;
  /** Canonical paid authority shared by the gate, Approval, outbox and provider payload. */
  authorizationDigest?: string;
  taskKind?: string;
  nodeId?: string;
  /** Storyboard provenance copied from the approved script at plan.attach time. */
  sourceScriptArtifactId?: string;
  sourceScriptVersion?: number;
  sourceScriptHash?: string;
  /** Structured shot metadata (ff/lf/motion/variation/camera/continuity). */
  metadata?: Record<string, unknown>;
  /** QA retry lineage. A retry is a new job so the original result remains inspectable. */
  parentJobId?: string;
  retryCount?: number;
  retryReason?: string;
  progressPercent?: number;
  lastPollAt?: string;
  lastVendorStateChangeAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * 「已生成、取回失败」的 job.errorCode（#975 A2）：供应商做完了、钱花了，丢的只是把结果取回本机这一下。
 * 唯一的下一步是「重新取回」（job.retry_retrieval：回到轮询再查再取，免费、不重新提交）；
 * 写它的是 productionGenerationSubmission.materialize，认它的是 service 的重新取回命令与任务面板。
 */
export const OUTPUT_RETRIEVAL_FAILED = "output_retrieval_failed" as const;

export type ProductionShotClaim = {
  by: "canvas" | "production";
  attempt: number;
  claimedAt: string;
};

/**
 * P4 S1 一个镜头的可编辑草稿 + shot 粒度记账。
 *
 * 单镜链的旧形态（plan 顶层直接挂 candidate/contract/approvedReceiptId）保持不动 —— 一个 shots[]
 * 为空的 plan 就是「一个默认镜」，读路径全部走顶层字段，老 Run 快照零迁移。多镜形态把每一镜的
 * candidate/子合同/批准记账/attempt 谱系收进这里，plan 顶层只保留计划级的 hash 与状态。
 *
 * 记账降到 shot 粒度是硬要求（§3.3）：一镜 new_attempt 不得清计划级批准、不得连坐其他镜；
 * attempt 单调性只在**同一镜谱系**内比较（`attemptCount` = 该镜已发起的提交尝试数）。
 */
export type ProductionGenerationShot = {
  /** Stable per-shot identity; enters the sub-contract and every derived key (jobId/idempotency). */
  shotId: string;
  /**
   * P4 S4 role within the batch. `"anchor"` = an identity/scene definition IMAGE that must generate
   * BEFORE the video shots and gate them through the anchor checkpoint (§3.2); `"shot"` (or absent,
   * backward compatible) = a video shot released only after the checkpoint passes. Anchors and shots
   * ride the SAME Run and SAME shots[] array — the scheduler partitions by role. Enumerating anchors
   * here is what makes "总请求数 = 锚数 + 镜数" a durable, replay-stable fact (§5 invariant).
   */
  role?: "anchor" | "shot";
  /** Checkbox for 试拍/分批: a sealed contract only covers included shots. Absent → included. */
  included?: boolean;
  /**
   * 模型拟的短标题（给人看，不进 provider 请求）。画布节点标签与花钱确认卡那行都读它；
   * 缺省时由**渲染层**用带 zh/en 的 i18n 兜底，主进程不再自己合成（那份是硬编码中文）。
   */
  title?: string;
  candidate: PlanCandidate;
  /** Sealed sub-contract for this shot; absent until the plan is sealed. */
  contract?: ExecutionContractV1;
  /** Shot-grained receipt approval — never cleared by a sibling shot's new attempt. */
  approvedReceiptId?: string;
  approvedAt?: string;
  /** Which explicit submission attempt this shot's latest human receipt authorizes. */
  approvedAttempt?: number;
  /** Monotonic count of submission attempts issued for THIS shot's lineage (attempt-scoped to the shot). */
  attemptCount?: number;
  /**
   * P4 S5 画布落地绑定：这一镜对应的画布占位节点 id。确认即落（项目正开）或打开项目补齐时，物化通道建好
   * 占位节点后经 `plan.bind-shot-nodes` 写回这里。**它是「shot ↔ 画布节点」的单一真相**（不另立本地撤销标记）：
   *   - 有 nodeId + 节点在画布 → 生成完回填 result（attach-shot-result）；
   *   - 有 nodeId 但节点被删（整批 Cmd+Z）→ 标 `canvasDetached`，恢复补齐**不再复活**（§3.4：以撤销事实为准）；
   *   - 无 nodeId（确认时项目没开）→ 打开项目时按 shotId 补建再写回。
   * 提交时 job 从这里继承 nodeId（productionGenerationSubmission.prepare），使 scheduler 的 job 也带 nodeId 供 reconcile。
   */
  nodeId?: string;
  /** P4 S5：这一镜的画布节点曾被用户从画布删除（整批撤销/手动删）。恢复补齐据此不复活（撤销事实优先）。 */
  canvasDetached?: boolean;
  /** Durable owner of the current attempt; written only by the Run reducer. */
  claim?: ProductionShotClaim;
  updatedAt: string;
};

/** 这一次出价是怎么关掉的。`resolved` = 卡上每一镜都决定了（生成或去掉）；其余三种是还有镜没决定就关了。 */
export type GenerationPresentationCloser = "resolved" | "user_closed" | "user_wrote" | "stopped";

export type GenerationPresentation = {
  /** Durable identity of the displayed confirmation card. */
  presentationId?: string;
  /** Monotonic epoch for conditional card actions. */
  presentationEpoch?: number;
  /** Approval policy captured when this card was opened; later policy changes do not rewrite it. */
  policySnapshot?: ProjectAgentApprovalPolicy;
  /** Full-auto policy decision lifecycle for this presentation. */
  policyDecisionState?: "pending" | "failed";
  /** Read-side safety deadline for a policy decision that may fail to persist its marker. */
  policyDecisionDeadlineAt?: string;
  /** 这一次摆到卡上的那几镜（按计划顺序；单镜旧形态 = 顶层候选的 candidateId）。 */
  shotIds: string[];
  openedAt: string;
  /**
   * 这一次出价开出来时，Run 上已经有几道付费门（`spendAuthorizationGates` 的个数）。在它之后建的门才算「在这一次出价里点的」
   * ——按门的先后算，不按时间戳比：两次操作落在同一毫秒时，时间戳分不出先后。
   */
  fromGate: number;
  /** 用户在卡上点了「去掉这张」的那几镜（按点的先后）。去掉的镜不生成、以后也不再自动摆上卡。 */
  removed?: Array<{ shotId: string; at: string }>;
  /** 缺席 = 卡还开着。 */
  closed?: { at: string; by: GenerationPresentationCloser };
};

export type ProductionGenerationPlan = {
  operationId: string;
  state: "draft" | "sealed" | "cancelled" | "submitted";
  /**
   * 每一次把卡摆到用户面前（`generate` 动词 → `generation.present`）一条，只追加（2026-09-30 付费卡逐镜）。
   * 最后一条就是这一次出价：摆了哪几镜、什么时候、关了没有、为什么关。卡上每一镜点「生成这张」「去掉这张」
   * 之后，这一次出价里还没决定的镜才留在卡上；一镜都不剩时这一条自己关掉（`resolved`）。
   * 唯一读口 `electron/shared/productionGenerationPresentation.ts`，唯一写口 `electron/productionRun/productionGenerationPresentationEdits.ts`
   * （都经 reducer 的命令）。旧 Run 的 `cardHidden` 读盘时归一成它。
   */
  presentations?: GenerationPresentation[];
  candidate: PlanCandidate;
  contract?: ExecutionContractV1;
  /**
   * P4 S1 多镜形态：每镜的草稿 + shot 粒度记账。空/缺省 = 单镜旧形态（走顶层 candidate/contract）。
   * 顶层字段永不删除（老 Run 快照读路径依赖它）；多镜时顶层继续描述「默认镜」以维持向后兼容。
   */
  shots?: ProductionGenerationShot[];
  /**
   * Single-shot canvas landing binding. Multi-shot plans keep this identity on
   * each `shots[]` entry; the top-level field preserves the legacy single-shot
   * shape while still giving the real result a durable node owner.
   */
  nodeId?: string;
  /** A user deletion/undo of the single-shot placeholder must not be silently
   * resurrected by the next reconciliation pass. */
  canvasDetached?: boolean;
  /** Durable owner for the legacy single-shot plan. */
  claim?: ProductionShotClaim;
  /**
   * P4 S2 seal-time cost certainty. "known" = every included shot had a derived price at seal.
   * "partial" = the plan sealed with at least one unpriced shot (honest "we could not price all of
   * these"; the seal is still allowed when the hard cap is satisfied or unset — plan §3.1/§9).
   */
  costCertainty?: "known" | "partial";
  updatedAt: string;
};

/**
 * B1 创意方向候选：AI 拟的一句话方向，用户在对话/面板里三选一（或「都不要，自己描述」）。
 * key = 稳定选项标识（决议时回填进事件留痕）；oneLiner = 一句话描述（用户可读，走 i18n 转述）。
 */
export type ProductionDirectionCandidate = {
  key: string;
  title: string;
  oneLiner: string;
};

export type ProductionGate = {
  gateId: string;
  /**
   * P4 S4 adds `anchor_checkpoint`: the "锚亮相检查点" (§3.2). It gates the shot batch on the user
   * approving the anchor definition images — a quality checkpoint, NOT a spend gate. It rides the same
   * gate.add/gate.decide channel (fact written into the Run, never the renderer store) but is scoped
   * distinctly so the service-layer budget authorization (which only fires on `budget_envelope`) never
   * connects it — the checkpoint costs nothing and needs no fresh receipt (the receipt already covered
   * the batch at confirmation; this pause only asks "does the face look right?").
   */
  scope: "stage" | "job_set" | "budget_envelope" | "export" | "publish" | "anchor_checkpoint";
  status: ProductionGateStatus;
  planHash: string;
  /** Present only for the paid generation gate whose planHash is the canonical digest. */
  authorizationDigest?: string;
  /**
   * 付费生成门**自己**带着它冻住的那份信封（2026-09-30）：每点一次一份，只盖那一次点到的镜头。
   * 派发核的是「批这个 job 的那道门」上的这一份（job.authorizationDigest → 这道门），不是计划上某一份——
   * 计划级那一份已删：它让「只批这一镜」只能靠把别的镜移出这一批来实现，也让排在前面的镜在下一次批准时
   * 失去授权。只在 `authorizationDigest` 存在时出现。
   */
  authorizationEnvelope?: ProductionGenerationAuthorizationEnvelopeV1;
  costScope?: string;
  receiptId?: string;
  requestedSpend?: number;
  /** 这道门里价格未知的 job 数（2026-09-21）。`requestedSpend` 只说已知的那部分。 */
  requestedUnknownJobs?: number;
  jobIds: string[];
  title: string;
  summary: string;
  contract?: ProductionContract;
  /** B1：方向门候选（仅 gate-direction-*）。driver 拟好后 gate.set_candidates 挂上，投影透出。 */
  directionCandidates?: ProductionDirectionCandidate[];
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  /**
   * 用户为这道付费门批的镜**续过同意**的最近一刻（2026-10-01 付费卡① 第 13 条）：放行形象检查点、停下之后点「继续」。
   * 派发判「还算不算同意过」读它与 `decidedAt` 里更晚的那个（`productionDispatchConsent`）。信封与收据都不动。
   */
  consentRenewedAt?: string;
  consentRenewedBy?: "anchor_release" | "resume";
  /** B1：方向门被批准时用户选中的候选 key（decide payload choiceKey → 事件留痕）。 */
  decidedChoiceKey?: string;
  /** The approved storyboard revision this contract was materialized from. */
  artifactId?: string;
  artifactVersion?: number;
};

export type ProductionArtifact = {
  artifactId: string;
  stageId: string;
  jobId?: string;
  kind: "brief" | "direction" | "script" | "storyboard" | "image" | "video" | "audio" | "model3d" | "timeline" | "export";
  status: "candidate" | "ready" | "adopted" | "rejected";
  /** Monotonic artifact version within a run. Optional for pre-contract artifacts. */
  version?: number;
  /** Actor that produced the artifact; persisted for provenance/audit. */
  source?: "user" | "nomi-agent" | "external-mcp";
  parentArtifactId?: string;
  retryCount?: number;
  retryReason?: string;
  contentHash?: string;
  /** The source artifact/version/hash for a derived artifact (for example storyboard → script). */
  sourceArtifactId?: string;
  sourceVersion?: number;
  sourceContentHash?: string;
  /** Alias used by older callers and external projections. */
  sourceHash?: string;
  sourceScriptArtifactId?: string;
  sourceScriptVersion?: number;
  sourceScriptHash?: string;
  reviewStatus?: "waiting" | "approved" | "changes_requested";
  skillEvidence?: Array<{ name: string; version: string; stageId: string }>;
  projectRelativePath?: string;
  thumbnailRelativePath?: string;
  width?: number;
  height?: number;
  createdAt: string;
  adoptedAt?: string;
};

export type ProductionRun = {
  schemaVersion: number;
  runId: string;
  projectId: string;
  revision: number;
  status: ProductionRunStatus;
  stageId: string;
  playbook: { name: string; version: string };
  /** `nodeId`：画布节点发起的 Run（host canvas）的来源节点——先有节点、请求才发出（shotLandingAdmission.landedNodeOf）。 */
  origin: { host: string; actorId?: string; nodeId?: string; sourceDocument?: { documentId: string; revision: number; contentHash: string } };
  brief?: ProductionBrief;
  policy: AutomationPolicy;
  budget: BudgetLedgerSummary;
  planVersion: number;
  snapshotCursor: number;
  stages: ProductionStage[];
  gates: ProductionGate[];
  jobs: ProductionJob[];
  artifacts: ProductionArtifact[];
  /** Optional single-shot plan owned by this Run; legacy playbooks omit it. */
  generationPlan?: ProductionGenerationPlan;
  /** Creative metadata only; editable shot content is owned by generationPlan. */
  authoring?: { title: string };
  /**
   * 停在 pausing / paused / needs_attention / cancelled 时，停下的原因（只由 reducer 的 `run.status` 写，离开这些状态即清掉）。
   * 上一版写下的 Run 没有它：读作「原因没记下」，绝不当成预算。
   */
  stop?: ProductionRunStop;
  createdAt: string;
  updatedAt: string;
};

/**
 * 草稿摘要：Run 列表投影里**结构上**能显示「这份草稿到底是什么」的最小事实集。
 *
 * 为什么必须进 Summary：任务中心的行只吃 ProductionRunSummary，而 Summary 此前不含 generationPlan，
 * 所以一份 agent 刚建的草稿在任务面板上只能显示「等待开始」——用户看不到模型、看不到提示词，
 * 也就无从判断 agent 定的对不对。
 *
 * 只投影**展示**用的身份与文本，绝不含 transportModelId、参数全集或任何凭据。
 */
export type ProductionRunDraftSummary = {
  candidateId: string;
  /** PlanCandidate.revision —— 列表刷新时用来判断「这份草稿变了没有」。 */
  revision: number;
  /** 供应商 key + 模型 key（身份唯一键是这两段，只显示模型段会串台）。 */
  vendor: string;
  modelKey: string;
  /** 目录任务种类（text_to_image / image_to_video …）。 */
  mode: string;
  modeId?: string;
  /** 提示词首行（已裁剪）——列表行只放一行，全文在详情里。 */
  promptLine: string;
  /**
   * 画幅比例的**显示值**。各档案给这个参数起的名字不同（aspect_ratio / ratio / size / resolution），
   * 故按固定优先序从候选参数里 derive 第一个命中的字符串，而不是硬认某一个键。取不到就省略——
   * 宁可不显示，也不编一个「16:9」出来。
   */
  aspectRatio?: string;
  /** 计划里被勾选的镜数（单镜草稿恒 1）。 */
  shotCount: number;
};

export type ProductionRunSummary = Pick<
  ProductionRun,
  "runId" | "projectId" | "revision" | "status" | "stageId" | "playbook" | "origin" | "budget" | "updatedAt"
> & {
  authoring?: ProductionRun['authoring'];
  /** 计划仍是草稿时的候选摘要；已封存/已提交/无计划的 Run 省略。 */
  draft?: ProductionRunDraftSummary;
  /**
   * 生成计划的**在不在场**两个事实：状态，以及报价卡有没有摆到用户面前。
   *
   * 为什么进列表投影：Agent 拟好、还没出价（`cardHidden`）的草稿，和用户丢掉的计划（`cancelled`），
   * Run 状态都还停在 `draft`——只看 Run 状态，它们就是任务面板里永远「等待开始」的那几行。
   * 判「算不算一个任务」的规则住在渲染层（`isProductionRunTask`），它要的只是这两格。
   */
  /** `cardHidden` 是投影出来的：草稿还没有一次开着的出价（`draftCardHidden`）。 */
  generationPlan?: Pick<ProductionGenerationPlan, "state"> & { cardHidden?: boolean };
};

/**
 * 画布上「重做这一镜」（返工）/「继续剩余」（续拍）没做成的**每一种**原因（2026-09-29）。渲染层按码逐个翻成人话和能做的事
 * （src/workbench/production/productionShotActions.ts 的表，穷尽），主进程原话只进主进程日志。
 *
 * **没有笼统的「操作没成功，稍后再试」**：以前所有失败都落进那一句，前面还拼着主进程英文原话。一个失败说不清是哪一种，
 * 就是它在源头还没被分类——去源头给它一个码，不在界面上兜一句。唯一不细分的是 `internal_error`：Nomi 自己的不变量
 * 没守住（bug），界面如实说「这是 Nomi 的问题、没有扣费、已记日志、可以反馈」，而不是装成一次可以稍后重试的波动。
 */
export type ProductionShotActionFailure =
  | "request_invalid" // 请求里缺批次或镜头编号（画布节点的制作记录不完整）
  | "bridge_unavailable" // 这个窗口连不上桌面端（渲染层调不到主进程）
  | "core_starting" // 生成能力核还在启动
  | "run_not_open" // 不是当前打开的项目
  | "run_missing" // 这一批的制作记录已经不在了
  | "run_unreadable" // 记录读不出来（文件损坏或被占用）
  | "not_multishot" // 不是多镜批次里的镜头（单镜节点就在节点上重新生成）
  | "project_unavailable" // 读不到项目身份（文件夹被移动 / 记录不完整）
  | "confirmation_unavailable" // 这个窗口弹不出付费确认
  | "provider_unavailable" // 这一镜的模型现在接不上供应商
  | "no_prior_attempt" // 这一镜还没生成过
  | "previous_attempt_unsettled" // 上一次还没出结果
  | "attempt_limit" // 重做到上限了
  | "run_changed" // 刚好有别的写入（版本冲突 / 写锁被占 / 状态已变）
  | "approval_stale" // 确认的时候项目刚好有变动（收据对不上当前项目）
  | "approval_expired" // 确认框放太久失效了
  | "run_finished" // 这次制作已经结束（完成 / 取消）
  | "not_stopped" // 这一批没停着，不用继续
  | "plan_not_submitted" // 方案还没开拍
  | "ledger_write_failed" // 写不进项目记录（磁盘满 / 没有写入权限）
  | "canvas_landing_failed" // 没放到画布上，这次没有发出生成请求（先落节点、再发请求）
  | "internal_error"; // Nomi 自己的 bug（不变量断言没过）

/** 返工 / 续拍的结构化结果（appIntegration 编排 → IPC → 渲染层）。declined = 用户在确认框里说了不，不扣费、不报错。 */
export type ProductionShotActionResult =
  | { ok: true; code: "reworked" | "resumed" }
  | { ok: false; code: "rework_declined" }
  | { ok: false; code: "failed"; failure: ProductionShotActionFailure };

/**
 * 付费确认卡（Agent 面板）四个通道的结构化结果（appIntegration 编排 → main.ts IPC → 渲染层给用户人话反馈）。
 * 住在纯类型文件里（不在 appIntegration），这样渲染层 bridge/API 引它时不把 electron 主进程模块图拖进 src 类型检查。
 * 绝不含任何密钥；`code` 由渲染层 t() 翻译（不拼串穿透 i18n 门）。返工 / 续拍有自己的结果类型（ProductionShotActionResult）。
 */
export type ProductionActionResult = {
  quoteId?: string;
  ok: boolean;
  code:
    | "run_not_open" // 该项目不是当前打开的项目（守卫）
    | "revised" // 付费卡上改了参数：旧授权已撤、计划回到草稿等重新封印
    | "discarded" // 付费卡上按了 ×：这份草稿被丢弃
    | "spend_confirmed" // 付费卡上「生成这张」：这一镜的收据已签、门已批、已开跑
    | "shot_removed" // 付费卡上「去掉这张」：这一镜不生成
    | "unavailable" // 能力核未就绪 / provider 未配置
    | "failed"; // 其它失败（账本事实在 message，语义码在 reason）
  /**
   * **账本事实**：这一笔到底有没有发起过。只有两个值有意义——`generation_not_started`
   * （账本里没有任何提交意图，没花钱，改一下再按）与 `generation_execution_failed`
   * （提交意图已落盘，供应商可能已经拿到这一笔，先去核对）。渲染层据它挑那两句话之一。
   */
  message?: string;
  /**
   * **语义码**：到底哪一步不成（`generation_reference_identity_changed` 这一族）。
   *
   * 2026-09-21 分出来的第二个字段。此前这两件事挤在 `message` 一个格子里，于是
   * 「参考图校验失败、一个字节都没出去」这类自家语义码**进不来**——把它写进 `message`
   * 会让渲染层照着挑出「暂时无法确认结果」，比不说更糟（见 Pass 3c 第 4 条「没做的那半」）。
   * 只放 Nomi 自己的码，供应商与凭据文本照旧只进主进程日志。
   */
  reason?: string;
  /**
   * **没发起的那一档是哪一种**（2026-09-30 付费卡① 第 11 条）：窗口弹不出确认、供应商没接好、项目刚变了……
   * 与重做 / 续拍同一个闭集（`productionShotActionFailureOf` 按错误类型认，不读原话），渲染层照它说人话。
   * 只在 `message === "generation_not_started"` 时带；认不出（`internal_error`）时卡上才说「改一下再按」，
   * 而且只在卡确实能改的时候。
   */
  failure?: ProductionShotActionFailure;
  /**
   * 「生成剩下 N 张」跑到一半卡被关掉时才有（付费卡①，2026-10-02）：卡关掉之前批下、照常生成的有几张（`sent`），
   * 没发的有几张（`notSent`）。只由 `confirmRemainingShots` 写；卡上那句「发出了 K 张，剩下 N−K 张没发」只读它。
   */
  batchStopped?: Readonly<{ sent: number; notSent: number }>;
};

export type CreateProductionRunInput = {
  runId?: string;
  projectId: string;
  playbook: { name: string; version: string };
  /** `nodeId`：画布节点发起的 Run（host canvas）的来源节点——先有节点、请求才发出（shotLandingAdmission.landedNodeOf）。 */
  origin: { host: string; actorId?: string; nodeId?: string; sourceDocument?: { documentId: string; revision: number; contentHash: string } };
  brief?: ProductionBrief;
  policy?: Partial<AutomationPolicy>;
  currency?: string;
};

export type Approval = {
  approvalId: string;
  runId: string;
  scope: ProductionGate["scope"];
  planHash: string;
  authorizationDigest?: string;
  receiptId?: string;
  jobIds: string[];
  allowedProviders: string[];
  allowedModels: string[];
  currency: string;
  maxSpend: number;
  maxAttemptsPerJob: number;
  decidedAt: string;
  /**
   * 批准那一刻这道门的决议截止时间（门自己的 `expiresAt` 抄过来，记录用）。**派发不读它**：一镜现在派出去还算不算
   * 同意过，唯一判据是 `productionDispatchConsent`（2026-10-01 付费卡① 第 13 条删掉了出站箱按它再判一次的那道核对）。
   */
  expiresAt: string;
  revokedAt?: string;
};

export type RunEvent = {
  schemaVersion: number;
  eventId: string;
  cursor: number;
  runId: string;
  runRevision: number;
  commandId: string;
  type: string;
  message: string;
  emittedAt: string;
  stageId?: string;
  jobId?: string;
  artifactId?: string;
  causationId?: string;
  correlationId?: string;
  attemptId?: string;
  providerOccurredAt?: string;
  billingEntryId?: string;
  payload?: Record<string, unknown>;
};

export type RunCommand = {
  commandId: string;
  expectedRevision: number;
  type: string;
  payload: Record<string, unknown>;
  issuedAt: string;
  /**
   * 「这条命令来自 Nomi 自己窗口里的真人操作」。**只由主进程装配层自己盖章**——
   * productionRunIpc 在 `assertTrustedSender` 通过之后设，绝不从渲染层传来的 payload 抄，
   * 也不进持久化事件（事件只记 commandId/type）。付费门在没有收据时认它当人证，
   * 见 productionRunApprovalReceipt.ts 的不变量说明。MCP / RPC / Agent 路径永远不设它。
   */
  humanGesture?: true;
};

export type RunCommandResult = {
  run: ProductionRun;
  events: RunEvent[];
};
