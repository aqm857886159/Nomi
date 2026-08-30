import { defaultCustomCallTaskKind, resolveCapabilityModeEvidence } from "./capabilityModeManifest";
import type { BillingModelKind, ProfileKind } from "../catalog/types";

export type PublishedExecutionModel = {
  enabled?: boolean;
  vendorKey?: string;
  modelKey?: string;
  kind?: string;
  meta?: unknown;
  customCall?: {
    script?: unknown;
    modes?: Record<string, { script?: unknown } | null | undefined>;
  } | null;
};

export type PublishedExecutionMapping = {
  enabled?: boolean;
  vendorKey?: string;
  modelKey?: string;
  taskKind?: string;
};

export type PublishedExecutionEvidence = {
  mappings?: readonly PublishedExecutionMapping[];
  /** Retained for source compatibility; legacy publication is always text-only. */
  legacyWithoutAdapter?: "preserve-enabled" | "text-only";
};

export type PublishedExecution = {
  published: boolean;
  publishedModes: ProfileKind[];
};

export const ADAPTER_PUBLICATION_MODES = "publicationModes";

export type AdapterPublicationModeMask = {
  present: boolean;
  modes: ProfileKind[];
};

const EXECUTABLE_TASKS_BY_KIND: Record<BillingModelKind, readonly ProfileKind[]> = {
  text: ["chat", "prompt_refine"],
  image: ["text_to_image", "image_edit"],
  video: ["text_to_video", "image_to_video"],
  audio: ["text_to_audio", "image_to_audio", "transcribe"],
  model3d: ["text_to_3d", "image_to_3d"],
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** A present mask is authoritative; malformed values fail closed to zero modes. */
export function adapterPublicationModeMask(meta: unknown): AdapterPublicationModeMask {
  const adapter = record(record(meta)?.adapter);
  if (!adapter || !Object.prototype.hasOwnProperty.call(adapter, ADAPTER_PUBLICATION_MODES)) {
    return { present: false, modes: [] };
  }
  const raw = adapter[ADAPTER_PUBLICATION_MODES];
  if (!Array.isArray(raw)) return { present: true, modes: [] };
  return {
    present: true,
    modes: [...new Set(raw.filter((mode): mode is ProfileKind => typeof mode === "string"))],
  };
}

export function withAdapterPublicationModeMask(meta: unknown, modes: readonly ProfileKind[]): Record<string, unknown> {
  const currentMeta = record(meta) || {};
  return {
    ...currentMeta,
    adapter: {
      ...(record(currentMeta.adapter) || {}),
      [ADAPTER_PUBLICATION_MODES]: [...new Set(modes)],
    },
  };
}

function nonEmptyScript(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim());
}

function contractedCustomCallModes(
  manifest: { modes: Record<string, ProfileKind> },
  scriptedModeIds: ReadonlySet<string>,
  supported: readonly ProfileKind[],
): ProfileKind[] {
  return Object.entries(manifest.modes)
    .filter(([modeId, taskKind]) => scriptedModeIds.has(modeId) && supported.includes(taskKind))
    .map(([, taskKind]) => taskKind);
}

function customCallModes(model: PublishedExecutionModel, supported: readonly ProfileKind[]): ProfileKind[] {
  const customCall = model.customCall;
  if (!customCall) return [];
  const resolution = resolveCapabilityModeEvidence(model);
  if (resolution.state === "invalid-explicit") return [];
  const published = new Set<ProfileKind>();
  if (resolution.state !== "resolved" || resolution.source !== "explicit") {
    const defaultTask = defaultCustomCallTaskKind(model.kind);
    if (nonEmptyScript(customCall.script) && defaultTask && supported.includes(defaultTask)) published.add(defaultTask);
  }
  const scriptedModeIds = new Set(
    Object.entries(customCall.modes || {})
      .filter(([, mode]) => nonEmptyScript(mode?.script))
      .map(([modeId]) => modeId),
  );
  if (scriptedModeIds.size === 0) return [...published];

  if (resolution.state === "resolved") {
    for (const taskKind of contractedCustomCallModes(resolution.manifest, scriptedModeIds, supported)) published.add(taskKind);
  }
  return [...published];
}

export function derivePublishedExecution(
  model: PublishedExecutionModel | null | undefined,
  evidence: PublishedExecutionEvidence = {},
): PublishedExecution {
  if (!model?.enabled) return { published: false, publishedModes: [] };
  const supported = EXECUTABLE_TASKS_BY_KIND[model.kind as BillingModelKind] || [];
  const modes = new Set<ProfileKind>();
  const adapter = record(record(model.meta)?.adapter);
  const publicationMask = adapterPublicationModeMask(model.meta);
  const activeRevision = typeof adapter?.activeRevision === "string" && Boolean(adapter.activeRevision.trim());
  const restoredPredecessorPublication = Boolean(adapter)
    && publicationMask.present
    && !Object.keys(adapter || {}).some((key) => key !== ADAPTER_PUBLICATION_MODES);

  // Adapter metadata means this row belongs to the certification domain. Raw
  // enabled mappings or scripts are staging declarations, never publication
  // evidence. Only a certified active revision may contribute executable modes.
  if (!adapter) {
    for (const mapping of evidence.mappings || []) {
      if (
        mapping.enabled === true &&
        mapping.vendorKey === model.vendorKey &&
        supported.includes(mapping.taskKind as ProfileKind) &&
        (!mapping.modelKey || mapping.modelKey.trim() === model.modelKey)
      ) {
        modes.add(mapping.taskKind as ProfileKind);
      }
    }
    for (const taskKind of customCallModes(model, supported)) modes.add(taskKind);
  } else if (activeRevision) {
    if (Array.isArray(adapter.modes)) {
      for (const rawMode of adapter.modes) {
        const mode = record(rawMode);
        const taskKind = mode?.taskKind as ProfileKind;
        if (mode?.state === "verified" && typeof mode.taskKind === "string" && supported.includes(taskKind)) {
          modes.add(taskKind);
        }
      }
    }
    for (const taskKind of customCallModes(model, supported)) modes.add(taskKind);
    if (model.kind === "text") modes.add("chat");
  } else if (restoredPredecessorPublication) {
    // Candidate deletion is a certification-domain command. It restores the
    // predecessor by writing a publication-only adapter mask, while the old
    // executable mappings/scripts remain the concrete evidence. Renderer raw
    // writes cannot create this marker (rendererCatalogMutation strips it).
    for (const mapping of evidence.mappings || []) {
      if (mapping.enabled === true && mapping.vendorKey === model.vendorKey
        && (!mapping.modelKey || mapping.modelKey === model.modelKey)
        && supported.includes(mapping.taskKind as ProfileKind)) modes.add(mapping.taskKind as ProfileKind);
    }
    for (const taskKind of customCallModes(model, supported)) modes.add(taskKind);
    if (model.kind === "text") modes.add("chat");
  }

  if (!adapter && model.kind === "text") modes.add("chat");
  const allowed = publicationMask.present ? new Set(publicationMask.modes) : null;
  const publishedModes = supported.filter((taskKind) => modes.has(taskKind) && (!allowed || allowed.has(taskKind)));
  return {
    published: publishedModes.length > 0,
    publishedModes,
  };
}

export function modelHasPublishedExecution(
  model: PublishedExecutionModel | null | undefined,
  evidence: PublishedExecutionEvidence = {},
): boolean {
  return derivePublishedExecution(model, evidence).published;
}
