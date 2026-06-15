// 「新会话」分隔线(harness S1b):气泡有历史而 LLM 记忆为空时,在历史末尾画一条
// 诚实声明——防"假透明"(用户以为 AI 记得,基于此下指令,产出错钱白花)。
// 不变量(总方案 §5):UI 呈现的"AI 记得的范围"⊆ LLM 实际范围,宁少不多。
import * as React from 'react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { workbenchSessionKey, type WorkbenchAgentArea } from './workbenchAgentRunner'

/**
 * 探测一次"LLM 还记得这段对话吗";不记得且面板里有历史气泡 → 返回分界消息 id
 * (分隔线画在该消息之后:它和它之上的内容 AI 已不再记得)。
 * 探测时机:面板挂载 / 项目(sessionKey)变化。用户继续输入后边界保持不动。
 */
export function useStaleConversationBoundary(messageIds: readonly string[], area: WorkbenchAgentArea): string | null {
  const [boundary, setBoundary] = React.useState<string | null>(null)
  const sessionKey = workbenchSessionKey(area)
  const lastIdAtMount = messageIds.length > 0 ? messageIds[messageIds.length - 1] : null
  React.useEffect(() => {
    let cancelled = false
    setBoundary(null)
    if (!lastIdAtMount) return undefined
    const probe = getDesktopBridge()?.agents?.chatV2SessionAlive
    if (!probe) return undefined
    void probe(sessionKey)
      .then(({ alive }) => {
        if (!cancelled && !alive) setBoundary(lastIdAtMount)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // 只在会话切换时重测;气泡增长不重测(边界一旦定下保持不动)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])
  return boundary
}

export function StaleConversationDivider() {
  return (
    <div className={cn('flex w-full items-center gap-2 py-1')} role="separator">
      <span className={cn('h-px flex-1 bg-nomi-ink-10')} />
      <span className={cn('shrink-0 text-micro text-nomi-ink-40')}>以上对话 AI 已不再记得</span>
      <span className={cn('h-px flex-1 bg-nomi-ink-10')} />
    </div>
  )
}
