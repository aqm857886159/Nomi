import { profileAcceptanceIdentity } from "../tasks/responseParsing";
import { expectedMediaKind, readTaskResponse } from "../tasks/taskResultReading";
import { RETRIEVAL_UNAVAILABLE_MESSAGE } from "../shared/nomiErrorCodes";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HttpOperation, Mapping, Model, Vendor } from "../catalog/types";

/** Transport identity is frozen on acceptance. Observation resolves credentials separately. */
export type ReceiptRoute = {
  vendorKey: string;
  modelKey: string;
  modeId: string;
  baseUrl: string;
  authType?: Vendor["authType"];
  model: Pick<
    Model,
    "modelKey" | "vendorKey" | "modelAlias" | "kind" | "labelZh" | "enabled" | "createdAt" | "updatedAt"
  >;
  mapping?: Mapping;
};

export type PaidSubmissionReceipt = ReceiptRoute & {
  remoteTaskId: string | null;
  taskId: string;
  acceptedAt: string;
  rawAcceptance: unknown;
  source: "profile" | "catalog" | "script" | "assets" | "audio";
  audio?: { contentType: string; format: string; codec: HttpOperation["audioResponse"] };
  /** A script whose create response was checkpointed can only resume its read operations. */
  scriptCall?: {
    requestHash: string;
    script: string;
    params: Record<string, unknown>;
    taskKind: Mapping["taskKind"];
    modeId?: string;
  };
};

const receiptWriter = new AsyncLocalStorage<(receipt: PaidSubmissionReceipt) => void>();

export function withPaidReceiptWriter<T>(write: (receipt: PaidSubmissionReceipt) => void, dispatch: () => T): T {
  return receiptWriter.run(write, dispatch);
}

export function checkpointPaidResponse(input: {
  vendor: Vendor;
  model: Model;
  modeId?: string;
  mapping?: Mapping;
  remoteTaskId: string | null;
  taskId: string;
  rawAcceptance: unknown;
  audio?: PaidSubmissionReceipt["audio"];
  source: PaidSubmissionReceipt["source"];
  scriptCall?: PaidSubmissionReceipt["scriptCall"];
}): void {
  const write = receiptWriter.getStore();
  if (!write) return;
  const { vendor, model, modeId, mapping, ...receipt } = input;
  const { modelKey, vendorKey, modelAlias, kind, labelZh, enabled, createdAt, updatedAt } = model;
  write({
    ...receipt,
    vendorKey: vendor.key,
    modelKey,
    authType: vendor.authType,
    modeId: modeId || mapping?.modeId || mapping?.taskKind || "",
    baseUrl: vendor.baseUrlHint || "",
    model: { modelKey, vendorKey, modelAlias, kind, labelZh, enabled, createdAt, updatedAt },
    mapping,
    acceptedAt: new Date().toISOString(),
  });
}

/** Credentials stay in the keychain. Only the frozen origin may receive credentials bound to it. */
export function vendorForReceipt(receipt: PaidSubmissionReceipt, live?: Vendor): Vendor {
  if (live && new URL(live.baseUrlHint || "").origin !== new URL(receipt.baseUrl).origin) {
    if (receipt.authType !== "none") throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
    return vendorForReceipt(receipt);
  }
  if (live && live.authType !== receipt.authType) throw new Error(RETRIEVAL_UNAVAILABLE_MESSAGE);
  return {
    key: receipt.vendorKey,
    name: receipt.vendorKey,
    enabled: true,
    createdAt: "",
    updatedAt: "",
    ...live,
    authType: receipt.authType,
    baseUrlHint: receipt.baseUrl,
  };
}

export function checkpointProfileCreate(input: {
  captureCreate?: { modeId?: string };
  response: unknown;
  operation: HttpOperation;
  mapping: Mapping;
  taskIdFallback: string;
  vendor?: Vendor;
  model?: Model;
}): void {
  if (!input.captureCreate || !input.vendor || !input.model || !receiptWriter.getStore()) return;
  const identity = profileAcceptanceIdentity(input.response, input.operation, "");
  if (
    !identity.taskId &&
    !readTaskResponse({
      response: input.response,
      responseMapping: identity.responseMapping,
      statusMapping: input.mapping.statusMapping,
      wantedKind: expectedMediaKind(input.model.kind),
    }).assetUrls.length
  )
    return;
  checkpointPaidResponse({
    vendor: input.vendor,
    model: input.model,
    modeId: input.captureCreate.modeId,
    mapping: { ...input.mapping, create: input.operation },
    source: "profile",
    remoteTaskId: identity.taskId || null,
    taskId: identity.taskId || input.taskIdFallback,
    rawAcceptance: input.response,
  });
}

export function checkpointAudioResponse(input: {
  vendor: Vendor;
  model: Model;
  modeId: string;
  taskId: string;
  bytes: Buffer;
  audio: NonNullable<PaidSubmissionReceipt["audio"]>;
}): void {
  if (!receiptWriter.getStore()) return;
  const { bytes, ...identity } = input;
  checkpointPaidResponse({ ...identity, source: "audio", remoteTaskId: null, rawAcceptance: bytes.toString("base64") });
}
