import React from 'react'
import { IconHistory, IconPlugConnected } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import AssetPickerPopover from '../assets/AssetPickerPopover'
import { ConversationHistoryList } from './ConversationHistoryList'
import type { ConvArea } from './conversationThreads'

export type WorkbenchAiHeaderActionsProps = {
  className?: string
  actionClassName?: string
  /** 哪个面板:决定历史弹层操作的 area。 */
  area: ConvArea
  /** 模型接入入口：缺省则不渲染该图标（如创作助手——统一只走顶栏「模型接入」一个入口，去掉面板内重复）。 */
  onModelIntegration?: () => void
  /** 「新对话」处理器(归档当前线程 + 面板清理);由历史弹层顶部触发。 */
  onNewConversation: () => void
}

// 会话历史:头部一个「会话」入口(↺)→ 弹层(顶「+新对话」+ 过往会话列表)。
// 简化(2026-06-14 设计师/用户 agent):删 token 计数、历史与新对话合并成单入口。
export function WorkbenchAiHeaderActions({
  className,
  actionClassName,
  area,
  onModelIntegration,
  onNewConversation,
}: WorkbenchAiHeaderActionsProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  return (
    <div className={cn('workbench-ai-header-actions inline-flex items-center flex-nowrap gap-1.5', className)}>
      {onModelIntegration ? (
        <WorkbenchIconButton
          className={cn('workbench-ai-header-actions__button', actionClassName)}
          label="模型接入"
          onClick={onModelIntegration}
          icon={<IconPlugConnected size={14} />}
        />
      ) : null}
      <button
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
        <AssetPickerPopover onClose={() => setOpen(false)}>
          <ConversationHistoryList area={area} onNewConversation={onNewConversation} onClose={() => setOpen(false)} />
        </AssetPickerPopover>
      ) : null}
    </div>
  )
}

export function openWorkbenchModelIntegration(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('nomi-open-model-catalog', { detail: { intent: 'model-integration' } }))
}
