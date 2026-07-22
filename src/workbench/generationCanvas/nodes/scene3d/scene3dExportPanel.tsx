import React from 'react'
import { useTranslation } from 'react-i18next'

/**
 * 出片产物卡片（P0-4/P3-14 → 任务优先重构 2026-07-22）：渲染中 → 完成（带去向）。
 * 原「出片面板」（三产物一个入口）已删（P1）：三产物改由任务 CTA 直达——
 * 构图图=「使用这张构图」、动作=录 take、运镜=「生成参考视频」；首尾帧在整运镜区、
 * 视口截图在视图身份 chip 旁。状态由宿主 useScene3DExportActions 盯 take 节点推进。
 */
export function Scene3DExportingCard({ card, onGoCanvas, onReplayTake, onDismiss }: {
  card: import('./useScene3DFullscreenActions').Scene3DExportCard | null
  /** 回画布查看：关编辑器（宿主已排好 fit + 高亮新节点） */
  onGoCanvas: () => void
  /** 原位重播刚录的 take（不把用户赶回画布，审计 §6.3）——仅 video 完成态出现 */
  onReplayTake?: () => void
  onDismiss: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  if (!card) return null
  return (
    <div className="fixed bottom-6 right-6 z-[59] flex max-w-[480px] items-center gap-3 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--workbench-surface-solid)] px-4 py-3 shadow-workbench-pop">
      {card.phase === 'done' ? (
        <>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-caption font-medium text-[var(--workbench-ink)]">
              {card.kind === 'screenshot'
                ? t('scene3d.export.screenshotDone')
                : card.kind === 'keyframes'
                  ? ((card.count ?? 0) >= 2 ? t('scene3d.export.keyframesDone') : t('scene3d.export.keyframesPartial'))
                  : t('scene3d.export.referenceVideoDone')}
            </span>
            <span className="text-micro text-[var(--workbench-muted)]">
              {card.kind === 'screenshot'
                ? t('scene3d.export.screenshotDestination')
                : card.kind === 'keyframes'
                  ? t('scene3d.export.keyframesDestination')
                  : card.fedDownstream ? t('scene3d.export.downstreamDestination') : t('scene3d.export.archiveDestination')}
            </span>
          </div>
          {card.kind === 'video' && onReplayTake ? (
            <button
              type="button"
              onClick={onReplayTake}
              className="shrink-0 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-2.5 py-1.5 text-caption text-[var(--workbench-ink)] hover:bg-[var(--nomi-ink-05)]"
            >
              {t('scene3d.exportCard.replayInPlace')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onGoCanvas}
            className="shrink-0 rounded-nomi-sm bg-[var(--nomi-ink)] px-2.5 py-1.5 text-caption font-medium text-[var(--nomi-paper)] transition-opacity hover:opacity-90"
          >
            {t('scene3d.export.goCanvas')}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-caption text-[var(--workbench-muted)] hover:text-[var(--workbench-ink)]"
          >
            {t('scene3d.export.acknowledge')}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="size-2 animate-pulse rounded-full bg-[var(--nomi-accent)]" />
            <span className="text-caption font-medium text-[var(--workbench-ink)]">
              {card.phase === 'slow' ? t('scene3d.export.renderingSlow') : t('scene3d.export.generating')}
            </span>
          </div>
          <span className="text-caption text-[var(--workbench-muted)]">
            {card.phase === 'slow' ? t('scene3d.export.renderingSlowHint') : t('scene3d.export.generatingHint')}
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="ml-2 text-caption text-[var(--workbench-muted)] hover:text-[var(--workbench-ink)]"
          >
            {t('scene3d.export.acknowledge')}
          </button>
        </>
      )}
    </div>
  )
}
