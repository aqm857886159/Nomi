import React from 'react'
import { cn } from '../../utils/cn'
import {
  clampCenter,
  clampScale,
  pixelToCenter,
  snapCenterToGuides,
  type Vec2,
} from '../timeline/overlayTransform'

type TransformPatch = { position?: Vec2; scale?: number }

type OverlaySelectionBoxProps = {
  /** 元素中心（归一化 0~1）*/
  centerNorm: Vec2
  /** 当前缩放（用于四角把手按比例换算）*/
  scale: number
  /** 舞台像素尺寸（归一化↔像素换算）*/
  stageWidth: number
  stageHeight: number
  /** 拖动/缩放回调；commit=false 为拖动中（不落盘），true 为松手。*/
  onTransform: (patch: TransformPatch, commit: boolean) => void
  /** 吸附引导线变化（归一化坐标，null=无）。*/
  onSnapGuides: (guides: { x: number | null; y: number | null }) => void
  children: React.ReactNode
}

const HANDLE_KEYS = ['nw', 'ne', 'se', 'sw'] as const
const HANDLE_POS: Record<(typeof HANDLE_KEYS)[number], string> = {
  nw: '-top-[5px] -left-[5px] cursor-nwse-resize',
  ne: '-top-[5px] -right-[5px] cursor-nesw-resize',
  se: '-bottom-[5px] -right-[5px] cursor-nwse-resize',
  sw: '-bottom-[5px] -left-[5px] cursor-nesw-resize',
}

/**
 * 通用叠加层选择框（content-agnostic）：拖动改 position、四角改 scale、中线吸附。
 * 只认「中心 transform + 任意 children」——文字/图片/贴纸将来都能复用；不绑「文字」。
 */
export default function OverlaySelectionBox({
  centerNorm,
  scale,
  stageWidth,
  stageHeight,
  onTransform,
  onSnapGuides,
  children,
}: OverlaySelectionBoxProps): JSX.Element {
  const beginBodyDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('[data-handle]')) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const startCenterPx = { x: centerNorm.x * stageWidth, y: centerNorm.y * stageHeight }

    const apply = (clientX: number, clientY: number, commit: boolean) => {
      const px = { x: startCenterPx.x + (clientX - startX), y: startCenterPx.y + (clientY - startY) }
      const snapped = snapCenterToGuides(clampCenter(pixelToCenter(px, stageWidth, stageHeight)))
      onSnapGuides({ x: snapped.guideX, y: snapped.guideY })
      onTransform({ position: snapped.center }, commit)
    }
    const move = (e: PointerEvent) => apply(e.clientX, e.clientY, false)
    const up = (e: PointerEvent) => {
      apply(e.clientX, e.clientY, true)
      onSnapGuides({ x: null, y: null })
      target.releasePointerCapture?.(event.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [centerNorm.x, centerNorm.y, onSnapGuides, onTransform, stageHeight, stageWidth])

  const beginHandleScale = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    target.setPointerCapture?.(event.pointerId)
    const centerPx = { x: centerNorm.x * stageWidth, y: centerNorm.y * stageHeight }
    const startDist = Math.hypot(event.clientX - centerPx.x, event.clientY - centerPx.y) || 1
    const startScale = scale

    const apply = (clientX: number, clientY: number, commit: boolean) => {
      const dist = Math.hypot(clientX - centerPx.x, clientY - centerPx.y)
      onTransform({ scale: clampScale(startScale * (dist / startDist)) }, commit)
    }
    const move = (e: PointerEvent) => apply(e.clientX, e.clientY, false)
    const up = (e: PointerEvent) => {
      apply(e.clientX, e.clientY, true)
      target.releasePointerCapture?.(event.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [centerNorm.x, centerNorm.y, onTransform, scale, stageHeight, stageWidth])

  return (
    <div
      className={cn(
        'workbench-overlay-selection',
        'absolute pointer-events-auto cursor-move touch-none',
        'outline outline-2 outline-[var(--nomi-accent)]',
      )}
      style={{
        left: `${centerNorm.x * stageWidth}px`,
        top: `${centerNorm.y * stageHeight}px`,
        transform: 'translate(-50%, -50%)',
      }}
      onPointerDown={beginBodyDrag}
    >
      {children}
      {HANDLE_KEYS.map((key) => (
        <span
          key={key}
          data-handle={key}
          className={cn(
            'workbench-overlay-selection__handle',
            'absolute w-[10px] h-[10px] rounded-nomi-sm touch-none',
            'border-[1.5px] border-[var(--nomi-accent)] bg-[var(--nomi-paper)]',
            'shadow-[0_1px_2px_oklch(0_0_0/0.18)]',
            HANDLE_POS[key],
          )}
          onPointerDown={beginHandleScale}
        />
      ))}
    </div>
  )
}
