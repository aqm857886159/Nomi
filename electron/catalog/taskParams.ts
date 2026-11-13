// 请求参数构建（从 runtime.ts 抽出，评审 M5：可测 + 不喂大 runtime）。
// 把一个 TaskRequest 摊平成模板引擎要的 `{{request.params.*}}` 取值表——含标量、尺寸、时长、
// 以及档案驱动的参考输入（referenceInputParams）。**纯函数、依赖注入级别的纯**，故可零网络单测。
//
// 为什么单独成文件还配测试：duration 这种"数字被 firstString 吞成空串"的坑、omni 参考数组该不该进
// params 的坑，都只在"真实参数构建"里暴露，埋在 2500 行 runtime 里既测不到也容易回归。
import { assertDeclaredCapabilityForTask } from "../shared/modelAvailability";
import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { referenceInputParams } from "./archetypeInput";
import { ARCHETYPE_SIZE_RATIO_SEMANTIC } from "./archetypeWireDefaults.generated";
import { declaredModeParams, effectiveModeParams, modeWhenUnrecorded } from "../shared/modelArchetypes/modeParams";
import { resolveArchetypeVariant } from "../shared/modelArchetypes/variantResolution";
import { bodyReferencedParamKeys } from "./paramTranslate";
import { hasMentions, numberPromptReferences, projectPromptForSend } from "../shared/storyboard/promptMentions";
import { assertReferenceCapacity, bodyReferenceSupport, classifyReferenceKey, referenceUrlCount, type ModelModeBody, type ReferenceFamily } from "./referenceReachability";
import { referenceKeyCapacityDeclarationFor } from "../shared/modelArchetypes/referenceKeys";
import { lowerHeadlessReferences } from "../shared/generationLowering/headlessReferences";
import { withLoweredReferences, type LoweredGeneration } from "../shared/generationLowering/lowerGenerationIntent";
import { chatImageParts, jsonImageEditInput } from "./referenceCarrierShapes";
import { readSelectedComfyReferenceContract, type ParameterReferenceSelection } from "./parameterReferenceContract";
import { resolveWireModel, WIRE_MODEL_PARAM } from "../shared/modelArchetypes/wireModelIdentity";
import { comparableReferenceUrl, comparableReferenceValues, serializeReferenceParams } from "./outboundReferenceUrl";


/** taskTemplateParams 实际用到的 TaskRequest 子集（结构化，避免与 runtime 的 TaskRequest 循环依赖）。 */
export type TaskParamsInput = {
  /** 请求的 taskKind：没有显式 modeId 时，线上模型名的 owner 按它找主模式。 */
  kind?: string;
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
 * wire 必填参数兜底（headless/MCP 路）：UI 经 NodeGenerationComposer 按档案填好 size/voice 等（model 不归这里，见 taskTemplateParams）；
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
 * 一个比例形的 `size`（无头调用方或画布「写回多键」铺来的）该不该写进**这条模式**的 `size` 键。
 *
 * 背景：`size` 键名有歧义——apimart-seedream 等把它当**比例**读（wire 默认 "1:1"），而 volcengine-seedream /
 * modelscope / agnes / rh-qwen / rh-sora 把它当**像素**读（默认 "2048x2048" / "1024x1024" / "720x1280"）。
 * 旧的 nomi_generate 参数归一（已删）曾无差别把调用方比例铺进 size 别名，caller-wins 于是会把像素档案的 size 覆写成 "16:9"，
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

/** 请求里记着的变体（只认属于这个档案的记录；没写 id 的宿主合同也算），连同模型名交给变体的唯一 owner。 */
function recordedVariantId(archetype: NonNullable<ReturnType<typeof resolveArchetypeForModel>>, extras: Record<string, unknown> | undefined, modelKey: string | undefined): string | undefined {
  const selection = isJsonRecord(extras?.archetype) ? extras.archetype : {};
  const id = firstString(selection.id);
  const belongs = !id || id === archetype.id || (archetype.legacyIds ?? []).includes(id);
  return resolveArchetypeVariant(archetype, {
    ...(belongs ? { variantId: selection.variantId } : {}),
    modelId: firstString(extras?.modelKey, modelKey),
  })?.id;
}

/** 这个方式自己的默认值（固定参数 + 控件默认值），只给 size 别名闸的回退判据读。 */
function modeDefaultsOf(selection: Parameters<typeof declaredModeParams>[0]): Record<string, unknown> | undefined {
  const declared = declaredModeParams(selection);
  if (!declared) return undefined;
  const out: Record<string, unknown> = { ...declared.fixedParams };
  for (const control of declared.controls) if (control.defaultValue !== undefined) out[control.key] = control.defaultValue;
  return out;
}

/**
 * 发送前的三步（runtime 引擎 A 与 Run provider 同一个函数）：① **这个方式这次发哪些参数**只问方式参数 owner
 * （shared/modelArchetypes/modeParams.effectiveModeParams）：方式与变体读请求里带的（extras.archetype.modeId / variantId，
 * 渲染层已按输入现算过），这里不重算；没有方式记录、且目录行声明了档案的（Agent / MCP 无界面发送）按
 * modeWhenUnrecorded 取主方式。渲染层已过过一遍的请求再过一遍结果不变（幂等）。② mapping 级 defaultParams
 * （既有值优先，仅非档案派生的兜底）；③ **参考键形态投影**（createBody 给了才做，W1d）——把携带的参考投影到
 * body 真读的键（image_urls/first_frame_image…），见 headlessReferenceOverlay（放置交给 shared/generationLowering 的唯一降级函数）。
 *
 * 附一道 `size` 别名闸（见 sizeDefaultIsRatioSemantic）：调用方比例铺进的 `size` 仅当该模式 size 默认是比例形时
 * 才保留，否则剥掉，免得把只说像素的目标（火山 seedream 等）的 size 覆写成 "16:9" 发出废请求。
 *
 * `selected` 是这一次请求选中连接的**完整身份**——与清单、第三闸同一个 helper（modelCatalogListing.modelReferenceSelection）
 * 产出（2026-10-27）。以前这里只收散参数、往投影边界递一个只剩 `{ archetypeId }` 的缩减 meta：自写能力合同
 * （customCapabilityContract）声明的参考上限因此在第一闸读不到，headless 超量参考一路走到发送前才被别处拦或干脆发出去。
 */
export function applyHeadlessParamDefaults(
  extras: Record<string, unknown> | undefined,
  selected: ParameterReferenceSelection & { readonly taskKind: string },
  mappingDefaults: Record<string, unknown> | undefined,
  /** 这条 mapping 的 create body（给了才做参考键形态投影，W1d）。不给 = 只做①②缺参兜底，行为不变。 */
  createBody?: unknown,
): Record<string, unknown> | undefined {
  assertDeclaredCapabilityForTask(selected.modelMeta, selected.taskKind);
  const { taskKind, vendorKey } = selected;
  const declaredArchetype = isJsonRecord(selected.modelMeta) ? selected.modelMeta.archetypeId : undefined;
  const archetypeId = typeof declaredArchetype === "string" && declaredArchetype ? declaredArchetype : undefined;
  const archetype = selected.modeId || archetypeId ? resolveArchetypeForModel({
    modelKey: selected.modelKey, modelAlias: selected.modelAlias, vendorKey, meta: selected.modelMeta,
  }) : null;
  // 方式：请求里记着的为准；没有记录的只在目录行自己声明了档案时按主方式补（自建中转按模型名认出的档案不在这里补，老报文被升级测试钉住）。
  const mode = archetype
    ? (selected.modeId ? archetype.modes.find((candidate) => candidate.id === selected.modeId) : undefined)
      ?? (archetypeId ? modeWhenUnrecorded(archetype, taskKind, vendorKey) : undefined)
    : undefined;
  const modeSelection = archetype && mode
    ? { archetype, modeId: mode.id, variantId: recordedVariantId(archetype, extras, selected.modelKey) }
    : null;
  // extras.size 是比例形（调用方 aspect_ratio 铺来的）、但本模式的 size 是像素语义 → 剥掉，让档案像素默认接管。
  // 只针对「比例形的 caller size」，UI 路自己填的真实像素 size 不受影响（它不匹配 RATIO_VALUE_RE）。
  const guarded = extras && typeof extras.size === "string" && RATIO_VALUE_RE.test(extras.size.trim())
    && !sizeDefaultIsRatioSemantic(archetypeId, taskKind, archetypeId && modeSelection ? modeDefaultsOf(modeSelection) : undefined, mappingDefaults)
    ? (() => { const { size: _dropped, ...rest } = extras; return rest; })()
    : extras;
  const owned = modeSelection ? effectiveModeParams({ ...modeSelection, stored: guarded ?? {} }).params : guarded;
  const withDefaults = applyWireDefaults(owned, mappingDefaults);
  // ③ 参考键形态投影（既有值优先 → 渲染层已填 archetypeInput 时 no-op）。在缺参兜底之后做，看到的是合并后的 extras。
  if (typeof createBody === "undefined") return withDefaults;
  const projected = headlessReferenceLowering(withDefaults, createBody, selected);
  return projected.placedKeys.length ? withLoweredReferences(withDefaults || {}, projected) : withDefaults;
}

export function taskTemplateParams(request: TaskParamsInput, selected?: ParameterReferenceSelection): JsonRecord {
  // 出站参考链接只在这里序列化（outboundReferenceUrl）：下面派生的 image_url / reference_images /
  // chat_image_parts / json_edit_* 都取自序列化后的值，模板只是搬值，发出去的字段叫什么都不影响。
  const extras = serializeReferenceParams(request.extras || {});
  const size = request.width && request.height ? `${request.width}x${request.height}` : firstString(extras.size, extras.aspectRatio);
  // duration 可能是数字（节点「5s」标量参数存的就是 number 5）——firstString 只认字符串会把它吞成 ""，
  // 导致 body 的 duration 为空（实测）。数字原样保留，字符串走 trim。
  // 缺省：请求已过方式参数 owner（带 archetype.modeId）时，时长在不在由那个方式决定——缺就整键不发；
  // 不归档案管的请求（自建中转、ComfyUI…）照旧缺省 ""（老中转的报文被升级测试逐字钉住）。
  const durationRaw = extras.duration ?? extras.durationSeconds ?? extras.videoDuration;
  const durationText = typeof durationRaw === "number" ? durationRaw : firstString(durationRaw);
  const duration = durationText === "" && passedModeParamsOwner(extras) ? undefined : durationText;
  // Numeric controls can arrive from persisted node params as strings. Keep the
  // wire type stable for strict providers (APIMart TTS rejects speed="1.5").
  // Invalid non-empty values remain visible to the provider instead of being
  // silently replaced with a default.
  const speed = numericWireParam(extras.speed);
  const refInput = referenceInputParams(extras, selected);
  const jsonEditInput = jsonImageEditInput(refInput.reference_images);
  // **要发出去的 model 串**只问唯一 owner（electron/shared/modelArchetypes/wireModelIdentity.resolveWireModel）：
  // 这条 op 声明了收档案所选的线上名（只有内置目录登记表盖章）→ 变体 > 模式 modelEnum > 连接名；
  // 否则一律连接名（modelAlias || modelKey，与 `{{model.modelKey}}` 同一个表达式）。
  // 它在下面**最后**写进 params.model：extras.model、archetypeInput.model、headless 默认、Agent 参数
  // 都盖不掉——2026-10-16 两位用户的自建中转就是被 `...refInput` 里的档案名（kie 拆分 id）盖掉了连接名。
  // 键必须始终在场：模板对整 token 的 undefined 是整键丢弃，没有 model 的请求中转必 400。
  const wireModel = resolveWireModel({
    operation: selected?.operation,
    connection: {
      vendorKey: selected?.vendorKey ?? "",
      modelKey: firstString(selected?.modelKey, extras.modelKey),
      modelAlias: selected?.modelAlias,
      modelMeta: selected?.modelMeta,
    },
    extras,
    taskKind: request.kind,
  });
  const params: JsonRecord = {
    ...extras,
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
    steps: request.steps ?? numericWireParam(extras.steps),
    cfgScale: request.cfgScale,
    cfg_scale: request.cfgScale,
    negative_prompt: request.negativePrompt ?? extras.negative_prompt,
    duration,
    ...(speed !== undefined ? { speed } : {}),
    // 空→undefined（不是 ""）：body 的 `image: "{{request.params.image_url}}"` 整 token 渲染时，
    // undefined 会被丢弃、"" 却会当空字段发出去（纯文生图/文生视频误带 image:"" 会被部分中转拒）。
    image_url: firstReferenceImage({ extras }, selected) || undefined,
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
  // 最后一步、且只此一处：extras / archetypeInput / headless 默认里带来的 model 都不是输入。
  if (wireModel) params[WIRE_MODEL_PARAM] = wireModel;
  else delete params[WIRE_MODEL_PARAM];
  return params;
}

/** 这份 extras 过没过方式参数 owner：带着这次的方式记录（archetype.modeId）就算。 */
function passedModeParamsOwner(extras: JsonRecord): boolean {
  return isJsonRecord(extras.archetype) && firstString(extras.archetype.modeId) !== "";
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
function carriedReferences(extras: JsonRecord, selected?: ParameterReferenceSelection): Array<{ label: string; url: string; family: ReferenceFamily }> {
  const out: Array<{ label: string; url: string; family: ReferenceFamily }> = [];
  const seen = new Set<string>();
  const walk = (key: string, value: unknown): void => {
    if (typeof value === "string") {
      const url = value.trim();
      if (!url || !REF_URL_RE.test(url) || seen.has(url)) return;
      seen.add(url);
      out.push({ label: referenceLabelForKey(key), url, family: classifyReferenceKey(key) ?? "image" });
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
    out.push({ label: referenceLabelForKey(reference.family), url: reference.url, family: reference.family })
  }
  return out;
}

/**
 * 本次请求真正携带的参考素材，**按发送顺序**，带族别——供 `@[asset:url]` 投影成 `@imageN` 用。
 *
 * 为什么复用 `carriedReferences` 而不是另数一遍：编号必须与「真的发出去的那几条」一一对应，
 * 而那份真相源就是 `referenceInputParams`（wire 铺的就是它）。另写一份 = 编号与实际发送顺序
 * 慢慢对不上，而那种错**不报错**：供应商收到 `@image2` 却只拿到一张图。
 */
export function carriedPromptReferences(
  extras: JsonRecord,
  selected?: ParameterReferenceSelection,
): Array<{ url: string; kind: ReferenceFamily }> {
  return carriedReferences(extras, selected).map((reference) => ({ url: reference.url, kind: reference.family }));
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
  // params 里的参考已序列化（taskTemplateParams）：携带的原样地址按同一个序列化再比，带空格的参考不被误判发不出。
  const reachable = JSON.stringify(comparableReferenceValues(referencedKeys.map((key) => params[key])));
  const missing = new Set<string>();
  for (const ref of carried) if (!reachable.includes(comparableReferenceUrl(ref.url))) missing.add(ref.label);
  return [...missing];
}

/** 一个模式（taskKind）的 create body——供拒发建议判「哪个模式带得动我携带的参考」。 */
const FAMILY_LABEL: Record<ReferenceFamily, string> = { image: "参考图", video: "参考视频", audio: "参考音频" };
const FAMILY_PARAMETER_LABEL: Record<ReferenceFamily, string> = { image: "图片", video: "视频", audio: "音频" };
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

/** 发不出的参考里，请求体连同类声明位都没有的那几类：只给参考的调用方据此改成显式参数名（用户 10-25 拍板）。 */
function undeclaredReferenceHint(request: TaskParamsInput, createBody: unknown, selected?: ParameterReferenceSelection): string {
  const support = bodyReferenceSupport(createBody, selected);
  const undeclared = [...carriedReferenceFamilies(request.extras || {}, selected)].filter((family) => !support[family]);
  if (undeclared.length === 0) return "";
  return `这个模型的请求体没有声明${undeclared.map((family) => FAMILY_PARAMETER_LABEL[family]).join(" / ")}参考位，请在调用里写明参数名。`;
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
    const support = bodyReferenceSupport(mode.body, mode.selection);
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
function referenceUrlsByFamily(params: JsonRecord): Record<ReferenceFamily, string[]> {
  const out: Record<ReferenceFamily, string[]> = { image: [], video: [], audio: [] };
  const walk = (family: ReferenceFamily | null, value: unknown): void => {
    if (typeof value === "string") {
      const url = value.trim();
      if (family && REF_URL_RE.test(url) && !out[family].includes(url)) out[family].push(url);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(family, item);
    } else if (isJsonRecord(value)) {
      // The url inside a role object belongs to its declared carrier, just like a bare array item.
      for (const [key, item] of Object.entries(value)) walk(classifyReferenceKey(key) ?? family, item);
    }
  };
  walk(null, params);
  return out;
}

function carriedReferenceUrlsByFamily(extras: JsonRecord,
  selected?: ParameterReferenceSelection): Record<ReferenceFamily, string[]> {
  const exactComfy = comfyReferenceContract(extras, selected);
  const out = referenceUrlsByFamily(exactComfy ? {} : referenceInputParams(extras, selected));
  for (const reference of declaredComfyReferences(extras, selected)) {
    if (!out[reference.family].includes(reference.url)) out[reference.family].push(reference.url);
  }
  return out;
}

/**
 * headless / MCP 的参考读法（W1d 起的「body 读哪个键就放哪个键」）：读出这次携带了哪些参考、哪张明确是首 / 尾帧、
 * 哪些键已经有值，然后交给**唯一的降级函数**放（`shared/generationLowering/headlessReferences.ts` 按 body 推声明，
 * `lowerGenerationIntent` 放）。这里不挑键、不定形状、不写值——S3（2026-11-08）把这里原来的第三份拼法收走了。
 *
 * 先跑一圈「显式值的张数上限」：引擎 B 与 MCP 显式参数把参考直接写进 body 键（image_urls…），不经携带字段，
 * 也要在出网前按模型声明数清（2026-10-27）。
 *
 * @returns 仅**新放**的键（overlay）的冻结快照；无可放 → 空对象。只读：给测试、说明与盘点看；
 * 要并进请求参数走 `applyHeadlessParamDefaults`（它拿的是解析产物本身，经 `withLoweredReferences` 并入）。
 */
export function headlessReferenceOverlay(
  extras: Record<string, unknown> | undefined,
  createBody: unknown,
  selected?: ParameterReferenceSelection,
): Readonly<Record<string, unknown>> {
  return headlessReferenceLowering(extras, createBody, selected).snapshot();
}

/** headless 参考的解析产物（`headlessReferenceOverlay` 的读法 + 唯一的降级函数）；超量在这里出网前拒。 */
function headlessReferenceLowering(
  extras: Record<string, unknown> | undefined,
  createBody: unknown,
  selected?: ParameterReferenceSelection,
): LoweredGeneration {
  const src = extras || {};
  for (const key of bodyReferencedParamKeys(createBody)) {
    const detail = referenceKeyCapacityDeclarationFor(key, selected);
    if (!detail || detail.max === undefined) continue;
    // Renderer-produced archetypeInput is already capped by the shared slot writer;
    // only caller-supplied body values are checked here.
    assertReferenceCapacity(detail.family, detail.max, referenceUrlCount(src[key]));
  }

  const flatSource = { ...src };
  delete flatSource.archetypeInput;
  const archetypeInput = isJsonRecord(src.archetypeInput) ? src.archetypeInput : {};
  const hasNonEmpty = (value: unknown): boolean =>
    value !== null && typeof value !== "undefined" && (
      (typeof value === "string" && value.trim() !== "") ||
      (Array.isArray(value) && value.length > 0) ||
      (typeof value !== "string" && !Array.isArray(value))
    );
  const normalized = referenceInputParams(src, selected);
  const frameUrl = (key: string): string | undefined =>
    typeof normalized[key] === "string" && (normalized[key] as string).trim() ? (normalized[key] as string).trim() : undefined;
  const firstFrame = frameUrl("first_frame_url");
  const lastFrame = frameUrl("last_frame_url");
  const lowered = lowerHeadlessReferences(createBody, {
    carried: carriedReferenceUrlsByFamily(src, selected),
    flat: carriedReferenceUrlsByFamily(flatSource, selected),
    placedByCanvas: referenceUrlsByFamily(archetypeInput),
    frames: { ...(firstFrame ? { first_frame: firstFrame } : {}), ...(lastFrame ? { last_frame: lastFrame } : {}) },
    occupied: (key) => hasNonEmpty(src[key]) || hasNonEmpty(archetypeInput[key]),
    standardAggregateCarried: Array.isArray(src.referenceImages),
  }, selected);
  const problem = lowered.problems[0];
  if (problem) assertReferenceCapacity(problem.family, problem.max, problem.count);
  return lowered.lowered;
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
  // inlines its referenceImages into the one model call itself, so it has no
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
    // 拒不拒只看渲染后的请求体里真有没有这条参考（派生载体、别名都算数）；声明表只决定怎么说下一步。
    const unreachable = unreachableReferenceLabels(request, effectiveBody, selected);
    if (unreachable.length > 0) {
      const base = `模型「${modelLabel}」在这个接入方式下发不出：${unreachable.join(" / ")}。连上的这些素材不会进入请求——为免白扣费这次不发。请断开它们，或换一个支持这些参考的渠道/模型。`;
      const suggestion = reachableModeSuggestion(request, effectiveBody, modeBodies, selected);
      return [base, undeclaredReferenceHint(request, effectiveBody, selected), suggestion].filter(Boolean).join("\n");
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

/**
 * A5：发给供应商之前的**最终** prompt —— `@[asset:<url>]` 投影成 `@image1/@video1`。
 *
 * 引擎 A 只有 `runtime.runTask` 一个出口，所以判据收在这一个函数里、由它调一次：渲染层那条路在
 * `catalogTaskActions.ts` 已经投影过一次（串里不再有标记，这里是 no-op），而 headless 那两条
 * （外部 MCP 单发 `core.ts`、接入试跑 `tryModel.ts`）**从来没投影过**——供应商收到的是一串
 * `@[asset:nomi-local%3A%2F%2F…png]`，花了钱拿回错东西（对等矩阵 A5）。
 * 编号与投影规则住在共享层，与 Run 路径（`executionContract.projectContractPrompt`）同一份。
 * 没对上参考的孤儿标记按共享规则删掉（与界面上的非编辑态预览逐字相同），绝不原样外泄。
 */
export function projectOutboundPrompt(prompt: string, extras: Record<string, unknown> | undefined): string {
  if (!hasMentions(prompt)) return prompt;
  return projectPromptForSend(prompt, numberPromptReferences(carriedPromptReferences(extras || {})));
}
