import React from 'react'
import { useTranslation } from 'react-i18next'
import { AnchoredPopover } from '../../../../design/AnchoredPopover'
import { generationFailureActions } from '../../../observability/generationFailureActions'
import { narrateErrorActionLabel } from '../../../observability/narrate'
import { UnknownSubmissionConfirmation } from '../../../generationCanvas/nodes/NodeErrorReport'
import { useUnknownSubmissionRelease } from '../../../production/releaseUnknownSubmission'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import { productionMetaOf } from '../../../generationCanvas/model/productionMeta'
import { withProjectAction } from '../../../project/projectCanvasReadSurface'
import { revealNotificationTarget } from '../../../../ui/notificationPolicy'
import { reopenRecoverableNode } from '../../../generationCanvas/runner/recoverTaskActions'

export function StoryboardFailureActions({ message, node, busy = false, onRetry }: {
  message?: string | null
  node?: GenerationCanvasNode | null
  busy?: boolean
  onRetry?: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const runId = productionMetaOf({ meta: node?.meta })?.runId
  const decision = generationFailureActions(message ?? '', { ...node?.runs?.[0], productionRunId: runId })
  const release = useUnknownSubmissionRelease(node?.id, node?.meta)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const viewTask = () => {
    if (decision.primary === 'open-recoverable' && node) { reopenRecoverableNode(node.id); return }
    withProjectAction((project) => { void revealNotificationTarget({ projectId: project.binding.projectId, ...(runId ? { runId } : {}), taskCenter: true }) })
  }
  const canRelease = Boolean(node && (decision.primary === 'release-regenerate' || decision.secondary === 'release-regenerate'))
  return <div ref={anchorRef} className="flex min-w-0 max-w-full flex-col items-start gap-1" data-storyboard-failure-actions>
    {decision.canRetry && onRetry ? <button type="button" onClick={onRetry} disabled={busy}
      aria-busy={busy} data-storyboard-retry-state={busy ? 'busy' : 'idle'}
      title={t('storyboardEditor.frame.retryHint')} aria-label={t('storyboardEditor.frame.retryHint')}
      className="min-h-6 max-w-full rounded-nomi-sm border border-workbench-danger px-1 text-micro leading-tight text-workbench-danger disabled:opacity-50">
      {busy ? t('storyboardEditor.frame.generating') : t('storyboardEditor.frame.retry')}
    </button> : <>
      {canRelease ? <button type="button" onClick={release.open} disabled={release.busy}
        className="min-h-6 max-w-full rounded-nomi-sm border border-workbench-danger px-1 text-left text-micro leading-tight text-workbench-danger">
        {narrateErrorActionLabel('release-regenerate', 'secondary')}
      </button> : null}
      <button type="button" onClick={viewTask} className="min-h-6 max-w-full text-left text-micro leading-tight text-nomi-ink-60">
        {narrateErrorActionLabel(decision.primary === 'open-recoverable' || decision.primary === 'reconcile' ? decision.primary : 'view-task', 'primary')}
      </button>
    </>}
    {release.confirming ? <AnchoredPopover anchorRef={anchorRef} onClose={release.cancel}>
      <div className="w-[300px] max-w-[calc(100vw-24px)] rounded-panel border border-nomi-line bg-nomi-paper p-3 shadow-nomi-md"><UnknownSubmissionConfirmation release={release} /></div>
    </AnchoredPopover> : null}
  </div>
}
