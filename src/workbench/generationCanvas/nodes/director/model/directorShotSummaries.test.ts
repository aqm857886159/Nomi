import { describe, expect, it } from 'vitest'
import { activeShotIndexAt, formatPlayheadSeconds, summarizeDirectorShots, type DirectorShotSummary } from './directorShotSummaries'
import { directorOverviewPose } from './directorOverviewPose'
import { distanceForShotSize, recognizeCameraMotion, sampleDirectorProject, shotSizeForHeight } from './directorEvalMeasurement'
import { subjectAt, sampleForSubject } from './directorShotSubject'
import { buildS1Template } from './compiler/s1SceneTemplates'
import { compileDirectorPlan } from './compiler/directorPlanCompiler'
import { normalizeDirectorPlan, parseDirectorPlan } from '../../../../../../electron/shared/director/directorPlanSchema'
import { PREVIZ_RULER_PLAN, rightTrackProject } from '../../../../../../evals/director/previzRulerFixture'
import { normalizeDirectorProject, createDefaultProject } from './directorProject'
import type { DirectorCamera, DirectorObject, DirectorProject } from './directorTypes'

const waypoint = (id: string, time: number, z: number) => ({
  id, time, frameIndex: Math.round(time * 30), x: 0, y: 1.6, z, yaw: 180, pitch: 0, roll: 0,
})

function manualSummaryProject(): DirectorProject {
  const project = createDefaultProject('manual-summary-fixture')
  const scene = project.scenes[0]
  const hero: DirectorObject = {
    id: 'hero', name: '青衣女子', type: 'character', position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false,
    actionTrackEnabled: true,
    actionClips: [{ id: 'walk', name: '走路', clipType: 'action', actionPose: 'Walk_Loop', startTime: 0, endTime: 1, startFrame: 0, endFrame: 30 }],
  }
  const distantActor: DirectorObject = {
    ...hero, id: 'distant-actor', name: '黑衣侍卫', position: { x: 0, y: 0, z: 3 }, actionClips: undefined,
  }
  const scenery: DirectorObject = {
    id: 'ground', name: '地面', type: 'cube', position: { x: 0, y: -2, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 20, y: 4, z: 20 }, visible: true, locked: false, isAuxiliary: true,
  }
  const closeCamera: DirectorCamera = {
    id: 'close', name: '近景机位', position: { x: 0, y: 1.6, z: 3 }, yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 0,
    motionTrajectory: [waypoint('close-0', 0, distanceForShotSize('特写', 1.75, 45, 'figure')),
      waypoint('close-1', 1.5, distanceForShotSize('特写', 1.75, 45, 'figure'))],
    trajectoryClips: [{ id: 'close-clip', startTime: 0, endTime: 1.5, startFrame: 0, endFrame: 45 }],
  }
  const mediumCamera: DirectorCamera = {
    id: 'medium', name: '中景机位', position: { x: 0, y: 1.6, z: 5 }, yaw: 0, pitch: 0, roll: 0, fov: 45, focalLengthMm: 0,
    motionTrajectory: [waypoint('medium-0', 1.5, distanceForShotSize('中景', 1.75, 45, 'figure')),
      waypoint('medium-1', 3, distanceForShotSize('中景', 1.75, 45, 'figure'))],
    trajectoryClips: [{ id: 'medium-clip', startTime: 1.5, endTime: 3, startFrame: 45, endFrame: 90 }],
  }
  scene.objects = [hero, distantActor, scenery]
  scene.cameras = [closeCamera, mediumCamera]
  scene.timelineTrackOrder = ['close', 'medium']
  return project
}

describe('导演视图镜头条摘要（实测，不读计划值）', () => {
  it('主体取画面里最大的角色，不是场景件；景别与运镜来自实测夹具', () => {
    const shots = summarizeDirectorShots(manualSummaryProject())
    expect(shots.map((shot) => [shot.shotSize, shot.move])).toEqual([['特写', 'static'], ['中景', 'static']])
    expect(shots.map(({ start, end }) => [start, end])).toEqual([[0, 1.75], [1.75, 3]])
  })

  it('这一镜在做什么只取工程里真实的动作片段；没有就留空，界面说明缺动作片段', () => {
    const shots = summarizeDirectorShots(manualSummaryProject())
    expect(shots).toHaveLength(2)
    expect(shots[0].actions.map((action) => [action.objectName, action.actionPose])).toEqual([['青衣女子', 'Walk_Loop']])
    expect(shots[1].actions).toEqual([])
  })

  it('空工程没有镜头', () => {
    expect(summarizeDirectorShots(createDefaultProject('empty'))).toEqual([])
  })
})

describe('播放头落在哪一镜', () => {
  const shots = [0, 4.25, 8.25].map((start, index, all) => ({ start, end: all[index + 1] ?? 12, cameraId: null, shotSize: null, move: 'static', actions: [] })) as DirectorShotSummary[]
  it('点卡跳到开头后量化到 30fps 网格，差半帧仍算这一镜', () => {
    expect(activeShotIndexAt(shots, 4.25)).toBe(1)
    expect(activeShotIndexAt(shots, 4.25 - 1 / 120)).toBe(1)
    expect(activeShotIndexAt(shots, 4.2)).toBe(0)
  })
  it('超过末尾仍是最后一镜；没有镜头 = -1', () => {
    expect(activeShotIndexAt(shots, 99)).toBe(2)
    expect(activeShotIndexAt([], 1)).toBe(-1)
  })
  it('秒数读数两位整数一位小数', () => {
    expect(formatPlayheadSeconds(4.9)).toBe('04.9')
    expect(formatPlayheadSeconds(11.9999)).toBe('12.0')
  })
})

describe('导演视图进场取景', () => {
  it('空场景不动自由相机；有角色时从 +Z 抬高俯看角色中心', () => {
    expect(directorOverviewPose(createDefaultProject('empty').scenes[0])).toBeNull()
    const scene = manualSummaryProject().scenes[0]
    const pose = directorOverviewPose(scene)
    expect(pose).not.toBeNull()
    const actors = scene.objects.filter((object) => object.type === 'character')
    const centerZ = actors.reduce((sum, object) => sum + object.position.z, 0) / actors.length
    expect(pose!.position.z).toBeGreaterThan(centerZ)
    expect(pose!.position.y).toBeGreaterThan(2)
    expect(pose!.pitch).toBeGreaterThan(0)
  })
})


describe('预演共享量尺回归', () => {
  it('三人街头首镜量计划记录的人，不能把实体楼当主体', () => {
    const parsed = parseDirectorPlan(normalizeDirectorPlan(PREVIZ_RULER_PLAN))
    if (!parsed.success) throw parsed.error
    const compiled = compileDirectorPlan(parsed.data)
    if (!compiled.ok) throw new Error(compiled.errors.join(';'))
    const shots = summarizeDirectorShots(JSON.parse(JSON.stringify(compiled.project)))
    expect(shots[0].shotSize).toBe('远景')
  })

  it('相机向画面右移 2m，不能按世界负 X 判成左移', () => {
    const motion = recognizeCameraMotion(sampleDirectorProject(rightTrackProject(), { fps: 4 }), 'hero', { start: 0, end: 2 })
    expect(motion.cameraDelta.x).toBe(-2)
    expect(motion.cameraTravel).toBe(2)
    expect(motion.move).toBe('track_right')
  })

  it.each([0.17, 0.19, 0.21])('人高占画高 %s 时实测为远景', (ratio) => {
    expect(shotSizeForHeight(ratio, 'figure')).toBe('远景')
  })
})


describe('取景身份与物理身份分离', () => {
  it('显式主体经工程正规化保留，即使另一个人更大也不换人', () => {
    const project = manualSummaryProject()
    Object.assign(project.scenes[0].cameras[0], { measurementSubject: { objectId: 'distant-actor' } })
    const normalized = normalizeDirectorProject(JSON.parse(JSON.stringify(project)))
    expect(normalized.scenes[0].cameras[0]).toHaveProperty('measurementSubject.objectId', 'distant-actor')
  })
  it('显式主体失效时不可测，不能换成另一个人', () => {
    const project = manualSummaryProject()
    Object.assign(project.scenes[0].cameras[0], { measurementSubject: { objectId: 'deleted' } })
    expect(summarizeDirectorShots(project)[0].shotSize).toBeNull()
  })
  it('总览忽略实体背景楼，放大楼体不改变取景', () => {
    const project = manualSummaryProject()
    const scene = project.scenes[0]
    const before = directorOverviewPose(scene)
    const building = { ...scene.objects[2], id: 'building', isAuxiliary: false, framingRole: 'background' as const, position: { x: 500, y: 0, z: 0 } }
    scene.objects.push(building)
    expect(directorOverviewPose(scene)).toEqual(before)
  })
  it('手搭台的人物优先于更大的道具，无人物才量道具', () => {
    const project = manualSummaryProject()
    const scene = project.scenes[0]
    // Both are in frame; a cube filling more of the image is not the actor.
    scene.objects.push({ ...scene.objects[0], id: 'prop', type: 'cube', position: { x: 0, y: 1.6, z: 0 }, scale: { x: 2, y: 2, z: 2 }, actionClips: undefined })
    expect(summarizeDirectorShots(project)[1].shotSize).toBe('中景')
    scene.objects = scene.objects.filter((o) => o.type !== 'character' && o.id !== 'ground')
    expect(summarizeDirectorShots(project)[1].shotSize).not.toBeNull()
  })
})


describe('记录主体的形状边界', () => {
  it('命名锚点也经正规化保存，产品直接取锚点实测而非整个人', () => {
    const project = manualSummaryProject()
    const anchor = { name: 'hand', offset: { x: 0, y: 1, z: 0 }, size: { x: 0.18, y: 0.18, z: 0.18 } }
    project.scenes[0].cameras[0].measurementSubject = { objectId: 'hero', anchor }
    const normalized = normalizeDirectorProject(JSON.parse(JSON.stringify(project)))
    expect(normalized.scenes[0].cameras[0].measurementSubject?.anchor).toEqual(anchor)
    const frame = sampleDirectorProject(normalized, { fps: 4 }).frames.find((frame) => frame.time === 0.75)!
    expect(subjectAt(normalized, frame)).toBe('hero.hand')
    expect(summarizeDirectorShots(normalized)[0].shotSize).toBe(sampleForSubject(frame, 'hero.hand')?.shotSize)
    expect(sampleForSubject(frame, 'hero.hand')?.shotSize).not.toBe(frame.objects.hero.shotSize)
  })
  it('只剩实体模板件时没有主体，正规化保留模板取景身份', () => {
    const project = manualSummaryProject()
    const parts = buildS1Template('street').parts
    project.scenes[0].objects = parts.map((part) => part.object)
    const normalized = normalizeDirectorProject(JSON.parse(JSON.stringify(project)))
    expect(normalized.scenes[0].objects.every((o) => o.framingRole === 'background' && o.isAuxiliary === false)).toBe(true)
    expect(summarizeDirectorShots(normalized)[0].shotSize).toBeNull()
    expect(directorOverviewPose(normalized.scenes[0])).toBeNull()
  })
  it('背景身份不随物理辅助标记的开关变动', () => {
    const project = manualSummaryProject()
    const scene = project.scenes[0]
    const scenery = { ...scene.objects[0], id: 'scenery', type: 'cube' as const, framingRole: 'background' as const }
    scene.objects = [scenery]
    for (const auxiliary of [false, true]) {
      scenery.isAuxiliary = auxiliary
      expect(summarizeDirectorShots(project)[0].shotSize).toBeNull()
      expect(directorOverviewPose(scene)).toBeNull()
    }
  })
})


it('物理上不进成片的旧辅助球不会在无人时被当作道具主体', () => {
  const project = manualSummaryProject()
  project.scenes[0].objects = [{ ...project.scenes[0].objects[0], type: 'sphere', isAuxiliary: true, actionClips: undefined }]
  expect(summarizeDirectorShots(project)[0].shotSize).toBeNull()
  expect(directorOverviewPose(project.scenes[0])).toBeNull()
})
