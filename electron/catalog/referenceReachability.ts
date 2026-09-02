// 「这条渠道到底带得动哪些参考」——**UI 收窄与第三闸共用的唯一判据**。
//
// 为什么必须共用：UI 的能力由**模型档案**声明（供应商无关，同一模型走哪家都显示同一套模式/槽），而
// 真正发出去的 body 由**渠道 mapping** 决定。两者此前只在「点生成那一刻」才对账（unreachableReferenceLabels），
// 于是 UI 热情地给出「首尾帧 / 全能参考 / 参考视频」，用户连好、切模式、点生成，才被拒。把判据抽到这里
// 供两侧共用，UI 才能提前说实话，且不会与闸门各自漂移（那正是本轮修掉的病）。
//
// 住在 electron/ 而非 src/：electron tsconfig 是 rootDir:"." 反向 import 不了 src；渲染层则本就 import
// 得到 electron（bridge.ts 已在做），且本模块依赖链纯净（paramTranslate → jsonUtils，后者零 import）。
import { bodyReferencedParamKeys } from "./paramTranslate";
// 渲染层的变体轴收窄也要「这条 create op 引用了哪些参数键」（body ∪ 进程 args）。它的单一实现在
// paramTranslate；从本模块转出一次，是因为 src→electron 的越界是棘轮门岗，渲染层已放行的入口只有
// 本文件这一条（archetypeMeta 那条基线）。让渲染层再直连 paramTranslate 会被判成新增违规。
export { wireReferencedParamKeys } from "./paramTranslate";

/** 一个参考槽在某条渠道上的真实承载力。 */
export type SlotReach =
  /** body 直接引用了这个槽的 inputKey → 该槽整组（含数组）都发得出。 */
  | "full"
  /** 槽本身发不出，但能挤进渠道的「单图聚合位」→ **只有 1 张**能过去。 */
  | "single"
  /** 完全发不出：连了也不会进请求。 */
  | "none";

/**
 * 渠道的「单图聚合位」。通用中转最小模板只有 `image: {{request.params.image_url}}`，而 params.image_url
 * 由 taskParams.firstReferenceImage 用 **firstString 优先级链** 聚合而来：
 *   image_url → imageUrl → firstFrameUrl → lastFrameUrl → referenceImages[0]
 * 是「链」不是「并」——**一次只有一个值挤得进去**。所以这类渠道的真实承载力是「一共 1 张」，
 * 不是「每个槽 1 张」。下面 modeSlotReach 按同一优先级把这唯一名额发给排最前的那个槽。
 */
const AGGREGATE_SINGLE_KEYS = ["image_url", "imageUrl", "image"];

/** 能挤进单图聚合位的槽 kind，**顺序即 firstReferenceImage 的优先级**（首帧 > 尾帧 > 参考图数组）。 */
const AGGREGATE_ELIGIBLE_KINDS = ["first_frame", "last_frame", "image_ref"];

/** 缺省 API 输入键（模型契约，供应商无关）。与渲染层 archetypeMeta.DEFAULT_INPUT_KEY 同表——
 *  两处都要改时靠 referenceReachability.test 的一致性用例兜住（那条会对着渲染层的表逐项比）。 */
export const DEFAULT_SLOT_INPUT_KEY: Record<string, string> = {
  first_frame: "first_frame_url",
  last_frame: "last_frame_url",
  image_ref: "reference_image_urls",
  video_ref: "reference_video_urls",
  audio_ref: "reference_audio_urls",
  source_video: "video_url",
};

/** 一个槽的最小描述（渲染层的 ArchetypeReferenceSlot 与 electron 侧共用的交集）。 */
export type ReachSlot = { kind: string; inputKey?: string };

function inputKeyOf(slot: ReachSlot): string {
  return (slot.inputKey || DEFAULT_SLOT_INPUT_KEY[slot.kind] || "").trim();
}

/**
 * 算一个模式下每个槽在这条渠道上的真实承载力。**纯函数**（可零网络单测）。
 *
 * @param slots      该模式声明的参考槽（顺序即档案里的声明顺序，仅用于稳定输出）
 * @param createBody 这条 mapping 的 create.body（判据 derive 自它引用的 {{request.params.X}}，不 hardcode 供应商）
 * @returns 与 slots 等长、一一对应的承载力数组
 */
export function modeSlotReach(slots: ReachSlot[], createBody: unknown, combineKey?: string): SlotReach[] {
  const referenced = new Set(bodyReferencedParamKeys(createBody));
  // body 完全不引用任何参数（如纯静态 body）→ 判不出来，一律放行不误伤（与第三闸同口径）。
  if (referenced.size === 0) return slots.map(() => "full");

  // 合并槽（mode.combineSlotsInto）：整组槽序列化进**同一个**参数发出——apimart 首尾帧走
  // `image_with_roles`、Veo 首尾帧走 `image_urls`(flat)。这时逐槽查自己的 inputKey 必然全落空，
  // 会把好端端的原生通道判死（reachNoOverNarrow.test 就是这么抓住我的）。认合并键即可。
  if (combineKey && referenced.has(combineKey.trim())) return slots.map(() => "full");

  const reach: SlotReach[] = slots.map((slot): SlotReach => {
    const key = inputKeyOf(slot);
    return key && referenced.has(key) ? "full" : "none";
  });

  // 单图聚合位：只有一个名额，按 firstReferenceImage 的优先级发给排最前的、且自己发不出的那个槽。
  const hasAggregate = AGGREGATE_SINGLE_KEYS.some((k) => referenced.has(k));
  if (hasAggregate) {
    for (const kind of AGGREGATE_ELIGIBLE_KINDS) {
      const idx = slots.findIndex((slot, i) => slot.kind === kind && reach[i] === "none");
      if (idx >= 0) {
        reach[idx] = "single";
        break; // 名额用完——后面的槽仍是 none，这正是「首尾帧只过得去首帧」的真相。
      }
    }
  }
  // A provider may expose a multi-image array while its shared archetype calls
  // the first item a first-frame slot (for example fal Gemini Omni's
  // reference-to-video route). The canonical projection preserves the first
  // frame as array[0], so count that channel as single rather than reporting a
  // completely unusable mode. The second optional frame remains conservative.
  const hasNoReach = reach.some((item) => item !== "none") === false;
  if (hasNoReach && referenced.has("image_urls")) {
    const idx = slots.findIndex((slot) => slot.kind === "first_frame" || slot.kind === "image_ref");
    if (idx >= 0) reach[idx] = "single";
  }
  return reach;
}

/** 整个模式在这条渠道上能不能用：所有声明的参考槽都发不出 = 这个模式在这里是空的。 */
export function modeIsUsable(slots: ReachSlot[], createBody: unknown, combineKey?: string): boolean {
  if (slots.length === 0) return true; // 纯文生模式没有参考槽，永远可用。
  return modeSlotReach(slots, createBody, combineKey).some((r) => r !== "none");
}

/** 一条 create body 能承载的参考类别（供 list_models 逐 mapping 汇报「这个模式带得动什么参考」）。 */
export type BodyReferenceSupport = {
  /** 能发得出图片参考（首/尾帧、角色图、单图聚合位等任一）。 */
  image: boolean;
  /** 能发得出参考视频（运镜/video-edit 源视频等）。 */
  video: boolean;
  /** 能发得出参考音频。 */
  audio: boolean;
  /** 图片参考能不能**多张**（body 引用了数组/多角色键）；false = 至多单图聚合位 1 张。 */
  multiImage: boolean;
};

// body 里「一个被引用的 param 键属于哪个参考族」的判据——**与 modeSlotReach 同一套 key 词汇**（缺省
// inputKey 表 + 单图聚合位 + 各 codec 原生数组/角色键），只是这里没有预声明 slot 列表、直接从 body 引用的
// 键反推能带什么（list_models 阶段拿不到 renderer 的 slot 声明）。顺序有意义：先帧/源视频再通用图，
// 避免 first_frame_image 被通用 image 规则先吞。数组/多角色键额外记进 multiImage。
const REFERENCE_KEY_FAMILY: Array<{ re: RegExp; family: "image" | "video" | "audio"; multiImage?: boolean }> = [
  { re: /video/i, family: "video" }, // *_video_* / video_urls / reference_video_urls / source_video_url
  { re: /audio|voice/i, family: "audio" }, // audio_urls / reference_audio_urls / volcengine_audio_contents
  // 多图信号：数组键（image_urls / input_urls / image_paths / reference_image(s) / *image_contents）与多角色键。
  { re: /image_urls|input_urls|image_paths|reference_images?|image_contents|image_with_roles/i, family: "image", multiImage: true },
  // 单图族：首/尾帧、单图聚合位（image / image_url / image_path / *_frame_url / *_frame_image / *role_image_content）。
  { re: /image|img|frame/i, family: "image" },
];

// **动作/开关键前缀**——它们名字里虽含 audio/frame/image 等词，却是布尔控制而非参考载体，必须先排除，否则
// 会把纯文生 body 误判成"能带参考"（真机 fixture 抓到：seedance 的 `generate_audio`(生成音频开关) 被 /audio/
// 命中、`return_last_frame`(返回尾帧图开关) 被 /frame/ 命中 → t2v 被谎报有音频/图参考）。判据：**首个下划线
// 段是动词/开关词**（generate/return/enable/disable/use/include/with/allow/need）→ 不是载体。载体键（image_with_roles /
// first_frame_url / reference_image_urls…）首段都是名词性资产词，天然不落这张表。
const CONTROL_KEY_PREFIX = /^(generate|return|enable|disable|use|include|with|allow|need|is|has|no)_/i;

export type ReferenceFamily = "image" | "video" | "audio";

/** 一个参考载体键的族 + 是否多值（数组/多角色键）。null = 不是参考载体。 */
export type ReferenceKeyKind = { family: ReferenceFamily; multiImage: boolean };

/**
 * 一个 param 键的参考分类明细（族 + 数组/单值），供「往这个键投影参考」时决定塞数组还是单串。
 * **与 classifyReferenceKey / bodyReferenceSupport 同一张表**（REFERENCE_KEY_FAMILY），不另写判据（P1）。
 * 动作/开关键（generate_audio / return_last_frame…）先被 CONTROL_KEY_PREFIX 排除 → 返回 null。
 */
export function classifyReferenceKeyDetailed(key: string): ReferenceKeyKind | null {
  if (CONTROL_KEY_PREFIX.test(key)) return null;
  for (const rule of REFERENCE_KEY_FAMILY) if (rule.re.test(key)) return { family: rule.family, multiImage: rule.multiImage === true };
  return null;
}

/**
 * 一个 param 键（或参考输入键）属于哪个参考族——image / video / audio / null（不是参考载体）。
 * **单一分类真相源**：body 承载力（bodyReferenceSupport）与「本次携带了哪些族」（拒发建议用）都用它，不各写一份。
 * 动作/开关键（generate_audio / return_last_frame…）先被 CONTROL_KEY_PREFIX 排除 → 返回 null。
 */
export function classifyReferenceKey(key: string): ReferenceFamily | null {
  return classifyReferenceKeyDetailed(key)?.family ?? null;
}

/**
 * 一条 create body 能承载哪些参考类别（纯函数）。**判据 derive 自 body 引用的 `{{request.params.X}}`**，
 * 与第三闸 / modeSlotReach 同源，不 hardcode 任何 vendor：把 body 引用键逐个归入 image/video/audio 族，
 * 数组/多角色键额外点亮 multiImage。body 不引用任何参数（纯静态）→ 判不出来，一律回全 false（诚实：
 * 与「判不出就不误伤」对称，list_models 不谎称有参考能力）。
 */
export function bodyReferenceSupport(createBody: unknown): BodyReferenceSupport {
  const support: BodyReferenceSupport = { image: false, video: false, audio: false, multiImage: false };
  for (const key of bodyReferencedParamKeys(createBody)) {
    if (CONTROL_KEY_PREFIX.test(key)) continue; // 动作/开关键（generate_audio / return_last_frame…）不是参考载体。
    for (const rule of REFERENCE_KEY_FAMILY) {
      if (rule.re.test(key)) {
        support[rule.family] = true;
        if (rule.multiImage) support.multiImage = true;
        break; // 命中最靠前的族即停（帧/视频/音频优先于通用图）。
      }
    }
  }
  return support;
}
