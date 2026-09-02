/**
 * Pure, serializable capability facts shared by renderer and Electron.
 *
 * This module intentionally has no Electron, React, filesystem, i18n or
 * provider imports. Provider wire names stay in the facts; the common layer
 * only describes the shape and constraints needed by planning.
 */

export type ModelParameterControlType = "select" | "number" | "text" | "boolean" | "image-url";

export type ModelParameterControlOption = {
  value: string | number | boolean;
  label: string;
  priceLabel?: string;
};

export type ModelParameterControl = {
  key: string;
  label: string;
  type: ModelParameterControlType;
  /** Media-reference controls retain the declared asset kind; older controls default to image. */
  mediaKind?: "image" | "video";
  options: ModelParameterControlOption[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
};

export type ArchetypeReferenceSlotKind =
  | "first_frame"
  | "last_frame"
  | "image_ref"
  | "video_ref"
  | "audio_ref"
  | "source_video";

export type ArchetypeReferenceSlot = {
  kind: ArchetypeReferenceSlotKind;
  label: string;
  min: number;
  /** Absent when the provider has not published a reference count limit. */
  max?: number;
  inputKey?: string;
  asArray?: boolean;
  characterIndexed?: boolean;
  requiresAnyOf?: ArchetypeReferenceSlotKind[];
  roleName?: string;
};

export type ArchetypeExpressionChannel = {
  signal: string;
  via: "prompt" | "reference_slot" | "structured_parameter";
  status: "documented" | "unsupported" | "unknown";
  slotKind?: ArchetypeReferenceSlotKind;
  parameterKey?: string;
  parameterPath?: string;
  evidence?: ArchetypeSource;
};

export type ArchetypeIntent = "text" | "single" | "firstlast" | "character" | "edit";

export type ArchetypeTransportTaskKind =
  | "text_to_video"
  | "image_to_video"
  | "text_to_image"
  | "image_edit"
  | "text_to_audio"
  | "transcribe"
  | "text_to_3d"
  | "image_to_3d";

export type ArchetypeMode = {
  id: string;
  intent: ArchetypeIntent;
  vendorTerm: string;
  hint: string;
  slots: ArchetypeReferenceSlot[];
  expressionChannels?: ArchetypeExpressionChannel[];
  params: ModelParameterControl[];
  vendorParams?: Record<string, ModelParameterControl[]>;
  promptRequired: boolean;
  modelEnum?: string;
  transportTaskKind?: ArchetypeTransportTaskKind;
  /**
   * Vendor-specialized transport bucket (second vendor specialization axis, sibling of
   * `vendorParams`). One model identity can be routed to different mapping buckets per vendor:
   * kie funnels every minimax-h3 / happyhorse scenario through one createTask endpoint, while
   * Runway posts the same models' image modes to `/v1/image_to_video`.
   *
   * Precedence: `vendorTransportTaskKind[vendor]` > mode `transportTaskKind` > archetype
   * `transportTaskKind`. Read it **only** through `modeTransportFor()` (./modeTransport) —
   * a hand-written `mode.transportTaskKind ?? archetype.transportTaskKind` re-creates the
   * second source of truth this field exists to remove.
   */
  vendorTransportTaskKind?: Record<string, ArchetypeTransportTaskKind>;
  combineSlotsInto?: { key: string; flat?: boolean };
  fixedParams?: Record<string, string>;
};

export type ModelArchetypeVariant = {
  id: string;
  label: string;
  modelKey: string;
  identifierPatterns?: string[];
  paramOverrides?: Record<string, (params: ModelParameterControl[]) => ModelParameterControl[]>;
};

export type ArchetypeSource = {
  url: string;
  checkedAt: string;
  vendorKey?: string;
  covers?: string;
};

export type ModelArchetype = {
  /** Older shared profile IDs accepted only when model identity matches this profile. */
  legacyIds?: string[];
  id: string;
  family: string;
  label: string;
  kind: "video" | "image" | "audio" | "model3d";
  sources?: ArchetypeSource[];
  modes: ArchetypeMode[];
  defaultModeId: string;
  variants?: ModelArchetypeVariant[];
  defaultVariantId?: string;
  catalogModelKey?: string;
  variantIdAliases?: Record<string, string>;
  transportTaskKind: ArchetypeTransportTaskKind;
  identifierPatterns: string[];
};
