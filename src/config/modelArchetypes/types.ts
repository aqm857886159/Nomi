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
  /**
   * **角色数组合并用**（配合 mode.combineSlotsInto）：该槽在合并出的对象数组里的 `role` 字段值。
   * **缺省由 kind 派生**（first_frame→first_frame、last_frame→last_frame、image_ref→reference_image，
   * 见 archetypeMeta DEFAULT_ROLE_FOR_KIND）——故绝大多数情况不写，避免 role 与 kind 两条平行真相源（P1）。
   * 仅当某 vendor 的 role 措辞与派生值不同时才显式覆盖。
   */
  roleName?: string;
};

/** 跨模型统一的「意图」——UI 主标签按它走（角色参考/单图首帧/首尾帧/文生/视频编辑）。 */
export type ArchetypeIntent = "text" | "single" | "firstlast" | "character" | "edit";

/**
 * 该档案打到哪个 mapping 桶（catalog mapping 按 (vendor, taskKind[, modelKey]) 寻址）。**显式声明，不靠
 * 启发式猜**——避免「omni 无首帧 → 误判 text_to_video → 撞到别的模型的 mapping」这类 bug。
 * 视频档案所有模式同一个值（供应商按 model enum 自分流）；图像档案的文生图/改图 taskKind 不同，
 * 由各模式的 `ArchetypeMode.transportTaskKind` 覆盖档案级值。
 */
export type ArchetypeTransportTaskKind = "text_to_video" | "image_to_video" | "text_to_image" | "image_edit" | "text_to_audio" | "transcribe" | "text_to_3d" | "image_to_3d";

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
  /**
   * **角色数组合并（通用原语）**：把本模式有值的若干槽合并成一个带 `role` 的对象数组，落在 `key` 上，
   * 并删掉被合并的扁平键（M2 互斥：避免 image_urls/first_frame_url 与合并键并存触发 vendor 报错）。
   * 用途：apimart Seedance 首尾帧 = `image_with_roles:[{url,role:'first_frame'},{url,role:'last_frame'}]`。
   * **通用**：任何用 role-数组的模型只声明这一项即可，构造层零改动（不 if-vendor、不写死键名，键来自这里）。
   * role 取自各槽的 roleName ?? 由 kind 派生。合并必须在构造层做（模板引擎丢不掉 {url:undefined} 对象）。
   *
   * `flat`：产出**有序扁平 `string[]`**（按槽声明顺序）而非 `[{url,role}]`。用于位置数组语义的模型——
   * 如 Veo 首尾帧 `image_urls:[首url, 尾url]`（[0]=首 [1]=尾），区别于 Seedance 的 role-对象数组。
   */
  combineSlotsInto?: { key: string; flat?: boolean };
  /**
   * **模式级固定 body 参数**（通用）：本模式恒定要发、但**不需用户选**的请求字段。构造层直接并进 out
   * （键 = API 字段名，值 = 常量字符串）→ catalog body 用 `{{request.params.<key>}}` 读它。
   * 用途：Veo/Omni 的 `generation_type`（frame 首尾帧 / reference 参考图，由模式决定，不该是个 1 选下拉）。
   * 与 params 的区别：params 是用户可调的控件，fixedParams 是模式内嵌的常量，不渲染 UI（保持极简 R2）。
   */
  fixedParams?: Record<string, string>;
};

/**
 * **变体（variant）正交轴**（与 modes 平行的新轴，用户拍板方案 A：通用分段选择器）。
 *
 * 痛点：一族模型常有「同能力、不同 model 字符串」的若干变体（Seedance 的标准/fast/真人/真人快速、
 * Sora 的标准/pro…）。它们**跨所有 mode 生效**（fast 影响 t2v/i2v/omni/firstlast 全部的清晰度），
 * 故不能塞进 per-mode 的 `modelEnum`（否则 mode×variant 笛卡尔积）。新增档案级 `variants` 这一轴：
 *
 * - `modelKey`：选中该变体时**实际发请求**用的 model 字符串（如 `doubao-seedance-2.0-fast`）。
 *   传输层 catalog body 用 `{{request.params.model}}` 读它（同 happyhorse modelEnum 通道）。
 * - `paramOverrides`：该变体对某些 mode 的参数收窄（如 fast 的 resolution 仅 480/720）。按 modeId 索引；
 *   值是「拿到该 mode 现有 params、返回收窄后的 params」的纯函数（仿 withFastRes，从档案级 spread
 *   改成运行时按 variantId 叠加，见 specializeArchetypeForVariant）。缺省 = 该变体不改任何 mode 的参数。
 * - `identifierPatterns`：旧项目里 node.meta.modelKey 钉的是**具体变体串**（合并前每变体是独立 catalog
 *   行）。这些 pattern 让旧 modelKey 仍解析到本基础档案 + 被归一到对应 variantId（迁移，见
 *   normalizeArchetypeVariantMeta）——绝不让旧项目模型选择变空。
 */
export type ModelArchetypeVariant = {
  id: string;
  label: string;
  /** 选中该变体时实际发请求的 model 字符串（catalog body `{{request.params.model}}` 读它）。 */
  modelKey: string;
  /** 旧项目 node.meta.modelKey 命中这些串之一 → 归一到本变体（迁移层）。缺省 = 仅靠 modelKey 自身匹配。 */
  identifierPatterns?: string[];
  /** 按 modeId 把该 mode 的标量参数收窄（纯函数，仿 withFastRes）。缺省 = 不改任何 mode。 */
  paramOverrides?: Record<string, (params: ModelParameterControl[]) => ModelParameterControl[]>;
};

export type ModelArchetype = {
  id: string; // 'seedance-2'
  family: string; // 'seedance'
  label: string; // 'Seedance 2.0'
  kind: "video" | "image" | "audio" | "model3d";
  modes: ArchetypeMode[];
  defaultModeId: string;
  /**
   * **变体轴**（可选，与 modes 正交）：一族「同能力、不同 model 字符串」的变体。声明后 UI 出变体分段
   * 选择器（VariantBar），picker 里这一族只占 1 项（基础 modelKey）。缺省（绝大多数模型）= 无变体，
   * 行为与从前完全一致。详见 ModelArchetypeVariant。
   */
  variants?: ModelArchetypeVariant[];
  /** 默认选中的变体 id（无 meta.archetype.variantId 时回落）。声明 variants 时必填。 */
  defaultVariantId?: string;
  /** 该档案默认打到哪个 mapping 桶（显式，不靠启发式）。图像档案可被 mode.transportTaskKind 覆盖。 */
  transportTaskKind: ArchetypeTransportTaskKind;
  /**
   * 识别用：模型身份（modelKey/别名）匹配这些 pattern 之一就套这套档案。
   * 匹配规则见 resolveArchetypeForModel —— 按「整串相等」或「去掉 vendor 前缀后的末段相等」，
   * 故 'seedance-2' 不会误命中 'seedance-2-fast'。
   * **变体合并后**：本基础档案的 identifierPatterns 收纳所有变体的旧 modelKey（如 fast/face/fast-face），
   * 使旧项目仍解析到本档案；具体落到哪个 variantId 由各 variant 的 identifierPatterns 决定（迁移层）。
   */
  identifierPatterns: string[];
};
