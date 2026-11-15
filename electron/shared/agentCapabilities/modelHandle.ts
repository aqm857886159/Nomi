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
import { archetypeIdForModel } from "../modelArchetypes";
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
export const NEAREST_MODEL_HANDLE_LIMIT = 3;

/** 这一行的完整名字。没有供应商的行（目录里 0 行，防御）就是模型 id 本身。 */
export function modelHandleOf(row: Pick<ModelHandleRow, "vendor" | "modelId">): string {
  return row.vendor ? `${row.modelId}${SEPARATOR}${row.vendor}` : row.modelId;
}

export type ModelHandleLookup<T extends ModelHandleRow> =
  /** `via`：`handle` = 写的就是完整名字；`model_id` = 只写了模型 id（或别名、近似写法），目录里只有一家——回执要告诉 Agent 落成了谁。 */
  | Readonly<{ ok: true; row: T; handle: string; via: "handle" | "model_id" }>
  /** 写的东西对得上好几行（只写了 id 而多家都有，或近似写法认出了同一族的好几个）。`handles` 就是那几个完整名字。 */
  | Readonly<{ ok: false; reason: "ambiguous"; handles: readonly string[] }>
  /** 一行都对不上。`nearest` ≤3 个最像的完整名字；空 = 没有够得上「像」的。 */
  | Readonly<{ ok: false; reason: "unknown"; nearest: readonly string[] }>;

const uniqueHandles = (rows: readonly ModelHandleRow[]): string[] => [...new Set(rows.map(modelHandleOf))];
const lastSegment = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

function decide<T extends ModelHandleRow>(rows: readonly T[], via: "handle" | "model_id"): ModelHandleLookup<T> | undefined {
  if (rows.length === 0) return undefined;
  const handles = uniqueHandles(rows);
  if (rows.length === 1) return { ok: true, row: rows[0]!, handle: handles[0]!, via };
  return { ok: false, reason: "ambiguous", handles };
}

/**
 * 模型写的名字 → 目录里那一行。**按这个顺序认，每一档要么定下来、要么往下走**：
 *
 *  ① 完整名字整串相等（再试一次大小写不敏感）；
 *  ② 只写了模型 id / 别名（大小写不敏感）：一家 → 放行（`via:"model_id"`）；多家 → 歧义；
 *  ③ 近似写法：模型 id 按全仓唯一的近似键折法（`foldKey`：大小写、`-` `_` `.` 空白）相等；
 *     光秃秃没带前缀时也认末段（`seedance-2` ↔ `bytedance/seedance-2`）：一行 → 放行；多行 → 歧义；
 *  ④ 都不是：给最像的 ≤3 个。档案身份识别（`archetypeIdForModel`，背后是 `catalogFacts.identityPatternsOf`）
 *     认出同一个档案的排前面——`seedance-2-turbo` 认得出是 Seedance 2 一族，但那是另一个价钱，只进「最像的」不放行。
 */
export function resolveModelHandle<T extends ModelHandleRow>(rows: readonly T[], written: string): ModelHandleLookup<T> {
  const wanted = written.trim();
  if (!wanted) return { ok: false, reason: "unknown", nearest: [] };
  const exact = decide(rows.filter((row) => modelHandleOf(row) === wanted), "handle")
    ?? decide(rows.filter((row) => modelHandleOf(row).toLowerCase() === wanted.toLowerCase()), "handle");
  if (exact) return exact;
  const lower = wanted.toLowerCase();
  const byId = decide(rows.filter((row) => row.modelId.toLowerCase() === lower || (row.modelAlias ?? "").toLowerCase() === lower), "model_id");
  if (byId) return byId;
  // 写的东西里带了别的前缀（`apimart/…`、`…@kie`）就只比整串：那是 Agent 点了「哪一家」，
  // 近似层不许把它悄悄落到另一家（11-15 那 13 次拒收正是「id 对、家错」）。只有光秃秃的末段才按末段比。
  const bare = !wanted.includes("/") && !wanted.includes(SEPARATOR);
  const near = decide(rows.filter((row) => foldKey(row.modelId) === foldKey(wanted)
    || (bare && foldKey(lastSegment(row.modelId)) === foldKey(wanted))), "model_id");
  if (near) return near;
  const family = archetypeIdForModel(wanted);
  const sameFamily = family ? rows.filter((row) => (row.archetypeId ?? archetypeIdForModel(row.modelId, row.modelAlias)) === family) : [];
  return { ok: false, reason: "unknown", nearest: nearestModelHandles(rows, wanted, sameFamily) };
}

/** 最像的 ≤3 个完整名字：同档案的优先，再按全仓唯一的近似键判据（`closestKey`）逐个取。够不上「像」就不凑。 */
export function nearestModelHandles(rows: readonly ModelHandleRow[], written: string, sameFamily: readonly ModelHandleRow[] = []): string[] {
  const picked = uniqueHandles(sameFamily).slice(0, NEAREST_MODEL_HANDLE_LIMIT);
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
