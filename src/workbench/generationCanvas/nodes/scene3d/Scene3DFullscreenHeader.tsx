// 3D 导演台顶部工具栏（IA 重排后 = 身份与出口：标题 ｜ 出片 · 重看引导 · 关闭）。
// 10→4 的去处（docs/plan/2026-07-20-scene3d-ia-redesign.md §4）：截图/播放/轨迹 toggle=重复入口删；
// 移动/旋转→视口左上悬浮 pill；速度→视口左下；接控→右栏随选中出现。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCube, IconHelp, IconUpload, IconX } from '@tabler/icons-react'

type Scene3DFullscreenHeaderProps = {
  nodeTitle: string
  onOpenExportPanel: () => void
  onReplayCoach: () => void
  onClose: () => void
}

export function Scene3DFullscreenHeader({
  nodeTitle,
  onOpenExportPanel,
  onReplayCoach,
  onClose,
}: Scene3DFullscreenHeaderProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <header className="relative z-[2] flex min-h-[52px] shrink-0 items-center gap-3 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-4 shadow-nomi-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <IconCube size={18} className="shrink-0 text-[var(--workbench-muted)]" />
        <div className="min-w-0 truncate text-body-sm font-medium text-[var(--workbench-ink)]">{nodeTitle}</div>
      </div>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* 出片主按钮（P0-1）：顶部工具栏最右，显眼的主色调 */}
        <button
          type="button"
          data-coach="export-button"
          onClick={onOpenExportPanel}
          title={t('scene3d.export.headerTitle')}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-3 text-caption font-medium text-[var(--nomi-paper)] transition-opacity hover:opacity-90"
        >
          <IconUpload size={15} />
          <span>{t('scene3d.export.title')}</span>
        </button>
        {/* P1：重看引导按钮 */}
        <button
          type="button"
          title={t('scene3d.export.replayCoach')}
          onClick={onReplayCoach}
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] text-[var(--workbench-muted)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--workbench-ink)]"
        >
          <IconHelp size={15} />
        </button>
        <button
          className="grid size-8 shrink-0 place-items-center rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
          type="button"
          title={t('scene3d.fullscreen.exitScene')}
          onClick={onClose}
        >
          <IconX size={16} />
        </button>
      </div>
    </header>
  )
}
