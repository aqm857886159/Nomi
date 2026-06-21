import React from 'react'
import { useFrame } from '@react-three/fiber'
import type { Scene3DTrajectory, Scene3DTrajectoryBinding } from '../scene3dTypes'
import { buildTrajectoryCurve, clampRatio, remapTrajectoryTimeRatio, wrapRatio } from './trajectoryUtils'
import { setScene3DPlayheadSeconds, useScene3DTrajectoryRuntimeStore } from './trajectoryRuntimeStore'

type UseTrajectoryAnimationOptions = {
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  playheadRef?: React.MutableRefObject<number>
  activeTrajectoryIds?: ReadonlySet<string> | null
}

function bindingTrajectory(
  binding: Scene3DTrajectoryBinding,
  trajectories: Scene3DTrajectory[],
): Scene3DTrajectory | undefined {
  return trajectories.find((trajectory) => trajectory.id === binding.trajectoryId)
}

export function useTrajectoryAnimation({
  isPlaying,
  setIsPlaying,
  playheadRef: externalPlayheadRef,
  activeTrajectoryIds,
}: UseTrajectoryAnimationOptions): React.MutableRefObject<number> {
  const internalPlayheadRef = React.useRef(useScene3DTrajectoryRuntimeStore.getState().playheadSeconds ?? 0)
  const playheadRef = externalPlayheadRef ?? internalPlayheadRef
  const isPlayingRef = React.useRef(isPlaying)
  const activeTrajectoryIdsRef = React.useRef<ReadonlySet<string> | null>(activeTrajectoryIds ?? null)
  const frameCounterRef = React.useRef(0)
  const lastPublishedPlayheadRef = React.useRef(playheadRef.current)

  React.useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  React.useEffect(() => {
    activeTrajectoryIdsRef.current = activeTrajectoryIds ?? null
  }, [activeTrajectoryIds])

  useFrame((_, delta) => {
    const runtime = useScene3DTrajectoryRuntimeStore.getState()
    const { trajectories, trajectoryBindings, objectRefMap, sceneTimeline } = runtime
    const selectedTrajectoryIds = activeTrajectoryIdsRef.current
    const activeBindings = selectedTrajectoryIds
      ? trajectoryBindings.filter((binding) => selectedTrajectoryIds.has(binding.trajectoryId))
      : trajectoryBindings

    if (isPlayingRef.current) {
      playheadRef.current += delta
    }

    const playheadSeconds = playheadRef.current

    activeBindings.forEach((binding) => {
      const trajectory = bindingTrajectory(binding, trajectories)
      if (!trajectory) return
      const curve = buildTrajectoryCurve(trajectory)
      if (!curve) return
      const duration = binding.endTime - binding.startTime
      if (duration <= 0) return

      if (trajectory.closed && playheadSeconds < binding.startTime) {
        binding.objects.forEach((boundObject) => {
          objectRefMap.get(boundObject.objectId)?.forEach((target) => {
            const object = target.ref.current
            if (object) object.visible = false
          })
        })
        return
      }

      const raw = (playheadSeconds - binding.startTime) / duration
      let tBase = trajectory.closed ? wrapRatio(raw) : clampRatio(raw)
      if (binding.direction === 'reverse') tBase = 1 - tBase

      binding.objects.forEach((boundObject) => {
        const targets = objectRefMap.get(boundObject.objectId)
        if (!targets || targets.length === 0) return

        const effectiveOffset = binding.direction === 'reverse'
          ? -boundObject.offsetRatio
          : boundObject.offsetRatio
        const t = trajectory.closed
          ? remapTrajectoryTimeRatio(trajectory, wrapRatio(tBase + effectiveOffset))
          : remapTrajectoryTimeRatio(trajectory, clampRatio(tBase + effectiveOffset))

        const curvePoint = curve.getPointAt(t)
        const tangent = curve.getTangentAt(t)
        const normalizedTangent = tangent.lengthSq() >= 1e-10 ? tangent.normalize() : null
        targets.forEach((target) => {
          const object = target.ref.current
          if (!object) return
          object.visible = true
          object.position.copy(curvePoint)
          if (target.positionOffset) object.position.add(target.positionOffset)
          if (target.followTangent !== false && normalizedTangent) {
            object.lookAt(object.position.clone().add(normalizedTangent))
          }
        })
      })
    })

    if (isPlayingRef.current && activeBindings.length > 0) {
      const openEndTimes: number[] = []
      activeBindings.forEach((binding) => {
        const trajectory = bindingTrajectory(binding, trajectories)
        if (trajectory && !trajectory.closed) openEndTimes.push(binding.endTime)
      })
      const stopAt = openEndTimes.length > 0
        ? Math.max(...openEndTimes)
        : sceneTimeline.totalDuration
      if (playheadRef.current >= stopAt) {
        isPlayingRef.current = false
        setIsPlaying(false)
      }
    }

    if (!isPlayingRef.current) return

    frameCounterRef.current += 1
    if (
      frameCounterRef.current % 2 === 0 &&
      Math.abs(lastPublishedPlayheadRef.current - playheadRef.current) >= 0.0005
    ) {
      lastPublishedPlayheadRef.current = playheadRef.current
      setScene3DPlayheadSeconds(playheadRef.current)
    }
  })

  return playheadRef
}
