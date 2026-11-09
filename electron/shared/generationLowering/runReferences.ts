/**
 * Run 路（引擎 B）的参考：合同里的参考与显式参考参数 → 绑定 + 意图，交给唯一的解析写入过程（`lowerGenerationIntent`）。
 *
 * 旧落点规则（同组写法 body 读到的全写、都不读写组首；首尾帧取最后一张；角色数组落 body 读的第一个写法；
 * 已有值优先；授权地址冲突就拒）在这里写成**绑定声明**，与档案槽编译出来的绑定是同一种东西、走同一个写入过程。
 * 这里只做两件事：把每条参考指到一个绑定（合同角色 / 素材种类 → 合并槽、旧落点，或明着拒），以及把冲突说成 Run 的错误。
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
import { combineForMode, declarationForMode } from "./declarationForMode";
import { lowerGenerationIntent, type IntentReference, type ReferenceBinding } from "./lowerGenerationIntent";

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

const FAMILY_SLOT_KIND: Readonly<Record<ReferenceFamily, ArchetypeReferenceSlotKind>> = {
  image: "image_ref",
  video: "video_ref",
  audio: "audio_ref",
};

/** 旧落点：一族一个参考位，body 读到的同组写法全写、都不读写组首；同一参考位已有值就沿用。 */
function legacyListBinding(family: ReferenceFamily): ReferenceBinding {
  const key = STANDARD_LIST_KEY[family];
  return {
    kind: FAMILY_SLOT_KIND[family],
    target: { select: "every-read-or-head", keys: runReferenceGroupOf(key) ?? [key] },
    encoding: { shape: "url-list" },
    keepGroupValueAt: key,
  };
}

/** 旧落点：首 / 尾帧放标准帧键（headless 再按 body 的帧位放），给了几张取最后一张。 */
function legacyFrameBinding(frame: ReferenceFrameKind): ReferenceBinding {
  const key = STANDARD_FRAME_KEY[frame];
  return { kind: frame, target: { select: "every-read-or-head", keys: [key] }, encoding: { shape: "url", pick: "last" }, keepGroupValueAt: key };
}

const LEGACY_APPROVED_BINDINGS: readonly ReferenceBinding[] = [
  legacyListBinding("image"),
  legacyListBinding("video"),
  legacyListBinding("audio"),
  legacyFrameBinding("first_frame"),
  legacyFrameBinding("last_frame"),
];
const LEGACY_IMAGE = 0;
const LEGACY_VIDEO = 1;
const LEGACY_AUDIO = 2;
const LEGACY_FRAME: Readonly<Record<ReferenceFrameKind, number>> = { first_frame: 3, last_frame: 4 };

/** 参考位分组 = 已有值与授权地址比对的单位。 */
function referencePositions(): readonly (readonly string[])[] {
  return runReferenceGroups().map(({ keys }) => keys);
}

/**
 * 授权时封存的参考 → 意图（每条指到一个绑定）→ 解析写入。数组形状和重复项保持原样。
 * 返回新参数与这一步写下的键（调用方报「参数不支持」时按参考位称呼它们）。
 */
export function placeApprovedRunReferences(
  parameters: Record<string, unknown>,
  references: readonly ApprovedRunReference[],
  createBody: unknown,
  mode: ArchetypeMode | null,
): { parameters: Record<string, unknown>; placedKeys: readonly string[] } {
  const bodyKeys = bodyReferencedParamKeys(createBody);
  const combine = mode ? combineForMode(mode, createBody) : null;
  // 张数仍由 Run 的 assertResolvedReferences 按族核；这里不增加单槽超量拒发或模式固定参数。
  const modeBindings = mode ? declarationForMode(mode, createBody).bindings : [];
  const bindings = [...modeBindings, ...LEGACY_APPROVED_BINDINGS];
  const legacy = (index: number): number => modeBindings.length + index;
  const bodyHasFrame = (frame: ReferenceFrameKind): boolean =>
    bodyKeys.some((key) => runReferenceGroupOf(key) === runReferenceGroupOf(STANDARD_FRAME_KEY[frame]));
  const intent: IntentReference[] = references.map((reference) => {
    const kind = slotKindForContractReference(reference);
    const combined = modeBindings.findIndex((binding) => binding.kind === kind && binding.target.select === "combined");
    if (combined >= 0) return { binding: combined, value: reference.url };
    if (reference.kind === "video") return { binding: legacy(LEGACY_VIDEO), value: reference.url };
    if (reference.kind === "audio") return { binding: legacy(LEGACY_AUDIO), value: reference.url };
    // 这一档合并里没有收这种参考的槽：明着拒，不带着合同角色词错发。
    if (combine) throw new RunReferenceError("not-in-use", "not-in-use", { role: reference.role ?? "reference", kind: reference.kind ?? "image" });
    if (reference.role === "first_frame" || reference.role === "last_frame") {
      if (bodyHasFrame(reference.role)) return { binding: legacy(LEGACY_FRAME[reference.role]), value: reference.url };
      throw new RunReferenceError(`catalog mapping has unsupported reference role: ${reference.role}`, "unsupported-role", { role: reference.role });
    }
    return { binding: legacy(LEGACY_IMAGE), value: reference.url };
  });
  const lowered = lowerGenerationIntent(
    { bindings, readKeys: bodyKeys, existingValues: { positions: referencePositions(), onConflict: "reject" } },
    { references: intent },
    parameters,
  );
  // 合同写死的 URL 与授权时封存的不一致 = 批准 A、要发 B。拒。
  if (lowered.problems.some(({ code }) => code === "reference_conflicts_existing")) {
    throw new RunReferenceError("catalog reference URL projection conflicts with canonical parameters", "conflict");
  }
  return { parameters: { ...structuredClone(parameters), ...lowered.bodyParams }, placedKeys: Object.keys(lowered.bodyParams) };
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
 * 显式参考参数的绑定：Run 路每个参考键一个（翻译键另有去处，不在这里）。首 / 尾帧 → 标准帧键（headless 按 body 的帧位放）；
 * 角色数组 → body 读的第一个同组写法（都不读 → 不写）；URL 数组 → 这一族标准列表组里 body 读的全部写法（都不读 → 组首）。
 */
const EXPLICIT_BINDING_KEYS: readonly string[] = [...RUN_PATH_REFERENCE_KEYS].filter((key) => runReferenceGroupOf(key) && !TRANSLATED.has(key));
const EXPLICIT_BINDINGS: readonly ReferenceBinding[] = EXPLICIT_BINDING_KEYS.map((key) => {
  const frame = referenceFrameKindFor(key);
  const declaration = referenceKeyDeclarationFor(key)!;
  const kind = slotKindForContractReference({ kind: declaration.family, role: frame ?? undefined });
  if (frame) return { kind, target: { select: "every-read-or-head", keys: [STANDARD_FRAME_KEY[frame]] }, encoding: { shape: "url", pick: "first" } };
  if (referenceKeyShapeFor(key, declaration.multiImage) === "role-objects") {
    return { kind, target: { select: "first-read", keys: runReferenceGroupOf(key)! }, encoding: { shape: "role-objects" } };
  }
  const standard = STANDARD_LIST_KEY[declaration.family];
  return { kind, target: { select: "every-read-or-head", keys: runReferenceGroupOf(standard) ?? [standard] }, encoding: { shape: "url-list" } };
});

/** 显式参考参数里 body 不直接读的那些 → 意图（数组拆成一条一项）→ 同一个解析写入过程；已有值优先，同一参考位先到先得。 */
export function standardizeExplicitRunReferences(parameters: Record<string, unknown>, bodyKeys: readonly string[]): Record<string, unknown> {
  const read = new Set(bodyKeys);
  const intent: IntentReference[] = Object.entries(parameters).flatMap(([key, value]) => {
    const binding = EXPLICIT_BINDING_KEYS.indexOf(key);
    if (binding < 0 || read.has(key) || !present(value)) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => ({ binding, value: item as IntentReference["value"] }));
  });
  const lowered = lowerGenerationIntent(
    { bindings: EXPLICIT_BINDINGS, readKeys: bodyKeys, existingValues: { positions: [], onConflict: "keep" } },
    { references: intent },
    parameters,
  );
  return { ...structuredClone(parameters), ...lowered.bodyParams };
}
