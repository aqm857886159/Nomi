import React from 'react'
import { NomiAILabel } from '../../../design/identity'
import { WorkbenchButton } from '../../../design/workbenchActions'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const CanvasAssistantPanel = React.lazy(() => import('./CanvasAssistantPanel'))

type CanvasAssistantEntryProps = {
  defaultCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

function CanvasAssistantLauncher({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <aside
      className={cn(
        'generation-canvas-v2-assistant',
        'block w-auto h-auto rounded-full',
      )}
      data-collapsed="true"
      aria-label="生成区 AI 启动器"
    >
      <WorkbenchButton
        className={cn(
          'generation-canvas-v2-assistant__launcher',
          'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]',
          'border border-nomi-line rounded-full',
          'bg-nomi-paper text-nomi-ink font-[inherit] text-[13px] font-medium',
          'shadow-nomi-sm cursor-pointer',
          'hover:shadow-nomi-md hover:-translate-y-px',
        )}
        onClick={onOpen}
      >
        <NomiAILabel markSize={18} wordSize={13} suffix="生成" />
      </WorkbenchButton>
    </aside>
  )
}

export default function CanvasAssistantEntry({
  defaultCollapsed = true,
  onCollapsedChange,
}: CanvasAssistantEntryProps): JSX.Element {
  const collapsed = useGenerationCanvasStore((state) => state.generationAiCollapsed)
  const messagesLength = useGenerationCanvasStore((state) => state.generationAiMessages.length)
  const draft = useGenerationCanvasStore((state) => state.generationAiDraft)
  const setCollapsed = useGenerationCanvasStore((state) => state.setGenerationAiCollapsed)
  const [shouldLoadPanel, setShouldLoadPanel] = React.useState(() => (
    !defaultCollapsed || !collapsed || messagesLength > 0 || draft.trim().length > 0
  ))

  React.useEffect(() => {
    if (shouldLoadPanel) return
    onCollapsedChange?.(collapsed)
  }, [collapsed, onCollapsedChange, shouldLoadPanel])

  React.useEffect(() => {
    if (!collapsed || messagesLength > 0 || draft.trim().length > 0) {
      setShouldLoadPanel(true)
    }
  }, [collapsed, draft, messagesLength])

  const openPanel = React.useCallback(() => {
    setShouldLoadPanel(true)
    setCollapsed(false)
  }, [setCollapsed])

  if (!shouldLoadPanel) {
    return <CanvasAssistantLauncher onOpen={openPanel} />
  }

  return (
    <React.Suspense fallback={<CanvasAssistantLauncher onOpen={openPanel} />}>
      <CanvasAssistantPanel
        defaultCollapsed={defaultCollapsed}
        onCollapsedChange={onCollapsedChange}
      />
    </React.Suspense>
  )
}
