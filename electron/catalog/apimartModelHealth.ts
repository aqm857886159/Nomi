import { createHash } from "node:crypto";
import { APIMART_AUDIO_MODELS } from "./apimartAudios";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { EVERY_VARIANT, modeTransportFor, resolveModelArchetype } from "../shared/modelArchetypes";
import type { HttpOperation, ProfileKind } from "./types";
import type { ArchetypeMode, ArchetypeReferenceSlot } from "../shared/modelArchetypes/types";

/** The zero-cost health inventory is derived from the curated catalog, never hand-maintained. */
export const APIMART_GENERATION_TASK_KINDS = [
  "text_to_image", "image_edit", "text_to_video", "image_to_video", "text_to_audio",
] as const satisfies readonly ProfileKind[];

type GenerationTaskKind = (typeof APIMART_GENERATION_TASK_KINDS)[number];
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ApimartHealthEntry = {
  vendor: "apimart";
  modelKey: string;
  kind: "image" | "video" | "audio";
  archetypeId: string;
  modeId: string;
  taskKind: GenerationTaskKind;
  labelZh: string;
  documentationKeys: string[];
  params: JsonValue;
  referenceChannels: JsonValue;
  contract: {
    create: JsonValue;
    query: JsonValue | null;
    statusMapping: JsonValue | null;
    paramMap: JsonValue | null;
    referenceChannels: JsonValue;
  };
  contractFingerprint: string;
};

export type ApimartRecordingMetadata = {
  modelKey: string;
  modeId: string;
  taskKind: GenerationTaskKind;
  contractFingerprint: string;
  path?: string;
};

export type ApimartRecordingStatus = ApimartRecordingMetadata & {
  status: "recorded" | "recorded-stale" | "pending-L3";
};

type CatalogModel = {
  modelKey: string;
  labelZh: string;
  kind: "image" | "video" | "audio";
  archetypeId: string;
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation; query?: HttpOperation; statusMapping?: Record<string, string[]> }[];
};

const MODE_KINDS = new Set<string>(APIMART_GENERATION_TASK_KINDS);
const CATALOG_MODELS: CatalogModel[] = [
  ...APIMART_IMAGE_MODELS.map((m) => ({ ...m, kind: "image" as const })),
  ...APIMART_VIDEO_MODELS.map((m) => ({ ...m, kind: "video" as const })),
  ...APIMART_AUDIO_MODELS.map((m) => ({ ...m, kind: "audio" as const })),
];

/** Catalog operations are plain data: a JSON round trip drops undefined fields exactly as the fingerprint expects. */
const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

/** Canonical JSON: object key order is irrelevant; array order remains meaningful. */
export function stableSerialize(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.keys(input as Record<string, unknown>).sort().map((key) => [key, canonical((input as Record<string, unknown>)[key])]));
    }
    return input;
  };
  return JSON.stringify(canonical(value));
}

export function contractFingerprint(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
}

function modeFor(archetypeId: string, modelKey: string, taskKind: ProfileKind, index: number): ArchetypeMode | null {
  // 体检指纹记的是这一行全部档的参数范围（以前就是这样；按行那一档收窄会让 Seedance 等带档的指纹整体换一遍——这一刀不改，见设计卡「拿不准的调用点」）。
  const archetype = resolveModelArchetype({ modelKey, vendorKey: "apimart", meta: { archetypeId } }, { variant: EVERY_VARIANT });
  if (!archetype) return null;
  const modes = archetype.modes.filter((mode) => modeTransportFor(mode, archetype, "apimart") === taskKind);
  return modes[index] ?? modes[0] ?? null;
}

function parameterRange(mode: ArchetypeMode | null): JsonValue {
  if (!mode) return [];
  return mode.params.map((param) => ({
    key: param.key,
    type: param.type,
    defaultValue: param.defaultValue ?? null,
    min: param.min ?? null,
    max: param.max ?? null,
    step: param.step ?? null,
    options: param.options.map((option) => option.value),
    optionConstraints: (param.optionConstraints ?? []).map((constraint) => ({ when: constraint.when, values: constraint.values })),
  }));
}

function referenceChannels(mode: ArchetypeMode | null, create: HttpOperation): JsonValue {
  const slots = (mode?.slots ?? []).map((slot: ArchetypeReferenceSlot) => ({
    kind: slot.kind, inputKey: slot.inputKey ?? null, min: slot.min, max: slot.max ?? null,
    asArray: slot.asArray ?? null, characterIndexed: slot.characterIndexed ?? false,
  }));
  const body = create.body && typeof create.body === "object" ? create.body as Record<string, unknown> : {};
  const wireKeys = Object.keys(body).filter((key) => /(?:image|video|audio|reference|frame|_urls$)/i.test(key)).sort();
  return { slots, wireKeys };
}

function entryFor(model: CatalogModel, mapping: CatalogModel["mappings"][number], modeIndex: number): ApimartHealthEntry | null {
  if (!MODE_KINDS.has(mapping.taskKind)) return null;
  const taskKind = mapping.taskKind as GenerationTaskKind;
  const mode = modeFor(model.archetypeId, model.modelKey, taskKind, modeIndex);
  const references = referenceChannels(mode, mapping.create);
  const params = { mode: parameterRange(mode) };
  // `nomi-audio` is Nomi's combined catalog alias; the APIMart wire model is the
  // mode's declared modelEnum (for example gpt-4o-mini-tts). Inventory reports
  // the upstream identity so the health list never pretends the alias is vendor-owned.
  const reportedModelKey = model.modelKey === "nomi-audio" ? (mode?.modelEnum ?? model.modelKey) : model.modelKey;
  const documentationKeys = [
    model.modelKey,
    mode?.modelEnum,
  ].filter((value): value is string => Boolean(value && !value.includes("{{")));
  const contract = {
    create: jsonValue(mapping.create),
    query: mapping.query ? jsonValue(mapping.query) : null,
    statusMapping: mapping.statusMapping ? jsonValue(mapping.statusMapping) : null,
    paramMap: mapping.create.paramMap ? jsonValue(mapping.create.paramMap) : null,
    referenceChannels: references,
  };
  return {
    vendor: "apimart", modelKey: reportedModelKey, kind: model.kind, archetypeId: model.archetypeId, documentationKeys: [...new Set(documentationKeys)],
    modeId: mode?.id ?? mapping.id, taskKind, labelZh: mapping.name, params, referenceChannels: references,
    contract, contractFingerprint: contractFingerprint(contract),
  };
}

export function buildApimartHealthInventory(): ApimartHealthEntry[] {
  return CATALOG_MODELS.flatMap((model) => {
    const seenKinds = new Map<ProfileKind, number>();
    return model.mappings.flatMap((mapping) => {
      const index = seenKinds.get(mapping.taskKind) ?? 0;
      seenKinds.set(mapping.taskKind, index + 1);
      const entry = entryFor(model, mapping, index);
      return entry ? [entry] : [];
    });
  });
}

function healthKey(item: Pick<ApimartHealthEntry, "modelKey" | "modeId" | "taskKind">): string {
  return `${item.modelKey}\u0000${item.modeId}\u0000${item.taskKind}`;
}

export function buildApimartRecordingStatus(
  entries: readonly ApimartHealthEntry[],
  recordings: readonly ApimartRecordingMetadata[],
): ApimartRecordingStatus[] {
  const byKey = new Map(recordings.map((recording) => [healthKey(recording), recording]));
  return entries.map((entry) => {
    const recording = byKey.get(healthKey(entry));
    if (!recording) return { modelKey: entry.modelKey, modeId: entry.modeId, taskKind: entry.taskKind, contractFingerprint: entry.contractFingerprint, status: "pending-L3" as const };
    return {
      ...recording,
      status: recording.contractFingerprint === entry.contractFingerprint ? "recorded" as const : "recorded-stale" as const,
    };
  });
}
