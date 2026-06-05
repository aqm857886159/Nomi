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
};

/** 跨模型统一的「意图」——UI 主标签按它走（角色参考/单图首帧/首尾帧/文生/视频编辑）。 */
export type ArchetypeIntent = "text" | "single" | "firstlast" | "character" | "edit";

/**
 * 该档案的所有模式打到哪条 mapping（catalog mapping 按 (vendor, taskKind) 寻址）。**显式声明，不靠
 * 启发式猜**——避免「omni 无首帧 → 误判 text_to_video → 撞到别的模型的 mapping」这类 bug。
 * 同一档案的所有模式都打同一个 createTask 端点（供应商按 model enum 自分流），故只需一个值。
 */
export type ArchetypeTransportTaskKind = "text_to_video" | "image_to_video";

export type ArchetypeMode = {
  id: string;
  intent: ArchetypeIntent;
  /** 该模型自己的叫法（副标签，如 Seedance 的「全能参考」）。 */
  vendorTerm: string;
  hint: string;
  slots: ArchetypeReferenceSlot[];
  /** 标量参数：复用现有控件类型（规则 1，不另造）。 */
  params: ModelParameterControl[];
  promptRequired: boolean;
  /**
   * 该模式发请求时用的 model enum，覆盖 catalog 行的 modelKey（评审 M3）。HappyHorse 把 4 个端点
   * （text/image/reference/video-to-video）合成 1 个 catalog 条目，靠 per-mode enum 区分。
   * 缺省（如 Seedance 三模式同 model）→ 用 catalog 的 modelKey。
   */
  modelEnum?: string;
};

export type ModelArchetype = {
  id: string; // 'seedance-2'
  family: string; // 'seedance'
  label: string; // 'Seedance 2.0'
  kind: "video";
  modes: ArchetypeMode[];
  defaultModeId: string;
  /** 该档案所有模式打到哪条 mapping（显式，不靠启发式）。见 ArchetypeTransportTaskKind。 */
  transportTaskKind: ArchetypeTransportTaskKind;
  /**
   * 识别用：模型身份（modelKey/别名）匹配这些 pattern 之一就套这套档案。
   * 匹配规则见 resolveArchetypeForModel —— 按「整串相等」或「去掉 vendor 前缀后的末段相等」，
   * 故 'seedance-2' 不会误命中 'seedance-2-fast'。
   */
  identifierPatterns: string[];
};
