import React from 'react'
import { IconBrush } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { NodeBodyHeader, EmptyStateLauncher } from '../render/CardCommon'
import WhiteboardModal from './WhiteboardModal'
import { readWhiteboardState } from './whiteboardState'

/**
 * 画板节点的 body —— 只画「毛笔启动器」，外壳(header/ring/把手/缩放/聚焦闪光)全由 BaseGenerationNode 提供，
 * 和角色卡/场景卡/音频条同一套机制（resolveRenderKind=whiteboard-card → 共享外壳的 card 分发块）。
 * 删了旧 WhiteboardCardNode 那 270 行平行外壳(双描边/无 header/重复把手)，根治「画板和别的节点不一致」。
 *
 * 「点击打开」做成显式按钮：外壳拖拽在 article 上 setPointerCapture(useNodeDragResize)，子元素收不到
 * pointerup，故不能靠「卡片点击+位移守卫」开 modal；按钮 onPointerDown stopPropagation 不触发拖拽，
 * 卡片其余区域照常可拖。
 */
function WhiteboardCardBodyImpl({ node, readOnly = false }: { node: GenerationCanvasNode; readOnly?: boolean }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)

  const handleOpen = React.useCallback(() => {
    if (readOnly) return
    selectNode(node.id)
    setOpen(true)
  }, [node.id, readOnly, selectNode])

  return (
    <div className={cn('flex h-full w-full flex-col bg-nomi-paper')}>
      {/* 标题走左上角，统一 NodeBodyHeader（和占位/镜头节点同款）。 */}
      <div className={cn('p-2.5 pointer-events-none')}>
        <NodeBodyHeader title={node.title || '画板'} />
      </div>
      {/* 中间只留启动器（用户拍板）；圆底图标 + 点击行为统一 EmptyStateLauncher(onActivate)。 */}
      <div className={cn('flex-1 min-h-0 flex flex-col items-center justify-center pb-3')}>
        <EmptyStateLauncher
          icon={<IconBrush size={24} stroke={1.55} />}
          hint="点击打开画板"
          activateAriaLabel="打开画板"
          onActivate={handleOpen}
        />
      </div>
      {open ? (
        <WhiteboardModal
          nodeId={node.id}
          sourceKind="whiteboard"
          nodeTitle={node.title || '画板'}
          initialState={readWhiteboardState(node)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

const WhiteboardCardBody = React.memo(WhiteboardCardBodyImpl)
WhiteboardCardBody.displayName = 'WhiteboardCardBody'
export default WhiteboardCardBody
