export const PRODUCTION_RUN_SCHEMA_VERSION = 1;

export type AutomationMode = "guided" | "balanced" | "policy-auto";

export type AutomationPolicy = {
  mode: AutomationMode;
  trustedHosts: string[];
  allowedProviders: string[];
  allowedModels: string[];
  maxSpend: number | null;
  maxAttemptsPerJob: number;
  minimizeUploads: boolean;
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
  progressPercent?: number;
  lastPollAt?: string;
  lastVendorStateChangeAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
};

export type ProductionArtifact = {
  artifactId: string;
  stageId: string;
  jobId?: string;
  kind: "brief" | "direction" | "script" | "storyboard" | "image" | "video" | "audio" | "timeline" | "export";
  status: "candidate" | "ready" | "adopted" | "rejected";
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
  createdAt: string;
  updatedAt: string;
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
