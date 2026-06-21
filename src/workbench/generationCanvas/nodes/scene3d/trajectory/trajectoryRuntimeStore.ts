import type { RefObject } from 'react'
import * as THREE from 'three'
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Scene3DTimeline, Scene3DTrajectory, Scene3DTrajectoryBinding, Scene3DTrajectoryGroup } from '../scene3dTypes'

export type Scene3DObjectRuntimeRef = {
  ref: RefObject<THREE.Object3D>
  positionOffset?: THREE.Vector3
  followTangent?: boolean
}

type Scene3DTrajectoryRuntimeState = {
  playheadSeconds: number
  trajectories: Scene3DTrajectory[]
  trajectoryBindings: Scene3DTrajectoryBinding[]
  trajectoryGroups: Scene3DTrajectoryGroup[]
  sceneTimeline: Scene3DTimeline
  objectRefMap: Map<string, Scene3DObjectRuntimeRef[]>
  setPlayheadSeconds: (seconds: number) => void
  setSceneSnapshot: (snapshot: {
    trajectories: Scene3DTrajectory[]
    trajectoryBindings: Scene3DTrajectoryBinding[]
    trajectoryGroups: Scene3DTrajectoryGroup[]
    sceneTimeline: Scene3DTimeline
  }) => void
}

export const useScene3DTrajectoryRuntimeStore = create<Scene3DTrajectoryRuntimeState>()(subscribeWithSelector((set) => ({
  playheadSeconds: 0,
  trajectories: [],
  trajectoryBindings: [],
  trajectoryGroups: [],
  sceneTimeline: { totalDuration: 10 },
  objectRefMap: new Map(),
  setPlayheadSeconds: (seconds) => set((state) => {
    const nextSeconds = Number.isFinite(seconds) ? seconds : 0
    return Math.abs(state.playheadSeconds - nextSeconds) < 0.0005
      ? state
      : { playheadSeconds: nextSeconds }
  }),
  setSceneSnapshot: (snapshot) => set((state) => (
    state.trajectories === snapshot.trajectories &&
    state.trajectoryBindings === snapshot.trajectoryBindings &&
    state.trajectoryGroups === snapshot.trajectoryGroups &&
    state.sceneTimeline === snapshot.sceneTimeline
      ? state
      : snapshot
  )),
})))

export function registerScene3DObjectRef(
  objectId: string,
  ref: RefObject<THREE.Object3D>,
  options: Omit<Scene3DObjectRuntimeRef, 'ref'> = {},
): void {
  const map = useScene3DTrajectoryRuntimeStore.getState().objectRefMap
  const current = map.get(objectId)?.filter((entry) => entry.ref !== ref) ?? []
  current.push({
    ref,
    positionOffset: options.positionOffset?.clone(),
    followTangent: options.followTangent,
  })
  map.set(objectId, current)
}

export function unregisterScene3DObjectRef(objectId: string, ref: RefObject<THREE.Object3D>): void {
  const map = useScene3DTrajectoryRuntimeStore.getState().objectRefMap
  const current = map.get(objectId)
  if (!current) return
  const next = current.filter((entry) => entry.ref !== ref)
  if (next.length === 0) {
    map.delete(objectId)
    return
  }
  map.set(objectId, next)
}

export function clearScene3DObjectRefs(): void {
  useScene3DTrajectoryRuntimeStore.getState().objectRefMap.clear()
}

export function setScene3DObjectRuntimeRefsVisible(objectId: string, visible: boolean): void {
  const targets = useScene3DTrajectoryRuntimeStore.getState().objectRefMap.get(objectId)
  targets?.forEach((target) => {
    const object = target.ref.current
    if (object) object.visible = visible
  })
}

export function setScene3DPlayheadSeconds(seconds: number): void {
  useScene3DTrajectoryRuntimeStore.getState().setPlayheadSeconds(seconds)
}

export function resetScene3DPlayhead(seconds = 0): void {
  setScene3DPlayheadSeconds(seconds)
}

export function setScene3DTrajectorySnapshot(snapshot: {
  trajectories: Scene3DTrajectory[]
  trajectoryBindings: Scene3DTrajectoryBinding[]
  trajectoryGroups: Scene3DTrajectoryGroup[]
  sceneTimeline: Scene3DTimeline
}): void {
  useScene3DTrajectoryRuntimeStore.getState().setSceneSnapshot(snapshot)
}
