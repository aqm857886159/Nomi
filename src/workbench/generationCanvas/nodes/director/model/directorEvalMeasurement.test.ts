import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './directorProject'
import type { DirectorCamera, DirectorObject, DirectorProject } from './directorTypes'
import {
  EVAL_SHOT_SIZES,
  distanceForShotSize,
  measureContinuity,
  projectPoint,
  recognizeCameraMotion,
  sampleDirectorProject,
  shotSizeForHeight,
} from './directorEvalMeasurement'

const wp = (id: string, time: number, p: { x: number; y: number; z: number }, yaw = 0) => ({
  id,
  time,
  frameIndex: Math.round(time * 30),
  x: p.x,
  y: p.y,
  z: p.z,
  yaw,
  pitch: 0,
  roll: 0,
})
function project(objects: DirectorObject[], cameras: DirectorCamera[], duration = 4): DirectorProject {
  const p = createDefaultProject('test'),
    scene = p.scenes[0]
  scene.objects = objects
  scene.cameras = cameras
  scene.timelineTrackOrder = cameras.map((c) => c.id)
  for (const c of cameras)
    c.trajectoryClips = [
      { id: `${c.id}-clip`, startTime: 0, endTime: duration, startFrame: 0, endFrame: duration * 30 },
    ]
  return p
}
const obj = (id: string, position = { x: 0, y: 0.875, z: 0 }): DirectorObject => ({
  id,
  name: id,
  type: 'character',
  position,
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  locked: false,
})
const cam = (id: string, points: ReturnType<typeof wp>[]): DirectorCamera => ({
  id,
  name: id,
  position: points[0] ? { x: points[0].x, y: points[0].y, z: points[0].z } : { x: 0, y: 1, z: 5 },
  yaw: 0,
  pitch: 0,
  roll: 0,
  fov: 45,
  focalLengthMm: 0,
  motionTrajectory: points,
  trajectoryClips: [],
})

describe('director preview measurement', () => {
  it('measures a full orbit near 360 degrees', () => {
    const points = Array.from({ length: 9 }, (_, i) => {
      const a = (i * 45 * Math.PI) / 180
      return wp(`w${i}`, i / 2, { x: Math.sin(a) * 5, y: 2, z: Math.cos(a) * 5 }, (i * 45 + 180) % 360)
    })
    const c = cam('camera', points),
      p = project([obj('bottle')], [c], 4)
    const m = sampleDirectorProject(p, { duration: 4, fps: 2 })
    expect(Math.abs(recognizeCameraMotion(m, 'bottle', { start: 0, end: 4 }).signedOrbitDeg)).toBeGreaterThan(300)
  })
  it('recognizes a slow push and exact out-of-frame frames', () => {
    const points = [wp('a', 0, { x: 0, y: 1, z: 8 }, 180), wp('b', 2, { x: 0, y: 1, z: 4 }, 180)]
    const c = cam('camera', points),
      subject = obj('subject'),
      p = project([subject], [c], 2)
    subject.motionTrajectory = [
      wp('s0', 0, { x: 0, y: 0.875, z: 0 }),
      wp('s1', 1, { x: 0, y: 0.875, z: 0 }),
      wp('s2', 2, { x: 3, y: 0.875, z: 0 }),
    ]
    subject.trajectoryClips = [{ id: 's', startTime: 0, endTime: 2, startFrame: 0, endFrame: 60 }]
    const m = sampleDirectorProject(p, { duration: 2, fps: 2 })
    const motion = recognizeCameraMotion(m, 'subject', { start: 0, end: 2 })
    expect(motion.move).toBe('push_in')
    expect(motion.distanceDelta).toBeLessThan(-2.9)
    expect(m.frames.filter((f) => f.objects.subject.projection?.inFrame).length).toBe(4)
  })
  it('catches teleport, axis crossing, camera entry and below-ground', () => {
    const a = obj('woman'),
      b = obj('guard', { x: 2, y: 0.875, z: 0 })
    const c = cam('camera', [wp('a', 0, { x: 0, y: 1, z: -2 }, 0), wp('b', 1, { x: 0, y: 1, z: 2 }, 180)])
    const p = project([a, b], [c], 1)
    a.motionTrajectory = [wp('a0', 0, { x: 0, y: -1, z: 0 }), wp('a1', 1, { x: 0, y: -1, z: 0 })]
    a.trajectoryClips = [{ id: 'a', startTime: 0, endTime: 1, startFrame: 0, endFrame: 30 }]
    const m = sampleDirectorProject(p, { duration: 1, fps: 1 })
    const issues = measureContinuity(m, p.scenes[0])
    expect(issues.some((i) => i.kind === 'below-ground')).toBe(true)
    expect(issues.some((i) => i.kind === 'axis-cross')).toBe(true)
  })
})

it('uses the feet-at-origin convention for character bounds', () => {
  const character = obj('actor', { x: 0, y: 0, z: 0 })
  const c = cam('camera', [wp('a', 0, { x: 0, y: 0.875, z: 5 }, 180)])
  const p = project([character], [c], 0)
  const m = sampleDirectorProject(p, { duration: 0, fps: 30 })
  const frame = m.frames[0],
    sample = frame.objects.actor
  expect(sample.belowGround).toBe(false)
  expect(sample.projection).toBeDefined()
  const camera = frame.camera!
  const foot = projectPoint(camera, { x: 0, y: 0, z: 0 })
  expect(Math.abs(sample.projection!.y + sample.projection!.height - foot.y)).toBeLessThan(0.02)
})

describe('director shot-size ladder (where the frame cuts the subject)', () => {
  const standing = (id: string): DirectorObject => ({
    id,
    name: id,
    type: 'character',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
  })
  const looking = (z: number, y = 1.6, yaw = 180) => {
    const c = cam('camera', [wp('a', 0, { x: 0, y, z }, yaw), wp('b', 1, { x: 0, y, z }, yaw)])
    c.fov = 45
    return c
  }
  const sizeAt = (z: number, yaw = 180) =>
    sampleDirectorProject(project([standing('hero')], [looking(z, 1.6, yaw)], 1), { duration: 1, fps: 1 }).frames[0]
      .objects.hero

  it('round-trips every figure size through distanceForShotSize', () => {
    for (const size of EVAL_SHOT_SIZES) {
      const d = distanceForShotSize(size, 1.75, 45, 'figure')
      expect(sizeAt(d)?.shotSize, `${size} @ ${d.toFixed(2)}m`).toBe(size)
    }
  })
  it('keeps a medium shot in frame by the head even though the body runs past the frame', () => {
    const sample = sizeAt(distanceForShotSize('中景', 1.75, 45, 'figure'))
    expect(sample?.shotSize).toBe('中景')
    expect(sample?.projection?.contained).toBe(false)
    expect(sample?.projection?.inFrame).toBe(true)
  })
  it('reports the subject out of frame when the camera looks away', () => {
    expect(sizeAt(3, 0)?.projection?.inFrame).toBe(false)
  })
  it('uses the object ladder for anchored parts', () => {
    expect(shotSizeForHeight(1.6, 'object')).toBe('特写')
    expect(shotSizeForHeight(1.6, 'figure')).toBe('中景')
  })
})

describe('anchored parts (hand, cap) are measured on their own', () => {
  it('reports a close-up of the hand while the whole figure reads as a tighter-than-medium crop', () => {
    const hero: DirectorObject = {
      id: 'hero',
      name: 'hero',
      type: 'character',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
    }
    const hand = { offset: { x: 0.25, y: 0.95, z: 0.1 }, size: { x: 0.1, y: 0.1, z: 0.1 } }
    const d = distanceForShotSize('特写', hand.size.y, 45, 'object')
    const c = cam('camera', [
      wp('a', 0, { x: 0.25, y: 0.95, z: 0.1 + d }, 180),
      wp('b', 1, { x: 0.25, y: 0.95, z: 0.1 + d }, 180),
    ])
    c.fov = 45
    const sample = sampleDirectorProject(project([hero], [c], 1), {
      duration: 1,
      fps: 1,
      anchors: { 'hero.hand': hand },
    }).frames[0].objects.hero
    expect(sample.anchors?.hand?.shotSize).toBe('特写')
    expect(sample.anchors?.hand?.projection.inFrame).toBe(true)
    // The figure's own key point (head) is above this frame: the anchor, not the body, carries the shot.
    expect(sample.projection?.inFrame).toBe(false)
  })
  it('ignores anchors that belong to other objects', () => {
    const hero: DirectorObject = {
      id: 'hero',
      name: 'hero',
      type: 'character',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
    }
    const c = cam('camera', [wp('a', 0, { x: 0, y: 1.6, z: 3 }, 180), wp('b', 1, { x: 0, y: 1.6, z: 3 }, 180)])
    const sample = sampleDirectorProject(project([hero], [c], 1), {
      duration: 1,
      fps: 1,
      anchors: { 'villain.hand': { offset: { x: 0, y: 1, z: 0 }, size: { x: 0.1, y: 0.1, z: 0.1 } } },
    }).frames[0].objects.hero
    expect(sample.anchors).toBeUndefined()
  })
})
