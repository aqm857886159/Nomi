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
  mediaKind?: "image" | "video" | "audio";
  options: ModelParameterControlOption[];
  /**
   * Intersect options when another parameter has the declared value, or when a reference slot of this mode is empty
   * (`slotEmpty`: e.g. Kling 4.0 Flash `origin` requires a reference video). Judged by crossFieldConstraints only.
   */
  optionConstraints?: {
    when: { key: string; value: string | number | boolean } | { slotEmpty: ArchetypeReferenceSlotKind };
    values: (string | number | boolean)[];
  }[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /**
   * 数字参数的常用档（面板里摊成一排可点项，末尾一格「自定义」打开数字框，范围仍是 min–max）。只给 number 用；
   * 没有 = 照旧按区间画滑杆 / 数字框。
   */
  presets?: number[];
  /** 面板里这一项下面的一行小字（说明这个值的后果，如「是上限，可能拆得更少」）；界面按 modelDisplayText 翻译。 */
  note?: string;
  /**
   * 报文写法，只由声明门（paramValue.ts 的 normalizeDeclaredControls）写：供应商文档要字符串数字（`"5"`）的下拉，门里用数字档，
   * 出口（taskParams 的 encodeParamsForWire）按它编回字符串。没有 = 报文就是内部类型本身。档案里不手写。
   */
  wireEncoding?: "numeric-string";
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
  /** A provider may accept fewer inputs than the model itself. */
  vendorMax?: Readonly<Record<string, number>>;
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
  /** Combined file count across this mode's reference slots. */
  maxTotalReferences?: number;
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
  /**
   * 角色数组合并（`referenceChannels.ts` 唯一读点）。`kinds`：只把这几种槽并进去，其余槽留在自己的扁平键上
   * （Wan 2.7 角色参考：图进 image_with_roles，参考视频官方走 video_urls 裸数组）。缺省 = 有角色词的槽全并。
   */
  combineSlotsInto?: { key: string; flat?: boolean; kinds?: ArchetypeReferenceSlotKind[] };
  fixedParams?: Record<string, string>;
  /**
   * 图层分离方式（一张图 → 底图 + 透明图层，结果落成画板里的一组层）。`maxLayers` 含底图。
   * 有它的方式是**人选的任务**、不是图的摆法：按输入挑方式时绝不自动落到它，人手选了也不因多放一张图就被换走
   * （modeForInputs）。名字与判据见 modelArchetypes/layerSplit.ts。
   */
  layerSplit?: { maxLayers: number };
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
  /** Shared model names for handle suggestions across profiles with distinct wire contracts. */
  familyIdentifierPatterns?: readonly string[];
  /** Provider request-body reference inputs with no composer control (headless callers only); see modelArchetypes/referenceKeys. */
  headlessReferenceKeys?: string[];
};
