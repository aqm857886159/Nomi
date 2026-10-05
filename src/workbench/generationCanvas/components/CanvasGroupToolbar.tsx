import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import type { NodeGroup } from '../model/generationCanvasTypes'
import type { GroupArrangeMode } from '../model/groupArrange'
import { GROUP_COLOR_IDS, normalizeGroupColor, groupColorStyle, type GroupColorId } from '../model/groupColor'

export type CanvasGroupToolbarProps = {
  group: NodeGroup
  memberCount: number
  canGenerate: boolean
  canSendToTimeline: boolean
  canDownload: boolean
  onGenerate: () => void
  onSendToTimeline: () => void
  onDissolve: () => void
  onArrange: (mode: GroupArrangeMode) => void
  onColor: (color: GroupColorId) => void
  onDownload: () => void
  onClearSelection: () => void
}

export function CanvasGroupToolbar({
  group,
  memberCount,
  canGenerate,
  canSendToTimeline,
  canDownload,
  onGenerate,
  onSendToTimeline,
  onDissolve,
  onArrange,
  onColor,
  onDownload,
  onClearSelection,
}: CanvasGroupToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const [openMenu, setOpenMenu] = React.useState<'color' | 'arrange' | null>(null)
  return (
    <div
      className="generation-canvas-v2__group-toolbar absolute left-3 top-[-42px] z-[12] flex items-center gap-1 whitespace-nowrap rounded-workbench-control border border-workbench-border bg-workbench-surface-solid px-1.5 py-1 shadow-workbench-pop"
      data-group-toolbar="true"
      aria-label={t('generationCommon.canvas.group.toolbarAria', { name: group.name })}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="px-1.5 text-caption font-semibold text-workbench-ink" data-group-toolbar-count="true">
        {t('generationCommon.canvas.group.toolbarTitle', { count: memberCount })}
      </span>
      <span className="relative">
        <WorkbenchButton size="sm" className="h-7 px-2 text-caption" aria-expanded={openMenu === 'color'} onClick={() => setOpenMenu(openMenu === 'color' ? null : 'color')}>
          {t('generationCommon.canvas.group.toolbarColor')}
        </WorkbenchButton>
        {openMenu === 'color' ? (
          <div className="absolute left-0 top-full z-[13] mt-1 flex gap-1 rounded-workbench-control border border-workbench-border bg-workbench-surface-solid p-1.5 shadow-workbench-pop" role="menu" aria-label={t('generationCommon.canvas.group.toolbarColor')}>
            {GROUP_COLOR_IDS.map((color) => {
              const style = groupColorStyle(color)
              const label = t(`generationCommon.canvas.group.color${color[0].toUpperCase()}${color.slice(1)}` as 'generationCommon.canvas.group.colorOcean')
              return (
              <button
                key={color}
                type="button"
                className={cn('size-5 rounded-full border-2 border-white shadow-sm', normalizeGroupColor(group.color) === color && 'ring-2 ring-workbench-accent ring-offset-1')}
                style={{ backgroundColor: style.markerColor }}
                aria-label={label}
                title={label}
                onClick={() => { onColor(color); setOpenMenu(null) }}
              />
              )
            })}
          </div>
        ) : null}
      </span>
      <span className="relative">
        <WorkbenchButton size="sm" className="h-7 px-2 text-caption" aria-expanded={openMenu === 'arrange'} onClick={() => setOpenMenu(openMenu === 'arrange' ? null : 'arrange')}>
          {t('generationCommon.canvas.group.toolbarArrange')}
        </WorkbenchButton>
        {openMenu === 'arrange' ? (
          <div className="absolute left-0 top-full z-[13] mt-1 grid min-w-[112px] gap-0.5 rounded-workbench-control border border-workbench-border bg-workbench-surface-solid p-1 shadow-workbench-pop" role="menu" aria-label={t('generationCommon.canvas.group.toolbarArrange')}>
            {(['grid', 'horizontal', 'vertical'] as const).map((mode) => (
              <button key={mode} type="button" className="rounded px-2 py-1 text-left text-caption text-workbench-ink hover:bg-workbench-hover" onClick={() => { onArrange(mode); setOpenMenu(null) }}>
                {t(`generationCommon.canvas.group.toolbarArrange${mode[0].toUpperCase()}${mode.slice(1)}` as 'generationCommon.canvas.group.toolbarArrangeGrid')}
              </button>
            ))}
          </div>
        ) : null}
      </span>
      <WorkbenchButton size="sm" className="h-7 px-2 text-caption" disabled={!canGenerate} onClick={onGenerate}>{t('generationCommon.canvas.group.toolbarGenerate')}</WorkbenchButton>
      <WorkbenchButton size="sm" className="h-7 px-2 text-caption" disabled={!canSendToTimeline} onClick={onSendToTimeline}>{t('generationCommon.canvas.group.toolbarTimeline')}</WorkbenchButton>
      <WorkbenchButton size="sm" className="h-7 px-2 text-caption" onClick={onDissolve}>{t('generationCommon.canvas.group.toolbarDissolve')}</WorkbenchButton>
      <WorkbenchButton size="sm" className="h-7 px-2 text-caption" disabled={!canDownload} onClick={onDownload}>{t('generationCommon.canvas.group.toolbarDownload')}</WorkbenchButton>
      <WorkbenchButton size="sm" className="h-7 px-2 text-caption" aria-label={t('generationCommon.selection.clear')} onClick={onClearSelection}>{t('generationCommon.selection.clear')}</WorkbenchButton>
    </div>
  )
}
