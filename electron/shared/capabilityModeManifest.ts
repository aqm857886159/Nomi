import { ARCHETYPE_MODE_MANIFEST } from "../catalog/archetypeModes.generated";
import { archetypeIdForModel } from "../catalog/archetypeIdentity";
import { parseCustomCapabilityContract } from "./customCapabilityContract";
import { modeTransportFor } from "./videoCapabilities/modeTransport";
import type { BillingModelKind, ProfileKind } from "../catalog/types";

export type CapabilityModeModel = {
  modelKey?: string;
  modelAlias?: string | null;
  kind?: string;
  meta?: unknown;
};

export type CapabilityModeManifest = {
  archetypeId: string;
  defaultModeId: string;
  modes: Record<string, ProfileKind>;
};

export type CapabilityModeResolution =
  | { state: "resolved"; source: "explicit" | "built-in"; manifest: CapabilityModeManifest }
  | { state: "absent" }
  | { state: "invalid-explicit" };

const TASK_KINDS_BY_MODEL_KIND: Record<Exclude<BillingModelKind, "text">, ReadonlySet<ProfileKind>> = {
  image: new Set(["text_to_image", "image_edit"]),
  video: new Set(["text_to_video", "image_to_video"]),
  audio: new Set(["text_to_audio", "transcribe"]),
  model3d: new Set(["text_to_3d", "image_to_3d"]),
};
const DEFAULT_CUSTOM_CALL_TASK_BY_KIND: Record<BillingModelKind, ProfileKind> = {
  text: "chat",
  image: "text_to_image",
  video: "text_to_video",
  audio: "text_to_audio",
  model3d: "text_to_3d",
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function explicitArchetypeId(meta: unknown): string {
  const metadata = record(meta);
  if (!metadata) return "";
  const direct = trim(metadata.archetypeId);
  if (direct) return direct;
  return trim(record(metadata.archetype)?.id);
}

function hasExplicitContract(model: CapabilityModeModel): boolean {
  const metadata = record(model.meta);
  return Boolean(metadata && Object.prototype.hasOwnProperty.call(metadata, "customCapabilityContract"));
}

function customCapabilityModeManifest(model: CapabilityModeModel): CapabilityModeManifest | null {
  const contract = parseCustomCapabilityContract(model.meta);
  if (!contract || contract.kind !== trim(model.kind)) return null;
  const identifier = trim(model.modelKey) || trim(model.modelAlias);
  if (!identifier) return null;
  // User-authored contracts are single-vendor by construction (CustomCapabilityModeV1 does not
  // pick up `vendorTransportTaskKind`), so vendor specialization is `null` here — but the read
  // still goes through the one helper rather than an inline `??` chain.
  const modes = Object.fromEntries(contract.modes.map((mode) => [
    mode.id,
    modeTransportFor(mode, contract, null),
  ])) as Record<string, ProfileKind>;
  return {
    archetypeId: `custom-capability:${encodeURIComponent(identifier)}`,
    defaultModeId: contract.defaultModeId,
    modes,
  };
}

function builtInModeManifest(model: CapabilityModeModel): CapabilityModeManifest | null {
  const explicitId = explicitArchetypeId(model.meta);
  const inferredId = archetypeIdForModel(model.modelKey, model.modelAlias);
  const archetypeId = explicitId && ARCHETYPE_MODE_MANIFEST[explicitId] ? explicitId : inferredId;
  if (!archetypeId) return null;
  const manifest = ARCHETYPE_MODE_MANIFEST[archetypeId];
  const modelKind = trim(model.kind) as Exclude<BillingModelKind, "text">;
  const allowedTaskKinds = TASK_KINDS_BY_MODEL_KIND[modelKind];
  if (!manifest || !allowedTaskKinds) return null;
  const modes = Object.fromEntries(
    Object.entries(manifest.modes).filter((entry): entry is [string, ProfileKind] => allowedTaskKinds.has(entry[1] as ProfileKind)),
  );
  if (
    Object.keys(modes).length !== Object.keys(manifest.modes).length ||
    !Object.prototype.hasOwnProperty.call(modes, manifest.defaultModeId)
  ) return null;
  return { archetypeId, defaultModeId: manifest.defaultModeId, modes };
}

export function defaultCustomCallTaskKind(kind: unknown): ProfileKind | null {
  return DEFAULT_CUSTOM_CALL_TASK_BY_KIND[trim(kind) as BillingModelKind] || null;
}

/**
 * Exact mode identity used by both custom-call dispatch and publication.
 * An explicit contract is authoritative: malformed input is terminal and can never fall
 * through to identity-based built-ins or a legacy generic script.
 */
export function resolveCapabilityModeEvidence(model: CapabilityModeModel): CapabilityModeResolution {
  if (hasExplicitContract(model)) {
    const manifest = customCapabilityModeManifest(model);
    return manifest
      ? { state: "resolved", source: "explicit", manifest }
      : { state: "invalid-explicit" };
  }
  const manifest = builtInModeManifest(model);
  return manifest
    ? { state: "resolved", source: "built-in", manifest }
    : { state: "absent" };
}

export function resolveCapabilityModeManifest(model: CapabilityModeModel): CapabilityModeManifest | null {
  const resolution = resolveCapabilityModeEvidence(model);
  return resolution.state === "resolved" ? resolution.manifest : null;
}
