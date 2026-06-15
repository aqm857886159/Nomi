// 会话历史弹层内容(2026-06-14,plan docs/plan/2026-06-14-conversation-history.md)。
// 外壳复用 AssetPickerPopover(BodyPortal+fixed+翻转+clamp,守 R13 弹层铁律);本组件只画卡片内容:
// 顶部「+新对话(当前会存入历史)」+ 列表(一句话摘要 + 时间,当前态高亮无 pill,hover 删)。
import React from 'react'
import { IconPlus, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import {
  deleteConversation,
  getActiveConversationId,
  getConversationsRevision,
  listConversations,
  subscribeConversations,
  switchConversation,
} from './conversationPersistence'
import { type ConvArea, threadDisplayTitle } from './conversationThreads'

/** 相对时间:刚刚 / N 分钟前 / N 小时前 / 昨天 / M/D。 */
function relativeTime(ts: number, now: number): string {
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 172_800_000) return '昨天'
  const date = new Date(ts)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function ConversationHistoryList({
  area,
  onNewConversation,
  onClose,
}: {
  area: ConvArea
  onNewConversation: () => void
  onClose: () => void
}): JSX.Element {
  const revision = React.useSyncExternalStore(subscribeConversations, getConversationsRevision)
  // revision=外部 store 版本号:listConversations 读可变线程模型,靠它强制重算(lint 看不出外部依赖)。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const threads = React.useMemo(() => listConversations(area), [area, revision])
  const activeId = getActiveConversationId(area)
  const now = Date.now()

  return (
    <div className={cn('w-64 rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md p-1')}>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 h-8 px-2 rounded-nomi-sm border-0 bg-transparent cursor-pointer text-left',
          'hover:bg-nomi-ink-05',
        )}
        onClick={() => {
          onNewConversation()
          onClose()
        }}
      >
        <IconPlus size={15} className={cn('shrink-0 text-nomi-ink-60')} />
        <span className={cn('text-body-sm text-nomi-ink')}>新对话</span>
        <span className={cn('ml-auto text-micro text-nomi-ink-40')}>当前会存入历史</span>
      </button>

      <div className={cn('h-px bg-nomi-line-soft mx-1.5 my-1')} />

      <ul className={cn('list-none p-0 m-0 max-h-[280px] overflow-auto')}>
        {threads.map((thread) => {
          const isActive = thread.id === activeId
          return (
            <li
              key={thread.id}
              className={cn(
                'group flex items-center gap-2 h-8 px-2 rounded-nomi-sm cursor-pointer',
                'border-l-2',
                isActive ? 'bg-nomi-accent-soft border-nomi-accent' : 'border-transparent hover:bg-nomi-ink-05',
              )}
              onClick={() => {
                if (!isActive) switchConversation(area, thread.id)
                onClose()
              }}
            >
              <span
                className={cn(
                  'flex-1 min-w-0 truncate text-body-sm',
                  isActive ? 'text-nomi-ink' : 'text-nomi-ink-80',
                )}
              >
                {threadDisplayTitle(thread)}
              </span>
              <span className={cn('shrink-0 text-micro text-nomi-ink-40')}>{relativeTime(thread.updatedAt, now)}</span>
              {isActive ? null : (
                <button
                  type="button"
                  className={cn(
                    'shrink-0 inline-grid place-items-center size-5 border-0 bg-transparent p-0 cursor-pointer',
                    'text-nomi-ink-30 opacity-0 group-hover:opacity-100 hover:text-nomi-ink-60',
                  )}
                  aria-label="删除这段对话"
                  onClick={(event) => {
                    event.stopPropagation()
                    deleteConversation(area, thread.id)
                  }}
                >
                  <IconX size={12} stroke={1.7} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
