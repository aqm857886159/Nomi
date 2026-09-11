/**
 * 「模型框里显示哪些、排在哪、默认走哪家」的跨进程合同（2026-09-11 用户拍板）。
 *
 * 为什么是**一张表**而不是三个小文件（方案 §4）：这三件事在**同一次读取**里被同时用到——
 * `useDedupedModelSelect` 渲染一次下拉就要同时知道「排第几」「藏不藏」「上次我点的是哪家」。
 * 拆成三份就有三次读、三种失败态，用户会看到「排序存住了、隐藏没存住」这种半成品状态。
 *
 * 与 `vendorPreference.ts` 的分界（不是所有偏好都该合并）：那份是**供应商级**的全局顺序
 * （「同一个模型多家都有，默认走哪家」），消费时机与这份不同，且它已经被 2026-09-06 拍板验证过；
 * 这份是**模型级**的（显示/顺序/逐模型记住的家）。两份各自单一职责，只共用持久化与 IPC 的骨架。
 */
export const MODEL_BOX_PREFERENCE_SCHEMA_VERSION = 1 as const
/** 单个 id（canonicalId / vendorKey）的长度上限——超长的一律丢，不截断（截断会造出一个假 id）。 */
export const MODEL_BOX_PREFERENCE_ID_MAX_LENGTH = 200
/** 每个列表/映射的条目上限：目录再大也到不了这个量级，够不上的输入只可能是坏数据或攻击。 */
export const MODEL_BOX_PREFERENCE_MAX_ENTRIES = 1000

export type ModelBoxPreferenceSettings = {
  schemaVersion: 1
  /**
   * 模型级手动顺序：canonicalId 数组。
   * 不在这份顺序里的模型排在它**之后**，按原有 catalogLifecycle 规则回退——
   * 这一级是「插在原排序前面」，不是「取代原排序」（新接进来的模型不会因为没排过就掉队到看不见）。
   */
  modelOrder: string[]
  /**
   * 隐藏名单（黑名单式）：canonicalId 集合。
   * 黑名单而非白名单：新增模型默认**可见**，用户主动藏起来的才消失。白名单会让每个新模型
   * 都要用户先去设置里勾一下才看得见——那是负体验。
   *
   * 与 catalog 的 `Model.enabled` 是**两层**，不是重复：`enabled` 是「这个模型能不能用」
   * （写进目录、所有生成路径都认），这份是「我自己想不想在模型框里看见它」（纯展示层，
   * 不回溯影响已经用它生成过的旧节点）。
   */
  hiddenModelIds: string[]
  /**
   * 逐模型记住的供应商：canonicalId → vendorKey。
   * 只在用户**显式**点过供应商 chip / 供应商下拉时写入；自动选家（pickHealthiestProvider）不写——
   * 否则「自动选的那家」会伪装成「我选的那家」，用户再也回不到自动。
   */
  preferredVendorByModel: Record<string, string>
}

export const DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS: ModelBoxPreferenceSettings = {
  schemaVersion: MODEL_BOX_PREFERENCE_SCHEMA_VERSION,
  modelOrder: [],
  hiddenModelIds: [],
  preferredVendorByModel: {},
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed && trimmed.length <= MODEL_BOX_PREFERENCE_ID_MAX_LENGTH ? trimmed : ''
}

function normalizeIdList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (out.length >= MODEL_BOX_PREFERENCE_MAX_ENTRIES) break
    const id = normalizeId(item)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * 任何坏输入都降级成默认值，**绝不抛**：这份偏好是「怎么显示」，不是「能不能跑」。
 * 一个写坏的 JSON 让模型框整个打不开，代价远大于回到默认顺序。
 */
export function normalizeModelBoxPreferenceSettings(value: unknown): ModelBoxPreferenceSettings {
  const raw = record(value)
  const preferredVendorByModel: Record<string, string> = {}
  const rawPreferred = record(raw.preferredVendorByModel)
  for (const [key, vendor] of Object.entries(rawPreferred)) {
    if (Object.keys(preferredVendorByModel).length >= MODEL_BOX_PREFERENCE_MAX_ENTRIES) break
    const modelId = normalizeId(key)
    const vendorKey = normalizeId(vendor)
    if (!modelId || !vendorKey) continue
    preferredVendorByModel[modelId] = vendorKey
  }
  return {
    schemaVersion: MODEL_BOX_PREFERENCE_SCHEMA_VERSION,
    modelOrder: normalizeIdList(raw.modelOrder),
    hiddenModelIds: normalizeIdList(raw.hiddenModelIds),
    preferredVendorByModel,
  }
}
