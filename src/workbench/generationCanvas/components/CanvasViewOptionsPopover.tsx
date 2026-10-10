// 画布左下缩放簇里「⋯」点开的那一块：拍板稿 Main 板只画了「⛶ | − 100% + | ⋯」，其余视图控件原样收进这里，
// 一个不丢（改设计不能丢功能）：重置视图 · 画框 · 整理画布 · 小地图开关 · 画布操作帮助 · 缩放滑块。
// 内容有滑块、有开关态、有一个自带浮层的帮助行，是「要读要拖的内容」不是一列动作，所以走 AnchoredPopover，不走 WorkbenchMenu（见 AnchoredPopover 的判据表）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconEyeOff, IconFrame, IconLayoutGrid, IconMap, IconRotate } from '@tabler/icons-react'
import { AnchoredPopover, Tooltip, TooltipContent, TooltipTrigger } from '../../../design'
import { cn } from '../../../utils/cn'
import { CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM } from '../model/canvasFitBounds'
import { MINIMAP_MIN_NODES } from './CanvasMinimap'
import { CanvasControlsHelpPopover } from './CanvasControlsHelpPopover'

const ROW_CLASS = cn(
  'flex h-8 w-full items-center gap-2 rounded-nomi-sm border-0 bg-transparent px-2 text-left font-[inherit] text-body-sm text-nomi-ink-80 cursor-pointer',
  'hover:bg-nomi-ink-05 active:bg-nomi-ink-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-nomi-accent',
  'aria-pressed:bg-nomi-ink-05 aria-pressed:text-nomi-ink disabled:cursor-not-allowed disabled:opacity-40',
  '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-nomi-ink-60',
)

/** 行上的说明走设计系统的 Tooltip（不用原生 title——导航簇一律是样式化 tooltip，见 canvasControlsStructure 的钉子）。 */
function RowTip({ tip, children }: { tip: string; children: JSX.Element }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{tip}</TooltipContent>
    </Tooltip>
  )
}

type Props = {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  readOnly: boolean
  zoomPercent: number
  nodeCount: number
  minimapShown: boolean
  frameToolArmed: boolean
  onResetView: () => void
  onTidy: () => void
  onToggleMinimap: () => void
  onToggleFrameTool?: () => void
  onZoomTo: (nextZoom: number) => void
}

export function CanvasViewOptionsPopover({
  anchorRef, onClose, readOnly, zoomPercent, nodeCount, minimapShown, frameToolArmed,
  onResetView, onTidy, onToggleMinimap, onToggleFrameTool, onZoomTo,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const hasMinimapContent = nodeCount >= MINIMAP_MIN_NODES
  const MinimapIcon = minimapShown ? IconEyeOff : IconMap
  const minimapLabel = minimapShown ? t('generationCommon.navigation.hideMinimap') : t('generationCommon.navigation.showMinimap')
  return (
    <AnchoredPopover anchorRef={anchorRef} align="start" side="top" gap={8} onClose={onClose}>
      <div
        className="grid w-[216px] gap-0.5 rounded-nomi border border-workbench-border bg-nomi-paper p-1.5 shadow-workbench-pop"
        role="group"
        aria-label={t('generationCommon.navigation.viewOptions')}
        data-canvas-view-options="true"
      >
        <button type="button" className={ROW_CLASS} data-view-option="reset-view" aria-label={t('generationCommon.navigation.resetView')} onClick={onResetView}>
          <IconRotate size={16} stroke={1.5} aria-hidden="true" />
          <span>{t('generationCommon.navigation.resetView')}</span>
        </button>
        {!readOnly && onToggleFrameTool ? (
          <RowTip tip={frameToolArmed ? t('generationCommon.canvas.group.frameToolArmed') : t('generationCommon.canvas.group.frameToolHint')}>
            <button
              type="button"
              className={ROW_CLASS}
              data-view-option="frame-tool"
              aria-label={t('generationCommon.canvas.group.frameTool')}
              aria-pressed={frameToolArmed}
              onClick={onToggleFrameTool}
            >
              <IconFrame size={16} stroke={1.5} aria-hidden="true" />
              <span>{t('generationCommon.canvas.group.frameTool')}</span>
            </button>
          </RowTip>
        ) : null}
        {!readOnly ? (
          <RowTip tip={t('generationCommon.navigation.tidyHint')}>
            <button type="button" className={ROW_CLASS} data-view-option="tidy" aria-label={t('generationCommon.navigation.tidy')} onClick={onTidy}>
              <IconLayoutGrid size={16} stroke={1.5} aria-hidden="true" />
              <span>{t('generationCommon.navigation.tidy')}</span>
            </button>
          </RowTip>
        ) : null}
        <RowTip tip={hasMinimapContent ? minimapLabel : t('generationCommon.navigation.minimapThreshold', { count: MINIMAP_MIN_NODES })}>
          <button
            type="button"
            className={ROW_CLASS}
            data-view-option="minimap"
            aria-label={minimapLabel}
            aria-pressed={minimapShown}
            onClick={onToggleMinimap}
          >
            <MinimapIcon size={16} stroke={1.5} aria-hidden="true" />
            <span>{minimapLabel}</span>
          </button>
        </RowTip>
        <div data-view-option="controls-help"><CanvasControlsHelpPopover asRow rowClassName={ROW_CLASS} /></div>
        <label className="mt-1 grid gap-1 px-2 pb-1 pt-1.5 text-micro text-nomi-ink-60">
          <span>{t('generationCommon.navigation.zoomRatio')}</span>
          <input
            className="w-full accent-workbench-accent"
            type="range"
            min={CANVAS_MIN_ZOOM * 100}
            max={CANVAS_MAX_ZOOM * 100}
            value={zoomPercent}
            aria-label={t('generationCommon.navigation.zoomRatio')}
            onChange={(event) => onZoomTo(Number(event.target.value) / 100)}
          />
        </label>
      </div>
    </AnchoredPopover>
  )
}
