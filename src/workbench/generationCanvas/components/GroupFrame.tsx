/**
 * GroupFrame — 画布上每个 group 的视觉包围框 + 拖动 handle。
 *
 * E.2C-30 抽离自 GenerationCanvas.tsx 内联实现（spec §6/Task E.2-8 要求）。
 * 单一职责：根据 groupBoxes 数据渲染 group 边框、标签、可拖动表面。
 * 不依赖 store；所有数据由调用方传入，便于将来虚拟化或换 dnd 后端。
 */
import React from 'react'
import { cn } from '../../../utils/cn'
import type { NodeGroup } from '../model/generationCanvasTypes'

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
}

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

export default function GroupFrame({ box, onPointerDown }: GroupFrameProps): JSX.Element {
  const groupColor = box.group.color || undefined
  return (
    <div
      className={cn(
        'generation-canvas-v2__group-box',
        'absolute pointer-events-auto cursor-grab select-none rounded-nomi-lg',
        'border-[1.5px] border-[color-mix(in_srgb,var(--nomi-accent)_55%,transparent)]',
        'bg-[color-mix(in_srgb,var(--nomi-accent)_8%,transparent)]',
        'shadow-[inset_0_0_0_1px_var(--workbench-frame-ring),0_14px_34px_rgba(18,24,38,0.055)]',
        'active:cursor-grabbing',
      )}
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        borderColor: groupColor,
        backgroundColor: getHexAlphaColor(groupColor, '18'),
      }}
      role="button"
      tabIndex={0}
      aria-label={`拖动分组「${box.group.name}」`}
      title="拖动分组"
      onPointerDown={(event) => onPointerDown(event, box.group.id)}
    >
      <div
        className={cn(
          'generation-canvas-v2__group-box-label',
          'absolute left-3 top-2 inline-flex min-h-[22px] max-w-[calc(100%-24px)] items-center gap-2',
          'rounded-full bg-nomi-accent px-[9px] py-[3px] text-micro font-[650] leading-[1.25] text-nomi-paper',
          'pointer-events-auto cursor-grab select-none shadow-[0_8px_18px_rgba(18,24,38,0.12)] active:cursor-grabbing',
        )}
        style={{ backgroundColor: groupColor }}
      >
        <span className="min-w-0 truncate">{box.group.name}</span>
        <span className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-white/30 px-[5px] text-micro">
          {box.memberCount}
        </span>
      </div>
    </div>
  )
}

export type GroupFrameListProps = {
  boxes: readonly CanvasGroupBox[]
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>, groupId: string) => void
}

export function GroupFrameList({ boxes, onPointerDown }: GroupFrameListProps): JSX.Element {
  return (
    <div className="generation-canvas-v2__group-boxes pointer-events-none absolute inset-0 z-0">
      {boxes.map((box) => (
        <GroupFrame key={box.group.id} box={box} onPointerDown={onPointerDown} />
      ))}
    </div>
  )
}
