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

function localizedGateCopy(
  run: NonNullable<ReturnType<typeof useActiveProductionRun>['run']>,
  gate: NonNullable<ReturnType<typeof useActiveProductionRun>['run']>['gates'][number],
  translate: (key: string, params?: Record<string, unknown>) => string,
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
    // B1：有候选 → 用「选方向」文案（配单选行）；没候选（LLM 关着的兜底）→ 保持原「确认创作方向」。
    const hasCandidates = (gate.directionCandidates?.length ?? 0) > 0
    return {
      title: translate(hasCandidates ? 'generationCommon.production.gate.directionPickTitle' : 'generationCommon.production.gate.directionTitle'),
      message: translate(hasCandidates ? 'generationCommon.production.gate.directionPickSummary' : 'generationCommon.production.gate.directionSummary'),
    }
  }
  if (gate.scope === 'stage' && gate.gateId.startsWith('gate-sample-')) {
    // B2：样片门——先看首镜再批量。批准=满意继续；取消=换风格重来（会暂停）。
    return {
      title: translate('generationCommon.production.gate.sampleTitle'),
      message: translate('generationCommon.production.gate.sampleSummary'),
    }
  }
  if (gate.scope === 'anchor_checkpoint') {
    // P4 真供应商加固：锚亮相检查点（T1）——先看主角形象，点头开拍；不满意只重画形象（术语人话，不说「锚」）。
    return {
      title: translate('generationCommon.production.gate.checkpointTitle'),
      message: translate('generationCommon.production.gate.checkpointSummary'),
    }
  }
  if (gate.scope === 'job_set' && gate.gateId.startsWith('gate-shot-')) {
    const job = run.jobs.find((candidate) => candidate.jobId === gate.jobIds[0])
    const index = job ? run.jobs.findIndex((candidate) => candidate.jobId === job.jobId) + 1 : 0
    const params = {
      index,
      node: job?.nodeId || job?.jobId || gate.jobIds[0] || '-',
      provider: job?.provider || '-',
      model: job?.model || '-',
    }
    return {
      title: translate('generationCommon.production.gate.shotTitle', params),
      message: translate('generationCommon.production.gate.shotSummary', params),
    }
  }
  return { title: gate.title, message: gate.summary }
}

export function useProductionStatus(options: { enabled?: boolean } = {}) {
  const { t } = useTranslation()
  const production = useActiveProductionRun(undefined, options)
  const actionInFlightRef = React.useRef(false)
  const view = React.useMemo(() => (production.run ? buildProductionRunView(production.run) : null), [production.run])
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

        if (action === 'review-script' || action === 'review-storyboard') {
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
        if (action === 'resume-run') {
          // A4：从断点继续（run.control 与 MCP 侧同一命令收口）。
          try {
            await executeCommand(run.projectId, run.runId, {
              commandId: globalThis.crypto.randomUUID(),
              expectedRevision: run.revision,
              type: 'run.control',
              payload: { action: 'resume' },
              issuedAt: new Date().toISOString(),
            })
            await useProductionRunStore.getState().loadRun(run.projectId, run.runId)
          } catch (error) {
            await alertDialog({
              title: t('generationCommon.production.control.failed'),
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
        const gateCopy = localizedGateCopy(activeRun, gate, (key, params) => t(key, params))
        const contract = ['budget_envelope', 'export', 'publish'].includes(gate.scope)
          ? buildProductionContractView(activeRun, gate)
          : undefined
        // B1：方向门候选（driver 拟好后挂在 gate 上）。有候选 → 弹单选，捕获选中 key 带进决议留痕。
        const isDirectionGate = gate.scope === 'stage' && gate.gateId.startsWith('gate-direction-')
        const isSampleGateApproval = gate.scope === 'stage' && gate.gateId.startsWith('gate-sample-')
        const isShotGate = gate.scope === 'job_set' && gate.gateId.startsWith('gate-shot-')
        const shotJob = isShotGate ? activeRun.jobs.find((candidate) => candidate.jobId === gate?.jobIds[0]) : undefined
        const shotIndex = shotJob ? activeRun.jobs.findIndex((candidate) => candidate.jobId === shotJob.jobId) + 1 : 0
        const directionCandidates = isDirectionGate ? (gate.directionCandidates ?? []) : []
        let directionChoiceKey: string | null = directionCandidates[0]?.key ?? null
        let openingPolicySettings = false
        const approved = await useSpendConfirmStore.getState().requestConfirm({
          title: gateCopy.title,
          message: gateCopy.message,
          // B2：样片门批准=「满意，批量生成」；其余门=「批准并继续」。
          confirmLabel: t(isSampleGateApproval
            ? 'generationCommon.production.gate.sampleApprove'
            : isShotGate
              ? 'generationCommon.production.gate.shotApprove'
              : 'generationCommon.production.gate.approve'),
          ...(isSampleGateApproval || isShotGate ? {
            cancelLabel: t(isShotGate ? 'generationCommon.production.gate.shotReject' : 'generationCommon.production.gate.sampleReject'),
          } : {}),
          source: activeRun.origin.host === 'nomi' ? 'user' : 'agent',
          kind: gate.scope === 'stage' ? 'plan' : isShotGate ? 'generation' : 'contract',
          ...(contract ? { contract } : {}),
          ...(isShotGate && shotJob ? {
            details: [
              { label: t('generationCommon.production.gate.shotLabel'), value: `${shotIndex} · ${shotJob.nodeId || shotJob.jobId}` },
              { label: t('generationCommon.production.gate.providerModelLabel'), value: `${shotJob.provider} · ${shotJob.model}` },
            ],
          } : {}),
          ...(directionCandidates.length ? {
            directionCandidates: directionCandidates.map((candidate) => ({ key: candidate.key, title: candidate.title, oneLiner: candidate.oneLiner })),
            onDirectionDecision: (key: string | null) => { directionChoiceKey = key },
          } : {}),
          ...(gate.scope === 'budget_envelope' && contract && !contract.policy.ready ? {
            onOpenPolicySettings: () => {
              openingPolicySettings = true
              window.dispatchEvent(new CustomEvent('nomi-open-settings', {
                detail: buildProductionPolicySettingsTarget(contract.policy),
              }))
            },
          } : {}),
        })
        const isSampleGate = gate.scope === 'stage' && gate.gateId.startsWith('gate-sample-')
        if (!approved) {
          if (openingPolicySettings) return
          // 预算门否决=撤销制作；样片门否决=换风格重来（service 会把它变成暂停）。其余门（方向/plan）取消=不表态。
          if (gate.scope !== 'budget_envelope' && !isSampleGate && !isShotGate) return
          try {
            await executeCommand(activeRun.projectId, activeRun.runId, {
              commandId: globalThis.crypto.randomUUID(),
              expectedRevision: activeRun.revision,
              type: 'gate.decide',
              payload: { gateId: gate.gateId, status: 'rejected' },
              issuedAt: new Date().toISOString(),
            })
            await useProductionRunStore.getState().loadRun(activeRun.projectId, activeRun.runId)
          } catch (error) {
            await alertDialog({
              title: t('generationCommon.production.gate.failed'),
              message: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }
        try {
          await executeCommand(activeRun.projectId, activeRun.runId, {
            commandId: globalThis.crypto.randomUUID(),
            expectedRevision: activeRun.revision,
            type: 'gate.decide',
            payload: { gateId: gate.gateId, status: 'approved', ...(directionChoiceKey ? { choiceKey: directionChoiceKey } : {}) },
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
    [executeCommand, production.run, t, view?.targetId],
  )

  // A4 情境控制：暂停直接执行；取消是破坏性动作先 confirmDialog（§3.5）。两者与 MCP 同走 run.control。
  const onControl = React.useCallback(
    async (action: 'pause' | 'cancel') => {
      const run = production.run
      if (!run || actionInFlightRef.current) return
      actionInFlightRef.current = true
      try {
        if (action === 'cancel') {
          const confirmed = await confirmDialog({
            title: t('generationCommon.production.control.cancelTitle'),
            message: t('generationCommon.production.control.cancelMessage'),
            confirmLabel: t('generationCommon.production.control.cancelConfirm'),
            cancelLabel: t('common.cancel'),
            danger: true,
          })
          if (!confirmed) return
        }
        await executeCommand(run.projectId, run.runId, {
          commandId: globalThis.crypto.randomUUID(),
          expectedRevision: run.revision,
          type: 'run.control',
          payload: { action },
          issuedAt: new Date().toISOString(),
        })
        await useProductionRunStore.getState().loadRun(run.projectId, run.runId)
      } catch (error) {
        await alertDialog({
          title: t('generationCommon.production.control.failed'),
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        actionInFlightRef.current = false
      }
    },
    [executeCommand, production.run, t],
  )

  const navigationTarget = production.navigationTarget
  const focusedArtifactId =
    navigationTarget &&
    navigationTarget.projectId === production.run?.projectId &&
    navigationTarget.runId === production.run?.runId
      ? (navigationTarget.artifactId ?? null)
      : null

  return { production, view, focusedArtifactId, onPrimaryAction, onControl }
}
