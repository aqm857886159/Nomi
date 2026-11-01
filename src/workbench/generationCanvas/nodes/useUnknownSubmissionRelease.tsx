import React from 'react'
import { useTranslation } from 'react-i18next'
import { DecisionBar } from '../../../design'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { productionRunApi } from '../../production/productionRunApi'
import { releaseUnknownSubmissionForNode, releaseUnknownCanvasSubmissionsForNode } from '../../production/releaseUnknownSubmission'
import { productionMetaOf } from '../model/productionMeta'
import { confirmAndRunNode } from '../runner/generationRunController'

export function useUnknownSubmissionRelease(nodeId: string | undefined, meta?: Record<string, unknown>) {
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const inFlight = React.useRef(false)
  const continueRelease = async () => {
    if (!nodeId || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setFailed(false)
    try {
      await withProjectAction(async (project) => {
        const runId = productionMetaOf({ meta })?.runId
        const released = runId
          ? await releaseUnknownSubmissionForNode(project.binding.projectId, runId, nodeId, productionRunApi)
          : await releaseUnknownCanvasSubmissionsForNode(project.binding.projectId, nodeId, productionRunApi).then(() => true)
        setConfirming(false)
        if (released) await confirmAndRunNode(nodeId, { initiator: 'user' })
      })
    } catch {
      setFailed(true)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return { confirming, busy, failed, open: () => setConfirming(true), cancel: () => { if (!inFlight.current) { setConfirming(false); setFailed(false) } }, continueRelease }
}

export function UnknownSubmissionConfirmation({ release }: { release: ReturnType<typeof useUnknownSubmissionRelease> }) {
  const { t } = useTranslation()
  return <div data-release-confirm className="mb-1 grid gap-2" onPointerDown={(event) => event.stopPropagation()}>
    <p className="text-caption leading-snug text-nomi-ink-80">{t('generationCommon.observability.releaseConfirm.message')}</p>
    {release.failed ? <p className="text-micro text-workbench-danger">{t('generationCommon.observability.releaseConfirm.failed')}</p> : null}
    <DecisionBar cancelLabel={t('generationCommon.observability.releaseConfirm.cancel')} onCancel={release.cancel}
      primaryLabel={t('generationCommon.observability.releaseConfirm.continue')} onPrimary={() => { void release.continueRelease() }} primaryDisabled={release.busy}
      tone="danger" dangerClassName="bg-workbench-danger text-nomi-paper hover:bg-workbench-danger" />
  </div>
}
