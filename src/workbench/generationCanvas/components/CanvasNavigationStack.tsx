// 画布左下角导航竖列（navigation-stack）：小地图 + 缩放条 + 显隐开关，从 GenerationCanvas 抽出
// 以守住外壳 ≤800 行（R9）。容器负责定位（absolute left-4 bottom-3），minimap 改 relative 靠它定位。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconEyeOff, IconFocusCentered, IconFrame, IconLayoutGrid, IconMap, IconRotate } from '@tabler/icons-react'
import { TooltipProvider } from '../../../design'
import { cn } from '../../../utils/cn'
import { CanvasMinimap, MINIMAP_MIN_NODES } from './CanvasMinimap'
import { CanvasControlsHelpPopover } from './CanvasControlsHelpPopover'
import { CanvasNavigationTooltipButton } from './CanvasNavigationTooltipButton'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

type CanvasNavigationStackProps = {
  readOnly: boolean
  nodes: GenerationCanvasNode[]
  selectedIds: Set<string>
  zoom: number
  zoomPercent: number
  offset: { x: number; y: number }
  stageSize: { width: number; height: number }
  minimapVisible: boolean
  onToggleMinimap: () => void
  onJumpToCanvasPoint: (point: { x: number; y: number }) => void
  onFitView: () => void
  onResetView: () => void
  onTidy: () => void
  onZoomTo: (nextZoom: number) => void
  /** 框工具就绪中（左下这簇里唯一有开关态的一颗）。 */
  frameToolArmed?: boolean
  onToggleFrameTool?: () => void
  batchPlanOverlay?: React.ReactNode
}

export function CanvasNavigationStack({
  readOnly,
  nodes,
  selectedIds,
  zoom,
  zoomPercent,
  offset,
  stageSize,
  minimapVisible,
  onToggleMinimap,
  onJumpToCanvasPoint,
  onFitView,
  onResetView,
  onTidy,
  onZoomTo,
  frameToolArmed = false,
  onToggleFrameTool,
  batchPlanOverlay,
}: CanvasNavigationStackProps): JSX.Element {
  const { t } = useTranslation()
  const hasMinimapContent = nodes.length >= MINIMAP_MIN_NODES
  const showMinimap = minimapVisible && hasMinimapContent
  const MinimapToggleIcon = showMinimap ? IconEyeOff : IconMap

  return (
    <div
      className={cn(
        'generation-canvas-v2__navigation-stack',
        'absolute left-4 bottom-3 z-[8] flex flex-col items-start gap-2 pointer-events-none',
      )}
      aria-label={t('generationCommon.navigation.aria')}
    >
      {showMinimap ? (
        <CanvasMinimap
          nodes={nodes}
          selectedIds={selectedIds}
          zoom={zoom}
          offset={offset}
          stageSize={stageSize}
          onJumpToCanvasPoint={onJumpToCanvasPoint}
        />
      ) : null}
      {batchPlanOverlay}
      <div
        className={cn(
          'generation-canvas-v2__zoom-bar',
          'inline-flex items-center gap-[2px] pointer-events-auto',
          'min-h-9 p-1 border border-workbench-border rounded-nomi',
          'bg-nomi-paper shadow-workbench-sm',
        )}
        aria-label={t('generationCommon.navigation.zoomControls')}
      >
        <TooltipProvider delayDuration={250} disableHoverableContent>
          <CanvasNavigationTooltipButton
            label={t('generationCommon.navigation.fitView')}
            tooltip={
              nodes.length === 0 ? t('generationCommon.navigation.emptyCanvas') : t('generationCommon.navigation.fitView')
            }
            disabled={nodes.length === 0}
            onClick={onFitView}
          >
            <IconFocusCentered size={15} stroke={1.8} aria-hidden="true" />
          </CanvasNavigationTooltipButton>
          <CanvasNavigationTooltipButton label={t('generationCommon.navigation.resetView')} onClick={onResetView}>
            <IconRotate size={15} stroke={1.8} aria-hidden="true" />
          </CanvasNavigationTooltipButton>
          <input
            className="w-[78px] accent-workbench-accent"
            type="range"
            min="20"
            max="300"
            value={zoomPercent}
            aria-label={t('generationCommon.navigation.zoomRatio')}
            onChange={(event) => onZoomTo(Number(event.target.value) / 100)}
          />
          {/*
            「框」和缩放/适配/整理同族：它们都在回答「你怎么看、怎么摆这块画布」，
            而不是「往画布上加什么」（那是加号那一族，见 canvasToolbarModel 的意图表）。
            这也是这簇里唯一一颗有开关态的按钮，所以给 aria-pressed。
          */}
          {!readOnly && onToggleFrameTool ? (
            <CanvasNavigationTooltipButton
              label={t('generationCommon.canvas.group.frameTool')}
              tooltip={frameToolArmed
                ? t('generationCommon.canvas.group.frameToolArmed')
                : t('generationCommon.canvas.group.frameToolHint')}
              aria-pressed={frameToolArmed}
              onClick={onToggleFrameTool}
            >
              <IconFrame size={15} stroke={1.8} aria-hidden="true" />
            </CanvasNavigationTooltipButton>
          ) : null}
          {!readOnly ? (
            <CanvasNavigationTooltipButton
              label={t('generationCommon.navigation.tidy')}
              tooltip={t('generationCommon.navigation.tidyHint')}
              onClick={onTidy}
            >
              <IconLayoutGrid size={15} stroke={1.8} aria-hidden="true" />
            </CanvasNavigationTooltipButton>
          ) : null}
          <CanvasNavigationTooltipButton
            label={
              showMinimap ? t('generationCommon.navigation.hideMinimap') : t('generationCommon.navigation.showMinimap')
            }
            tooltip={
              hasMinimapContent
                ? showMinimap
                  ? t('generationCommon.navigation.hideMinimap')
                  : t('generationCommon.navigation.showMinimap')
                : t('generationCommon.navigation.minimapThreshold', { count: MINIMAP_MIN_NODES })
            }
            aria-pressed={showMinimap}
            onClick={onToggleMinimap}
          >
            <MinimapToggleIcon size={15} stroke={1.8} aria-hidden="true" />
          </CanvasNavigationTooltipButton>
          <CanvasControlsHelpPopover />
        </TooltipProvider>
      </div>
    </div>
  )
}
