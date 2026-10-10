import { CANVAS_CHROME_LAYERS } from './canvasChromeLayers'
import { useCanvasChromeOcclusion } from './useCanvasChromeOcclusion'
import { CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM } from '../model/canvasFitBounds'
// 画布左下角导航竖列（navigation-stack）：小地图 + 紧凑缩放条（⛶ | − 100% + | ⋯），从 GenerationCanvas 抽出
// 以守住外壳 ≤800 行（R9）。容器负责定位（absolute left-4 bottom-3），minimap 改 relative 靠它定位。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconDots, IconFocusCentered, IconMinus, IconPlus } from '@tabler/icons-react'
import { TooltipProvider } from '../../../design'
import { cn } from '../../../utils/cn'
import { CanvasMinimap, MINIMAP_MIN_NODES } from './CanvasMinimap'
import { CanvasViewOptionsPopover } from './CanvasViewOptionsPopover'
import { CanvasNavigationTooltipButton } from './CanvasNavigationTooltipButton'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

/** 每按一下 − / ＋ 缩放的倍率（乘性，低倍时步子小、高倍时步子大）。 */
const ZOOM_STEP = 1.25
function stepZoom(percent: number, direction: 1 | -1): number {
  const next = direction > 0 ? percent * ZOOM_STEP : percent / ZOOM_STEP
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, next / 100))
}

const BAR_BUTTON_CLASS = cn(
  'grid size-8 min-h-8 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 text-nomi-ink-60',
  'transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink active:bg-nomi-ink-10',
)

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
  const [viewOptionsOpen, setViewOptionsOpen] = React.useState(false)
  const moreAnchorRef = React.useRef<HTMLSpanElement>(null)
  const dockRef = React.useRef<HTMLDivElement>(null)
  useCanvasChromeOcclusion(dockRef)

  return (
    <div
      ref={dockRef}
      style={{ zIndex: CANVAS_CHROME_LAYERS.chromeDock }}
      className={cn(
        'generation-canvas-v2__navigation-stack',
        'absolute left-4 bottom-4 flex flex-col items-start gap-2 pointer-events-none',
      )}
      // 常驻底部：选择浮条得让开这一块（量法见 reactFlow/useCanvasBottomDockRects.ts）。
      data-canvas-bottom-dock="true"
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
          // 拍板稿 Main 板：「⛶ | − 100% + | ⋯」一条紧凑的浮条，高 36。其余视图控件收进 ⋯（CanvasViewOptionsPopover）。
          'inline-flex h-9 items-center gap-0.5 pointer-events-auto p-0.5',
          'border border-workbench-border rounded-nomi',
          'bg-nomi-paper shadow-workbench-sm',
        )}
        aria-label={t('generationCommon.navigation.zoomControls')}
      >
        <TooltipProvider delayDuration={250} disableHoverableContent>
          <CanvasNavigationTooltipButton
            className={BAR_BUTTON_CLASS}
            label={t('generationCommon.navigation.fitView')}
            tooltip={
              nodes.length === 0 ? t('generationCommon.navigation.emptyCanvas') : t('generationCommon.navigation.fitView')
            }
            disabled={nodes.length === 0}
            onClick={onFitView}
          >
            <IconFocusCentered size={18} stroke={1.5} aria-hidden="true" />
          </CanvasNavigationTooltipButton>
          <span className="mx-1 h-[18px] w-px shrink-0 bg-nomi-line" aria-hidden="true" />
          <CanvasNavigationTooltipButton className={BAR_BUTTON_CLASS} label={t('generationCommon.navigation.zoomOut')} disabled={zoomPercent <= CANVAS_MIN_ZOOM * 100} onClick={() => onZoomTo(stepZoom(zoomPercent, -1))}>
            <IconMinus size={16} stroke={1.5} aria-hidden="true" />
          </CanvasNavigationTooltipButton>
          <span className="w-11 text-center text-caption tabular-nums text-nomi-ink-80" data-canvas-zoom-percent aria-live="off" aria-label={t('generationCommon.navigation.zoomRatio')}>{Math.round(zoomPercent)}%</span>
          <CanvasNavigationTooltipButton className={BAR_BUTTON_CLASS} label={t('generationCommon.navigation.zoomIn')} disabled={zoomPercent >= CANVAS_MAX_ZOOM * 100} onClick={() => onZoomTo(stepZoom(zoomPercent, 1))}>
            <IconPlus size={16} stroke={1.5} aria-hidden="true" />
          </CanvasNavigationTooltipButton>
          <span className="mx-1 h-[18px] w-px shrink-0 bg-nomi-line" aria-hidden="true" />
          <span ref={moreAnchorRef} className="inline-flex">
            <CanvasNavigationTooltipButton
              className={cn(BAR_BUTTON_CLASS, viewOptionsOpen && 'bg-nomi-ink-10 text-nomi-ink')}
              label={t('generationCommon.navigation.viewOptions')}
              aria-haspopup="dialog"
              aria-expanded={viewOptionsOpen}
              onClick={() => setViewOptionsOpen((open) => !open)}
            >
              <IconDots size={18} stroke={1.5} aria-hidden="true" />
            </CanvasNavigationTooltipButton>
          </span>
        {viewOptionsOpen ? (
          <CanvasViewOptionsPopover
            anchorRef={moreAnchorRef}
            onClose={() => setViewOptionsOpen(false)}
            readOnly={readOnly}
            zoomPercent={zoomPercent}
            nodeCount={nodes.length}
            minimapShown={showMinimap}
            frameToolArmed={frameToolArmed}
            onResetView={onResetView}
            onTidy={onTidy}
            onToggleMinimap={onToggleMinimap}
            onToggleFrameTool={onToggleFrameTool}
            onZoomTo={onZoomTo}
          />
        ) : null}
        </TooltipProvider>
      </div>
    </div>
  )
}
