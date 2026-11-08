/**
 * Run 路（引擎 B）的参考：合同里的参考与显式参考参数 → 降级函数的意图。
 *
 * 合同参考和显式参数都只声明用途、候选组、匹配规则与原值形状；由 `lowerGenerationIntent` 唯一选键。
 * Run 只检查授权地址冲突、保留既有值并消费降级结果，不再直接放置参考。
 * 键归哪一族、什么形状、是不是首尾帧，只读 shared 的键声明表（`referenceKeys.ts`），不认供应商。
 */
import { bodyReferencedParamKeys } from "../../catalog/paramTranslate";
import {
  referenceFrameKindFor,
  referenceKeyDeclarationFor,
  referenceKeyShapeFor,
  RUN_PATH_REFERENCE_KEYS,
  TRANSLATED_REFERENCE_INPUT_KEYS,
  type ReferenceFamily,
  type ReferenceFrameKind,
} from "../modelArchetypes/referenceKeys";
import type { ArchetypeMode, ArchetypeReferenceSlotKind } from "../videoCapabilities/types";
import { declarationForMode } from "./declarationForMode";
import { lowerGenerationIntent, type IntentReference, type PreservedReferenceIntent } from "./lowerGenerationIntent";

/** 标准输入键（`referenceInputParams` 认得、会归一成 headless 的携带参考）。 */
const STANDARD_LIST_KEY: Readonly<Record<ReferenceFamily, string>> = {
  image: "referenceImageUrls",
  video: "referenceVideoUrls",
  audio: "referenceAudioUrls",
};
const STANDARD_FRAME_KEY: Readonly<Record<ReferenceFrameKind, string>> = {
  first_frame: "first_frame_url",
  last_frame: "last_frame_url",
};
const TRANSLATED: ReadonlySet<string> = new Set(TRANSLATED_REFERENCE_INPUT_KEYS);

/**
 * Run 路合同参数认的参考键，按「同族 + 同形状（首 / 尾帧按帧意图）」分组：一组就是**同一个参考位的几种写法**。
 * 从声明表推出来（Run 路键表 × 族 × 形状 × 帧意图），组内顺序 = 声明顺序。
 */
function groupIdOf(key: string): string | null {
  if (!RUN_PATH_REFERENCE_KEYS.has(key)) return null;
  const declaration = referenceKeyDeclarationFor(key);
  if (!declaration) return null;
  return `${declaration.family}:${referenceFrameKindFor(key) ?? referenceKeyShapeFor(key, declaration.multiImage)}`;
}

const RUN_REFERENCE_GROUPS: ReadonlyMap<string, readonly string[]> = (() => {
  const groups = new Map<string, string[]>();
  for (const key of RUN_PATH_REFERENCE_KEYS) {
    const id = groupIdOf(key);
    if (id) groups.set(id, [...(groups.get(id) ?? []), key]);
  }
  return groups;
})();

export type RunReferenceGroup = Readonly<{
  keys: readonly string[];
  shape: "list" | "role-objects" | "frame";
}>;

/** 全部参考位分组（校验、计数、捞 URL 都按组走，一组只认第一个有值的写法）。 */
export function runReferenceGroups(): readonly RunReferenceGroup[] {
  return [...RUN_REFERENCE_GROUPS.entries()].map(([id, keys]) => {
    const tail = id.slice(id.indexOf(":") + 1);
    return { keys, shape: tail === "role-objects" ? "role-objects" : tail === "list" || tail === "single" ? "list" : "frame" };
  });
}

/** 这个键所在的组（不是 Run 路参考键 → null）。 */
export function runReferenceGroupOf(key: string): readonly string[] | null {
  const id = groupIdOf(key);
  return id ? RUN_REFERENCE_GROUPS.get(id) ?? null : null;
}

/** 这个键在组里的标准写法（组的第一个键，报错时用它称呼这个参考位）。 */
export function runReferenceGroupHead(key: string): string {
  return runReferenceGroupOf(key)?.[0] ?? key;
}

/** 族 / 帧 → 合同参考放到的标准输入键（`placeApprovedRunReferences` 写的就是它们）。 */
export function isStandardRunReferenceKey(key: string): boolean {
  return Object.values(STANDARD_LIST_KEY).includes(key) || Object.values(STANDARD_FRAME_KEY).includes(key);
}

function isStandardListKey(key: string): boolean {
  return Object.values(STANDARD_LIST_KEY).includes(key);
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}

export class RunReferenceError extends Error {
  constructor(
    message: string,
    readonly reason: "conflict" | "not-in-use" | "unsupported-role",
    readonly detail: Readonly<{ role?: string; kind?: string }> = {},
  ) {
    super(message);
    this.name = "RunReferenceError";
  }
}

/** 合同参考 → 槽种（素材种类优先，其次合同角色词；reference / character 都是图片参考槽）。 */
function slotKindForContractReference(reference: { kind?: string; role?: string }): ArchetypeReferenceSlotKind {
  return reference.kind === "video" ? "video_ref"
    : reference.kind === "audio" ? "audio_ref"
      : reference.role === "first_frame" ? "first_frame"
        : reference.role === "last_frame" ? "last_frame"
          : "image_ref";
}

export type ApprovedRunReference = Readonly<{ url: string; kind?: string; role?: string }>;

/**
 * 授权时封存的参考 → 意图 → 降级结果。数组形状和重复项保持原样，全部同组目标 / 空 body 组首键由降级函数决定。
 * 返回新参数与这一步写下的键（调用方报「参数不支持」时按参考位称呼它们）。
 */
export function placeApprovedRunReferences(
  parameters: Record<string, unknown>,
  references: readonly ApprovedRunReference[],
  createBody: unknown,
  mode: ArchetypeMode | null,
): { parameters: Record<string, unknown>; placedKeys: readonly string[] } {
  const out = structuredClone(parameters);
  const placedKeys: string[] = [];
  const bodyKeys = bodyReferencedParamKeys(createBody);
  const declaration = mode ? declarationForMode(mode, createBody) : null;
  const combine = declaration?.combine ?? null;
  const bodyHasFrame = (frame: ReferenceFrameKind): boolean =>
    bodyKeys.some((key) => runReferenceGroupOf(key) === runReferenceGroupOf(STANDARD_FRAME_KEY[frame]));
  const combined: IntentReference[] = [];
  // 按第一次出现的顺序记（写参数的顺序就是之后逐键核对的顺序）。
  const snapshot = new Map<string, string | string[]>();
  const append = (key: string, url: string): void => {
    const current = snapshot.get(key);
    snapshot.set(key, Array.isArray(current) ? [...current, url] : [url]);
  };
  for (const reference of references) {
    const kind = slotKindForContractReference(reference);
    const slot = combine && mode && declaration
      ? mode.slots.findIndex((candidate, index) => candidate.kind === kind && declaration.joinsCombine[index])
      : -1;
    if (slot >= 0) combined.push({ url: reference.url, slot });
    else if (reference.kind === "video") append(STANDARD_LIST_KEY.video, reference.url);
    else if (reference.kind === "audio") append(STANDARD_LIST_KEY.audio, reference.url);
    // 这一档合并里没有收这种参考的槽：明着拒，不带着合同角色词错发。
    else if (combine) throw new RunReferenceError("not-in-use", "not-in-use", { role: reference.role ?? "reference", kind: reference.kind ?? "image" });
    else if ((reference.role === "first_frame" || reference.role === "last_frame") && bodyHasFrame(reference.role)) {
      snapshot.set(STANDARD_FRAME_KEY[reference.role], reference.url);
    } else if (reference.role === "first_frame" || reference.role === "last_frame") {
      throw new RunReferenceError(`catalog mapping has unsupported reference role: ${reference.role}`, "unsupported-role", { role: reference.role });
    } else append(STANDARD_LIST_KEY.image, reference.url);
  }
  const preservedReferences: PreservedReferenceIntent[] = [...snapshot].map(([key, value]) => ({
    kind: slotKindForContractReference({ kind: referenceKeyDeclarationFor(key)?.family, role: referenceFrameKindFor(key) ?? undefined }),
    value,
    keys: isStandardListKey(key) ? runReferenceGroupOf(key) ?? [key] : [key],
    readKeys: bodyKeys,
    selection: "all-read-or-first",
  }));
  // 张数仍由 Run 的 assertResolvedReferences 按族核；这里不增加单槽超量拒发或模式固定参数。
  const lowered = lowerGenerationIntent(
    declaration ? { ...declaration, fixedParams: undefined } : { slots: [], combine: null, joinsCombine: [] },
    { references: combined, preservedReferences },
  );
  const entries = Object.entries(lowered.bodyParams).filter(([key, value]) => {
    const group = runReferenceGroupOf(key) ?? [key];
    const existing = group.map((candidate) => out[candidate]).find(present);
    // 合同写死的 URL 与授权时封存的不一致 = 批准 A、要发 B。拒。
    if (present(existing) && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new RunReferenceError("catalog reference URL projection conflicts with canonical parameters", "conflict");
    }
    return !present(out[key]);
  });
  Object.assign(out, Object.fromEntries(entries));
  placedKeys.push(...entries.map(([key]) => key));
  return { parameters: out, placedKeys };
}

/**
 * 这个显式参考参数，这份 mapping 收不收：mapping 直接读它，或读同一参考位的另一种写法。
 * 不收 → 调用方明着拒（「参数不支持」），不偷偷丢。
 */
export function runReferenceParameterAccepted(key: string, mappingKeys: ReadonlySet<string>): boolean {
  if (mappingKeys.has(key)) return true;
  const group = runReferenceGroupOf(key);
  return Boolean(group && group.some((candidate) => mappingKeys.has(candidate)));
}

/**
 * 显式参考参数里 body 不直接读的那些 → 首 / 尾帧 → 标准帧键（headless 按 body 的帧位放）；URL 数组 → body 读的同组写法
 * （都不读 → 组的标准写法）；角色数组 → body 读的同组写法。
 */
export function standardizeExplicitRunReferences(parameters: Record<string, unknown>, bodyKeys: readonly string[]): Record<string, unknown> {
  const out = structuredClone(parameters);
  const read = new Set(bodyKeys);
  const preservedReferences: PreservedReferenceIntent[] = [];
  for (const [key, value] of Object.entries(parameters)) {
    const group = runReferenceGroupOf(key);
    if (!group || read.has(key) || TRANSLATED.has(key) || !present(value)) continue;
    const frame = referenceFrameKindFor(key);
    const declaration = referenceKeyDeclarationFor(key)!;
    const shape = referenceKeyShapeFor(key, declaration.multiImage);
    preservedReferences.push({
      kind: slotKindForContractReference({ kind: declaration.family, role: frame ?? undefined }),
      value,
      keys: frame ? [STANDARD_FRAME_KEY[frame]] : shape === "role-objects" ? group
        : runReferenceGroupOf(STANDARD_LIST_KEY[declaration.family]) ?? [STANDARD_LIST_KEY[declaration.family]],
      readKeys: frame ? [] : bodyKeys,
      selection: shape === "role-objects" && !frame ? "first-read" : "all-read-or-first",
    });
  }
  const lowered = lowerGenerationIntent(
    { slots: [], combine: null, joinsCombine: [] },
    { references: [], preservedReferences },
  );
  return Object.assign(out, Object.fromEntries(Object.entries(lowered.bodyParams).filter(([key]) => !present(out[key]))));
}
