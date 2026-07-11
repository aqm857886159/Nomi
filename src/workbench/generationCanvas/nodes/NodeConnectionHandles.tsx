import React from 'react'
import { IconPlus } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'

const MAGNETIC_HANDLE_ICON_RADIUS = 14.5

function clampMagneticHandlePosition(value: number, max: number): number {
  return Math.min(
    Math.max(value, MAGNETIC_HANDLE_ICON_RADIUS),
    Math.max(MAGNETIC_HANDLE_ICON_RADIUS, max - MAGNETIC_HANDLE_ICON_RADIUS),
  )
}

function updateMagneticHandlePosition(event: React.PointerEvent<HTMLButtonElement>): void {
  const handle = event.currentTarget
  const rect = handle.getBoundingClientRect()
  const localWidth = handle.offsetWidth || rect.width || 1
  const localHeight = handle.offsetHeight || rect.height || 1
  const localX = rect.width > 0 ? (event.clientX - rect.left) * (localWidth / rect.width) : localWidth / 2
  const localY = rect.height > 0 ? (event.clientY - rect.top) * (localHeight / rect.height) : localHeight / 2
  handle.style.setProperty('--connection-handle-x', `${clampMagneticHandlePosition(localX, localWidth)}px`)
  handle.style.setProperty('--connection-handle-y', `${clampMagneticHandlePosition(localY, localHeight)}px`)
  handle.dataset.following = 'true'
}

function resetMagneticHandlePosition(event: React.PointerEvent<HTMLButtonElement>): void {
  const handle = event.currentTarget
  handle.style.setProperty('--connection-handle-x', handle.dataset.homeX || '50%')
  handle.style.setProperty('--connection-handle-y', '50%')
  handle.removeAttribute('data-following')
}

type MagneticConnectionHandleProps = {
  side: ConnectionAnchorSide
  active: boolean
  pendingTarget: boolean
  onStart: (event: React.PointerEvent<HTMLElement>, side: ConnectionAnchorSide) => void
  onComplete: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export function MagneticConnectionHandle({
  side,
  active,
  pendingTarget,
  onStart,
  onComplete,
}: MagneticConnectionHandleProps): JSX.Element {
  const homeX = side === 'left' ? 'calc(100% - 28px)' : '28px'
  return (
    <button
      type="button"
      className={cn(
        'generation-canvas-v2-node__magnetic-handle group/magnetic pointer-events-auto absolute top-1/2 z-[4]',
        'h-[min(168px,calc(100%+28px))] w-28 -translate-y-1/2',
        'touch-none cursor-crosshair border-0 bg-transparent p-0',
        side === 'left' ? 'left-[-112px]' : 'right-[-112px]',
      )}
      aria-label={pendingTarget ? '连接到此节点' : '从此节点开始连线'}
      data-active={active ? 'true' : 'false'}
      data-home-x={homeX}
      data-side={side}
      style={
        {
          '--connection-handle-x': homeX,
          '--connection-handle-y': '50%',
        } as React.CSSProperties
      }
      onPointerMove={updateMagneticHandlePosition}
      onPointerLeave={resetMagneticHandlePosition}
      onPointerCancel={resetMagneticHandlePosition}
      onPointerDown={(event) => {
        if (pendingTarget) {
          event.stopPropagation()
          return
        }
        onStart(event, side)
      }}
      onClick={(event) => {
        event.stopPropagation()
        if (pendingTarget) onComplete(event)
      }}
    >
      <span
        className={cn(
          'generation-canvas-v2-node__magnetic-handle-icon',
          'pointer-events-none absolute left-[var(--connection-handle-x)] top-[var(--connection-handle-y)]',
          'grid size-[29px] place-items-center rounded-full',
          'border-2 border-[color-mix(in_srgb,var(--workbench-muted-soft)_72%,transparent)]',
          'bg-[color-mix(in_oklch,var(--nomi-paper)_82%,transparent)] text-workbench-muted',
          'shadow-[0_10px_26px_rgba(18,24,38,0.18),0_0_0_1px_color-mix(in_srgb,var(--nomi-ink)_8%,transparent)]',
          'transition-[left,top,opacity,transform,border-color,color] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
          'group-data-[following=true]/magnetic:transition-[opacity,transform,border-color,color] group-data-[following=true]/magnetic:duration-[120ms]',
          'group-hover/magnetic:border-workbench-accent group-hover/magnetic:text-workbench-accent',
          'group-focus-visible/magnetic:border-workbench-accent group-focus-visible/magnetic:text-workbench-accent',
          'group-data-[active=true]/magnetic:border-workbench-accent group-data-[active=true]/magnetic:text-workbench-accent',
        )}
        aria-hidden="true"
      >
        <IconPlus size={18} stroke={1.8} />
      </span>
    </button>
  )
}
