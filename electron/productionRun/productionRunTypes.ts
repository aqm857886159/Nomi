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
  /** Maximum number of independent provider jobs the driver may submit in one wave. */
  maxConcurrentJobs?: number;
  minimizeUploads: boolean;
  /** B3 信任档位。老 run 文件无此字段 → 读作默认 key_confirm（向后兼容）。 */
  trustLevel?: TrustLevel;
};

export function normalizeMaxConcurrentJobs(value: unknown, fallback = 1): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(6, Math.max(1, candidate));
}

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
  scope: "stage" | "job_set" | "budget_envelope" | "export" | "publish";
  status: ProductionGateStatus;
  planHash: string;
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
  kind: "brief" | "direction" | "script" | "storyboard" | "image" | "video" | "audio" | "timeline" | "export";
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
  /** 可恢复的运行阻塞原因；只在 needs_attention 时存在，供 MCP/项目页给出下一步。 */
  attention?: ProductionRunAttention;
  createdAt: string;
  updatedAt: string;
};

export type ProductionRunAttention = {
  code: string;
  message: string;
  operation: string;
  retryable: boolean;
  occurredAt: string;
};

export type ProductionRunSummary = Pick<
  ProductionRun,
  "runId" | "projectId" | "revision" | "status" | "stageId" | "playbook" | "origin" | "budget" | "updatedAt"
>;

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
