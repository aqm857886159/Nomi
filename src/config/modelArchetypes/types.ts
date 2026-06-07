// 模型档案（Model Archetype）——「这个模型长什么样」的 curated 描述：模式、参考槽、
// 标量参数。**与供应商无关**：档案按模型身份认（identifierPatterns / 显式 meta.archetypeId），
// 不关心是 kie 还是 fal/replicate/自建中转。供应商只管传输（baseURL/鉴权/请求形状）。
//
// 设计原则（用户拍板）：通用第一 —— 任何人、经任何供应商接入同一个模型，都吃到同一套模板。
//
// 规则 1/9：标量参数**复用**现有的 `ModelParameterControl`（src/config/modelCatalogMeta.ts），
// 不另造一套 —— 档案与 onboarding 解析是「两个来源、同一套控件类型」，渲染路径单一。
// 档案只新增现有层没有的概念：模式（modes）、意图（intent）、typed 多参考槽（reference slots，
// 现有层只有按 key 名猜的 image-url，表达不了 character1..N / 视频 / 音频）。

import type { ModelParameterControl } from "../modelCatalogMeta";

export type ArchetypeReferenceSlotKind =
  | "first_frame"
  | "last_frame"
  | "image_ref" // 多图，按序对应 prompt 里的 character1..N
  | "video_ref"
  | "audio_ref"
  | "source_video";

export type ArchetypeReferenceSlot = {
  kind: ArchetypeReferenceSlotKind;
  label: string;
  min: number;
  max: number;
  /**
   * 该模型 API 的输入参数名（模型契约，供应商无关）。缺省时由 kind 推断（见 archetypeMeta
   * SLOT_DEFAULTS）。例：Seedance 全能参考的角色图 = `reference_image_urls`；HappyHorse 角色参考
   * 的角色图 = `reference_image`（不同模型不同名）。供应商的表示层 quirk（如 kie 文档里 key 带尾随
   * 空格 §2 坑1）不在这——只在该供应商 mapping body 写一次（M1）。
   */
  inputKey?: string;
  /** 该输入是否序列化为数组。缺省由 kind 推断（image/video/audio_ref=true，frame=false）。
   *  特例：HappyHorse 单图首帧的 input 是 `image_urls`[正好 1]——单图槽但 asArray=true（包成 1 元素数组）。 */
  asArray?: boolean;
  /** 这些图是否**按序对应 prompt 的 character1..N**（角色参考）。true → 缩略图标 ①②③ + 给 character 提示。
   *  仅角色槽为 true（Seedance 全能参考、HappyHorse 角色参考）；普通参考图（如 video-edit 的参考图）为 false。 */
  characterIndexed?: boolean;
};

/** 跨模型统一的「意图」——UI 主标签按它走（角色参考/单图首帧/首尾帧/文生/视频编辑）。 */
export type ArchetypeIntent = "text" | "single" | "firstlast" | "character" | "edit";

/**
 * 该档案打到哪个 mapping 桶（catalog mapping 按 (vendor, taskKind[, modelKey]) 寻址）。**显式声明，不靠
 * 启发式猜**——避免「omni 无首帧 → 误判 text_to_video → 撞到别的模型的 mapping」这类 bug。
 * 视频档案所有模式同一个值（供应商按 model enum 自分流）；图像档案的文生图/改图 taskKind 不同，
 * 由各模式的 `ArchetypeMode.transportTaskKind` 覆盖档案级值。
 */
export type ArchetypeTransportTaskKind = "text_to_video" | "image_to_video" | "text_to_image" | "image_edit";

export type ArchetypeMode = {
  id: string;
  intent: ArchetypeIntent;
  /** 该模型自己的叫法（副标签，如 Seedance 的「全能参考」）。 */
  vendorTerm: string;
  hint: string;
  slots: ArchetypeReferenceSlot[];
  /** 标量参数：复用现有控件类型（规则 1，不另造）。供应商无关的**缺省**集；某供应商字段枚举不同时用 vendorParams 覆盖。 */
  params: ModelParameterControl[];
  /**
   * B 档案分层（用户拍板 2026-06-07）：同一模型身份在不同供应商下**标量参数枚举不同**时，
   * 按 vendorKey 覆盖 `params`。例：Seedream 文生图在 kie 是 quality(basic/high)，在 apimart 是
   * resolution(2K/4K) —— 字段名+取值都不同，模板引擎只透传不翻译，故 UI 控件本身要按供应商不同。
   * 缺省（绝大多数模式两家一致或只一家有）不写；解析时 resolveArchetypeForModel 按模型 vendorKey 特化。
   * **身份与能力形状（id/family/label/modes/slots/intent）仍供应商无关**——只 params 这一层分供应商（P4）。
   */
  vendorParams?: Record<string, ModelParameterControl[]>;
  promptRequired: boolean;
  /**
   * 该模式发请求时用的 model enum，覆盖 catalog 行的 modelKey（评审 M3）。HappyHorse 把 4 个端点
   * （text/image/reference/video-to-video）合成 1 个 catalog 条目，靠 per-mode enum 区分。
   * 缺省（如 Seedance 三模式同 model）→ 用 catalog 的 modelKey。
   */
  modelEnum?: string;
  /**
   * 覆盖档案级 transportTaskKind（图像档案专用）：文生图模式=`text_to_image`、改图模式=`image_edit`，
   * 两者打不同 mapping 桶。视频档案各模式同 taskKind → 缺省即可，用档案级值。
   */
  transportTaskKind?: ArchetypeTransportTaskKind;
};

export type ModelArchetype = {
  id: string; // 'seedance-2'
  family: string; // 'seedance'
  label: string; // 'Seedance 2.0'
  kind: "video" | "image";
  modes: ArchetypeMode[];
  defaultModeId: string;
  /** 该档案默认打到哪个 mapping 桶（显式，不靠启发式）。图像档案可被 mode.transportTaskKind 覆盖。 */
  transportTaskKind: ArchetypeTransportTaskKind;
  /**
   * 识别用：模型身份（modelKey/别名）匹配这些 pattern 之一就套这套档案。
   * 匹配规则见 resolveArchetypeForModel —— 按「整串相等」或「去掉 vendor 前缀后的末段相等」，
   * 故 'seedance-2' 不会误命中 'seedance-2-fast'。
   */
  identifierPatterns: string[];
};
