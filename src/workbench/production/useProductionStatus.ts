import React from 'react'
import { useTranslation } from 'react-i18next'

import { alertDialog, confirmDialog } from '../../design'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { buildProductionContractView } from '../generationCanvas/spend/productionContractView'
import { useWorkbenchStore } from '../workbenchStore'
import { productionRunApi } from './productionRunApi'
import { useProductionRunStore } from './productionRunStore'
import { buildProductionRunView, type ProductionRunPrimaryAction } from './productionRunView'
import { useActiveProductionRun } from './useActiveProductionRun'

function localizedGateCopy(gate: NonNullable<ReturnType<typeof useActiveProductionRun>['run']>['gates'][number], translate: (key: string) => string): { title: string; message: string } {
  if (gate.scope === 'export') {
    return { title: translate('generationCommon.production.gate.exportTitle'), message: translate('generationCommon.production.gate.exportSummary') }
  }
  if (gate.scope === 'budget_envelope') {
    return { title: translate('generationCommon.production.gate.contractTitle'), message: translate('generationCommon.production.gate.contractSummary') }
  }
  if (gate.scope === 'stage' && gate.gateId.startsWith('gate-direction-')) {
    return { title: translate('generationCommon.production.gate.directionTitle'), message: translate('generationCommon.production.gate.directionSummary') }
  }
  return { title: gate.title, message: gate.summary }
}

export function useProductionStatus() {
  const { t } = useTranslation()
  const production = useActiveProductionRun()
  const view = React.useMemo(
    () => production.run ? buildProductionRunView(production.run) : null,
    [production.run],
  )

  const onPrimaryAction = React.useCallback(async (action: Exclude<ProductionRunPrimaryAction, null>) => {
    const run = production.run
    if (!run) return
    const targetJob = run.jobs.find((job) => job.jobId === view?.targetId)
      ?? [...run.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

    if (action === 'review-storyboard') {
      useWorkbenchStore.getState().setWorkspaceMode('creation')
      return
    }
    if (action === 'open-stage') {
      if (targetJob?.nodeId) useGenerationCanvasStore.getState().selectNode(targetJob.nodeId)
      useWorkbenchStore.getState().setWorkspaceMode('generation')
      useWorkbenchStore.getState().requestCanvasFit()
      return
    }
    if (action === 'review-rough-cut') {
      useWorkbenchStore.getState().setWorkspaceMode('preview')
      const accepted = await confirmDialog({
        title: t('generationCommon.production.roughCut.title'),
        message: t('generationCommon.production.roughCut.message'),
        confirmLabel: t('generationCommon.production.roughCut.accept'),
        cancelLabel: t('generationCommon.production.roughCut.keepReviewing'),
      })
      if (!accepted) return
      try {
        await productionRunApi.command(run.projectId, run.runId, {
          commandId: globalThis.crypto.randomUUID(),
          expectedRevision: run.revision,
          type: 'run.status',
          payload: { status: 'awaiting_export' },
          issuedAt: new Date().toISOString(),
        })
        await useProductionRunStore.getState().loadRun(run.projectId, run.runId)
      } catch (error) {
        await alertDialog({ title: t('generationCommon.production.gate.failed'), message: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    if (action === 'open-export') {
      useWorkbenchStore.getState().setWorkspaceMode('preview')
      return
    }
    if (action === 'reconcile') {
      if (targetJob?.nodeId) useGenerationCanvasStore.getState().selectNode(targetJob.nodeId)
      const found = await confirmDialog({
        title: t('generationCommon.production.reconcile.questionTitle'),
        message: t('generationCommon.production.reconcile.message', {
          provider: targetJob?.provider || t('generationCommon.production.reconcile.unknownProvider'),
          taskId: targetJob?.providerTaskId || t('generationCommon.production.reconcile.noTaskId'),
        }),
        confirmLabel: t('generationCommon.production.reconcile.found'),
        cancelLabel: t('generationCommon.production.reconcile.notFound'),
      })
      let outcome: 'found' | 'not_found' = 'found'
      if (!found) {
        const confirmMissing = await confirmDialog({
          title: t('generationCommon.production.reconcile.notFoundTitle'),
          message: t('generationCommon.production.reconcile.notFoundMessage'),
          confirmLabel: t('generationCommon.production.reconcile.confirmNotFound'),
          cancelLabel: t('common.cancel'),
          danger: true,
        })
        if (!confirmMissing) return
        outcome = 'not_found'
      }
      try {
        await productionRunApi.command(run.projectId, run.runId, {
          commandId: globalThis.crypto.randomUUID(),
          expectedRevision: run.revision,
          type: 'job.reconcile',
          payload: { jobId: targetJob?.jobId, outcome },
          issuedAt: new Date().toISOString(),
        })
        await useProductionRunStore.getState().loadRun(run.projectId, run.runId)
      } catch (error) {
        await alertDialog({ title: t('generationCommon.production.reconcile.failed'), message: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    let activeRun = run
    let gate = activeRun.gates.find((item) => item.gateId === view?.targetId && item.status === 'waiting')
      ?? run.gates.find((item) => item.status === 'waiting')
    if (!gate) return
    if (gate.scope === 'budget_envelope') {
      try {
        const refreshed = await productionRunApi.command(activeRun.projectId, activeRun.runId, {
          commandId: globalThis.crypto.randomUUID(),
          expectedRevision: activeRun.revision,
          type: 'policy.refresh',
          payload: {},
          issuedAt: new Date().toISOString(),
        })
        activeRun = refreshed.run
        gate = activeRun.gates.find((item) => item.gateId === gate?.gateId && item.status === 'waiting')
        if (!gate) return
      } catch (error) {
        await alertDialog({ title: t('generationCommon.production.gate.failed'), message: error instanceof Error ? error.message : String(error) })
        return
      }
    }
    const gateCopy = localizedGateCopy(gate, (key) => t(key))
    const approved = await useSpendConfirmStore.getState().requestConfirm({
      title: gateCopy.title,
      message: gateCopy.message,
      confirmLabel: t('generationCommon.production.gate.approve'),
      source: activeRun.origin.host === 'nomi' ? 'user' : 'agent',
      kind: gate.scope === 'stage' ? 'plan' : 'contract',
      ...(gate.scope === 'stage' ? {} : { contract: buildProductionContractView(activeRun, gate) }),
    })
    if (!approved) {
      if (gate.scope !== 'budget_envelope') return
      try {
        await productionRunApi.command(activeRun.projectId, activeRun.runId, {
          commandId: globalThis.crypto.randomUUID(),
          expectedRevision: activeRun.revision,
          type: 'gate.decide',
          payload: { gateId: gate.gateId, status: 'rejected' },
          issuedAt: new Date().toISOString(),
        })
        await useProductionRunStore.getState().loadRun(activeRun.projectId, activeRun.runId)
      } catch (error) {
        await alertDialog({ title: t('generationCommon.production.gate.failed'), message: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    try {
      await productionRunApi.command(activeRun.projectId, activeRun.runId, {
        commandId: globalThis.crypto.randomUUID(),
        expectedRevision: activeRun.revision,
        type: 'gate.decide',
        payload: { gateId: gate.gateId, status: 'approved' },
        issuedAt: new Date().toISOString(),
      })
      await useProductionRunStore.getState().loadRun(activeRun.projectId, activeRun.runId)
    } catch (error) {
      const openSettings = await confirmDialog({
        title: t('generationCommon.production.gate.failed'),
        message: error instanceof Error ? error.message : String(error),
        confirmLabel: t('generationCommon.production.gate.openSettings'),
        cancelLabel: t('common.cancel'),
      })
      if (openSettings) window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'automation' } }))
    }
  }, [production.run, t, view?.targetId])

  const navigationTarget = production.navigationTarget
  const focusedArtifactId = navigationTarget
    && navigationTarget.projectId === production.run?.projectId
    && navigationTarget.runId === production.run?.runId
    ? navigationTarget.artifactId ?? null
    : null

  return { production, view, focusedArtifactId, onPrimaryAction }
}
