import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentTraceDirectory } from '../../../desktop/useAgentTraceDirectory'
import { cn } from '../../../utils/cn'

export type ResidentThreadEntry = Readonly<{
  laneName: string
}>

export function ResidentThreadMenu({
  lanes,
  activeLane,
  onNewThread,
  onActivateThread,
  onRemoveThread,
  onClose,
}: {
  lanes: readonly ResidentThreadEntry[]
  activeLane: string
  onNewThread: () => void
  onActivateThread: (laneName: string) => void
  onRemoveThread: (laneName: string) => void
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const trace = useAgentTraceDirectory()
  return (
    <div
      className="absolute right-2 top-10 z-50 w-[280px] rounded-nomi border border-nomi-line bg-nomi-paper p-1 shadow-nomi-lg"
      data-agent-thread-menu="true"
      role="menu"
    >
      <div className="flex items-center gap-1.5 px-2 py-1 text-micro text-nomi-ink-60">
        <span>{t('agentResident.threads')}</span>
        <button type="button" className="text-nomi-accent" onClick={() => { onNewThread(); onClose() }}>
          {t('agentResident.newThread')}
        </button>
      </div>
      {lanes.map((thread) => (
        <div
          key={thread.laneName}
          className={cn('flex items-center gap-1 rounded-nomi-sm px-2 py-1', thread.laneName === activeLane && 'bg-nomi-accent-soft')}
        >
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-caption"
            onClick={() => { onActivateThread(thread.laneName); onClose() }}
          >
            {thread.laneName === 'main' ? t('agentResident.untitledThread') : thread.laneName}
          </button>
          <button
            type="button"
            className="grid size-7 place-items-center rounded-nomi-sm hover:bg-nomi-ink-10"
            aria-label={t('agentResident.removeThread')}
            onClick={() => onRemoveThread(thread.laneName)}
          >
            ×
          </button>
        </div>
      ))}
      {trace.available ? (
        <div className="mt-1 border-t border-nomi-line pt-1">
          <button
            type="button"
            role="menuitem"
            data-agent-trace-open="session"
            disabled={trace.busy}
            className="w-full rounded-nomi-sm px-2 py-2 text-left text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 disabled:opacity-50"
            onClick={() => { void trace.open(activeLane) }}
          >
            {t(trace.busy ? 'settings.general.trace.opening' : 'agentResident.viewTrace')}
          </button>
          {trace.message ? <p role="alert" className="px-2 py-1 text-caption text-nomi-ink-60">{trace.message}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
