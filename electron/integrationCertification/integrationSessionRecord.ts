/**
 * 落盘会话记录的深校验，以及「上游失败 → 封闭可本地化的原因码」的映射。
 *
 * 单独成文件的理由：这两件事都只认数据形状，不认会话状态机——把它们留在 integrationSession.ts
 * 里只会继续喂那个巨壳（R9/R12）。原因码尤其不能散落：上游错误字符串一旦被原样落盘，
 * 投影就会把供应商的内部信息带给调用方。
 */
import type { ProviderAdapterRun } from "../providerAdapter/types";
import { assertRecord } from "./integrationWorkflowBinding";
import type { IntegrationSession, PersistedIntegrationState } from "./integrationSession";
import {
  INTEGRATION_CREDENTIAL_STATUSES,
  INTEGRATION_STAGES,
  INTEGRATION_START_RECEIPT_STATUSES,
  type IntegrationCredentialStatus,
  type IntegrationStage,
  type IntegrationStartReceiptStatus,
} from "../shared/integrationContract";
import type { CapabilityOriginHost } from "../capabilityCore/security";

const MAX_SESSIONS = 100;

/** Convert connector/runtime failures into the closed, localizable reason-code
 * set exposed by the session projection. Never persist upstream error strings. */
export function safeCertificationFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (/credential|api.?key|safe.?storage/i.test(code)) return "credential_unavailable";
  if (/balance|billing|payment|insufficient/i.test(code)) return "provider_balance";
  if (/quota|rate.?limit|429/i.test(code)) return "provider_quota";
  if (/workflow|candidate|binding|input|missing_media|prompt_missing/i.test(code)) return "invalid_input";
  if (/timeout|network|fetch|connect|socket/i.test(code)) return "provider_network";
  if (/unavailable|runner/i.test(code)) return "certification_unavailable";
  return "provider_failed";
}
export function integrationStageFromAdapterRun(stage: ProviderAdapterRun["stage"]): IntegrationStage {
  if (stage === "completed" || stage === "partial") return stage;
  if (["queued", "discovering_docs", "compiling", "testing", "repairing", "reconciling"].includes(stage))
    return "certifying";
  return "failed";
}

export function adapterTerminalReasonCode(stage: ProviderAdapterRun["stage"]): string {
  if (stage === "needs_ai") return "certification_needs_ai";
  if (stage === "timed_out") return "certification_timed_out";
  if (stage === "cancelled") return "certification_cancelled";
  if (stage === "stale") return "certification_stale";
  return "provider_failed";
}

export function validateState(raw: unknown): PersistedIntegrationState {
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