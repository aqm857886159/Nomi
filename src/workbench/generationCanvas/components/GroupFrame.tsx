/**
 * GroupFrame — 画布上每个 group 的视觉包围框 + 拖动 handle。
 *
 * E.2C-30 抽离自 GenerationCanvas.tsx 内联实现（spec §6/Task E.2-8 要求）。
 * 单一职责：根据 groupBoxes 数据渲染 group 边框、标签、可拖动表面。
 * 不依赖 store；所有数据由调用方传入，便于将来虚拟化或换 dnd 后端。
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconStack2 } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { NodeGroup } from '../model/generationCanvasTypes'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'

export type CanvasGroupBox = {
  group: NodeGroup
  left: number
  top: number
  width: number
  height: number
  memberCount: number
}

export type GroupFrameProps = {
  box: CanvasGroupBox
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
  /**
   * 有线待连时，组框变成可落点：落下 = 给组内每个成员各连一根（见 store.connectToGroup）。
   * 此时**不能**再走拖动 handle，否则一拖就把组挪走了。
   */
  pendingConnection?: boolean
  pendingConnectionSide?: ConnectionAnchorSide
  onConnectToGroup?: (groupId: string) => void
  onCollapse?: (groupId: string) => void
}

// 这里**刻意不放「整组运行」按钮**（2026-08-02 加过又删）：点组框本来就会选中全部成员
// （useCanvasSelectionDrag.handleGroupFramePointerDown），选择浮条随即显示「生成 N 个」——
// 整组运行早就有了。在标签上再放一个 ▶ 等于同屏两个一模一样的动作（实测两者相距约 600px 同时可见），
// 是并行版（违 P1）。要改整组运行的行为，改选择浮条那一条路径。

function getHexAlphaColor(color: string | undefined, alphaHex: string): string | undefined {
  const normalized = color?.trim()
  if (!normalized) return undefined
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) return `${normalized}${alphaHex}`
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    const [, r, g, b] = normalized
    return `#${r}${r}${g}${g}${b}${b}${alphaHex}`
  }
  return undefined
}

export default function GroupFrame({
  box,
  onPointerDown,
  pendingConnection,
  pendingConnectionSide,
  onConnectToGroup,
  onCollapse,
}: GroupFrameProps): JSX.Element {
  const { t } = useTranslation()
  const groupColor = box.group.color || undefined
  const connectable = Boolean(pendingConnection && onConnectToGroup && box.memberCount > 0)
  const groupIsSource = connectable && pendingConnectionSide === 'left'
  const connectionLabel = groupIsSource
    ? t('generationCommon.canvas.group.connectFromHere', { name: box.group.name, count: box.memberCount })
    : t('generationCommon.canvas.group.connectHere', { name: box.group.name, count: box.memberCount })
  return (
    <div
      className={cn(
        'generation-canvas-v2__group-box',
        'absolute pointer-events-auto select-none rounded-nomi-lg',
        'border-[1.5px] border-[color-mix(in_srgb,var(--nomi-accent)_55%,transparent)]',
        'bg-[color-mix(in_srgb,var(--nomi-accent)_8%,transparent)]',
        'shadow-[inset_0_0_0_1px_var(--workbench-frame-ring),0_14px_34px_rgba(18,24,38,0.055)]',
        connectable
          ? 'cursor-copy border-dashed border-nomi-accent bg-[color-mix(in_srgb,var(--nomi-accent)_16%,transparent)]'
          : 'cursor-grab active:cursor-grabbing',
      )}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        ...(connectable ? {} : { borderColor: groupColor, backgroundColor: getHexAlphaColor(groupColor, '18') }),
      }}
      role="button"
      tabIndex={0}
      // 拖线松手时 useDragToConnect 靠这个属性在元素栈里认出组框（与 data-node-id 同一套命中法）。
      data-group-id={box.group.id}
      aria-label={
        connectable
          ? connectionLabel
          : t('generationCommon.canvas.group.dragNamed', { name: box.group.name })
      }
      title={
        connectable
          ? connectionLabel
          : t('generationCommon.canvas.group.drag')
      }
      onPointerDown={(event) => {
        // 有线待连时组框是落点不是把手：照常走拖动会把整组拽走(用户以为在连线)。
        if (connectable) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        onPointerDown(event, box.group.id)
      }}
      onClick={(event) => {
        if (!connectable) return
        event.stopPropagation()
        onConnectToGroup?.(box.group.id)
      }}
    >
      <div
        className={cn(
          'generation-canvas-v2__group-box-label',
          'absolute left-3 top-2 z-[4] inline-flex min-h-[22px] max-w-[calc(100%-24px)] items-center gap-2',
          'rounded-full bg-nomi-accent px-[9px] py-[3px] text-micro font-[650] leading-[1.25] text-nomi-paper',
          'pointer-events-auto select-none shadow-[0_8px_18px_rgba(18,24,38,0.12)]',
          connectable ? 'cursor-copy' : 'cursor-grab active:cursor-grabbing',
        )}
        style={{ backgroundColor: groupColor }}
      >
        <span className="min-w-0 truncate">{box.group.name}</span>
        <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--workbench-veil-chip)] px-[5px] text-micro">
          {box.memberCount}
        </span>
        {onCollapse && !connectable ? (
          <button
            type="button"
            className="grid size-[18px] place-items-center rounded-full border-0 bg-[var(--workbench-veil-chip)] text-current hover:bg-nomi-paper/25 focus-visible:outline-2 focus-visible:outline-nomi-paper"
            aria-label={t('generationCommon.canvas.group.collapseNamed', { name: box.group.name })}
            title={t('generationCommon.canvas.group.collapse')}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              onCollapse(box.group.id)
            }}
          >
            <IconStack2 size={11} stroke={1.9} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

export type GroupFrameListProps = {
  boxes: readonly CanvasGroupBox[]
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
  pendingConnection?: boolean
  pendingConnectionSide?: ConnectionAnchorSide
  onConnectToGroup?: (groupId: string) => void
  onCollapse?: (groupId: string) => void
}

export function GroupFrameList({
  boxes,
  onPointerDown,
  pendingConnection,
  pendingConnectionSide,
  onConnectToGroup,
  onCollapse,
}: GroupFrameListProps): JSX.Element {
  return (
    <div className="generation-canvas-v2__group-boxes pointer-events-none absolute inset-0">
      {boxes.map((box) => (
        <GroupFrame
          key={box.group.id}
          box={box}
          onPointerDown={onPointerDown}
          pendingConnection={pendingConnection}
          pendingConnectionSide={pendingConnectionSide}
          onConnectToGroup={onConnectToGroup}
          onCollapse={onCollapse}
        />
      ))}
    </div>
  )
}
