import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconRobot, IconTrash, IconX } from '@tabler/icons-react'
import { SelectionToolbarFrame } from '../../generationCanvas/components/SelectionToolbarFrame'

export default function StoryboardSelectionToolbar({ selectedCount, onDelete, onClear, onAgentHandoff }: {
  selectedCount: number
  onDelete: () => void
  onClear: () => void
  onAgentHandoff?: (() => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <SelectionToolbarFrame
      className="flex w-fit sticky bottom-2 z-10 mx-auto max-w-full flex-wrap justify-center gap-1.5 overflow-x-visible rounded-3xl"
      ariaLabel={t('storyboardEditor.selection.aria')}
      dataStoryboardSelectionToolbar
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="whitespace-nowrap pl-1.5 pr-1 text-body-sm text-nomi-ink-60">
        {t('storyboardEditor.selection.count', { count: selectedCount })}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('storyboardEditor.selection.clear')}
        className="grid size-7 shrink-0 -ml-1 place-items-center rounded-full text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
      >
        <IconX size={14} stroke={1.8} />
      </button>
      {onAgentHandoff ? (
        <button
          type="button"
          onClick={onAgentHandoff}
          data-storyboard-agent-handoff="selection"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 text-micro text-nomi-ink-80 hover:border-nomi-ink-30 hover:text-nomi-accent"
        >
          <IconRobot size={13} stroke={1.8} />
          {t('storyboardEditor.agentHandoff.selection')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-workbench-danger px-2 text-micro text-workbench-danger hover:bg-workbench-danger-soft"
      >
        <IconTrash size={13} stroke={1.8} />
        {t('storyboardEditor.selection.delete')}
      </button>
    </SelectionToolbarFrame>
  )
}
