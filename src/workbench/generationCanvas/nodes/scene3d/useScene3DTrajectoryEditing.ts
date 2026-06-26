import React from 'react'
import {
  createScene3DTrajectoryBindingId,
  createScene3DTrajectoryGroupId,
  createScene3DTrajectoryId,
  createScene3DTrajectoryPointId,
} from './scene3dSerializer'
import { UNGROUPED_TRAJECTORY_GROUP_ID } from './scene3dConstants'
import { trajectoryBindTargetsFromState } from './scene3dTrajectoryState'
import type {
  Scene3DState,
  Scene3DTrajectory,
  Scene3DTrajectoryBinding,
  Scene3DTrajectoryBoundObject,
  Scene3DTrajectoryPoint,
  Scene3DVector3,
} from './scene3dTypes'
import {
  setScene3DObjectRuntimeRefsVisible,
  setScene3DTrajectorySnapshot,
} from './trajectory/trajectoryRuntimeStore'
import type { TrajectoryBindTarget } from './trajectory/TrajectoryRenderer'

const TRAJECTORY_COLOR_SEQUENCE = ['#ef4444', '#facc15', '#3b82f6', '#22c55e'] as const
const NEW_TRAJECTORY_SECOND_POINT_OFFSET = 3

type Scene3DStateSetter = React.Dispatch<React.SetStateAction<Scene3DState>>

export type Scene3DTrajectoryEditing = {
  activeTrajectoryId: string | null
  activePointId: string | null
  activeGroupId: string | null
  activeTrajectoryIds: ReadonlySet<string> | null
  trajectoryEditMode: boolean
  timelineOpen: boolean
  isPlaying: boolean
  hasPlayableBinding: boolean
  playheadRef: React.MutableRefObject<number>
  bindTargets: TrajectoryBindTarget[]
  setTrajectoryEditMode: (enabled: boolean) => void
  setTimelineOpen: (open: boolean) => void
  setIsPlaying: (playing: boolean) => void
  selectTrajectory: (trajectoryId: string) => void
  selectPoint: (trajectoryId: string, pointId: string) => void
  selectGroup: (groupId: string | null) => void
  createTrajectory: () => void
  createTrajectoryAt: (position: Scene3DVector3) => void
  deleteTrajectory: (trajectoryId: string) => void
  patchTrajectory: (trajectoryId: string, patch: Partial<Scene3DTrajectory>) => void
  addPoint: (trajectoryId: string) => void
  insertPoint: (
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => void
  updatePoint: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  patchTrajectoryPoint: (trajectoryId: string, pointId: string, patch: Partial<Scene3DTrajectoryPoint>) => void
  deletePoint: (trajectoryId: string, pointId: string) => void
  updateCurveControl: (trajectoryId: string, segmentStartPointId: string, position: Scene3DVector3 | null) => void
  translateTrajectory: (trajectoryId: string, delta: Scene3DVector3) => void
  bindObject: (trajectoryId: string, objectId: string, offsetRatio?: number) => void
  patchBinding: (bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => void
  patchBoundObject: (bindingId: string, objectId: string, patch: Partial<Scene3DTrajectoryBoundObject>) => void
  unbindObject: (bindingId: string, objectId: string) => void
  deleteBinding: (bindingId: string) => void
  addGroup: () => void
  renameGroup: (groupId: string, name: string) => void
}

function nextTrajectoryColor(count: number): string {
  return TRAJECTORY_COLOR_SEQUENCE[count % TRAJECTORY_COLOR_SEQUENCE.length]
}

function makeTrajectory(index: number, firstPosition: Scene3DVector3): Scene3DTrajectory {
  return {
    id: createScene3DTrajectoryId(),
    name: `轨迹${index + 1}`,
    points: [
      { id: createScene3DTrajectoryPointId(), position: [...firstPosition] },
      {
        id: createScene3DTrajectoryPointId(),
        position: [firstPosition[0] + NEW_TRAJECTORY_SECOND_POINT_OFFSET, firstPosition[1], firstPosition[2]],
      },
    ],
    curveControls: [],
    tension: 0.5,
    closed: false,
    color: nextTrajectoryColor(index),
  }
}

export function useScene3DTrajectoryEditing({
  state,
  setState,
  readOnly,
}: {
  state: Scene3DState
  setState: Scene3DStateSetter
  readOnly: boolean
}): Scene3DTrajectoryEditing {
  const [activeTrajectoryId, setActiveTrajectoryId] = React.useState<string | null>(null)
  const [activePointId, setActivePointId] = React.useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = React.useState<string | null>(null)
  const [trajectoryEditMode, setTrajectoryEditModeState] = React.useState(false)
  const [timelineOpen, setTimelineOpen] = React.useState(false)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const playheadRef = React.useRef(0)

  // Mirror persisted trajectory data into the non-persisted runtime store so the
  // playback hook / timeline read live data without re-render churn.
  React.useEffect(() => {
    setScene3DTrajectorySnapshot({
      trajectories: state.trajectories,
      trajectoryBindings: state.trajectoryBindings,
      trajectoryGroups: state.trajectoryGroups,
      sceneTimeline: state.sceneTimeline,
    })
  }, [state.sceneTimeline, state.trajectories, state.trajectoryBindings, state.trajectoryGroups])

  // Drop stale selection if the active trajectory/point was removed elsewhere.
  React.useEffect(() => {
    if (activeTrajectoryId && !state.trajectories.some((trajectory) => trajectory.id === activeTrajectoryId)) {
      setActiveTrajectoryId(null)
      setActivePointId(null)
    }
  }, [activeTrajectoryId, state.trajectories])

  const activeTrajectoryIds = React.useMemo<ReadonlySet<string> | null>(() => {
    if (!activeGroupId) return null
    if (activeGroupId === UNGROUPED_TRAJECTORY_GROUP_ID) {
      const groupedIds = new Set<string>()
      state.trajectoryGroups.forEach((group) => {
        group.trajectoryIds.forEach((trajectoryId) => groupedIds.add(trajectoryId))
      })
      return new Set(
        state.trajectories
          .filter((trajectory) => !groupedIds.has(trajectory.id))
          .map((trajectory) => trajectory.id),
      )
    }
    return new Set(state.trajectoryGroups.find((group) => group.id === activeGroupId)?.trajectoryIds ?? [])
  }, [activeGroupId, state.trajectories, state.trajectoryGroups])

  const bindTargets = React.useMemo<TrajectoryBindTarget[]>(() => trajectoryBindTargetsFromState(state), [state])
  const hasPlayableBinding = React.useMemo(() => state.trajectoryBindings.some((binding) => (
    binding.objects.length > 0 &&
    (!activeTrajectoryIds || activeTrajectoryIds.has(binding.trajectoryId))
  )), [activeTrajectoryIds, state.trajectoryBindings])

  const selectTrajectory = React.useCallback((trajectoryId: string) => {
    setActiveTrajectoryId(trajectoryId)
    setActivePointId(null)
  }, [])

  const selectPoint = React.useCallback((trajectoryId: string, pointId: string) => {
    setActiveTrajectoryId(trajectoryId)
    setActivePointId(pointId)
  }, [])

  const selectGroup = React.useCallback((groupId: string | null) => {
    setIsPlaying(false)
    setActiveGroupId(groupId)
  }, [])

  const setTrajectoryEditMode = React.useCallback((enabled: boolean) => {
    setTrajectoryEditModeState(enabled)
    if (!enabled) setActivePointId(null)
  }, [])

  const createTrajectoryAt = React.useCallback((position: Scene3DVector3) => {
    if (readOnly) return
    let createdId = ''
    setState((current) => {
      const trajectory = makeTrajectory(current.trajectories.length, position)
      createdId = trajectory.id
      return { ...current, trajectories: [...current.trajectories, trajectory] }
    })
    if (createdId) {
      setActiveTrajectoryId(createdId)
      setActivePointId(null)
      setTrajectoryEditModeState(true)
    }
  }, [readOnly, setState])

  const createTrajectory = React.useCallback(() => {
    createTrajectoryAt([0, 0, 0])
  }, [createTrajectoryAt])

  const deleteTrajectory = React.useCallback((trajectoryId: string) => {
    if (readOnly) return
    setState((current) => {
      current.trajectoryBindings
        .filter((binding) => binding.trajectoryId === trajectoryId)
        .forEach((binding) => {
          binding.objects.forEach((object) => setScene3DObjectRuntimeRefsVisible(object.objectId, true))
        })
      return {
        ...current,
        trajectories: current.trajectories.filter((trajectory) => trajectory.id !== trajectoryId),
        trajectoryBindings: current.trajectoryBindings.filter((binding) => binding.trajectoryId !== trajectoryId),
        trajectoryGroups: current.trajectoryGroups.map((group) => ({
          ...group,
          trajectoryIds: group.trajectoryIds.filter((id) => id !== trajectoryId),
        })),
      }
    })
    setActiveTrajectoryId((current) => (current === trajectoryId ? null : current))
    setActivePointId(null)
  }, [readOnly, setState])

  const patchTrajectory = React.useCallback((trajectoryId: string, patch: Partial<Scene3DTrajectory>) => {
    if (readOnly) return
    setState((current) => ({
      ...current,
      trajectories: current.trajectories.map((trajectory) => (
        trajectory.id === trajectoryId ? { ...trajectory, ...patch } : trajectory
      )),
    }))
  }, [readOnly, setState])

  const mutateTrajectoryPoints = React.useCallback((
    trajectoryId: string,
    mutate: (trajectory: Scene3DTrajectory) => Scene3DTrajectory,
  ) => {
    if (readOnly) return
    setState((current) => ({
      ...current,
      trajectories: current.trajectories.map((trajectory) => (
        trajectory.id === trajectoryId ? mutate(trajectory) : trajectory
      )),
    }))
  }, [readOnly, setState])

  const addPoint = React.useCallback((trajectoryId: string) => {
    mutateTrajectoryPoints(trajectoryId, (trajectory) => {
      const last = trajectory.points[trajectory.points.length - 1]
      const basis: Scene3DVector3 = last ? last.position : [0, 0, 0]
      const point: Scene3DTrajectoryPoint = {
        id: createScene3DTrajectoryPointId(),
        position: [basis[0] + 1, basis[1], basis[2]],
      }
      return { ...trajectory, points: [...trajectory.points, point] }
    })
  }, [mutateTrajectoryPoints])

  const insertPoint = React.useCallback((
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement: 'before' | 'after' = 'after',
  ) => {
    let insertedId = ''
    mutateTrajectoryPoints(trajectoryId, (trajectory) => {
      const point: Scene3DTrajectoryPoint = { id: createScene3DTrajectoryPointId(), position: [...position] }
      insertedId = point.id
      if (!targetPointId) {
        return { ...trajectory, points: [...trajectory.points, point] }
      }
      const targetIndex = trajectory.points.findIndex((candidate) => candidate.id === targetPointId)
      if (targetIndex < 0) return { ...trajectory, points: [...trajectory.points, point] }
      const insertIndex = placement === 'before' ? targetIndex : targetIndex + 1
      const points = [...trajectory.points]
      points.splice(insertIndex, 0, point)
      return { ...trajectory, points }
    })
    if (insertedId) {
      setActiveTrajectoryId(trajectoryId)
      setActivePointId(insertedId)
    }
  }, [mutateTrajectoryPoints])

  const updatePoint = React.useCallback((trajectoryId: string, pointId: string, position: Scene3DVector3) => {
    mutateTrajectoryPoints(trajectoryId, (trajectory) => ({
      ...trajectory,
      points: trajectory.points.map((point) => (point.id === pointId ? { ...point, position: [...position] } : point)),
    }))
  }, [mutateTrajectoryPoints])

  const patchTrajectoryPoint = React.useCallback((
    trajectoryId: string,
    pointId: string,
    patch: Partial<Scene3DTrajectoryPoint>,
  ) => {
    mutateTrajectoryPoints(trajectoryId, (trajectory) => ({
      ...trajectory,
      points: trajectory.points.map((point) => (point.id === pointId ? { ...point, ...patch } : point)),
    }))
  }, [mutateTrajectoryPoints])

  const deletePoint = React.useCallback((trajectoryId: string, pointId: string) => {
    mutateTrajectoryPoints(trajectoryId, (trajectory) => {
      if (trajectory.points.length <= 2) return trajectory
      return {
        ...trajectory,
        points: trajectory.points.filter((point) => point.id !== pointId),
        curveControls: trajectory.curveControls?.filter((control) => control.segmentStartPointId !== pointId),
      }
    })
    setActivePointId((current) => (current === pointId ? null : current))
  }, [mutateTrajectoryPoints])

  const updateCurveControl = React.useCallback((
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => {
    mutateTrajectoryPoints(trajectoryId, (trajectory) => {
      const others = (trajectory.curveControls ?? []).filter((control) => control.segmentStartPointId !== segmentStartPointId)
      return {
        ...trajectory,
        curveControls: position === null
          ? others
          : [...others, { segmentStartPointId, position: [...position] }],
      }
    })
  }, [mutateTrajectoryPoints])

  const translateTrajectory = React.useCallback((trajectoryId: string, delta: Scene3DVector3) => {
    mutateTrajectoryPoints(trajectoryId, (trajectory) => ({
      ...trajectory,
      points: trajectory.points.map((point) => ({
        ...point,
        position: [point.position[0] + delta[0], point.position[1] + delta[1], point.position[2] + delta[2]],
      })),
      curveControls: trajectory.curveControls?.map((control) => ({
        ...control,
        position: [control.position[0] + delta[0], control.position[1] + delta[1], control.position[2] + delta[2]],
      })),
    }))
  }, [mutateTrajectoryPoints])

  const bindObject = React.useCallback((trajectoryId: string, objectId: string, offsetRatio = 0) => {
    if (readOnly) return
    setState((current) => {
      if (current.trajectoryBindings.some((binding) => (
        binding.objects.some((object) => object.objectId === objectId)
      ))) {
        return current
      }
      const boundObject: Scene3DTrajectoryBoundObject = { objectId, offsetRatio }
      const existing = current.trajectoryBindings.find((binding) => binding.trajectoryId === trajectoryId)
      if (existing) {
        return {
          ...current,
          trajectoryBindings: current.trajectoryBindings.map((binding) => (
            binding.id === existing.id
              ? { ...binding, objects: [...binding.objects, boundObject] }
              : binding
          )),
        }
      }
      const binding: Scene3DTrajectoryBinding = {
        id: createScene3DTrajectoryBindingId(),
        trajectoryId,
        objects: [boundObject],
        startTime: 0,
        endTime: Math.max(0.1, current.sceneTimeline.totalDuration),
        direction: 'forward',
      }
      return {
        ...current,
        trajectoryBindings: [...current.trajectoryBindings, binding],
        sceneTimeline: binding.endTime > current.sceneTimeline.totalDuration
          ? { ...current.sceneTimeline, totalDuration: binding.endTime }
          : current.sceneTimeline,
      }
    })
  }, [readOnly, setState])

  const patchBinding = React.useCallback((bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => {
    if (readOnly) return
    setState((current) => {
      let nextMaxEndTime = current.sceneTimeline.totalDuration
      const trajectoryBindings = current.trajectoryBindings.map((binding) => {
        if (binding.id !== bindingId) return binding
        const nextBinding = { ...binding, ...patch }
        const startTime = Math.max(0, Number.isFinite(nextBinding.startTime) ? nextBinding.startTime : binding.startTime)
        const endTime = Math.max(
          startTime + 0.001,
          Number.isFinite(nextBinding.endTime) ? nextBinding.endTime : binding.endTime,
        )
        nextMaxEndTime = Math.max(nextMaxEndTime, endTime)
        return { ...nextBinding, startTime, endTime }
      })
      return {
        ...current,
        trajectoryBindings,
        sceneTimeline: nextMaxEndTime === current.sceneTimeline.totalDuration
          ? current.sceneTimeline
          : { ...current.sceneTimeline, totalDuration: nextMaxEndTime },
      }
    })
  }, [readOnly, setState])

  const patchBoundObject = React.useCallback((
    bindingId: string,
    objectId: string,
    patch: Partial<Scene3DTrajectoryBoundObject>,
  ) => {
    if (readOnly) return
    setState((current) => ({
      ...current,
      trajectoryBindings: current.trajectoryBindings.map((binding) => (
        binding.id === bindingId
          ? {
              ...binding,
              objects: binding.objects.map((object) => (
                object.objectId === objectId ? { ...object, ...patch } : object
              )),
            }
          : binding
      )),
    }))
  }, [readOnly, setState])

  const unbindObject = React.useCallback((bindingId: string, objectId: string) => {
    if (readOnly) return
    setState((current) => ({
      ...current,
      trajectoryBindings: current.trajectoryBindings.flatMap((binding) => {
        if (binding.id !== bindingId) return [binding]
        const objects = binding.objects.filter((object) => object.objectId !== objectId)
        if (objects.length !== binding.objects.length) setScene3DObjectRuntimeRefsVisible(objectId, true)
        return objects.length > 0 ? [{ ...binding, objects }] : []
      }),
    }))
  }, [readOnly, setState])

  const deleteBinding = React.useCallback((bindingId: string) => {
    if (readOnly) return
    setState((current) => {
      const binding = current.trajectoryBindings.find((candidate) => candidate.id === bindingId)
      binding?.objects.forEach((object) => setScene3DObjectRuntimeRefsVisible(object.objectId, true))
      return {
        ...current,
        trajectoryBindings: current.trajectoryBindings.filter((binding) => binding.id !== bindingId),
      }
    })
  }, [readOnly, setState])

  const addGroup = React.useCallback(() => {
    if (readOnly) return
    let createdId = ''
    setState((current) => {
      const group = {
        id: createScene3DTrajectoryGroupId(),
        name: `组${current.trajectoryGroups.length + 1}`,
        trajectoryIds: [],
      }
      createdId = group.id
      return { ...current, trajectoryGroups: [...current.trajectoryGroups, group] }
    })
    if (createdId) setActiveGroupId(createdId)
  }, [readOnly, setState])

  const renameGroup = React.useCallback((groupId: string, name: string) => {
    if (readOnly) return
    const trimmed = name.trim()
    if (!trimmed) return
    setState((current) => ({
      ...current,
      trajectoryGroups: current.trajectoryGroups.map((group) => (
        group.id === groupId ? { ...group, name: trimmed } : group
      )),
    }))
  }, [readOnly, setState])

  return {
    activeTrajectoryId,
    activePointId,
    activeGroupId,
    activeTrajectoryIds,
    trajectoryEditMode,
    timelineOpen,
    isPlaying,
    hasPlayableBinding,
    playheadRef,
    bindTargets,
    setTrajectoryEditMode,
    setTimelineOpen,
    setIsPlaying,
    selectTrajectory,
    selectPoint,
    selectGroup,
    createTrajectory,
    createTrajectoryAt,
    deleteTrajectory,
    patchTrajectory,
    addPoint,
    insertPoint,
    updatePoint,
    patchTrajectoryPoint,
    deletePoint,
    updateCurveControl,
    translateTrajectory,
    bindObject,
    patchBinding,
    patchBoundObject,
    unbindObject,
    deleteBinding,
    addGroup,
    renameGroup,
  }
}
