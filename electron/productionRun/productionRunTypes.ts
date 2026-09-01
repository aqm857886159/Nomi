import type { ProductionExecutionBinding } from "./productionExecutionBinding";
import type { ProductionGenerationAuthorizationEnvelopeV1 } from "./productionGenerationAuthorization";
import type { GenerationProviderTaskState } from "../capabilityCore/generationRuntimeAdapter";
import type { ExecutionContractV1, PlanCandidate } from "../capabilityCore/executionContract";

export const PRODUCTION_RUN_SCHEMA_VERSION = 1;

export type AutomationMode = "guided" | "balanced" | "policy-auto";

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
  mode: AutomationMode;
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
  reserved: number;
  actual: number;
  unsettled: number;
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
  updatedAt: string;
};

export type ProductionGenerationPlan = {
  operationId: string;
  state: "draft" | "sealed" | "cancelled" | "submitted";
  candidate: PlanCandidate;
  contract?: ExecutionContractV1;
  approvedReceiptId?: string;
  approvedAt?: string;
  /** Which explicit submission attempt the latest human receipt authorizes. */
  approvedAttempt?: number;
  /**
   * P4 S1 多镜形态：每镜的草稿 + shot 粒度记账。空/缺省 = 单镜旧形态（走顶层 candidate/contract）。
   * 顶层字段永不删除（老 Run 快照读路径依赖它）；多镜时顶层继续描述「默认镜」以维持向后兼容。
   */
  shots?: ProductionGenerationShot[];
  /** Plan-level hash freezing the whole multi-shot operation (anchor + included shots) at seal time. */
  planHash?: string;
  /**
   * Single-shot canvas landing binding. Multi-shot plans keep this identity on
   * each `shots[]` entry; the top-level field preserves the legacy single-shot
   * shape while still giving the real result a durable node owner.
   */
  nodeId?: string;
  /** A user deletion/undo of the single-shot placeholder must not be silently
   * resurrected by the next reconciliation pass. */
  canvasDetached?: boolean;
  /** Immutable paid submission authority prepared before the human gate. */
  authorizationEnvelope?: ProductionGenerationAuthorizationEnvelopeV1;
  authorizationDigest?: string;
  authorizationGateId?: string;
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
  costScope?: string;
  receiptId?: string;
  requestedSpend?: number;
  jobIds: string[];
  title: string;
  summary: string;
  contract?: ProductionContract;
  /** B1：方向门候选（仅 gate-direction-*）。driver 拟好后 gate.set_candidates 挂上，投影透出。 */
  directionCandidates?: ProductionDirectionCandidate[];
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
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
  origin: { host: string; actorId?: string };
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
  createdAt: string;
  updatedAt: string;
};

export type ProductionRunSummary = Pick<
  ProductionRun,
  "runId" | "projectId" | "revision" | "status" | "stageId" | "playbook" | "origin" | "budget" | "updatedAt"
>;

/**
 * P4 S6：返工/续拍编排的结构化结果（appIntegration 编排 → main.ts IPC → 渲染层给用户人话反馈）。
 * 住在纯类型文件里（不在 appIntegration），这样渲染层 bridge/API 引它时不把 electron 主进程模块图拖进 src 类型检查。
 * 绝不含任何密钥；`code` 由渲染层 t() 翻译（不拼串穿透 i18n 门）。
 */
export type ProductionActionResult = {
  ok: boolean;
  code:
    | "reworked" // 返工已确认并派发
    | "rework_declined" // 用户取消/超时单镜确认 → 不扣费，新 Job 保持未授权
    | "resume_declined" // 用户取消/超时续拍确认 → 不扣费，剩余 Job 不提交
    | "resumed" // 续拍已重启
    | "no_prior_attempt" // 该镜没有可返工的上一次（从没生成过）
    | "run_not_open" // 该项目不是当前打开的项目（守卫）
    | "not_multishot" // 不是语义多镜 Run
    | "unavailable" // 能力核未就绪 / provider 未配置
    | "failed"; // 其它失败（人话原因在 message，供日志）
  message?: string;
};

export type CreateProductionRunInput = {
  runId?: string;
  projectId: string;
  playbook: { name: string; version: string };
  origin: { host: string; actorId?: string };
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
};

export type RunCommandResult = {
  run: ProductionRun;
  events: RunEvent[];
};
