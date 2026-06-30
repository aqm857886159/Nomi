import React from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { Scene3DTrajectoryBinding } from '../scene3dTypes'
import { findSceneObjectByRuntimeId } from '../scene3dMath'
import { useTrajectoryAnimation } from './useTrajectoryAnimation'
import {
  registerScene3DObjectRef,
  setScene3DObjectRuntimeRefsVisible,
  unregisterScene3DObjectRef,
} from './trajectoryRuntimeStore'

/**
 * Resolves the live THREE.Object3D for a bound scene object/camera by id and
 * registers it into the trajectory runtime store so the playback hook can drive
 * it. Scene object/camera marker groups carry their id in
 * `userData[SCENE3D_RUNTIME_ID_KEY]`. Registration is scoped to timeline/playback
 * mode only, so it never interferes with normal editing.
 */
function bindableObjectIds(bindings: Scene3DTrajectoryBinding[]): string[] {
  return Array.from(new Set(bindings.flatMap((binding) => binding.objects.map((object) => object.objectId))))
}

function ObjectRefBinder({ objectId }: { objectId: string }): null {
  const { scene } = useThree()

  React.useEffect(() => {
    const found = findSceneObjectByRuntimeId(scene, objectId)
    if (!found) return undefined
    const ref = { current: found } as React.MutableRefObject<THREE.Object3D>
    registerScene3DObjectRef(objectId, ref)
    return () => {
      unregisterScene3DObjectRef(objectId, ref)
      // After playback releases the object, force it visible so a hidden
      // closed-loop frame never persists; the next render reapplies the authored
      // transform.
      setScene3DObjectRuntimeRefsVisible(objectId, true)
    }
  }, [objectId, scene])

  return null
}

export function TrajectoryPlayback({
  bindings,
  isPlaying,
  setIsPlaying,
  playheadRef,
  activeTrajectoryIds,
}: {
  bindings: Scene3DTrajectoryBinding[]
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  playheadRef: React.MutableRefObject<number>
  activeTrajectoryIds?: ReadonlySet<string> | null
}): JSX.Element {
  const objectIds = React.useMemo(() => bindableObjectIds(bindings), [bindings])
  useTrajectoryAnimation({ isPlaying, setIsPlaying, playheadRef, activeTrajectoryIds })

  return (
    <>
      {objectIds.map((objectId) => (
        <ObjectRefBinder key={objectId} objectId={objectId} />
      ))}
    </>
  )
}
