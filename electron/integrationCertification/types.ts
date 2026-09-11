import type { ProfileKind } from "../catalog/types";
import type { FetchTaskResultFn, RunTaskFn } from "../capabilityCore/core";
import type { CertificationMediaEvidence } from "../providerAdapter/certificationMedia";
import type { AdapterVerificationResult } from "../providerAdapter/verifier";
export const CERTIFICATION_LEDGER_VERSION = 3 as const;
export const PROMOTION_JOURNAL_VERSION = 2 as const;
export const CERTIFICATION_SUBMISSION_STATES = ["idle", "submitting", "submitted", "unknown", "settled"] as const;
export const CERTIFICATION_START_TRANSACTION_STATES = ["intent", "run_persisted", "catalog_staged", "committed", "rolled_back"] as const;
export const PROMOTION_JOURNAL_STATES = [
  "prepared",
  "catalog_committing",
  "catalog_committed",
  "committed",
  "aborted",
] as const;
export const PROMOTION_TERMINAL_STAGES = ["completed", "partial"] as const;

/** Provider-declared capability only; Nomi still reconciles uncertainty and never claims remote exactly-once. */
export type RemoteIdempotencyCapability = "supported" | "unsupported" | "unknown";
export type CertificationSubmissionState = typeof CERTIFICATION_SUBMISSION_STATES[number];
export type CertificationStartTransactionState = typeof CERTIFICATION_START_TRANSACTION_STATES[number];
export type CertificationCheckpoint =
  | "prepared"
  | "submitting"
  | "submitted"
  | "submission_unknown"
  | "settled"
  | "promotion_prepared"
  | "promotion_committed"
  | "finalized"
  | "cancelled"
  | "superseded";

export type CertificationChildRunRef = {
  runId: string;
  revisionDigest: string;
};

export type CertificationLease = {
  ownerId: string;
  token: string;
};

export type CertificationSettledResult = {
  ok: boolean;
  taskKind: ProfileKind;
  stage?: Extract<AdapterVerificationResult, { ok: false }>["stage"];
  errorCategory?: "auth" | "balance" | "quota" | "input" | "server" | "network" | "timeout" | "unknown";
  reasonCode?: string;
};

export type CertificationModeOperation = {
  operationKey: string;
  modelKey: string;
  taskKind: ProfileKind;
  attempt: number;
  checkpoint: Extract<CertificationCheckpoint, "prepared" | "submitting" | "submitted" | "submission_unknown" | "settled">;
  providerIdempotency: RemoteIdempotencyCapability;
  submissionState: CertificationSubmissionState;
  remoteTaskId?: string;
  artifactEvidence: CertificationMediaEvidence[];
  settledResult?: CertificationSettledResult;
  userAction?: "reconcile_or_contact_provider";
  createdAt: string;
  updatedAt: string;
};

export type CertificationModeIndex = {
  version: 1;
  modelKey: string;
  taskKind: ProfileKind;
  latestAttempt: number;
  operationKey: string;
};

export type CertificationOperationRecord = {
  version: 3;
  revision: number;
  runId: string;
  contractDigest: string;
  idempotencyHash: string;
  credentialFingerprint?: string;
  catalogIdentityFingerprint?: string;
  customHeaderIdentityFingerprint?: string;
  lineageRootVendorKey: string;
  lease: CertificationLease;
  attempt: number;
  checkpoint: CertificationCheckpoint;
  operationKey?: string;
  providerIdempotency: RemoteIdempotencyCapability;
  submissionState: CertificationSubmissionState;
  remoteTaskId?: string;
  artifactEvidence: CertificationMediaEvidence[];
  settledResult?: CertificationSettledResult;
  modeOperationKeys: Record<string, CertificationModeIndex>;
  modeOperations: Record<string, CertificationModeOperation>;
  childRunRef: CertificationChildRunRef;
  startTransaction: {
    state: CertificationStartTransactionState;
    sourceVendorKey: string;
    stagedVendorKey?: string;
    selectedModels: Array<{ modelKey: string; labelZh: string; kind: "text" | "image" | "video" | "audio" | "model3d" }>;
    createdAt: string;
    updatedAt: string;
  };
  userAction?: "reconcile_or_contact_provider" | "review_newer_certification";
  createdAt: string;
  updatedAt: string;
};

export type CertificationOperationTombstone = {
  version: 1;
  idempotencyHash: string;
  contractDigest: string;
  canonicalRunId: string;
  childRunRef?: CertificationChildRunRef;
  terminalSummary: "finalized" | "cancelled" | "superseded";
  terminalAt: string;
};

export type CertificationArchiveRef = {
  version: 1;
  fileName: string;
  sha256: string;
  count: number;
};

export type CertificationOperationLedgerState = {
  version: 3;
  operations: CertificationOperationRecord[];
  tombstones: CertificationOperationTombstone[];
  archives: CertificationArchiveRef[];
};

export type CertificationContractBinding = {
  contractDigest: string;
  idempotencyKey: string;
  remoteIdempotency: RemoteIdempotencyCapability;
};

export type PromotionJournalStateName = typeof PROMOTION_JOURNAL_STATES[number];
export type PromotionTerminalStage = typeof PROMOTION_TERMINAL_STAGES[number];

export type PromotionJournalEntry = {
  version: 2;
  revision: number;
  journalId: string;
  runId: string;
  lineageRootVendorKey: string;
  leaseToken: string;
  expectedActiveRevision?: string;
  proposedRevisionId: string;
  contractDigest: string;
  verifiedModes: Array<{ modelKey: string; taskKind: ProfileKind }>;
  childRunRef: CertificationChildRunRef;
  terminalStage?: PromotionTerminalStage;
  state: PromotionJournalStateName;
  userAction?: "review_newer_certification";
  runFinalizedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PromotionJournalState = {
  version: 2;
  entries: PromotionJournalEntry[];
  tombstones: Array<{
    version: 1;
    journalId: string;
    runId: string;
    proposedRevisionId: string;
    finalizedAt: string;
  }>;
  archives: CertificationArchiveRef[];
};

/**
 * 本机 ComfyUI 认证真正要用的三样运行时能力。**必填，不许 optional**：
 * 2026-09-11 真机矩阵实锤，它们一旦缺席，`certifyComfy` 照样挂得上去，
 * 「有没有这个能力」的检查全过，真调用才在闭包里炸、还被 catch 洗成
 * `certification_unavailable` —— 整条 ComfyUI 接入链必炸且静默（R28）。
 * 归属层：注册处的**构造期**。缺一样就编译不过，轮不到运行时。
 */
export type ComfyCertificationRuntime = {
  /** Canonical native ComfyUI candidate runner. Supplied by both GUI and stdio. */
  runTask: RunTaskFn;
  fetchTaskResult: FetchTaskResultFn;
  /** Main-process spend authority used after the integration receipt is consumed. */
  mintSpendGrant: (nodeIds: string[], maxAttemptsPerNode?: number) => string;
};
