// 列表行那一组露几行（纯函数，可裸测；组件文件只导出组件，热更新不整页刷新）。
import { nodePointerGroupVisible } from './nodePointerFace'

/** 列表行超过这个数就折起：露前这么多行，下面一行文字按钮「还有 N 个镜头」（板 2026-11-15 chat.rows.more）。 */
export const NODE_POINTER_ROW_FOLD = 4

/** 超过 NODE_POINTER_ROW_FOLD 个：露前 NODE_POINTER_ROW_FOLD 行，其余折进下面那一行按钮；展开了就全露（不再收回）。 */
export function nodePointerRowsVisible(total: number, expanded: boolean): Readonly<{ shown: number; hidden: number }> {
  return nodePointerGroupVisible(total, NODE_POINTER_ROW_FOLD, expanded)
}
