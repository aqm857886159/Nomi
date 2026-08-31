// 模型健康记忆 —— 「默认模型自动选择」的避让层（2026-07-29 批量体检根治，docs/plan/2026-07-29-batch-generation-fixes.md）。
// 问题：默认选择取目录第一个带档案的文生模型，无健康信号；上游挂掉的模型（如 apimart Imagen 4
// 上游 Google 404）会永远霸占默认位 → 新节点不手动换模型就 100% 失败，批量全红。
// 机制：唯一提交咽喉 runGenerationNode 失败记账 / 成功清零（可找回超时不算失败——上游可能仍出片）；
// chooseDefaultModelOption 自动选默认时跳过「近 24h 连败 ≥ 2」的模型。只影响自动默认——
// 用户手动选择永不拦、不弹警告；全部候选都在避让期 → 回退原序（绝不空选）。24h 过期自动回流。
const STORAGE_KEY = "nomi:model-health:v1";
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

function normalizeKey(modelKey: unknown): string {
  return typeof modelKey === "string" ? modelKey.trim() : "";
}

/** Provider-qualified health identity. A failure at one relay must not poison the same model at another relay. */
export function modelHealthKey(modelKey: unknown, vendor?: unknown): string {
  const model = normalizeKey(modelKey)
  if (!model) return ''
  const provider = normalizeKey(vendor)
  return provider ? `${provider}\u0000${model}` : model
}

/** 生成失败记一笔（连败计数 +1）。无 modelKey（未选模型的异常路径）静默跳过。 */
export function recordModelFailure(modelKey: unknown, now: number = Date.now()): void {
  const key = normalizeKey(modelKey);
  if (!key) return;
  const map = readMap();
  const prev = map[key];
  map[key] = { fails: (prev?.fails ?? 0) + 1, lastFailAt: now };
  writeMap(map);
}

/** 生成成功即清零——该模型完全恢复默认资格。 */
export function recordModelSuccess(modelKey: unknown): void {
  const key = normalizeKey(modelKey);
  if (!key) return;
  const map = readMap();
  if (!(key in map)) return;
  delete map[key];
  writeMap(map);
}

/** 是否处于避让期：近 24h 内连败 ≥ 2。过期记录视为健康（上游修好自然回流）。 */
export function isModelRecentlyAiling(modelKey: unknown, now: number = Date.now()): boolean {
  const key = normalizeKey(modelKey);
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
