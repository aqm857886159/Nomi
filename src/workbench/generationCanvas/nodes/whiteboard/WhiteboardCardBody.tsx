import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconBrush } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { CardActivationButton, EmptyStateLauncher } from '../render/CardCommon'
import { DeferredNodeImage, DeferredNodeMediaPlaceholder } from '../DeferredNodeMedia'
import { useDeferredNodeMediaVisibility, type DeferredNodeMediaState } from '../deferredNodeMediaQueue'
import { canvasImageSourceOf } from '../canvasImageSource'
import { openWhiteboard } from './whiteboardSession'
import { resolveNodeVisualSize } from '../nodeSizing'
import { readWhiteboardState } from './whiteboardState'
import { whiteboardHasVisibleContent } from './whiteboardRasterState'
import { useWhiteboardStatePreview } from './whiteboardStatePreview'

/**
 * 老画板的预览还没画好时，占位和排队中的图一样静止、不扫光：扫光只给拿到加载槽位的媒体
 * （mediaPlaceholderShimmer.test.ts）。预览一次只画一张，20 块老画板不让 20 张卡同时动画。
 */
const DRAWING_PREVIEW_PLACEHOLDER_STATE: DeferredNodeMediaState = 'queued'

/**
 * 画板节点的 body —— 有画出来的结果就显示那张图（和角色卡一样走画布预览），没有才画「毛笔启动器」
 * （用户 2026-10-22 拍板，推翻清单 O40「完成只保存 state」：画完按完成，节点上要看得见画的东西）。
 * 只存了 state、没有结果的老画板（0.23.0 和 10-22 之前画的）有可见内容时，显示按 state 离屏现画的预览
 * （whiteboardStatePreview，只在内存里，不写 store、不落盘；2026-10-27）。「有没有内容」和「完成」读同一个 whiteboardHasVisibleContent。
 * 外壳(header/ring/把手/缩放/聚焦闪光)全由 BaseGenerationNode 提供，
 * 和角色卡/场景卡/音频条同一套机制（resolveRenderKind=whiteboard-card → 共享外壳的 card 分发块）。
 * 删了旧 WhiteboardCardNode 那 270 行平行外壳(双描边/无 header/重复把手)，根治「画板和别的节点不一致」。
 *
 * 「点击打开」做成显式按钮：外壳拖拽在 article 上 setPointerCapture(useNodeDragResize)，子元素收不到
 * pointerup，故不能靠「卡片点击+位移守卫」开启原地会话；按钮 onPointerDown stopPropagation 不触发拖拽，
 * 卡片其余区域照常可拖。
 */
function WhiteboardCardBodyImpl({
  node,
  readOnly = false,
}: {
  node: GenerationCanvasNode
  readOnly?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)

  const handleOpen = React.useCallback(() => {
    if (readOnly) return
    selectNode(node.id)
    void openWhiteboard(node.id)
  }, [node.id, readOnly, selectNode])

  // 卡片图只挂画布预览（原图只经被计数的缺失分支，见 canvasImageSource）。
  const imageSource = canvasImageSourceOf(node.result)
  const savedState = node.meta?.whiteboardState
  const drawnState = React.useMemo(() => {
    if (imageSource) return null
    const state = readWhiteboardState({ meta: { whiteboardState: savedState } })
    return state && whiteboardHasVisibleContent(state) ? state : null
  }, [imageSource, savedState])
  const viewport = useDeferredNodeMediaVisibility()
  const drawn = useWhiteboardStatePreview(drawnState, viewport.visible)
  const pictureSource = imageSource ?? (drawn.status === 'ready' ? drawn.src : null)
  if (imageSource || (drawnState && drawn.status !== 'failed')) {
    return (
      <div ref={drawnState ? viewport.ref : undefined} className={cn('h-full w-full bg-nomi-paper')}>
        <CardActivationButton
          testId="whiteboard-open-preview"
          ariaLabel={t('generationCommon.whiteboard.openAria')}
          title={t('generationCommon.nodeEmpty.whiteboard.action')}
          onActivate={handleOpen}
          className="relative overflow-hidden p-0"
        >
          {pictureSource ? (
            <DeferredNodeImage src={pictureSource} alt={node.title || ''} className="h-full w-full object-contain object-center select-none pointer-events-none" />
          ) : (
            <DeferredNodeMediaPlaceholder state={DRAWING_PREVIEW_PLACEHOLDER_STATE} />
          )}
        </CardActivationButton>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full w-full flex-col bg-nomi-paper')}>
      {/* 中间只留启动器（用户拍板）；圆底图标 + 点击行为统一 EmptyStateLauncher(onActivate)。 */}
      <div className={cn('flex-1 min-h-0 flex flex-col items-center justify-center')}>
        <EmptyStateLauncher
          icon={<IconBrush size={24} stroke={1.55} />}
          label={t('generationCommon.nodeEmpty.whiteboard.action')}
          hint={t('generationCommon.nodeEmpty.whiteboard.description')}
          testId="whiteboard-empty-action"
          height={resolveNodeVisualSize(node).height}
          activateAriaLabel={t('generationCommon.whiteboard.openAria')}
          onActivate={handleOpen}
        />
      </div>

    </div>
  )
}

const WhiteboardCardBody = React.memo(WhiteboardCardBodyImpl)
WhiteboardCardBody.displayName = 'WhiteboardCardBody'
export default WhiteboardCardBody
