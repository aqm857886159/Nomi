import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'

/**
 * 系统出处边（评审 B2，2026-10-09）：全景 / 白板截图、导演台产物、剪辑导出、事实表这几类**派生节点**，
 * 在产出方建它的那一刻把「我是谁派生的」记在节点自己的数据上（`meta.derivedFrom`），
 * store 的 `connectDerivedOutput` 只在 target **确实是** source 派生出来的、种类也对得上时才连这条边——
 * 校验靠数据，不靠调用方自报一个布尔值；普通卡拿不到这条路（没有 derivedFrom / 指向别的节点 / 种类对不上，一律拒）。
 *
 * 为什么派生节点不能走 `connectNodes` 的 connects.input 总闸：全景截图是 asset 卡、事实表是 shot_table，
 * 它们的种类本身「不收用户的输入」（input:false）——出处边不是用户加的输入，是产出方写下的「谁生出了我」。
 * 老项目里已有的出处边是快照里的普通边，照常加载 / 显示 / 断开；这条规则只管新建（老节点没有 derivedFrom，不影响它们已有的边）。
 */
export type DerivedFromKind = 'panorama-screenshot' | 'director-output' | 'whiteboard-snapshot' | 'clip-export' | 'shot-table'

export type DerivedFrom = { nodeId: string; kind: DerivedFromKind }

type DerivedRule = { sources: readonly GenerationNodeKind[] | 'any'; targets: readonly GenerationNodeKind[] }

/** 每一类派生的合法「源种类 → 目标种类」。表外的组合一律不是出处边。 */
export const DERIVED_OUTPUT_RULES: Readonly<Record<DerivedFromKind, DerivedRule>> = {
  'panorama-screenshot': { sources: ['panorama'], targets: ['asset'] },
  'director-output': { sources: ['director'], targets: ['image', 'video'] },
  'whiteboard-snapshot': { sources: ['whiteboard', 'image'], targets: ['image'] },
  'clip-export': { sources: ['clip'], targets: ['video'] },
  'shot-table': { sources: 'any', targets: ['shot_table'] },
}

/** 产出方建派生节点时写进它 meta 的那一块。 */
export function derivedFromMeta(kind: DerivedFromKind, sourceNodeId: string): { derivedFrom: DerivedFrom } {
  return { derivedFrom: { nodeId: sourceNodeId, kind } }
}

export function readDerivedFrom(meta: unknown): DerivedFrom | null {
  const raw = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).derivedFrom : null
  if (!raw || typeof raw !== 'object') return null
  const { nodeId, kind } = raw as Record<string, unknown>
  if (typeof nodeId !== 'string' || typeof kind !== 'string' || !(kind in DERIVED_OUTPUT_RULES)) return null
  return { nodeId, kind: kind as DerivedFromKind }
}

/** target 是不是 source 派生出来的（数据说了算：derivedFrom 指向 source、源 / 目标种类都在表里）。 */
export function isDerivedOutputOf(source: GenerationCanvasNode, target: GenerationCanvasNode): boolean {
  const derived = readDerivedFrom(target.meta)
  if (!derived || derived.nodeId !== source.id || source.id === target.id) return false
  const rule = DERIVED_OUTPUT_RULES[derived.kind]
  return rule.targets.includes(target.kind) && (rule.sources === 'any' ? source.kind !== target.kind : rule.sources.includes(source.kind))
}
