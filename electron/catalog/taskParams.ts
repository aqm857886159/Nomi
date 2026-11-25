// 请求参数构建（从 runtime.ts 抽出，评审 M5：可测 + 不喂大 runtime）。
// 把一个 TaskRequest 摊平成模板引擎要的 `{{request.params.*}}` 取值表——含标量、尺寸、时长、
// 以及档案驱动的参考输入（referenceInputParams）。**纯函数、依赖注入级别的纯**，故可零网络单测。
//
// 为什么单独成文件还配测试：duration 这种"数字被 firstString 吞成空串"的坑、omni 参考数组该不该进
// params 的坑，都只在"真实参数构建"里暴露，埋在 2500 行 runtime 里既测不到也容易回归。
import { assertDeclaredCapabilityForTask } from "../shared/modelAvailability";
import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { builtInSizeIsRatioSemantic, resolveModelArchetype, type ArchetypeVariantRequest } from "../shared/modelArchetypes";
import { referenceInputParams } from "./archetypeInput";
import { declaredModeParams, effectiveModeParams, modeWhenUnrecorded } from "../shared/modelArchetypes/modeParams";
import { resolveArchetypeVariant } from "../shared/modelArchetypes/variantResolution";
import { bodyReferencedParamKeys } from "./paramTranslate";
import { assertReferenceCapacity, referenceUrlCount, type ReferenceFamily } from "./referenceReachability";
import { referenceFrameKindFor, referenceKeyCapacityDeclarationFor } from "../shared/modelArchetypes/referenceKeys";
import { lowerHeadlessReferences } from "../shared/generationLowering/headlessReferences";
import { withLoweredReferences, type LoweredGeneration } from "../shared/generationLowering/lowerGenerationIntent";
import { chatImageParts, jsonImageEditInput } from "./referenceCarrierShapes";
import type { ParameterReferenceSelection } from "./parameterReferenceContract";
import { resolveWireModel, WIRE_MODEL_PARAM } from "../shared/modelArchetypes/wireModelIdentity";
import { serializeReferenceParams } from "./outboundReferenceUrl";
import { referenceValueCount, validateModeConstraints, type ModeInputEvidence, type ReferenceCounts } from "../shared/videoCapabilities/crossFieldConstraints";
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from "../shared/modelArchetypes/types";
import { declarationForMode } from "../shared/generationLowering/declarationForMode";
import { SLOT_ACCEPTS } from "../shared/modelArchetypes/anchorPolicy";
import { modeInputRefusal } from "./modeInputRefusal";
import { encodeParamsForWire } from "../shared/videoCapabilities/paramValue";
import { findArchetypeMode } from "../shared/videoCapabilities/sampleMode";
export { ModeInputMissingError } from "./modeInputRefusal";
import { carriedReferenceUrlsByFamily, firstReferenceImage, referenceUrlsByFamily } from "./taskParamsReferences";


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
 * **判据从档案 size 控件的选项集 DERIVE**（入口 builtInSizeIsRatioSemantic 发送时现算）：选项集里有真比例档
 * （16:9…）→ 这个 size 键是比例语义，哪怕它的默认值是 "adaptive" 这种比例族自动档（seedance-2.5-apimart t2v
 * 正是此例：size 默认 "adaptive"、body 只读 size，旧的「按默认值字面 /^\d+:\d+$/ 猜」会误判成像素语义、把调用方
 * 16:9 剥掉 → 画幅被吞）。只有档案里查不到该 (archetypeId, taskKind)（如自定义 / 不是内置的档案）才回退到旧的
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
  const emitted = archetypeId ? builtInSizeIsRatioSemantic(archetypeId, taskKind) : undefined;
  if (typeof emitted === "boolean") return emitted;
  // ② 回退（不是内置档案）：按合并后真正生效的 size 默认值字面形状猜。
  // 有效默认 = 合并后真正生效的那个（mappingDefaults 是更贴近的兜底、后铺，故它有 size 时以它为准）。
  const effective = mappingDefaults && "size" in mappingDefaults
    ? mappingDefaults.size
    : archetypeDefaults?.size;
  return typeof effective === "string" && RATIO_VALUE_RE.test(effective.trim());
}

/** 请求里记着的变体（只认属于这个档案的记录；没写 id 的宿主合同也算），连同模型名交给变体的唯一 owner。 */
function recordedVariantRequest(archetype: ModelArchetype, extras: Record<string, unknown> | undefined, modelKey: string | undefined): ArchetypeVariantRequest {
  const selection = isJsonRecord(extras?.archetype) ? extras.archetype : {};
  const id = firstString(selection.id);
  const belongs = !id || id === archetype.id || (archetype.legacyIds ?? []).includes(id);
  return { variantId: belongs ? selection.variantId : undefined, modelId: firstString(extras?.modelKey, modelKey) };
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
  /** 这次真实派发走哪条路（发送口用 sendRouteFor 定一次）。缺省 = 就按这份 createBody 发。 */
  route: SendRoute = MAPPING_BODY_ROUTE,
): Record<string, unknown> | undefined {
  assertDeclaredCapabilityForTask(selected.modelMeta, selected.taskKind);
  const { taskKind, vendorKey } = selected;
  const declaredArchetype = isJsonRecord(selected.modelMeta) ? selected.modelMeta.archetypeId : undefined;
  const archetypeId = typeof declaredArchetype === "string" && declaredArchetype ? declaredArchetype : undefined;
  // 档案按请求里记着的那一档收窄（入口给的就是收窄好的；方式、管辖键、输入核对都读这一份）。
  const variant = (every: ModelArchetype) => recordedVariantRequest(every, extras, selected.modelKey);
  const archetype = selected.modeId || archetypeId ? resolveModelArchetype({
    modelKey: selected.modelKey, modelAlias: selected.modelAlias, vendorKey, meta: selected.modelMeta,
  }, { variant }) : null;
  // 方式：请求里记着的为准；没有记录的只在目录行自己声明了档案时按主方式补（自建中转按模型名认出的档案不在这里补，老报文被升级测试钉住）。
  const mode = archetype
    ? findArchetypeMode(archetype, selected.modeId)
      ?? (archetypeId ? modeWhenUnrecorded(archetype, taskKind, vendorKey) : undefined)
    : undefined;
  const modeSelection = archetype && mode
    ? { archetype, modeId: mode.id, variantId: resolveArchetypeVariant(archetype, variant(archetype))?.id }
    : null;
  // extras.size 是比例形（调用方 aspect_ratio 铺来的）、但本模式的 size 是像素语义 → 剥掉，让档案像素默认接管。
  // 只针对「比例形的 caller size」，UI 路自己填的真实像素 size 不受影响（它不匹配 RATIO_VALUE_RE）。
  const guarded = extras && typeof extras.size === "string" && RATIO_VALUE_RE.test(extras.size.trim())
    && !sizeDefaultIsRatioSemantic(archetypeId, taskKind, archetypeId && modeSelection ? modeDefaultsOf(modeSelection) : undefined, mappingDefaults)
    ? (() => { const { size: _dropped, ...rest } = extras; return rest; })()
    : extras;
  const owned = modeSelection ? effectiveModeParams({ ...modeSelection, stored: guarded ?? {} }).params : guarded;
  // 出口编码：门里的参数值是内部类型（RunningHub 时长 12），这里按档案声明的报文写法编回去（"12"）。放在补供应商操作默认值
  // 之前——那些默认本来就是报文写法，一个字节都不动。认档案与声明门同一个入口（按模型名也认）；方式不知道就看全部方式。
  const wireArchetype = archetype ?? resolveModelArchetype({
    modelKey: selected.modelKey, modelAlias: selected.modelAlias, vendorKey, meta: selected.modelMeta,
  }, { variant });
  const encoded = encodeParamsForWire(mode ? mode.params : wireArchetype?.modes.flatMap((candidate) => candidate.params) ?? [], owned);
  const withDefaults = applyWireDefaults(encoded, mappingDefaults);
  // ③ 参考键形态投影（既有值优先 → 渲染层已填 archetypeInput 时 no-op）。在缺参兜底之后做，看到的是合并后的 extras。
  if (typeof createBody === "undefined") return withDefaults;
  const projected = headlessReferenceLowering(withDefaults, createBody, selected);
  const lowered = projected.placedKeys.length ? withLoweredReferences(withDefaults || {}, projected) : withDefaults;
  // ④ 这个方式收不收这一次的参数和输入（缺必需输入 / 依赖的槽没有 / 选项要的槽没有 / 参数组合 / 参考合计）：
  // 两个发送口都经这里，判在降级之后——数的是真要发出去的那几个键。规则只在 crossFieldConstraints 一处。
  if (modeSelection) assertModeAcceptsInputs(modeSelection, lowered ?? {}, createBody, selected, route);
  return lowered;
}

/**
 * 这次请求真实派发走哪条路。只在发送口定一次（runtime.ts 解析出自定义调用脚本之后），发送前核输入（第④步）和
 * 老护栏 imageEditGuardError 读同一个结果：
 *   · mapping-body：按这条 mapping 的 create body 发，判定看得清这份 body 读哪几族素材。
 *   · script：自定义调用脚本接管，脚本自己读 params（referenceImages 等），目录里留着的 mapping body 不是派发那份——
 *     判定看不清，不拒（2026-11-14：新判定按失效的旧 body 把给了图的请求数成 0）。
 */
export type SendRoute = { readonly sends: "mapping-body" } | { readonly sends: "script" };
const MAPPING_BODY_ROUTE: SendRoute = { sends: "mapping-body" };
export function sendRouteFor(customCallScript: string | undefined): SendRoute {
  return customCallScript ? { sends: "script" } : MAPPING_BODY_ROUTE;
}
/** 这条路真要发出去的 create body（脚本接管 = 没有）。 */
export function dispatchedCreateBody(route: SendRoute, createBody: unknown): unknown {
  return route.sends === "script" ? undefined : createBody;
}

/**
 * 降级后的请求里，这个方式每个槽各带了几件（按绑定数：自己的键数项数，合并键按角色数；扁平合并分不清就整袋都算给它，宁可不拒），
 * 外加看不看得清：脚本接管 → unseen（只交下限）；按 body 发 → seen，调用方交了、body 却没有这一族位置的件数记进 unrouted。
 */
function modeInputEvidence(
  mode: ArchetypeMode,
  values: Record<string, unknown>,
  createBody: unknown,
  selected: ParameterReferenceSelection,
  route: SendRoute,
): ModeInputEvidence {
  const placedByCanvas = isJsonRecord(values.archetypeInput) ? values.archetypeInput : {};
  const read = (key: string): unknown => {
    const top = values[key];
    return referenceValueCount(top) > 0 ? top : placedByCanvas[key];
  };
  const countBy = (declaration: ReturnType<typeof declarationForMode>): ReferenceCounts => {
    const counts: ReferenceCounts = {};
    for (const binding of declaration.bindings) {
      const target = binding.target;
      let count = 0;
      if (target.select === "declared") count = referenceValueCount(read(target.key));
      else if (target.select === "combined") {
        const value = read(target.key);
        const items = Array.isArray(value) ? value : [];
        count = binding.encoding.shape === "role-objects"
          ? items.filter((item) => isJsonRecord(item) && item.role === target.role).length
          : referenceValueCount(value);
      }
      counts[binding.kind] = (counts[binding.kind] ?? 0) + count;
    }
    return counts;
  };
  // 两份绑定都数、每种取大：按这条 body 的绑定（Run 路降级落的键），和按方式声明的绑定（画布拿不到 body，按方式声明放进
  // archetypeInput；body 不读合并键的渠道，模板照样从那里取——Runway Veo 首尾帧的 promptImage 就取自 image_urls）。
  const bodyDeclaration = declarationForMode(mode, createBody);
  const modeDeclaration = declarationForMode(mode);
  const byBody = countBy(bodyDeclaration);
  const byMode = countBy(modeDeclaration);
  const counts: ReferenceCounts = { ...byBody };
  for (const [kind, count] of Object.entries(byMode) as Array<[ArchetypeReferenceSlotKind, number]>) counts[kind] = Math.max(counts[kind] ?? 0, count);
  // body 读、但两份声明都没绑的参考键：调用方直接写在 body 键上的，或没有方式可读时「按 body 推声明」的降级按素材族挑的键
  // （headless / MCP 给标准输入键：Wan 首帧方式的图落 image_urls、Runway 的图落 image_url）。它们照样发出去。
  // 键自己说了是首帧 / 尾帧、这个方式又有那个槽 → 只算给那个槽；别的分不清是哪个槽 → 算给这个方式里收这一族素材的每个槽，宁可不拒。
  const credit = (family: ReferenceFamily, frame: ArchetypeReferenceSlotKind | null, count: number, into: ReferenceCounts = counts) => {
    if (count === 0) return;
    const slots = frame && mode.slots.some((slot) => slot.kind === frame)
      ? [frame]
      : mode.slots.filter((slot) => SLOT_ACCEPTS[slot.kind].includes(family)).map((slot) => slot.kind);
    for (const kind of slots) into[kind] = Math.max(into[kind] ?? 0, count);
  };
  const bodyKeys = bodyReferencedParamKeys(createBody);
  const declaredKeys = new Set([...bodyDeclaration.bindings, ...modeDeclaration.bindings]
    .flatMap(({ target }) => ("key" in target ? [target.key] : [...target.keys])));
  const bodyFamilies = new Set<ReferenceFamily>();
  for (const key of bodyKeys) {
    const family = referenceKeyCapacityDeclarationFor(key, selected)?.family;
    if (!family) continue;
    bodyFamilies.add(family);
    if (!declaredKeys.has(key)) credit(family, referenceFrameKindFor(key) ?? null, referenceValueCount(read(key)));
  }
  // 标准输入键（firstFrameUrl / referenceImages …）：调用方交进来的素材本身，在被各家键名改写之前。有的 body 不读具体键、
  // 由模板参数层从它们派生载体（火山 Seedance 的 volcengine_*_content 就从首帧 / 参考图造）。body 读得到这一族素材，就按标准键
  // 带的件数算，同样宁可不拒；body 根本没有这一族的位 → 带了也发不出去，记进 unrouted（判定说「这家走不了这个方式」，不说「没给」）。
  // 脚本接管：body 不是派发那份，问它读不读这一族没有意义——标准键照数（下限），整份标成看不清。
  const standard = referenceInputParams(values, selected);
  const STANDARD: ReadonlyArray<readonly [string, ReferenceFamily, ArchetypeReferenceSlotKind | null]> = [
    ["first_frame_url", "image", "first_frame"], ["last_frame_url", "image", "last_frame"],
    ["reference_images", "image", null], ["reference_image_urls", "image", null],
    ["reference_video_urls", "video", null], ["reference_audio_urls", "audio", null],
  ];
  const unrouted: ReferenceCounts = {};
  for (const [key, family, frame] of STANDARD) {
    const routed = route.sends === "script" || bodyFamilies.has(family);
    credit(family, frame, referenceValueCount(standard[key]), routed ? counts : unrouted);
  }
  return route.sends === "script" ? { route: "unseen", counts } : { route: "seen", counts, unrouted };
}

function assertModeAcceptsInputs(
  selection: { archetype: ModelArchetype; modeId: string; variantId?: string },
  values: Record<string, unknown>,
  createBody: unknown,
  selected: ParameterReferenceSelection,
  route: SendRoute,
): void {
  // selection.archetype 是入口按 selection.variantId 那一档收窄好的，不再收一遍。
  const { archetype } = selection;
  const mode = findArchetypeMode(archetype, selection.modeId);
  if (!mode) return;
  const evidence = modeInputEvidence(mode, values, createBody, selected, route);
  const violation = validateModeConstraints(mode, values, evidence);
  if (!violation) return;
  throw modeInputRefusal(archetype, mode, evidence.counts, violation);
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
