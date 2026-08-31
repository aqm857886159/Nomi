import React from 'react'
import { useTranslation } from 'react-i18next'

import { alertDialog, confirmDialog } from '../../design'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useSpendConfirmStore } from '../generationCanvas/spend/spendConfirm'
import { buildProductionContractView } from '../generationCanvas/spend/productionContractView'
import { useWorkbenchStore } from '../workbenchStore'
import { productionRunApi } from './productionRunApi'
import { executeProductionRunCommand } from './productionRunCommands'
import { buildProductionPolicySettingsTarget, isProductionPolicyError } from './productionPolicyRecovery'
import { useProductionRunStore } from './productionRunStore'
import { buildProductionRunView, type ProductionRunPrimaryAction } from './productionRunView'
import { useActiveProductionRun } from './useActiveProductionRun'
import {
  resolveProductionProviderLabels,
  resolveProductionProviderReplacementPlan,
  type ProductionProviderReplacementPlan,
} from './productionProviderRecovery'

function localizedGateCopy(
  gate: NonNullable<ReturnType<typeof useActiveProductionRun>['run']>['gates'][number],
  translate: (key: string) => string,
): { title: string; message: string } {
  if (gate.scope === 'export') {
    return {
      title: translate('generationCommon.production.gate.exportTitle'),
      message: translate('generationCommon.production.gate.exportSummary'),
    }
  }
  if (gate.scope === 'budget_envelope') {
    return {
      title: translate('generationCommon.production.gate.contractTitle'),
      message: translate('generationCommon.production.gate.contractSummary'),
    }
  }
  if (gate.scope === 'stage' && gate.gateId.startsWith('gate-direction-')) {
    return {
      title: translate('generationCommon.production.gate.directionTitle'),
      message: translate('generationCommon.production.gate.directionSummary'),
    }
  }
  return { title: gate.title, message: gate.summary }
}

export function useProductionStatus() {
  const { t } = useTranslation()
  const production = useActiveProductionRun()
  const generationNodes = useGenerationCanvasStore((state) => state.nodes)
  const [replacementPlan, setReplacementPlan] = React.useState<ProductionProviderReplacementPlan | null>(null)
  const [selectedReplacementId, setSelectedReplacementId] = React.useState('')
  const actionInFlightRef = React.useRef(false)
  React.useEffect(() => {
    let alive = true
    const run = production.run
    if (!run || !run.jobs.some((job) => ['not_dispatched', 'submission_unknown', 'needs_attention'].includes(job.status))) {
      setReplacementPlan(null)
      return () => { alive = false }
    }
    void resolveProductionProviderReplacementPlan(run, generationNodes)
      .then((plan) => {
        if (!alive) return
        setReplacementPlan(plan)
        setSelectedReplacementId((current) =>
          plan?.candidates.some((candidate) => candidate.id === current)
            ? current
            : plan?.candidates[0]?.id || '')
      })
      .catch(() => { if (alive) setReplacementPlan(null) })
    return () => { alive = false }
  }, [generationNodes, production.run])
  const selectedReplacementPlan = React.useMemo(() => {
    if (!replacementPlan) return null
    const candidate = replacementPlan.candidates.find((item) => item.id === selectedReplacementId)
      ?? replacementPlan.candidates[0]
    return candidate ? {
      ...replacementPlan,
      replacementProvider: candidate.provider,
      replacementProviderLabel: candidate.label,
      replacements: candidate.replacements,
    } : replacementPlan
  }, [replacementPlan, selectedReplacementId])
  const view = React.useMemo(() => (production.run ? buildProductionRunView(production.run, Date.now(), {
    ...(selectedReplacementPlan ? { replacement: selectedReplacementPlan } : {}),
  }) : null), [production.run, selectedReplacementPlan])
  const executeCommand = React.useCallback(
    (projectId: string, runId: string, command: Parameters<typeof productionRunApi.command>[2]) =>
      executeProductionRunCommand(projectId, runId, command, {
        read: productionRunApi.read,
        execute: productionRunApi.command,
      }),
    [],
  )

  const onPrimaryAction = React.useCallback(
    async (action: Exclude<ProductionRunPrimaryAction, null>) => {
      if (actionInFlightRef.current) return
      actionInFlightRef.current = true
      try {
        const run = production.run
        if (!run) return
        const targetJob =
          run.jobs.find((job) => job.jobId === view?.targetId) ??
          [...run.jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

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
            await executeCommand(run.projectId, run.runId, {
              commandId: globalThis.crypto.randomUUID(),
              expectedRevision: run.revision,
              type: 'run.status',
              payload: { status: 'awaiting_export' },
              issuedAt: new Date().toISOString(),
            })
            await useProductionRunStore.getState().loadRun(run.projectId, run.runId)
          } catch (error) {
            await alertDialog({
              title: t('generationCommon.production.gate.failed'),
              message: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }
        if (action === 'open-export') {
          useWorkbenchStore.getState().setWorkspaceMode('preview')
          return
        }
        if (action === 'replace-provider') {
          if (!selectedReplacementPlan) return
          const accepted = await confirmDialog({
            title: t('generationCommon.production.recovery.confirmTitle'),
            message: t('generationCommon.production.recovery.confirmMessage', {
              failedProvider: selectedReplacementPlan.failedProvider,
              replacementProvider: selectedReplacementPlan.replacementProviderLabel,
              count: selectedReplacementPlan.affectedCount,
            }),
            confirmLabel: t('generationCommon.production.recovery.confirm', {
              provider: selectedReplacementPlan.replacementProviderLabel,
            }),
            cancelLabel: t('common.cancel'),
          })
          if (!accepted) return
          try {
            const rebound = await executeCommand(run.projectId, run.runId, {
              commandId: globalThis.crypto.randomUUID(),
              expectedRevision: run.revision,
              type: 'plan.rebind-provider',
              payload: {
                replacements: selectedReplacementPlan.replacements,
              },
              issuedAt: new Date().toISOString(),
            })
            await useProductionRunStore.getState().loadRun(run.projectId, run.runId)
            const gate = rebound.run.gates.find((item) => item.gateId === `gate-contract-v${rebound.run.planVersion}` && item.status === 'waiting')
            if (!gate) return
            const providerLabels = await resolveProductionProviderLabels()
            const contract = buildProductionContractView(rebound.run, gate, { providerLabels })
            const approved = await useSpendConfirmStore.getState().requestConfirm({
              title: t('generationCommon.production.gate.replacementContractTitle'),
              message: t('generationCommon.production.gate.replacementContractSummary'),
              confirmLabel: t('generationCommon.production.gate.approve'),
              source: rebound.run.origin.host === 'nomi' ? 'user' : 'agent',
              kind: 'contract',
              contract,
            })
            if (!approved) return
            await executeCommand(rebound.run.projectId, rebound.run.runId, {
              commandId: globalThis.crypto.randomUUID(),
              expectedRevision: rebound.run.revision,
              type: 'gate.decide',
              payload: { gateId: gate.gateId, status: 'approved' },
              issuedAt: new Date().toISOString(),
            })
            await useProductionRunStore.getState().loadRun(rebound.run.projectId, rebound.run.runId)
          } catch (error) {
            await alertDialog({
              title: t('generationCommon.production.recovery.failed'),
              message: error instanceof Error ? error.message : String(error),
            })
          }
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
            await executeCommand(run.projectId, run.runId, {
              commandId: globalThis.crypto.randomUUID(),
              expectedRevision: run.revision,
              type: 'job.reconcile',
              payload: { jobId: targetJob?.jobId, outcome },
              issuedAt: new Date().toISOString(),
            })
            await useProductionRunStore.getState().loadRun(run.projectId, run.runId)
          } catch (error) {
            await alertDialog({
              title: t('generationCommon.production.reconcile.failed'),
              message: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }

        let activeRun = run
        let gate =
          activeRun.gates.find((item) => item.gateId === view?.targetId && item.status === 'waiting') ??
          run.gates.find((item) => item.status === 'waiting')
        if (!gate) return
        if (gate.scope === 'budget_envelope') {
          try {
            const refreshed = await executeCommand(activeRun.projectId, activeRun.runId, {
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
            await alertDialog({
              title: t('generationCommon.production.gate.failed'),
              message: error instanceof Error ? error.message : String(error),
            })
            return
          }
        }
        const gateCopy = localizedGateCopy(gate, (key) => t(key))
        const providerLabels = gate.scope === 'stage' ? {} : await resolveProductionProviderLabels()
        const contract = gate.scope === 'stage'
          ? undefined
          : buildProductionContractView(activeRun, gate, { providerLabels })
        const approved = await useSpendConfirmStore.getState().requestConfirm({
          title: gateCopy.title,
          message: gateCopy.message,
          confirmLabel: t('generationCommon.production.gate.approve'),
          source: activeRun.origin.host === 'nomi' ? 'user' : 'agent',
          kind: gate.scope === 'stage' ? 'plan' : 'contract',
          ...(contract ? { contract } : {}),
          ...(gate.scope === 'budget_envelope' && contract && !contract.policy.ready ? {
            onOpenPolicySettings: () => {
              window.dispatchEvent(new CustomEvent('nomi-open-settings', {
                detail: buildProductionPolicySettingsTarget(contract.policy),
              }))
            },
          } : {}),
        })
        if (!approved) return
        try {
          await executeCommand(activeRun.projectId, activeRun.runId, {
            commandId: globalThis.crypto.randomUUID(),
            expectedRevision: activeRun.revision,
            type: 'gate.decide',
            payload: { gateId: gate.gateId, status: 'approved' },
            issuedAt: new Date().toISOString(),
          })
          await useProductionRunStore.getState().loadRun(activeRun.projectId, activeRun.runId)
        } catch (error) {
          const incompletePolicy = isProductionPolicyError(error)
          const openSettings = await confirmDialog({
            title: incompletePolicy
              ? t('generationCommon.production.gate.missingPolicyFallbackTitle')
              : t('generationCommon.production.gate.failed'),
            message: incompletePolicy
              ? t('generationCommon.production.gate.missingPolicyMessage')
              : error instanceof Error ? error.message : String(error),
            confirmLabel: incompletePolicy
              ? t('generationCommon.production.gate.openProductionPolicy')
              : t('generationCommon.production.gate.openSettings'),
            cancelLabel: t('common.cancel'),
          })
          if (openSettings)
            window.dispatchEvent(
              new CustomEvent('nomi-open-settings', {
                detail: incompletePolicy && contract
                  ? buildProductionPolicySettingsTarget(contract.policy)
                  : { tab: 'automation', section: 'automation' },
              }),
            )
        }
      } finally {
        actionInFlightRef.current = false
      }
    },
    [executeCommand, production.run, selectedReplacementPlan, t, view?.targetId],
  )

  const navigationTarget = production.navigationTarget
  const focusedArtifactId =
    navigationTarget &&
    navigationTarget.projectId === production.run?.projectId &&
    navigationTarget.runId === production.run?.runId
      ? (navigationTarget.artifactId ?? null)
      : null

  return {
    production,
    view,
    focusedArtifactId,
    onPrimaryAction,
    recoverySelection: replacementPlan ? {
      value: selectedReplacementId || replacementPlan.candidates[0]?.id || '',
      options: replacementPlan.candidates.map((candidate) => ({
        value: candidate.id,
        label: candidate.label,
        trailing: candidate.id === replacementPlan.candidates[0]?.id
          ? t('generationCommon.production.recovery.recommended')
          : undefined,
      })),
      onChange: setSelectedReplacementId,
    } : null,
  }
}
