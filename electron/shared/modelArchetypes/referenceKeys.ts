// 通用参考键全集（单一真相源，渲染层和主进程共用）——**推导**出来，不手写（#1269 条件 2，2026-10-23）。
//
// 这些键可能躺在节点 meta 里（上传、旧工程、MCP canvas.write 的 metadata 原样透传），又会经 `...meta` → extras →
// taskTemplateParams 的 `...extras` 一路进请求体，或被主进程当参考翻译（referenceInputParams / firstReferenceImage /
// 参考放置的唯一降级函数 shared/generationLowering）。所以「当前方式没声明、界面没在用就不许发」这条规矩
// 必须对**整张表**生效：渲染层 buildReferenceExtras 先把整张表置 undefined、只填唯一推导出的在用值；主进程
// assertNoReferenceResidueBeforeSend 按整张表拒发。
//
// 以前是手写的 29 个键，漏了请求体直接读的 image_urls / first_frame_image / image_with_roles / video_list … 共 30 个
// （验收 V-b1a-r3 的夹带探针就从这里过去）——10-22 方向检查第 2 节预言过：按键过滤的黑名单，每多一个读口就多一个漏点。
// 现在由四处**声明**合成，加档案、加槽、加别名都自动进表：
//   ① TRANSLATED_REFERENCE_INPUT_KEYS：主进程把参考翻成请求体之前读的标准输入键（不是请求体键）；
//   ② 每个档案每个方式的参考槽 inputKey 与合并键 combineSlotsInto.key——按 M1 合同，请求体就是从这些键读参考；
//   ③ Run 路（引擎 B）合同参数里认的参考键（apimartReferenceKeyDeclarations；以前还配一张别名镜像表，S3 删了，放置只走降级函数）；
//   ④ 档案的 headlessReferenceKeys：请求体认、生成框没有控件的参考输入（KIE Gemini Omni 的 video_list…、fal 改图的 mask_url）；
//   ⑤ REFERENCE_PARKED_KEY：节点上「先放一边」的旧工程残留（不是请求输入，但装的是图）；
//   ⑥ DERIVED_REFERENCE_CARRIER_KEYS：主进程 taskTemplateParams 把标准参考输入造型成协议形状的请求体键（chat 图片项、JSON 改图）。
// 完整性门：referenceSentWithinInUse.property.test.ts「键表完整性」——内置目录每条请求体读的键都要能归类，
// 新请求体多读一个参考键而没进这张表，那里先红。
import { MODEL_ARCHETYPES, resolveArchetypeForModel } from "./index";
import type { ModelArchetype, ArchetypeMode, ArchetypeReferenceSlot } from "./types";
import { loweringInputKey } from "../generationLowering/slotInputKeys";

export type ReferenceFamily = "image" | "video" | "audio";

export type ReferenceKeyDeclaration = Readonly<{
  family: ReferenceFamily;
  multiImage: boolean;
}>;

export type ReferenceModelContext = Readonly<{
  modelKey?: string | null;
  modelAlias?: string | null;
  vendorKey?: string | null;
  modelMeta?: unknown;
  archetypeId?: string | null;
  taskKind?: string;
  modeId?: string;
}>;

export type ReferenceKeyCapacityDeclaration = ReferenceKeyDeclaration & Readonly<{
  max?: number;
  source: "model-declaration" | "key-shape-inference";
}>;

type DeclaredReferenceKey = { key: string; family: ReferenceFamily; multiImage?: boolean };

const translatedReferenceKeyDeclarations: readonly DeclaredReferenceKey[] = [
  { key: "image", family: "image" },
  { key: "image_url", family: "image" },
  { key: "imageUrl", family: "image" },
  { key: "referenceImages", family: "image", multiImage: true },
  { key: "referenceImageUrl", family: "image" },
  { key: "referenceImageUrls", family: "image", multiImage: true },
  { key: "referenceImageRef", family: "image" },
  { key: "referenceImageRefs", family: "image", multiImage: true },
  { key: "reference_images", family: "image", multiImage: true },
  { key: "reference_image_urls", family: "image", multiImage: true },
  { key: "firstFrameUrl", family: "image" },
  { key: "firstFrameRef", family: "image" },
  { key: "firstFrameReference", family: "image" },
  { key: "first_frame_url", family: "image" },
  { key: "lastFrameUrl", family: "image" },
  { key: "lastFrameRef", family: "image" },
  { key: "lastFrameReference", family: "image" },
  { key: "last_frame_url", family: "image" },
  { key: "referenceVideoUrls", family: "video" },
  { key: "reference_video_urls", family: "video" },
  { key: "sourceVideoUrl", family: "video" },
  { key: "source_video_url", family: "video" },
  { key: "video_url", family: "video" },
  { key: "referenceAudioUrls", family: "audio" },
  { key: "reference_audio_urls", family: "audio" },
  { key: "styleReferenceImages", family: "image", multiImage: true },
  { key: "characterReferenceImages", family: "image", multiImage: true },
  { key: "compositionReferenceImages", family: "image", multiImage: true },
  { key: "upstreamResultUrls", family: "image", multiImage: true },
];

/** ① 主进程翻译读的标准参考输入键（referenceInputParams / firstReferenceImage / jsonImageEditInput / 旧的按槽存键与影子）。 */
export const TRANSLATED_REFERENCE_INPUT_KEYS: readonly string[] = translatedReferenceKeyDeclarations.map(({ key }) => key);

/**
 * ⑤ 节点上存着图、但不是请求输入的键：「先放一边」的旧工程残留（src/workbench/generationCanvas/nodes/controls/referenceList.ts
 * 的 PARKED_KEY 就是它，#1269 条件 4）。它们照样是图——随 `...meta` 进了 extras 会被当成上传白名单（activeAssetUrls）托管出去，
 * 所以同样进表：渲染层清掉，主进程见到就拒。
 */
export const REFERENCE_PARKED_KEY = "referenceParkedUrls";

/**
 * ⑥ 主进程派生的请求体载体：taskTemplateParams 每次都从标准参考输入（reference_images）现造这几个键——chat/completions
 * content 里的图片项、JSON image-edits 的 image / images。请求体就是从它们读参考，所以照样进表（承载力、拒发、普查都认）；
 * 值永远由主进程重造，headless 投影不往里填。taskParams.test.ts「填了参考地址的派生键都有声明」守着这张表不漏。
 */
const derivedReferenceCarrierDeclarations: Readonly<Record<string, ReferenceKeyDeclaration>> = {
  chat_image_parts: { family: "image", multiImage: true },
  json_edit_image: { family: "image", multiImage: false },
  json_edit_images: { family: "image", multiImage: true },
};
export const DERIVED_REFERENCE_CARRIER_KEYS: ReadonlySet<string> = new Set(Object.keys(derivedReferenceCarrierDeclarations));

const headlessReferenceKeyDeclarations: Readonly<Record<string, ReferenceKeyDeclaration>> = {
  mask_url: { family: "image", multiImage: false },
  audio_ids: { family: "audio", multiImage: false },
  video_list: { family: "video", multiImage: false },
  character_ids: { family: "image", multiImage: true },
};

const apimartReferenceKeyDeclarations: Readonly<Record<string, ReferenceKeyDeclaration>> = {
  image_urls: { family: "image", multiImage: true },
  imageUrls: { family: "image", multiImage: true },
  input_urls: { family: "image", multiImage: true },
  inputUrls: { family: "image", multiImage: true },
  reference_image_urls: { family: "image", multiImage: true },
  referenceImageUrls: { family: "image", multiImage: true },
  image_with_roles: { family: "image", multiImage: true },
  imageWithRoles: { family: "image", multiImage: true },
  video_urls: { family: "video", multiImage: false },
  videoUrls: { family: "video", multiImage: false },
  reference_video_urls: { family: "video", multiImage: false },
  referenceVideoUrls: { family: "video", multiImage: false },
  audio_urls: { family: "audio", multiImage: false },
  audioUrls: { family: "audio", multiImage: false },
  reference_audio_urls: { family: "audio", multiImage: false },
  referenceAudioUrls: { family: "audio", multiImage: false },
  first_frame_image: { family: "image", multiImage: false },
  firstFrameImage: { family: "image", multiImage: false },
  first_frame_url: { family: "image", multiImage: false },
  firstFrameUrl: { family: "image", multiImage: false },
  last_frame_image: { family: "image", multiImage: false },
  lastFrameImage: { family: "image", multiImage: false },
  last_frame_url: { family: "image", multiImage: false },
  lastFrameUrl: { family: "image", multiImage: false },
};

/** ③ Run 路合同参数里认的参考键（请求体也常直接读它们）。 */
export const RUN_PATH_REFERENCE_KEYS: ReadonlySet<string> = new Set(Object.keys(apimartReferenceKeyDeclarations));

// ── ⑦ 形状与帧意图（S3，2026-11-08）────────────────────────────────────────────────
// 没有档案模式可读时（headless / MCP、Run 没带 modeId），参考放进 body 的哪个键、什么形状，只读下面这几张**显式声明**，
// 不按键名猜（以前 taskParams 里是三条正则：/first_frame/、/with_roles|_contents?/、/_urls$|images$|…/）。
// 三张表的成员就是那三条正则在今天声明表上命中的键（逐个核过），新键要进哪张由声明它的人写，不再由名字决定。
export type ReferenceKeyShape = "single" | "list" | "role-objects" | "content-items" | "derived";
export type ReferenceFrameKind = "first_frame" | "last_frame";

/** 值是 `[{url, role}]` 的角色数组键。 */
const ROLE_OBJECT_REFERENCE_KEYS: ReadonlySet<string> = new Set(["image_with_roles", "imageWithRoles"]);
/** 值是火山方舟 content[] 项的键（形状由降级函数按槽造）。 */
const CONTENT_ITEM_REFERENCE_KEYS: ReadonlySet<string> = new Set([
  "volcengine_image_contents", "volcengine_video_contents", "volcengine_audio_contents",
  "volcengine_first_image_content", "volcengine_first_role_image_content", "volcengine_last_role_image_content",
]);
/** 多值（URL 数组）但声明的 multiImage 不说多张的键：视频 / 音频复数键与几个档案的复数图键。 */
const LIST_REFERENCE_KEYS: ReadonlySet<string> = new Set([
  "video_urls", "videoUrls", "reference_video_urls", "referenceVideoUrls", "videos", "mm_videos",
  "audio_urls", "audioUrls", "reference_audio_urls", "referenceAudioUrls", "audios", "mm_audios",
  "images", "input_images", "keyframe_images", "mf_images", "mm_images",
]);
/** 明确表示「这一张是首帧 / 尾帧」的键。 */
const FRAME_REFERENCE_KEYS: Readonly<Record<string, ReferenceFrameKind>> = {
  first_frame: "first_frame", first_frame_image: "first_frame", first_frame_url: "first_frame",
  firstFrameImage: "first_frame", firstFrameUrl: "first_frame",
  last_frame: "last_frame", last_frame_image: "last_frame", last_frame_url: "last_frame",
  lastFrameImage: "last_frame", lastFrameUrl: "last_frame",
};

/** 一个参考键的值形状。`multiImage` 传这个键在当前模型上下文里的声明（容量声明可能按档案改写它）。 */
export function referenceKeyShapeFor(key: string, multiImage = referenceKeyDeclarationFor(key)?.multiImage ?? false): ReferenceKeyShape {
  const normalized = key.trim();
  if (DERIVED_REFERENCE_CARRIER_KEYS.has(normalized)) return "derived";
  if (ROLE_OBJECT_REFERENCE_KEYS.has(normalized)) return "role-objects";
  if (CONTENT_ITEM_REFERENCE_KEYS.has(normalized)) return "content-items";
  return multiImage || LIST_REFERENCE_KEYS.has(normalized) ? "list" : "single";
}

/** 这个键是否声明为首帧 / 尾帧位；null = 不带帧意图。 */
export function referenceFrameKindFor(key: string): ReferenceFrameKind | null {
  return FRAME_REFERENCE_KEYS[key.trim()] ?? null;
}

const SLOT_REFERENCE_FAMILY: Readonly<Record<string, ReferenceFamily>> = {
  first_frame: "image",
  last_frame: "image",
  image_ref: "image",
  video_ref: "video",
  audio_ref: "audio",
  source_video: "video",
};


function mergeDeclaration(
  declarations: Map<string, ReferenceKeyDeclaration>,
  key: string,
  declaration: ReferenceKeyDeclaration,
): void {
  const normalized = key.trim();
  if (!normalized) return;
  const previous = declarations.get(normalized);
  if (previous && previous.family !== declaration.family) {
    // A combined key with mixed slots is represented by its first plain-media shape.
    // Object-shaped combined values are never used by headless projection.
    return;
  }
  declarations.set(normalized, {
    family: previous?.family ?? declaration.family,
    multiImage: Boolean(previous?.multiImage || declaration.multiImage),
  });
}

function declaredArchetypeReferenceKeyDeclarations(): Map<string, ReferenceKeyDeclaration> {
  const declarations = new Map<string, ReferenceKeyDeclaration>();
  for (const archetype of MODEL_ARCHETYPES) {
    for (const key of archetype.headlessReferenceKeys ?? []) {
      const declaration = headlessReferenceKeyDeclarations[key];
      if (!declaration) throw new Error(`headless reference key has no explicit media declaration: ${key}`);
      mergeDeclaration(declarations, key, declaration);
    }
    for (const mode of archetype.modes) {
      for (const slot of mode.slots) {
        if (!slot.inputKey) continue;
        const family = SLOT_REFERENCE_FAMILY[slot.kind];
        if (!family) throw new Error(`reference slot kind has no explicit media declaration: ${slot.kind}`);
        mergeDeclaration(declarations, slot.inputKey, {
          family,
          multiImage: slot.asArray === true,
        });
      }
      if (mode.combineSlotsInto) {
        const family = mode.slots
          .map((slot) => SLOT_REFERENCE_FAMILY[slot.kind])
          .find((candidate): candidate is ReferenceFamily => Boolean(candidate));
        if (family) mergeDeclaration(declarations, mode.combineSlotsInto.key, {
          family,
          multiImage: mode.combineSlotsInto.flat === true || mode.slots.length > 1,
        });
      }
    }
  }
  return declarations;
}

const REFERENCE_KEY_DECLARATIONS: ReadonlyMap<string, ReferenceKeyDeclaration> = (() => {
  const declarations = new Map<string, ReferenceKeyDeclaration>();
  for (const declaration of translatedReferenceKeyDeclarations) {
    mergeDeclaration(declarations, declaration.key, {
      family: declaration.family,
      multiImage: declaration.multiImage === true,
    });
  }
  for (const [key, declaration] of Object.entries(apimartReferenceKeyDeclarations)) mergeDeclaration(declarations, key, declaration);
  for (const [key, declaration] of Object.entries(derivedReferenceCarrierDeclarations)) mergeDeclaration(declarations, key, declaration);
  for (const [key, declaration] of declaredArchetypeReferenceKeyDeclarations()) mergeDeclaration(declarations, key, declaration);
  return declarations;
})();

export function referenceKeyDeclarationFor(key: string): ReferenceKeyDeclaration | null {
  return REFERENCE_KEY_DECLARATIONS.get(key.trim()) ?? null;
}

function archetypeForContext(context: ReferenceModelContext | undefined): ModelArchetype | null {
  if (!context) return null;
  return resolveArchetypeForModel({
    modelKey: context.modelKey,
    modelAlias: context.modelAlias,
    vendorKey: context.vendorKey,
    meta: context.modelMeta ?? (context.archetypeId ? { archetypeId: context.archetypeId } : undefined),
  });
}

function slotInputKey(slot: ArchetypeReferenceSlot): string {
  return loweringInputKey(slot).trim();
}

function modeMatchesTaskKind(mode: ArchetypeMode, taskKind: string | undefined): boolean {
  return !taskKind || mode.transportTaskKind === taskKind;
}

function modelDeclarationForModeKey(mode: ArchetypeMode, key: string): ReferenceKeyCapacityDeclaration | null {
  const slotMatches = mode.slots.filter((slot) => slotInputKey(slot) === key);
  if (slotMatches.length > 0) {
    const family = slotMatches.map((slot) => SLOT_REFERENCE_FAMILY[slot.kind]).find(Boolean);
    if (!family) return null;
    const sameFamily = slotMatches.filter((slot) => SLOT_REFERENCE_FAMILY[slot.kind] === family);
    const max = sameFamily.every((slot) => typeof slot.max === "number")
      ? sameFamily.reduce((sum, slot) => sum + (slot.max ?? 0), 0)
      : undefined;
    return {
      family,
      multiImage: max === undefined ? sameFamily.some((slot) => slot.asArray === true) : max > 1,
      ...(max === undefined ? {} : { max }),
      source: "model-declaration",
    };
  }
  const combined = mode.combineSlotsInto;
  if (!combined || combined.key !== key) return null;
  const families = mode.slots.map((slot) => SLOT_REFERENCE_FAMILY[slot.kind]).filter(Boolean);
  const family = families[0];
  if (!family) return null;
  const sameFamily = mode.slots.filter((slot) => SLOT_REFERENCE_FAMILY[slot.kind] === family);
  const max = sameFamily.length > 0 && sameFamily.every((slot) => typeof slot.max === "number")
    ? sameFamily.reduce((sum, slot) => sum + (slot.max ?? 0), 0)
    : undefined;
  return {
    family,
    multiImage: max === undefined ? combined.flat === true || sameFamily.length > 1 : max > 1,
    ...(max === undefined ? {} : { max }),
    source: "model-declaration",
  };
}

/** Resolve a body key against the selected model's own slot declaration first. */
export function referenceKeyCapacityDeclarationFor(
  key: string,
  context?: ReferenceModelContext,
): ReferenceKeyCapacityDeclaration | null {
  const normalized = key.trim();
  if (!normalized) return null;
  const archetype = archetypeForContext(context);
  if (archetype) {
    const selectedMode = archetype.modes.find((mode) => mode.id === context?.modeId);
    for (const mode of selectedMode ? [selectedMode] : archetype.modes) {
      if (!selectedMode && !modeMatchesTaskKind(mode, context?.taskKind)) continue;
      const declaration = modelDeclarationForModeKey(mode, normalized);
      if (declaration) return declaration;
    }
    for (const candidate of archetype.headlessReferenceKeys ?? []) {
      if (candidate === normalized) {
        const generic = referenceKeyDeclarationFor(normalized);
        if (generic) return { ...generic, source: "model-declaration" };
      }
    }
  }
  const generic = referenceKeyDeclarationFor(normalized);
  return generic ? { ...generic, source: "key-shape-inference" } : null;
}

/** 通用参考键全集由同一份带媒体类别的声明表派生。 */
export const GENERIC_REFERENCE_KEYS: ReadonlySet<string> = new Set([
  ...REFERENCE_KEY_DECLARATIONS.keys(),
  REFERENCE_PARKED_KEY,
]);
