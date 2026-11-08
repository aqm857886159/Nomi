/**
 * 参考放置的**唯一降级函数**：一份声明（这一档模式的参考槽）+ 一份意图（每条参考落进第几个槽）→ 请求参数。
 *
 * ── 为什么只有这一个 ────────────────────────────────────────────────────────────────
 * 以前同一件事有三份拼法：画布路在渲染层按槽写键（`buildArchetypeInputParams`），
 * 主进程的 headless 路按 body 键名猜「族」再挑一个键（taskParams 里三条正则），
 * Run 路按合同角色词投到一张写死的键表、再把别名镜像一遍（引擎 B 的投影表 + 别名镜像）。
 * 三份各自演化，于是同一张图同一个模式两条路发出去不一样：双键、角色词不在官方枚举、
 * 按族封顶（官方字段矩阵的复现 1、2、3、5a）。现在三个入口都只做「把手上的东西说成意图」，
 * 放进哪个键、什么形状、带什么 role，只在这里按声明回答。
 * 收拢这一步不改任何一格请求体（官方字段矩阵改前改后逐字节相同）；那几格红的修法要改请求体，之后只改这里一处。
 *
 * ── 四条规则 ──────────────────────────────────────────────────────────────────────
 *  1. 每条参考按槽位表放进且只放进一个键（`slot.inputKey`，缺省按槽种）；
 *  2. 合并槽按 role 合成一个对象数组（`combine`，role 表见 referenceChannels），被合并的扁平键不再出现；
 *  3. 张数超过槽的 `max`、或指向不存在的槽，是 problem，不静默截断也不另找一个键；
 *  4. 模式的固定参数（`fixedParams`，如 generation_type）最后铺上，键不与槽冲突。
 *
 * 纯函数、同步：不读盘、不读目录、不认供应商名。声明从哪里来见 `declarationForMode.ts`。
 */
import type { ArchetypeReferenceSlot, ArchetypeReferenceSlotKind } from "../videoCapabilities/types";
import { REFERENCE_ROLE_FOR_KIND, type ReferenceCombineChannel } from "../videoCapabilities/referenceChannels";
import { loweringAsArray, loweringInputKey } from "./slotInputKeys";

export { DEFAULT_LOWERING_INPUT_KEY, loweringAsArray, loweringInputKey } from "./slotInputKeys";

const ARRAY_SLOT_KINDS: ReadonlySet<ArchetypeReferenceSlotKind> = new Set(["image_ref", "video_ref", "audio_ref"]);

/** 降级要读的槽字段（档案槽的子集；推导出来的声明也只填这些）。 */
export type LoweringSlot = Pick<ArchetypeReferenceSlot, "kind" | "inputKey" | "asArray" | "max" | "roleName">;

/** 一档模式的放置声明。`combine` 已经按「这条 body 读不读那个合并键」定好（见 declarationForMode）。 */
export type GenerationDeclaration = Readonly<{
  slots: readonly LoweringSlot[];
  /** 与 `slots` 同序：这个槽是否并进 `combine`（声明顺序就是合并顺序）。 */
  combine: ReferenceCombineChannel;
  joinsCombine: readonly boolean[];
  fixedParams?: Readonly<Record<string, string>>;
}>;

/** 一条参考意图：地址 + 它落进声明里的第几个槽。 */
export type IntentReference = Readonly<{ url: string; slot: number }>;

/** Run 的既有参考值：形状、重复项和角色对象原样保留，候选组的落键仍由降级函数决定。 */
export type PreservedReferenceIntent = Readonly<{
  kind: ArchetypeReferenceSlotKind;
  value: unknown;
  keys: readonly string[];
  readKeys: readonly string[];
  selection: "all-read-or-first" | "first-read";
}>;

export type GenerationIntent = Readonly<{
  references: readonly IntentReference[];
  preservedReferences?: readonly PreservedReferenceIntent[];
}>;

export type LoweringProblem =
  | Readonly<{ code: "reference_over_capacity"; slot: number; kind: ArchetypeReferenceSlotKind; max: number; count: number }>
  | Readonly<{ code: "reference_slot_unknown"; slot: number; url: string }>;

export type LoweredGeneration = Readonly<{ bodyParams: Record<string, unknown>; problems: readonly LoweringProblem[] }>;

// 火山方舟 content[] 的三种媒体项。键名就是声明里的 inputKey（seedanceVolcengine*.ts），不认供应商名。
function volcengineImageItem(url: string, role: string): Record<string, unknown> {
  return { type: "image_url", image_url: { url }, role };
}

function volcengineArrayItems(inputKey: string, urls: readonly string[]): Array<Record<string, unknown>> | null {
  if (inputKey === "volcengine_image_contents") {
    const role = REFERENCE_ROLE_FOR_KIND.image_ref ?? "reference_image";
    return urls.map((url) => volcengineImageItem(url, role));
  }
  if (inputKey === "volcengine_video_contents") {
    const role = REFERENCE_ROLE_FOR_KIND.video_ref ?? "reference_video";
    return urls.map((url) => ({ type: "video_url", video_url: { url }, role }));
  }
  if (inputKey === "volcengine_audio_contents") {
    const role = REFERENCE_ROLE_FOR_KIND.audio_ref ?? "reference_audio";
    return urls.map((url) => ({ type: "audio_url", audio_url: { url }, role }));
  }
  return null;
}

function volcengineSingleItem(inputKey: string, url: string): Record<string, unknown> | null {
  if (inputKey === "volcengine_first_image_content" || inputKey === "volcengine_first_role_image_content") {
    return volcengineImageItem(url, REFERENCE_ROLE_FOR_KIND.first_frame ?? "first_frame");
  }
  if (inputKey === "volcengine_last_role_image_content") {
    return volcengineImageItem(url, REFERENCE_ROLE_FOR_KIND.last_frame ?? "last_frame");
  }
  return null;
}

/** 合并槽按声明顺序编码：扁平通道只要地址，角色通道每条带这一槽的线上 role。 */
function encodeCombined(
  channel: NonNullable<ReferenceCombineChannel>,
  entries: ReadonlyArray<{ order: number; url: string }>,
): string[] | Array<{ url: string; role: string }> {
  const ordered = [...entries].sort((a, b) => a.order - b.order);
  return channel.flat ? ordered.map(({ url }) => url)
    : ordered.map(({ order, url }) => ({ url, role: channel.roleSlots[order]!.role }));
}

/**
 * 每个槽收到的地址：保序、去空白。不去重：同一张图给两次是调用方的事（画布合并连线与上传时已去重、
 * headless 的携带参考已去重），Run 路历来照原样发，降级不替谁改。
 */
function urlsBySlot(declaration: GenerationDeclaration, intent: GenerationIntent, problems: LoweringProblem[]): string[][] {
  const bySlot = declaration.slots.map(() => [] as string[]);
  for (const reference of intent.references) {
    const url = typeof reference.url === "string" ? reference.url.trim() : "";
    if (!url) continue;
    const bucket = bySlot[reference.slot];
    if (!bucket) {
      problems.push({ code: "reference_slot_unknown", slot: reference.slot, url });
      continue;
    }
    bucket.push(url);
  }
  return bySlot;
}

/**
 * 意图 → 请求参数（键 = 声明的 inputKey / 合并键 / 固定参数键）。有 problem 时 `bodyParams` 仍按规则给出
 * （方便调用方说清楚是哪一格），但调用方**不许**拿它去发：problem 非空就在花钱之前拒。
 */
export function lowerGenerationIntent(declaration: GenerationDeclaration, intent: GenerationIntent): LoweredGeneration {
  const problems: LoweringProblem[] = [];
  const bySlot = urlsBySlot(declaration, intent, problems);
  const out: Record<string, unknown> = {};
  for (const [index, slot] of declaration.slots.entries()) {
    const urls = bySlot[index]!;
    if (slot.max !== undefined && urls.length > slot.max) {
      problems.push({ code: "reference_over_capacity", slot: index, kind: slot.kind, max: slot.max, count: urls.length });
    }
    if (!urls.length) continue;
    const inputKey = loweringInputKey(slot);
    if (ARRAY_SLOT_KINDS.has(slot.kind)) {
      // 声明 asArray:false 的单值数组槽（Agnes i2v 的 image）发单图字符串：声明说话算话。没写 max 的单值槽
      // （按 body 推出来的声明，见 headlessReferences）同样只放一张——调用方已经只给它一张。
      out[inputKey] = volcengineArrayItems(inputKey, urls)
        ?? (!loweringAsArray(slot) && (slot.max === undefined || slot.max === 1) ? urls[0] : [...urls]);
      continue;
    }
    const url = urls[0]!;
    out[inputKey] = volcengineSingleItem(inputKey, url) ?? (loweringAsArray(slot) ? [url] : url);
  }
  // 角色数组合并：本模式有值的合并槽 → combine.key 上的一个数组；被合并的扁平键删掉（同一张图只进一个键）。
  // 必须在这里拼好整个数组——模板引擎丢得掉 undefined 键，丢不掉 {url: undefined} 对象。
  const channel = declaration.combine;
  if (channel) {
    const entries: Array<{ order: number; url: string }> = [];
    let order = 0;
    for (const [index, slot] of declaration.slots.entries()) {
      if (!declaration.joinsCombine[index]) continue;
      // 并进去的是这个槽收到的全部地址（单值槽超量照样记 problem，拒不拒由调用方定，这里不替它截）。
      for (const url of bySlot[index]!) entries.push({ order, url });
      delete out[loweringInputKey(slot)];
      order++;
    }
    const combined = encodeCombined(channel, entries);
    if (combined.length) out[channel.key] = combined;
  }
  for (const reference of intent.preservedReferences ?? []) {
    const read = reference.keys.filter((key) => reference.readKeys.includes(key));
    const targets = reference.selection === "first-read" ? read.slice(0, 1)
      : read.length ? read : reference.keys.slice(0, 1);
    for (const key of targets) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = structuredClone(reference.value);
    }
  }
  for (const [key, value] of Object.entries(declaration.fixedParams ?? {})) out[key] = value;
  return { bodyParams: out, problems };
}
