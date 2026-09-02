import { createHash } from "node:crypto";
import path from "node:path";

import {
  assertValidManifest,
  type NomiRenderAsset,
  type NomiRenderManifestV1,
} from "./exportManifest";
import type { ExportProfile } from "./exportTypes";

export type ExportAuditAsset = Omit<NomiRenderAsset, "absolutePath"> & {
  sourceDigest: string;
};

export type ExportAuditTextOverlay = {
  id: string;
  startFrame: number;
  endFrame: number;
  contentDigest: string;
};

export type ExportAuditManifestV1 = Omit<NomiRenderManifestV1, "assets"> & {
  assets: Record<string, ExportAuditAsset>;
  textOverlays?: ExportAuditTextOverlay[];
  execution: { backend: "filtergraph" | "webm" };
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field} must be a non-empty string`);
  return normalized;
}

function integer(value: unknown, field: string, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min) throw new Error(`${field} must be an integer >= ${min}`);
  return Number(value);
}

function digest(value: string): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function exportAuditManifestDigest(manifest: ExportAuditManifestV1): string {
  assertValidExportAuditManifest(manifest);
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const AUDIT_ASSET_METADATA = [
  "durationSeconds",
  "width",
  "height",
  "fps",
  "videoCodec",
  "audioCodec",
  "hasAudio",
  "sampleRate",
  "channels",
] as const;

function auditAssets(value: unknown): Record<string, ExportAuditAsset> {
  const rawAssets = record(value, "assets");
  const result: Record<string, ExportAuditAsset> = {};
  for (const [assetId, rawValue] of Object.entries(rawAssets)) {
    const raw = record(rawValue, `assets.${assetId}`);
    const id = nonEmptyString(raw.id, `assets.${assetId}.id`);
    const kind = raw.kind;
    if (kind !== "image" && kind !== "video" && kind !== "audio") {
      throw new Error(`assets.${assetId}.kind must be image, video, or audio`);
    }
    const url = typeof raw.url === "string" && raw.url.length > 0 ? raw.url : null;
    const absolutePath = typeof raw.absolutePath === "string" && raw.absolutePath.length > 0 ? raw.absolutePath : null;
    if (url && absolutePath) throw new Error(`assets.${assetId} cannot include both url and absolutePath`);
    const source = url ?? absolutePath;
    if (!source) throw new Error(`assets.${assetId} must include one source URL or absolutePath`);
    const asset: ExportAuditAsset = { id, kind, sourceDigest: digest(source) };
    for (const field of AUDIT_ASSET_METADATA) {
      if (raw[field] !== undefined) (asset as unknown as Record<string, unknown>)[field] = jsonClone(raw[field]);
    }
    result[assetId] = asset;
  }
  return result;
}

function auditTextOverlays(value: unknown): ExportAuditTextOverlay[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("textOverlays must be an array when present");
  return value.map((entry, index) => {
    const raw = record(entry, `textOverlays[${index}]`);
    const startFrame = integer(raw.startFrame, `textOverlays[${index}].startFrame`);
    const endFrame = integer(raw.endFrame, `textOverlays[${index}].endFrame`);
    if (endFrame <= startFrame) throw new Error(`textOverlays[${index}].endFrame must be greater than startFrame`);
    return {
      id: nonEmptyString(raw.id, `textOverlays[${index}].id`),
      startFrame,
      endFrame,
      contentDigest: digest(nonEmptyString(raw.pngBase64, `textOverlays[${index}].pngBase64`)),
    };
  });
}

function validationManifest(audit: ExportAuditManifestV1): NomiRenderManifestV1 {
  const assets = Object.fromEntries(
    Object.entries(audit.assets).map(([assetId, asset]) => [
      assetId,
      {
        ...asset,
        absolutePath: path.resolve(path.sep, "nomi-export-audit", asset.sourceDigest),
        sourceDigest: undefined,
      },
    ]),
  ) as NomiRenderManifestV1["assets"];
  return {
    version: audit.version,
    projectId: audit.projectId,
    createdAt: audit.createdAt,
    timeline: audit.timeline,
    profile: audit.profile,
    assets,
    ...(audit.diagnostics ? { diagnostics: audit.diagnostics } : {}),
  };
}

export function assertValidExportAuditManifest(value: unknown): asserts value is ExportAuditManifestV1 {
  const raw = record(value, "audit manifest");
  const execution = record(raw.execution, "execution");
  if (execution.backend !== "filtergraph" && execution.backend !== "webm") {
    throw new Error("execution.backend must be filtergraph or webm");
  }
  const assets = record(raw.assets, "assets");
  for (const [assetId, rawAsset] of Object.entries(assets)) {
    const asset = record(rawAsset, `assets.${assetId}`);
    if (!/^[a-f0-9]{64}$/.test(String(asset.sourceDigest ?? ""))) {
      throw new Error(`assets.${assetId}.sourceDigest must be a sha256 digest`);
    }
    if ("url" in asset || "absolutePath" in asset) throw new Error(`assets.${assetId} cannot persist source paths or URLs`);
  }
  if (raw.textOverlays !== undefined) {
    if (!Array.isArray(raw.textOverlays)) throw new Error("textOverlays must be an array when present");
    raw.textOverlays.forEach((entry, index) => {
      const overlay = record(entry, `textOverlays[${index}]`);
      nonEmptyString(overlay.id, `textOverlays[${index}].id`);
      const startFrame = integer(overlay.startFrame, `textOverlays[${index}].startFrame`);
      const endFrame = integer(overlay.endFrame, `textOverlays[${index}].endFrame`);
      if (endFrame <= startFrame) throw new Error(`textOverlays[${index}].endFrame must be greater than startFrame`);
      if (!/^[a-f0-9]{64}$/.test(String(overlay.contentDigest ?? ""))) {
        throw new Error(`textOverlays[${index}].contentDigest must be a sha256 digest`);
      }
    });
  }
  assertValidManifest(validationManifest(raw as ExportAuditManifestV1));
}

export function createExportAuditManifest(
  value: unknown,
  input: Readonly<{
    projectId: string;
    backend: "filtergraph" | "webm";
    effectiveProfile?: unknown;
  }>,
): ExportAuditManifestV1 {
  const raw = record(value, "manifest");
  const projectId = nonEmptyString(input.projectId, "projectId");
  if (raw.projectId !== projectId) throw new Error("Export job projectId must match manifest.projectId");
  const audit: ExportAuditManifestV1 = {
    version: raw.version as 1,
    projectId,
    createdAt: nonEmptyString(raw.createdAt, "createdAt"),
    timeline: jsonClone(raw.timeline) as NomiRenderManifestV1["timeline"],
    profile: jsonClone(input.effectiveProfile ?? raw.profile) as ExportProfile,
    assets: auditAssets(raw.assets),
    ...(raw.diagnostics === undefined
      ? {}
      : { diagnostics: jsonClone(raw.diagnostics) as { warnings: string[] } }),
    ...(raw.textOverlays === undefined ? {} : { textOverlays: auditTextOverlays(raw.textOverlays) }),
    execution: { backend: input.backend },
  };
  assertValidExportAuditManifest(audit);
  return deepFreeze(audit);
}

export function deriveWebmExecutionManifest(audit: ExportAuditManifestV1): NomiRenderManifestV1 {
  assertValidExportAuditManifest(audit);
  if (audit.execution.backend !== "webm") throw new Error("WebM execution requires a WebM audit manifest");
  const execution: NomiRenderManifestV1 = {
    version: 1,
    projectId: audit.projectId,
    createdAt: audit.createdAt,
    timeline: { ...audit.timeline, tracks: [] },
    profile: audit.profile,
    assets: {},
    ...(audit.diagnostics ? { diagnostics: audit.diagnostics } : {}),
  };
  assertValidManifest(execution);
  return execution;
}

export function serializeExportAuditManifest(manifest: ExportAuditManifestV1): string {
  assertValidExportAuditManifest(manifest);
  return JSON.stringify(manifest, null, 2);
}
