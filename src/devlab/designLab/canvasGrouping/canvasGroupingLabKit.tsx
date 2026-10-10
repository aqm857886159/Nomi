// Design Lab · 编组与临时多选的真实组件取景台。
//
// 这格故意不重画节点和工具条：卡片用 BaseGenerationNode，框用 GroupFrame，
// 编组工具条用 CanvasGroupToolbar，临时选中工具条用 SelectionToolbarFrame +
// NodeFloatingToolbar 的原子。状态数据是夹具，外观和动作组件来自生产代码。
import React, { type JSX } from 'react'
import { IconCards, IconFolderPlus, IconRoute, IconStack2, IconX } from '@tabler/icons-react'
import BaseGenerationNode from '../../../workbench/generationCanvas/nodes/BaseGenerationNode'
import GroupFrame, { type CanvasFrameInteraction, type CanvasGroupBox } from '../../../workbench/generationCanvas/components/GroupFrame'
import { CanvasGroupToolbar } from '../../../workbench/generationCanvas/components/CanvasGroupToolbar'
import { SelectionToolbarFrame } from '../../../workbench/generationCanvas/components/SelectionToolbarFrame'
import { ToolbarButton, ToolbarDivider, ToolbarIconButton, TOOLBAR_ICON } from '../../../workbench/generationCanvas/nodes/NodeFloatingToolbar'
import { getCanvasGroupBoxes } from '../../../workbench/generationCanvas/components/generationCanvasGeometry'
import { useGenerationCanvasStore } from '../../../workbench/generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../../../workbench/workbenchStore'
import type { GenerationCanvasNode, NodeGroup } from '../../../workbench/generationCanvas/model/generationCanvasTypes'
import type { GroupArrangeMode } from '../../../workbench/generationCanvas/model/groupArrange'
import type { GroupColorId } from '../../../workbench/generationCanvas/model/groupColor'
import { cn } from '../../../utils/cn'

export const CANVAS_GROUPING_CELL_WIDTH = 1060
export const CANVAS_GROUPING_CELL_HEIGHT = 690

const GROUP_ID = 'design-lab-grouping-group'
const NODE_IDS = ['design-lab-grouping-image-a', 'design-lab-grouping-video', 'design-lab-grouping-image-b'] as const
const FRAME_BOUNDS = { x: 36, y: 108, w: 976, h: 500 }

const NOOP = (): void => {}

function demoNode(id: string, kind: 'image' | 'video', title: string, position: { x: number; y: number }, mediaUrl: string): GenerationCanvasNode {
  return {
    id,
    kind,
    categoryId: 'shots',
    title,
    position,
    size: { width: 280, height: 190 },
    status: 'success',
    prompt: kind === 'video' ? '缓慢推近，保持主角和场景一致' : '沙漠公路上的蓝色跑车，日光，写实',
    meta: {
      modelKey: kind === 'video' ? 'seedance-2.5' : 'flux-1.1-pro',
      modelVendor: kind === 'video' ? 'apimart' : 'replicate',
      imageWidth: 1280,
      imageHeight: 720,
    },
    result: {
      id: `${id}-result`,
      // The design lab uses the same rendered media surface for both node kinds so the
      // interaction hierarchy remains inspectable even when the video decoder is idle.
      // The node kind still stays `video`, which keeps the real node chrome and labels.
      type: 'image',
      url: mediaUrl,
      thumbnailUrl: mediaUrl,
      createdAt: 1,
    },
  }
}

function demoGroup(nodeIds: readonly string[]): NodeGroup {
  return {
    id: GROUP_ID,
    name: '车辆镜头',
    description: '已配置模型与参数',
    categoryId: 'shots',
    nodeIds: [...nodeIds],
    frameBounds: FRAME_BOUNDS,
    createdAt: 1,
    updatedAt: 1,
  }
}

function seedGroupingFixture(): void {
  const image = demoNode(NODE_IDS[0], 'image', '首帧 · 海边公路', { x: 76, y: 178 }, '/prompt-media/expressions/builtin-expr-joy-1.webp')
  const video = demoNode(NODE_IDS[1], 'video', '视频 · 推近', { x: 388, y: 178 }, '/prompt-media/expressions/builtin-expr-surprise-1.webp')
  const secondImage = demoNode(NODE_IDS[2], 'image', '参考 · 沙漠公路', { x: 700, y: 178 }, '/prompt-media/expressions/builtin-expr-fear-1.webp')
  useWorkbenchStore.setState({ activeCategoryId: 'shots' })
  useGenerationCanvasStore.setState({
    isReady: true,
    nodes: [image, video, secondImage],
    edges: [],
    groups: [],
    selectedNodeIds: [...NODE_IDS],
  })
}

function DemoSelectionToolbar({ onGroup, onClear }: { onGroup: () => void; onClear: () => void }): JSX.Element {
  const iconProps = { size: TOOLBAR_ICON.size, stroke: TOOLBAR_ICON.stroke } as const
  return (
    <SelectionToolbarFrame
      className="absolute left-1/2 top-8 z-[12] inline-flex min-h-9 w-max max-w-[calc(100%-32px)] flex-wrap justify-center gap-1 overflow-visible rounded-nomi border-nomi-line bg-nomi-paper px-1.5 py-1 shadow-nomi-md"
      transform="translateX(-50%)"
      ariaLabel="临时多选动作"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="inline-flex min-h-8 items-center gap-1.5 px-2 text-body-sm font-medium text-nomi-ink">
        <IconStack2 {...iconProps} aria-hidden="true" />
        <span>已选节点</span>
        <span className="tabular-nums text-nomi-ink-60">· 3</span>
      </span>
      <ToolbarDivider />
      <ToolbarButton icon={<IconFolderPlus {...iconProps} />} label="编组" title="创建编组" ariaLabel="创建编组" accent onClick={onGroup} />
      <ToolbarButton icon={<IconCards {...iconProps} />} label="总览图" title="生成总览图（3 张）" ariaLabel="生成总览图（3 张）" onClick={NOOP} />
      <ToolbarButton icon={<IconRoute {...iconProps} />} label="存流程" title="保存为流程" ariaLabel="保存为流程" onClick={NOOP} />
      <ToolbarIconButton icon={<IconX {...iconProps} />} title="清除选择" ariaLabel="清除选择" onClick={onClear} />
    </SelectionToolbarFrame>
  )
}

export function CanvasGroupingStage(): JSX.Element {
  const nodes = useGenerationCanvasStore((state) => state.nodes.filter((node) => NODE_IDS.includes(node.id as (typeof NODE_IDS)[number])))
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const [grouped, setGrouped] = React.useState(false)
  const [group, setGroup] = React.useState<NodeGroup>(() => demoGroup(NODE_IDS))
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null)
  const [canvasOffset, setCanvasOffset] = React.useState({ x: 0, y: 0 })
  const [dragState, setDragState] = React.useState<{ pointerId: number; startX: number; startY: number; offset: { x: number; y: number } } | null>(null)
  const [status, setStatus] = React.useState('临时多选：虚线只表示这一次选择，不会改变节点归属。')

  React.useLayoutEffect(() => {
    seedGroupingFixture()
    return () => {
      useGenerationCanvasStore.setState({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
    }
  }, [])

  React.useEffect(() => {
    if (!dragState) return undefined
    const move = (event: PointerEvent) => {
      setCanvasOffset({
        x: dragState.offset.x + event.clientX - dragState.startX,
        y: dragState.offset.y + event.clientY - dragState.startY,
      })
    }
    const up = () => setDragState(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragState])

  const boxes = React.useMemo<CanvasGroupBox[]>(
    () => grouped ? getCanvasGroupBoxes([group], nodes) : [],
    [group, grouped, nodes],
  )
  const box = boxes[0]

  const createGroup = () => {
    setGrouped(true)
    setSelectedGroupId(GROUP_ID)
    setGroup(demoGroup(NODE_IDS))
    useGenerationCanvasStore.setState({ groups: [demoGroup(NODE_IDS)], selectedNodeIds: [] })
    setStatus('已编组：实线框是持久边界。点击卡片只操作单一节点，点击框内空白拖动整组。')
  }

  const dissolveGroup = () => {
    setGrouped(false)
    setSelectedGroupId(null)
    setCanvasOffset({ x: 0, y: 0 })
    useGenerationCanvasStore.getState().selectNodes(NODE_IDS)
    useGenerationCanvasStore.setState({ groups: [] })
    setStatus('已解组：节点回到临时多选，虚线只表示当前选择。')
  }

  const handleGroupPointerDown = (event: React.PointerEvent<HTMLDivElement>, groupId: string) => {
    setSelectedGroupId(groupId)
    useGenerationCanvasStore.setState({ selectedNodeIds: [] })
    setStatus('整组拖动中：你抓住的是框内空白区域。')
    setDragState({ pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offset: canvasOffset })
  }

  const frameInteraction: CanvasFrameInteraction = {
    membershipPreview: null,
    editingGroupId: null,
    selectedGroupId,
    onEditingChange: NOOP,
    onRename: NOOP,
    onDescribe: NOOP,
    onOpenMenu: () => setStatus('更多操作保留在现有框菜单中。'),
  }

  const arrange = (mode: GroupArrangeMode) => {
    const next = mode === 'horizontal'
      ? [{ x: 76, y: 178 }, { x: 388, y: 178 }, { x: 700, y: 178 }]
      : mode === 'vertical'
        ? [{ x: 388, y: 142 }, { x: 388, y: 344 }, { x: 388, y: 546 }]
        : [{ x: 218, y: 142 }, { x: 530, y: 142 }, { x: 374, y: 344 }]
    useGenerationCanvasStore.getState().moveNodes(NODE_IDS.map((nodeId, index) => ({ nodeId, position: next[index] })), { history: false })
    setStatus(`已排列：${mode === 'grid' ? '网格' : mode === 'horizontal' ? '水平' : '垂直'}。`)
  }

  return (
    <div
      className="relative overflow-hidden rounded-nomi-lg border border-nomi-line bg-[var(--workbench-surface)]"
      style={{ width: CANVAS_GROUPING_CELL_WIDTH, height: CANVAS_GROUPING_CELL_HEIGHT }}
      data-design-lab-stage="canvas-grouping"
      data-grouping-mode={grouped ? 'group' : 'selection'}
    >
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: 'radial-gradient(circle, var(--nomi-ink-20) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
      <div className="absolute left-5 top-4 z-[20] inline-flex items-center gap-2 text-caption text-nomi-ink-60">
        <span className="rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-1 font-medium text-nomi-ink">组件实拍</span>
        <span>{grouped ? '已编组 · persistent scope' : '临时多选 · transient selection'}</span>
      </div>
      <div className="relative h-full w-full" style={{ transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px)` }}>
        {grouped && box ? (
          <>
            <GroupFrame box={box} onPointerDown={handleGroupPointerDown} frame={frameInteraction} />
            <div className="pointer-events-none absolute" style={{ left: box.left, top: box.top, width: box.width }}>
              <div className="pointer-events-auto">
                  <CanvasGroupToolbar
                    group={group}
                    canvasZoom={1}
                    placement={{ side: 'above', offset: 38 }}
                    horizontal={{ frameLeft: 36, frameWidth: 976, offsetX: 0, stageWidth: CANVAS_GROUPING_CELL_WIDTH }}
                    memberCount={NODE_IDS.length}
                    canGenerate
                    canSendToTimeline
                    canDownload
                    onGenerate={() => setStatus('整组执行：每个节点使用自己已配置的模型与参数。')}
                    onSendToTimeline={() => setStatus('已发送到时间线。')}
                    onDissolve={dissolveGroup}
                    onArrange={arrange}
                    onColor={(color: GroupColorId) => {
                      setGroup((current) => {
                        const { colorToken: _previous, ...rest } = current
                        return color === 'neutral' ? rest : { ...rest, colorToken: color }
                      })
                      setStatus(`编组颜色已切换为 ${color}。`)
                    }}
                    onDownload={() => setStatus('下载编组结果。')}
                    onOpenMenu={() => setStatus('打开框菜单。')}
                  />
              </div>
            </div>
          </>
        ) : null}
        {nodes.map((node) => {
          return (
            <div key={node.id} className="absolute inset-0">
              <BaseGenerationNode node={node} selected={selectedNodeIds.includes(node.id)} readOnly />
            </div>
          )
        })}
        {!grouped && selectedNodeIds.length > 1 ? <DemoSelectionToolbar onGroup={createGroup} onClear={() => { useGenerationCanvasStore.getState().clearSelection(); setStatus('选择已清除。') }} /> : null}
      </div>
      <div className="absolute inset-x-5 bottom-4 z-[20] flex items-center justify-between gap-3 rounded-nomi border border-nomi-line bg-nomi-paper px-3 py-2 shadow-nomi-sm">
        <span className="min-w-0 truncate text-caption text-nomi-ink-60" role="status">{status}</span>
        {grouped ? <button type="button" className="shrink-0 text-caption font-medium text-nomi-accent hover:underline" onClick={dissolveGroup}>回到临时多选</button> : null}
      </div>
    </div>
  )
}
