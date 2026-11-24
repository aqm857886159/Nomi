// 模型的**完整名字**：Agent 点名模型只用这一串（设计卡 docs/plan/2026-11-15-agent-intent-landing.md「第 1 刀」）。
//
// ── 为什么要它 ──
//
// 以前模型面有三个家点名模型（每镜 `modelId`、`candidate{providerId,modelId}`、分镜子对象的 `modelKey/modelVendor`），
// 而系统提示词索引只印模型 id、不印哪一家。真模型评测 11-15 那轮 24 次拒收有 13 次是同一种：id 抄对了、家配错了。
// 现在宿主从 `(vendor, modelId)` 生成一串名字给模型看，模型原样抄回，宿主按**整串**在同一份清单里查表。
//
// ── 两条纪律 ──
//
// 1. **一处生成、一处查**：列表行、索引、默认段、`draft_shots` 准入、拒收里「最像的几个」全走这里。
//    别处自己拼 `${modelId}@${vendor}` 由结构测试拦（modelHandle.structure.test.ts）。
// 2. **不解析这串字**：模型 id 里本来就有 `/`、`.`、`_`；自定义中转的 id 什么字符都可能有。查表是整串比较，
//    万一两行生成了同一串（自定义 id 里真带 `@`），查到两行 → 当歧义拒，不靠字符集保证正确。
//
// 写法 `模型id@供应商` 的数据依据（内置目录 211 行、17 家）：供应商 id 只有小写字母、数字、`-`；
// 模型 id 有 36 个含 `/`，`@` 和 `:` 两边都没出现过。`供应商/模型` 会写出 `kie/bytedance/seedance-2`。
//
// 名字只是模型面的东西：落盘的候选 `{providerId, modelId}`、节点的 `modelKey/modelVendor` 一个字段都不变。
import {
  archetypeBaseModelKey,
  archetypeFamilyIdsFor,
  archetypeIdForModel,
  resolveModelArchetype,
} from "../modelArchetypes";
import { closestKey, foldKey } from "../agentLane/toolInputIssues";

/** 查表需要的最少事实。`AgentModelEntry` 天然满足。 */
export type ModelHandleRow = Readonly<{
  vendor: string | null;
  modelId: string;
  modelAlias?: string | null;
  archetypeId?: string;
}>;

const SEPARATOR = "@";
/** 拒收时「最像的几个」最多列几个。 */
const NEAREST_MODEL_HANDLE_LIMIT = 3;

/** 这一行的完整名字。没有供应商的行（目录里 0 行，防御）就是模型 id 本身。 */
export function modelHandleOf(row: Pick<ModelHandleRow, "vendor" | "modelId">): string {
  return row.vendor ? `${row.modelId}${SEPARATOR}${row.vendor}` : row.modelId;
}

type ModelWireSelection = Readonly<{ modeId?: string; variantId?: string }>;

type ModelHandleLookup<T extends ModelHandleRow> =
  /**
   * `via`：`handle` = 写的就是完整名字；`model_id` = 只写了模型 id（或别名、近似写法），目录里只有一家——回执要告诉 Agent 落成了谁；
   * `user_default` = 写的对得上好几家，其中恰好一家是用户给「这一种任务」设的默认，落到了它（`among` 是同名的全部几家）——
   * 回执必须写明「同名有 N 家，按你的默认用了哪家」（`userDefaultNote`），助手和后面的花钱确认都要看得到落在哪家。
   */
  | Readonly<ModelWireSelection & { ok: true; row: T; handle: string; via: "handle" | "model_id" | "user_default"; among?: readonly string[] }>
  /** 写的东西对得上好几行（只写了 id 而多家都有，或近似写法认出了同一族的好几个）。`handles` 就是那几个完整名字，`rows` 是那几行。 */
  | Readonly<{ ok: false; reason: "ambiguous"; handles: readonly string[]; rows: readonly T[] }>
  /** 一行都对不上。`nearest` ≤3 个最像的完整名字；空 = 没有够得上「像」的。 */
  | Readonly<{ ok: false; reason: "unknown"; nearest: readonly string[] }>;

/** 目录里一个模型的两段身份（落盘候选的 `{providerId, modelId}`、设置里默认的 `(vendorKey, modelKey)` 都是它）。 */
export type ModelIdentity = Readonly<{ vendor: string; modelId: string }>;

type ModelHandleOptions = Readonly<{
  /**
   * U1（2026-11-17 协调拍 A）：写的名字对得上好几家时，**只多看这一个事实**——用户给「这一种任务」设的默认
   * （只能来自 `createGenerationDefaultModelResolver` 的答案，调用方不许自己编）。它只在已匹配的那几行里挑：
   * 匹配里恰好一行就是它 → 落它；匹配里没有它、或有两行都等于它 → 照旧当歧义拒。默认是别的模型时不影响结果。
   */
  preferred?: ModelIdentity;
}>;

const uniqueHandles = (rows: readonly ModelHandleRow[]): string[] => [...new Set(rows.map(modelHandleOf))];
const lastSegment = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

function onlyMatchOf<T extends ModelHandleRow>(rows: readonly T[], via: "handle" | "model_id", options: ModelHandleOptions): ModelHandleLookup<T> | undefined {
  if (rows.length === 0) return undefined;
  const handles = uniqueHandles(rows);
  if (rows.length === 1) return { ok: true, row: rows[0]!, handle: handles[0]!, via };
  const preferred = options.preferred;
  const defaults = preferred ? rows.filter((row) => row.vendor === preferred.vendor && row.modelId === preferred.modelId) : [];
  if (defaults.length === 1) return { ok: true, row: defaults[0]!, handle: modelHandleOf(defaults[0]!), via: "user_default", among: handles };
  return { ok: false, reason: "ambiguous", handles, rows };
}

function wireSelectionFor(row: ModelHandleRow, wanted: string): ModelWireSelection | undefined {
  const profile = resolveModelArchetype({
    modelKey: row.modelId,
    modelAlias: row.modelAlias,
    vendorKey: row.vendor,
    meta: { archetypeId: row.archetypeId },
  }, { variant: (every) => ({ variantId: every.defaultVariantId, modelId: undefined }) });
  if (!profile) return undefined;
  const lower = wanted.toLowerCase();
  const suffix = row.vendor ? SEPARATOR + row.vendor.toLowerCase() : "";
  const written = suffix && lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : lower;
  const folded = foldKey(written);
  const matches = (key?: string) => key !== undefined && foldKey(key) === folded;

  // Two catalog rows may share a profile while representing different paid tiers.
  // Only the profile's base row can resolve a sibling's dedicated variant key.
  const baseKey = archetypeBaseModelKey(profile);
  const variants = baseKey && foldKey(baseKey) === foldKey(row.modelId)
    ? profile.variants?.filter(variant => matches(variant.modelKey) || variant.identifierPatterns?.some(matches)) ?? []
    : [];
  const modes = profile.modes.filter(mode => matches(mode.modelEnum));
  if (variants.length === 1 && modes.length === 0) return { variantId: variants[0]!.id };
  if (modes.length === 1 && variants.length === 0) return { modeId: modes[0]!.id };
  return undefined;
}

/** 落到默认那家时回执里的那句话（lane 回执与宿主回执同一句，不各写一份）。 */
function userDefaultNote(lookup: Readonly<{ handle: string; among?: readonly string[] }>): string {
  return `${lookup.among?.length ?? 0} providers carry this model (${(lookup.among ?? []).join(", ")}); used ${lookup.handle} because it is the user's default for this kind of task.`;
}

/**
 * 模型写的名字 → 目录里那一行。**按这个顺序认，每一档要么定下来、要么往下走**：
 *
 *  ① 完整名字整串相等（再试一次大小写不敏感）；
 *  ② 只写了模型 id / 别名（大小写不敏感）：一家 → 放行（`via:"model_id"`）；多家 → 歧义；
 *  ③ 近似写法：模型 id 按全仓唯一的近似键折法（`foldKey`：大小写、`-` `_` `.` 空白）相等；
 *     光秃秃没带前缀时也认末段（`seedance-2` ↔ `bytedance/seedance-2`）：一行 → 放行；多行 → 歧义；
 *  ④ 唯一目录行拥有的变体或模式线上名：带回明确的选择。
 *  ⑤ 都不是：给最像的 ≤3 个。档案身份识别（`archetypeIdForModel`，背后是 `catalogFacts.identityPatternsOf`）
 *     认出同一个档案的排前面——`seedance-2-turbo` 认得出是 Seedance 2 一族，但那是另一个价钱，只进「最像的」不放行。
 */
export function resolveModelHandle<T extends ModelHandleRow>(rows: readonly T[], written: string, options: ModelHandleOptions = {}): ModelHandleLookup<T> {
  const wanted = written.trim();
  if (!wanted) return { ok: false, reason: "unknown", nearest: [] };
  const exact = onlyMatchOf(rows.filter((row) => modelHandleOf(row) === wanted), "handle", options)
    ?? onlyMatchOf(rows.filter((row) => modelHandleOf(row).toLowerCase() === wanted.toLowerCase()), "handle", options);
  if (exact) return exact;
  const lower = wanted.toLowerCase();
  const byId = onlyMatchOf(rows.filter((row) => row.modelId.toLowerCase() === lower || (row.modelAlias ?? "").toLowerCase() === lower), "model_id", options);
  if (byId) return byId;
  // 写的东西里带了别的前缀（`apimart/…`、`…@kie`）就只比整串：那是 Agent 点了「哪一家」，
  // 近似层不许把它悄悄落到另一家（11-15 那 13 次拒收正是「id 对、家错」）。只有光秃秃的末段才按末段比。
  const bare = !wanted.includes("/") && !wanted.includes(SEPARATOR);
  const near = onlyMatchOf(rows.filter((row) => foldKey(row.modelId) === foldKey(wanted)
    || (bare && foldKey(lastSegment(row.modelId)) === foldKey(wanted))), "model_id", options);
  if (near) return near;
  const wireMatches = rows.flatMap(row => {
    const selection = wireSelectionFor(row, wanted);
    return selection ? [{ row, selection }] : [];
  });
  const wire = onlyMatchOf(wireMatches.map(match => match.row), "model_id", {});
  if (wire) return wire.ok ? { ...wire, ...wireMatches[0]!.selection } : wire;
  return unknownHandle(rows, wanted);
}

function unknownHandle<T extends ModelHandleRow>(rows: readonly T[], wanted: string): ModelHandleLookup<T> {
  const family = archetypeFamilyIdsFor(wanted, foldKey);
  const sameFamily = rows.filter(row => family.has(row.archetypeId ?? archetypeIdForModel(row.modelId, row.modelAlias) ?? ""));
  return { ok: false, reason: "unknown", nearest: nearestModelHandles(rows, wanted, sameFamily) };
}

/**
 * 结构化的两段写法（外部助手 / 宿主短创建 / 改计划：`providerId` + `modelId`）→ 目录里那一行。**同一个阶梯**，不另判：
 * 说了供应商就先只在那一家里认（供应商 id 按原样比——目录里全是小写）；那一家里认不出，最像的从全部行里给
 * （多半是「id 对、家错」，对的那个排第一）。没说供应商就是 `resolveModelHandle` 本身。
 */
export function resolveModelIdentity<T extends ModelHandleRow>(
  rows: readonly T[],
  written: Readonly<{ modelId: string; vendor?: string | null }>,
  options: ModelHandleOptions = {},
): ModelHandleLookup<T> {
  const vendor = written.vendor?.trim() ?? "";
  if (!vendor) return resolveModelHandle(rows, written.modelId, options);
  const scoped = rows.filter((row) => row.vendor === vendor);
  const hit = scoped.length > 0 ? resolveModelHandle(scoped, written.modelId, options) : undefined;
  if (hit && (hit.ok || hit.reason === "ambiguous")) return hit;
  return unknownHandle(rows, `${written.modelId.trim()}${SEPARATOR}${vendor}`);
}

/**
 * 认名字时要看「这一种任务」的默认（U1）——但任务种类本身要先认出那几行才定得下来（点名的模型声明了什么）。
 * 所以按这个次序：先不带默认认一遍；对得上好几家时，用那几家定出这一种任务（`taskKindOf`，调用方按它手上的事实答，
 * 定不下来答 undefined），再问默认解析器这一种任务的默认（`defaultFor`），带着它在**同一个阶梯**上再认一遍。
 * 内外助手、单镜、多镜、拟镜、改计划都走这一个函数，各入口只递自己的行和事实，不各写一份平局规则。
 */
export function resolveModelForTask<T extends ModelHandleRow, K extends string>(
  rows: readonly T[],
  written: string | Readonly<{ modelId: string; vendor?: string | null }>,
  task: Readonly<{ taskKindOf: (matches: readonly T[]) => K | undefined; defaultFor?: (taskKind: K) => ModelIdentity | undefined }>,
): ModelHandleLookup<T> {
  const lookup = (options: ModelHandleOptions) => typeof written === "string"
    ? resolveModelHandle(rows, written, options)
    : resolveModelIdentity(rows, written, options);
  const first = lookup({});
  if (first.ok || first.reason !== "ambiguous" || !task.defaultFor) return first;
  const taskKind = task.taskKindOf(first.rows);
  const preferred = taskKind === undefined ? undefined : task.defaultFor(taskKind);
  return preferred ? lookup({ preferred }) : first;
}

/** 写的不是一字不差的完整名字、宿主替它认出来了：回执里告诉它落成了谁（按默认平局落的还带 `note`）。 */
export type ResolvedModelName = Readonly<ModelWireSelection & { written: string; model: string; note?: string }>;

/**
 * 这次认名字要不要写进回执（lane 的 `draft_shots` 与宿主的 create 同一个判据）。一字不差的不写；
 * 结构化写法（说了供应商）一字不差地落在那一行也不写。
 */
export function resolvedModelNameOf<T extends ModelHandleRow>(
  written: string | Readonly<{ modelId: string; vendor?: string | null }>,
  hit: Extract<ModelHandleLookup<T>, { ok: true }>,
): ResolvedModelName | undefined {
  const exact = typeof written === "string"
    ? hit.via === "handle" && hit.handle === written
    : hit.via !== "user_default" && hit.row.modelId === written.modelId && Boolean(written.vendor) && hit.row.vendor === written.vendor;
  if (exact) return undefined;
  const shown = typeof written === "string" ? written : written.vendor ? `${written.vendor}/${written.modelId}` : written.modelId;
  return {
    written: shown, model: hit.handle,
    ...(hit.modeId ? { modeId: hit.modeId } : {}),
    ...(hit.variantId ? { variantId: hit.variantId } : {}),
    ...(hit.via === "user_default" ? { note: userDefaultNote(hit) } : {}),
  };
}

/**
 * 最像的 ≤3 个完整名字。排序：
 *  ① 模型 id 一字不差、只是家写错了的（`id@别家`、`别家/id`）——轨迹里最常见的错就是这一种，对的那个必须排第一；
 *  ①b 家写对了、只是 id 少了日期尾巴的；② 同档案的；③ 再按全仓唯一的近似键判据（`closestKey`）逐个取。够不上「像」就不凑。
 * ① 只做「整串以 `id@` 开头 / 以 `/id` 结尾」的比较，不切这串字（见文件头纪律 2）。
 */
export function nearestModelHandles(rows: readonly ModelHandleRow[], written: string, sameFamily: readonly ModelHandleRow[] = []): string[] {
  const lower = written.trim().toLowerCase();
  const sameId = rows.filter((row) => {
    const id = row.modelId.toLowerCase();
    return lower.startsWith(id + SEPARATOR) || lower.endsWith("/" + id);
  });
  // ①b 家写对了、id 少了日期尾巴（`doubao-seedream-4-5@volcengine` ↔ `doubao-seedream-4-5-251128@volcengine`）。
  const datedSibling = rows.filter((row) => {
    const suffix = row.vendor ? (SEPARATOR + row.vendor).toLowerCase() : "";
    if (!suffix || !lower.endsWith(suffix)) return false;
    const stem = lower.slice(0, -suffix.length);
    return stem.length > 0 && row.modelId.toLowerCase().startsWith(stem + "-");
  });
  const picked = uniqueHandles([...sameId, ...datedSibling, ...sameFamily]).slice(0, NEAREST_MODEL_HANDLE_LIMIT);
  // 每行两个可比的串：完整名字和模型 id（模型多半只写了 id，或照旧格式写了 `供应商/模型`）。
  const pool = rows.flatMap((row) => {
    const handle = modelHandleOf(row);
    return [{ key: handle, handle }, { key: row.modelId, handle }, ...(row.vendor ? [{ key: `${row.vendor}/${row.modelId}`, handle }] : [])];
  });
  let remaining = pool.filter((item) => !picked.includes(item.handle));
  while (picked.length < NEAREST_MODEL_HANDLE_LIMIT && remaining.length > 0) {
    const hit = closestKey(written, remaining.map((item) => item.key));
    const handle = hit === undefined ? undefined : remaining.find((item) => item.key === hit)?.handle;
    if (!handle) break;
    picked.push(handle);
    remaining = remaining.filter((item) => item.handle !== handle);
  }
  return picked;
}
