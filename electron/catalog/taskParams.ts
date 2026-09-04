// 请求参数构建（从 runtime.ts 抽出，评审 M5：可测 + 不喂大 runtime）。
// 把一个 TaskRequest 摊平成模板引擎要的 `{{request.params.*}}` 取值表——含标量、尺寸、时长、
// 以及档案驱动的参考输入（referenceInputParams）。**纯函数、依赖注入级别的纯**，故可零网络单测。
//
// 为什么单独成文件还配测试：duration 这种"数字被 firstString 吞成空串"的坑、omni 参考数组该不该进
// params 的坑，都只在"真实参数构建"里暴露，埋在 2500 行 runtime 里既测不到也容易回归。
import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { referenceInputParams } from "./archetypeInput";
import { ARCHETYPE_WIRE_DEFAULTS, ARCHETYPE_SIZE_RATIO_SEMANTIC } from "./archetypeWireDefaults.generated";
import { bodyReferencedParamKeys } from "./paramTranslate";
import { bodyReferenceSupport, classifyReferenceKey, classifyReferenceKeyDetailed, type ReferenceFamily } from "./referenceReachability";
import { readSelectedComfyReferenceContract, type ParameterReferenceSelection } from "./parameterReferenceContract";

/** taskTemplateParams 实际用到的 TaskRequest 子集（结构化，避免与 runtime 的 TaskRequest 循环依赖）。 */
export type TaskParamsInput = {
  extras?: Record<string, unknown>;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  negativePrompt?: string;
};

export function firstReferenceImage(request: TaskParamsInput, selected?: ParameterReferenceSelection): string {
  const extras = request.extras || {};
  if (comfyReferenceContract(extras, selected)) {
    return declaredComfyReferences(extras, selected).find((reference) => reference.family === "image")?.url || "";
  }
  const referenceImages = Array.isArray(extras.referenceImages) ? extras.referenceImages : [];
  return firstString(
    extras.image_url,
    extras.imageUrl,
    extras.firstFrameUrl,
    extras.lastFrameUrl,
    referenceImages[0],
  );
}

/**
 * 全部参考图（多模态理解用）。数据本来就是数组，只是 firstReferenceImage 按单图语义截了第 0 张。
 * 视频拆解要一次喂一镜的 3 帧，故补一个复数入口；单图调用方继续用 firstReferenceImage 不受影响。
 *
 * 与 firstReferenceImage 同一套取值优先级（**含 ComfyUI 参考契约**，1040 commit 间 firstReferenceImage
 * 已升级为契约感知——这里跟着走同一条缝，别退回旧的裸 referenceImages[0] 语义，否则 comfy 输入被吞）：
 *   有 comfy 契约 → 取契约声明的全部 image 槽；否则 → referenceImages 全集（缺省再兜单图别名）。
 */
export function allReferenceImages(request: TaskParamsInput, selected?: ParameterReferenceSelection): string[] {
  const extras = request.extras || {};
  if (comfyReferenceContract(extras, selected)) {
    return declaredComfyReferences(extras, selected)
      .filter((reference) => reference.family === "image")
      .map((reference) => reference.url)
      .filter((url) => url.length > 0);
  }
  const referenceImages = Array.isArray(extras.referenceImages) ? extras.referenceImages : [];
  const urls = referenceImages.map((item) => firstString(item)).filter((url) => url.length > 0);
  if (urls.length) return urls;
  const single = firstReferenceImage(request, selected);
  return single ? [single] : [];
}

/**
 * wire 必填参数兜底（headless/MCP 路）：UI 经 NodeGenerationComposer 按档案填好 size/voice/model 等；
 * 但 MCP/CLI 的 generate 不经 UI、也不暴露 params，缺必填参 vendor 直接拒（火山缺 size→400 / apimart 缺
 * model→500 / 豆包缺 voice→「未选择音色」）。把 mapping.create.defaultParams 合并到 extras **之下**
 * （既有值优先）：UI 路已填故零影响，headless 路得到一份能成的请求。纯函数（可单测）。
 */
export function applyWireDefaults(
  extras: Record<string, unknown> | undefined,
  defaultParams: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!defaultParams) return extras;
  return { ...defaultParams, ...(extras || {}) };
}

// 一个比例值（"16:9" / "1 : 1"）。用来判某个 `size` 默认到底是「比例语义」还是「像素语义」。
const RATIO_VALUE_RE = /^\d+\s*:\s*\d+$/;

/**
 * 调用方比例（nomi_generate 的 aspect_ratio）该不该写进**这条模式**的 `size` 键。
 *
 * 背景：`size` 键名有歧义——apimart-seedream 等把它当**比例**读（wire 默认 "1:1"），而 volcengine-seedream /
 * modelscope / agnes / rh-qwen / rh-sora 把它当**像素**读（默认 "2048x2048" / "1024x1024" / "720x1280"）。
 * buildGenerateParams 无差别把调用方比例铺进 size 别名，caller-wins 于是会把像素档案的 size 覆写成 "16:9"，
 * 渲染进 wire body 就是废请求（火山 seedream 直接坏）。故在**看得见所选模式真实默认**的这道缝（extras 与
 * mapping/档案默认在此汇合）加闸：size 键是比例语义时才准调用方比例落到 size；是像素语义或压根没有 size →
 * 不落（size 那半留给档案像素默认，调用方比例对这个只会说像素的目标不适用）。
 *
 * **判据从档案 size 控件的选项集 DERIVE**（生成期算好、桥进 ARCHETYPE_SIZE_RATIO_SEMANTIC）：选项集里有真比例档
 * （16:9…）→ 这个 size 键是比例语义，哪怕它的默认值是 "adaptive" 这种比例族自动档（seedance-2.5-apimart t2v
 * 正是此例：size 默认 "adaptive"、body 只读 size，旧的「按默认值字面 /^\d+:\d+$/ 猜」会误判成像素语义、把调用方
 * 16:9 剥掉 → 画幅被吞）。只有档案里查不到该 (archetypeId, taskKind)（如自定义/未桥接的档案）才回退到旧的
 * **默认值字面形状**正则兜底。语义无歧义的 aspect_ratio / aspectRatio 别名不受此限，照常保留（模板没引用就自然被丢弃）。
 * **纯 derive，无 vendor 名单。**
 */
function sizeDefaultIsRatioSemantic(
  archetypeId: string | undefined,
  taskKind: string,
  archetypeDefaults: Record<string, unknown> | undefined,
  mappingDefaults: Record<string, unknown> | undefined,
): boolean {
  // ① 首选：档案 size 控件选项集 derive 出的比例语义标记（覆盖 "adaptive" 这类默认值猜不出的比例族档）。
  const emitted = archetypeId ? ARCHETYPE_SIZE_RATIO_SEMANTIC[archetypeId]?.[taskKind] : undefined;
  if (typeof emitted === "boolean") return emitted;
  // ② 回退（未桥接的档案）：按合并后真正生效的 size 默认值字面形状猜。
  // 有效默认 = 合并后真正生效的那个（mappingDefaults 是更贴近的兜底、后铺，故它有 size 时以它为准）。
  const effective = mappingDefaults && "size" in mappingDefaults
    ? mappingDefaults.size
    : archetypeDefaults?.size;
  return typeof effective === "string" && RATIO_VALUE_RE.test(effective.trim());
}

/**
 * headless/MCP 三道缺参兜底（均「既有值优先」，UI 路已填故零影响）：① 档案参数默认值（单一真相源，按
 * archetypeId+taskKind 桥接自 src/config，vendorParams 覆盖优先、回退通用 "*"；补 model 变体/duration(int)/
 * 比例/清晰度/voice/size）；② mapping 级 defaultParams（仅非档案派生的兜底）；③ **参考键形态投影**
 * （createBody 给了才做，W1d）——把携带的参考投影到 body 真读的键（image_urls/first_frame_image…），
 * 见 projectReferencesOntoBodyKeys。逻辑收口在此 → runtime 一行调用，不喂巨壳。
 *
 * 附一道 `size` 别名闸（见 sizeDefaultIsRatioSemantic）：调用方比例铺进的 `size` 仅当该模式 size 默认是比例形时
 * 才保留，否则剥掉，免得把只说像素的目标（火山 seedream 等）的 size 覆写成 "16:9" 发出废请求。
 */
export function applyHeadlessParamDefaults(
  extras: Record<string, unknown> | undefined,
  archetypeId: string | undefined,
  taskKind: string,
  vendorKey: string,
  mappingDefaults: Record<string, unknown> | undefined,
  /** 这条 mapping 的 create body（给了才做参考键形态投影，W1d）。不给 = 只做①②缺参兜底，行为不变。 */
  createBody?: unknown,
  modelKey?: string,
): Record<string, unknown> | undefined {
  const perKind = archetypeId ? ARCHETYPE_WIRE_DEFAULTS[archetypeId]?.[taskKind] : undefined;
  const archetypeDefaults = perKind ? (perKind[vendorKey] ?? perKind["*"]) : undefined;
  // extras.size 是比例形（调用方 aspect_ratio 铺来的）、但本模式的 size 是像素语义 → 剥掉，让档案像素默认接管。
  // 只针对「比例形的 caller size」，UI 路自己填的真实像素 size 不受影响（它不匹配 RATIO_VALUE_RE）。
  const guarded = extras && typeof extras.size === "string" && RATIO_VALUE_RE.test(extras.size.trim())
    && !sizeDefaultIsRatioSemantic(archetypeId, taskKind, archetypeDefaults, mappingDefaults)
    ? (() => { const { size: _dropped, ...rest } = extras; return rest; })()
    : extras;
  const withDefaults = applyWireDefaults(applyWireDefaults(guarded, archetypeDefaults), mappingDefaults);
  // ③ 参考键形态投影（既有值优先 → 渲染层已填 archetypeInput 时 no-op）。在缺参兜底之后做，看到的是合并后的 extras。
  if (typeof createBody === "undefined") return withDefaults;
  const projected = projectReferencesOntoBodyKeys(withDefaults, createBody, { vendorKey, modelKey });
  return Object.keys(projected).length ? { ...(withDefaults || {}), ...projected } : withDefaults;
}

export function taskTemplateParams(request: TaskParamsInput, selected?: ParameterReferenceSelection): JsonRecord {
  const extras = request.extras || {};
  const size = request.width && request.height ? `${request.width}x${request.height}` : firstString(extras.size, extras.aspectRatio);
  // duration 可能是数字（节点「5s」标量参数存的就是 number 5）——firstString 只认字符串会把它吞成 ""，
  // 导致 body 的 duration 为空（实测）。数字原样保留，字符串走 trim，缺省 ""。
  const durationRaw = extras.duration ?? extras.durationSeconds ?? extras.videoDuration;
  const duration = typeof durationRaw === "number" ? durationRaw : firstString(durationRaw);
  // Numeric controls can arrive from persisted node params as strings. Keep the
  // wire type stable for strict providers (APIMart TTS rejects speed="1.5").
  // Invalid non-empty values remain visible to the provider instead of being
  // silently replaced with a default.
  const speed = numericWireParam(extras.speed);
  const refInput = referenceInputParams(extras, selected);
  const jsonEditInput = jsonImageEditInput(refInput.reference_images);
  // 变体（档案切档的产物）优先，其次目录身份回落。详见下方 model 键的注释。
  const wireModel = firstString(extras.model) || firstString(selected?.wireModelKey);
  return {
    ...extras,
    // **要发出去的 model 串的单一真相源**（变体轴 > 目录身份）。
    //
    // 为什么必须在这里补默认：body 模板写 `{{request.params.model}}` 才能让变体切换真的换掉线上的
    // model 串（archetypeVariantAxisIsLive 读的就是「body 有没有引用 params.model」）。但 extras.model
    // 只有**带变体的档案**才产出（buildArchetypeInputParams 末尾：变体 > mode.modelEnum > 不带）——
    // 裸模型走同一条 body 时 params.model 是 undefined，而 renderTemplateValue 对整 token 的
    // undefined 是**整键丢弃**（requestPipeline.ts:110-117 实测：{model:"{{request.params.model}}"}
    // 渲染成 {}），于是每个没变体的中转模型都会发出一个**没有 model 字段**的请求 → 站点必 400。
    // 所以「模板层没有 fallback 语法」这件事在这里一次性补齐（followPath 只会走点号路径，`||` 之类
    // 写法解析不出任何东西，实测渲染成 {}）——回落值取与 `{{model.modelKey}}` **完全同一个**表达式
    // （modelAlias 优先、否则 modelKey，见 profileHttpRequest.templateContext），保证换成参数化 model
    // 之后裸模型的线上字节与换之前逐字节一致。
    // 单源纪律（P1）：全仓只有这一处决定「发哪个 model 串」，各家 catalog 不再各自兜底。
    //
    // 用条件展开而不是 `model: ... || undefined`：后者会留下一个**值为 undefined 的自有键**，
    // 于是调用方的 `{ model: 兜底, ...params }` 会被这个空键反向覆盖掉（渲染结果照样没有 model）。
    // 键干脆不存在，才能让上游的展开兜底按直觉生效。
    ...(wireModel ? { model: wireModel } : {}),
    // An unset size must stay undefined so exact template fields are omitted.
    // Sending the empty alias (the persisted value for the gpt-image-2
    // `Auto` aspect-ratio choice) makes OpenAI-compatible endpoints reject the
    // request with `Invalid size ""` instead of applying their default.
    size: size || undefined,
    // n 强制数字（OpenAI images 要 int；UI number 参数可能存成字符串 "1"，整 token 会原样发 → 严格端点 400）。
    n: Number(extras.n) || 1,
    width: request.width,
    height: request.height,
    seed: request.seed ?? numericWireParam(extras.seed),
    steps: request.steps,
    cfgScale: request.cfgScale,
    cfg_scale: request.cfgScale,
    negative_prompt: request.negativePrompt ?? extras.negative_prompt,
    duration,
    ...(speed !== undefined ? { speed } : {}),
    // 空→undefined（不是 ""）：body 的 `image: "{{request.params.image_url}}"` 整 token 渲染时，
    // undefined 会被丢弃、"" 却会当空字段发出去（纯文生图/文生视频误带 image:"" 会被部分中转拒）。
    image_url: firstReferenceImage(request, selected) || undefined,
    // 参考输入（单图首/尾帧 + 多参考数组）—— 构建逻辑在 electron/catalog/archetypeInput（M5）。
    ...refInput,
    // chat/completions 多模态图生图（通用中转 gemini/nano-banana 系）：参考图 → content 里的 image_url 项数组。
    // 声明式模板展不开变长数组，故在此把 reference_images 建成 parts 数组；op body 用整 token 引用，
    // renderTemplateValue 会把它摊平进 content（见 requestPipeline flatMap）。空数组 → content 只剩 text 项。
    chat_image_parts: chatImageParts(refInput.reference_images),
    // JSON image-edits 协议（xAI Imagine 等）：单图必须是 image，多图必须是 images；模板层只负责
    // 丢 undefined，条件造型在这里一次完成。官方最多 3 张，超出的参考图不误发给严格端点。
    json_edit_image: jsonEditInput.image,
    json_edit_images: jsonEditInput.images,
    // xAI 单图编辑固定沿用输入图比例；只有多图编辑才允许显式 aspect_ratio。
    json_edit_aspect_ratio: jsonEditInput.images ? firstString(extras.aspect_ratio, extras.aspectRatio) || undefined : undefined,
    max_tokens: extras.maxTokens ?? extras.max_tokens,
    // 通用中转视频的 `metadata`（供应商自定义参数袋）——**整个对象在这里构造，不在模板里逐键写**。
    // 理由是模板层的一个真实边界：它丢得掉值为 undefined 的**键**，却丢不掉因此变空的**父对象**，
    // 逐键写法在用户什么都没填时会发出 `"metadata":{}`（实测），凭空给严格端点多一个空对象。
    // 没有任何内容 → 整个键 undefined → 模板把 metadata 一起丢掉，wire 与加这个字段之前逐字节一致。
    relay_metadata: relayVideoMetadata(request.negativePrompt ?? extras.negative_prompt),
  };
}

/**
 * 通用中转视频 `metadata` 袋（R5 核 doc.newapi.pro/api/kling-jimeng/ 2026-09-03，原文：
 * 「供应商特定/自定义参数（如 negative_prompt, style, quality_level 等）」）。
 *
 * 只放**文档点名**的键。这是有意的克制：metadata 是自由袋，往里塞我们自己想当然的键名
 * （generate_audio 之类）不会报错、也不会生效，只会变成一种更难发现的静默丢弃——
 * 看起来发出去了，实际上没有哪个供应商认得。没有文档依据的参数宁可如实标成「送不到」。
 */
function relayVideoMetadata(negativePrompt: unknown): JsonRecord | undefined {
  const negative = firstString(negativePrompt);
  return negative ? { negative_prompt: negative } : undefined;
}

function numericWireParam(value: unknown): number | string | undefined {
  if (value === null || typeof value === "undefined") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value !== "string") return value == null ? undefined : String(value);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

// 参考值的 URL 形状（http/nomi-local/data/blob/绝对路径）。护栏判定只认它——archetypeInput 里还混着
// model enum（如 "gpt-image-2-image-to-image"）和 fixedParams 常量，按「有任意值」判会误报有参考。
const REF_URL_RE = /^(https?:\/\/|nomi-local:\/\/|data:|blob:|\/)/i;

// 「对象形态」参考键：值必须是 [{url, role}] / content 项对象数组（渲染层 archetypeInput 才构造得对），
// 不能塞 plain URL。projectReferencesOntoBodyKeys 跳过它们走 plain 键（image_urls 等），对象键留空由模板丢。
const OBJECT_SHAPE_REF_KEY = /with_roles|_contents\b|_content\b/i;

// 数组形态键：复数 URL 键（image_urls / video_urls / audio_urls / input_urls / reference_*_urls / *_images / *_paths）。
// classifyReferenceKeyDetailed 的 multiImage 只覆盖 image 族的多图信号，video/audio 复数键靠此补齐 → 塞数组不塞单串。
const ARRAY_SHAPE_REF_KEY = /_urls$|urls$|images$|audios$|videos$|_paths$|paths$/i;

/**
 * 帧槽：**归一后的标准来源键** ↔ **body 侧帧键的判据**。
 *
 * 为什么需要它（2026-08-27 真机 422 的根因）：`referenceInputParams` 把调用方的 `firstFrameUrl`
 * 归一成 `first_frame_url`，**帧意图是保留着的**；但 `carriedReferenceUrlsByFamily` 会把同族的
 * URL 拍平成一个列表，意图在那一步丢了。于是下游「每族优先数组键」的启发式把首帧塞进了
 * `reference_image_urls`——对 Wan 3.0 这种「首/尾帧与 reference_* 官方硬互斥」的模型，
 * 结果是 body 里两族键同时出现，kie 直接 422。
 *
 * 注意 `first_frame` / `last_frame` 两条判据互不包含（不能只用 /frame/），否则尾帧会被首帧规则先吞。
 */
const FRAME_SLOTS: ReadonlyArray<{ sourceKey: string; bodyKeyRe: RegExp }> = [
  { sourceKey: "first_frame_url", bodyKeyRe: /first_frame/i },
  { sourceKey: "last_frame_url", bodyKeyRe: /last_frame/i },
];

/** 往这个 body 参考键投影时该塞数组还是单串：多图键（multiImage）或复数 URL 键 → 数组；否则单串（首帧/单图聚合位）。 */
function refKeyWantsArray(key: string, multiImage: boolean): boolean {
  return multiImage || ARRAY_SHAPE_REF_KEY.test(key);
}

function containsRefUrl(value: unknown): boolean {
  if (typeof value === "string") return REF_URL_RE.test(value.trim());
  if (Array.isArray(value)) return value.some(containsRefUrl);
  if (value && typeof value === "object") return Object.values(value).some(containsRefUrl);
  return false;
}

function comfyReferenceContract(extras: JsonRecord, selected?: ParameterReferenceSelection) {
  return readSelectedComfyReferenceContract(extras, selected);
}

function declaredComfyReferences(extras: JsonRecord, selected?: ParameterReferenceSelection): Array<{ key: string; family: 'image' | 'video'; url: string }> {
  const contract = comfyReferenceContract(extras, selected)
  if (!contract) return []
  return contract.slots.flatMap((slot) => {
    const value = extras[slot.key]
    // A native ComfyUI slot is first a data/nomi-local URL and then, after
    // the mandatory /upload/image step, an input-directory filename. The
    // exact contract is the authority for this latter non-URL form; generic
    // fields still require URL-shaped values and cannot bypass the guard.
    const url = typeof value === 'string' ? value.trim() : ''
    if (!url || url.includes('\0')) return []
    return [{ key: slot.key, family: slot.mediaKind === 'video' ? 'video' as const : 'image' as const, url }]
  })
}

/**
 * 图生图/图生视频请求里是否真的带了 ≥1 张参考素材（L3 诚实护栏，纯函数可测）。
 * 两路口径：① firstReferenceImage 单图聚合（image_url/firstFrameUrl/referenceImages[0]…）；
 * ② referenceInputParams 产出（档案 archetypeInput 的 input_urls/image_urls/volcengine content 项…
 *   或非档案的 reference_image_urls/reference_images），递归扫 URL 形状的值。
 * false = 用户意图「拿图改/拿图生」但一张图都递不出去 → 调用方拒发报人话，绝不静默退化纯文生。
 */
export function hasImageEditReferences(request: TaskParamsInput, selected?: ParameterReferenceSelection): boolean {
  const extras = request.extras || {};
  if (comfyReferenceContract(extras, selected)) {
    return declaredComfyReferences(extras, selected).some((reference) => reference.family === 'image');
  }
  if (firstReferenceImage(request, selected)) return true;
  // extras.image：headless/老调用方的裸键口径（部分 curated body 直读 {{request.params.image}}）。
  return containsRefUrl([extras.image, referenceInputParams(extras, selected)]);
}

/**
 * 参考素材键 → 人话类别。**未登记的键回退「参考素材」而不是被丢掉**——闸门宁可标签泛一点，
 * 也绝不能因为没登记就当它不存在（那正是下面 carriedReferences 修掉的根因）。
 * 顺序有意义：first_frame_image 这类同时含 frame 和 image 的键必须先被帧规则接住。
 */
const REFERENCE_LABEL_RULES: Array<[RegExp, string]> = [
  [/first_?frame|start_?frame/i, "首帧"],
  [/last_?frame|end_?frame|tail_?frame/i, "尾帧"],
  [/video/i, "参考视频"],
  [/audio|voice/i, "参考音频"],
  // 角色图槽（UI 同名，见 i18n generationCommon.image='角色图'）先于通用图规则，保住既有报错措辞。
  [/reference_image_urls?|character/i, "角色参考图"],
  [/image|img/i, "参考图"],
];

function referenceLabelForKey(key: string): string {
  for (const [pattern, label] of REFERENCE_LABEL_RULES) if (pattern.test(key)) return label;
  return "参考素材";
}

/**
 * 本次请求真正携带的参考素材，按人话类别分组（只认 URL 形状的值）。
 *
 * **真相源 = referenceInputParams(extras)，与 wire 完全同源**（taskTemplateParams 铺的就是它）。
 * 这是根因修法：旧实现在这里手抄 5 个 extras 键（firstFrameUrl/referenceImageUrls/…），而那 5 个
 * 全是**手动上传**路才有的键；画布**连线**来的参考落在 extras.referenceImages 与档案投影
 * extras.archetypeInput.{image_urls,video_urls,…} 上，一个都不在名单里 → carried 恒空 →
 * unreachableReferenceLabels 直接 early-return [] → 第三闸对「连线来的参考」整个空转。
 * 用户连了参考图、模板发不出、闸门不吭声，于是生成成功、扣费成功、和参考图毫无关系
 * （正是本条被报的体感）。改读 refInput 后，任何新增参考键自动纳管，不需要回来补名单。
 */
function carriedReferences(extras: JsonRecord, selected?: ParameterReferenceSelection): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  const walk = (key: string, value: unknown): void => {
    if (typeof value === "string") {
      const url = value.trim();
      if (!url || !REF_URL_RE.test(url) || seen.has(url)) return;
      seen.add(url);
      out.push({ label: referenceLabelForKey(key), url });
      return;
    }
    // 数组沿用父键名（image_urls[0] 仍是「参考图」）；对象用子键名（volcengine content 项等嵌套结构）。
    if (Array.isArray(value)) for (const item of value) walk(key, item);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(k, v);
  };
  const exactComfyContract = comfyReferenceContract(extras, selected);
  // Valid Comfy contracts are exact-only, including an empty contract. Legacy aliases are not a second truth source.
  if (!exactComfyContract) {
    // referenceInputParams 的插入顺序把首/尾帧排在前，故同一 URL 既是首帧又在 image_urls 里时取「首帧」。
    for (const [key, value] of Object.entries(referenceInputParams(extras, selected))) walk(key, value);
  }
  for (const reference of declaredComfyReferences(extras, selected)) {
    if (seen.has(reference.url)) continue
    seen.add(reference.url)
    out.push({ label: referenceLabelForKey(reference.family), url: reference.url })
  }
  return out;
}

/**
 * L3 诚实护栏第三闸（纯函数）：**这条 wire 的 body 到底读不读得到我要发的参考素材**。
 *
 * 为什么需要：UI 的能力由**模型档案**声明（供应商无关，同一模型走哪家都显示同一套槽位），而真正
 * 发出去的 body 由渠道模板决定。两者不匹配时——典型是「通用中转接入」用的是最小模板 {model,
 * prompt, duration, size, image}——用户连上的尾帧/角色图/参考视频/参考音频**在 body 里根本不出现**，
 * 于是静默退化成纯文生：生成成功、扣费成功、和参考素材毫无关系。
 *
 * 判据完全 derive，不 hardcode 任何 vendor 键名：把 body 引用到的 `{{request.params.X}}` 取出来，
 * 渲染出它们的值，看这次携带的每条参考 URL 在不在里面。在 = 发得出；不在 = 发不出。
 * 对所有渠道、所有模式成立。
 *
 * @returns 发不出去的参考类别（人话），空数组 = 全都发得出。
 */
export function unreachableReferenceLabels(request: TaskParamsInput, createBody: unknown,
  selected?: ParameterReferenceSelection): string[] {
  const carried = carriedReferences(request.extras || {}, selected);
  if (carried.length === 0) return [];
  const params = taskTemplateParams(request, selected);
  const referencedKeys = bodyReferencedParamKeys(createBody);
  if (referencedKeys.length === 0) return [];
  const reachable = JSON.stringify(referencedKeys.map((key) => params[key]));
  const missing = new Set<string>();
  for (const ref of carried) if (!reachable.includes(ref.url)) missing.add(ref.label);
  return [...missing];
}

/** 一个模式（taskKind）的 create body——供拒发建议判「哪个模式带得动我携带的参考」。 */
export type ModelModeBody = { taskKind: string; body: unknown };

const FAMILY_LABEL: Record<ReferenceFamily, string> = { image: "参考图", video: "参考视频", audio: "参考音频" };
// taskKind → 人话模式名（拒发建议里点名"用哪个模式"）。未登记的原样用 taskKind。
const TASK_KIND_LABEL: Record<string, string> = {
  image_edit: "图生图（改图）",
  image_to_video: "图生视频（i2v）",
  text_to_video: "文生视频",
  text_to_image: "文生图",
};

/** 本次请求携带的参考族（从 referenceInputParams 的键 derive，与 body 承载力同一套 classifyReferenceKey）。 */
function carriedReferenceFamilies(extras: JsonRecord, selected?: ParameterReferenceSelection): Set<ReferenceFamily> {
  const families = new Set<ReferenceFamily>();
  const walk = (key: string, value: unknown): void => {
    if (typeof value === "string") {
      if (REF_URL_RE.test(value.trim())) {
        const family = classifyReferenceKey(key);
        if (family) families.add(family);
      }
      return;
    }
    if (Array.isArray(value)) for (const item of value) walk(key, item);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(k, v);
  };
  const exactComfyContract = comfyReferenceContract(extras, selected);
  if (!exactComfyContract) {
    for (const [key, value] of Object.entries(referenceInputParams(extras, selected))) walk(key, value);
  }
  for (const reference of declaredComfyReferences(extras, selected)) families.add(reference.family)
  return families;
}

/**
 * 拒发后附一句**可走的路**（交付4）：从**同一套 mapping 数据**（各模式 create body）derive——
 * 找出这个模型哪些模式的 body 真读得到我携带的参考族，点名它（"该模型 i2v 模式的 image_urls 支持多张参考图"）；
 * 一个模式都带不动 → 老实说没有，并指路 list_models 找别的。**不 hardcode 任何 vendor 串**：模式名来自 taskKind，
 * 多图与否来自 bodyReferenceSupport.multiImage。给不出 modeBodies（未注入）→ 返回空串（保持既有拒发语义不变）。
 *
 * 排除的是**刚被判发不出的那条 body 本身**（failedBody，按序列化相等判定），不是按 taskKind 排除——因为同一
 * taskKind 可能有多条 mapping（当前走的通用中转 body 发不出，但该模型自己的原生 i2v body 读得到），按 taskKind
 * 排除会把唯一可行的那条也误删（seedance 唯一的 i2v 原生 body 就这么被漏掉过）。同一 taskKind 去重：多条能行的
 * 只报一次模式名。
 */
export function reachableModeSuggestion(
  request: TaskParamsInput,
  failedBody: unknown,
  modeBodies: ModelModeBody[] | undefined,
  selected?: ParameterReferenceSelection,
): string {
  if (!modeBodies || modeBodies.length === 0) return "";
  const carried = carriedReferenceFamilies(request.extras || {}, selected);
  if (carried.size === 0) return "";
  const failedKey = typeof failedBody === "undefined" ? undefined : JSON.stringify(failedBody);
  // 找出 body 覆盖了全部携带族的模式（排除刚失败的那条 body 本身）；同 taskKind 去重、记住是否多图。
  const byTaskKind = new Map<string, boolean>();
  for (const mode of modeBodies) {
    if (failedKey !== undefined && JSON.stringify(mode.body) === failedKey) continue; // 刚被判发不出的那条，不推荐它自己。
    const support = bodyReferenceSupport(mode.body);
    const covers = [...carried].every((family) => support[family]);
    if (covers) byTaskKind.set(mode.taskKind, (byTaskKind.get(mode.taskKind) ?? false) || support.multiImage);
  }
  const carriedText = [...carried].map((f) => FAMILY_LABEL[f]).join(" + ");
  if (byTaskKind.size === 0) {
    // 一个模式都带不动——老实说，指路换模型。
    return `该模型没有任何模式能携带你连上的${carriedText}；请断开它们，或用 nomi_list_models 找一个 references 覆盖${carriedText}的模型。`;
  }
  const parts = [...byTaskKind.entries()].map(([taskKind, multiImage]) => {
    const modeName = TASK_KIND_LABEL[taskKind] || taskKind;
    const multi = multiImage && carried.has("image") ? "（支持多张参考图）" : "";
    return `${modeName}${multi}`;
  });
  return `可改用该模型的：${parts.join(" / ")}——它读得到你携带的${carriedText}。`;
}

/**
 * 本次携带的参考 URL，按族分组、保序去重（image 内首/尾帧排前，同 carriedReferences 口径）。
 * 真相源 = referenceInputParams(extras)——headless 路的 referenceImages/firstFrameUrl/… 都归一到它。
 */
function carriedReferenceUrlsByFamily(extras: JsonRecord,
  selected?: ParameterReferenceSelection): Record<ReferenceFamily, string[]> {
  const out: Record<ReferenceFamily, string[]> = { image: [], video: [], audio: [] };
  const walk = (key: string, value: unknown): void => {
    if (typeof value === "string") {
      const url = value.trim();
      if (!url || !REF_URL_RE.test(url)) return;
      const family = classifyReferenceKey(key);
      if (family && !out[family].includes(url)) out[family].push(url);
      return;
    }
    if (Array.isArray(value)) for (const item of value) walk(key, item);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(k, v);
  };
  const exactComfyContract = comfyReferenceContract(extras, selected);
  if (!exactComfyContract) {
    for (const [key, value] of Object.entries(referenceInputParams(extras, selected))) walk(key, value);
  }
  for (const reference of declaredComfyReferences(extras, selected)) {
    if (!out[reference.family].includes(reference.url)) out[reference.family].push(reference.url);
  }
  return out;
}

function archetypeReferenceUrlsByFamily(extras: JsonRecord): Record<ReferenceFamily, string[]> {
  const out: Record<ReferenceFamily, string[]> = { image: [], video: [], audio: [] };
  const walk = (key: string, value: unknown): void => {
    if (typeof value === "string") {
      const url = value.trim();
      const family = classifyReferenceKey(key);
      if (url && REF_URL_RE.test(url) && family && !out[family].includes(url)) out[family].push(url);
      return;
    }
    if (Array.isArray(value)) for (const item of value) walk(key, item);
    else if (value && typeof value === "object") for (const [nestedKey, nestedValue] of Object.entries(value)) walk(nestedKey, nestedValue);
  };
  if (isJsonRecord(extras.archetypeInput)) {
    for (const [key, value] of Object.entries(extras.archetypeInput)) walk(key, value);
  }
  return out;
}

/**
 * **headless/MCP 参考键形态投影**（纯函数，W1d 根因修复，见
 * docs/plan/2026-08-20-w1d-reference-mode-alignment.md）：把携带的参考投影到**这条 body 真实读的参考键**上。
 *
 * 根因：渲染层用 buildArchetypeInputParams 把参考按档案 slot inputKey 投影成 body 读的键（image_urls /
 * first_frame_image …），headless 没有这一步——参考只落在标准键 reference_images，body 读的却是 image_urls
 * → 第三闸判「发不出」、护栏诚实拒绝，图生图/图生视频整条走不通（L3 三跑现场）。
 *
 * 投影判据**与护栏同一套**（P1）：目标键 = bodyReferencedParamKeys(createBody) 里被 classifyReferenceKeyDetailed
 * 判为参考载体的键；按族匹配（image 键收图参考、video 收视频、audio 收音频）；多值键（image_urls/input_urls…）
 * 收整组、单值键（first_frame_image/单图聚合位）收首张（沿用 firstReferenceImage 优先级）。
 *
 * 两条边界（headless 无档案模式语义，必须自守）：
 *  · **每族至多填一个键**——headless 的 references 是**扁平列表**（无「这张是首帧、那张是角色图」的槽区分），
 *    同族多个 body 键（如 image_urls + first_frame_image）全填会把同一批 URL 重复塞进互斥键。**优先多值键**
 *    （扁平列表的天然去处），无多值键才退单值键（首帧/单图聚合位）。渲染层靠边 mode 区分槽，headless 靠这条。
 *    ⚠️ **例外：首/尾帧不是「扁平列表」**——调用方写 `firstFrameUrl` 就是明确表态「这张是首帧」，
 *    这份意图必须一路送到 body 的 first_frame_url，见下面「帧意图优先」。
 *  · **跳过对象形态键**（image_with_roles / *_contents）——它们要的是 [{url, role}] 对象，plain URL 塞进去既错
 *    形状又与 image_urls 互斥（seedance SEEDANCE_I2V_BODY 正是此例）。这些键只有渲染层 archetypeInput 才构造得对，
 *    headless 走 plain 键即可，对象键留空由模板引擎自动丢（= 该模型的「plain 参考」模式）。
 *
 * **既有值优先**：该键在 extras 里已有非空值（渲染层已填 archetypeInput，或调用方显式给）→ 跳过 → 渲染层路径逐字节 no-op。
 * **不 hardcode 任何 vendor 键名**——键从 body 反推。nomi-local:// 由 runtime 的 localizeAssetsForVendor 兜（本函数只搬 URL）。
 *
 * @returns 仅**新填**的键（overlay）；无可填 → 空对象。调用方 `{ ...extras, ...overlay }` 并入即可。
 */
export function projectReferencesOntoBodyKeys(
  extras: Record<string, unknown> | undefined,
  createBody: unknown,
  selected?: ParameterReferenceSelection,
): Record<string, unknown> {
  const src = extras || {};
  const byFamily = carriedReferenceUrlsByFamily(src, selected);
  const flatSource = { ...src };
  delete flatSource.archetypeInput;
  const flatByFamily = carriedReferenceUrlsByFamily(flatSource, selected);
  const archetypeByFamily = archetypeReferenceUrlsByFamily(src);
  if (byFamily.image.length === 0 && byFamily.video.length === 0 && byFamily.audio.length === 0) return {};

  const hasNonEmpty = (value: unknown): boolean =>
    (typeof value === "string" && value.trim() !== "") ||
    (Array.isArray(value) && value.length > 0) ||
    (value != null && typeof value === "object");

  const archetypeInput = isJsonRecord(src.archetypeInput) ? src.archetypeInput : {};
  const bodyKeys = bodyReferencedParamKeys(createBody);

  // ── 帧意图优先 ────────────────────────────────────────────────────────────
  // 调用方写 `firstFrameUrl` 是明确表态「这张是首帧」，不是"一张随便的参考图"。
  // 若这条 body 有对应的帧键，就**直接投到帧键**，并把该 URL 从族池里**取走**——
  // 取走是关键：族池空了，下面的数组候选就不会再把同一张图塞进 reference_image_urls，
  // 于是「首帧 + 参考数组」这对互斥键不可能被我们**同时**发出去（Wan 3.0 的 422 根因）。
  //
  // body 没有帧键时（如 Wan 2.7 / HappyHorse 用 image_urls 兼作首帧位）不消费，
  // 首帧照旧落进数组候选——老行为逐字节不变。
  const frameOverlay: Record<string, unknown> = {};
  const consumed = new Set<string>();
  const normalized = referenceInputParams(src, selected);
  for (const { sourceKey, bodyKeyRe } of FRAME_SLOTS) {
    const url = typeof normalized[sourceKey] === "string" ? (normalized[sourceKey] as string).trim() : "";
    if (!url) continue;
    const target = bodyKeys.find(
      (key) =>
        bodyKeyRe.test(key) &&
        !OBJECT_SHAPE_REF_KEY.test(key) &&
        classifyReferenceKeyDetailed(key) &&
        !hasNonEmpty(src[key]) &&
        !hasNonEmpty(archetypeInput[key]),
    );
    if (!target) continue;
    frameOverlay[target] = url;
    consumed.add(url);
  }
  if (consumed.size > 0) {
    for (const family of Object.keys(byFamily) as ReferenceFamily[]) {
      byFamily[family] = byFamily[family].filter((url) => !consumed.has(url));
      flatByFamily[family] = flatByFamily[family].filter((url) => !consumed.has(url));
    }
  }

  // 先按族归拢 body 里可填的 plain 参考键（跳过对象形态键），每族选一个目标：优先数组键（扁平列表天然去处）。
  const candidateByFamily: Partial<Record<ReferenceFamily, { key: string; wantsArray: boolean }>> = {};
  for (const key of bodyKeys) {
    if (frameOverlay[key] !== undefined) continue; // 已被帧意图占用
    const detail = classifyReferenceKeyDetailed(key);
    if (!detail) continue; // 非参考载体键（size/duration/seed…）不碰。
    if (OBJECT_SHAPE_REF_KEY.test(key)) continue; // 对象形态键（image_with_roles/*_contents）headless 不填，留空由模板丢。
    if (byFamily[detail.family].length === 0) continue; // 没有这个族的参考可填。
    // referenceImages → reference_images is already the standard non-Comfy aggregate path. Do not persist a
    // derived duplicate into extras before async preflight; other wire-key projections keep their existing policy.
    if (key === "reference_images" && Array.isArray(src.referenceImages)) continue;
    if (hasNonEmpty(src[key]) || hasNonEmpty(archetypeInput[key])) continue; // 既有值优先（渲染层 archetypeInput / 调用方显式）→ 不覆盖。
    const wantsArray = refKeyWantsArray(key, detail.multiImage);
    const current = candidateByFamily[detail.family];
    // 每族至多一个：优先数组键（扁平参考列表的天然去处）；已有数组候选则不再被单值键替换。
    if (!current || (wantsArray && !current.wantsArray)) candidateByFamily[detail.family] = { key, wantsArray };
  }

  const overlay: Record<string, unknown> = { ...frameOverlay };
  for (const family of Object.keys(candidateByFamily) as ReferenceFamily[]) {
    // Renderer-produced archetypeInput is authoritative. Only project a second key when a
    // distinct flat source exists; that deliberately preserves mixed-input detection.
    const nested = archetypeByFamily[family];
    const hasDistinctFlatSource = flatByFamily[family].some((url) => !nested.includes(url));
    if (nested.length > 0 && !hasDistinctFlatSource) continue;
    const cand = candidateByFamily[family]!;
    const urls = byFamily[family];
    // 数组键塞整组、单值键塞首张（严格端点对 image:string 期待单串，塞数组会 400——沿用 asArray 声明的教训）。
    overlay[cand.key] = cand.wantsArray ? [...urls] : urls[0];
  }
  return overlay;
}

/**
 * **无 mapping 时 runtime 兜底请求体的形状**（单一真相源）。
 *
 * runtime 在找不到任何 mapping 时会 POST `/v1/images/generations` 或 `/v1/videos/generations`，
 * body 是写死的这几个键（electron/runtime.ts 的兜底分支直接展开它）。这里声明它是为了让 L3 第三闸
 * 能用**同一份形状**判断「参考发不发得出去」——闸门与真实 wire 必须同源，否则又是一处
 * 「UI/闸门说能发、实际发不出」的漂移。值用 `{{request.params.X}}` 占位与模板同构，
 * bodyReferencedParamKeys 据此取键；**刻意不含任何参考族的键**（这条兜底 wire 确实没有图片位）。
 */
export const NO_MAPPING_FALLBACK_BODY = {
  model: "{{model.modelKey}}",
  prompt: "{{request.prompt}}",
  size: "{{request.params.size}}",
  seed: "{{request.params.seed}}",
  n: "{{request.params.n}}",
  response_format: "url",
} as const;

/**
 * L3 诚实护栏（runTask 前置闸，纯函数）：图生图/图生视频「参考图缺失」或「无传输 mapping」→ 返回
 * 人话错误（调用方在付费守卫/vendor 调用之前拒发，零扣费）；其余情况 null。此前会静默退化成纯文生
 * ——模板引擎丢空键 / fallback body 根本没有图片位——生成成功、扣费成功、和原图毫无关系，
 * 正是「图生图不按原图」的用户体感（docs/plan/2026-07-06-i2i-reference-reliability.md）。
 *
 * modeBodies（可选）：这个模型**所有模式**的 create body。给了则第三闸拒发时多附一句"可走的路"（交付4，
 * reachableModeSuggestion），点名哪个模式带得动携带的参考；不给则维持原拒发文案（语义/零扣费保证不变）。
 */
export function imageEditGuardError(
  kind: string,
  request: TaskParamsInput,
  hasMapping: boolean,
  modelLabel: string,
  /** 这条 mapping 的 create body。给了就多过一道闸：body 读不到的参考素材直接拒发（见上）。 */
  createBody?: unknown,
  modeBodies?: ModelModeBody[],
  selected?: ParameterReferenceSelection,
): string | null {
  // image_to_prompt is a runtime-fixed multimodal text path: executeTextTask
  // sends its referenceImages directly through streamTextTask, so it has no
  // profile/fallback body for this guard to audit.
  if (kind === "image_to_prompt") return null;

  // 第三闸对**所有 kind** 生效（运镜的参考视频可能挂在 t2v/omni 上），且只在真带了参考时才可能触发。
  //
  // `createBody === undefined` 有两种截然不同的成因，处置也相反：
  //  · 有 mapping、只是调用方没把 body 传进来（如 customCall 走脚本，不看模板 body）→ 无证据，放行；
  //  · **压根没有 mapping**（hasMapping=false）→ 这不是「查不到」，而是**确知**接下来会走
  //    runtime 的无 mapping 兜底（electron/runtime.ts:449-481），那条 body 是写死的
  //    `{model,prompt,size,seed,n,response_format,extras}`，**任何参考族都没有位置**。
  // 后者此前只在 image_edit / image_to_video 两个 kind 被拦（下方 !hasMapping 分支），于是
  // 自建中转的 text_to_image / text_to_video 带着参考图落进兜底：模板丢键 → 生成成功、扣费成功、
  // 和参考图毫无关系——正是本闸设立要根治的那种静默退化，只是从另一个 kind 的入口回来了。
  // 用 FALLBACK-body 同款判据（不 hardcode 参考键名），让所有 kind 一口径。
  //
  // 补兜底 body 只补**下方没管的那些 kind**：image_edit / image_to_video 无 mapping 时，
  // 下方那条「没有『图生图（改图）』通道」更具体（点名缺的是哪条通道、该怎么办），
  // 拒发与零扣费的效果二者相同，就把话语权留给更会说话的那条，别在这儿抢答。
  const fallbackBodyApplies = !hasMapping && kind !== "image_edit" && kind !== "image_to_video";
  const effectiveBody = typeof createBody !== "undefined" ? createBody
    : fallbackBodyApplies ? NO_MAPPING_FALLBACK_BODY : undefined;
  if (typeof effectiveBody !== "undefined") {
    const unreachable = unreachableReferenceLabels(request, effectiveBody, selected);
    if (unreachable.length > 0) {
      const base = `模型「${modelLabel}」在这个接入方式下发不出：${unreachable.join(" / ")}。连上的这些素材不会进入请求——为免白扣费这次不发。请断开它们，或换一个支持这些参考的渠道/模型。`;
      const suggestion = reachableModeSuggestion(request, effectiveBody, modeBodies, selected);
      return suggestion ? `${base}\n${suggestion}` : base;
    }
  }
  if (kind !== "image_edit" && kind !== "image_to_video") return null;
  const what = kind === "image_edit" ? "图生图" : "图生视频";
  if (!hasImageEditReferences(request, selected)) {
    return `${what}缺少参考图：这次请求里没有任何图片可以发给模型。请连接一张图片节点（或在参考槽添加图片）后再生成${kind === "image_edit" ? "，或切回「文生图」" : ""}。`;
  }
  if (!hasMapping) {
    // 别再让用户「删除后重新接入一次」——中转视频模型缺这条通道的根因在接入路径本身（它从来不建
    // image_to_video），重接一万次也一样；已由 catalogCommit 补齐 + v8 迁移给存量自愈。走到这里说明
    // 这个上游/模型确实没有该能力，如实说，别给假动作。
    return `模型「${modelLabel}」没有「${kind === "image_edit" ? "图生图（改图）" : "图生视频"}」通道，参考图发不出去。请改用支持${what}的模型${kind === "image_edit" ? "，或断开参考图走纯文生图" : "，或断开参考图走纯文生视频"}。`;
  }
  return null;
}

/** 参考图 URL 数组 → chat/completions content 的 image_url 项数组。非字符串/空 URL 剔除。 */
export function chatImageParts(referenceImages: unknown): Array<{ type: "image_url"; image_url: { url: string } }> {
  if (!Array.isArray(referenceImages)) return [];
  return referenceImages
    .filter((u): u is string => typeof u === "string" && u.trim() !== "")
    .map((url) => ({ type: "image_url", image_url: { url } }));
}

export type JsonImageEditReference = { type: "image_url"; url: string };

/** JSON image-edits 输入造型：1 张走 image，2~3 张走 images；保序、去空、按官方上限截断。 */
export function jsonImageEditInput(referenceImages: unknown): { image?: JsonImageEditReference; images?: JsonImageEditReference[] } {
  if (!Array.isArray(referenceImages)) return {};
  const refs = referenceImages
    .filter((url): url is string => typeof url === "string" && url.trim() !== "")
    .slice(0, 3)
    .map((url) => ({ type: "image_url" as const, url }));
  if (refs.length === 1) return { image: refs[0] };
  return refs.length > 1 ? { images: refs } : {};
}
