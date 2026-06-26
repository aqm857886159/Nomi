import React from 'react'
import { IconHistory } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { ConversationHistoryPopover } from './ConversationHistoryPopover'
import { ConversationHistoryList } from './ConversationHistoryList'
import type { ConvArea } from './conversationThreads'

export type WorkbenchAiHeaderActionsProps = {
  className?: string
  actionClassName?: string
  /** 哪个面板:决定历史弹层操作的 area。 */
  area: ConvArea
  /** 「新对话」处理器(归档当前线程 + 面板清理);由历史弹层顶部触发。 */
  onNewConversation: () => void
}

// 会话历史:头部一个「会话」入口(↺)→ 弹层(顶「+新对话」+ 过往会话列表)。
// 简化(2026-06-14 设计师/用户 agent):删 token 计数、历史与新对话合并成单入口。
export function WorkbenchAiHeaderActions({
  className,
  actionClassName,
  area,
  onNewConversation,
}: WorkbenchAiHeaderActionsProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const anchorRef = React.useRef<HTMLButtonElement>(null)
  return (
    <div className={cn('workbench-ai-header-actions inline-flex items-center flex-nowrap gap-1.5', className)}>
      <button
        ref={anchorRef}
        type="button"
        aria-label="会话历史"
        aria-expanded={open}
        // stopPropagation:压住弹层的「document mousedown 外点关闭」,让本按钮独占 toggle 语义。
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'workbench-ai-header-actions__button',
          actionClassName,
          open && 'bg-nomi-accent-soft text-nomi-accent',
        )}
      >
        <IconHistory size={14} />
      </button>
      {open ? (
        <ConversationHistoryPopover anchorRef={anchorRef} onClose={() => setOpen(false)}>
          <ConversationHistoryList area={area} onNewConversation={onNewConversation} onClose={() => setOpen(false)} />
        </ConversationHistoryPopover>
      ) : null}
    </div>
  )
}
