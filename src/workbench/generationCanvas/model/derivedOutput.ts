import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'

/**
 * 派生输出的规则表（评审 B2 第 3 轮，2026-10-09）。
 *
 * 全景 / 白板截图、导演台产物、剪辑导出、事实表这几类**派生节点**，它们和产出方之间的出处边**不是用户加的输入**
 * （全景截图是 asset 卡、事实表是 shot_table，种类本身 input:false，过不了 connects.input 总闸）。
 *
 * 旧写法（已删）：先建节点，再凭节点 meta 里一个可写的身份字段去连边——那个字段任何写路径（Agent 建节点、复制粘贴、导入、外部合并）都造得出来。
 * 现在的写法：**建节点 + 连出处边是一个原子 store 动作 `addDerivedOutput`**：动作里按本表核源种类、新节点种类，建节点，连边；
 * 目标一定是刚建出来的新节点（天然没有别的来源），不持久化任何身份字段，也没有公开的「给已有节点补出处边」的动作。
 * 老项目里已有的出处边是快照里的普通边，照常加载 / 显示 / 断开；这条规则只管新建。
 */
export type DerivedOutputKind = 'panorama-screenshot' | 'director-output' | 'whiteboard-snapshot' | 'clip-export' | 'shot-table' | 'video-frame'

type DerivedRule = {
  sources: readonly GenerationNodeKind[]
  targets: readonly GenerationNodeKind[]
  /** 源节点的结果必须是这种媒体（事实表拆解的入口是一段视频）。 */
  sourceResultType?: 'video'
}

/** 每一类派生的合法「源种类 → 新节点种类」。表外的组合一律不是出处边。 */
export const DERIVED_OUTPUT_RULES: Readonly<Record<DerivedOutputKind, DerivedRule>> = {
  'panorama-screenshot': { sources: ['panorama'], targets: ['asset'] },
  'director-output': { sources: ['director'], targets: ['image', 'video'] },
  'whiteboard-snapshot': { sources: ['whiteboard'], targets: ['image'] },
  'clip-export': { sources: ['clip'], targets: ['video'] },
  'shot-table': { sources: ['video', 'asset'], targets: ['shot_table'], sourceResultType: 'video' },
  // 视频节点「截帧」（当前帧 / 首帧 / 尾帧）：旁边一张图片卡 + 出处边。
  'video-frame': { sources: ['video', 'asset'], targets: ['image'], sourceResultType: 'video' },
}

export function canDeriveOutput(kind: DerivedOutputKind, source: GenerationCanvasNode, targetKind: GenerationNodeKind): boolean {
  const rule = DERIVED_OUTPUT_RULES[kind]
  if (!rule) return false
  if (!rule.sources.includes(source.kind) || !rule.targets.includes(targetKind)) return false
  return !rule.sourceResultType || source.result?.type === rule.sourceResultType
}
