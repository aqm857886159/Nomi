// P4 S5 — Agent 批次镜**独有**的那一态：已停（预算触顶 / 用户急停），带续拍入口。
//
// 生成中 / 排队中 / 失败不在这里画（2026-09-24 用户拍板）：它们经 `projectShotExecution` 投影到节点上，
// 走普通节点那一套——等待面、状态行、标准错误卡（返工经 useProductionNodeRetry）。这里此前各有一版：
// 模糊遮罩 + 大 N、左上角「排队中 · 第 n/N」小签、内联简化红卡，是 8-25 写的；9-08 普通节点换成像素动画时
// 它们没跟上，同一个 App 里就有了两副「生成中」。还没点头的镜（草稿 / 报价卡在等）什么都不挂。
//
// 真相源 = Run（deriveShotPlaceholderState 纯派生），经 ProductionCanvasLandingHost 的 poll 喂进 landing store。
// 状态色一律根层 token：已停 = --nomi-warning（非 danger，预算/急停是可继续的中止，不是错误）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPause } from '@tabler/icons-react'

import { cn } from '../../../utils/cn'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { resumeProductionBatch } from '../../production/productionShotActions'
import { productionRunIdOf, useProductionShotState } from '../../production/useProductionExecutionNode'

export function ProductionShotPlaceholder({ node, reportFeedback }: { reportFeedback: (message: string) => void; node: GenerationCanvasNode }): JSX.Element | null {
  const { t } = useTranslation()
  const runId = productionRunIdOf(node)
  const state = useProductionShotState(node)
  // 续拍要拿到 projectId（Run 归属项目）。只在这个 Run 是 store 当前缓存的那个时取（避免读到别的项目/Run）。
  const projectId = useProductionCanvasLandingStore((store) => (runId && store.run?.runId === runId ? store.projectId : null))
  const stoppedReason = state?.stoppedReason
  const [busy, setBusy] = React.useState(false)
  const runResume = React.useCallback(() => {
    if (!projectId || !runId || busy) return
    setBusy(true)
    void resumeProductionBatch(projectId, runId, stoppedReason === 'budget' ? 'budget' : 'manual', reportFeedback).finally(() => setBusy(false))
  }, [busy, projectId, runId, stoppedReason, reportFeedback])

  if (!runId || state?.phase !== 'stopped' || node.result?.url) return null

  // 已停（预算触顶 / 用户急停）：warning 底（非 danger），一句人话 + 提额/继续入口。
  const message = stoppedReason === 'budget'
    ? t('generationCommon.production.canvasLanding.stoppedBudget')
    : t('generationCommon.production.canvasLanding.stoppedManual')
  const actionLabel = stoppedReason === 'budget'
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
      {/* 提额续拍 / 急停继续。data-* 用 active 值供走查；busy 期间禁重复点。 */}
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
