// 请求里「这次携带了哪些参考素材」的读法（从 taskParams.ts 按职责拆出，2026-11-15，函数体逐字不变）。
// 真相源 = referenceInputParams(extras)（与 wire 同源）+ ComfyUI 精确参考契约；发送参数（taskParams.ts）与
// 发前诚实护栏（taskParamsGuard.ts）都从这里读，不另数一遍。
import { firstString, isJsonRecord, type JsonRecord } from "../jsonUtils";
import { referenceInputParams } from "./archetypeInput";
import { hasMentions, numberPromptReferences, projectPromptForSend } from "../shared/storyboard/promptMentions";
import { classifyReferenceKey, type ReferenceFamily } from "./referenceReachability";
import { readSelectedComfyReferenceContract, type ParameterReferenceSelection } from "./parameterReferenceContract";
import type { TaskParamsInput } from "./taskParams";

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
  // 任何在共享参考键表声明过的显式参考载体键（image / image_with_roles / image_urls …）一视同仁计入，不硬编码单个 image。
  const declaredReferenceValues = Object.entries(extras)
    .filter(([key]) => classifyReferenceKey(key) !== null)
    .map(([, value]) => value);
  return containsRefUrl([declaredReferenceValues, referenceInputParams(extras, selected)]);
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
export function carriedReferences(extras: JsonRecord, selected?: ParameterReferenceSelection): Array<{ label: string; url: string; family: ReferenceFamily }> {
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

/** 本次请求携带的参考族（从 referenceInputParams 的键 derive，与 body 承载力同一套 classifyReferenceKey）。 */
export function carriedReferenceFamilies(extras: JsonRecord, selected?: ParameterReferenceSelection): Set<ReferenceFamily> {
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
 * 本次携带的参考 URL，按族分组、保序去重（image 内首/尾帧排前，同 carriedReferences 口径）。
 * 真相源 = referenceInputParams(extras)——headless 路的 referenceImages/firstFrameUrl/… 都归一到它。
 */
export function referenceUrlsByFamily(params: JsonRecord): Record<ReferenceFamily, string[]> {
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

export function carriedReferenceUrlsByFamily(extras: JsonRecord,
  selected?: ParameterReferenceSelection): Record<ReferenceFamily, string[]> {
  const exactComfy = comfyReferenceContract(extras, selected);
  const out = referenceUrlsByFamily(exactComfy ? {} : referenceInputParams(extras, selected));
  for (const reference of declaredComfyReferences(extras, selected)) {
    if (!out[reference.family].includes(reference.url)) out[reference.family].push(reference.url);
  }
  return out;
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
