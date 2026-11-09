/**
 * 参考放置的**唯一解析写入过程**：一份绑定声明 + 一份意图（每个值落进第几个绑定）→ 请求参数。
 *
 * ── 为什么只有这一个 ────────────────────────────────────────────────────────────────
 * S3（2026-11-08）把三个入口的三份拼法收进了这个函数，但函数里还留着两套表示：档案槽按槽种和 inputKey 选键、定形状；
 * Run 的旧值却在意图里自带候选键、读键和选法，原值形状照搬。改槽的键或形状，旧值那条路纹丝不动——
 * 同一个参考位两个主人（方向检查 `docs/engineering/direction-checks/2026-11-09-reference-placement-owner.md`）。
 * 现在只有一种表示：**绑定**。档案槽、按 body 推出来的位、Run 的旧落点规则都事先编译成绑定（`declarationForMode.ts`、
 * `headlessReferences.ts`、`runReferences.ts`），意图只说「这个值属于第几个绑定」；落哪个键、什么形状、已有值怎么办，
 * 只在这里按绑定回答。
 *
 * ── 一个绑定 = 目标 + 编码 ─────────────────────────────────────────────────────────────
 *  目标：`declared` 这份声明自己的键（档案槽 / 推出来的位，后写的同键盖先写的）；
 *        `combined` 并进合并键（同一个键上的绑定按声明序拼成一个数组，自己的键不再出现）；
 *        `every-read-or-head` 同组写法里 body 读到的全部写，一个都不读 → 组首键；
 *        `first-read` 同组写法里 body 读到的第一个，一个都不读 → 不写。后两种只补空着的键。
 *  编码：URL 数组（保序、保重复）、取第一张 / 最后一张的字符串、只装第一张的数组、角色对象、火山方舟 content 项。
 *  写入顺序：声明键（按声明序）→ 合并键 → 兼容目标（按意图里第一次出现的顺序）→ 模式固定参数。
 *
 * ── 已有参数 ──────────────────────────────────────────────────────────────────────
 * 声明了 `existingValues` 时，第三个参数是调用方手上已有的参数：要写的键上已有值 → 不写（已有值优先）；
 * 同一参考位（`positions` 的一组）上已有值、与要写的不同 → problem（授权地址冲突，调用方在发之前拒）。
 * 绑定的 `keepGroupValueAt`：同一参考位已有值、唯一落点就是这个键 → 沿用既有值，不补第二份。
 *
 * 张数超过绑定的 `max`、指向不存在的绑定，也是 problem：不静默截断、不另找一个键。
 * 纯函数、同步：不读盘、不读目录、不认供应商名。
 */
import type { ArchetypeReferenceSlotKind } from "../videoCapabilities/types";

export { DEFAULT_LOWERING_INPUT_KEY, loweringAsArray, loweringInputKey } from "./slotInputKeys";

export type BindingTarget =
  | Readonly<{ select: "declared"; key: string }>
  | Readonly<{ select: "combined"; key: string; role: string }>
  | Readonly<{ select: "every-read-or-head"; keys: readonly string[] }>
  | Readonly<{ select: "first-read"; keys: readonly string[] }>;

export type BindingEncoding =
  | Readonly<{ shape: "url-list" }>
  | Readonly<{ shape: "url"; pick: "first" | "last" }>
  | Readonly<{ shape: "url-in-list" }>
  | Readonly<{ shape: "role-objects" }>
  | Readonly<{ shape: "content-items"; media: "image" | "video" | "audio"; role: string }>
  | Readonly<{ shape: "content-item"; role: string }>;

export type ReferenceBinding = Readonly<{
  /** 这个参考位收的是哪种参考（张数问题按它报；Run 按它认合同参考的去处）。 */
  kind: ArchetypeReferenceSlotKind;
  target: BindingTarget;
  encoding: BindingEncoding;
  max?: number;
  keepGroupValueAt?: string;
}>;

export type GenerationDeclaration = Readonly<{
  bindings: readonly ReferenceBinding[];
  /** 这条 body 读的参数键（兼容目标按它选）；拿不到 body 的入口给空。 */
  readKeys: readonly string[];
  existingValues?: Readonly<{
    /** 同一参考位的几种写法（不在任何一组里的键自成一组）。 */
    positions: readonly (readonly string[])[];
    onConflict: "reject" | "keep";
  }>;
  fixedParams?: Readonly<Record<string, string>>;
}>;

/** 一个参考值：地址；或调用方给的角色对象（原样发，键序和 role 都不改）。 */
export type ReferenceValue = string | Readonly<Record<string, unknown>>;

/** 一条意图：值 + 它属于声明里的第几个绑定。 */
export type IntentReference = Readonly<{ binding: number; value: ReferenceValue }>;

export type GenerationIntent = Readonly<{ references: readonly IntentReference[] }>;

export type LoweringProblem =
  | Readonly<{ code: "reference_over_capacity"; binding: number; kind: ArchetypeReferenceSlotKind; max: number; count: number }>
  | Readonly<{ code: "reference_binding_unknown"; binding: number }>
  | Readonly<{ code: "reference_conflicts_existing"; key: string }>;

export type LoweredGeneration = Readonly<{ bodyParams: Record<string, unknown>; problems: readonly LoweringProblem[] }>;

type Entry = Readonly<{ value: ReferenceValue; role?: string }>;

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
}

/** 地址去空白、空的不算；角色对象原样；别的不是参考值。 */
function referenceValue(value: unknown): ReferenceValue | null {
  if (typeof value === "string") return value.trim() || null;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null;
}

// 火山方舟 content[] 的三种媒体项（键名就是声明里的 inputKey，见 declarationForMode）。
function contentItem(media: "image" | "video" | "audio", url: string, role: string): Record<string, unknown> {
  if (media === "video") return { type: "video_url", video_url: { url }, role };
  if (media === "audio") return { type: "audio_url", audio_url: { url }, role };
  return { type: "image_url", image_url: { url }, role };
}

/** 编码：同一个绑定（或同一个合并键）收到的全部值 → 发出去的形状。没有可发的 → undefined。 */
function encode(encoding: BindingEncoding, entries: readonly Entry[]): unknown {
  const urls = entries.flatMap(({ value }) => typeof value === "string" ? [value] : []);
  switch (encoding.shape) {
    case "url-list":
      return urls.length ? [...urls] : undefined;
    case "url":
      return encoding.pick === "last" ? urls[urls.length - 1] : urls[0];
    case "url-in-list":
      return urls.length ? [urls[0]] : undefined;
    case "role-objects":
      return entries.length
        ? entries.map(({ value, role }) => typeof value === "string" ? { url: value, role } : structuredClone(value))
        : undefined;
    case "content-items":
      return urls.length ? urls.map((url) => contentItem(encoding.media, url, encoding.role)) : undefined;
    case "content-item":
      return urls.length ? contentItem("image", urls[0]!, encoding.role) : undefined;
  }
}

/** 兼容目标落哪几个键。 */
function targetKeys(target: BindingTarget, readKeys: readonly string[]): readonly string[] {
  if (target.select === "declared" || target.select === "combined") return [target.key];
  const read = target.keys.filter((key) => readKeys.includes(key));
  if (target.select === "first-read") return read.slice(0, 1);
  return read.length ? read : target.keys.slice(0, 1);
}

/**
 * 意图 → 请求参数。有 problem 时 `bodyParams` 仍按规则给出（方便调用方说清楚是哪一格），
 * 但调用方**不许**拿它去发：problem 非空就在花钱之前拒（Run 的张数另由它自己按族核）。
 */
export function lowerGenerationIntent(
  declaration: GenerationDeclaration,
  intent: GenerationIntent,
  existing: Readonly<Record<string, unknown>> = {},
): LoweredGeneration {
  const problems: LoweringProblem[] = [];
  // 每个绑定收到的值；Map 的插入序 = 绑定在意图里第一次出现的顺序。
  const received = new Map<number, ReferenceValue[]>();
  for (const reference of intent.references) {
    const value = referenceValue(reference.value);
    if (value === null) continue;
    if (!declaration.bindings[reference.binding]) {
      problems.push({ code: "reference_binding_unknown", binding: reference.binding });
      continue;
    }
    received.set(reference.binding, [...(received.get(reference.binding) ?? []), value]);
  }
  for (const [index, binding] of declaration.bindings.entries()) {
    const count = received.get(index)?.length ?? 0;
    if (binding.max !== undefined && count > binding.max) {
      problems.push({ code: "reference_over_capacity", binding: index, kind: binding.kind, max: binding.max, count });
    }
  }

  const policy = declaration.existingValues;
  const positionOf = (key: string): readonly string[] => policy?.positions.find((keys) => keys.includes(key)) ?? [key];
  const existingAt = (key: string): unknown => positionOf(key).map((candidate) => existing[candidate]).find(present);
  const conflicts = (key: string, value: unknown): void => {
    const current = existingAt(key);
    if (policy?.onConflict === "reject" && present(current) && JSON.stringify(current) !== JSON.stringify(value)) {
      problems.push({ code: "reference_conflicts_existing", key });
    }
  };
  const out: Record<string, unknown> = {};
  // 唯一的写入点。先核授权冲突（这一格不写也要核），再看：兼容目标（`fill`）只补这次还没写过的键；已有值优先。
  const write = (key: string, value: unknown, fill: boolean): void => {
    if (value === undefined) return;
    conflicts(key, value);
    if (fill && Object.prototype.hasOwnProperty.call(out, key)) return;
    if (policy && present(existing[key])) return;
    out[key] = value;
  };
  const entriesOf = (index: number, role?: string): Entry[] =>
    (received.get(index) ?? []).map((value) => (role === undefined ? { value } : { value, role }));

  for (const [index, binding] of declaration.bindings.entries()) {
    if (binding.target.select === "declared" && received.has(index)) write(binding.target.key, encode(binding.encoding, entriesOf(index)), false);
  }
  // 合并键：同一个键上的绑定按声明序拼成一个数组（单值槽超量照样全部并进去，拒不拒由调用方定）。
  const combinedKeys = [...new Set(declaration.bindings.flatMap(({ target }) => target.select === "combined" ? [target.key] : []))];
  for (const key of combinedKeys) {
    const members = [...declaration.bindings.entries()].filter(([, { target }]) => target.select === "combined" && target.key === key);
    const entries = members.flatMap(([index, { target }]) => entriesOf(index, target.select === "combined" ? target.role : undefined));
    if (entries.length) write(key, encode(members[0]![1].encoding, entries), false);
  }
  for (const index of received.keys()) {
    const binding = declaration.bindings[index]!;
    if (binding.target.select === "declared" || binding.target.select === "combined") continue;
    const keys = targetKeys(binding.target, declaration.readKeys);
    if (keys.length === 1 && keys[0] === binding.keepGroupValueAt && present(existingAt(keys[0]!))) {
      conflicts(keys[0]!, encode(binding.encoding, entriesOf(index)));
      continue;
    }
    // 每个键各编一份（不让两个键共用同一个数组对象）。
    for (const key of keys) write(key, encode(binding.encoding, entriesOf(index)), true);
  }
  for (const [key, value] of Object.entries(declaration.fixedParams ?? {})) out[key] = value;
  return { bodyParams: out, problems };
}
