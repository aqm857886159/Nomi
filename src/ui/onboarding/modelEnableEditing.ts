/**
 * 中转站模型「勾选启用/停用」编辑的纯逻辑（从 ModelEnableEditor.tsx 抽出以便 node 单测）。
 * 见 docs/plan/2026-07-04-relay-model-enable-editing.md。
 */
import type { ChipModel } from './ModelChipGroups'

/** 大小写无关的子串匹配 labelZh + modelKey（空串 = 全部）。 */
export function filterModelsByQuery(models: ChipModel[], query: string): ChipModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter(
    (m) => m.labelZh.toLowerCase().includes(q) || m.modelKey.toLowerCase().includes(q),
  )
}

/** 已启用计数。 */
export function enabledCount(models: ChipModel[]): number {
  return models.reduce((n, m) => (m.enabled ? n + 1 : n), 0)
}

/** 批量操作实际会翻转的行：全选 → 当前可见里未启用的；全不选 → 当前可见里已启用的（已是目标态的不重复写库）。 */
export function bulkToggleTargets(visible: ChipModel[], enable: boolean): ChipModel[] {
  return visible.filter((m) => m.enabled !== enable)
}
