import { describe, expect, it } from 'vitest'
import { migrateScene3DState } from './migrateScene3d'
import { migrateScene3DNode } from './migrateScene3dNode'

const DEG = Math.PI / 180

// 一份手工拼的老工程：假人（蹲姿 + 姿态轨 + walk）、群众 2×2、道具 car、盒子 / 平面、模型、灯（在组里）、
// 两台相机（一台绑轨迹带变焦、一台跟随主角）、全景
function legacyFixture() {
  const squat = { mixamorigLeftUpLeg: [-1.2, 0, 0], mixamorigRightUpLeg: [-1.2, 0, 0], mixamorigLeftLeg: [1.9, 0, 0] }
  return {
    objects: [
      { id: 'hero', name: '主角', type: 'mannequin', visible: true, position: [0, 1.25, 0], rotation: [0, Math.PI / 2, 0], scale: [2.5, 2.5, 2.5], color: '#ef4444', pose: squat, locomotionClip: 'walk', poseTrack: [{ time: 0, presetId: 'standing' }, { time: 2, pose: squat }] },
      { id: 'crowd', name: '群众', type: 'mannequinCrowd', visible: true, position: [0, 1.25, -4], rotation: [0, 0, 0], scale: [2.5, 2.5, 2.5], crowdRows: 2, crowdColumns: 2, crowdSpacing: 0.4 },
      { id: 'car', name: '车', type: 'prop', propKind: 'car', visible: true, position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'grp', name: '组', type: 'group', visible: true, position: [2, 0, 2], rotation: [0, Math.PI / 2, 0], scale: [1, 1, 1] },
      { id: 'box', name: '盒子', type: 'mesh', geometry: 'box', visible: true, position: [1, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#123456', parentId: 'grp' },
      { id: 'floor', name: '地', type: 'mesh', geometry: 'plane', visible: true, position: [0, 0.02, 0], rotation: [-Math.PI / 2, 0, 0], scale: [10, 6, 1] },
      { id: 'mdl', name: '模型', type: 'model', modelUrl: 'nomi-local://a.glb', visible: true, position: [0, 0, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { id: 'lamp', name: '灯', type: 'light', lightType: 'point', lightColor: '#ffaa00', lightIntensity: 2, visible: true, position: [1, 3, 0], rotation: [0, 0, 0], scale: [1, 1, 1], parentId: 'grp' },
    ],
    cameras: [
      { id: 'cam1', name: '机位 1', visible: true, position: [0, 1.5, 6], rotation: [0, 0, 0], target: [0, 1.35, 0], fov: 40, aspectRatio: '2.39:1', lensDepth: 0, shakeAmplitude: 30 },
      { id: 'cam2', name: '机位 2', visible: true, position: [3, 1.5, 3], rotation: [0, 0, 0], target: [0, 1, 0], fov: 50, aspectRatio: '16:9', lensDepth: 0, followTargetId: 'hero' },
    ],
    trajectories: [
      { id: 'tr-cam', name: '推近', points: [{ id: 'p1', position: [0, 1.5, 6] }, { id: 'p2', position: [0, 1.5, 3] }], tension: 0.5, closed: false, color: '#fff' },
      { id: 'tr-hero', name: '走位', points: [{ id: 'q1', position: [0, 0, 0] }, { id: 'q2', position: [3, 0, 0] }, { id: 'q3', position: [3, 0, 3] }], tension: 0.5, closed: false, color: '#fff' },
    ],
    trajectoryBindings: [
      { id: 'b-cam', trajectoryId: 'tr-cam', objects: [{ objectId: 'cam1', offsetRatio: 0 }], startTime: 0, endTime: 4, direction: 'forward', fovFrom: 40, fovTo: 20 },
      { id: 'b-hero', trajectoryId: 'tr-hero', objects: [{ objectId: 'hero', offsetRatio: 0 }], startTime: 1, endTime: 5, direction: 'forward' },
    ],
    trajectoryGroups: [],
    sceneTimeline: { totalDuration: 10 },
    environment: { preset: 'studio', showGrid: false, showAxes: false, showSky: true, darkMode: false, backgroundColor: '#cfe3f5', panoramaUrl: 'nomi-local://pano.jpg', panoramaRotation: 0.5, environmentMode: 'panorama', sphereRadius: 60 },
    editorCamera: { position: [4, 2, 5], target: [0, 0, 0], rotation: [0, 0, 0], mode: 'edit' },
  }
}

describe('migrateScene3DState', () => {
  const { project, report } = migrateScene3DState(legacyFixture(), { sceneName: '场景 1' })
  const scene = project.scenes[0]
  const byId = (id: string) => scene.objects.find((object) => object.id === id)

  it('假人 → 角色：脚底原点、scale/2.5、朝向弧度→度、姿态弧度→度', () => {
    const hero = byId('hero')!
    expect(hero.type).toBe('character')
    expect(hero.position).toEqual({ x: 0, y: 0, z: 0 })
    expect(hero.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(hero.rotation.y).toBeCloseTo(90, 1)
    expect(hero.boneRotations?.mixamorigLeftLeg?.x).toBeCloseTo(1.9 / DEG, 1)
    expect(hero.modelPath).toBe('builtin:x-bot')
    expect(hero.rig).toBe('mixamo')
  })

  it('群众 → 组 + 成员角色，行列间距按 V1 公式', () => {
    const group = byId('crowd')!
    expect(group.type).toBe('group')
    const members = scene.objects.filter((object) => object.parentId === 'crowd')
    expect(members).toHaveLength(4)
    expect(members.every((member) => member.type === 'character')).toBe(true)
    const xs = members.map((member) => member.position.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1)
  })

  it('道具 → 组 + 图元子对象（car = 6 件），mesh / 模型 / 组 / 平面各归其位', () => {
    expect(byId('car')!.type).toBe('group')
    expect(scene.objects.filter((object) => object.parentId === 'car')).toHaveLength(6)
    expect(byId('box')!.type).toBe('cube')
    expect(byId('box')!.parentId).toBe('grp')
    expect(byId('mdl')!.type).toBe('model')
    expect(byId('mdl')!.modelPath).toBe('nomi-local://a.glb')
    const floor = byId('floor')!
    expect(floor.type).toBe('plane')
    expect(Math.abs(floor.rotation.x)).toBeLessThan(1)
    expect(floor.scale).toEqual({ x: 10, y: 1, z: 6 })
  })

  it('组里的灯解成世界坐标的顶层灯', () => {
    expect(scene.lights).toHaveLength(1)
    const lamp = scene.lights[0]
    expect(lamp.type).toBe('point')
    expect(lamp.color).toBe('#ffaa00')
    expect(lamp.intensity).toBe(2)
    // grp 在 (2,0,2) 且绕 Y 转 90°：局部 (1,3,0) → 世界 (2, 3, 1)
    expect(lamp.position.x).toBeCloseTo(2, 3)
    expect(lamp.position.y).toBeCloseTo(3, 3)
    expect(lamp.position.z).toBeCloseTo(1, 3)
  })

  it('相机：target → yaw/pitch，跟随目标 → 看向对象，画幅 2.39:1 → 21:9 并写进报告', () => {
    const cam1 = scene.cameras.find((camera) => camera.id === 'cam1')!
    expect(cam1.yaw).toBeCloseTo(180, 0)
    expect(cam1.fov).toBe(40)
    expect(cam1.focalLengthMm).toBeGreaterThan(0)
    const cam2 = scene.cameras.find((camera) => camera.id === 'cam2')!
    expect(cam2.lookAtType).toBe('object')
    expect(cam2.lookAtObjectId).toBe('hero')
    expect(project.exportRatio).toBe('21:9')
    expect(report.dropped.some((line) => line.includes('2.39:1'))).toBe(true)
    expect(report.dropped.some((line) => line.includes('手持抖动'))).toBe(true)
  })

  it('轨迹绑定按 30fps 烘成路标：机位带变焦 fov 从 40 到 20，主角沿路走且朝向切线', () => {
    const cam1 = scene.cameras.find((camera) => camera.id === 'cam1')!
    expect(cam1.trajectoryClips).toHaveLength(1)
    expect(cam1.trajectoryClips![0]).toMatchObject({ startTime: 0, endTime: 4 })
    const camPoints = cam1.motionTrajectory!
    expect(camPoints).toHaveLength(121)
    expect(camPoints[0].fov).toBeCloseTo(40, 1)
    expect(camPoints[camPoints.length - 1].fov).toBeCloseTo(20, 1)
    expect(camPoints[camPoints.length - 1].z).toBeCloseTo(3, 2)
    const hero = byId('hero')!
    const points = hero.motionTrajectory!
    expect(points[0].time).toBe(1)
    expect(points[points.length - 1].time).toBe(5)
    expect(points[0].y).toBeCloseTo(0, 3)
    const mid = points.find((point) => point.time === 2)!
    expect(mid.x).toBeGreaterThan(0.5)
    expect(Math.abs(mid.yaw - 90)).toBeLessThan(25)
    expect(scene.timelineTrackOrder).toContain('hero')
    expect(scene.timelineTrackOrder).toContain('cam1')
  })

  it('locomotion 与姿态轨 → 动作片段（walk 循环 + 骨骼姿态关键帧）', () => {
    const hero = byId('hero')!
    const clips = hero.actionClips!
    const walk = clips.find((clip) => clip.clipType === 'action')!
    expect(walk.actionPose).toBe('standard_walk')
    expect(walk.startTime).toBe(1)
    expect(walk.endTime).toBe(5)
    const pose = clips.find((clip) => clip.clipType === 'custom_pose')!
    expect(pose.keyframes).toHaveLength(2)
    expect(pose.keyframes![0].boneRotations).toEqual({})
    expect(pose.keyframes![1].boneRotations.mixamorigLeftLeg?.x).toBeCloseTo(1.9 / DEG, 1)
  })

  it('环境 → 天空色 / 网格 / 全景（半径、弧度→度）；不迁的项写进报告', () => {
    expect(scene.sceneConfig.skyColor).toBe('#cfe3f5')
    expect(scene.sceneConfig.gridVisible).toBe(false)
    expect(scene.panoramaConfig.url).toBe('nomi-local://pano.jpg')
    expect(scene.panoramaConfig.radius).toBe(60)
    expect(scene.panoramaConfig.rotationY).toBeCloseTo(0.5 / DEG, 1)
    expect(report.dropped.some((line) => line.includes('编辑相机'))).toBe(true)
    expect(report.objects).toBeGreaterThan(10)
  })

  it('空 / 非法输入得到空工程，不炸', () => {
    const empty = migrateScene3DState(null, { sceneName: 'x' })
    expect(empty.project.scenes[0].objects).toHaveLength(0)
    const junk = migrateScene3DState({ objects: [1, 'a', { id: '' }], cameras: 'no' }, { sceneName: 'x' })
    expect(junk.project.scenes[0].objects).toHaveLength(0)
  })
})

describe('migrateScene3DNode', () => {
  it('scene3d 节点 → director 节点：kind 换、meta.scene3dState 变 directorProject、自动出图标志原样保留', () => {
    const migrated = migrateScene3DNode({ kind: 'scene3d', meta: { scene3dState: legacyFixture(), stagingAutoCapture: { targetNodeId: 'n1' }, other: 1 } }, '场景 1')
    expect(migrated.kind).toBe('director')
    expect(migrated.meta.scene3dState).toBeUndefined()
    expect((migrated.meta.directorProject as { scenes: unknown[] }).scenes).toHaveLength(1)
    expect(migrated.meta.stagingAutoCapture).toEqual({ targetNodeId: 'n1' })
    expect(migrated.meta.other).toBe(1)
    expect(migrated.report?.cameras).toBe(2)
  })

  it('已有 directorProject 的节点原样返回（幂等）', () => {
    const migrated = migrateScene3DNode({ kind: 'director', meta: { directorProject: { version: 2 } } }, 'x')
    expect(migrated.report).toBeNull()
    expect(migrated.meta.directorProject).toEqual({ version: 2 })
  })
})
