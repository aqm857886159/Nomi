/**
 * [INPUT]: 依赖 ./poseSnapshot 的 baseBoneName（Mixamo / UAL / 带前缀骨名都归到同一规范基名）
 * [OUTPUT]: 对外提供 isVisualBone、boneChainOf
 * [POS]: director/scene/character 的骨骼可视化规则（零 React，SkeletonVisual 用）：画哪些骨、按哪条链上色。
 *        按规范基名判断，Mixamo 的 LeftHandIndex1 与 UAL 的 DEF-f_index01L 同一条规则；UAL 的 root 骨在脚底原点，不画（否则地面到骨盆多一根骨）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { baseBoneName } from './poseSnapshot'

/** 不画的骨：手指、脚趾末端、头顶 End 骨、骨架根 */
const SKIP_BASE = /thumb|index|middle|ring|pinky|_end$|^root$/

export function isVisualBone(name: string): boolean {
  return !SKIP_BASE.test(baseBoneName(name))
}

/** 骨段配色链：脊柱 / 手臂 / 腿 */
export function boneChainOf(name: string): 'spine' | 'arm' | 'leg' {
  const base = baseBoneName(name)
  if (/arm|shoulder|hand/.test(base)) return 'arm'
  if (/leg|foot|toe/.test(base)) return 'leg'
  return 'spine'
}
