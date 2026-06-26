import React from 'react'
import { Html } from '@react-three/drei'
import { IconCamera, IconChevronRight, IconPencil, IconPlus, IconTrash, IconUser } from '@tabler/icons-react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Scene3DTrajectory, Scene3DVector3 } from '../scene3dTypes'
import {
  type TrajectoryBindTarget,
  type TrajectoryContextMenuState,
  type TrajectoryCreateMenuState,
  type TrajectoryPointBindMenuState,
  vectorToScene,
} from './trajectoryRendererShared'
import { buildTrajectoryCurve, createTrajectoryTubeGeometry } from './trajectoryUtils'

export function TrajectoryEditPlane({
  onCreateTrajectory,
  onOpenCreateMenu,
}: {
  onCreateTrajectory: (position: Scene3DVector3) => void
  onOpenCreateMenu?: (position: Scene3DVector3) => void
}): JSX.Element {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onCreateTrajectory([Number(event.point.x.toFixed(4)), 0, Number(event.point.z.toFixed(4))])
      }}
      onContextMenu={(event) => {
        event.stopPropagation()
        event.nativeEvent.preventDefault()
        onOpenCreateMenu?.([Number(event.point.x.toFixed(4)), 0, Number(event.point.z.toFixed(4))])
      }}
    >
      <planeGeometry args={[80, 80]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

export function TrajectoryHitTube({
  trajectory,
  onWholePointerDown,
  onContextMenu,
  onInsertPointAt,
  onSelectTrajectory,
}: {
  trajectory: Scene3DTrajectory
  onWholePointerDown?: (event: ThreeEvent<PointerEvent>) => void
  onContextMenu?: (trajectoryId: string, position: Scene3DVector3) => void
  onInsertPointAt?: (position: THREE.Vector3) => void
  onSelectTrajectory?: (trajectoryId: string) => void
}): JSX.Element | null {
  const curve = React.useMemo(() => buildTrajectoryCurve(trajectory), [trajectory])
  const geometry = React.useMemo(() => {
    if (!curve) return null
    return createTrajectoryTubeGeometry(curve, trajectory.points.length)
  }, [curve, trajectory.points.length])

  React.useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null

  return (
    <mesh
      geometry={geometry}
      onPointerDown={onWholePointerDown}
      onClick={(event) => {
        event.stopPropagation()
        onSelectTrajectory?.(trajectory.id)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (onInsertPointAt) {
          onInsertPointAt(event.point)
          return
        }
        onSelectTrajectory?.(trajectory.id)
      }}
      onContextMenu={(event) => {
        event.stopPropagation()
        event.nativeEvent.preventDefault()
        onContextMenu?.(trajectory.id, vectorToScene(event.point))
      }}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} color="#ffffff" />
    </mesh>
  )
}

export function TrajectoryCreateMenu({
  menu,
  onClose,
  onCreateTrajectory,
}: {
  menu: TrajectoryCreateMenuState | null
  onClose: () => void
  onCreateTrajectory: (position: Scene3DVector3) => void
}): JSX.Element | null {
  React.useEffect(() => {
    if (!menu) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-trajectory-create-menu="true"]')) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [menu, onClose])

  if (!menu) return null

  return (
    <Html
      center
      distanceFactor={8}
      position={menu.position}
      style={{ pointerEvents: 'auto' }}
      zIndexRange={[28, 0]}
    >
      <div
        className="min-w-[128px] overflow-hidden rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-1 text-caption text-[var(--nomi-ink)] shadow-[0_14px_34px_rgba(18,24,38,0.2)]"
        data-trajectory-create-menu="true"
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left hover:bg-[var(--nomi-ink-05)]"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onCreateTrajectory(menu.position)
            onClose()
          }}
        >
          <IconPlus size={14} stroke={1.9} />
          <span>添加轨迹</span>
        </button>
      </div>
    </Html>
  )
}

export function TrajectoryContextMenu({
  menu,
  onClose,
  onInsertPoint,
  onEditTrajectory,
  onDeleteTrajectory,
}: {
  menu: TrajectoryContextMenuState | null
  onClose: () => void
  onInsertPoint?: (trajectoryId: string, position: Scene3DVector3) => void
  onEditTrajectory?: (trajectoryId: string) => void
  onDeleteTrajectory?: (trajectoryId: string) => void
}): JSX.Element | null {
  React.useEffect(() => {
    if (!menu) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-trajectory-context-menu="true"]')) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [menu, onClose])

  if (!menu) return null

  return (
    <Html
      center
      distanceFactor={8}
      position={menu.position}
      style={{ pointerEvents: 'auto' }}
      zIndexRange={[24, 0]}
    >
      <div
        className="min-w-[116px] overflow-hidden rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-1 text-caption text-[var(--nomi-ink)] shadow-[0_14px_34px_rgba(18,24,38,0.2)]"
        data-trajectory-context-menu="true"
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {onInsertPoint ? (
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left hover:bg-[var(--nomi-ink-05)]"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onInsertPoint(menu.trajectoryId, menu.position)
              onClose()
            }}
          >
            <IconPlus size={14} stroke={1.9} />
            <span>添加控制点</span>
          </button>
        ) : null}
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left hover:bg-[var(--nomi-ink-05)]"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            onEditTrajectory?.(menu.trajectoryId)
          }}
        >
          <IconPencil size={14} stroke={1.9} />
          <span>编辑</span>
        </button>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-workbench-danger hover:bg-workbench-danger-soft"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            onDeleteTrajectory?.(menu.trajectoryId)
          }}
        >
          <IconTrash size={14} stroke={1.9} />
          <span>删除</span>
        </button>
      </div>
    </Html>
  )
}

export function TrajectoryPointBindMenu({
  menu,
  targets,
  onClose,
  onBindTarget,
}: {
  menu: TrajectoryPointBindMenuState | null
  targets: TrajectoryBindTarget[]
  onClose: () => void
  onBindTarget?: (trajectoryId: string, targetId: string, pointId?: string | null) => void
}): JSX.Element | null {
  const [hoveredType, setHoveredType] = React.useState<TrajectoryBindTarget['type']>('mannequin')
  const targetsByType = React.useMemo(
    () => ({
      mannequin: targets.filter((target) => target.type === 'mannequin'),
      camera: targets.filter((target) => target.type === 'camera'),
    }),
    [targets],
  )

  React.useEffect(() => {
    if (!menu) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-trajectory-point-bind-menu="true"]')) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [menu, onClose])

  React.useEffect(() => {
    if (!menu) return
    setHoveredType(targetsByType.mannequin.length > 0 ? 'mannequin' : 'camera')
  }, [menu, targetsByType.mannequin.length])

  if (!menu) return null

  const categories: Array<{
    type: TrajectoryBindTarget['type']
    label: string
    icon: JSX.Element
    items: TrajectoryBindTarget[]
  }> = [
    {
      type: 'mannequin',
      label: '假人',
      icon: <IconUser size={14} stroke={1.9} />,
      items: targetsByType.mannequin,
    },
    {
      type: 'camera',
      label: '相机',
      icon: <IconCamera size={14} stroke={1.9} />,
      items: targetsByType.camera,
    },
  ]
  const hoveredItems = targetsByType[hoveredType]

  return (
    <Html
      center
      distanceFactor={8}
      position={menu.position}
      style={{ pointerEvents: 'auto' }}
      zIndexRange={[26, 0]}
    >
      <div
        className="relative min-w-[126px] rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-1 text-caption text-[var(--nomi-ink)] shadow-[0_14px_34px_rgba(18,24,38,0.22)]"
        data-trajectory-point-bind-menu="true"
        onContextMenu={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {categories.map((category) => (
          <button
            key={category.type}
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left hover:bg-[var(--nomi-ink-05)]"
            onMouseEnter={() => setHoveredType(category.type)}
            onFocus={() => setHoveredType(category.type)}
          >
            {category.icon}
            <span className="min-w-0 flex-1 truncate">{category.label}</span>
            <span className="text-micro text-[var(--nomi-ink-40)]">{category.items.length}</span>
            <IconChevronRight size={13} stroke={1.9} />
          </button>
        ))}
        <div className="absolute left-[calc(100%+6px)] top-1 min-w-[148px] rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-1 shadow-[0_14px_34px_rgba(18,24,38,0.2)]">
          {hoveredItems.length === 0 ? (
            <div className="px-2 py-2 text-micro text-[var(--nomi-ink-40)]">暂无可绑定节点</div>
          ) : (
            hoveredItems.map((target) => (
              <button
                key={target.id}
                type="button"
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-nomi-sm px-2 text-left hover:bg-[var(--nomi-ink-05)]"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onBindTarget?.(menu.trajectoryId, target.id, menu.pointId)
                  onClose()
                }}
              >
                {target.type === 'camera' ? (
                  <IconCamera size={14} stroke={1.9} />
                ) : (
                  <IconUser size={14} stroke={1.9} />
                )}
                <span className="min-w-0 flex-1 truncate">{target.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </Html>
  )
}
