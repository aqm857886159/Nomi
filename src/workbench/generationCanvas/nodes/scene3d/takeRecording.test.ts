import { describe, expect, it } from 'vitest'
import {
  samplesToTrajectory,
  buildTakeBinding,
  recordingDurationSeconds,
  frameCountForDuration,
  buildRecordedTakeScene,
  buildRecordedCameraTakeScene,
  type TakeSample,
  type RecordedTake,
  type RecordedCameraTake,
} from './takeRecording'
import { cameraAimBindingId } from './scene3dBindingIds'
import { applyCameraMovePreset } from './cameraMovePreset'
import { CAMERA_MOVE_LABEL } from './cameraMoveVocab'
import { frameMotionSource, poseKeyframeKey } from './scene3dPoseTrack'
import { createDefaultScene3DState, normalizeScene3DState } from './scene3dSerializer'
import { cameraWithPlaybackPosition, sceneObjectTrajectorySample } from './scene3dPlayback'
import { objectSubjectAabb, projectAabbScreenRect } from './scene3dSafeFrame'
import { SCENE3D_ASPECT_RATIOS } from './scene3dTypes'

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

  // ── D：C 键下蹲进入最终 take（走→蹲→走）─────────────────────────────
  const crouch = { mixamorigSpine: [30, 0, 0] as [number, number, number] }

  it('records a C-key crouch as base→crouch→base poseTrack; mid-take crouch interrupts walk (D)', () => {
    const { state, characterId } = baseSceneWithCharacter()
    // 录制器产物：t=0 站立种子 → C 按下 crouch → C 松开 resume(base)。
    const scene = buildRecordedTakeScene(state, take(characterId, {
      poseEvents: [
        { time: 0, presetId: undefined, pose: undefined },   // 站立种子
        { time: 1.2, presetId: 'crouch', pose: crouch },      // C 按下
        { time: 2.5, presetId: undefined, pose: undefined },  // C 松开 → 恢复走路
      ],
    }))!
    const character = scene.objects.find((o) => o.id === characterId)!
    expect(character.poseTrack?.map((k) => poseKeyframeKey(k))).toEqual(['base', 'preset:crouch', 'base'])
    expect(character.locomotionClip).toBe('walk')
    // 松开前走路、C 窗口内静态蹲打断 walk、松开后恢复走路——正是「走→蹲→走」的成片语义。
    expect(frameMotionSource(character.poseTrack, character.locomotionClip, 0.5)).toBe('locomotion')
    expect(frameMotionSource(character.poseTrack, character.locomotionClip, 1.8)).toBe('static-pose')
    expect(frameMotionSource(character.poseTrack, character.locomotionClip, 3.0)).toBe('locomotion')
  })

  it('held-until-stop crouch (C 按住不松直到停止录制) still lands a crouch keyframe', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId, {
      poseEvents: [
        { time: 0, presetId: undefined, pose: undefined },
        { time: 1.0, presetId: 'crouch', pose: crouch },
      ],
    }))!
    const character = scene.objects.find((o) => o.id === characterId)!
    expect(character.poseTrack?.map((k) => poseKeyframeKey(k))).toEqual(['base', 'preset:crouch'])
    expect(frameMotionSource(character.poseTrack, character.locomotionClip, 2.0)).toBe('static-pose')
  })

  // ── E：保留已选运镜（右横移跟拍）不被采样机位覆盖 ───────────────────────
  it('preserves a pre-selected camera move (右横移跟拍) instead of overwriting it with a sampled path (E)', () => {
    const state = createDefaultScene3DState()
    const characterId = state.objects[0].id
    const cameraId = state.cameras[0].id
    const withMove = applyCameraMovePreset(state, cameraId, { move: 'track_right', duration: 5, amplitude: 1 })!.state
    // 用户录人物动作时也绕拍了相机——必须忽略采样、保留预选运镜。
    const scene = buildRecordedTakeScene(withMove, take(characterId, {
      cameraSamples: [sample(0, [4, 2, 5]), sample(2000, [2, 2, 6]), sample(4000, [0, 2, 5])],
    }))!
    expect(scene.trajectories.some((t) => t.name === CAMERA_MOVE_LABEL.track_right)).toBe(true)
    expect(scene.trajectories.some((t) => t.name === '机位路径')).toBe(false)
    // 相机仍绑运镜轨迹，且按录制时长重定时到 [0,duration]（跟人物动作同步跑）。
    const cameraBinding = scene.trajectoryBindings.find((b) => b.objects.some((o) => o.objectId === cameraId))!
    expect(cameraBinding.startTime).toBe(0)
    expect(cameraBinding.endTime).toBe(4)
    // 角色走位轨迹仍在（人物动作没被运镜挤掉）。
    expect(scene.trajectories.some((t) => t.name.endsWith('走位'))).toBe(true)
  })

  it('still samples a fresh 机位路径 when there is NO pre-existing camera move (老行为不回归)', () => {
    const { state, characterId } = baseSceneWithCharacter()
    const scene = buildRecordedTakeScene(state, take(characterId, {
      cameraSamples: [sample(0, [4, 2, 5]), sample(2000, [2, 2, 6]), sample(4000, [0, 2, 5])],
    }))!
    expect(scene.trajectories.some((t) => t.name === '机位路径')).toBe(true)
    expect(scene.cameras[0].followTargetId).toBe(characterId)
  })

  // ── E：位置-only 预选运镜必须 follow 被录角色（不只断言轨迹名，投影主体验「持续看住」）──
  it('位置-only 预选运镜继承后 follow 被录角色（朝向单源不回退静态 target）', () => {
    const state = createDefaultScene3DState()
    const characterId = state.objects[0].id
    const withMove = applyCameraMovePreset(state, state.cameras[0].id, { move: 'track_right', duration: 5, amplitude: 1 })!.state
    const scene = buildRecordedTakeScene(withMove, take(characterId))!
    expect(scene.cameras[0].followTargetId).toBe(characterId)
    expect(scene.cameras[0].aimTrajectoryId).toBeUndefined()
  })

  it('E 真投影：右横移跟拍 take 首/中/尾角色完整可见 + 中心横向漂移 ≤ 画宽 10%', () => {
    const state = createDefaultScene3DState()
    const characterId = state.objects[0].id
    const withMove = applyCameraMovePreset(state, state.cameras[0].id, { move: 'track_right', duration: 5, amplitude: 1 })!.state
    // 角色沿 Z 向前走一段（右横移跟拍应始终看住它）。
    const scene = buildRecordedTakeScene(withMove, take(characterId, {
      characterSamples: [sample(0, [0, 1.25, 0]), sample(2500, [0, 1.25, 2.5]), sample(5000, [0, 1.25, 5])],
    }))!
    const camera0 = scene.cameras[0]
    const character = scene.objects.find((o) => o.id === characterId)!
    const aspect = SCENE3D_ASPECT_RATIOS[camera0.aspectRatio]
    let centerX0: number | null = null
    for (const frac of [0, 0.5, 1]) {
      const tSec = frac * scene.sceneTimeline.totalDuration
      const cam = cameraWithPlaybackPosition(scene, camera0, tSec)
      // 角色 AABB 从脚底（轨迹采样点）建——objectSubjectAabb 内部 +halfHeight 求中心，与相机 follow 瞄准点同口径。
      const feet = sceneObjectTrajectorySample(scene, characterId, tSec)!.position
      const aabb = objectSubjectAabb({ ...character, position: [feet.x, feet.y, feet.z] })!
      const rect = projectAabbScreenRect(aabb, cam.position, cam.target, cam.fov, aspect)
      expect(rect, `t=${frac} 角色应在相机前方`).not.toBeNull()
      // 完整可见（真渲染 8% 容差；求解线 10%）——头脚左右都不裁。
      expect(rect!.minX, `t=${frac} 左`).toBeGreaterThanOrEqual(0.08 - 1e-6)
      expect(rect!.maxX, `t=${frac} 右`).toBeLessThanOrEqual(0.92 + 1e-6)
      expect(rect!.minY, `t=${frac} 上(头)`).toBeGreaterThanOrEqual(0.08 - 1e-6)
      expect(rect!.maxY, `t=${frac} 下(脚)`).toBeLessThanOrEqual(0.92 + 1e-6)
      const centerX = (rect!.minX + rect!.maxX) / 2
      if (centerX0 === null) centerX0 = centerX
      else expect(Math.abs(centerX - centerX0), `t=${frac} 中心横向漂移`).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('buildRecordedCameraTakeScene', () => {
  function cameraTake(cameraId: string, overrides: Partial<RecordedCameraTake> = {}): RecordedCameraTake {
    return {
      possessedCameraId: cameraId,
      cameraSamples: [
        sample(0, [4, 2, 5]),
        sample(2000, [2, 2, 6]),
        sample(4000, [0, 2, 5]),
      ],
      targetSamples: [
        sample(0, [0, 1, 0]),
        sample(2000, [0, 1, -1]),
        sample(4000, [1, 1, -2]),
      ],
      durationSeconds: 4,
      ...overrides,
    }
  }

  it('binds the possessed camera to its recorded dolly path over the full duration', () => {
    const state = createDefaultScene3DState()
    const cameraId = state.cameras[0].id
    const scene = buildRecordedCameraTakeScene(state, cameraTake(cameraId))
    expect(scene).not.toBeNull()
    const positionBinding = scene!.trajectoryBindings.find((b) =>
      b.objects.some((o) => o.objectId === cameraId),
    )
    expect(positionBinding).toBeTruthy()
    expect(positionBinding!.startTime).toBe(0)
    expect(positionBinding!.endTime).toBe(4)
    expect(scene!.sceneTimeline.totalDuration).toBe(4)
  })

  it('records the per-frame look direction as an aim trajectory the camera points at (free-look fidelity)', () => {
    const state = createDefaultScene3DState()
    const cameraId = state.cameras[0].id
    const scene = buildRecordedCameraTakeScene(state, cameraTake(cameraId))
    const camera = scene!.cameras[0]
    expect(camera.aimTrajectoryId).toBeTruthy()
    const aimBinding = scene!.trajectoryBindings.find((b) =>
      b.objects.some((o) => o.objectId === cameraAimBindingId(cameraId)),
    )
    expect(aimBinding).toBeTruthy()
    expect(aimBinding!.trajectoryId).toBe(camera.aimTrajectoryId)
  })

  it('clears followTargetId so aim trajectory is the single source of camera orientation', () => {
    const state = createDefaultScene3DState()
    state.cameras[0].followTargetId = state.objects[0].id
    const cameraId = state.cameras[0].id
    const scene = buildRecordedCameraTakeScene(state, cameraTake(cameraId))
    expect(scene!.cameras[0].followTargetId).toBeUndefined()
  })

  it('handles a pure pan (no translation) by synthesizing a static position path so it still plays back', () => {
    const state = createDefaultScene3DState()
    const cameraId = state.cameras[0].id
    const scene = buildRecordedCameraTakeScene(state, cameraTake(cameraId, {
      // camera stays in place; only the look direction sweeps
      cameraSamples: [sample(0, [4, 2, 5]), sample(4000, [4, 2, 5])],
    }))
    expect(scene).not.toBeNull()
    const positionBinding = scene!.trajectoryBindings.find((b) =>
      b.objects.some((o) => o.objectId === cameraId),
    )
    expect(positionBinding).toBeTruthy()
    expect(scene!.cameras[0].aimTrajectoryId).toBeTruthy()
  })

  it('puts the possessed camera at cameras[0] so the offscreen capture uses it', () => {
    const state = createDefaultScene3DState()
    // add a second camera and possess it
    const second = { ...state.cameras[0], id: 'cam-second', name: '相机2' }
    state.cameras.push(second)
    const scene = buildRecordedCameraTakeScene(state, cameraTake('cam-second'))
    expect(scene!.cameras[0].id).toBe('cam-second')
  })

  it('returns null when neither position nor look direction ever moved (no camera move)', () => {
    const state = createDefaultScene3DState()
    const cameraId = state.cameras[0].id
    const scene = buildRecordedCameraTakeScene(state, cameraTake(cameraId, {
      cameraSamples: [sample(0, [4, 2, 5]), sample(4000, [4, 2, 5])],
      targetSamples: [sample(0, [0, 1, 0]), sample(4000, [0, 1, 0])],
    }))
    expect(scene).toBeNull()
  })

  it('returns null when the possessed camera is missing', () => {
    const state = createDefaultScene3DState()
    expect(buildRecordedCameraTakeScene(state, cameraTake('nope'))).toBeNull()
  })

  it('preserves all base objects (recording is additive)', () => {
    const state = createDefaultScene3DState()
    const cameraId = state.cameras[0].id
    const scene = buildRecordedCameraTakeScene(state, cameraTake(cameraId))
    expect(scene!.objects).toHaveLength(state.objects.length)
  })

  it('survives serialize round-trip: aimTrajectoryId + `${cam}:aim` binding both persist (存盘重载后相机朝向不退化)', () => {
    const base = createDefaultScene3DState()
    const cameraId = base.cameras[0].id
    const scene = buildRecordedCameraTakeScene(base, cameraTake(cameraId))!
    const aimBindingId = cameraAimBindingId(cameraId)
    // 归一（模拟存盘→重载）后：相机标志与 aim 绑定对象都还在（此前被 serializer 静默丢弃）。
    const reloaded = normalizeScene3DState(scene)
    const camera = reloaded.cameras.find((c) => c.id === cameraId)!
    expect(camera.aimTrajectoryId).toBe(scene.cameras[0].aimTrajectoryId)
    const aimBinding = reloaded.trajectoryBindings.find((b) => b.objects.some((o) => o.objectId === aimBindingId))
    expect(aimBinding, 'aim 绑定应保留其合成对象 id').toBeTruthy()
    expect(aimBinding!.trajectoryId).toBe(camera.aimTrajectoryId)
  })
})
