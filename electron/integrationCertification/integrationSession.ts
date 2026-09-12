import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { capabilityCoreDir, type CapabilityOriginHost } from "../capabilityCore/security";
import { writeCertificationJsonAtomic } from "./certificationPersistence";
import { logError } from "../logging/logger";
import { ConnectionCertificationService, getConnectionCertificationService } from "./service";
import type {
  AdapterAuthType,
  ProviderAdapterDraft,
  ProviderAdapterModelSelection,
} from "../providerAdapter/types";
import {
  ADAPTER_CONTRACT_INSTRUCTIONS,
  adapterContractJsonSchema,
} from "../providerAdapter/agentCompileRequest";
import { hasCompilerLanguageModel } from "../providerAdapter/serviceLanguageModels";
import { cancelCertifyingRun, sessionModelResults, type IntegrationModelResult } from "./integrationSessionRunView";
import { adapterDraftFromProposal, compileRequestFor } from "./integrationAdapterContract";
import type { IntegrationHandoff } from "./handoffQueue";
import { enqueueIntegrationHandoff, retireIntegrationHandoffs } from "./handoffQueue";
import { mutateCatalog, readCatalog, normalizeProviderKind } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { deriveVendorKeyFromBaseUrl } from "../catalog/catalogCommit";
import type { ProfileKind } from "../catalog/types";
import { runComfyCandidateTest } from "../tasks/comfyCandidateTest";
import { isComfyuiVendor, COMFYUI_VENDOR_KEY } from "../catalog/types";
import { OperationLedger } from "./operationLedger";
import type { CertificationOperationRecord, ComfyCertificationRuntime } from "./types";
import type { WorkflowBinding, WorkflowEnumOption } from "../catalog/comfyuiWorkflowImport";
export type { ComfyCertificationRuntime } from "./types";
import {
  proposalCandidates,
  proposalRejected,
  proposalSelections,
} from "./integrationProposalValidation";
import {
  adapterTerminalReasonCode,
  integrationStageFromAdapterRun,
  safeCertificationFailureCode,
  validateState,
} from "./integrationSessionRecord";
import {
  assertRecord,
  rejectWorkflowKeys,
  sanitizeWorkflowBinding,
  sanitizeWorkflowEnumOptions,
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
  INTEGRATION_STAGES,
  IntegrationRequestError,
  type IntegrationCredentialStatus,
  type IntegrationStage,
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
  /** 待驱动 Agent 编译时的交底；收到合法 adapterDraft 后清空。 */
  compileRequest?: IntegrationCompileRequest;
  /** 驱动 Agent 交回并已通过 validateProviderAdapterDraft 的说明卡。 */
  adapterDraft?: ProviderAdapterDraft;
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
  modelResults?: IntegrationModelResult[]; // 逐模型结论，含供应商原始错误；无 run 时不出现
};
export type PersistedIntegrationState = { version: 1; revision: number; sessions: IntegrationSession[] };
type PersistedState = PersistedIntegrationState;
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
  credentialResolver?: (session: IntegrationSession) => string | undefined;
  /** 「Nomi 自己有没有文本模型可以拿来读文档」。默认问真实 catalog；测试注入布尔。 */
  compilerAvailable?: () => boolean;
  /** Durable UI handoff sink. The session service never emits an event-only handoff. */
  enqueueHandoff?: (input: Omit<IntegrationHandoff, "requestId" | "createdAt">) => unknown;
  retireHandoff?: (sessionId: string, target: IntegrationHandoff["target"]) => unknown;
  now?: () => string;
  /** Durable reservation for native ComfyUI certification submissions. */
  comfyOperationLedger?: OperationLedger;
};
/** Runtime wiring used by both GUI RPC and packaged stdio. Keeps secrets in main and
 * injects the same certification/handoff boundaries into every transport. */
export function createRuntimeIntegrationSessionService(
  input: ComfyCertificationRuntime & {
    certification?: ConnectionCertificationService;
    enqueueHandoff?: Dependencies["enqueueHandoff"];
    save?: Dependencies["save"];
    filePath?: string;
    now?: () => string;
    comfyOperationLedger?: Dependencies["comfyOperationLedger"];
  },
): IntegrationSessionService {
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
    enqueueHandoff: input.enqueueHandoff || enqueueIntegrationHandoff,
    retireHandoff: retireIntegrationHandoffs,
    save: input.save,
    now: input.now,
    credentialResolver: resolveCredential,
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
const MAX_TEXT = 64 * 1024;
const MAX_WORKFLOW = 2 * 1024 * 1024;
const WRITE_STAGES = new Set<IntegrationStage>([
  ...INTEGRATION_STAGES.filter(
    (stage) => !["certifying", "committing", "completed", "partial", "failed", "cancelled"].includes(stage),
  ),
]);
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
    const before = session.stage;
    fn(session);
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    if (before !== "ready_to_certify" && session.stage === "ready_to_certify") this.announceReadyToCertify(session);
    return this.projection(session);
  }
  /**
   * 会话走到「该跑自检了」时给 Nomi 窗口递一张交接单，模型页据此弹出「开始自检」那一屏。
   *
   * **这不是花费闸**：自检一次上游生成都不发，交接单只是让用户知道活儿走到哪了、
   * 并给他一个亲手开跑的地方。只对 Nomi 自己拥有的会话发——外部宿主的会话由驱动 Agent
   * 直接调 start，给它发交接单等于在 Nomi 里放一个按下去必然 owner_mismatch 的按钮。
   *
   * 放在 `mutate` 这一层而不是各条转场里：进这一档的路有三条（HTTP 提方案 / 补答案 /
   * ComfyUI 提工作流），分头发迟早漏一条（P2 修在最早的共享边界）。
   */
  private announceReadyToCertify(session: IntegrationSession): void {
    if (session.ownerClientId !== "nomi") return;
    this.deps.enqueueHandoff?.({
      target: "verification",
      sessionId: session.id,
      revision: session.revision,
      ownerClientId: session.ownerClientId,
      display: {
        name: session.config.name,
        ...(session.config.baseUrl ? safeHandoffOrigin(session.config.baseUrl) : {}),
      },
    });
  }
  projection(session: IntegrationSession): IntegrationSessionProjection {
    const modelResults = sessionModelResults(this.certification, session);
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
      ...(modelResults.length ? { modelResults } : {}), // 盘上一直有，以前只是没投影到会话面上
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
   * 列出本客户端的接入会话，未完成的排前面。修复前不带 sessionId 直接报错，而 MCP 面上没有
   * 第二条路——实测里 agent 只能去盘上 grep 我们的日志找回 id。丢了上下文不是模型的问题。
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
  private resumableFor(owner: CapabilityOriginHost, kind: IntegrationKind, baseUrl?: string): IntegrationSession | undefined {
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
    // 带 sessionId 的 begin 是「接着上次做」，不是「再开一个」。修复前它照样新建，于是同一个
    // baseUrl 冒出第二个会话并报 credentialStatus: missing，用户被要求把存过的 key 再填一遍。
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
    // 这个 baseUrl 的 key 可能早就在 Nomi 的安全存储里。报 missing 等于让用户再填一遍已经填过
    // 的东西；这里如实读一次既有凭据边界，不新增第二份真相。
    const credentialReady = input.kind === "http-api-provider" && Boolean(this.deps.credentialResolver?.(session));
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
        current.stage = compileRequest ? "needs_input" : "ready_to_certify";
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
      current.stage = "ready_to_certify";
    });
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
      session.stage = session.candidates.length ? "needs_selection" : "ready_to_certify";
    });
  }
  /**
   * 跑一次**不花钱**的自检，通过就落库。2026-09-12 用户拍板：接模型没有付费验证，
   * 因此这里没有收据、没有挑战、没有真人手势章——谁拥有这个会话，谁就能直接调它。
   * （删掉的那套东西唯一的作用是「授权花钱」；钱的闸只剩画布每次提交时的报价卡。）
   */
  async start(
    sessionId: unknown,
    expectedRevision: unknown,
    owner: CapabilityOriginHost,
    idempotencyKey: string,
  ) {
    if (owner === "external") throw new Error("Signed client identity is required");
    const session = this.getOrThrow(sessionId);
    if (session.ownerClientId !== owner) throw new IntegrationRequestError("integration_owner_mismatch", "Integration session belongs to a different signed client");
    assertIntegrationRevision(expectedRevision, session.revision);
    const normalizedIdempotencyKey = text(idempotencyKey, "idempotencyKey", 200);
    // 同一把 idempotency key 重放：上一次已经把会话推进到跑/落库中但还没拿到 childRunRef，
    // 就接着那一次走，不重开一次远端提交。
    const resumableStart =
      session.startIdempotencyKey === normalizedIdempotencyKey &&
      (session.stage === "certifying" || session.stage === "committing") &&
      !session.childRunRef;

    if (session.startIdempotencyKey === normalizedIdempotencyKey && session.childRunRef)
      return this.get(session.id, owner);
    // A process can die after the durable reservation and before the session
    // terminal write. Reopen the reservation first. A settled reservation is replayable; an
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
    if (!resumableStart && (session.stage === "certifying" || session.stage === "committing"))
      throw new Error("Integration session certification is already in progress");
    if (!resumableStart && session.stage !== "ready_to_certify")
      throw new IntegrationRequestError(
        "integration_stage_not_allowed",
        `Integration session stage "${session.stage}" is not ready to start`,
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
    // 先把「开跑」这个意图落盘再真正开跑：进程死在这中间时，重放同一把 key 能接着走。
    session.stage = "certifying";
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    const credential = this.deps.credentialResolver?.(session);
    // Credential lookup happens after the durable start intent is persisted.
    // A missing/undecryptable key is therefore a terminal,
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
      // blockingReason 只留一个粗码（provider_failed / invalid_input / …），原始错误以前
      // 在这里被彻底丢掉：真机上「明明 /prompt 成功了却报失败」时，盘上和界面上都没有任何
      // 线索可查。日志已做脱敏（redactError），记下来才有得排。
      logError("onboarding", "integration-certification-failed", error, {
        sessionId: session.id,
        kind: session.kind,
        code: session.blockingReason.code,
      });
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
    // 逃生口：HTTP 会话的 certifying 不再是无出口的黑洞（见 integrationSessionRunView.ts）。
    if (session.stage === "certifying" || session.stage === "committing")
      session.blockingReason = cancelCertifyingRun(this.certification, session);
    session.stage = "cancelled";
    session.revision += 1;
    session.updatedAt = (this.deps.now || (() => new Date().toISOString()))();
    this.state.revision += 1;
    this.persist();
    return this.projection(session);
  }
}
let singleton: IntegrationSessionService | null = null;
/**
 * 进程内唯一实例的取用口。**没装过就炸，不再零参兜底造一个**——那个兜底造出来的实例
 * 拿不到 runTask/fetchTaskResult/mintSpendGrant，ComfyUI 认证必炸且静默（见
 * `ComfyCertificationRuntime` 注释）。装配只走 `installIntegrationSessionRuntime()`
 * （integrationSessionRuntimeInstall.ts），发生在各进程入口的启动期；
 * 所以这里抛 = 启动顺序坏了，而不是某个用户动作坏了。
 */
export function getIntegrationSessionService(): IntegrationSessionService {
  if (!singleton) throw new Error("integration_session_service_not_installed");
  return singleton;
}
