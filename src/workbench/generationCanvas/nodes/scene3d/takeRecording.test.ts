import { describe, expect, it } from 'vitest'
import {
  samplesToTrajectory,
  buildTakeBinding,
  recordingDurationSeconds,
  frameCountForDuration,
  buildRecordedTakeScene,
  type TakeSample,
  type RecordedTake,
} from './takeRecording'
import { createDefaultScene3DState } from './scene3dSerializer'

const sample = (time: number, position: [number, number, number]): TakeSample => ({ time, position })

describe('samplesToTrajectory', () => {
  it('maps sample timestamps to normalized timeRatio on each point (time-accurate playback)', () => {
    const samples = [
      sample(1000, [0, 0, 0]),
      sample(1500, [1, 0, 0]),
      sample(3000, [2, 0, 0]), // 注意时间不均匀：1000→1500→3000
    ]
    const trajectory = samplesToTrajectory(samples, '#abc', '录制路径')
    expect(trajectory).not.toBeNull()
    const points = trajectory!.points
    expect(points).toHaveLength(3)
    // 首点 0、末点 1，中间点按真实时间戳比例落在 (1500-1000)/(3000-1000)=0.25。
    expect(points[0].timeRatio).toBeCloseTo(0, 5)
    expect(points[1].timeRatio).toBeCloseTo(0.25, 5)
    expect(points[2].timeRatio).toBeCloseTo(1, 5)
    // 位置原样保留。
    expect(points[0].position).toEqual([0, 0, 0])
    expect(points[2].position).toEqual([2, 0, 0])
  })

  it('drops near-coincident consecutive points (a still object must not make a degenerate curve)', () => {
    const samples = [
      sample(0, [0, 0, 0]),
      sample(50, [0.0001, 0, 0]), // 几乎没动
      sample(100, [0.0002, 0, 0]),
      sample(150, [1, 0, 0]), // 真的走了
    ]
    const trajectory = samplesToTrajectory(samples, '#abc', 'p')
    expect(trajectory).not.toBeNull()
    // 三个挤在一起的点应合成一个，最终 2 个有效点。
    expect(trajectory!.points).toHaveLength(2)
    expect(trajectory!.points[0].position).toEqual([0, 0, 0])
    expect(trajectory!.points[1].position).toEqual([1, 0, 0])
    expect(trajectory!.points[1].timeRatio).toBeCloseTo(1, 5)
  })

  it('returns null when fewer than 2 distinct points (object never moved → no trajectory)', () => {
    expect(samplesToTrajectory([], '#abc', 'p')).toBeNull()
    expect(samplesToTrajectory([sample(0, [0, 0, 0])], '#abc', 'p')).toBeNull()
    expect(
      samplesToTrajectory(
        [sample(0, [1, 1, 1]), sample(100, [1, 1, 1.00001])],
        '#abc',
        'p',
      ),
    ).toBeNull()
  })

  it('keeps endpoints exactly at 0 and 1 regardless of timestamp base', () => {
    const samples = [
      sample(9999, [0, 0, 0]),
      sample(10500, [0.5, 0, 0]),
      sample(12000, [3, 0, 0]),
    ]
    const points = samplesToTrajectory(samples, '#abc', 'p')!.points
    expect(points[0].timeRatio).toBe(0)
    expect(points[points.length - 1].timeRatio).toBe(1)
  })
})

describe('buildTakeBinding', () => {
  it('binds an object to a trajectory over [startTime, endTime] forward, offset 0', () => {
    const binding = buildTakeBinding('traj-1', 'obj-9', 0, 4.2)
    expect(binding.trajectoryId).toBe('traj-1')
    expect(binding.objects).toEqual([{ objectId: 'obj-9', offsetRatio: 0 }])
    expect(binding.startTime).toBe(0)
    expect(binding.endTime).toBe(4.2)
    expect(binding.direction).toBe('forward')
    expect(binding.id).toMatch(/.+/)
  })
})

describe('recordingDurationSeconds', () => {
  it('converts ms span to seconds', () => {
    expect(recordingDurationSeconds(1000, 6000)).toBeCloseTo(5, 5)
  })
  it('floors at a minimum positive duration so a tap-record never yields 0 duration', () => {
    expect(recordingDurationSeconds(1000, 1000)).toBeGreaterThan(0)
    expect(recordingDurationSeconds(5000, 4000)).toBeGreaterThan(0)
  })
})

describe('frameCountForDuration', () => {
  it('derives frame count = round(duration * fps)', () => {
    expect(frameCountForDuration(5, 24)).toBe(120)
    expect(frameCountForDuration(3.5, 24)).toBe(84)
  })
  it('clamps to a sane min/max (offscreen capture bounds)', () => {
    expect(frameCountForDuration(0.0001, 24)).toBeGreaterThanOrEqual(2)
    expect(frameCountForDuration(1000, 60)).toBeLessThanOrEqual(240)
  })
})

describe('buildRecordedTakeScene', () => {
  function baseSceneWithCharacter(): { state: ReturnType<typeof createDefaultScene3DState>; characterId: string } {
    const state = createDefaultScene3DState()
    return { state, characterId: state.objects[0].id }
  }

  function take(characterId: string, overrides: Partial<RecordedTake> = {}): RecordedTake {
    return {
      possessedObjectId: characterId,
      characterSamples: [
        sample(0, [0, 0, 0]),
        sample(2000, [2, 0, 1]),
        sample(4000, [4, 0, 0]),
      ],
      cameraSamples: [],
      durationSeconds: 4,
      ...overrides,
    }
  }

  it('binds the possessed character to its recorded path over the full duration', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId))
    expect(scene).not.toBeNull()
    expect(scene!.trajectories).toHaveLength(1) // 只有角色轨迹（相机没动）
    const binding = scene!.trajectoryBindings.find((b) =>
      b.objects.some((o) => o.objectId === characterId),
    )
    expect(binding).toBeTruthy()
    expect(binding!.startTime).toBe(0)
    expect(binding!.endTime).toBe(4)
    expect(scene!.sceneTimeline.totalDuration).toBe(4)
  })

  it('marks the recorded character with locomotionClip=walk so the offscreen mp4 has legs striding', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId))
    const character = scene!.objects.find((o) => o.id === characterId)
    expect(character!.locomotionClip).toBe('walk')
  })

  it('makes the offscreen capture camera (cameras[0]) follow the recorded character', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId))
    expect(scene!.cameras[0].followTargetId).toBe(characterId)
  })

  it('adds a camera trajectory + binding when the user moved the camera during recording', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const cameraId = state.cameras[0].id
    const scene = buildRecordedTakeScene(
      state,
      take(characterId, {
        cameraSamples: [
          sample(0, [4, 2, 5]),
          sample(2000, [2, 2, 6]),
          sample(4000, [0, 2, 5]),
        ],
      }),
    )
    expect(scene!.trajectories).toHaveLength(2)
    const cameraBinding = scene!.trajectoryBindings.find((b) =>
      b.objects.some((o) => o.objectId === cameraId),
    )
    expect(cameraBinding).toBeTruthy()
  })

  it('preserves all base objects (recording is additive, not a fresh scene)', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId))
    expect(scene!.objects).toHaveLength(state.objects.length)
  })

  it('returns null when the character never moved (nothing to play back)', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(
      state,
      take(characterId, {
        characterSamples: [sample(0, [1, 0, 1]), sample(3000, [1, 0, 1])],
      }),
    )
    expect(scene).toBeNull()
  })

  it('returns null when the possessed object is missing from the scene', () => {
    const { state } = baseSceneWithCharacter()
    expect(buildRecordedTakeScene(state, take('nonexistent-id'))).toBeNull()
  })

  const squat = { mixamorigSpine: [10, 0, 0] as [number, number, number] }
  const wave = { mixamorigRightArm: [-40, 0, 0] as [number, number, number] }

  it('attaches a poseTrack to the character when actions were switched during recording', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId, {
      poseEvents: [
        { time: 0, presetId: 'walk', pose: undefined },
        { time: 1.5, presetId: 'squat', pose: squat },
        { time: 3, presetId: 'wave', pose: wave },
      ],
    }))
    const character = scene!.objects.find((o) => o.id === characterId)
    expect(character!.poseTrack?.map((k) => [k.time, k.presetId])).toEqual([
      [0, 'walk'], [1.5, 'squat'], [3, 'wave'],
    ])
  })

  it('no poseTrack when only the seed keyframe (never switched action → static pose, old behavior)', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId, {
      poseEvents: [{ time: 0, presetId: undefined, pose: squat }],
    }))
    expect(scene!.objects.find((o) => o.id === characterId)!.poseTrack).toBeUndefined()
  })

  it('no poseTrack when poseEvents omitted entirely (backward compatible)', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId))
    expect(scene!.objects.find((o) => o.id === characterId)!.poseTrack).toBeUndefined()
  })

  it('collapses a switch back to the same starting pose (seed == first action → no track)', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId, {
      poseEvents: [
        { time: 0, presetId: 'squat', pose: squat },
        { time: 2, presetId: 'squat', pose: squat },
      ],
    }))
    expect(scene!.objects.find((o) => o.id === characterId)!.poseTrack).toBeUndefined()
  })
})
