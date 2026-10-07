import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../../src/workbench/generationCanvas/nodes/director/model/directorProject'
import { compareCaptureReadback } from './readback'

function fixture() {
  const project = createDefaultProject('readback')
  const scene = project.scenes[0]
  scene.objects = [
    {
      id: 'hero',
      name: 'hero',
      type: 'character',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
    },
  ]
  scene.cameras = [
    {
      id: 'cam',
      name: 'cam',
      position: { x: 0, y: 1.5, z: 5 },
      yaw: 0,
      pitch: 0,
      roll: 0,
      fov: 45,
      focalLengthMm: 50,
      trajectoryClips: [{ id: 'clip', startTime: 0, endTime: 1, startFrame: 0, endFrame: 30 }],
    },
  ]
  scene.timelineTrackOrder = ['cam']
  return project
}

describe('render to measurement readback', () => {
  it('accepts the product pose and subject position within the stated tolerances', () => {
    const project = fixture()
    const result = compareCaptureReadback(
      project,
      [0],
      [
        {
          cameraId: 'cam',
          camera: { position: { x: 0, y: 1.5, z: 5 }, yaw: 0, pitch: 0, roll: 0, fov: 45 },
          subjectPositions: { hero: { x: 0, y: 0, z: 0 } },
          characterPoses: {},
        },
      ],
      480,
      270,
    )
    expect(result.mismatches).toEqual([])
    expect(result.measurementSideGaps).toEqual([])
  })

  it('compares follow camera poses through the shared measurement evaluator', () => {
    const project = fixture()
    project.scenes[0].cameras[0].rigType = 'follow'
    const result = compareCaptureReadback(
      project,
      [0],
      [
        {
          cameraId: 'cam',
          camera: { position: { x: 9, y: 9, z: 9 }, yaw: 10, pitch: 10, roll: 0, fov: 60 },
          subjectPositions: {},
          characterPoses: {},
        },
      ],
      480,
      270,
    )
    expect(result.mismatches.some((item) => item.field.startsWith('position.'))).toBe(true)
    expect(result.measurementSideGaps).toEqual([])
  })

  it('does not treat auxiliary staging geometry as a missing subject', () => {
    const project = fixture()
    project.scenes[0].objects.push({
      id: 'ground',
      name: 'ground',
      type: 'plane',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
      isAuxiliary: true,
    })
    const result = compareCaptureReadback(
      project,
      [0],
      [
        {
          cameraId: 'cam',
          camera: { position: { x: 0, y: 1.5, z: 5 }, yaw: 0, pitch: 0, roll: 0, fov: 45 },
          subjectPositions: { hero: { x: 0, y: 0, z: 0 } },
          characterPoses: {},
        },
      ],
      480,
      270,
      new Set(['hero']),
    )
    expect(result.mismatches).toEqual([])
  })
})
