import crypto from "node:crypto";
import { isJsonRecord, nowIso } from "../jsonUtils";
import { humanizeModelKey } from "./modelLabel";
import { mutateCatalog, readCatalog } from "./catalogStore";
import type { BillingModelKind, Model } from "./types";
import { archetypeIdForModel } from "../shared/modelArchetypes";

const CUSTOM_CALL_DRAFT_KINDS = new Set<BillingModelKind>(["text", "image", "video", "audio", "model3d"]);

export type CustomCallDraftIdentity = {
  vendorKey: string;
  modelKey: string;
  label: string;
  kind: BillingModelKind;
};

export type CreateCustomCallDraftInput = {
  vendorName: string;
  baseUrl: string;
  apiKey: string;
  authType: "none" | "bearer";
  modelKey: string;
  kind: BillingModelKind;
};

function publicIdentity(model: Model): CustomCallDraftIdentity {
  return {
    vendorKey: model.vendorKey,
    modelKey: model.modelKey,
    label: model.labelZh,
    kind: model.kind,
  };
}

function customCallDraftMeta(meta: unknown): Record<string, unknown> {
  const current = isJsonRecord(meta) ? { ...meta } : {};
  current.customCallDraft = { createdAt: nowIso() };
  return current;
}

export function createCustomCallDraft(input: CreateCustomCallDraftInput): CustomCallDraftIdentity {
  const vendorName = String(input?.vendorName || "").trim();
  const baseUrl = String(input?.baseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(input?.apiKey || "").trim();
  const modelKey = String(input?.modelKey || "").trim();
  const authType = input?.authType === "none" ? "none" : "bearer";
  const kind = input?.kind;

  if (!vendorName) throw new Error("connection name is required");
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error("base URL must use http or https");
  if (authType !== "none" && !apiKey) throw new Error("API key is required unless auth is none");
  if (!modelKey) throw new Error("model ID is required");
  if (!CUSTOM_CALL_DRAFT_KINDS.has(kind)) throw new Error("unsupported model kind");

  const vendorKey = `custom-script-${crypto.randomUUID().slice(0, 12)}`;
  return mutateCatalog((tx) => {
    tx.upsertVendor({
      key: vendorKey,
      name: vendorName,
      baseUrlHint: baseUrl,
      authType,
      enabled: true,
      meta: { customCallOnly: true },
    });
    if (authType !== "none") tx.upsertApiKey(vendorKey, { apiKey, enabled: true });
    const model = tx.upsertModel({
      vendorKey,
      modelKey,
      modelAlias: modelKey,
      labelZh: humanizeModelKey(modelKey),
      kind,
      enabled: false,
      meta: customCallDraftMeta(undefined),
      onboarding: { addedVia: "manual", addedAt: nowIso(), fields: [] },
    });
    return publicIdentity(model);
  });
}

export function finalizeCustomCallDraft(input: {
  vendorKey: string;
  modelKey: string;
  script: string;
}): CustomCallDraftIdentity {
  const vendorKey = String(input?.vendorKey || "").trim();
  const modelKey = String(input?.modelKey || "").trim();
  const script = String(input?.script || "").trim();
  if (!script) throw new Error("custom call script is required");

  const existing = readCatalog().models.find((model) => model.vendorKey === vendorKey && model.modelKey === modelKey);
  if (!existing) throw new Error("custom call draft model not found");
  const meta = isJsonRecord(existing.meta) ? { ...existing.meta } : {};
  if (!isJsonRecord(meta.customCallDraft)) throw new Error("model is not a custom call draft");
  delete meta.customCallDraft;
  const customCapability = isJsonRecord(meta.customCapabilityContract)
    ? meta.customCapabilityContract
    : null;
  const capabilityKnown = existing.kind === "text" ||
    Boolean(archetypeIdForModel(existing.modelKey, existing.modelAlias)) ||
    Boolean(customCapability?.version === 1 && Array.isArray(customCapability.modes) && customCapability.modes.length > 0);

  return mutateCatalog((tx) => publicIdentity(tx.upsertModel({
    vendorKey,
    modelKey,
    enabled: capabilityKnown,
    meta,
    customCall: { script },
  })));
}
