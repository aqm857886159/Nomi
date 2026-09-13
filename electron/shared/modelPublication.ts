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

  // A certified active revision is the strongest evidence: it names exactly which
  // modes were proven. Without one the row still publishes whatever its enabled
  // mappings and scripts declare.
  //
  // 这一条是 2026-09-11 拍板的不变量：**自检失败不下架**。此前 `meta.adapter` 一存在就改判
  // 「只认 activeRevision」，而一次失败的自检恰好只写 `adapter.state="failed"`、不写
  // activeRevision —— 于是一个手动配好、本来能在画布模型框里选到的模型，按一次「验证」按钮
  // 就永久消失，且没有回头路（单向门）。自检只增不减：它能把一行从「未试跑」升格为「已验证」，
  // 永远不能把它降到比没自检过更差。回归钉子见 modelPublication.test.ts。
  if (activeRevision) {
    if (Array.isArray(adapter?.modes)) {
      for (const rawMode of adapter.modes) {
        const mode = record(rawMode);
        const taskKind = mode?.taskKind as ProfileKind;
        if (mode?.state === "verified" && typeof mode.taskKind === "string" && supported.includes(taskKind)) {
          modes.add(taskKind);
        }
      }
    }
  } else {
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
  }
  for (const taskKind of customCallModes(model, supported)) modes.add(taskKind);
  if (model.kind === "text") modes.add("chat");

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
