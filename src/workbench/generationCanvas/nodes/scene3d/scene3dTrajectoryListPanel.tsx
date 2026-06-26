import React from 'react'
import { createPortal } from 'react-dom'
import { IconChevronRight, IconDotsVertical, IconFolder, IconTrash } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { FULLSCREEN_Z_INDEX } from './scene3dConstants'
import type { Scene3DTrajectory, Scene3DTrajectoryGroup } from './scene3dTypes'

type TrajectoryListPanelProps = {
  activeTrajectoryId: string | null
  groups: Scene3DTrajectoryGroup[]
  readOnly: boolean
  trajectories: Scene3DTrajectory[]
  onAssignTrajectoryToGroup: (trajectoryId: string, groupId: string) => void
  onDeleteTrajectory: (trajectoryId: string) => void
  onSelectTrajectory: (trajectoryId: string) => void
}

export const TrajectoryListPanel = React.memo(function TrajectoryListPanel({
  activeTrajectoryId,
  groups,
  readOnly,
  trajectories,
  onAssignTrajectoryToGroup,
  onDeleteTrajectory,
  onSelectTrajectory,
}: TrajectoryListPanelProps): JSX.Element {
  const [menu, setMenu] = React.useState<{ trajectoryId: string; x: number; y: number } | null>(null)
  const groupNameByTrajectoryId = React.useMemo(() => {
    const map = new Map<string, string>()
    groups.forEach((group) => {
      group.trajectoryIds.forEach((trajectoryId) => map.set(trajectoryId, group.name))
    })
    return map
  }, [groups])

  const openMenu = React.useCallback((trajectoryId: string, clientX: number, clientY: number) => {
    setMenu({
      trajectoryId,
      x: Math.min(clientX, window.innerWidth - 178),
      y: Math.min(clientY, window.innerHeight - 98),
    })
  }, [])

  React.useEffect(() => {
    if (!menu) return undefined
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-trajectory-list-menu="true"]')) return
      setMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [menu])

  const activeMenuTrajectory = menu ? trajectories.find((trajectory) => trajectory.id === menu.trajectoryId) : undefined

  const menuNode =
    menu && activeMenuTrajectory && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed min-w-[132px] rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-1 text-caption text-[var(--nomi-ink)] shadow-[0_14px_34px_rgba(18,24,38,0.2)]"
            data-trajectory-list-menu="true"
            style={{ left: menu.x, top: menu.y, zIndex: FULLSCREEN_Z_INDEX }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="group/menu relative">
              <button
                className="flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left hover:bg-[var(--nomi-ink-05)] disabled:cursor-not-allowed disabled:opacity-45"
                disabled={readOnly || groups.length === 0}
                type="button"
              >
                <IconFolder size={14} stroke={1.9} />
                <span className="min-w-0 flex-1 truncate">加入轨迹组</span>
                <IconChevronRight size={13} stroke={1.9} />
              </button>
              {groups.length > 0 ? (
                <div className="absolute left-full top-0 hidden min-w-[158px] pl-2 group-hover/menu:block">
                  <div className="min-w-[146px] rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-1 shadow-[0_14px_34px_rgba(18,24,38,0.18)]">
                    {groups.map((group) => (
                      <button
                        key={group.id}
                        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-nomi-sm px-2 text-left hover:bg-[var(--nomi-ink-05)]"
                        type="button"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onAssignTrajectoryToGroup(activeMenuTrajectory.id, group.id)
                          setMenu(null)
                        }}
                      >
                        <IconFolder size={14} stroke={1.9} />
                        <span className="min-w-0 flex-1 truncate">{group.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              className="flex h-8 w-full items-center gap-2 rounded-nomi-sm px-2 text-left text-workbench-danger hover:bg-workbench-danger-soft disabled:cursor-not-allowed disabled:opacity-45"
              disabled={readOnly}
              type="button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onDeleteTrajectory(activeMenuTrajectory.id)
                setMenu(null)
              }}
            >
              <IconTrash size={14} stroke={1.9} />
              <span>删除</span>
            </button>
          </div>,
          document.body,
        )
      : null

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--nomi-paper)]">
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <h3 className="m-0 text-caption font-medium text-[var(--nomi-ink)]">轨迹列表</h3>
        <span className="text-micro text-[var(--nomi-ink-60)]">{trajectories.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {trajectories.length === 0 ? (
          <div className="grid h-20 place-items-center rounded-nomi-sm border border-dashed border-[var(--nomi-line-soft)] text-micro text-[var(--nomi-ink-40)]">
            双击空白创建轨迹
          </div>
        ) : (
          trajectories.map((trajectory) => {
            const active = trajectory.id === activeTrajectoryId
            const groupName = groupNameByTrajectoryId.get(trajectory.id)
            return (
              <div
                key={trajectory.id}
                className={cn(
                  'group grid grid-cols-[18px_minmax(0,1fr)_28px] items-center gap-1 rounded-nomi-sm px-2 py-1.5',
                  'text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)]',
                  active && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
                )}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  openMenu(trajectory.id, event.clientX, event.clientY)
                }}
                >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: trajectory.color }} />
                <button
                  className="grid min-w-0 gap-0.5 bg-transparent p-0 text-left text-inherit"
                  type="button"
                  onClick={() => onSelectTrajectory(trajectory.id)}
                >
                  <span className="min-w-0 truncate text-caption font-medium">{trajectory.name}</span>
                  <span className="min-w-0 truncate text-micro text-[var(--nomi-ink-40)]">
                    {groupName || '未分组'} · {trajectory.points.length}点
                  </span>
                </button>
                <button
                  className={cn(
                    'grid size-7 place-items-center rounded-nomi-sm text-[var(--nomi-ink-40)] opacity-0 hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)] group-hover:opacity-100',
                    menu?.trajectoryId === trajectory.id && 'opacity-100',
                  )}
                  title="更多"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openMenu(trajectory.id, event.clientX, event.clientY)
                  }}
                >
                  <IconDotsVertical size={15} stroke={1.9} />
                </button>
              </div>
            )
          })
        )}
      </div>
      {menuNode}
    </section>
  )
})
