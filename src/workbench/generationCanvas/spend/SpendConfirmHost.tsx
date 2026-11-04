import type { JSX } from 'react'
import { useSpendConfirmStore } from './spendConfirm'
import { SpendConfirmDialog } from './SpendConfirmDialog'

/**
 * 付费确认卡在整个 app 里唯一的挂载点：画布、列表、分镜、Agent、试用与取回等所有确认请求都汇到这里。
 *
 * 卡的代码随工作台一起静态加载，不能「用到才加载」。按需加载时，每次打开 Nomi 后第一张卡要先挂起等代码，
 * React 19 揭开挂起内容又固定节流 300ms：用户点了生成，屏幕上 0.3 秒什么都没有，像没点上。
 * 渲染仍然按需：没有待确认时不挂这张卡。
 */
export function SpendConfirmHost(): JSX.Element | null {
  const pending = useSpendConfirmStore((state) => Boolean(state.pending))
  return pending ? <SpendConfirmDialog /> : null
}
