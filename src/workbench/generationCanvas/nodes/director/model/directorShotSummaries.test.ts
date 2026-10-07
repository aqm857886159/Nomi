import { describe, expect, it } from 'vitest'
import { activeShotIndexAt, formatPlayheadSeconds, summarizeDirectorShots, type DirectorShotSummary } from './directorShotSummaries'
import { directorOverviewPose } from './directorOverviewPose'
import { distanceForShotSize } from './directorEvalMeasurement'
import { createDefaultProject } from './directorProject'
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
