// 内置档案的**参考输入构建**（评审 M5：input-builder 放 electron/catalog，不喂大 runtime.ts）。
//
// 把 TaskRequest.extras 里的参考字段（camelCase，渲染层投影出来的当前模式键）翻译成**通用 snake
// 参数键**——单图首/尾帧 + 多参考数组（image/video/audio）。这些是供应商无关的中间键；各供应商
// mapping body 再把它们映射到自己真正的 input 键（如 kie 的 `reference_video_urls ` 含尾随空格，
// §2 坑1，只在 kieSeedance body 写一次 = M1 单源）。
//
// **M2 互斥**：camelCase 只投影非空值；显式 snake 槽值原样保留（null 表示该槽空着）。
// 当前方式没声明的参考键不许进 body，两道守：
//   ① 渲染层 catalogTaskActions.buildReferenceExtras 对有档案的模型，把 GENERIC_REFERENCE_KEYS 全集先置 undefined，
//      值只取唯一推导（placeUploadedImages，经 uploadPlacementForMode）——结构上做不出残留；
//   ② 主进程 runTask 入口先过 findReferenceResidue（下面），不信①——带档案投影的请求，通用参考键里凡是
//      不在 archetypeInput 里的地址 → 在花钱之前拒发（electron/tasks/referenceResidueGuard.ts，协调 10-22 定）。
// 键表由声明推导（shared/modelArchetypes/referenceKeys.ts：翻译输入键 + 各槽 inputKey / 合并键 + APIMart 别名 + 档案的
// headlessReferenceKeys），值递归收（对象形也认）——#1269 条件 2，用户 10-23 拍板 A。
// 两道都由 referenceSentWithinInUse.property.test.ts 钉住（全部档案 × 每个方式，中转 / APIMart / 内置全部供应商真请求体，
// 外加「请求体实际读的参考键」普查和逐键夹带）。
import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { readParameterReferenceSlotsContract, readSelectedComfyReferenceContract, type ParameterReferenceSelection } from "../shared/contracts/parameterReferenceContract";
import { GENERIC_REFERENCE_KEYS } from "../shared/modelArchetypes/referenceKeys";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function collectStrings(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === "string") {
    if (value.trim()) into.add(value.trim());
  } else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, into));
  return into;
}

/** 参考值对象里只描述「这是什么」、不装素材的字段（`[{url, role}]` 的 role、火山 content 的 type）。 */
const REFERENCE_DESCRIPTOR_FIELDS = new Set(["role", "type"]);

/**
 * 一个参考键的值里装着的素材（地址 / id）：字符串、数组、对象形（`image_with_roles: [{url, role}]`、
 * 火山 `{type, image_url: {url}, role}`）一样递归收——以前只认字符串和字符串数组，对象形的夹带看不见（#1269 条件 2）。
 * 对象里描述用的 role / type 不算素材；其余字段一律收（新的值形状默认算素材：宁可拒发，不放行看不见的图）。
 */
function referenceValueStrings(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (value.trim()) into.add(value.trim());
  } else if (Array.isArray(value)) value.forEach((item) => referenceValueStrings(item, into));
  else if (value && typeof value === "object") {
    for (const [field, item] of Object.entries(value)) if (!REFERENCE_DESCRIPTOR_FIELDS.has(field)) referenceValueStrings(item, into);
  }
  return into;
}

/**
 * 主进程这道守（契约②，见文件头）：带档案投影（`extras.archetypeInput`）的请求，渲染层已按**当前方式**把每个
 * 声明槽的值打进 archetypeInput；通用参考键里凡是不在它里面的地址，就是别的方式 / 旧工程 / MCP metadata 留下的
 * 残留——界面上没在用，发出去就是花错钱。这里**只找不改**：返回带着残留的那些键（空 = 干净），由
 * referenceResidueGuard 在花钱之前拒发。
 *
 * 不带档案投影的请求（无档案模型、ComfyUI 参数契约、headless 调用方显式给的参考）不查：那里没有「当前方式」可比。
 * 显式参数参考槽（参数契约声明的键）也不查：它们的值本来就不进 archetypeInput。
 */
export function findReferenceResidue(extras: JsonRecord): string[] {
  if (!isJsonRecord(extras.archetypeInput)) return [];
  const inUse = collectStrings(extras.archetypeInput, new Set());
  const declaredParameterKeys = new Set(readParameterReferenceSlotsContract(extras).map((slot) => slot.key));
  const residue: string[] = [];
  for (const key of GENERIC_REFERENCE_KEYS) {
    if (declaredParameterKeys.has(key) || !Object.prototype.hasOwnProperty.call(extras, key)) continue;
    if ([...referenceValueStrings(extras[key])].some((item) => !inUse.has(item))) residue.push(key);
  }
  return residue;
}

/**
 * 从 extras 构建参考相关的 snake 参数：聚合兜底 < 显式槽值 < 档案投影。
 *
 * 认得档案的模型：renderer 已据当前模式把完整 snake input 打好放进 `extras.archetypeInput`
 * （含 per-mode enum + 互斥投影，见 archetypeMeta.buildArchetypeInputParams）——这里**原样采用**，
 * 是单一来源。非档案模型：从 camelCase extras 现场映射（兼容既有 onboarding 模型，不破坏）。
 */
export function referenceInputParams(extras: JsonRecord, selected?: ParameterReferenceSelection): JsonRecord {
  const out: JsonRecord = {};
  const firstFrame = firstString(extras.firstFrameUrl);
  const lastFrame = firstString(extras.lastFrameUrl);
  if (firstFrame) out.first_frame_url = firstFrame;
  if (lastFrame) out.last_frame_url = lastFrame;

  const imageUrls = stringArray(extras.referenceImageUrls);
  const videoUrls = stringArray(extras.referenceVideoUrls);
  const audioUrls = stringArray(extras.referenceAudioUrls);
  if (imageUrls.length) out.reference_image_urls = imageUrls;
  if (videoUrls.length) {
    out.reference_video_urls = videoUrls;
    // 单源视频的标准键（与 first_frame_url 同构）：「视频进视频出」的工作流（补帧/视频超分/
    // 视频去背景）只吃一条源视频，模板引用它比引用数组第 0 项直白得多。
    out.source_video_url = videoUrls[0];
  }
  if (audioUrls.length) out.reference_audio_urls = audioUrls;

  out.reference_images = Array.isArray(extras.referenceImages) ? extras.referenceImages : [];
  // 已按声明槽分配的值不能被数组顺序覆盖；显式 null 也不能借用另一槽的素材。
  // image_url 同样在此叠加，覆盖 taskTemplateParams 的单图聚合兜底。
  const exactComfy = Boolean(readSelectedComfyReferenceContract(extras, selected));
  for (const key of ["image_url", "first_frame_url", "last_frame_url", "source_video_url", "reference_images", "reference_image_urls", "reference_video_urls", "reference_audio_urls"]) {
    const value = extras[key];
    const nonEmpty = (typeof value === "string" && Boolean(value.trim()))
      || (Array.isArray(value) && value.length > 0)
      || (value !== null && typeof value === "object" && Object.keys(value as object).length > 0);
    const exactEmpty = exactComfy && (value === null || (Array.isArray(value) && value.length === 0));
    // Non-empty explicit snake values remain valid for every vendor. Empty/null slot authority belongs only to
    // the selected Comfy contract, so a default [] cannot erase a populated legacy aggregate.
    if (Object.prototype.hasOwnProperty.call(extras, key) && (nonEmpty || exactEmpty)) out[key] = value;
  }
  // 档案投影**叠加**在标准键之上（同名键档案权威）——绝不替代整包。旧实现 archetypeInput 独占返回，
  // 标准键（reference_images/chat_image_parts 的原料/first_frame_url）被吞 → 通用中转模板拿不到参考：
  // multipart 改图空图被拒、chat 多模态丢图、i2v 首帧到不了 wire（2026-07-24 群反馈根因）。
  // 内置家零影响：它们的 body 只引用各自声明的键（input_urls/volcengine_* …），多出的标准键不进 body。
  if (isJsonRecord(extras.archetypeInput)) {
    Object.assign(out, extras.archetypeInput);
  }
  return out;
}
