// P4 S5 — 制作（Agent 付费卡 / 多镜批次）落到画布的节点上，**只属于制作**的两块小标：排队中 / 已停。
//
// 「生成中」与「失败」不在这里画（2026-09-25）：那两段写进节点自己的运行记录（主进程画布落地投影 →
// materialize-shots → 节点 runs[0]），由普通生成那一套 NodeGeneratingOverlay / NodeErrorReport 画——
// 一个节点「在生成 / 生成完」只有一份真相、一套画法。以前这里自己轮询一份 Run 快照另画「整卡模糊 + N 字标」，
// 供应商早出片了它还在转（用户原话：「没有复用逻辑，视频早就生产出来了，他这里一直显示生成中」）。
//
// 排队中 / 已停没有普通生成的对应物，所以留在这里；判定读中立层 `deriveProductionShotState`（与主进程投影
// 同一个函数，两端不会一个说在生成、一个说已停）。节点已有结果或自己在跑（普通生成 / 制作投影的生成中）时不画。
//
// 状态色一律根层 token（#128 后）：已停 = --nomi-warning（非 danger，预算/急停是可继续的中止，不是错误）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconClock, IconPlayerPause } from '@tabler/icons-react'

import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { deriveProductionShotState, productionShotIdForNode } from '../../../../electron/shared/productionShotPhase'
import { resumeProductionBatch } from '../../production/productionShotActions'

/** 该节点是否属某制作 Run（meta.productionRunId）。非制作节点 → 组件早退，零开销。 */
function productionRunIdOf(node: GenerationCanvasNode): string | null {
  const meta = node.meta as Record<string, unknown> | undefined
  return typeof meta?.productionRunId === 'string' && meta.productionRunId ? meta.productionRunId : null
}

export function ProductionShotPlaceholder({ node, reportFeedback }: { reportFeedback: (message: string) => void; node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const runId = productionRunIdOf(node)
  // 只在这个 Run 是 store 缓存里的那一份时派生（避免读到别的项目/Run 的态）。
  const state = useProductionCanvasLandingStore((store) => {
    const run = runId ? store.runs[runId] : undefined
    return run ? deriveProductionShotState(run, productionShotIdForNode(run, node.id)) : null
  })
  const projectId = useProductionCanvasLandingStore((store) => (runId && store.runs[runId] ? store.projectId : null))
  const stoppedReason = state?.stoppedReason
  const [busy, setBusy] = React.useState(false)
  const runResume = React.useCallback(() => {
    if (!projectId || !runId || busy) return
    setBusy(true)
    void resumeProductionBatch(projectId, runId, stoppedReason === 'budget' ? 'budget' : 'manual', reportFeedback).finally(() => setBusy(false))
  }, [busy, projectId, runId, stoppedReason, reportFeedback])

  if (!runId || !state || node.result?.url) return null
  // 节点自己在跑（制作投影的「生成中」或用户手动的一次）：那一段由 NodeGeneratingOverlay 画，这里不叠第二层。
  if (node.status === 'running' || node.status === 'queued') return null

  if (state.phase === 'queued') {
    // 排队中（第 n/N）：左上角小徽标（同 NodeQueuedBadge 语言）+ 棋盘格占位（节点本来就没生成出来）。
    const label = state.queueIndex && state.queueTotal
      ? t('generationCommon.production.canvasLanding.queuedNth', { index: state.queueIndex, total: state.queueTotal })
      : t('generationCommon.production.canvasLanding.queued')
    return (
      <div
        className="absolute left-2 top-2 z-[4] inline-flex items-center gap-1 rounded-full bg-nomi-paper/85 px-2 py-0.5 text-micro text-nomi-ink-60 shadow-nomi-sm"
        data-shot-placeholder-state="queued"
        data-production-shot-node={node.id}
        aria-label={label}
      >
        <IconClock size={11} stroke={1.8} aria-hidden="true" />
        {label}
      </div>
    )
  }

  if (state.phase !== 'stopped') return null
  // 已停（预算触顶 / 用户急停）：warning 底（非 danger），一句人话 + 提额/继续入口。
  const message = state.stoppedReason === 'budget'
    ? t('generationCommon.production.canvasLanding.stoppedBudget')
    : t('generationCommon.production.canvasLanding.stoppedManual')
  const actionLabel = state.stoppedReason === 'budget'
    ? t('generationCommon.production.canvasLanding.raiseBudget')
    : t('generationCommon.production.canvasLanding.continueRemaining')
  return (
    <div
      role="status"
      data-shot-placeholder-state="stopped"
      data-production-shot-node={node.id}
      className={cn(
        'absolute inset-0 z-[4] flex flex-col items-center justify-center gap-2 rounded-nomi p-4 text-center',
        'bg-[color-mix(in_oklch,var(--nomi-warning)_6%,var(--nomi-paper))]',
        'border border-[color-mix(in_oklch,var(--nomi-warning)_28%,transparent)]',
      )}
    >
      <IconPlayerPause size={18} stroke={1.6} className="text-nomi-warning" aria-hidden="true" />
      <span className="text-caption leading-snug text-nomi-ink-80">{message}</span>
      {/* P4 S6：提额续拍 / 急停继续接活。data-* 用 active 值供走查；busy 期间禁重复点。 */}
      <button
        type="button"
        disabled={busy || !projectId}
        onClick={runResume}
        onPointerDown={(event) => event.stopPropagation()}
        data-production-shot-action={stoppedReason === 'budget' ? 'resume-budget' : 'resume-manual'}
        className={cn(
          'rounded-nomi-sm border px-2.5 py-1 text-caption',
          busy || !projectId
            ? 'cursor-not-allowed border-nomi-line bg-nomi-paper text-nomi-ink-40'
            : 'border-[color-mix(in_oklch,var(--nomi-warning)_36%,transparent)] bg-nomi-paper text-nomi-ink hover:bg-[color-mix(in_oklch,var(--nomi-warning)_8%,var(--nomi-paper))]',
        )}
      >
        {actionLabel}
      </button>
    </div>
  )
}
