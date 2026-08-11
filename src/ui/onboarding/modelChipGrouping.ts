/**
 * 模型 chip 的 kind 分桶 + 排序（纯函数，从 ModelChipGroups.tsx 抽出以便 node 单测）。
 *
 * 关键不变量（Issue #23 根因）：kind 的真相源是后端 `BillingModelKind`
 * （text | image | video | audio | model3d，且将来可能再扩展）。本函数对**任何**不在已知
 * 顺序表里的 kind 也必须安全分桶——绝不能因为出现一个没预料到的 kind（如 model3d、或某天新增的
 * 第六类、或脏数据里缺失/空的 kind）让 `byKind[kind]` 变 undefined、`.push` 崩掉整个模型设置面板。
 *
 * 旧实现把桶硬编码成固定 4 类 Record 后直接 `byKind[m.kind].push(m)`，runninghub 种子里的 model3d
 * 模型（混元3D/HiTem3D/Meshy）一进来就白屏。这里改成动态 Map + 未知 kind 兜底，单一真相源收口在此。
 *
 * 本模块只管「kind 有哪些、按什么序」，**不产出展示文案**：分组标题一律由渲染侧
 * `t('onboardingProviders.modelControls.kind.*')` 出（R15 可见文字走 i18n）。此前这里挂着一份中文
 * `MODEL_CHIP_KIND_LABEL` 并往每个分组塞 `label`，但三个消费方都各自 `t()`、没一个读它——死数据，
 * 已连同 `label` 字段一并删除（P1 加新必删旧）。「未知 kind 用原始字符串兜底」的判据收口成
 * `isKnownModelChipKind`，渲染侧统一调它，不再各写一份已知 kind 清单。
 */

export type ModelChipKind = 'text' | 'image' | 'video' | 'audio' | 'model3d'

/**
 * 已知 kind 的唯一清单，三个用途同源：① 分组展示顺序；② 「这个 kind 有没有 i18n 标题」的判据
 * （见 isKnownModelChipKind）；③ 类型选择器的选项（ModelEnableEditor / ModelPickerScreen）。
 * 不在表内的 kind 一律追加在分组队尾（不丢、不崩）。加第六类只改这一行。
 */
export const MODEL_CHIP_KINDS: ModelChipKind[] = ['text', 'image', 'video', 'audio', 'model3d']

/** 该 kind 是否已登记（= 有 i18n 标题可用）。false 时渲染侧原样显示后端给的字符串，宁可丑也不崩。 */
export function isKnownModelChipKind(kind: string): kind is ModelChipKind {
  return MODEL_CHIP_KINDS.some((known) => known === kind)
}

export type ChipKindGroup<T> = { kind: string; models: T[] }

/** 按 kind 分桶并排序。缺失/空 kind 兜底为 text；未知 kind 保留原值、追加在队尾。 */
export function groupModelsByKind<T extends { kind: string }>(models: T[]): ChipKindGroup<T>[] {
  const byKind = new Map<string, T[]>()
  for (const m of models) {
    const k = m.kind || 'text' // 兜底：绝不把模型丢进 undefined 桶（崩溃根因）
    const list = byKind.get(k)
    if (list) list.push(m)
    else byKind.set(k, [m])
  }
  const knownFirst: string[] = MODEL_CHIP_KINDS.filter((k) => byKind.has(k))
  const unknownTail = [...byKind.keys()].filter((k) => !isKnownModelChipKind(k))
  return [...knownFirst, ...unknownTail].map((kind) => ({ kind, models: byKind.get(kind)! }))
}

/** 组内「已启用排前」的稳定排序（2026-07-17 用户要求：选中的模型自动往前排列）。
 *  稳定：两段各自保持原有（catalog seed）相对顺序，不打乱同段内熟悉的位置。 */
export function sortEnabledFirst<T extends { enabled: boolean }>(models: T[]): T[] {
  return [...models].sort((a, b) => Number(b.enabled) - Number(a.enabled))
}
