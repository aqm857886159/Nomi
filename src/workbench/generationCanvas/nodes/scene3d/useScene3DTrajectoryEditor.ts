import React from 'react'
import { UNGROUPED_TRAJECTORY_GROUP_ID } from './scene3dConstants'
import {
  appendTrajectoryPoint,
  bindNodeToTrajectoryState,
  createTrajectoryAt,
  insertTrajectoryPoint,
  patchTrajectoryBindingState,
  patchTrajectoryBoundObjectState,
  patchTrajectoryCurveControl,
  patchTrajectoryPoint,
  removeTrajectoryBindingState,
  removeTrajectoryBoundObjectState,
  removeTrajectoryPoint,
  removeTrajectoryState,
  renameTrajectoryGroupState,
  trajectoryBindTargetsFromState,
  translateTrajectory,
} from './scene3dTrajectoryState'
import { makeTrajectoryGroup } from './scene3dFactories'
import type {
  Scene3DState,
  Scene3DTrajectory,
  Scene3DTrajectoryBinding,
  Scene3DTrajectoryBoundObject,
  Scene3DTrajectoryPoint,
  Scene3DVector3,
} from './scene3dTypes'
import type { TrajectoryBindTarget } from './trajectory'
import { useScene3DTrajectoryPlayback } from './useScene3DTrajectoryPlayback'

function patchTrajectoryState(
  state: Scene3DState,
  trajectoryId: string,
  updater: (trajectory: Scene3DTrajectory) => Scene3DTrajectory,
): Scene3DState {
  return {
    ...state,
    trajectories: state.trajectories.map((trajectory) => (
      trajectory.id === trajectoryId ? updater(trajectory) : trajectory
    )),
  }
}

export function useScene3DTrajectoryEditor({
  state,
  setState,
  readOnly,
  suspendPlayback = false,
}: {
  state: Scene3DState
  setState: React.Dispatch<React.SetStateAction<Scene3DState>>
  readOnly: boolean
  suspendPlayback?: boolean
}): {
  activeGroupId: string | null
  activePointId: string | null
  activeTrajectoryId: string | null
  activeTrajectoryIds: ReadonlySet<string> | null
  bindTargets: TrajectoryBindTarget[]
  displayState: Scene3DState
  hasPlayableBinding: boolean
  isPlaying: boolean
  playheadRef: React.MutableRefObject<number>
  requestPlayChange: (playing: boolean) => boolean
  resetPlayhead: () => void
  selectGroup: (groupId: string | null) => void
  selectPoint: (trajectoryId: string, pointId: string) => void
  selectTrajectory: (trajectoryId: string) => void
  setTimelineVisible: React.Dispatch<React.SetStateAction<boolean>>
  setTrajectoryPlaying: React.Dispatch<React.SetStateAction<boolean>>
  timelineVisible: boolean
  addTrajectory: () => void
  addTrajectoryAt: (position: Scene3DVector3) => void
  addTrajectoryGroup: () => void
  addTrajectoryPoint: (trajectoryId: string) => void
  bindObjectToTrajectory: (trajectoryId: string, objectId: string, offsetRatio?: number) => void
  deleteTrajectory: (trajectoryId: string) => void
  deleteTrajectoryBinding: (bindingId: string) => void
  deleteTrajectoryPoint: (trajectoryId: string, pointId: string) => void
  insertTrajectoryPointAt: (
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => void
  patchTrajectory: (trajectoryId: string, patch: Partial<Scene3DTrajectory>) => void
  patchTrajectoryBinding: (bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => void
  patchTrajectoryBoundObject: (
    bindingId: string,
    objectId: string,
    patch: Partial<Scene3DTrajectoryBoundObject>,
  ) => void
  patchTrajectoryCurveControl: (
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => void
  patchTrajectoryPointPosition: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  patchTrajectoryPointTiming: (trajectoryId: string, pointId: string, patch: Partial<Scene3DTrajectoryPoint>) => void
  renameTrajectoryGroup: (groupId: string, name: string) => void
  translateTrajectoryBy: (trajectoryId: string, delta: Scene3DVector3) => void
  unbindObjectFromTrajectory: (bindingId: string, objectId: string) => void
} {
  const [activeTrajectoryId, setActiveTrajectoryId] = React.useState<string | null>(() => (
    state.trajectories[0]?.id ?? null
  ))
  const [activePointId, setActivePointId] = React.useState<string | null>(() => (
    state.trajectories[0]?.points[0]?.id ?? null
  ))
  const [activeGroupId, setActiveGroupId] = React.useState<string | null>(null)
  const [timelineVisible, setTimelineVisible] = React.useState(false)
  const [isPlaying, setIsPlaying] = React.useState(false)

  const {
    activeTrajectoryIds,
    displayState,
    hasPlayableBinding,
    playheadRef,
    resetPlayhead,
    stopAtSeconds,
  } = useScene3DTrajectoryPlayback({
    state,
    activeGroupId,
    isPlaying,
    onPlayChange: setIsPlaying,
    suspendPlayback,
  })

  React.useEffect(() => {
    if (!activeTrajectoryId) return
    if (!state.trajectories.some((trajectory) => trajectory.id === activeTrajectoryId)) {
      setActiveTrajectoryId(null)
      setActivePointId(null)
    }
  }, [activeTrajectoryId, state.trajectories])

  React.useEffect(() => {
    if (!activeTrajectoryId || !activePointId) return
    const activeTrajectory = state.trajectories.find((trajectory) => trajectory.id === activeTrajectoryId)
    if (!activeTrajectory?.points.some((point) => point.id === activePointId)) {
      setActivePointId(null)
    }
  }, [activePointId, activeTrajectoryId, state.trajectories])

  React.useEffect(() => {
    if (!activeGroupId || activeGroupId === UNGROUPED_TRAJECTORY_GROUP_ID) return
    if (!state.trajectoryGroups.some((group) => group.id === activeGroupId)) {
      setActiveGroupId(null)
      setIsPlaying(false)
    }
  }, [activeGroupId, state.trajectoryGroups])

  const bindTargets = React.useMemo(() => trajectoryBindTargetsFromState(state), [state])

  const selectTrajectory = React.useCallback((trajectoryId: string) => {
    const trajectory = state.trajectories.find((candidate) => candidate.id === trajectoryId)
    if (!trajectory) return
    setActiveTrajectoryId(trajectoryId)
    setActivePointId((current) => (
      trajectory.points.some((point) => point.id === current)
        ? current
        : trajectory.points[0]?.id ?? null
    ))
  }, [state.trajectories])

  const selectPoint = React.useCallback((trajectoryId: string, pointId: string) => {
    setActiveTrajectoryId(trajectoryId)
    setActivePointId(pointId)
  }, [])

  const selectGroup = React.useCallback((groupId: string | null) => {
    if (activeGroupId !== groupId) {
      setIsPlaying(false)
    }
    setActiveGroupId(groupId)
  }, [activeGroupId])

  const addTrajectoryAt = React.useCallback((position: Scene3DVector3) => {
    if (readOnly) return
    const trajectory = createTrajectoryAt(position, state.trajectories.length)
    setState((current) => ({
      ...current,
      trajectories: [...current.trajectories, trajectory],
    }))
    setActiveTrajectoryId(trajectory.id)
    setActivePointId(trajectory.points[0]?.id ?? null)
    setTimelineVisible(true)
  }, [readOnly, setState, state.trajectories.length])

  const addTrajectory = React.useCallback(() => {
    addTrajectoryAt([0, 0, 0])
  }, [addTrajectoryAt])

  const patchTrajectory = React.useCallback((trajectoryId: string, patch: Partial<Scene3DTrajectory>) => {
    if (readOnly) return
    setState((current) => patchTrajectoryState(current, trajectoryId, (trajectory) => ({ ...trajectory, ...patch })))
  }, [readOnly, setState])

  const addTrajectoryPoint = React.useCallback((trajectoryId: string) => {
    if (readOnly) return
    let nextPointId: string | null = null
    setState((current) => patchTrajectoryState(current, trajectoryId, (trajectory) => {
      const result = appendTrajectoryPoint(trajectory, activeTrajectoryId === trajectoryId ? activePointId : null)
      nextPointId = result.pointId
      return result.trajectory
    }))
    setActiveTrajectoryId(trajectoryId)
    if (nextPointId) setActivePointId(nextPointId)
  }, [activePointId, activeTrajectoryId, readOnly, setState])

  const insertTrajectoryPointAt = React.useCallback((
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement: 'before' | 'after' = 'after',
  ) => {
    if (readOnly) return
    let nextPointId: string | null = null
    setState((current) => patchTrajectoryState(current, trajectoryId, (trajectory) => {
      const targetIndex = targetPointId
        ? trajectory.points.findIndex((point) => point.id === targetPointId)
        : trajectory.points.length - 1
      const insertIndex = targetIndex < 0
        ? trajectory.points.length
        : placement === 'before' ? targetIndex : targetIndex + 1
      const result = insertTrajectoryPoint(trajectory, position, insertIndex)
      nextPointId = result.pointId
      return result.trajectory
    }))
    setActiveTrajectoryId(trajectoryId)
    if (nextPointId) setActivePointId(nextPointId)
  }, [readOnly, setState])

  const patchTrajectoryCurveControlAt = React.useCallback((
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => {
    if (readOnly) return
    setState((current) => patchTrajectoryState(
      current,
      trajectoryId,
      (trajectory) => patchTrajectoryCurveControl(trajectory, segmentStartPointId, position),
    ))
  }, [readOnly, setState])

  const patchTrajectoryPointPosition = React.useCallback((trajectoryId: string, pointId: string, position: Scene3DVector3) => {
    if (readOnly) return
    setState((current) => patchTrajectoryState(
      current,
      trajectoryId,
      (trajectory) => patchTrajectoryPoint(trajectory, pointId, { position }),
    ))
  }, [readOnly, setState])

  const patchTrajectoryPointTiming = React.useCallback((trajectoryId: string, pointId: string, patch: Partial<Scene3DTrajectoryPoint>) => {
    if (readOnly) return
    setState((current) => patchTrajectoryState(
      current,
      trajectoryId,
      (trajectory) => patchTrajectoryPoint(trajectory, pointId, patch),
    ))
  }, [readOnly, setState])

  const translateTrajectoryBy = React.useCallback((trajectoryId: string, delta: Scene3DVector3) => {
    if (readOnly) return
    setState((current) => patchTrajectoryState(current, trajectoryId, (trajectory) => translateTrajectory(trajectory, delta)))
  }, [readOnly, setState])

  const deleteTrajectoryPoint = React.useCallback((trajectoryId: string, pointId: string) => {
    if (readOnly) return
    const trajectory = state.trajectories.find((candidate) => candidate.id === trajectoryId)
    const pointIndex = trajectory?.points.findIndex((point) => point.id === pointId) ?? -1
    if (!trajectory || pointIndex < 0 || trajectory.points.length <= 2) return
    const nextActivePointId = trajectory.points[pointIndex + 1]?.id ?? trajectory.points[pointIndex - 1]?.id ?? null
    setState((current) => patchTrajectoryState(current, trajectoryId, (trajectory) => removeTrajectoryPoint(trajectory, pointId)))
    setActivePointId((current) => (current === pointId ? nextActivePointId : current))
  }, [readOnly, setState, state.trajectories])

  const deleteTrajectory = React.useCallback((trajectoryId: string) => {
    if (readOnly) return
    const nextActiveTrajectory = state.trajectories.find((trajectory) => trajectory.id !== trajectoryId)
    setState((current) => removeTrajectoryState(current, trajectoryId))
    setActiveTrajectoryId((current) => (current === trajectoryId ? nextActiveTrajectory?.id ?? null : current))
    setActivePointId((current) => (activeTrajectoryId === trajectoryId ? nextActiveTrajectory?.points[0]?.id ?? null : current))
  }, [activeTrajectoryId, readOnly, setState, state.trajectories])

  const bindObjectToTrajectory = React.useCallback((trajectoryId: string, objectId: string, offsetRatio = 0) => {
    if (readOnly) return
    setState((current) => bindNodeToTrajectoryState(current, trajectoryId, objectId, offsetRatio))
    setTimelineVisible(true)
  }, [readOnly, setState])

  const patchTrajectoryBinding = React.useCallback((bindingId: string, patch: Partial<Scene3DTrajectoryBinding>) => {
    if (readOnly) return
    setState((current) => patchTrajectoryBindingState(current, bindingId, patch))
  }, [readOnly, setState])

  const patchTrajectoryBoundObject = React.useCallback((
    bindingId: string,
    objectId: string,
    patch: Partial<Scene3DTrajectoryBoundObject>,
  ) => {
    if (readOnly) return
    setState((current) => patchTrajectoryBoundObjectState(current, bindingId, objectId, patch))
  }, [readOnly, setState])

  const unbindObjectFromTrajectory = React.useCallback((bindingId: string, objectId: string) => {
    if (readOnly) return
    setState((current) => removeTrajectoryBoundObjectState(current, bindingId, objectId))
  }, [readOnly, setState])

  const deleteTrajectoryBinding = React.useCallback((bindingId: string) => {
    if (readOnly) return
    setState((current) => removeTrajectoryBindingState(current, bindingId))
  }, [readOnly, setState])

  const addTrajectoryGroup = React.useCallback(() => {
    if (readOnly) return
    const group = makeTrajectoryGroup(state.trajectoryGroups.length)
    setState((current) => ({
      ...current,
      trajectoryGroups: [...current.trajectoryGroups, group],
    }))
    setActiveGroupId(group.id)
    setTimelineVisible(true)
  }, [readOnly, setState, state.trajectoryGroups.length])

  const renameTrajectoryGroup = React.useCallback((groupId: string, name: string) => {
    if (readOnly) return
    setState((current) => renameTrajectoryGroupState(current, groupId, name))
  }, [readOnly, setState])

  const requestPlayChange = React.useCallback((playing: boolean): boolean => {
    if (!playing) {
      setIsPlaying(false)
      return true
    }
    if (!hasPlayableBinding) return false
    if (playheadRef.current >= stopAtSeconds - 0.0005) {
      resetPlayhead()
    }
    setTimelineVisible(true)
    setIsPlaying(true)
    return true
  }, [hasPlayableBinding, playheadRef, resetPlayhead, stopAtSeconds])

  return {
    activeGroupId,
    activePointId,
    activeTrajectoryId,
    activeTrajectoryIds,
    bindTargets,
    displayState,
    hasPlayableBinding,
    isPlaying,
    playheadRef,
    requestPlayChange,
    resetPlayhead,
    selectGroup,
    selectPoint,
    selectTrajectory,
    setTimelineVisible,
    setTrajectoryPlaying: setIsPlaying,
    timelineVisible,
    addTrajectory,
    addTrajectoryAt,
    addTrajectoryGroup,
    addTrajectoryPoint,
    bindObjectToTrajectory,
    deleteTrajectory,
    deleteTrajectoryBinding,
    deleteTrajectoryPoint,
    insertTrajectoryPointAt,
    patchTrajectory,
    patchTrajectoryBinding,
    patchTrajectoryBoundObject,
    patchTrajectoryCurveControl: patchTrajectoryCurveControlAt,
    patchTrajectoryPointPosition,
    patchTrajectoryPointTiming,
    renameTrajectoryGroup,
    translateTrajectoryBy,
    unbindObjectFromTrajectory,
  }
}
