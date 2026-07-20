import React from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '../../../utils/cn'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'
import { getQuickAddGenerationNodePlugins } from '../nodes/renderRegistry'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

const QUICK_ADD_NODE_ITEMS = getQuickAddGenerationNodePlugins()

// Single source of truth for the手动「添加节点」set — used by BOTH the left
// toolbar and the right-click menu so they never diverge. The其它 quickAdd kinds
// (角色/场景/关键帧/镜头/输出) are created by the agent / storyboard flow, not by
// manual add — keeping this list short de-clutters the right-click menu.
// 2026-06-15：左侧栏瘦身为「纯创建节点」——复制/剪切走快捷键(⌘C/⌘X)、批量生成移到选中浮条、
// 发送到时间轴删除(节点可直接拖入时间轴)。这里只保留可手动新建的节点种类（含新增的「声音」）。
const PRIMARY_NODE_KINDS: GenerationNodeKind[] = ['text', 'image', 'video', 'audio', 'model3d', 'whiteboard', 'panorama', 'scene3d']
const PRIMARY_ADD_ITEMS = PRIMARY_NODE_KINDS
  .map((kind) => QUICK_ADD_NODE_ITEMS.find((item) => item.kind === kind))
  .filter((item): item is (typeof QUICK_ADD_NODE_ITEMS)[number] => Boolean(item))

function nodeKindLabel(kind: GenerationNodeKind, t: TFunction): string {
  if (kind === 'text') return t('canvas.nodeKinds.text')
  if (kind === 'image') return t('canvas.nodeKinds.image')
  if (kind === 'video') return t('canvas.nodeKinds.video')
  if (kind === 'audio') return t('canvas.nodeKinds.audio')
  if (kind === 'model3d') return t('canvas.nodeKinds.model3d')
  if (kind === 'whiteboard') return t('canvas.nodeKinds.whiteboard')
  if (kind === 'panorama') return t('canvas.nodeKinds.panorama')
  if (kind === 'scene3d') return t('canvas.nodeKinds.scene3d')
  return kind
}

type NodeAddMenuProps = {
  className?: string
  style?: React.CSSProperties
  kinds?: GenerationNodeKind[]
  onAddNode: (kind: GenerationNodeKind) => void
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>
}

export function NodeAddMenu({
  className,
  style,
  kinds,
  onAddNode,
  onContextMenu,
  onPointerDown,
}: NodeAddMenuProps): JSX.Element {
  const { t } = useTranslation()
  const items = React.useMemo(() => {
    if (!kinds?.length) return PRIMARY_ADD_ITEMS
    const allowed = new Set(kinds)
    return PRIMARY_ADD_ITEMS.filter((item) => allowed.has(item.kind))
  }, [kinds])
  return (
    <div
      className={cn(
        'generation-canvas-v2-toolbar__node-menu',
        'absolute top-0 left-[calc(100%+8px)] grid gap-1 w-[132px] p-[6px]',
        'border border-workbench-border rounded-nomi',
        'bg-nomi-paper shadow-workbench-pop',
        className,
      )}
      role="menu"
      aria-label={t('canvas.addNodeMenu')}
      style={style}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
    >
      {items.map((item) => {
        const Icon = item.icon
        const label = nodeKindLabel(item.kind, t)
        return (
          <button
            type="button"
            key={item.kind}
            className={cn(
              'inline-flex items-center justify-start gap-1.5',
              'w-full h-8 min-h-8 px-2 border-0 rounded-nomi',
              'bg-workbench-surface-solid text-workbench-ink font-[inherit] text-caption cursor-pointer',
              'hover:bg-nomi-ink-05',
              '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-nomi-ink-60 [&>svg]:stroke-[1.8]',
            )}
            role="menuitem"
            aria-label={t('canvas.addNode', { type: label })}
            onClick={() => onAddNode(item.kind)}
          >
            <Icon size={14} stroke={1.6} />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

type CanvasToolbarProps = {
  // 只给「期望落点」（视口锚换算的画布坐标）；真实 AABB 碰撞避让统一收口在 store.addNode。
  getInsertionPosition: () => { x: number; y: number }
  categoryId?: string
}

export default function CanvasToolbar({ getInsertionPosition, categoryId }: CanvasToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const addNode = useGenerationCanvasStore((state) => state.addNode)

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
      aria-label={t('canvas.toolbar')}
    >
      {PRIMARY_ADD_ITEMS.map((item) => {
        const Icon = item.icon
        const label = nodeKindLabel(item.kind, t)
        return (
          <button
            type="button"
            key={item.kind}
            className={cn(
              'grid size-8 min-h-8 place-items-center rounded-nomi-sm border-0 bg-transparent p-0 text-nomi-ink-60 cursor-pointer',
              'transition-colors hover:bg-nomi-ink-05 hover:text-nomi-ink',
              '[&>svg]:size-[18px] [&>svg]:stroke-[1.8]',
            )}
            aria-label={t('canvas.addNode', { type: label })}
            title={label}
            onClick={() => handleAddNode(item.kind)}
          >
            <Icon size={18} stroke={1.6} />
            <span className="hidden">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
