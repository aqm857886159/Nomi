import { IconPlugConnected, IconPlus } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../design'

export type WorkbenchAiHeaderActionsProps = {
  className?: string
  actionClassName?: string
  onModelIntegration: () => void
  onNewConversation: () => void
}

export function WorkbenchAiHeaderActions({
  className,
  actionClassName,
  onModelIntegration,
  onNewConversation,
}: WorkbenchAiHeaderActionsProps): JSX.Element {
  const rootClassName = className ? `workbench-ai-header-actions ${className}` : 'workbench-ai-header-actions'
  const buttonClassName = actionClassName
    ? `workbench-ai-header-actions__button ${actionClassName}`
    : 'workbench-ai-header-actions__button'

  return (
    <div className={rootClassName}>
      <WorkbenchIconButton
        className={buttonClassName}
        label="模型接入"
        onClick={onModelIntegration}
        icon={<IconPlugConnected size={14} />}
      />
      <WorkbenchIconButton
        className={buttonClassName}
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
