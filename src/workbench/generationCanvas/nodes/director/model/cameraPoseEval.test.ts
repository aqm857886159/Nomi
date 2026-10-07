import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './directorProject'
import { evaluateCameraPose } from './cameraPoseEval'

describe('evaluateCameraPose shared model owner', () => {
  it('applies lookAt and follow using the same pure result consumed by playback and measurement', () => {
    const project = createDefaultProject('camera-pose')
    const scene = project.scenes[0]
    scene.objects = [
      {
        id: 'hero',
        name: 'hero',
        type: 'character',
        position: { x: 2, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        locked: false,
      },
    ]
    const camera = {
      id: 'cam',
      name: 'cam',
      position: { x: 0, y: 1.5, z: 5 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      fov: 45,
      focalLengthMm: 50,
      lookAtType: 'object' as const,
      lookAtObjectId: 'hero',
      rigType: 'follow' as const,
    }
    const result = evaluateCameraPose(camera, scene, 0)
    expect(result.position).toEqual({ x: 0, y: 1.5, z: 5 })
    expect(result.lookAtCoords).toEqual({ x: 2, y: 1.5, z: 0 })
    expect(result.rotation.y).toBeCloseTo(158.199, 2)
    expect(result.driven).toBe(true)
  })
})
