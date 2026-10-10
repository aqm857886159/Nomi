// 空节点排版的纯函数（2026-10-10 用户拍板 B「视觉中心」）。不碰 DOM、不测量。
//
// 输入必须是**渲染用的有效卡高**：调用方传 `resolveNodeVisualSize(node).height`（nodeSizing.ts，卡片真实渲染尺寸的唯一真相源），
// 不能传存的 node.size.height——渲染时会被 resolvePreviewHeight 钳到 bounds.minHeight（默认 MIN_NODE_HEIGHT=120，文本 200），
// 两者对不上就会判错档（2026-10-10 独立验收 V-ratio：240×103 的卡实际 120 高，被按 103 判成「只留第一行」）。
//
// 规则：内容块中心放在卡高 45% 处，离顶至少 44px（给左上角状态小标让位），水平居中。
// 矮卡收成紧凑（图标 + 「类型 · 状态」一行，下接动作行）。
// 阈值 = 44（让位）+ 块高 + 8（底留白）；块高是实测值（完整 114、紧凑 56）。
//
// 「只留第一行」档已删：用到 NodeEmptyState 的每种节点，渲染高度下限都是 120（见 nodeEmptyStateLayout.test.ts 的结构测试），
// 高于紧凑阈值 108，这一档对现有节点永远进不去（P1：没人用的分支不留）。
// 函数对 < 108 的输入仍返回 compact，只为函数全定义；渲染下限 120 保证生产里走不到这里。

/** 离顶至少这么多，左上角状态小标永远碰不到图标。 */
export const EMPTY_STATE_TOP_CLEARANCE = 44
/** 块的中心在卡高的这个比例处。 */
export const EMPTY_STATE_CENTER_RATIO = 0.45
/** 实测块高（CSS 像素）。 */
export const EMPTY_STATE_BLOCK_HEIGHT = { full: 114, compact: 56 } as const
const BOTTOM_GAP = 8

export const EMPTY_STATE_FULL_MIN_HEIGHT = EMPTY_STATE_TOP_CLEARANCE + EMPTY_STATE_BLOCK_HEIGHT.full + BOTTOM_GAP
export const EMPTY_STATE_COMPACT_MIN_HEIGHT = EMPTY_STATE_TOP_CLEARANCE + EMPTY_STATE_BLOCK_HEIGHT.compact + BOTTOM_GAP

export type EmptyStateTier = 'full' | 'compact'

/** 卡高未知（undefined / 非法值）按完整档算，并由调用方走 CSS 兜底定位。 */
export function emptyStateTier(height: number | undefined): EmptyStateTier {
  if (height === undefined || !Number.isFinite(height)) return 'full'
  return height >= EMPTY_STATE_FULL_MIN_HEIGHT ? 'full' : 'compact'
}

/** 块顶到卡顶的距离（卡高已知时）。 */
export function emptyStateBlockTop(tier: EmptyStateTier, height: number): number {
  const blockH = EMPTY_STATE_BLOCK_HEIGHT[tier]
  return Math.max(EMPTY_STATE_TOP_CLEARANCE, Math.round(height * EMPTY_STATE_CENTER_RATIO - blockH / 2))
}
