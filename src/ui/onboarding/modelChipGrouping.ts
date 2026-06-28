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
 */

export type ModelChipKind = 'text' | 'image' | 'video' | 'audio' | 'model3d'

export const MODEL_CHIP_KIND_LABEL: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  model3d: '3D',
}

// 已知 kind 的展示顺序；不在表内的 kind 一律追加在后（不丢、不崩）。
const KIND_ORDER: string[] = ['text', 'image', 'video', 'audio', 'model3d']

export type ChipKindGroup<T> = { kind: string; label: string; models: T[] }

/** 按 kind 分桶并排序。缺失/空 kind 兜底为 text；未知 kind 保留原值、用原始字符串当标签。 */
export function groupModelsByKind<T extends { kind: string }>(models: T[]): ChipKindGroup<T>[] {
  const byKind = new Map<string, T[]>()
  for (const m of models) {
    const k = m.kind || 'text' // 兜底：绝不把模型丢进 undefined 桶（崩溃根因）
    const list = byKind.get(k)
    if (list) list.push(m)
    else byKind.set(k, [m])
  }
  const knownFirst = KIND_ORDER.filter((k) => byKind.has(k))
  const unknownTail = [...byKind.keys()].filter((k) => !KIND_ORDER.includes(k))
  return [...knownFirst, ...unknownTail].map((kind) => ({
    kind,
    label: MODEL_CHIP_KIND_LABEL[kind] ?? kind, // 未知 kind：原始字符串当标签，宁可丑也不崩
    models: byKind.get(kind)!,
  }))
}
