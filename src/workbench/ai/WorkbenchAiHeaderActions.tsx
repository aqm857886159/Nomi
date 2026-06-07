import { IconPlugConnected, IconPlus } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../design'
import { cn } from '../../utils/cn'
import { useAgentUsageStore } from './agentUsageStore'

export type WorkbenchAiHeaderActionsProps = {
  className?: string
  actionClassName?: string
  /** 模型接入入口：缺省则不渲染该图标（如创作助手——统一只走顶栏「模型接入」一个入口，去掉面板内重复）。 */
  onModelIntegration?: () => void
  onNewConversation: () => void
}

export function WorkbenchAiHeaderActions({
  className,
  actionClassName,
  onModelIntegration,
  onNewConversation,
}: WorkbenchAiHeaderActionsProps): JSX.Element {
  // Cumulative token usage for this app session (harness #8). Hidden until the
  // first real turn so it doesn't add noise on an empty thread.
  const totalTokens = useAgentUsageStore((s) => s.totalTokens)
  return (
    <div className={cn('workbench-ai-header-actions inline-flex items-center flex-nowrap gap-1.5', className)}>
      {totalTokens > 0 ? (
        <span
          className={cn('mr-0.5 whitespace-nowrap text-[10.5px] tabular-nums text-nomi-ink-40')}
          title={`本会话累计 ${totalTokens.toLocaleString()} tokens`}
        >
          {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tok
        </span>
      ) : null}
      {onModelIntegration ? (
        <WorkbenchIconButton
          className={cn('workbench-ai-header-actions__button', actionClassName)}
          label="模型接入"
          onClick={onModelIntegration}
          icon={<IconPlugConnected size={14} />}
        />
      ) : null}
      <WorkbenchIconButton
        className={cn('workbench-ai-header-actions__button', actionClassName)}
        label="新对话"
        onClick={onNewConversation}
        icon={<IconPlus size={14} />}
      />
    </div>
  )
}

export function openWorkbenchModelIntegration(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('nomi-open-model-catalog', { detail: { intent: 'model-integration' } }))
}
