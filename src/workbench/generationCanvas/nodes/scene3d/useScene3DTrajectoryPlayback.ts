import React from 'react'
import { cameraWithPlaybackPosition, hasPlayableTrajectoryBinding, objectWithPlaybackPose, trajectoryIdsForPlaybackGroup } from './scene3dPlayback'
import type { Scene3DState } from './scene3dTypes'
import {
  clearScene3DObjectRefs,
  resetScene3DPlayhead,
  setScene3DPlayheadSeconds,
  setScene3DTrajectorySnapshot,
  useScene3DTrajectoryRuntimeStore,
} from './trajectory'

function playbackStopAtSeconds(
  state: Pick<Scene3DState, 'trajectories' | 'trajectoryBindings' | 'sceneTimeline'>,
  activeTrajectoryIds: ReadonlySet<string> | null,
): number {
  const openEndTimes = state.trajectoryBindings.flatMap((binding) => {
    if (binding.objects.length === 0) return []
    if (activeTrajectoryIds && !activeTrajectoryIds.has(binding.trajectoryId)) return []
    const trajectory = state.trajectories.find((candidate) => candidate.id === binding.trajectoryId)
    return trajectory && !trajectory.closed ? [binding.endTime] : []
  })
  return openEndTimes.length > 0
    ? Math.max(...openEndTimes)
    : Math.max(0.001, state.sceneTimeline.totalDuration)
}

export function useScene3DTrajectoryPlayback({
  state,
  activeGroupId,
  isPlaying,
  onPlayChange,
  suspendPlayback = false,
}: {
  state: Scene3DState
  activeGroupId: string | null
  isPlaying: boolean
  onPlayChange: (playing: boolean) => void
  suspendPlayback?: boolean
}): {
  activeTrajectoryIds: ReadonlySet<string> | null
  displayState: Scene3DState
  hasPlayableBinding: boolean
  playheadRef: React.MutableRefObject<number>
  playheadSeconds: number
  resetPlayhead: () => void
  stopAtSeconds: number
} {
  const playheadSeconds = useScene3DTrajectoryRuntimeStore((runtime) => runtime.playheadSeconds)
  const playheadRef = React.useRef(playheadSeconds)
  const activeTrajectoryIds = React.useMemo(
    () => trajectoryIdsForPlaybackGroup(state, activeGroupId),
    [activeGroupId, state],
  )
  const hasPlayableBinding = React.useMemo(
    () => hasPlayableTrajectoryBinding(state, activeTrajectoryIds),
    [activeTrajectoryIds, state],
  )
  const stopAtSeconds = React.useMemo(
    () => playbackStopAtSeconds(state, activeTrajectoryIds),
    [activeTrajectoryIds, state],
  )

  React.useEffect(() => {
    playheadRef.current = playheadSeconds
  }, [playheadSeconds])

  React.useEffect(() => {
    playheadRef.current = 0
    resetScene3DPlayhead(0)
    return () => {
      clearScene3DObjectRefs()
    }
  }, [playheadRef])

  React.useEffect(() => {
    setScene3DTrajectorySnapshot({
      trajectories: state.trajectories,
      trajectoryBindings: state.trajectoryBindings,
      trajectoryGroups: state.trajectoryGroups,
      sceneTimeline: state.sceneTimeline,
    })
  }, [state.sceneTimeline, state.trajectories, state.trajectoryBindings, state.trajectoryGroups])

  React.useEffect(() => {
    if (!suspendPlayback || !isPlaying) return
    onPlayChange(false)
  }, [isPlaying, onPlayChange, suspendPlayback])

  React.useEffect(() => {
    if (suspendPlayback || !isPlaying) return undefined
    if (!hasPlayableBinding) {
      onPlayChange(false)
      return undefined
    }

    let frameHandle = 0
    let lastTime = 0
    const tick = (now: number) => {
      if (!lastTime) lastTime = now
      const deltaSeconds = (now - lastTime) / 1000
      lastTime = now
      const nextSeconds = playheadRef.current + deltaSeconds
      if (nextSeconds >= stopAtSeconds) {
        playheadRef.current = stopAtSeconds
        setScene3DPlayheadSeconds(stopAtSeconds)
        onPlayChange(false)
        return
      }
      playheadRef.current = nextSeconds
      setScene3DPlayheadSeconds(nextSeconds)
      frameHandle = window.requestAnimationFrame(tick)
    }

    frameHandle = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameHandle)
  }, [hasPlayableBinding, isPlaying, onPlayChange, stopAtSeconds, suspendPlayback])

  const resetPlayhead = React.useCallback(() => {
    playheadRef.current = 0
    setScene3DPlayheadSeconds(0)
  }, [])

  const displayState = React.useMemo(() => {
    if (suspendPlayback || !hasPlayableBinding) return state
    return {
      ...state,
      objects: state.objects.map((object) => objectWithPlaybackPose(state, object, playheadSeconds, activeTrajectoryIds)),
      cameras: state.cameras.map((camera) => cameraWithPlaybackPosition(state, camera, playheadSeconds, activeTrajectoryIds)),
    }
  }, [activeTrajectoryIds, hasPlayableBinding, playheadSeconds, state, suspendPlayback])

  return {
    activeTrajectoryIds,
    displayState,
    hasPlayableBinding,
    playheadRef,
    playheadSeconds,
    resetPlayhead,
    stopAtSeconds,
  }
}
