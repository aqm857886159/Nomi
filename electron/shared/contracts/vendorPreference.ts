import { builtinVendorKeyOfKey } from '../builtinVendorIdentity'
/** Cross-process contract for model picker provider ordering. */
const VENDOR_PREFERENCE_SCHEMA_VERSION = 1 as const
export const VENDOR_PREFERENCE_KEY_MAX_LENGTH = 200
export type VendorPreferenceSettings = { schemaVersion: 1; orderedVendorKeys: string[] }
export const DEFAULT_VENDOR_PREFERENCE_SETTINGS: VendorPreferenceSettings = { schemaVersion: 1, orderedVendorKeys: [] }

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }

export function normalizeVendorPreferenceSettings(value: unknown): VendorPreferenceSettings {
  const raw = record(value)
  const values = Array.isArray(raw.orderedVendorKeys) ? raw.orderedVendorKeys : []
  const seen = new Set<string>()
  const orderedVendorKeys: string[] = []
  for (const item of values) {
    if (typeof item !== 'string') continue
    const key = item.trim()
    if (!key || key.length > VENDOR_PREFERENCE_KEY_MAX_LENGTH || seen.has(key)) continue
    seen.add(key); orderedVendorKeys.push(key)
  }
  return { schemaVersion: VENDOR_PREFERENCE_SCHEMA_VERSION, orderedVendorKeys }
}

/**
 * 供应商分级（「用户没排过序时先走哪家」的默认）：**官方 > 内置中转 > 用户自接/未知**。
 *
 * 用户 2026-09-22 拍板「按照默认走」：没排过序、同名模型既有内置中转又有自接中转时，
 * 内置中转优先、自接靠后。它是默认挑选的稳定排序键，不是硬限制——用户可以在弹窗里锁定任意一家，
 * 也可以在设置里把顺序整个排一遍（那一级比分级强）。分级错了只影响默认项，零生成风险。
 *
 * **这份表住 `electron/shared` 是有原因的**：渲染层的模型选择器与主进程的执行侧
 * （`electron/catalog/executableModel.ts` 的 `findExecutableModelAnyVendor`）必须是逐字同一把尺。
 * 2026-09-22 总合并之前这里是两份：渲染层有分级（#832），执行侧的 `orderByVendorPreference`
 * 只有「用户排过的顺序」那一级——于是用户没排过序时，界面按分级显示 APIMart，
 * 执行侧按目录原序挑了用户刚自接的那家，**界面显示一家、钱花另一家**。
 */
const OFFICIAL_VENDOR_KEYS = new Set([
  'volcengine', 'modelscope', 'openai', 'anthropic', 'claude', 'gemini', 'google',
  'deepseek', 'dashscope', 'zhipu', 'moonshot', 'kimi', 'siliconflow', 'groq', 'openrouter',
])
const BUILTIN_RELAY_VENDOR_KEYS = new Set(['apimart', 'kie', 'newapi'])

export function vendorTier(vendorKey?: string | null): number {
  // #831：`apimart--mini` 这类**兄弟连接**必须和 `apimart` 同档。先把 key 解析回 root 再查表——
  // 不这么做，用户新建的特价组会被降进「用户自接」档，默认家在没人决定过的情况下悄悄换人。
  // （「主连接默认在前」由同档内的目录原序保证，不靠给兄弟连接降档这种副作用。）
  // 这里用的是只看 key 形状的那一档（`builtinVendorKeyOfKey`）：本函数是纯比较子，拿不到 vendors 列表；
  // 拿得到列表的调用点该问 `resolveBuiltinVendorKey`（它还认得出用户手工改过的血统）。
  const key = builtinVendorKeyOfKey(vendorKey).trim().toLowerCase()
  if (OFFICIAL_VENDOR_KEYS.has(key)) return 0
  if (BUILTIN_RELAY_VENDOR_KEYS.has(key)) return 1
  return 2
}

/**
 * 「同一个模型，先走哪家」的**唯一**比较子：用户排过的顺序 → 供应商分级 → 调用方给的稳定序。
 * 两侧（渲染层选择器 / 主进程执行侧）都用它，任何一侧自己再排一次都是第二份规则。
 */
export function compareVendorLanding(
  leftVendor: string | null | undefined,
  rightVendor: string | null | undefined,
  orderedVendorKeys: readonly string[],
): number {
  const rank = vendorPreferenceRank(orderedVendorKeys)
  const rankOf = (vendor: string | null | undefined) =>
    rank.get((vendor || '').trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER
  return (rankOf(leftVendor) - rankOf(rightVendor)) || (vendorTier(leftVendor) - vendorTier(rightVendor))
}

/** 用户排过的顺序 → 名次表（键一律小写比对：设置里存的和目录里的大小写不必一致）。 */
function vendorPreferenceRank(orderedVendorKeys: readonly string[]): Map<string, number> {
  return new Map(orderedVendorKeys.map((key, index) => [key.trim().toLowerCase(), index]))
}

/**
 * Stable provider order for both visible choices and bare model-key resolution.
 * `Array.prototype.sort` 在 V8 上稳定，所以同级的那几家保持调用方给的原序。
 */
export function orderByVendorPreference<T>(
  entries: readonly T[], orderedVendorKeys: readonly string[], vendorOf: (entry: T) => string | null | undefined,
): T[] {
  return [...entries].sort((left, right) => compareVendorLanding(vendorOf(left), vendorOf(right), orderedVendorKeys))
}
