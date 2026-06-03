import React from 'react'
import {
  IconCopy,
  IconCut,
  IconPlayerPlay,
  IconTimelineEventPlus,
} from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { toast } from '../../../ui/toast'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getQuickAddGenerationNodePlugins } from '../nodes/renderRegistry'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { sendStoryboardToTimeline } from '../agent/sendStoryboardToTimeline'
import { runGenerationNodesBatch } from '../runner/generationRunController'

const QUICK_ADD_NODE_ITEMS = getQuickAddGenerationNodePlugins()

// Single source of truth for the手动「添加节点」set — used by BOTH the left
// toolbar and the right-click menu so they never diverge. The其它 quickAdd kinds
// (角色/场景/关键帧/镜头/输出) are created by the agent / storyboard flow, not by
// manual add — keeping this list short de-clutters the right-click menu.
const PRIMARY_NODE_KINDS: GenerationNodeKind[] = ['text', 'image', 'video', 'panorama', 'scene3d']
const PRIMARY_ADD_ITEMS = PRIMARY_NODE_KINDS
  .map((kind) => QUICK_ADD_NODE_ITEMS.find((item) => item.kind === kind))
  .filter((item): item is (typeof QUICK_ADD_NODE_ITEMS)[number] => Boolean(item))

type NodeAddMenuProps = {
  className?: string
  style?: React.CSSProperties
  onAddNode: (kind: GenerationNodeKind) => void
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
}

export function NodeAddMenu({
  className,
  style,
  onAddNode,
  onContextMenu,
  onPointerDown,
}: NodeAddMenuProps): JSX.Element {
  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar__node-menu',
        'absolute top-0 left-[calc(100%+8px)] grid gap-1 w-[132px] p-[6px]',
        'border border-workbench-border rounded-[12px]',
        'bg-white/[0.96] shadow-workbench-pop',
        className,
      )}
      role="menu"
      aria-label="添加节点菜单"
      style={style}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
    >
      {PRIMARY_ADD_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <WorkbenchButton
            key={item.kind}
            className={cn(
              'inline-flex items-center justify-start gap-[6px]',
              'w-full h-8 min-h-8 px-2 border-0 rounded-[8px]',
              'bg-workbench-surface-solid text-workbench-ink font-[inherit] text-xs cursor-pointer',
              'hover:bg-nomi-ink-05',
            )}
            role="menuitem"
            aria-label={`添加${item.menuLabel}节点`}
            onClick={() => onAddNode(item.kind)}
          >
            <Icon size={15} />
            <span>{item.menuLabel}</span>
          </WorkbenchButton>
        )
      })}
    </div>
  )
}

type CanvasToolbarProps = {
  getInsertionPosition: () => { x: number; y: number }
  categoryId?: string
}

export default function CanvasToolbar({ getInsertionPosition, categoryId }: CanvasToolbarProps): JSX.Element {
  const addNode = useGenerationCanvasStore((state) => state.addNode)
  const selectedNodeIds = useGenerationCanvasStore((state) => state.selectedNodeIds)
  const copySelectedNodes = useGenerationCanvasStore((state) => state.copySelectedNodes)
  const cutSelectedNodes = useGenerationCanvasStore((state) => state.cutSelectedNodes)

  const handleAddNode = (kind: GenerationNodeKind) => {
    addNode({ kind, position: getInsertionPosition(), categoryId })
  }

  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar',
        'absolute top-1/2 left-4 z-[8] inline-flex flex-col items-center gap-1 p-[6px]',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-md -translate-y-1/2',
      )}
      aria-label="生成画布工具栏"
    >
      {PRIMARY_ADD_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <WorkbenchButton
            key={item.kind}
            className={cn('w-8 h-8 min-h-8 p-0 border-0 rounded-nomi-sm cursor-pointer')}
            aria-label={`添加${item.menuLabel}节点`}
            title={item.menuLabel}
            onClick={() => handleAddNode(item.kind)}
          >
            <Icon size={15} />
            <span className="hidden">{item.menuLabel}</span>
          </WorkbenchButton>
        )
      })}
      <span className={cn('w-5 h-px bg-workbench-border')} />
      <WorkbenchButton
        className={cn('w-8 h-8 min-h-8 p-0 border-0 rounded-nomi-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-[0.42]')}
        aria-label="复制选中节点"
        title="复制选中节点"
        disabled={selectedNodeIds.length === 0}
        onClick={copySelectedNodes}
      >
        <IconCopy size={15} />
        <span className="hidden">复制</span>
      </WorkbenchButton>
      <WorkbenchButton
        className={cn('w-8 h-8 min-h-8 p-0 border-0 rounded-nomi-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-[0.42]')}
        aria-label="剪切选中节点"
        title="剪切选中节点"
        disabled={selectedNodeIds.length === 0}
        onClick={cutSelectedNodes}
      >
        <IconCut size={15} />
        <span className="hidden">剪切</span>
      </WorkbenchButton>
      <span className={cn('w-5 h-px bg-workbench-border')} />
      <WorkbenchButton
        className={cn('w-8 h-8 min-h-8 p-0 border-0 rounded-nomi-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-[0.42]')}
        aria-label="批量生成所有选中节点"
        title="全部生成（限并发 2，失败自动重试）"
        data-storyboard-run-all="true"
        disabled={selectedNodeIds.length === 0}
        onClick={() => {
          const ids = [...selectedNodeIds]
          const total = ids.length
          if (total === 0) return
          toast(`开始批量生成 ${total} 个节点…`, 'info')
          void runGenerationNodesBatch(ids)
            .then((result) => {
              const okCount = result.successes.length
              const failCount = result.failures.length
              if (failCount === 0) {
                toast(`已完成 ${okCount}/${total} 个节点的生成`, 'success')
              } else if (okCount === 0) {
                toast(`批量生成失败：${failCount}/${total} 个节点未完成`, 'error')
              } else {
                toast(`已完成 ${okCount}/${total}，${failCount} 个失败 — 在画布上单独重试`, 'info')
              }
            })
            .catch((error: unknown) => {
              const message = error instanceof Error && error.message ? error.message : '批量生成异常'
              toast(message, 'error')
            })
        }}
      >
        <IconPlayerPlay size={15} />
        <span className="hidden">全部生成</span>
      </WorkbenchButton>
      <WorkbenchButton
        className={cn('w-8 h-8 min-h-8 p-0 border-0 rounded-nomi-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-[0.42]')}
        aria-label="把选中节点按时序发送到时间轴"
        title="发送到时间轴（按时序连边排序）"
        data-storyboard-send-to-timeline="true"
        disabled={selectedNodeIds.length < 2}
        onClick={() => {
          const result = sendStoryboardToTimeline(selectedNodeIds)
          if (!result.ok) {
            toast('选中的节点都还没有可用资产，无法发送到时间轴', 'error')
            return
          }
          if (result.skipped.length > 0) {
            toast(`已发送 ${result.sent.length} / ${result.total} 节点（${result.skipped.length} 个尚未生成）`, 'info')
          } else {
            toast(`已发送 ${result.sent.length} 个节点到时间轴`, 'success')
          }
        }}
      >
        <IconTimelineEventPlus size={15} />
        <span className="hidden">发送到时间轴</span>
      </WorkbenchButton>
    </div>
  )
}
