import React from 'react'
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconX,
} from '@tabler/icons-react'
import { cn } from '../../../../../utils/cn'
import type { Scene3DTrajectory, Scene3DTrajectoryBinding, Scene3DTrajectoryGroup, Scene3DTrajectoryPoint } from '../scene3dTypes'
import { trajectoryPointTimeRatio } from './trajectoryUtils'
import { useScene3DTrajectoryRuntimeStore, setScene3DPlayheadSeconds } from './trajectoryRuntimeStore'

type TrajectoryTimelineProps = {
  visible: boolean
  isPlaying: boolean
  readOnly: boolean
  activeGroupId: string | null
  playheadRef: React.MutableRefObject<number>
  onPlayChange: (playing: boolean) => void
  onSelectGroup: (groupId: string | null) => void
  onSelectTrajectory: (trajectoryId: string) => void
  onClose: () => void
  onAddGroup: () => void
  onRenameGroup: (groupId: string, name: string) => void
  onPatchBinding: (bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => void
  onPatchTrajectoryPoint: (trajectoryId: string, pointId: string, patch: Partial<Scene3DTrajectoryPoint>) => void
}

type TimelineRow =
  | {
    type: 'group'
    id: string
    selectionGroupId: string | null
    group?: Scene3DTrajectoryGroup
    name: string
    trajectoryCount: number
    collapsible: boolean
    virtual?: boolean
  }
  | {
    type: 'trajectory'
    id: string
    trajectory: Scene3DTrajectory
    binding?: Scene3DTrajectoryBinding
    depth: 0 | 1
  }

export const UNGROUPED_TRAJECTORY_GROUP_ID = '__ungrouped_trajectories__'
const MIN_BINDING_DURATION = 0.1
const MIN_POINT_TIME_GAP = 0.01

function formatSeconds(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)}s`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function TimelinePlayhead({
  totalDuration,
  containerRef,
  playheadRef,
}: {
  totalDuration: number
  containerRef: React.RefObject<HTMLDivElement>
  playheadRef: React.MutableRefObject<number>
}): JSX.Element {
  const playheadSeconds = useScene3DTrajectoryRuntimeStore((state) => state.playheadSeconds)
  const draggingRef = React.useRef(false)

  const setPlayheadFromClientX = React.useCallback((clientX: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const ratio = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0
    const nextSeconds = ratio * totalDuration
    playheadRef.current = nextSeconds
    setScene3DPlayheadSeconds(nextSeconds)
  }, [containerRef, playheadRef, totalDuration])

  React.useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!draggingRef.current) return
      setPlayheadFromClientX(event.clientX)
    }
    const handleUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [setPlayheadFromClientX])

  const left = `${clamp(playheadSeconds / Math.max(0.001, totalDuration), 0, 1) * 100}%`

  return (
    <button
      className="absolute inset-y-0 z-[2] grid w-4 -translate-x-1/2 place-items-center border-0 bg-transparent p-0"
      style={{ left }}
      type="button"
      title="拖动播放头"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        draggingRef.current = true
        setPlayheadFromClientX(event.clientX)
      }}
    >
      <span className="h-full min-h-10 w-0.5 rounded-full bg-[var(--nomi-ink)] shadow-sm" />
      <span className="absolute top-0 size-3 rounded-full border border-[var(--nomi-ink)] bg-[var(--nomi-paper)]" />
    </button>
  )
}

function buildTimelineRows({
  trajectories,
  bindings,
  groups,
  collapsedGroupIds,
}: {
  trajectories: Scene3DTrajectory[]
  bindings: Scene3DTrajectoryBinding[]
  groups: Scene3DTrajectoryGroup[]
  collapsedGroupIds: Set<string>
}): TimelineRow[] {
  const trajectoryById = new Map(trajectories.map((trajectory) => [trajectory.id, trajectory]))
  const bindingByTrajectoryId = new Map(
    bindings
      .filter((binding) => binding.objects.length > 0)
      .map((binding) => [binding.trajectoryId, binding]),
  )
  const assignedTrajectoryIds = new Set<string>()
  const rows: TimelineRow[] = []

  rows.push({
    type: 'group',
    id: '__all_trajectories__',
    selectionGroupId: null,
    name: '全部轨迹',
    trajectoryCount: trajectories.length,
    collapsible: false,
    virtual: true,
  })

  groups.forEach((group) => {
    const groupTrajectories = group.trajectoryIds
      .map((trajectoryId) => trajectoryById.get(trajectoryId))
      .filter((trajectory): trajectory is Scene3DTrajectory => Boolean(trajectory))
    groupTrajectories.forEach((trajectory) => assignedTrajectoryIds.add(trajectory.id))
    rows.push({
      type: 'group',
      id: group.id,
      selectionGroupId: group.id,
      group,
      name: group.name,
      trajectoryCount: groupTrajectories.length,
      collapsible: true,
    })
    if (!collapsedGroupIds.has(group.id)) {
      groupTrajectories.forEach((trajectory) => {
        rows.push({
          type: 'trajectory',
          id: trajectory.id,
          trajectory,
          binding: bindingByTrajectoryId.get(trajectory.id),
          depth: 1,
        })
      })
    }
  })

  const ungroupedTrajectories = trajectories.filter((trajectory) => !assignedTrajectoryIds.has(trajectory.id))
  if (ungroupedTrajectories.length > 0) {
    rows.push({
      type: 'group',
      id: UNGROUPED_TRAJECTORY_GROUP_ID,
      selectionGroupId: UNGROUPED_TRAJECTORY_GROUP_ID,
      name: '未分组',
      trajectoryCount: ungroupedTrajectories.length,
      collapsible: true,
      virtual: true,
    })
    if (!collapsedGroupIds.has(UNGROUPED_TRAJECTORY_GROUP_ID)) {
      ungroupedTrajectories.forEach((trajectory) => {
        rows.push({
          type: 'trajectory',
          id: trajectory.id,
          trajectory,
          binding: bindingByTrajectoryId.get(trajectory.id),
          depth: 1,
        })
      })
    }
  }

  return rows
}

function GroupNameEditor({
  group,
  onCancel,
  onRenameGroup,
}: {
  group: Scene3DTrajectoryGroup
  onCancel: () => void
  onRenameGroup: (groupId: string, name: string) => void
}): JSX.Element {
  const commit = React.useCallback((value: string) => {
    onRenameGroup(group.id, value)
    onCancel()
  }, [group.id, onCancel, onRenameGroup])

  return (
    <input
      autoFocus
      className="h-6 min-w-0 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-1.5 text-micro text-[var(--nomi-ink)] outline-none"
      defaultValue={group.name}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    />
  )
}

export function TrajectoryTimeline({
  visible,
  isPlaying,
  readOnly,
  activeGroupId,
  playheadRef,
  onPlayChange,
  onSelectGroup,
  onSelectTrajectory,
  onClose,
  onAddGroup,
  onRenameGroup,
  onPatchBinding,
  onPatchTrajectoryPoint,
}: TrajectoryTimelineProps): JSX.Element | null {
  const laneRef = React.useRef<HTMLDivElement>(null)
  const trajectories = useScene3DTrajectoryRuntimeStore((state) => state.trajectories)
  const trajectoryBindings = useScene3DTrajectoryRuntimeStore((state) => state.trajectoryBindings)
  const trajectoryGroups = useScene3DTrajectoryRuntimeStore((state) => state.trajectoryGroups)
  const totalDuration = useScene3DTrajectoryRuntimeStore((state) => Math.max(0.001, state.sceneTimeline.totalDuration))
  const [collapsedGroupIds, setCollapsedGroupIds] = React.useState<Set<string>>(() => new Set())
  const [renamingGroupId, setRenamingGroupId] = React.useState<string | null>(null)
  const rows = React.useMemo(() => buildTimelineRows({
    trajectories,
    bindings: trajectoryBindings,
    groups: trajectoryGroups,
    collapsedGroupIds,
  }), [collapsedGroupIds, trajectories, trajectoryBindings, trajectoryGroups])

  const toggleGroup = React.useCallback((groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  if (!visible) return null

  return (
    <div
      className="pointer-events-auto absolute inset-x-4 bottom-4 z-[5] max-w-none rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-3 text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          className="grid size-8 place-items-center rounded-nomi-sm bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:opacity-90"
          type="button"
          title={isPlaying ? '暂停' : '播放'}
          onClick={() => onPlayChange(!isPlaying)}
        >
          {isPlaying ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
        </button>
        <button
          className="grid size-8 place-items-center rounded-nomi-sm bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
          type="button"
          title="归零"
          onClick={() => {
            playheadRef.current = 0
            setScene3DPlayheadSeconds(0)
          }}
        >
          <IconPlayerSkipBack size={16} />
        </button>
        <div className="min-w-0 flex-1 text-caption font-medium">轨迹时间轴</div>
        <div className="text-micro text-[var(--nomi-ink-40)]">{formatSeconds(totalDuration)}</div>
        <button
          className="grid size-8 place-items-center rounded-nomi-sm bg-[var(--nomi-ink-05)] text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
          type="button"
          title="隐藏轨迹时间轴"
          onClick={onClose}
        >
          <IconX size={15} />
        </button>
      </div>
      <div className="grid max-h-[34vh] min-h-[132px] grid-cols-[190px_minmax(0,1fr)] overflow-hidden rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)]">
        <div className="min-w-0 border-r border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2">
          <div className="flex h-6 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-micro font-medium text-[var(--nomi-ink)]">
              <IconFolder size={14} stroke={1.9} />
              <span className="min-w-0 truncate">轨道组</span>
            </div>
            <button
              className="grid size-6 place-items-center rounded-nomi-sm text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)] disabled:opacity-45"
              disabled={readOnly}
              type="button"
              title="新增空白组"
              onClick={onAddGroup}
            >
              <IconFolderPlus size={14} stroke={1.9} />
            </button>
          </div>
          <div className="mt-2 grid max-h-[calc(34vh-54px)] gap-1 overflow-auto pr-1">
            {rows.length === 0 ? (
              <div className="grid h-12 place-items-center rounded-nomi-sm border border-dashed border-[var(--nomi-line-soft)] text-micro text-[var(--nomi-ink-40)]">
                暂无轨迹
              </div>
            ) : rows.map((row) => {
              if (row.type !== 'group') {
                return (
                  <button
                    key={row.id}
                    className={cn(
                      'grid h-7 grid-cols-[16px_minmax(0,1fr)_40px] items-center gap-1 rounded-nomi-sm pr-1 text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)]',
                      row.depth === 1 && 'pl-7',
                    )}
                    type="button"
                    onClick={() => onSelectTrajectory(row.trajectory.id)}
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: row.trajectory.color }} />
                    <span className="min-w-0 truncate text-micro">{row.trajectory.name}</span>
                    <span className="justify-self-end text-micro text-[var(--nomi-ink-40)]">{row.binding ? '已绑定' : '未绑定'}</span>
                  </button>
                )
              }

              const selected = row.selectionGroupId === activeGroupId
              return (
                <div
                  key={row.id}
                  className={cn(
                    'grid h-7 grid-cols-[20px_16px_minmax(0,1fr)_28px] items-center gap-1 rounded-nomi-sm px-1 text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-05)]',
                    selected && 'bg-[var(--nomi-ink)] text-[var(--nomi-paper)] hover:bg-[var(--nomi-ink)] hover:text-[var(--nomi-paper)]',
                  )}
                  onClick={() => onSelectGroup(row.selectionGroupId)}
                >
                  {row.collapsible ? (
                    <button
                      className="grid size-5 place-items-center rounded-nomi-sm hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]"
                      type="button"
                      title={collapsedGroupIds.has(row.id) ? '展开' : '收起'}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleGroup(row.id)
                      }}
                    >
                      {collapsedGroupIds.has(row.id) ? <IconChevronRight size={13} /> : <IconChevronDown size={13} />}
                    </button>
                  ) : <span />}
                  <IconFolder
                    size={13}
                    stroke={1.9}
                    className={selected ? 'text-[var(--nomi-paper)]' : 'text-[var(--nomi-ink-40)]'}
                  />
                  {row.group && renamingGroupId === row.group.id ? (
                    <GroupNameEditor
                      group={row.group}
                      onCancel={() => setRenamingGroupId(null)}
                      onRenameGroup={onRenameGroup}
                    />
                  ) : (
                    <button
                      className="min-w-0 truncate bg-transparent p-0 text-left text-micro font-medium text-inherit"
                      type="button"
                      title={row.virtual ? undefined : '双击重命名'}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectGroup(row.selectionGroupId)
                      }}
                      onDoubleClick={() => {
                        if (!readOnly && row.group) setRenamingGroupId(row.group.id)
                      }}
                    >
                      {row.name}
                    </button>
                  )}
                  <span className={cn(
                    'justify-self-end text-micro',
                    selected ? 'text-[var(--nomi-paper)] opacity-75' : 'text-[var(--nomi-ink-40)]',
                  )}
                  >
                    {row.trajectoryCount}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="min-w-0 p-2">
          <div className="grid grid-cols-5 text-micro text-[var(--nomi-ink-40)]">
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
              <span key={ratio} className={cn(ratio === 0.5 && 'text-center', ratio > 0.5 && 'text-right')}>
                {formatSeconds(ratio * totalDuration)}
              </span>
            ))}
          </div>
          <div
            ref={laneRef}
            className="relative mt-2 grid max-h-[calc(34vh-54px)] min-w-0 gap-1 overflow-auto pr-1"
          >
            {rows.length === 0 ? (
              <div className="grid h-12 place-items-center text-micro text-[var(--nomi-ink-40)]">暂无绑定区间</div>
            ) : rows.map((row) => row.type === 'group' ? (
              <div key={row.id} className="h-7 rounded-nomi-sm bg-[var(--nomi-paper)]/70" />
            ) : (
              <div key={row.id} className="relative h-7 rounded-nomi-sm bg-[var(--nomi-paper)]">
                {row.binding ? (
                  <TimelineBindingBar
                    binding={row.binding}
                    trajectory={row.trajectory}
                    totalDuration={totalDuration}
                    readOnly={readOnly}
                    laneRef={laneRef}
                    onPatchBinding={onPatchBinding}
                    onPatchTrajectoryPoint={onPatchTrajectoryPoint}
                  />
                ) : (
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-micro text-[var(--nomi-ink-30)]">未绑定</span>
                )}
              </div>
            ))}
            {rows.length > 0 ? (
              <TimelinePlayhead totalDuration={totalDuration} containerRef={laneRef} playheadRef={playheadRef} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function TimelineBindingBar({
  binding,
  trajectory,
  totalDuration,
  readOnly,
  laneRef,
  onPatchBinding,
  onPatchTrajectoryPoint,
}: {
  binding: Scene3DTrajectoryBinding
  trajectory: Scene3DTrajectory
  totalDuration: number
  readOnly: boolean
  laneRef: React.RefObject<HTMLDivElement>
  onPatchBinding: (bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => void
  onPatchTrajectoryPoint: (trajectoryId: string, pointId: string, patch: Partial<Scene3DTrajectoryPoint>) => void
}): JSX.Element {
  const barRef = React.useRef<HTMLDivElement>(null)
  const start = clamp(binding.startTime / totalDuration, 0, 1)
  const end = clamp(binding.endTime / totalDuration, 0, 1)
  const pointCount = trajectory.points.length
  const objectSummary = binding.objects.length > 0 ? `${binding.objects.length}节点` : '未绑定'
  const dragRef = React.useRef<{
    mode: 'move' | 'start' | 'end'
    clientX: number
    startTime: number
    endTime: number
  } | null>(null)
  const pointDragRef = React.useRef<{
    pointId: string
    pointIndex: number
    clientX: number
    startRatio: number
  } | null>(null)

  const applyDragDelta = React.useCallback((deltaSeconds: number) => {
    const drag = dragRef.current
    if (!drag) return
    const duration = Math.max(MIN_BINDING_DURATION, drag.endTime - drag.startTime)
    if (drag.mode === 'move') {
      const nextStart = clamp(drag.startTime + deltaSeconds, 0, Math.max(0, totalDuration - duration))
      onPatchBinding(binding.id, {
        startTime: Number(nextStart.toFixed(3)),
        endTime: Number((nextStart + duration).toFixed(3)),
      })
      return
    }
    if (drag.mode === 'start') {
      const nextStart = clamp(drag.startTime + deltaSeconds, 0, Math.max(0, drag.endTime - MIN_BINDING_DURATION))
      onPatchBinding(binding.id, { startTime: Number(nextStart.toFixed(3)) })
      return
    }
    const nextEnd = clamp(drag.endTime + deltaSeconds, drag.startTime + MIN_BINDING_DURATION, totalDuration)
    onPatchBinding(binding.id, { endTime: Number(nextEnd.toFixed(3)) })
  }, [binding.id, onPatchBinding, totalDuration])

  const startDrag = React.useCallback((event: React.PointerEvent, mode: 'move' | 'start' | 'end') => {
    if (readOnly) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      mode,
      clientX: event.clientX,
      startTime: binding.startTime,
      endTime: binding.endTime,
    }
    const handleMove = (moveEvent: PointerEvent) => {
      const lane = laneRef.current
      const drag = dragRef.current
      if (!lane || !drag) return
      const rect = lane.getBoundingClientRect()
      const deltaSeconds = rect.width > 0 ? ((moveEvent.clientX - drag.clientX) / rect.width) * totalDuration : 0
      applyDragDelta(deltaSeconds)
    }
    const handleUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [applyDragDelta, binding.endTime, binding.startTime, laneRef, readOnly, totalDuration])

  const patchPointRatio = React.useCallback((pointIndex: number, pointId: string, nextRatio: number) => {
    const previousRatio = pointIndex <= 1
      ? 0
      : trajectoryPointTimeRatio(trajectory, pointIndex - 1)
    const nextRatioLimit = pointIndex >= pointCount - 1
      ? 1
      : trajectoryPointTimeRatio(trajectory, pointIndex + 1)
    const min = Math.min(1, previousRatio + MIN_POINT_TIME_GAP)
    const max = Math.max(0, nextRatioLimit - MIN_POINT_TIME_GAP)
    const lower = Math.min(min, max)
    const upper = Math.max(min, max)
    onPatchTrajectoryPoint(trajectory.id, pointId, {
      timeRatio: Number(clamp(nextRatio, lower, upper).toFixed(4)),
    })
  }, [onPatchTrajectoryPoint, pointCount, trajectory])

  const startPointDrag = React.useCallback((event: React.PointerEvent, pointIndex: number, pointId: string) => {
    if (readOnly) return
    event.preventDefault()
    event.stopPropagation()
    const locked = pointIndex === 0 || (!trajectory.closed && pointIndex === pointCount - 1)
    if (locked) return
    pointDragRef.current = {
      pointId,
      pointIndex,
      clientX: event.clientX,
      startRatio: trajectoryPointTimeRatio(trajectory, pointIndex),
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const bar = barRef.current
      const drag = pointDragRef.current
      if (!bar || !drag) return
      const rect = bar.getBoundingClientRect()
      const deltaRatio = rect.width > 0 ? (moveEvent.clientX - drag.clientX) / rect.width : 0
      patchPointRatio(drag.pointIndex, drag.pointId, drag.startRatio + deltaRatio)
    }
    const handleUp = () => {
      pointDragRef.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [patchPointRatio, pointCount, readOnly, trajectory])

  return (
    <div
      ref={barRef}
      className={cn(
        'absolute inset-y-0 rounded-nomi-sm border border-nomi-paper/70 shadow-nomi-sm',
        readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
      )}
      style={{
        left: `${start * 100}%`,
        width: `${Math.max(1, (end - start) * 100)}%`,
        backgroundColor: trajectory.color,
      }}
      title={`${trajectory.name} ${formatSeconds(binding.startTime)} - ${formatSeconds(binding.endTime)}`}
      onPointerDown={(event) => startDrag(event, 'move')}
    >
      {!readOnly ? (
        <>
          <span
            className="absolute inset-y-0 left-0 z-[1] w-2 cursor-ew-resize rounded-l-nomi-sm bg-nomi-ink-20 hover:bg-nomi-ink-30"
            title="拖动开始时间"
            onPointerDown={(event) => startDrag(event, 'start')}
          />
          <span
            className="absolute inset-y-0 right-0 z-[1] w-2 cursor-ew-resize rounded-r-nomi-sm bg-nomi-ink-20 hover:bg-nomi-ink-30"
            title="拖动结束时间"
            onPointerDown={(event) => startDrag(event, 'end')}
          />
        </>
      ) : null}
      <span className="block truncate px-1.5 text-micro leading-7 text-nomi-paper">{objectSummary}</span>
      {pointCount > 1 ? trajectory.points.map((point, pointIndex) => {
        const ratio = trajectoryPointTimeRatio(trajectory, pointIndex)
        const locked = pointIndex === 0 || (!trajectory.closed && pointIndex === pointCount - 1)
        return (
          <button
            key={point.id}
            className={cn(
              'absolute top-1/2 z-[2] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-nomi-paper bg-nomi-paper shadow-nomi-sm',
              locked || readOnly ? 'cursor-default opacity-90' : 'cursor-ew-resize hover:scale-110',
            )}
            style={{ left: `${ratio * 100}%` }}
            type="button"
            title={locked ? '轨迹端点时间固定' : '拖动轨迹点时间'}
            onPointerDown={(event) => startPointDrag(event, pointIndex, point.id)}
          />
        )
      }) : null}
    </div>
  )
}
