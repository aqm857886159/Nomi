import type {
  AiSdkProviderKind,
  BillingModelKind,
  HttpOperation,
  ProfileKind,
} from "../catalog/types";
import type {
  CertificationMediaErrorParams,
  CertificationMediaEvidence,
  CertificationMediaReasonCode,
} from "./certificationMedia";
import type {
  CertificationContractBinding,
  CertificationSettledResult,
  CertificationSubmissionState,
} from "../integrationCertification/types";
import type { AdapterRunStage as SharedAdapterRunStage } from "../shared/providerAdapterContract";

export type AdapterAuthType = "none" | "bearer" | "x-api-key" | "query";

export type ProviderAdapterModelSelection = {
  modelKey: string;
  labelZh?: string;
  kind: BillingModelKind;
};

export type ProviderAdapterConnectionInput = {
  /** Electron-main-only identity override for a previously saved connection. */
  catalogVendorKey?: string;
  vendorName: string;
  baseUrl: string;
  apiKey: string;
  authType: AdapterAuthType;
  providerKind?: AiSdkProviderKind;
  authHeader?: string;
  authQueryParam?: string;
  headers?: Record<string, string>;
  models: ProviderAdapterModelSelection[];
};

/** Start-only contract minted by the canonical certification boundary. */
export type ProviderAdapterCertificationInput = ProviderAdapterConnectionInput & {
  certification: CertificationContractBinding;
};

export type ProviderAdapterRegisterInput = ProviderAdapterConnectionInput & {
  /** Main-process-only: retain the saved encrypted credential instead of replacing it. */
  preserveExistingCredential?: boolean;
};

export type ProviderAdapterRegistration = {
  vendorKey: string;
  vendorName: string;
  state: "configured";
  selectedModelKeys: string[];
  models: Array<ProviderAdapterModelSelection & { state: "unverified" }>;
  savedAt: string;
};

export type AdapterSourceEvidence = {
  url: string;
  title?: string;
  evidence: string;
};

export type AdapterModeDraft = {
  taskKind: ProfileKind;
  create: HttpOperation;
  query?: HttpOperation;
  statusMapping?: Record<string, string[]>;
  /** request.params key that receives the local reference fixture during verification. */
  referenceParam?: string;
  referenceShape?: "single" | "array";
  testParams?: Record<string, unknown>;
  sourceUrls: string[];
};

export type AdapterModelDraft = {
  modelKey: string;
  labelZh: string;
  kind: BillingModelKind;
  parameters?: Array<{
    key: string;
    label: string;
    type: "select" | "number" | "text" | "boolean";
    options?: Array<{ value: string; label: string }>;
    default?: string | number | boolean;
    min?: number;
    max?: number;
  }>;
  modes: AdapterModeDraft[];
};

export type ProviderAdapterDraft = {
  provider: {
    baseUrl: string;
    authType: AdapterAuthType;
    authHeader?: string;
    authQueryParam?: string;
    providerKind?: AiSdkProviderKind;
  };
  sources: AdapterSourceEvidence[];
  models: AdapterModelDraft[];
};

export type ProviderAdapterCompileFailure = {
  modelKey: string;
  error: string;
};

export type ProviderAdapterCompilation = {
  draft: ProviderAdapterDraft;
  failures: ProviderAdapterCompileFailure[];
};

export type AdapterRunStage = SharedAdapterRunStage;

export type AdapterModeState = "queued" | "testing" | "repairing" | "verified" | "failed";

export type AdapterModeResult = {
  taskKind: ProfileKind;
  state: AdapterModeState;
  attempts: number;
  stage?: "docs" | "compile" | "localize_reference" | "create" | "poll" | "verify_asset" | "promote";
  error?: string;
  /**
   * 失败归类，抛出点查表得来（vendorHttp：401/403→auth、402→balance、429→quota、400/422→input、5xx→server）。
   * 渲染层据此说人话 + 给对应的下一步动作；**不要在 UI 里用关键词猜**（同型 bug 已反复出现 5 轮，
   * 见 2026-08-12 `fix(errors): 文本侧错误也在源头留住 category`）。
   */
  errorCategory?: "auth" | "balance" | "quota" | "input" | "server" | "network" | "timeout" | "unknown";
  httpStatus?: number;
  verifiedAt?: string;
  /** One bounded, sanitized evidence record for every promoted media asset. */
  mediaEvidence?: CertificationMediaEvidence[];
  reasonCode?: CertificationMediaReasonCode;
  errorParams?: CertificationMediaErrorParams;
  submissionState?: Extract<CertificationSubmissionState, "unknown">;
};

export type AdapterModelResult = {
  modelKey: string;
  labelZh: string;
  kind: BillingModelKind;
  modes: AdapterModeResult[];
};

export type ProviderAdapterRun = {
  id: string;
  vendorKey: string;
  /** Stable family identity shared by root and every candidate revision. */
  lineageRootVendorKey?: string;
  vendorName: string;
  connectionFingerprint: string;
  selectedModelKeys: string[];
  stage: AdapterRunStage;
  currentModelKey?: string;
  completedCount?: number;
  totalCount?: number;
  lastProgressAt?: string;
  stageStartedAt?: string;
  deadlineAt?: string;
  repairAttempt: number;
  models: AdapterModelResult[];
  sourceUrls: string[];
  activeRevision?: string;
  error?: string;
  recovery?: {
    reasonCode: "submission_unknown" | "submission_reconcile_unavailable" | "promotion_commit_unknown" | "certification_start_rolled_back";
    userAction: "reconcile_or_contact_provider" | "restart_certification";
  };
  certificationOperations?: Record<string, {
    operationKey: string;
    submissionState: CertificationSubmissionState;
    settledResult?: CertificationSettledResult;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type ProviderAdapterRevision = {
  id: string;
  vendorKey: string;
  digest: string;
  draft: ProviderAdapterDraft;
  verifiedModes: Array<{ modelKey: string; taskKind: ProfileKind }>;
  createdAt: string;
};

export type ProviderAdapterStoreState = {
  version: 1;
  revision: number;
  runs: ProviderAdapterRun[];
  revisions: ProviderAdapterRevision[];
};

export type AdapterModelMeta = {
  state: "unverified" | "testing" | "verified" | "partial" | "failed";
  runId?: string;
  activeRevision?: string;
  modes: AdapterModeResult[];
  updatedAt: string;
};
