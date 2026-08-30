import type {
  ArchetypeIntent,
  ArchetypeMode,
  ArchetypeReferenceSlot,
  ArchetypeReferenceSlotKind,
  ArchetypeTransportTaskKind,
  ModelArchetype,
  ModelParameterControl,
  ModelParameterControlOption,
} from "./videoCapabilities/types";

export const CUSTOM_CAPABILITY_CONTRACT_META_KEY = "customCapabilityContract";
export const CUSTOM_CAPABILITY_CONTRACT_VERSION = 1 as const;

export type CustomCapabilityModeV1 = Pick<
  ArchetypeMode,
  | "id"
  | "intent"
  | "vendorTerm"
  | "hint"
  | "slots"
  | "params"
  | "promptRequired"
  | "transportTaskKind"
  | "fixedParams"
  | "combineSlotsInto"
>;

export type CustomCapabilityContractV1 = Pick<
  ModelArchetype,
  "kind" | "defaultModeId" | "transportTaskKind"
> & {
  version: typeof CUSTOM_CAPABILITY_CONTRACT_VERSION;
  modes: CustomCapabilityModeV1[];
};

type UnknownRecord = Record<string, unknown>;

const MAX_CONTRACT_JSON_CHARS = 200_000;
const MAX_MODES = 16;
const MAX_SLOTS_PER_MODE = 16;
const MAX_REFERENCES_PER_SLOT = 64;
const MAX_PARAMS_PER_MODE = 64;
const MAX_OPTIONS_PER_PARAM = 128;
const MAX_FIXED_PARAMS_PER_MODE = 32;
const MAX_KEY_CHARS = 128;
const MAX_LABEL_CHARS = 160;
const MAX_HINT_CHARS = 1_000;
const MAX_VALUE_CHARS = 2_000;
const MAX_ABS_NUMBER = 1_000_000_000_000;

const KINDS = new Set<ModelArchetype["kind"]>(["video", "image", "audio", "model3d"]);
const INTENTS = new Set<ArchetypeIntent>(["text", "single", "firstlast", "character", "edit"]);
const SLOT_KINDS = new Set<ArchetypeReferenceSlotKind>([
  "first_frame",
  "last_frame",
  "image_ref",
  "video_ref",
  "audio_ref",
  "source_video",
]);
const TASK_KINDS = new Set<ArchetypeTransportTaskKind>([
  "text_to_video",
  "image_to_video",
  "text_to_image",
  "image_edit",
  "text_to_audio",
  "transcribe",
  "text_to_3d",
  "image_to_3d",
]);
const CONTROL_TYPES = new Set<ModelParameterControl["type"]>([
  "select",
  "number",
  "text",
  "boolean",
  "image-url",
]);
const SINGLE_REFERENCE_KINDS = new Set<ArchetypeReferenceSlotKind>([
  "first_frame",
  "last_frame",
  "source_video",
]);
const RESERVED_KEY_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

const TASK_KINDS_BY_MODEL_KIND: Record<ModelArchetype["kind"], ReadonlySet<ArchetypeTransportTaskKind>> = {
  video: new Set(["text_to_video", "image_to_video"]),
  image: new Set(["text_to_image", "image_edit"]),
  audio: new Set(["text_to_audio", "transcribe"]),
  model3d: new Set(["text_to_3d", "image_to_3d"]),
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayText(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if ((!normalized && !allowEmpty) || normalized.length > maxLength) return null;
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function opaqueString(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if ((!normalized && !allowEmpty) || normalized.length > maxLength || containsControlCharacter(normalized)) return null;
  return normalized;
}

function safeKey(value: unknown): string | null {
  const key = opaqueString(value, MAX_KEY_CHARS);
  if (!key || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) return null;
  if (key.split(".").some((part) => RESERVED_KEY_SEGMENTS.has(part.toLowerCase()))) return null;
  return key;
}

function modeId(value: unknown): string | null {
  const id = opaqueString(value, 64);
  return id && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_ABS_NUMBER
    ? value
    : null;
}

function jsonScalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.length <= MAX_VALUE_CHARS ? value : null;
  if (typeof value === "number") return finiteNumber(value);
  return typeof value === "boolean" ? value : null;
}

function parseOption(value: unknown): ModelParameterControlOption | null {
  if (!isRecord(value)) return null;
  const optionValue = jsonScalar(value.value);
  if (optionValue === null) return null;
  const label = displayText(value.label, MAX_LABEL_CHARS) ?? String(optionValue);
  const priceLabel = value.priceLabel === undefined
    ? null
    : displayText(value.priceLabel, MAX_LABEL_CHARS);
  if (value.priceLabel !== undefined && priceLabel === null) return null;
  return {
    value: optionValue,
    label,
    ...(priceLabel ? { priceLabel } : {}),
  };
}

function scalarMatchesControlType(
  value: string | number | boolean,
  type: ModelParameterControl["type"],
): boolean {
  if (type === "select") return true;
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  return typeof value === "string";
}

function parseParameter(value: unknown): ModelParameterControl | null {
  if (!isRecord(value)) return null;
  const key = safeKey(value.key);
  const label = displayText(value.label, MAX_LABEL_CHARS);
  const type = CONTROL_TYPES.has(value.type as ModelParameterControl["type"])
    ? value.type as ModelParameterControl["type"]
    : null;
  if (!key || !label || !type || !Array.isArray(value.options) || value.options.length > MAX_OPTIONS_PER_PARAM) return null;

  const options = value.options.map(parseOption);
  if (options.some((option) => option === null)) return null;
  const normalizedOptions = options as ModelParameterControlOption[];
  const optionKeys = normalizedOptions.map((option) => `${typeof option.value}:${String(option.value)}`);
  if (new Set(optionKeys).size !== optionKeys.length) return null;
  if (type === "select" ? normalizedOptions.length === 0 : normalizedOptions.length > 0) return null;

  const hasDefault = Object.prototype.hasOwnProperty.call(value, "defaultValue");
  const defaultValue = hasDefault ? jsonScalar(value.defaultValue) : null;
  if (hasDefault && (defaultValue === null || !scalarMatchesControlType(defaultValue, type))) return null;
  if (
    hasDefault &&
    type === "select" &&
    !normalizedOptions.some((option) => option.value === defaultValue)
  ) return null;

  const hasMin = Object.prototype.hasOwnProperty.call(value, "min");
  const hasMax = Object.prototype.hasOwnProperty.call(value, "max");
  const hasStep = Object.prototype.hasOwnProperty.call(value, "step");
  if (type !== "number" && (hasMin || hasMax || hasStep)) return null;
  const min = hasMin ? finiteNumber(value.min) : null;
  const max = hasMax ? finiteNumber(value.max) : null;
  const step = hasStep ? finiteNumber(value.step) : null;
  if ((hasMin && min === null) || (hasMax && max === null) || (hasStep && (step === null || step <= 0))) return null;
  if (min !== null && max !== null && min > max) return null;
  if (typeof defaultValue === "number" && ((min !== null && defaultValue < min) || (max !== null && defaultValue > max))) return null;

  const placeholder = value.placeholder === undefined
    ? null
    : displayText(value.placeholder, MAX_LABEL_CHARS, true);
  if (value.placeholder !== undefined && placeholder === null) return null;

  return {
    key,
    label,
    type,
    options: normalizedOptions,
    ...(hasDefault ? { defaultValue: defaultValue as string | number | boolean } : {}),
    ...(min !== null ? { min } : {}),
    ...(max !== null ? { max } : {}),
    ...(step !== null ? { step } : {}),
    ...(placeholder ? { placeholder } : {}),
  };
}

function parseSlot(value: unknown): ArchetypeReferenceSlot | null {
  if (!isRecord(value)) return null;
  const kind = SLOT_KINDS.has(value.kind as ArchetypeReferenceSlotKind)
    ? value.kind as ArchetypeReferenceSlotKind
    : null;
  const label = displayText(value.label, MAX_LABEL_CHARS);
  const min = value.min;
  const max = value.max;
  if (
    !kind ||
    !label ||
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    typeof min !== "number" ||
    typeof max !== "number" ||
    min < 0 ||
    max < 1 ||
    min > max ||
    max > MAX_REFERENCES_PER_SLOT ||
    (SINGLE_REFERENCE_KINDS.has(kind) && max !== 1)
  ) return null;

  const inputKey = value.inputKey === undefined ? null : safeKey(value.inputKey);
  if (value.inputKey !== undefined && inputKey === null) return null;
  if (value.asArray !== undefined && typeof value.asArray !== "boolean") return null;
  if (value.characterIndexed !== undefined && typeof value.characterIndexed !== "boolean") return null;
  if (value.characterIndexed === true && kind !== "image_ref") return null;
  const roleName = value.roleName === undefined ? null : opaqueString(value.roleName, MAX_KEY_CHARS);
  if (value.roleName !== undefined && roleName === null) return null;

  return {
    kind,
    label,
    min,
    max,
    ...(inputKey ? { inputKey } : {}),
    ...(typeof value.asArray === "boolean" ? { asArray: value.asArray } : {}),
    ...(typeof value.characterIndexed === "boolean" ? { characterIndexed: value.characterIndexed } : {}),
    ...(roleName ? { roleName } : {}),
  };
}

function parseFixedParams(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_FIXED_PARAMS_PER_MODE) return null;
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = safeKey(rawKey);
    const fixedValue = opaqueString(rawValue, MAX_VALUE_CHARS, true);
    if (!key || fixedValue === null) return null;
    result[key] = fixedValue;
  }
  return result;
}

function parseMode(value: unknown, modelKind: ModelArchetype["kind"]): CustomCapabilityModeV1 | null {
  if (!isRecord(value)) return null;
  const id = modeId(value.id);
  const intent = INTENTS.has(value.intent as ArchetypeIntent) ? value.intent as ArchetypeIntent : null;
  const vendorTerm = displayText(value.vendorTerm, MAX_LABEL_CHARS);
  const hint = displayText(value.hint, MAX_HINT_CHARS, true);
  if (!id || !intent || !vendorTerm || hint === null || typeof value.promptRequired !== "boolean") return null;

  const transportTaskKind = value.transportTaskKind === undefined
    ? null
    : TASK_KINDS.has(value.transportTaskKind as ArchetypeTransportTaskKind)
      ? value.transportTaskKind as ArchetypeTransportTaskKind
      : null;
  if (value.transportTaskKind !== undefined && !transportTaskKind) return null;
  if (transportTaskKind && !TASK_KINDS_BY_MODEL_KIND[modelKind].has(transportTaskKind)) return null;

  if (
    !Array.isArray(value.slots) ||
    value.slots.length > MAX_SLOTS_PER_MODE ||
    !Array.isArray(value.params) ||
    value.params.length > MAX_PARAMS_PER_MODE
  ) return null;
  const slots = value.slots.map(parseSlot);
  const params = value.params.map(parseParameter);
  if (slots.some((slot) => slot === null) || params.some((param) => param === null)) return null;
  const normalizedSlots = slots as ArchetypeReferenceSlot[];
  const normalizedParams = params as ModelParameterControl[];
  if (new Set(normalizedSlots.map((slot) => slot.kind)).size !== normalizedSlots.length) return null;
  if (new Set(normalizedParams.map((param) => param.key)).size !== normalizedParams.length) return null;
  const explicitInputKeys = normalizedSlots.flatMap((slot) => slot.inputKey ? [slot.inputKey] : []);
  if (new Set(explicitInputKeys).size !== explicitInputKeys.length) return null;

  const fixedParams = value.fixedParams === undefined ? null : parseFixedParams(value.fixedParams);
  if (value.fixedParams !== undefined && fixedParams === null) return null;
  const fixedKeys = fixedParams ? Object.keys(fixedParams) : [];

  let combineSlotsInto: ArchetypeMode["combineSlotsInto"] | null = null;
  if (value.combineSlotsInto !== undefined) {
    if (!isRecord(value.combineSlotsInto) || normalizedSlots.length === 0) return null;
    const key = safeKey(value.combineSlotsInto.key);
    if (!key || (value.combineSlotsInto.flat !== undefined && typeof value.combineSlotsInto.flat !== "boolean")) return null;
    if (
      value.combineSlotsInto.flat !== true &&
      normalizedSlots.some((slot) => slot.kind === "source_video" && !slot.roleName)
    ) return null;
    combineSlotsInto = { key, ...(value.combineSlotsInto.flat === true ? { flat: true } : {}) };
  }

  const outputKeys = [
    ...(combineSlotsInto ? [combineSlotsInto.key] : explicitInputKeys),
    ...fixedKeys,
    ...normalizedParams.map((param) => param.key),
  ];
  if (new Set(outputKeys).size !== outputKeys.length) return null;

  return {
    id,
    intent,
    vendorTerm,
    hint,
    promptRequired: value.promptRequired,
    ...(transportTaskKind ? { transportTaskKind } : {}),
    slots: normalizedSlots,
    params: normalizedParams,
    ...(fixedParams ? { fixedParams } : {}),
    ...(combineSlotsInto ? { combineSlotsInto } : {}),
  };
}

function normalizeContractUnsafe(value: unknown): CustomCapabilityContractV1 | null {
  if (!isRecord(value) || value.version !== CUSTOM_CAPABILITY_CONTRACT_VERSION) return null;
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" || serialized.length > MAX_CONTRACT_JSON_CHARS) return null;

  const kind = KINDS.has(value.kind as ModelArchetype["kind"])
    ? value.kind as ModelArchetype["kind"]
    : null;
  const defaultModeId = modeId(value.defaultModeId);
  const transportTaskKind = TASK_KINDS.has(value.transportTaskKind as ArchetypeTransportTaskKind)
    ? value.transportTaskKind as ArchetypeTransportTaskKind
    : null;
  if (
    !kind ||
    !defaultModeId ||
    !transportTaskKind ||
    !TASK_KINDS_BY_MODEL_KIND[kind].has(transportTaskKind) ||
    !Array.isArray(value.modes) ||
    value.modes.length === 0 ||
    value.modes.length > MAX_MODES
  ) return null;

  const modes = value.modes.map((mode) => parseMode(mode, kind));
  if (modes.some((mode) => mode === null)) return null;
  const normalizedModes = modes as CustomCapabilityModeV1[];
  const modeIds = normalizedModes.map((mode) => mode.id);
  if (new Set(modeIds).size !== modeIds.length || !modeIds.includes(defaultModeId)) return null;
  const defaultMode = normalizedModes.find((mode) => mode.id === defaultModeId);
  if ((defaultMode?.transportTaskKind ?? transportTaskKind) !== transportTaskKind) return null;

  return {
    version: CUSTOM_CAPABILITY_CONTRACT_VERSION,
    kind,
    defaultModeId,
    transportTaskKind,
    modes: normalizedModes,
  };
}

/** Validate a raw editor draft and return the only shape safe to persist. */
export function normalizeCustomCapabilityContract(value: unknown): CustomCapabilityContractV1 | null {
  try {
    return normalizeContractUnsafe(value);
  } catch {
    return null;
  }
}

/** Parse and normalize a contract from model or canvas metadata. Invalid input is inert. */
export function parseCustomCapabilityContract(meta: unknown): CustomCapabilityContractV1 | null {
  try {
    if (!isRecord(meta)) return null;
    return normalizeCustomCapabilityContract(meta[CUSTOM_CAPABILITY_CONTRACT_META_KEY]);
  } catch {
    return null;
  }
}
