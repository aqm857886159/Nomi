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
  max: number;
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
