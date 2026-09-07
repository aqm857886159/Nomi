// 收起角标那一格的**判据**：未读 + 待决 → 长什么样。
//
// 和长相（`AgentTopbarChip.tsx`）分开，是因为这是一个**判断**、不是一段样式：
// 「一格 8px 分不出五档」这条只能靠一份纯函数 + 单测守住，留在组件里就只能靠截图证明。

/**
 * 角标上那一格。定稿只给了**两种**长相，不是五种：
 *
 * - `dot` **蓝点 8px** = 有新动静（收起期间来了一条新回复 / 一个工具跑完）；
 * - `count` **数字徽标** = 未读条数（语法复刻 `TaskCenterButton` 的 `min-w-4 rounded-pill` 数字粒）。
 *
 * 为什么不给「运行中 / 失败 / 刚完成」各画一种图形：一格 8px 见方的角标分不出五种意思，
 * 用户只会学会「它变了」然后点进去看。真正需要被区分的那件事——**要不要现在管它**——
 * 由「有没有数字」承担；具体是哪一档由 tooltip 用人话说（词表在 `agentPanelV4DockStatus.ts`）。
 *
 * 一条新动静用一颗点就够；**有待你确认的**、或者攒了不止一条，才值得写出数字来。
 */
export type AgentTopbarChipBadge =
  | { kind: 'none' }
  | { kind: 'dot' }
  | { kind: 'count'; count: number }

/**
 * 未读 + 待决 + 有没有出事 → 那一格长什么样。纯函数，单测钉着（「一格分不出五档」这条只能靠它守）。
 *
 * 待决**计入未读**：一条等着人点的介入槽本来就是「你还没看的东西」里最该被看见的那种。
 *
 * `failed` 单独一个入参而不是折进未读数：最后一件事坏了这件事**不是一条新消息**，
 * 它没有条数可言，把它算成 +1 就会在数字上撒谎（「2 条未读」里有一条其实是一个状态）。
 * 但它也不能什么都不显示——收起把面板藏起来的同时把那条错误带也藏起来了，
 * 角标不接住它，「收起」就成了一个悄悄吞掉坏消息的动作。所以它保底冒一颗点，
 * 具体坏在哪由 tooltip 说（定稿 §11.2：不为失败另画第五种图形）。
 */
export function agentTopbarChipBadge(unreadCount: number, pendingCount: number, failed = false): AgentTopbarChipBadge {
  if (unreadCount <= 0) return failed ? { kind: 'dot' } : { kind: 'none' }
  if (pendingCount > 0 || unreadCount > 1) return { kind: 'count', count: unreadCount }
  return { kind: 'dot' }
}

/** settle 脉冲活多久。定稿 §11.2：**单次** 420ms，不常闪——常闪的点等于没有状态。 */
export const AGENT_TOPBAR_CHIP_SETTLE_MS = 420

