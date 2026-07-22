// 画布左下角导航竖列（navigation-stack）：小地图 + 缩放条 + 显隐开关，从 GenerationCanvas 抽出
// 以守住外壳 ≤800 行（R9）。容器负责定位（absolute left-4 bottom-3），minimap 改 relative 靠它定位。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconEyeOff, IconFocusCentered, IconLayoutGrid, IconMap, IconRotate } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { CanvasMinimap, MINIMAP_MIN_NODES } from './CanvasMinimap'
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
        <WorkbenchButton
          aria-label={t('generationCommon.navigation.fitView')}
          title={
            nodes.length === 0 ? t('generationCommon.navigation.emptyCanvas') : t('generationCommon.navigation.fitView')
          }
          disabled={nodes.length === 0}
          onClick={onFitView}
        >
          <IconFocusCentered size={15} stroke={1.8} aria-hidden="true" />
        </WorkbenchButton>
        <WorkbenchButton
          aria-label={t('generationCommon.navigation.resetView')}
          title={t('generationCommon.navigation.resetView')}
          onClick={onResetView}
        >
          <IconRotate size={15} stroke={1.8} aria-hidden="true" />
        </WorkbenchButton>
        <input
          className="w-[78px] accent-workbench-accent"
          type="range"
          min="20"
          max="300"
          value={zoomPercent}
          aria-label={t('generationCommon.navigation.zoomRatio')}
          onChange={(event) => onZoomTo(Number(event.target.value) / 100)}
        />
        {!readOnly ? (
          <WorkbenchButton
            aria-label={t('generationCommon.navigation.tidy')}
            title={t('generationCommon.navigation.tidyHint')}
            onClick={onTidy}
          >
            <IconLayoutGrid size={15} stroke={1.8} aria-hidden="true" />
          </WorkbenchButton>
        ) : null}
        <WorkbenchButton
          aria-label={
            showMinimap ? t('generationCommon.navigation.hideMinimap') : t('generationCommon.navigation.showMinimap')
          }
          title={
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
        </WorkbenchButton>
      </div>
    </div>
  )
}
