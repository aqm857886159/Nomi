// 模型健康记忆 —— 「默认模型自动选择」的避让层（2026-07-29 批量体检根治，docs/plan/2026-07-29-batch-generation-fixes.md）。
// 问题：默认选择取目录第一个带档案的文生模型，无健康信号；上游挂掉的模型（如 apimart Imagen 4
// 上游 Google 404）会永远霸占默认位 → 新节点不手动换模型就 100% 失败，批量全红。
// 机制：唯一提交咽喉 runGenerationNode 失败记账 / 成功清零（可找回超时不算失败——上游可能仍出片）；
// chooseDefaultModelOption 自动选默认时跳过「近 24h 连败 ≥ 2」的模型。只影响自动默认——
// 用户手动选择永不拦、不弹警告；全部候选都在避让期 → 回退原序（绝不空选）。24h 过期自动回流。
//
// **健康的身份键是 (vendor, modelKey)，不是 modelKey**（2026-09-03 真实付费复验暴露）。
// 同一个模型名可以来自多家供应商，各家死活互不相干：Kie 的 gpt-image-2 余额为负连连失败，
// APIMart 的同名模型好好的。按裸 modelKey 记账时两家共享一个判定，于是
// pickHealthiestProvider 的 healthyVendors 只能是「全好」或「全病」——
// **「换家优先于换模型」这个机制对它本来要解决的多供应商场景完全失效**，永远绕不开坏的那家
// （走查实测：点 Gpt Image 2 反复落到 Kie，要手动切回 APIMart）。
// 与 buildAgentModelEntries 的去重键、PlanShot.modelVendor 是同一条身份规则。
//
// v1 → v2：旧记录按裸 key 存，无法追认属于哪一家，直接弃用（记忆本就 24h 过期，重学一天就回来），
// 不做双读兼容——那会让「这条记录算哪家的」长期有两个答案（P1 无并行版）。
const STORAGE_KEY = "nomi:model-health:v2";
const AILING_FAILS = 2;
const STALE_MS = 24 * 60 * 60 * 1000;

type ModelHealthRecord = { fails: number; lastFailAt: number };
type ModelHealthMap = Record<string, ModelHealthRecord>;

// localStorage 不可用（单测 node 环境）→ 进程内 Map 兜底，逻辑仍可测。
const memoryFallback = new Map<string, string>();

function readRaw(): string | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(STORAGE_KEY);
  } catch {
    /* 隐私模式等取不到 → 兜底 */
  }
  return memoryFallback.get(STORAGE_KEY) ?? null;
}

function writeRaw(value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, value);
      return;
    }
  } catch {
    /* 写失败 → 兜底，避让退化为进程内记忆，不致命 */
  }
  memoryFallback.set(STORAGE_KEY, value);
}

function readMap(): ModelHealthMap {
  const raw = readRaw();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: ModelHealthMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = value as Partial<ModelHealthRecord> | null;
      if (record && typeof record.fails === "number" && typeof record.lastFailAt === "number") {
        map[key] = { fails: record.fails, lastFailAt: record.lastFailAt };
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writeMap(map: ModelHealthMap): void {
  writeRaw(JSON.stringify(map));
}

/**
 * 模型身份：健康记账的主体。**必须成对传**，不接受裸 modelKey——
 * 用对象而不是 `(modelKey, vendor?, now?)` 三个位置参数，是因为旧签名是 `(modelKey, now?)`，
 * 加一个可选 vendor 会让旧调用把 `now`（number）静默当成 vendor 记进另一个桶，
 * 类型上还完全合法。对象形状让旧写法在编译期就过不去（fail-closed）。
 */
export type ModelHealthIdentity = { modelKey: unknown; vendor: unknown };

/** 身份键：`vendor::modelKey`。vendor 缺省（未接供应商的异常路径）用空串占位，仍与有 vendor 的分开记。 */
function normalizeKey(identity: ModelHealthIdentity | null | undefined): string {
  // 身份本身可能整个缺失（未选模型的异常路径）——那也是「记空=跳过」，不是崩溃。
  const key = typeof identity?.modelKey === "string" ? identity.modelKey.trim() : "";
  if (!key) return "";
  const vendorKey = typeof identity?.vendor === "string" ? identity.vendor.trim() : "";
  return `${vendorKey}::${key}`;
}

/** 生成失败记一笔（连败计数 +1）。无 modelKey（未选模型的异常路径）静默跳过。 */
export function recordModelFailure(identity: ModelHealthIdentity | null | undefined, now: number = Date.now()): void {
  const key = normalizeKey(identity);
  if (!key) return;
  const map = readMap();
  const prev = map[key];
  map[key] = { fails: (prev?.fails ?? 0) + 1, lastFailAt: now };
  writeMap(map);
}

/** 生成成功即清零——该模型完全恢复默认资格。 */
export function recordModelSuccess(identity: ModelHealthIdentity | null | undefined): void {
  const key = normalizeKey(identity);
  if (!key) return;
  const map = readMap();
  if (!(key in map)) return;
  delete map[key];
  writeMap(map);
}

/** 是否处于避让期：近 24h 内连败 ≥ 2。过期记录视为健康（上游修好自然回流）。 */
export function isModelRecentlyAiling(identity: ModelHealthIdentity | null | undefined, now: number = Date.now()): boolean {
  const key = normalizeKey(identity);
  if (!key) return false;
  const record = readMap()[key];
  if (!record) return false;
  if (now - record.lastFailAt > STALE_MS) return false;
  return record.fails >= AILING_FAILS;
}

/** 清空记忆（测试/设置重置用）。 */
export function resetModelHealthMemory(): void {
  writeMap({});
}
