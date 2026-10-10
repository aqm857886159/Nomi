// 空节点排版的纯函数（2026-10-10 用户拍板 B「视觉中心」）。不碰 DOM、不测量：档位只由节点已知的卡高算。
//
// 规则：内容块中心放在卡高 45% 处，离顶至少 44px（给左上角状态小标让位），水平居中。
// 矮卡分三档：完整 / 紧凑（图标 + 「类型 · 状态」一行，下接动作行）/ 只留第一行。
// 阈值 = 44（让位）+ 块高 + 8（底留白）；块高是实测值（完整 114、紧凑 56、只第一行 24）。
// 实验室样张（docs/evidence/2026-10-10-empty-node-ratios/）按这组数字出图。

/** 离顶至少这么多，左上角状态小标永远碰不到图标。 */
export const EMPTY_STATE_TOP_CLEARANCE = 44
/** 块的中心在卡高的这个比例处。 */
export const EMPTY_STATE_CENTER_RATIO = 0.45
/** 实测块高（CSS 像素）。 */
export const EMPTY_STATE_BLOCK_HEIGHT = { full: 114, compact: 56, icon: 24 } as const
const BOTTOM_GAP = 8

export const EMPTY_STATE_FULL_MIN_HEIGHT = EMPTY_STATE_TOP_CLEARANCE + EMPTY_STATE_BLOCK_HEIGHT.full + BOTTOM_GAP
export const EMPTY_STATE_COMPACT_MIN_HEIGHT = EMPTY_STATE_TOP_CLEARANCE + EMPTY_STATE_BLOCK_HEIGHT.compact + BOTTOM_GAP

export type EmptyStateTier = 'full' | 'compact' | 'icon'

/** 卡高未知（undefined / 非法值）按完整档算，并由调用方走 CSS 兜底定位。 */
export function emptyStateTier(height: number | undefined): EmptyStateTier {
  if (height === undefined || !Number.isFinite(height)) return 'full'
  if (height >= EMPTY_STATE_FULL_MIN_HEIGHT) return 'full'
  if (height >= EMPTY_STATE_COMPACT_MIN_HEIGHT) return 'compact'
  return 'icon'
}

/** 块顶到卡顶的距离（卡高已知时）。 */
export function emptyStateBlockTop(tier: EmptyStateTier, height: number): number {
  const blockH = EMPTY_STATE_BLOCK_HEIGHT[tier]
  return Math.max(EMPTY_STATE_TOP_CLEARANCE, Math.round(height * EMPTY_STATE_CENTER_RATIO - blockH / 2))
}
