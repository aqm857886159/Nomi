// 任务优先视口覆盖层（从 Scene3DFullscreen 抽出，防巨壳 R9）：主视图身份 chip +
// 视口截图 + 全局状态句 + 录制倒计时遮罩。审计 §6.2：任意截图都能说出
// 「现在控制谁 / 看的是不是最终画面」；取景态顶部横幅已被身份 chip 取代（P1）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCamera } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'

export function Scene3DTaskOverlays({
  viewIdentity,
  statusSentence,
  recordCountdown,
  onToggleOutputView,
  onSnapshotViewport,
}: {
  viewIdentity: { label: string; isOutput: boolean }
  statusSentence: string
  recordCountdown: number | null
  onToggleOutputView: () => void
  onSnapshotViewport: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <div className="absolute left-4 top-[60px] z-[8] flex items-center gap-1.5" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onToggleOutputView}
          title={viewIdentity.isOutput ? t('scene3d.taskFlow.backToWorkView') : t('scene3d.taskFlow.enterCameraFraming')}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-pill border px-2.5 text-caption shadow-nomi-sm transition-colors',
            viewIdentity.isOutput
              ? 'border-transparent bg-[var(--nomi-ink)] font-medium text-[var(--nomi-paper)]'
              : 'border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-[var(--nomi-ink-60)] hover:text-[var(--nomi-ink)]',
          )}
        >
          {viewIdentity.label}
        </button>
        {!viewIdentity.isOutput ? (
          <button
            type="button"
            title={t('scene3d.taskFlow.viewportSnapshot')}
            onClick={onSnapshotViewport}
            className="grid size-7 place-items-center rounded-pill border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-[var(--nomi-ink-60)] shadow-nomi-sm hover:text-[var(--nomi-ink)]"
          >
            <IconCamera size={14} />
          </button>
        ) : null}
      </div>
      <div
        className="absolute bottom-5 left-4 z-[7] flex max-w-[46%] items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-nomi-paper/95 px-3 py-1.5 shadow-nomi-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="min-w-0 truncate text-caption font-medium text-[var(--nomi-ink)]">{statusSentence}</span>
        <button
          type="button"
          className="shrink-0 text-caption text-[var(--nomi-accent)] hover:opacity-80"
          onClick={onToggleOutputView}
        >
          {viewIdentity.isOutput ? t('scene3d.taskFlow.backToWorkViewShort') : t('scene3d.taskFlow.previewFinal')}
        </button>
      </div>
      {recordCountdown !== null ? (
        <div className="absolute inset-0 z-[9] grid place-items-center bg-[var(--nomi-scrim)]">
          <div className="flex flex-col items-center gap-2">
            <span className="text-display font-medium leading-none text-[var(--nomi-paper)]">{recordCountdown}</span>
            <span className="text-caption text-[var(--nomi-paper)]/80">{t('scene3d.taskFlow.countdownHint')}</span>
          </div>
        </div>
      ) : null}
    </>
  )
}
