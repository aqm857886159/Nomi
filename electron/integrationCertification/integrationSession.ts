import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { capabilityCoreDir, ensureCapabilitySigningKey, type CapabilityOriginHost } from "../capabilityCore/security";
import { createApprovalReceiptAuthority } from "../capabilityCore/approvalReceipt";
import { createProductionRunLock } from "../productionRun/productionRunLock";
import { writeCertificationJsonAtomic } from "./certificationPersistence";
import { ConnectionCertificationService, getConnectionCertificationService } from "./service";
import type {
  AdapterAuthType,
  ProviderAdapterDraft,
  ProviderAdapterModelSelection,
  ProviderAdapterRun,
} from "../providerAdapter/types";
import {
  ADAPTER_CONTRACT_INSTRUCTIONS,
  adapterContractJsonSchema,
} from "../providerAdapter/agentCompileRequest";
import { hasCompilerLanguageModel } from "../providerAdapter/serviceLanguageModels";
import { adapterDraftFromProposal, compileRequestFor } from "./integrationAdapterContract";
import type { ApprovalReceiptAuthority, HumanApprovalReceiptV1 } from "../capabilityCore/approvalReceipt";
import type { IntegrationHandoff } from "./handoffQueue";
import { enqueueIntegrationHandoff, retireIntegrationHandoffs } from "./handoffQueue";
import { mutateCatalog, readCatalog, normalizeProviderKind } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { deriveVendorKeyFromBaseUrl } from "../catalog/catalogCommit";
import type { ProfileKind } from "../catalog/types";
import type { FetchTaskResultFn, RunTaskFn } from "../capabilityCore/core";
import { runComfyCandidateTest } from "../tasks/comfyCandidateTest";
import { isComfyuiVendor, COMFYUI_VENDOR_KEY } from "../catalog/types";
import { OperationLedger } from "./operationLedger";
import type { CertificationOperationRecord } from "./types";
import type { WorkflowBinding, WorkflowEnumOption } from "../catalog/comfyuiWorkflowImport";
import {
  assertRecord,
  rejectWorkflowKeys,
  sanitizeWorkflowBinding,
  sanitizeWorkflowEnumOptions,
  workflowString,
} from "./integrationWorkflowBinding";
import { certificationModeOperationKey } from "./modeIdentity";
import { hardenedFetch, isPrivateHost } from "../hardenedFetch";
import { discoverAndPersistHttpCandidates } from "./httpModelDiscovery";
import { comfyuiHistoryTransform } from "../catalog/comfyuiLocal";
import { candidateRevisionId } from "../catalog/stagedVendorIdentity";
import { promoteCertifiedComfyCandidate, resolveComfyStagedCandidate } from "../catalog/comfyuiCandidateLifecycle";
import { buildComfyCertificationFixtureParams } from "../shared/comfyCertificationFixtures";
import {
  assertIntegrationRevision,
  INTEGRATION_CREDENTIAL_STATUSES,
  INTEGRATION_STAGES,
  INTEGRATION_START_RECEIPT_STATUSES,
  IntegrationRequestError,
  type IntegrationCredentialStatus,
  type IntegrationStage,
  type IntegrationStartReceiptStatus,
} from "../shared/integrationContract";
export type IntegrationKind = "http-api-provider" | "comfyui-workflow";
export type { IntegrationStage } from "../shared/integrationContract";
export type IntegrationUnresolvedField = { key: string; reasonCode: string; candidates?: unknown[] };
export type IntegrationCandidate = {
  modelKey: string;
  label?: string;
  kind: string;
  modes?: string[];
  evidence?: Array<"remote" | "manual" | "docs" | "runtime">;
  classification?: "supported" | "unknown" | "unavailable";
  estimatedCalls?: number;
};
export type IntegrationProposal = {
  candidates?: unknown;
  selections?: unknown;
  workflow?: unknown;
  modelKey?: unknown;
  adapterDraft?: unknown;
};
/**
 * 「Nomi 自己编不动，请你来编」的结构化交底（B 路，见 providerAdapter/agentCompileRequest.ts）。
 * 落盘的只有这几个小字段；目标 schema 与撰写规则是常量，在投影时现加，不占会话文件。
 */
export type IntegrationCompileRequest = {
  schemaVersion: 1;
  reasonCode: "adapter_contract_required";
  field: "proposal.adapterDraft";
  provider: { baseUrl: string; authType: AdapterAuthType; providerKind?: string };
  models: Array<{ modelKey: string; kind: string }>;
  docs: { provided: boolean; bytes: number };
};
export type IntegrationSession = {
  schemaVersion: 1;
  id: string;
  revision: number;
  ownerClientId: CapabilityOriginHost;
  capabilityDigest: string;
  kind: IntegrationKind;
  stage: IntegrationStage;
  configDigest: string;
  credentialStatus: IntegrationCredentialStatus;
  childRunRef?: { runId: string; revisionDigest: string };
  unresolvedFields: IntegrationUnresolvedField[];
  blockingReason?: { code: string; params?: Record<string, string | number> };
  persistenceProof?: { journalId: string; freshProcessBootId: string; catalogRevision: number };
  createdAt: string;
  updatedAt: string;
  config: {
    name: string;
    baseUrl?: string;
    authType?: AdapterAuthType;
    authHeader?: string;
    authQueryParam?: string;
    providerKind?: string;
    docs?: string;
    workflow?: string;
    uiWorkflow?: string;
    workflowBinding?: WorkflowBinding;
    workflowEnumOptions?: WorkflowEnumOption[];
    modelKey?: string;
    clientRequestId?: string;
  };
  candidates: IntegrationCandidate[];
  selections: IntegrationCandidate[];
  credentialRef?: string;
  startIdempotencyKey?: string;
  startReceiptDigest?: string;
  /** Opaque receipt id minted by the trusted UI; never a signed token. */
  pendingReceiptId?: string;
  /** Durable start intent state. `pending` means the session was persisted
   * before receipt consumption and can finish that step after a crash. */
  startReceiptStatus?: IntegrationStartReceiptStatus;
  pendingChallengeId?: string;
  pendingConfirmationKey?: string;
  /** 待驱动 Agent 编译时的交底；收到合法 adapterDraft 后清空。 */
  compileRequest?: IntegrationCompileRequest;
  /** 驱动 Agent 交回并已通过 validateProviderAdapterDraft 的说明卡。 */
  adapterDraft?: ProviderAdapterDraft;
};
/** 花费确认这一跳的对外投影（MCP `nomi_integration action=confirm` 的返回形状）。 */
export type IntegrationConfirmationChallenge = {
  sessionId: string;
  challengeId: string;
  expiresAt: string;
  contractHash: string;
  maximumCost: number;
  currency: string;
  stage: IntegrationStage;
  expectedRevision: number;
  serverTime: string;
  expiresInSeconds: number;
  nextAction: string;
};
export type IntegrationSessionProjection = Omit<
  IntegrationSession,
  "config" | "credentialRef" | "adapterDraft" | "compileRequest"
> & {
  config: Omit<IntegrationSession["config"], "workflow" | "uiWorkflow"> & {
    workflow?: { present: boolean; bytes: number };
    uiWorkflow?: { present: boolean; bytes: number };
  };
  credentialRef?: { status: IntegrationSession["credentialStatus"]; scope: string };
  /** 交底 + 目标 schema + 撰写规则。驱动 Agent 照着它回填 proposal.adapterDraft。 */
  compileRequest?: IntegrationCompileRequest & { contractSchema: Record<string, unknown>; instructions: string };
  adapterDraft?: { present: boolean; modelKeys: string[] };
};
type PersistedState = { version: 1; revision: number; sessions: IntegrationSession[] };
type Dependencies = {
  filePath?: string;
  certification?: ConnectionCertificationService;
  save?: (filePath: string, state: PersistedState) => void;
  certifyComfy?: (
    session: IntegrationSession,
    idempotencyKey: string,
  ) => Promise<{ runId: string; revisionDigest: string; remoteTaskId?: string }>;
  /**
   * The only restart path for a remote ComfyUI submission. The caller gets
   * the durable opaque prompt id, and must reconcile `/history` (and the
   * resulting `/view`/decode/promotion path) without issuing `/prompt`.
   */
  reconcileComfy?: (session: IntegrationSession, idempotencyKey: string, remoteTaskId: string) => Promise<void>;
  /** Canonical native ComfyUI candidate runner. Supplied by both GUI and stdio. */
  runTask?: RunTaskFn;
  fetchTaskResult?: FetchTaskResultFn;
  /** Main-process spend authority used after the integration receipt is consumed. */
  mintSpendGrant?: (nodeIds: string[], maxAttemptsPerNode?: number) => string;
  credentialResolver?: (session: IntegrationSession) => string | undefined;
  /** 「Nomi 自己有没有文本模型可以拿来读文档」。默认问真实 catalog；测试注入布尔。 */
  compilerAvailable?: () => boolean;
  /** Main-process authority for the user-confirmed, signed integration receipt. */
  approvalReceiptAuthority?: Pick<ApprovalReceiptAuthority, "requestChallenge" | "verifyReceipt"> &
    Partial<
      Pick<
        ApprovalReceiptAuthority,
        | "resolveReceiptToken"
        | "resolveChallengeToken"
        | "verifyChallenge"
        | "consumeReceipt"
        | "createMainProcessGestureAttestation"
        | "mintReceipt"
      >
    >;
  /** Durable UI handoff sink. The session service never emits an event-only handoff. */
  enqueueHandoff?: (input: Omit<IntegrationHandoff, "requestId" | "createdAt">) => unknown;
  retireHandoff?: (sessionId: string, target: IntegrationHandoff["target"]) => unknown;
  now?: () => string;
  /** Durable reservation for native ComfyUI certification submissions. */
  comfyOperationLedger?: OperationLedger;
};
/** Runtime wiring used by both GUI RPC and packaged stdio. Keeps secrets in main and
 * injects the same certification/receipt/handoff boundaries into every transport. */
export function createRuntimeIntegrationSessionService(
  input: {
    approvalReceiptAuthority?: Dependencies["approvalReceiptAuthority"];
    certification?: ConnectionCertificationService;
    enqueueHandoff?: Dependencies["enqueueHandoff"];
    save?: Dependencies["save"];
    filePath?: string;
    now?: () => string;
    runTask?: Dependencies["runTask"];
    fetchTaskResult?: Dependencies["fetchTaskResult"];
    mintSpendGrant?: Dependencies["mintSpendGrant"];
    comfyOperationLedger?: Dependencies["comfyOperationLedger"];
  } = {},
): IntegrationSessionService {
  const authority = input.approvalReceiptAuthority || defaultIntegrationReceiptAuthority();
  const certification = input.certification || getConnectionCertificationService();
  // Construct one ledger instance for both the service and its Comfy callback.
  // Capturing the raw optional dependency here would silently disable the
  // submission callback whenever the runtime used the default ledger.
  const comfyOperationLedger =
    input.comfyOperationLedger ||
    new OperationLedger(path.join(capabilityCoreDir(), "integration-comfy-operations.json"));
  const resolveCredential = (session: IntegrationSession): string | undefined => {
    if (session.kind !== "http-api-provider" || !session.config.baseUrl) return undefined;
    const vendorKey = deriveVendorKeyFromBaseUrl(session.config.baseUrl);
    if (!vendorKey) return undefined;
    return decryptApiKeyRecord(readCatalog().apiKeysByVendor[vendorKey]) || undefined;
  };
  const runTask = input.runTask;
  const fetchTaskResult = input.fetchTaskResult;
  const mintSpendGrant = input.mintSpendGrant;
  const comfyBase = (
    session: IntegrationSession,
  ): { baseUrl: string; origin: string; allowedPrivateOrigins: string[] } => {
    const baseUrl = String(session.config.baseUrl || "http://127.0.0.1:8188")
      .trim()
      .replace(/\/+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error("comfy_origin_invalid");
    }
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("comfy_origin_invalid");
    }
    return {
      baseUrl,
      origin: parsed.origin,
      allowedPrivateOrigins: isPrivateHost(parsed.hostname) ? [parsed.origin] : [],
    };
  };
  const readComfyJson = async (session: IntegrationSession, url: string): Promise<unknown> => {
    const target = comfyBase(session);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("comfy_url_invalid");
    }
    if (parsed.origin !== target.origin) throw new Error("comfy_origin_mismatch");
    const fetched = await hardenedFetch(parsed.toString(), {
      allowRedirect: false,
      maxBytes: 8 * 1024 * 1024,
      allowContentTypes: ["application/json", "text/json", "text/plain"],
      ...(target.allowedPrivateOrigins.length ? { allowedPrivateOrigins: target.allowedPrivateOrigins } : {}),
    });
    try {
      return JSON.parse(fetched.bytes.toString("utf8")) as unknown;
    } catch {
      throw new Error("comfy_history_invalid_response");
    }
  };
  const findStagedComfyVendor = (session: IntegrationSession, modelKey: string) => {
    const target = comfyBase(session);
    const catalog = readCatalog();
    return catalog.vendors.find(
      (vendor) =>
        isComfyuiVendor(vendor) &&
        String(vendor.baseUrlHint || "").replace(/\/+$/, "") === target.baseUrl &&
        Boolean(candidateRevisionId(vendor.meta)) &&
        catalog.models.some(
          (model) =>
            model.vendorKey === vendor.key &&
            model.modelKey === modelKey &&
            (model.meta as { adapter?: { state?: unknown } } | undefined)?.adapter?.state === "testing",
        ),
    );
  };
  const reconcileComfy = async (session: IntegrationSession, _idempotencyKey: string, remoteTaskId: string) => {
    const modelKey = String(session.config.modelKey || "").trim();
    if (!modelKey) throw new Error("comfy_recovery_model_missing");
    const stagedVendor = findStagedComfyVendor(session, modelKey);
    if (!stagedVendor) throw new Error("comfy_staged_candidate_missing");
    const analyzed = await (input.certification || getConnectionCertificationService()).analyzeComfyWorkflow(
      session.config.workflow,
      stagedVendor.key,
    );
    if (!analyzed.ok) throw new Error("comfy_workflow_unresolved");
    const prepared = (input.certification || getConnectionCertificationService()).prepareComfyWorkflow({
      workflowText: analyzed.convertedText || String(session.config.workflow || ""),
      binding: session.config.workflowBinding || analyzed.analysis.suggested,
      vendorKey: stagedVendor.key,
      modelKey,
      labelZh: session.config.name,
      ...(session.config.workflowEnumOptions ? { enumOptions: session.config.workflowEnumOptions } : {}),
      ...(session.config.uiWorkflow || analyzed.sourceWorkflowText
        ? { uiWorkflowText: session.config.uiWorkflow || analyzed.sourceWorkflowText }
        : {}),
    });
    const target = comfyBase(session);
    const readHistory = async (promptId: string) => {
      const raw = await readComfyJson(session, `${target.baseUrl}/history/${encodeURIComponent(promptId)}`);
      const normalized = comfyuiHistoryTransform(raw, { baseUrl: target.baseUrl });
      if (normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
        const record = normalized as Record<string, unknown>;
        if (typeof record.error === "string" && record.error.trim())
          return { status: "failed" as const, error: record.error };
        const output = (["image_url", "video_url", "model_url"] as const)
          .map((key) => ({ key, url: record[key] }))
          .find((entry) => typeof entry.url === "string" && entry.url.trim());
        if (output) {
          const contentType =
            output.key === "video_url" ? "video/*" : output.key === "model_url" ? "model/gltf-binary" : "image/*";
          return { status: "succeeded" as const, outputs: [{ url: output.url as string, contentType }] };
        }
      }
      return { status: "queued" as const };
    };
    const readView = async (url: string) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("comfy_view_url_invalid");
      }
      if (parsed.origin !== target.origin) throw new Error("comfy_view_origin_mismatch");
      const fetched = await hardenedFetch(parsed.toString(), {
        allowRedirect: false,
        maxBytes: 25 * 1024 * 1024,
        allowContentTypes: ["image/", "video/", "audio/", "model/", "application/octet-stream"],
        ...(target.allowedPrivateOrigins.length ? { allowedPrivateOrigins: target.allowedPrivateOrigins } : {}),
      });
      return { bytes: fetched.bytes, contentType: fetched.contentType };
    };
    const revisionId = candidateRevisionId(stagedVendor.meta);
    if (!revisionId) throw new Error("comfy_staged_revision_missing");
    const candidate = resolveComfyStagedCandidate({ revisionId, modelKey, taskKind: prepared.imported.taskKind });
    await (input.certification || getConnectionCertificationService()).reconcileComfyProduction(
      prepared,
      remoteTaskId,
      {
        media: {},
        readHistory,
        readView,
        expectedKind: prepared.imported.kind,
        promote: async (evidence) => {
          promoteCertifiedComfyCandidate(candidate, evidence);
        },
      },
    );
  };
  const certifyComfy = async (session: IntegrationSession, idempotencyKey: string) => {
    if (!runTask || !fetchTaskResult || !mintSpendGrant) throw new Error("comfy_certification_unavailable");
    const workflow = session.config.workflow;
    if (!workflow) throw new Error("comfy_workflow_missing");
    // The source vendor is selected from the frozen endpoint, never from an
    // agent-provided arbitrary catalog key. Existing ComfyUI instances are
    // reused; a new local instance gets a stable prefixed key and disabled
    // configuration before its candidate is staged.
    const baseUrl =
      String(session.config.baseUrl || "")
        .trim()
        .replace(/\/+$/, "") || "http://127.0.0.1:8188";
    const catalog = readCatalog();
    const existing = catalog.vendors.find(
      (vendor) => isComfyuiVendor(vendor) && String(vendor.baseUrlHint || "").replace(/\/+$/, "") === baseUrl,
    );
    let sourceVendorKey = existing?.key || COMFYUI_VENDOR_KEY;
    if (
      !existing &&
      catalog.vendors.some(
        (vendor) => vendor.key === sourceVendorKey && String(vendor.baseUrlHint || "").replace(/\/+$/, "") !== baseUrl,
      )
    ) {
      sourceVendorKey = `comfyui-local-${crypto.createHash("sha256").update(baseUrl).digest("hex").slice(0, 10)}`;
    }
    if (!existing) {
      mutateCatalog((tx) => {
        tx.upsertVendor({
          key: sourceVendorKey,
          name: session.config.name || "本地 ComfyUI",
          enabled: false,
          baseUrlHint: baseUrl,
          authType: "none",
        });
      });
    }
    const analyzed = await (input.certification || getConnectionCertificationService()).analyzeComfyWorkflow(
      workflow,
      sourceVendorKey,
    );
    if (!analyzed.ok) throw new Error("comfy_workflow_unresolved");
    const apiWorkflow = analyzed.convertedText || workflow;
    const certification = input.certification || getConnectionCertificationService();
    const stageInput = {
      workflowText: apiWorkflow,
      binding: session.config.workflowBinding || analyzed.analysis.suggested,
      labelZh: session.config.name,
      vendorKey: sourceVendorKey,
      ...(session.config.workflowEnumOptions ? { enumOptions: session.config.workflowEnumOptions } : {}),
      ...(session.config.uiWorkflow || analyzed.sourceWorkflowText
        ? { uiWorkflowText: session.config.uiWorkflow || analyzed.sourceWorkflowText }
        : {}),
    };
    const staged = session.config.modelKey
      ? certification.updateComfyWorkflow({ ...stageInput, modelKey: session.config.modelKey })
      : certification.stageComfyWorkflow(stageInput);
    // Certification must exercise the exact production inputs. Build the
    // normalized binding used by the staged mapping, then inject deterministic
    // per-slot media; an empty request would incorrectly fail image/video
    // workflows in imageEditGuard before /prompt is ever reached.
    const prepared = certification.prepareComfyWorkflow({
      ...stageInput,
      modelKey: staged.modelKey,
    });
    const certificationMedia = buildComfyCertificationFixtureParams({
      vendorKey: staged.vendorKey,
      modelKey: staged.modelKey,
      slots: (prepared.binding.images || []).map((slot) => ({
        paramKey: slot.paramKey,
        label: slot.label,
        mediaKind: slot.mediaKind,
      })),
    });
    const nodeId = `integration-${session.id}-${idempotencyKey}`;
    const grantId = mintSpendGrant([nodeId], 1);
    let operation = comfyOperationLedger.getByIdempotencyKey(`${session.id}:${idempotencyKey}`);
    if (operation && operation.checkpoint === "prepared") {
      const operationKey = certificationModeOperationKey(staged.modelKey, staged.taskKind as ProfileKind, 1);
      operation = comfyOperationLedger.markSubmitting(operation.runId, {
        operationKey,
        modelKey: staged.modelKey,
        taskKind: staged.taskKind as ProfileKind,
        attempt: 1,
        providerIdempotency: "unknown",
        expectedRevision: operation.revision,
        now: (input.now || (() => new Date().toISOString()))(),
      });
    }
    const recordSubmitted = async (remoteTaskId: string) => {
      if (!operation) return;
      const current = comfyOperationLedger.getByRunId(operation.runId);
      if (!current || current.submissionState !== "submitting") return;
      operation = comfyOperationLedger.markSubmitted(operation.runId, {
        operationKey: current.operationKey,
        remoteTaskId,
        expectedRevision: current.revision,
        now: (input.now || (() => new Date().toISOString()))(),
      });
    };
    const result = await runComfyCandidateTest(
      {
        vendor: staged.vendorKey,
        candidate: { revisionId: staged.revisionId, modelKey: staged.modelKey, taskKind: staged.taskKind },
        request: {
          kind: staged.taskKind,
          prompt: "Nomi ComfyUI workflow certification",
          extras: {
            ...certificationMedia,
            modelKey: staged.modelKey,
            modelAlias: staged.modelKey,
            nodeId,
            grantId,
            certifyOutput: true,
            comfyCertificationRevisionId: staged.revisionId,
            integrationSessionId: session.id,
          },
        },
      },
      {
        runTask: async (payload) => (await runTask(payload as never)) as unknown as import("../runtime").TaskResult,
        fetchTaskResult: async (payload) => ({
          vendor: String((payload as { vendor?: unknown }).vendor || staged.vendorKey),
          result: (await fetchTaskResult(payload as never)).result as unknown as import("../runtime").TaskResult,
        }),
        onSubmitted: recordSubmitted,
      },
    );
    if (!result.ok) throw new Error(result.reasonCode || "comfy_certification_failed");
    if (operation) {
      const current = comfyOperationLedger.getByRunId(operation.runId);
      if (current && ["submitted", "submitting"].includes(current.submissionState)) {
        operation = comfyOperationLedger.markSettled(operation.runId, {
          operationKey: current.operationKey,
          expectedRevision: current.revision,
          result: { ok: true, taskKind: staged.taskKind as ProfileKind },
          now: (input.now || (() => new Date().toISOString()))(),
        });
      }
    }
    // The operation ledger owns the canonical contract digest. The catalog
    // revision remains discoverable through the staged candidate, but must not
    // become a second idempotency identity for the same remote submission.
    return {
      runId: staged.revisionId,
      revisionDigest: integrationContractDigest(session, idempotencyKey),
      ...(typeof result.remoteTaskId === "string" ? { remoteTaskId: result.remoteTaskId } : {}),
    };
  };
  return new IntegrationSessionService({
    filePath: input.filePath,
    certification,
    approvalReceiptAuthority: authority,
    enqueueHandoff: input.enqueueHandoff || enqueueIntegrationHandoff,
    retireHandoff: retireIntegrationHandoffs,
    save: input.save,
    now: input.now,
    credentialResolver: resolveCredential,
    runTask,
    fetchTaskResult,
    mintSpendGrant,
    certifyComfy,
    comfyOperationLedger,
    reconcileComfy,
  });
}
/** Install the process-wide runtime instance used by RPC, stdio and trusted UI IPC. */
export function installRuntimeIntegrationSessionService(service: IntegrationSessionService): IntegrationSessionService {
  singleton = service;
  return service;
}
let runtimeReceiptAuthority: ReturnType<typeof createApprovalReceiptAuthority> | null = null;
function defaultIntegrationReceiptAuthority() {
  runtimeReceiptAuthority ||= createApprovalReceiptAuthority({
    filePath: path.join(capabilityCoreDir(), "approval-receipts.json"),
    macKey: ensureCapabilitySigningKey("approval-receipt"),
    storeMacKey: ensureCapabilitySigningKey("approval-receipt-store"),
    keyId: "approval-receipt-v1",
    lock: createProductionRunLock({
      filePath: path.join(capabilityCoreDir(), "semantic-authorities.lock"),
      epochPath: path.join(capabilityCoreDir(), "semantic-authorities.epoch"),
      ownerId: `integration-session-${process.pid}`,
    }),
  });
  return runtimeReceiptAuthority;
}
const MAX_SESSIONS = 100;
const MAX_TEXT = 64 * 1024;
const MAX_WORKFLOW = 2 * 1024 * 1024;
const WRITE_STAGES = new Set<IntegrationStage>([
  ...INTEGRATION_STAGES.filter(
    (stage) => !["certifying", "committing", "completed", "partial", "failed", "cancelled"].includes(stage),
  ),
]);
/**
 * 花费确认这一关的三档（该你 confirm / 等真人点 / 人点完了）。判据从 INTEGRATION_STAGES 派生，
 * 不另立一份成员清单：confirm 只在这一关内有意义，start 只在最后一档放行。
 */
const isSpendGateStage = (stage: IntegrationStage): boolean => stage.includes("confirm");
const TERMINAL = new Set<IntegrationStage>(
  INTEGRATION_STAGES.filter((stage) => ["completed", "partial", "failed", "cancelled"].includes(stage)),
);
const AUTH_TYPES = new Set<AdapterAuthType>(["none", "bearer", "x-api-key", "query"]);
const AUTH_FIELD_NAME = /^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]{0,199}$/;
function digest(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
function text(value: unknown, name: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}
function id(value: unknown, name: string): string {
  const normalized = text(value, name, 160);
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) throw new Error(`Invalid ${name}`);
  return normalized;
}

const PROPOSAL_KINDS = new Set(["text", "image", "video", "audio", "model3d"]);
function proposalRejected(field: string, reason: string, repair: string): never {
  throw new Error(`propose rejected: ${field} ${reason}. ${repair}`);
}
function proposalCandidates(value: unknown): IntegrationCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    proposalRejected("proposal.candidates", "must contain 1 to 100 items", "send the complete candidate page set");
  return value.map((raw, index) => {
    assertRecord(raw);
    try {
      rejectWorkflowKeys(raw, ["modelKey", "kind"], `proposal.candidates[${index}]`);
      const modelKey = id(raw.modelKey, `proposal.candidates[${index}].modelKey`);
      if (typeof raw.kind !== "string" || !PROPOSAL_KINDS.has(raw.kind))
        proposalRejected(`proposal.candidates[${index}].kind`, "is not a supported capability kind", "use text, image, video, audio, or model3d");
      return { modelKey, kind: raw.kind };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("propose rejected:")) throw error;
      proposalRejected(`proposal.candidates[${index}]`, error instanceof Error ? error.message : "is invalid", "correct the candidate object and resubmit");
    }
  });
}
function proposalSelections(value: unknown, candidates: IntegrationCandidate[]): IntegrationCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    proposalRejected("proposal.selections", "must contain 1 to 100 items", "select at least one candidate by modelKey");
  const allowed = new Map(candidates.map((candidate) => [candidate.modelKey, candidate]));
  return value.map((raw, index) => {
    assertRecord(raw);
    rejectWorkflowKeys(raw, ["modelKey"], `proposal.selections[${index}]`);
    const modelKey = id(raw.modelKey, `proposal.selections[${index}].modelKey`);
    const candidate = allowed.get(modelKey);
    if (!candidate) proposalRejected(`proposal.selections[${index}].modelKey`, "does not match proposal.candidates", "select only a candidate included in the same proposal");
    return clone(candidate);
  });
}
function integrationContractDigest(session: IntegrationSession, idempotencyKey: string): string {
  return digest({
    kind: session.kind,
    sessionId: session.id,
    configDigest: session.configDigest,
    selections: session.selections.map(({ modelKey, kind, modes }) => ({ modelKey, kind, modes })),
    idempotencyKey,
  });
}
function safeHandoffOrigin(baseUrl: string): { origin?: string } {
  try {
    const parsed = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return {};
    }
    // handoffQueue performs the authoritative public/private check. Keep a
    // private origin out of the display payload rather than making opening the
    // credentials page fail for a local ComfyUI/provider connection.
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80:")
    )
      return {};
    return { origin: parsed.origin };
  } catch {
    return {};
  }
}

function verifyIntegrationReceipt(
  authority: NonNullable<Dependencies["approvalReceiptAuthority"]>,
  receiptInput: string,
  session: IntegrationSession,
  idempotencyKey: string,
): HumanApprovalReceiptV1 {
  let token = receiptInput;
  try {
    token = authority.resolveReceiptToken ? authority.resolveReceiptToken(receiptInput) : receiptInput;
  } catch {
    // A caller may carry the signed token itself in a trusted UI bridge. It
    // still must pass the authority's signature/registry check below.
  }
  const receipt = authority.verifyReceipt(token);
  const expectedContract = integrationContractDigest(session, idempotencyKey);
  if (
    receipt.contractHash !== expectedContract ||
    receipt.targetHash !== expectedContract ||
    receipt.projectId !== session.id ||
    receipt.runId !== session.id ||
    receipt.gateId !== `integration-certification:${session.id}`
  ) {
    throw new Error("Receipt does not match the integration certification contract");
  }
  return receipt;
}

function integrationReceiptContract(session: IntegrationSession, idempotencyKey: string): string {
  return integrationContractDigest(session, idempotencyKey);
}

/** Convert connector/runtime failures into the closed, localizable reason-code
 * set exposed by the session projection. Never persist upstream error strings. */
function safeCertificationFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (/credential|api.?key|safe.?storage/i.test(code)) return "credential_unavailable";
  if (/balance|billing|payment|insufficient/i.test(code)) return "provider_balance";
  if (/quota|rate.?limit|429/i.test(code)) return "provider_quota";
  if (/workflow|candidate|binding|input|missing_media|prompt_missing/i.test(code)) return "invalid_input";
  if (/timeout|network|fetch|connect|socket/i.test(code)) return "provider_network";
  if (/unavailable|runner/i.test(code)) return "certification_unavailable";
  return "provider_failed";
}
function integrationStageFromAdapterRun(stage: ProviderAdapterRun["stage"]): IntegrationStage {
  if (stage === "completed" || stage === "partial") return stage;
  if (["queued", "discovering_docs", "compiling", "testing", "repairing", "reconciling"].includes(stage))
    return "certifying";
  return "failed";
}

function adapterTerminalReasonCode(stage: ProviderAdapterRun["stage"]): string {
  if (stage === "needs_ai") return "certification_needs_ai";
  if (stage === "timed_out") return "certification_timed_out";
  if (stage === "cancelled") return "certification_cancelled";
  if (stage === "stale") return "certification_stale";
  return "provider_failed";
}

function validateState(raw: unknown): PersistedState {
  assertRecord(raw);
  if (
    raw.version !== 1 ||
    !Number.isSafeInteger(raw.revision) ||
    !Array.isArray(raw.sessions) ||
    raw.sessions.length > MAX_SESSIONS
  )
    throw new Error("Invalid integration session state");
  const stages = new Set<IntegrationStage>(INTEGRATION_STAGES);
  const owners = new Set<CapabilityOriginHost>(["external", "nomi", "claude", "codex", "cursor"]);
  for (const item of raw.sessions) {
    assertRecord(item);
    const allowedKeys = new Set([
      "schemaVersion",
      "id",
      "revision",
      "ownerClientId",
      "capabilityDigest",
      "kind",
      "stage",
      "configDigest",
      "credentialStatus",
      "childRunRef",
      "unresolvedFields",
      "blockingReason",
      "persistenceProof",
      "createdAt",
      "updatedAt",
      "config",
      "candidates",
      "selections",
      "credentialRef",
      "startIdempotencyKey",
      "startReceiptDigest",
      "pendingReceiptId",
      "startReceiptStatus",
      "pendingChallengeId",
      "pendingConfirmationKey",
      "compileRequest",
      "adapterDraft",
    ]);
    const unknown = Object.keys(item).find((key) => !allowedKeys.has(key));
    if (unknown) throw new Error(`Invalid integration session field: ${unknown}`);
    if (
      item.schemaVersion !== 1 ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9._-]+$/.test(item.id) ||
      !Number.isSafeInteger(item.revision) ||
      !owners.has(item.ownerClientId as CapabilityOriginHost) ||
      !stages.has(item.stage as IntegrationStage) ||
      !Array.isArray(item.unresolvedFields) ||
      !Array.isArray(item.candidates) ||
      !Array.isArray(item.selections) ||
      !item.config ||
      typeof item.config !== "object" ||
      !INTEGRATION_CREDENTIAL_STATUSES.includes(item.credentialStatus as IntegrationCredentialStatus) ||
      (item.startReceiptStatus !== undefined &&
        !INTEGRATION_START_RECEIPT_STATUSES.includes(item.startReceiptStatus as IntegrationStartReceiptStatus))
    )
      throw new Error("Invalid integration session record");
  }
  return { version: 1, revision: Number(raw.revision), sessions: raw.sessions as IntegrationSession[] };
}

export class IntegrationSessionService {
  private state: PersistedState;
  private readonly filePath: string;
  private readonly certification: ConnectionCertificationService;
  private readonly save: (filePath: string, state: PersistedState) => void;
  constructor(private readonly deps: Dependencies = {}) {
    this.filePath = deps.filePath || path.join(capabilityCoreDir(), "integration-sessions.json");
    this.certification = deps.certification || getConnectionCertificationService();
    this.save = deps.save || writeCertificationJsonAtomic;
    this.state = this.read();
  }
  private read(): PersistedState {
    if (!fs.existsSync(this.filePath)) return { version: 1, revision: 0, sessions: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch {
      throw new Error("Integration session storage is corrupt");
    }
    return validateState(raw);
  }
  private persist(): void {
    this.save(this.filePath, this.state);
  }
  /**
   * A submitted ComfyUI prompt is never safe to create again. When a durable
   * prompt id exists, give the injected production reconciler exactly that id
   * and promote only after it has completed its history/view/decode work.
   */
  private async recoverComfyOperation(
    session: IntegrationSession,
    idempotencyKey: string,
    operation: CertificationOperationRecord | undefined,
  ): Promise<boolean> {
    if (!operation || !this.deps.comfyOperationLedger || !this.deps.reconcileComfy) return false;
    const mode = Object.values(operation.modeOperations).find(
      (candidate) =>
        (candidate.submissionState === "submitted" || candidate.submissionState === "unknown") &&
        Boolean(candidate.remoteTaskId),
    );
    if (!mode?.remoteTaskId) return false;

    // The staged model key is part of the durable operation contract. Restore it
    // into the in-memory session before the runtime reconciler rebuilds the
    // prepared workflow; projections never expose workflow or credential data.
    if (!session.config.modelKey || session.config.modelKey !== mode.modelKey) {
      session.config.modelKey = mode.modelKey;
      session.configDigest = digest(session.config);
    }
    let current = operation;
    if (mode.submissionState === "unknown") {
      current = this.deps.comfyOperationLedger.markReconciled(current.runId, {
        operationKey: mode.operationKey,
        remoteTaskId: mode.remoteTaskId,
        expectedRevision: current.revision,
        now: (this.deps.now || (() => new Date().toISOString()))(),
      });
    }
    await this.deps.reconcileComfy(session, idempotencyKey, mode.remoteTaskId);
    current = this.deps.comfyOperationLedger.getByRunId(current.runId) || current;
    const settledMode = current.modeOperations[mode.operationKey];
    if (settledMode?.submissionState === "submitted") {
      current = this.deps.comfyOperationLedger.markSettled(current.runId, {
        operationKey: settledMode.operationKey,
        expectedRevision: current.revision,
        result: { ok: true, taskKind: settledMode.taskKind },
        now: (this.deps.now || (() => new Date().toISOString()))(),
      });
    }
    if (current.checkpoint !== "finalized") {
      current = this.deps.comfyOperationLedger.markCheckpoint(current.runId, {
        checkpoint: "finalized",
        expectedRevision: current.revision,
        now: (this.deps.now || (() => new Date().toISOString()))(),
      });
    }
    session.childRunRef = current.childRunRef;
    session.stage = "completed";
    session.blockingReason = undefined;
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    return true;
  }
  private getOrThrow(sessionId: unknown): IntegrationSession {
    const found = this.state.sessions.find((entry) => entry.id === id(sessionId, "sessionId"));
    if (!found)
      throw new IntegrationRequestError(
        "integration_session_not_found",
        "Integration session not found. List the open sessions with nomi_read target=integration (no sessionId) instead of guessing an id",
      );
    return found;
  }
  private mutate(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    fn: (session: IntegrationSession) => void,
  ): IntegrationSessionProjection {
    const session = this.getOrThrow(sessionId);
    if (session.ownerClientId !== owner) throw new IntegrationRequestError("integration_owner_mismatch", "Integration session belongs to a different signed client");
    assertIntegrationRevision(expectedRevision, session.revision);
    if (!WRITE_STAGES.has(session.stage))
      throw new IntegrationRequestError(
        "integration_stage_not_allowed",
        `Integration session stage "${session.stage}" does not allow this action`,
        { stage: session.stage },
      );
    fn(session);
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    return this.projection(session);
  }
  projection(session: IntegrationSession): IntegrationSessionProjection {
    const rawConfig = { ...session.config };
    const workflow = rawConfig.workflow;
    const uiWorkflow = rawConfig.uiWorkflow;
    const config: Omit<IntegrationSession["config"], "workflow" | "uiWorkflow"> = {
      name: rawConfig.name,
      ...(rawConfig.baseUrl ? { baseUrl: rawConfig.baseUrl } : {}),
      ...(rawConfig.authType ? { authType: rawConfig.authType } : {}),
      ...(rawConfig.authHeader ? { authHeader: rawConfig.authHeader } : {}),
      ...(rawConfig.authQueryParam ? { authQueryParam: rawConfig.authQueryParam } : {}),
      ...(rawConfig.providerKind ? { providerKind: rawConfig.providerKind } : {}),
      ...(rawConfig.docs ? { docs: rawConfig.docs } : {}),
      ...(rawConfig.workflowBinding ? { workflowBinding: clone(rawConfig.workflowBinding) } : {}),
      ...(rawConfig.workflowEnumOptions ? { workflowEnumOptions: clone(rawConfig.workflowEnumOptions) } : {}),
      ...(rawConfig.modelKey ? { modelKey: rawConfig.modelKey } : {}),
    };
    const {
      config: _rawConfig,
      credentialRef: _rawCredential,
      adapterDraft: rawDraft,
      compileRequest: rawCompileRequest,
      ...safeSession
    } = clone(session);
    return {
      ...safeSession,
      // 目标 schema 与撰写规则是进程常量，投影时现加：落盘一份等于给每个会话复制一份大 JSON，
      // 而且升级后盘上那份就成了过期的第二真相。
      ...(rawCompileRequest
        ? {
            compileRequest: {
              ...rawCompileRequest,
              contractSchema: adapterContractJsonSchema(),
              instructions: ADAPTER_CONTRACT_INSTRUCTIONS,
            },
          }
        : {}),
      ...(rawDraft
        ? { adapterDraft: { present: true, modelKeys: rawDraft.models.map((model) => model.modelKey) } }
        : {}),
      config: {
        ...config,
        ...(workflow !== undefined ? { workflow: { present: true, bytes: Buffer.byteLength(workflow, "utf8") } } : {}),
        ...(uiWorkflow !== undefined
          ? { uiWorkflow: { present: true, bytes: Buffer.byteLength(uiWorkflow, "utf8") } }
          : {}),
      },
      ...(session.credentialRef ? { credentialRef: { status: session.credentialStatus, scope: "session" } } : {}),
    };
  }
  private syncHttpCertification(session: IntegrationSession): void {
    if (
      session.kind !== "http-api-provider" ||
      !session.childRunRef ||
      (session.stage !== "certifying" && session.stage !== "committing")
    )
      return;
    const run = this.certification.get(session.childRunRef.runId);
    if (!run) return;
    const nextStage = integrationStageFromAdapterRun(run.stage);
    if (nextStage === session.stage) return;
    session.stage = nextStage;
    session.blockingReason = nextStage === "failed" ? { code: adapterTerminalReasonCode(run.stage) } : undefined;
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
  }
  get(sessionId: unknown, owner?: CapabilityOriginHost): IntegrationSessionProjection {
    const session = this.getOrThrow(sessionId);
    if (owner && session.ownerClientId !== owner) throw new IntegrationRequestError("integration_owner_mismatch", "Integration session belongs to a different signed client");
    this.syncHttpCertification(session);
    return this.projection(session);
  }
  /**
   * 列出本客户端的接入会话，未完成的排前面。
   *
   * 为什么必须有它：修复前 `nomi_read target=integration` 不带 sessionId 直接报错，而 MCP 面上
   * 没有第二条路——实测里 agent 是靠 shell 去盘上 grep 我们的日志才把 sessionId 找回来的。
   * 「上下文一丢就没法接着做」不是模型的问题，是我们没给回家的路。
   */
  list(owner: CapabilityOriginHost, limit = 20): { sessions: IntegrationSessionProjection[] } {
    const mine = this.state.sessions.filter((entry) => entry.ownerClientId === owner);
    const ranked = [...mine].sort((left, right) => {
      const openness = Number(TERMINAL.has(left.stage)) - Number(TERMINAL.has(right.stage));
      if (openness !== 0) return openness;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
    return { sessions: ranked.slice(0, limit).map((entry) => this.get(entry.id, owner)) };
  }

  /** 同一个接入目标的未完成会话（同 owner + 同 kind + 同 baseUrl）。 */
  private resumableFor(
    owner: CapabilityOriginHost,
    kind: IntegrationKind,
    baseUrl: string | undefined,
  ): IntegrationSession | undefined {
    if (!baseUrl) return undefined;
    return this.state.sessions.find(
      (entry) =>
        entry.ownerClientId === owner &&
        entry.kind === kind &&
        !TERMINAL.has(entry.stage) &&
        String(entry.config.baseUrl || "").replace(/\/+$/, "") === baseUrl,
    );
  }

  begin(
    input: {
      kind: IntegrationKind;
      name: string;
      sessionId?: string;
      baseUrl?: string;
      docs?: string;
      clientRequestId?: string;
      authType?: AdapterAuthType;
      authHeader?: string;
      authQueryParam?: string;
      providerKind?: string;
    },
    owner: CapabilityOriginHost,
  ): IntegrationSessionProjection {
    if (owner === "external") throw new Error("Signed client identity is required");
    // 带 sessionId 的 begin 是「接着上次做」，不是「再开一个」。修复前它照样新建，
    // 于是同一个 baseUrl 冒出第二个会话，并且报 credentialStatus: missing——
    // 用户会被要求把已经存过的 key 再填一遍。
    if (input.sessionId !== undefined) return this.get(input.sessionId, owner);
    if (input.clientRequestId) {
      const existing = this.state.sessions.find((entry) => entry.config.clientRequestId === input.clientRequestId);
      if (existing) return this.projection(existing);
    }
    if (input.kind !== "http-api-provider" && input.kind !== "comfyui-workflow")
      throw new Error("Invalid integration kind");
    const name = text(input.name, "name", 240);
    const baseUrl = input.baseUrl ? text(input.baseUrl, "baseUrl", 2_000).replace(/\/+$/, "") : undefined;
    if (input.kind === "http-api-provider" && !baseUrl) throw new Error("baseUrl is required");
    if (input.authType !== undefined && !AUTH_TYPES.has(input.authType)) throw new Error("Invalid authType");
    const authField = (value: string | undefined, field: string): string | undefined => {
      if (value === undefined) return undefined;
      const normalized = text(value, field, 200);
      if (!AUTH_FIELD_NAME.test(normalized)) throw new Error(`Invalid ${field}`);
      return normalized;
    };
    const resumable = this.resumableFor(owner, input.kind, baseUrl);
    if (resumable) return this.get(resumable.id, owner);
    const timestamp = (this.deps.now || (() => new Date().toISOString()))();
    const config = {
      name,
      ...(baseUrl ? { baseUrl } : {}),
      ...(input.authType ? { authType: input.authType } : {}),
      ...(authField(input.authHeader, "authHeader") ? { authHeader: authField(input.authHeader, "authHeader") } : {}),
      ...(authField(input.authQueryParam, "authQueryParam")
        ? { authQueryParam: authField(input.authQueryParam, "authQueryParam") }
        : {}),
      ...(input.providerKind ? { providerKind: text(input.providerKind, "providerKind", 80) } : {}),
      ...(input.docs ? { docs: text(input.docs, "docs") } : {}),
      ...(input.clientRequestId ? { clientRequestId: text(input.clientRequestId, "clientRequestId", 200) } : {}),
    };
    const session: IntegrationSession = {
      schemaVersion: 1,
      id: `integration-${crypto.randomUUID()}`,
      revision: 1,
      ownerClientId: owner,
      capabilityDigest: digest({ owner, kind: input.kind }),
      kind: input.kind,
      stage: "draft",
      configDigest: digest(config),
      credentialStatus: "missing",
      unresolvedFields: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      config,
      candidates: [],
      selections: [],
    };
    // 这个 baseUrl 的 key 可能早就在 Nomi 的安全存储里（用户上次接入时存的，或在设置页手动存的）。
    // 报 missing 等于让用户再填一遍已经填过的东西；这里如实读一次既有凭据边界，不新增第二份真相。
    const credentialReady =
      input.kind === "http-api-provider" && Boolean(this.deps.credentialResolver?.(session));
    if (credentialReady) {
      session.credentialStatus = "ready";
    } else if (input.kind === "http-api-provider") {
      session.stage = "needs_credential";
    }
    this.state.sessions.push(session);
    this.state.revision += 1;
    this.persist();
    return this.projection(session);
  }
  openCredentials(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
  ): IntegrationSessionProjection {
    const result = this.mutate(sessionId, expectedRevision, owner, (session) => {
      session.stage = "needs_credential";
      session.credentialStatus = "missing";
      session.blockingReason = { code: "credential_required" };
    });
    const session = this.getOrThrow(sessionId);
    this.deps.enqueueHandoff?.({
      target: "credential",
      sessionId: session.id,
      revision: session.revision,
      ownerClientId: session.ownerClientId,
      display: {
        name: session.config.name,
        ...(session.config.baseUrl ? safeHandoffOrigin(session.config.baseUrl) : {}),
        ...(session.config.authType ? { authType: session.config.authType } : {}),
      },
    });
    return result;
  }
  markCredentialReady(sessionId: string, credentialRef: string, owner: CapabilityOriginHost): IntegrationSessionProjection {
    const session = this.getOrThrow(sessionId);
    if (session.ownerClientId !== owner || owner === "external") throw new Error("Signed client identity is required");
    session.credentialRef = id(credentialRef, "credentialRef");
    session.credentialStatus = "ready";
    session.stage = "draft";
    return this.commitCredentialReady(session);
  }
  /** Shared tail of both credential-ready writes. The "type a key" handoff is retired only after the write is on disk. */
  private commitCredentialReady(session: IntegrationSession): IntegrationSessionProjection {
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    this.deps.retireHandoff?.(session.id, "credential");
    return this.projection(session);
  }

  /** Trusted UI credential write. The secret never enters a projection or the MCP layer. */
  saveCredential(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    apiKey: unknown,
  ): IntegrationSessionProjection {
    const session = this.getOrThrow(sessionId);
    if ((session.ownerClientId !== owner && owner !== "nomi") || owner === "external")
      throw new Error("Signed client identity is required");
    assertIntegrationRevision(expectedRevision, session.revision);
    if (session.kind !== "http-api-provider" || !session.config.baseUrl)
      throw new Error("Credential is only valid for an HTTP provider");
    const clean = text(apiKey, "apiKey", 8 * 1024);
    const vendorKey = deriveVendorKeyFromBaseUrl(session.config.baseUrl);
    if (!vendorKey) throw new Error("Unable to derive a provider id from the API base URL");
    const existing = readCatalog().vendors.find((vendor) => vendor.key === vendorKey);
    // A credential write creates only a disabled/configured vendor. Promotion by the
    // canonical certification run is the sole path that can make it selectable.
    // Vendor metadata and encrypted credential are one Catalog transaction. A
    // failed safeStorage encryption or validation therefore cannot leave a
    // half-created vendor behind for a later run to mistake as configured.
    mutateCatalog((tx) => {
      tx.upsertVendor({
        key: vendorKey,
        name: session.config.name,
        // Credential entry is staging only. Even when this vendor already
        // exists, saving a new key must not publish or re-enable it; only the
        // canonical certification promotion may do that.
        enabled: false,
        baseUrlHint: session.config.baseUrl,
        authType: session.config.authType || existing?.authType || "bearer",
        ...(session.config.authHeader ? { authHeader: session.config.authHeader } : {}),
        ...(session.config.authQueryParam ? { authQueryParam: session.config.authQueryParam } : {}),
        providerKind: normalizeProviderKind(session.config.providerKind || existing?.providerKind),
      });
      tx.upsertApiKey(vendorKey, { apiKey: clean, enabled: true });
    });
    session.credentialRef = `catalog:${vendorKey}`;
    session.credentialStatus = "ready";
    session.stage = "draft";
    session.blockingReason = undefined;
    return this.commitCredentialReady(session);
  }
  async propose(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    rawProposal: unknown,
  ): Promise<IntegrationSessionProjection> {
    if (!rawProposal || typeof rawProposal !== "object" || Array.isArray(rawProposal))
      proposalRejected("proposal", "is required and must be an object", "send candidates and selections for HTTP, or workflow for ComfyUI");
    assertRecord(rawProposal);
    rejectWorkflowKeys(rawProposal, ["candidates", "selections", "workflow", "modelKey", "adapterDraft"], "proposal");
    const session = this.getOrThrow(sessionId);
    if (session.kind === "http-api-provider") {
      if (session.credentialStatus !== "ready")
        proposalRejected("proposal", "cannot be accepted before the credential is ready", "call open_credentials and save the key in Nomi's secure page first");
      if (rawProposal.workflow !== undefined || rawProposal.modelKey !== undefined)
        proposalRejected("proposal", "contains ComfyUI-only fields for an HTTP provider", "send candidates and selections only");
      if (rawProposal.candidates === undefined && rawProposal.selections === undefined)
        return discoverAndPersistHttpCandidates({ session, owner, expectedRevision, certification: this.certification, credentialResolver: this.deps.credentialResolver, now: this.deps.now || (() => new Date().toISOString()), persist: () => { this.state.revision += 1; this.persist(); }, project: () => this.projection(session) });
      const candidates = proposalCandidates(rawProposal.candidates);
      const keys = new Set<string>();
      for (const candidate of candidates) {
        if (keys.has(candidate.modelKey)) proposalRejected("proposal.candidates.modelKey", "contains a duplicate", "send each modelKey once");
        keys.add(candidate.modelKey);
      }
      const selections = proposalSelections(rawProposal.selections, candidates);
      const draft = adapterDraftFromProposal(session, selections, rawProposal.adapterDraft);
      // Nomi 编不动 + 外部也没交说明卡 → 不假装能编，也不判死：停在 needs_input，
      // 把「要什么形状、锁死了哪些身份、按什么规则写」交回给驱动 Agent（B 路）。
      const compileRequest = draft
        ? undefined
        : compileRequestFor(session, selections, this.deps.compilerAvailable || hasCompilerLanguageModel);
      return this.mutate(sessionId, expectedRevision, owner, (current) => {
        current.candidates = clone(candidates);
        current.selections = clone(selections);
        current.adapterDraft = draft ? clone(draft) : undefined;
        current.compileRequest = compileRequest;
        current.unresolvedFields = compileRequest
          ? [{ key: "proposal.adapterDraft", reasonCode: compileRequest.reasonCode }]
          : [];
        current.stage = compileRequest ? "needs_input" : "needs_spend_confirmation";
      });
    }
    if (rawProposal.candidates !== undefined || rawProposal.selections !== undefined || rawProposal.adapterDraft !== undefined)
      proposalRejected("proposal", "contains HTTP-only fields for a ComfyUI workflow", "send workflow and optionally modelKey only");
    const workflow = text(rawProposal.workflow, "proposal.workflow", MAX_WORKFLOW);
    const modelKey = rawProposal.modelKey === undefined ? undefined : id(rawProposal.modelKey, "proposal.modelKey");
    let analyzed: Awaited<ReturnType<ConnectionCertificationService["analyzeComfyWorkflow"]>>;
    try {
      analyzed = await this.certification.analyzeComfyWorkflow(workflow);
    } catch (error) {
      proposalRejected("proposal.workflow", "could not be analyzed", `fix the workflow JSON and retry (${error instanceof Error ? error.message.slice(0, 240) : "invalid workflow"})`);
    }
    if (!analyzed.ok)
      proposalRejected("proposal.workflow", "was rejected by the ComfyUI analyzer", "send an API-format workflow with a usable output node");
    return this.mutate(sessionId, expectedRevision, owner, (current) => {
      current.config.workflow = analyzed.convertedText || workflow;
      current.config.workflowBinding = analyzed.analysis.suggested;
      if (modelKey) current.config.modelKey = modelKey;
      current.configDigest = digest(current.config);
      current.candidates = [];
      current.selections = [];
      current.unresolvedFields = [];
      current.stage = "needs_spend_confirmation";
    });
  }

  /**
   * Create the signed, immutable confirmation challenge consumed by the trusted Nomi UI.
   *
   * 幂等契约（2026-09-10 真实宿主实测的直接产物）：一旦挑战签发出去，会话就进入
   * `awaiting_human_confirmation`，**再调 confirm 只会原样返回当前挑战**，不重签、不作废
   * 人刚才那次点击。修复前它是「后写覆盖」：Agent 每回合再确认一次就把人的点击洗掉，
   * 于是人点三次全是白点。Stripe 的 idempotency key 语义也是「重放返回同一结果」而不是
   * 「重放作废上一次」（https://docs.stripe.com/api/idempotent_requests）。
   */
  requestConfirmation(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    idempotencyKey: string,
  ): IntegrationConfirmationChallenge {
    const session = this.getOrThrow(sessionId);
    if (session.ownerClientId !== owner || owner === "external") throw new Error("Signed client identity is required");
    assertIntegrationRevision(expectedRevision, session.revision);
    if (!isSpendGateStage(session.stage))
      throw new IntegrationRequestError(
        "integration_stage_not_allowed",
        `Integration session stage "${session.stage}" is not the spend-confirmation gate`,
        { stage: session.stage },
      );
    const key = text(idempotencyKey, "idempotencyKey", 200);
    const authority = this.deps.approvalReceiptAuthority;
    if (!authority) throw new Error("Integration approval is unavailable");
    const nowIso = (this.deps.now || (() => new Date().toISOString()))();
    // 人已经点完了：不碰挑战，直接告诉 Agent「该 start 了」，并给出收据自己的到期时间。
    if (session.stage === "human_confirmed" && session.pendingReceiptId) {
      let receiptExpiresAt = "";
      try {
        if (authority.resolveReceiptToken) {
          receiptExpiresAt = authority.verifyReceipt(authority.resolveReceiptToken(session.pendingReceiptId)).expiresAt;
        }
      } catch {
        // 收据过期/已消费由 start 自己报，这里不把读取失败伪装成「还没确认」。
      }
      return this.confirmationProjection(session, {
        challengeId: session.pendingChallengeId || "",
        expiresAt: receiptExpiresAt,
        contractHash: integrationReceiptContract(session, session.pendingConfirmationKey || key),
        maximumCost: session.kind === "comfyui-workflow" ? 1 : session.selections.length,
        currency: "USD",
        now: nowIso,
      });
    }
    if (
      session.stage === "awaiting_human_confirmation" &&
      session.pendingChallengeId &&
      authority.resolveChallengeToken &&
      authority.verifyChallenge
    ) {
      try {
        const existing = authority.verifyChallenge(authority.resolveChallengeToken(session.pendingChallengeId));
        return this.confirmationProjection(session, {
          challengeId: existing.challengeId,
          expiresAt: existing.expiresAt,
          contractHash: existing.contractHash,
          maximumCost: existing.reservationPreview.maximum,
          currency: existing.reservationPreview.currency,
          now: nowIso,
        });
      } catch {
        // An expired or corrupt challenge is replaced below. The replacement
        // keeps the same challenge key, so the authority remains idempotent.
      }
    }
    // 只有「还没有活挑战」才会走到这里：首次 confirm，或上一枚挑战已经过期。
    // 过期重签必须沿用原来的确认键，否则合同哈希会变，人上一次看到的报价就对不上了。
    const effectiveKey = session.stage === "awaiting_human_confirmation" && session.pendingConfirmationKey
      ? session.pendingConfirmationKey
      : key;
    const contractHash = integrationReceiptContract(session, effectiveKey);
    const challenge = authority.requestChallenge({
      challengeKey: `integration:${session.id}:${effectiveKey}`,
      immutableProjectUuid: session.id,
      projectGeneration: 1,
      projectId: session.id,
      runId: session.id,
      gateId: `integration-certification:${session.id}`,
      contractHash,
      targetHash: contractHash,
      projectRevision: session.revision,
      costScope: "integration.certification",
      pricingSnapshotHash: contractHash,
      reservationPreview: {
        currency: "USD",
        maximum: session.kind === "comfyui-workflow" ? 1 : session.selections.length,
      },
      display: {
        // ComfyUI sessions certify a workflow rather than discovered model
        // selections. The approval contract still requires a non-empty model
        // display field, so use the user-visible workflow name as its safe
        // summary instead of emitting an invalid empty value.
        model: (session.selections.length
          ? session.selections.map((item) => item.modelKey).join(", ")
          : session.config.name || "ComfyUI workflow").slice(0, 480),
        shotSummary:
          session.kind === "comfyui-workflow"
            ? "1 ComfyUI workflow certification run"
            : `${session.selections.length} model certification run`,
      },
    });
    this.deps.enqueueHandoff?.({
      target: "verification",
      sessionId: session.id,
      revision: session.revision,
      ownerClientId: session.ownerClientId,
      display: {
        name: session.config.name,
        ...(session.config.baseUrl ? safeHandoffOrigin(session.config.baseUrl) : {}),
        challengeId: challenge.challenge.challengeId,
      },
    });
    session.pendingChallengeId = challenge.challenge.challengeId;
    session.pendingConfirmationKey = effectiveKey;
    // 从「该你调 confirm」推进到「等真人点」。这一档存在的全部意义就是让 Agent 分得清
    // 「等人」和「人点完了」——它以前分不清，于是选择了最坏的一种：再 confirm 一次。
    session.stage = "awaiting_human_confirmation";
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    return this.confirmationProjection(session, {
      challengeId: challenge.challenge.challengeId,
      expiresAt: challenge.challenge.expiresAt,
      contractHash,
      maximumCost: challenge.challenge.reservationPreview.maximum,
      currency: challenge.challenge.reservationPreview.currency,
      now: (this.deps.now || (() => new Date().toISOString()))(),
    });
  }

  /**
   * 花费确认的对外投影。除了挑战本身，额外给三样模型真正用得上的东西：
   *   · `stage` / `nextAction`：这一跳之后到底该谁动（实测里两个回合都在这里选错）
   *   · `serverTime` + `expiresInSeconds`：相对量。只给绝对 UTC 等于让 LLM 做它最不擅长的
   *     时间比较——实测里 agent 拿自己「今天是 09-11」的认知比出「已过期」并停下，其实还有 5 分钟。
   *   · `expectedRevision`：下一跳该传的值，省掉一次重读。
   */
  private confirmationProjection(
    session: IntegrationSession,
    input: {
      challengeId: string;
      expiresAt: string;
      contractHash: string;
      maximumCost: number;
      currency: string;
      now: string;
    },
  ): IntegrationConfirmationChallenge {
    const remaining = Number.isFinite(Date.parse(input.expiresAt))
      ? Math.max(0, Math.round((Date.parse(input.expiresAt) - Date.parse(input.now)) / 1000))
      : 0;
    return {
      sessionId: session.id,
      challengeId: input.challengeId,
      expiresAt: input.expiresAt,
      contractHash: input.contractHash,
      maximumCost: input.maximumCost,
      currency: input.currency,
      stage: session.stage,
      expectedRevision: session.revision,
      serverTime: input.now,
      expiresInSeconds: remaining,
      nextAction:
        session.stage === "human_confirmed"
          ? "call nomi_integration action=start with this sessionId and expectedRevision"
          : "wait for the person to approve in Nomi, then poll nomi_read target=integration; do NOT call confirm again",
    };
  }

  /** Trusted UI confirms the immutable contract and mints the receipt handle
   * that the owning MCP client can consume on its next start call. */
  confirmFromTrustedUi(input: {
    sessionId: string;
    expectedRevision: number;
    challengeId: string;
    webContentsId: number;
    frameId: number;
    origin: string;
  }): IntegrationSessionProjection {
    const session = this.getOrThrow(input.sessionId);
    assertIntegrationRevision(input.expectedRevision, session.revision);
    // `needs_spend_confirmation` 仍被接受：本版本之前落盘、正卡在这一关的会话读出来就是那一档，
    // 不能因为词表变细就让人点不动它（老数据不是并行代码路径）。
    if (session.stage !== "awaiting_human_confirmation" && session.stage !== "needs_spend_confirmation")
      throw new IntegrationRequestError(
        "integration_stage_not_allowed",
        `Integration session stage "${session.stage}" is not awaiting human confirmation`,
        { stage: session.stage },
      );
    const authority = this.deps.approvalReceiptAuthority;
    if (!authority) throw new Error("Integration approval is unavailable");
    if (
      !authority.resolveChallengeToken ||
      !authority.verifyChallenge ||
      !authority.createMainProcessGestureAttestation ||
      !authority.mintReceipt
    )
      throw new Error("Integration approval UI is unavailable");
    const token = authority.resolveChallengeToken(input.challengeId);
    const challenge = authority.verifyChallenge(token);
    if (
      challenge.challengeId !== session.pendingChallengeId ||
      challenge.projectId !== session.id ||
      challenge.runId !== session.id ||
      challenge.gateId !== `integration-certification:${session.id}`
    )
      throw new Error("Integration challenge scope mismatch");
    if (
      session.pendingConfirmationKey &&
      challenge.contractHash !== integrationReceiptContract(session, session.pendingConfirmationKey)
    )
      throw new Error("Integration challenge contract mismatch");
    const attestation = authority.createMainProcessGestureAttestation(token, {
      webContentsId: input.webContentsId,
      frameId: input.frameId,
      origin: input.origin,
      decision: "accept",
    });
    const minted = authority.mintReceipt(token, attestation);
    session.pendingReceiptId = minted.receipt.receiptId;
    session.startReceiptStatus = undefined;
    // 人点完了。这一档是 start 的唯一入口，也是 Agent 唯一该看的「可以花钱了」信号。
    session.stage = "human_confirmed";
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    return this.projection(session);
  }
  /** Continue a manual Nomi-owned integration after the trusted UI minted its
   * opaque receipt. The renderer never receives the receipt token or chooses a
   * different contract/idempotency key. */
  startConfirmedFromTrustedUi(sessionId: unknown, expectedRevision: unknown) {
    const session = this.getOrThrow(sessionId);
    if (session.ownerClientId !== "nomi") throw new Error("Only a Nomi-owned integration can auto-start from the UI");
    assertIntegrationRevision(expectedRevision, session.revision);
    if (!session.pendingConfirmationKey || !session.pendingReceiptId)
      throw new Error("Integration confirmation is incomplete");
    return this.start(session.id, session.revision, "nomi", session.pendingConfirmationKey, session.pendingReceiptId);
  }
  submitWorkflow(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    workflow: string,
    binding?: unknown,
    options: { enumOptions?: unknown; modelKey?: unknown; uiWorkflow?: unknown } = {},
  ): IntegrationSessionProjection {
    return this.mutate(sessionId, expectedRevision, owner, (session) => {
      const value = text(workflow, "workflow", MAX_WORKFLOW);
      session.config.workflow = value;
      session.config.workflowBinding = sanitizeWorkflowBinding(binding);
      session.config.workflowEnumOptions = sanitizeWorkflowEnumOptions(options.enumOptions);
      if (options.modelKey !== undefined) session.config.modelKey = id(options.modelKey, "modelKey");
      if (options.uiWorkflow !== undefined)
        session.config.uiWorkflow = text(options.uiWorkflow, "uiWorkflow", MAX_WORKFLOW);
      session.configDigest = digest(session.config);
      session.stage = "needs_input";
    });
  }
  resolveInput(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    answers: Record<string, unknown>,
  ): IntegrationSessionProjection {
    return this.mutate(sessionId, expectedRevision, owner, (session) => {
      assertRecord(answers);
      const allowedKeys = new Set(session.unresolvedFields.map((field) => field.key));
      const extra = Object.keys(answers).find((key) => !allowedKeys.has(key));
      if (extra) throw new Error(`Unexpected answer: ${extra}`);
      for (const field of session.unresolvedFields)
        if (!(field.key in answers)) throw new Error(`Missing answer: ${field.key}`);
      session.unresolvedFields = [];
      session.stage = session.candidates.length ? "needs_selection" : "needs_spend_confirmation";
    });
  }
  async start(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    idempotencyKey: string,
    receipt?: string,
  ) {
    if (owner === "external") throw new Error("Signed client identity is required");
    const session = this.getOrThrow(sessionId);
    if (session.ownerClientId !== owner) throw new IntegrationRequestError("integration_owner_mismatch", "Integration session belongs to a different signed client");
    assertIntegrationRevision(expectedRevision, session.revision);
    const normalizedIdempotencyKey = text(idempotencyKey, "idempotencyKey", 200);
    const resumableStart =
      session.startIdempotencyKey === normalizedIdempotencyKey &&
      session.startReceiptStatus === "consumed" &&
      (session.stage === "certifying" || session.stage === "committing") &&
      !session.childRunRef;

    // Idempotent replay is deliberately checked before receipt verification and
    // consumption. A receipt is single-use, so a retried start must be able to
    // return the already-settled canonical run without asking the UI to mint or
    // consume a second receipt.
    if (session.startIdempotencyKey === normalizedIdempotencyKey && session.childRunRef)
      return this.get(session.id, owner);
    // A process can die after the durable reservation and before the session
    // terminal write. Reopen the reservation first, without asking for (or
    // consuming) a second receipt. A settled reservation is replayable; an
    // in-flight one is explicitly surfaced for reconciliation and never
    // re-enters the remote create path.
    if (
      session.kind === "comfyui-workflow" &&
      (session.stage === "certifying" || session.stage === "committing") &&
      session.startIdempotencyKey === normalizedIdempotencyKey &&
      !resumableStart &&
      this.deps.comfyOperationLedger
    ) {
      const operation = this.deps.comfyOperationLedger.getByIdempotencyKey(`${session.id}:${idempotencyKey}`);
      if (operation && ["finalized", "promotion_committed"].includes(operation.checkpoint)) {
        session.childRunRef = operation.childRunRef;
        session.stage = "completed";
        session.blockingReason = undefined;
      } else if (await this.recoverComfyOperation(session, normalizedIdempotencyKey, operation)) {
        return this.projection(session);
      } else {
        session.stage = "failed";
        session.blockingReason = { code: "comfy_certification_recovery_required" };
      }
      session.revision += 1;
      session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
      this.state.revision += 1;
      this.persist();
      return this.projection(session);
    }
    // 没有任何收据可谈（调用方没给，会话上也没有）＝ 人根本还没批。此时报「收据无效」是把
    // 因果讲反了，而实测证明 agent 会照着这句话去重试收据而不是去等人。先把真正的原因说出来。
    if (!resumableStart && !receipt && !session.pendingReceiptId && session.stage !== "human_confirmed") {
      throw new IntegrationRequestError(
        "integration_stage_not_allowed",
        session.stage === "awaiting_human_confirmation"
          ? 'A person has not approved this spend yet. Wait for stage "human_confirmed" (poll nomi_read target=integration); calling confirm again does not help'
          : `Integration session stage "${session.stage}" is not ready to start`,
        { stage: session.stage },
      );
    }
    const receiptValue = resumableStart
      ? String(receipt || session.pendingReceiptId || `resume-${digest(normalizedIdempotencyKey).slice(0, 32)}`)
      : text(receipt || session.pendingReceiptId, "receipt", 8 * 1024);
    let receiptToken = receiptValue;
    if (!resumableStart && !this.deps.approvalReceiptAuthority) {
      // Unit-level callers may inject a certification double without wiring the
      // Electron receipt authority. Runtime factories always inject it and fail
      // closed, so this compatibility path is unreachable in the app.
      if (!this.deps.certification && !this.deps.certifyComfy) throw new Error("Integration approval is unavailable");
    } else if (!resumableStart) {
      const authority = this.deps.approvalReceiptAuthority;
      if (!authority) throw new Error("Integration approval authority is unavailable");
      receiptToken = (() => {
        try {
          return authority.resolveReceiptToken ? authority.resolveReceiptToken(receiptValue) : receiptValue;
        } catch {
          return receiptValue;
        }
      })();
      verifyIntegrationReceipt(authority, receiptValue, session, normalizedIdempotencyKey);
      if (!authority.consumeReceipt) throw new Error("Integration approval authority cannot consume receipts");
    }
    if (
      !resumableStart &&
      session.startIdempotencyKey === normalizedIdempotencyKey &&
      session.startReceiptDigest !== digest(receiptValue)
    )
      throw new Error("Receipt does not match the existing idempotent start");
    if (!resumableStart && (session.stage === "certifying" || session.stage === "committing"))
      throw new Error("Integration session certification is already in progress");
    if (!resumableStart && session.stage !== "human_confirmed")
      throw new IntegrationRequestError(
        "integration_stage_not_allowed",
        session.stage === "awaiting_human_confirmation"
          ? "A person has not approved this spend yet. Wait for stage \"human_confirmed\" (poll nomi_read target=integration); calling confirm again does not help"
          : `Integration session stage "${session.stage}" is not ready to start`,
        { stage: session.stage },
      );
    const canonicalComfyKey =
      session.kind === "comfyui-workflow" ? `${session.id}:${normalizedIdempotencyKey}` : undefined;
    let comfyReservation: ReturnType<OperationLedger["begin"]> | undefined;
    if (session.kind === "comfyui-workflow" && this.deps.comfyOperationLedger) {
      const contractDigest = integrationContractDigest(session, normalizedIdempotencyKey);
      const runId = `integration-${session.id}-${digest(normalizedIdempotencyKey).slice(0, 24)}`;
      const sourceVendorKey = deriveVendorKeyFromBaseUrl(session.config.baseUrl || "") || COMFYUI_VENDOR_KEY;
      comfyReservation = this.deps.comfyOperationLedger.begin({
        runId,
        contractDigest,
        idempotencyKey: canonicalComfyKey!,
        lineageRootVendorKey: sourceVendorKey,
        sourceVendorKey,
        selectedModels: [],
        leaseOwner: `integration-session-${process.pid}`,
        leaseToken: crypto.randomUUID(),
        attempt: 1,
        childRunRef: { runId, revisionDigest: contractDigest },
        providerIdempotency: "unknown",
        now: (this.deps.now || (() => new Date().toISOString()))(),
      });
      if (comfyReservation.status === "duplicate") {
        const operation =
          comfyReservation.operation || this.deps.comfyOperationLedger.getByRunId(comfyReservation.canonicalRunId);
        // Only a finalized ledger record is a replayable certification result.
        // A durable remote prompt id is reconciled through `/history`; all
        // other in-flight records intentionally stop here because a second
        // `/prompt` would be a duplicate paid job.
        if (!operation || !["finalized", "promotion_committed"].includes(operation.checkpoint)) {
          if (await this.recoverComfyOperation(session, normalizedIdempotencyKey, operation)) {
            return this.projection(session);
          }
          session.stage = "failed";
          session.blockingReason = { code: "comfy_certification_recovery_required" };
          session.revision += 1;
          session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
          this.state.revision += 1;
          this.persist();
          return this.projection(session);
        }
        if (session.startIdempotencyKey === normalizedIdempotencyKey && session.childRunRef)
          return this.projection(session);
        session.startIdempotencyKey = normalizedIdempotencyKey;
        session.startReceiptDigest = digest(receiptValue);
        session.childRunRef = operation.childRunRef;
        session.stage = "completed";
        session.blockingReason = undefined;
        session.revision += 1;
        session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
        this.state.revision += 1;
        this.persist();
        return this.projection(session);
      }
    }
    session.startIdempotencyKey = normalizedIdempotencyKey;
    if (!resumableStart) session.startReceiptDigest = digest(receiptValue);
    // Persist the start intent before consuming the one-shot receipt. This is
    // the durable handoff point for a crash between UI approval and execution.
    session.startReceiptStatus = session.startReceiptStatus === "consumed" ? "consumed" : "pending";
    session.stage = "certifying";
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    if (!resumableStart && this.deps.approvalReceiptAuthority && session.startReceiptStatus === "pending") {
      if (!this.deps.approvalReceiptAuthority.consumeReceipt)
        throw new Error("Integration approval authority cannot consume receipts");
      this.deps.approvalReceiptAuthority.consumeReceipt(receiptToken);
      session.startReceiptStatus = "consumed";
      session.revision += 1;
      session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
      this.state.revision += 1;
      this.persist();
    }
    const credential = this.deps.credentialResolver?.(session);
    // Credential lookup happens after the durable start intent and receipt
    // consumption. A missing/undecryptable key is therefore a terminal,
    // diagnosable certification failure, never an uncaught exception that
    // leaves the session permanently in `certifying`.
    if (session.kind === "http-api-provider" && !credential) {
      session.stage = "failed";
      session.blockingReason = { code: "credential_unavailable" };
      session.revision += 1;
      session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
      this.state.revision += 1;
      this.persist();
      return this.projection(session);
    }
    const connection = {
      vendorName: session.config.name,
      baseUrl: session.config.baseUrl || "",
      apiKey: credential || "",
      authType: session.config.authType || "bearer",
      ...(session.config.authHeader ? { authHeader: session.config.authHeader } : {}),
      ...(session.config.authQueryParam ? { authQueryParam: session.config.authQueryParam } : {}),
      providerKind: (session.config.providerKind || "openai-compatible") as never,
      // 用户 / 驱动 Agent 交进来的两样东西，从这里才真正流到编译器与认证：
      // 文档正文或 URL 列表（首选文档来源），以及外部编译好的说明卡（跳过编译，不跳过校验）。
      ...(session.config.docs ? { docs: session.config.docs } : {}),
      ...(session.adapterDraft ? { adapterDraft: clone(session.adapterDraft) } : {}),
      models: session.selections.map((item) => ({
        modelKey: item.modelKey,
        kind: item.kind as ProviderAdapterModelSelection["kind"],
        ...(item.label ? { labelZh: item.label } : {}),
      })),
    };
    let certificationSucceeded = false;
    try {
      if (session.kind === "comfyui-workflow") {
        if (!this.deps.certifyComfy) throw new Error("comfy_certification_unavailable");
        const callbackRef = await this.deps.certifyComfy(session, normalizedIdempotencyKey);
        // The durable reservation is the canonical run identity. The callback
        // may return a catalog revision handle, but that handle is not allowed
        // to become a second idempotency/run identity.
        session.childRunRef = comfyReservation?.operation?.childRunRef || callbackRef;
        session.stage = "completed";
        certificationSucceeded = true;
      } else {
        const run = await this.certification.startHttp({
          entryPoint: "programmatic-session",
          idempotencyKey: normalizedIdempotencyKey,
          connection,
        });
        session.childRunRef = { runId: run.id, revisionDigest: run.childRunRef.revisionDigest };
        session.stage = integrationStageFromAdapterRun(run.stage);
        session.blockingReason = session.stage === "failed" ? { code: adapterTerminalReasonCode(run.stage) } : undefined;
      }
    } catch (error) {
      session.stage = "failed";
      session.blockingReason = {
        code: safeCertificationFailureCode(error),
      };
    }
    if (session.kind === "comfyui-workflow" && this.deps.comfyOperationLedger && comfyReservation?.operation) {
      const current = this.deps.comfyOperationLedger.getByRunId(comfyReservation.operation.runId);
      if (
        current &&
        current.checkpoint !== "finalized" &&
        current.checkpoint !== "cancelled" &&
        current.checkpoint !== "superseded"
      ) {
        if (certificationSucceeded) {
          this.deps.comfyOperationLedger.markCheckpoint(comfyReservation.operation.runId, {
            checkpoint: "finalized",
            expectedRevision: current.revision,
            now: (this.deps.now || (() => new Date().toISOString()))(),
          });
        } else if (["submitting", "submitted"].includes(current.submissionState)) {
          this.deps.comfyOperationLedger.markUnknown(comfyReservation.operation.runId, {
            expectedRevision: current.revision,
            userAction: "reconcile_or_contact_provider",
            now: (this.deps.now || (() => new Date().toISOString()))(),
            ...(current.remoteTaskId ? { remoteTaskId: current.remoteTaskId } : {}),
          });
        } else {
          this.deps.comfyOperationLedger.cancel(comfyReservation.operation.runId, {
            expectedRevision: current.revision,
            leaseToken: current.lease.token,
            now: (this.deps.now || (() => new Date().toISOString()))(),
          });
        }
      }
    }
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    return this.projection(session);
  }
  cancel(sessionId: unknown, expectedRevision: unknown, owner: CapabilityOriginHost): IntegrationSessionProjection {
    const session = this.getOrThrow(sessionId);
    if (session.ownerClientId !== owner) throw new IntegrationRequestError("integration_owner_mismatch", "Integration session belongs to a different signed client");
    assertIntegrationRevision(expectedRevision, session.revision);
    if (TERMINAL.has(session.stage)) return this.projection(session);
    if (session.stage === "certifying" || session.stage === "committing")
      throw new Error("Cannot cancel certification in progress");
    session.stage = "cancelled";
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    return this.projection(session);
  }
}
let singleton: IntegrationSessionService | null = null;
export function configureIntegrationSessionService(deps: Dependencies = {}): IntegrationSessionService {
  if (!singleton) singleton = new IntegrationSessionService(deps);
  return singleton;
}
export function getIntegrationSessionService(deps?: Dependencies): IntegrationSessionService {
  if (deps && !singleton) singleton = new IntegrationSessionService(deps);
  singleton ||= createRuntimeIntegrationSessionService();
  return singleton;
}
