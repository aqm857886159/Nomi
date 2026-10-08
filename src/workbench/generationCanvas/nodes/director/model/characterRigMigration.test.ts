import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DIRECTOR_PROJECT_VERSION } from './directorTypes'
import { normalizeDirectorProject, normalizeScene, ualMigrationNoteOf } from './directorProject'

const FIXTURE = path.resolve(__dirname, '__fixtures__/legacy-xbot-project.v2.json')
const readFixture = (): unknown => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

describe('读档迁移：2026-10-07 前的 x-bot 工程 → UAL（唯一入口 normalizeObject）', () => {
  it('内置人偶：rig → ual，动作 id 按 §3 对应表换，编译器写的片段名跟着换、用户起的名字不动', () => {
    const project = normalizeDirectorProject(readFixture())
    expect(project.version).toBe(DIRECTOR_PROJECT_VERSION)
    const byId = Object.fromEntries(project.scenes[0].objects.map((object) => [object.id, object]))
    expect(byId.walker.rig).toBe('ual')
    expect(byId.walker.modelPath).toBe('builtin:x-bot')
    expect(byId.walker.posePreset).toBe('Idle_Loop')
    expect(byId.walker.actionClips!.map((clip) => [clip.actionPose, clip.name])).toEqual([['Walk_Loop', 'Walk_Loop'], ['Jog_Fwd_Loop', '动作·跑']])
    expect(byId.sitter.rig).toBe('ual')
    expect(byId.sitter.posePreset).toBe('Sitting_Idle_Loop')
    expect(byId.kneeler.posePreset).toBe('tpose')
    expect(byId.kneeler.actionClips!.map((clip) => [clip.actionPose, clip.name])).toEqual([
      ['Fixing_Kneeling', 'Fixing_Kneeling'],
      ['Fixing_Kneeling', 'Fixing_Kneeling'],
      ['Idle_Loop', 'Idle_Loop'],
      ['Crouch_Idle_Loop', '坐地'],
    ])
  })

  it('手调骨骼：键换成 UAL 骨名、值原样（规范轴度数）；手指 / 末端丢掉；骨盆偏移不变；姿态关键帧同样处理', () => {
    const sitter = normalizeDirectorProject(readFixture()).scenes[0].objects.find((object) => object.id === 'sitter')!
    expect(sitter.boneRotations).toEqual({
      'DEF-upper_armL': { x: 30, y: -12.5, z: 4 },
      'DEF-forearmR': { x: 0, y: 45, z: 0 },
      'DEF-head': { x: -10, y: 20, z: 0 },
    })
    expect(sitter.hipsOffset).toEqual({ x: 0, y: -0.05, z: 0.02 })
    const keyframes = sitter.actionClips![0].keyframes!
    expect(keyframes[0].boneRotations).toEqual({ 'DEF-spine003': { x: 10, y: 0, z: 0 } })
    expect(keyframes[1].boneRotations).toEqual({ 'DEF-spine003': { x: -5, y: 8, z: 0 } })
    expect(keyframes[1].hipsOffset).toEqual({ x: 0, y: -0.1, z: 0 })
  })

  it('用户上传的 Mixamo 角色：只换动作 id（静止姿态 / 片段 / 编译器写的片段名），骨架、模型路径、手调骨骼不动', () => {
    const raw = readFixture() as { scenes: Array<{ objects: Array<Record<string, unknown>> }> }
    const rawUploaded = raw.scenes[0].objects.find((object) => object.id === 'uploaded')!
    const uploaded = normalizeDirectorProject(readFixture()).scenes[0].objects.find((object) => object.id === 'uploaded')!
    expect(uploaded.rig).toBe('mixamo')
    expect(uploaded.modelPath).toBe(rawUploaded.modelPath)
    expect(uploaded.boneRotations).toEqual(rawUploaded.boneRotations)
    expect(uploaded.posePreset).toBe('Idle_Loop')
    expect(uploaded.actionClips!.map((clip) => [clip.actionPose, clip.name])).toEqual([['Walk_Loop', 'Walk_Loop']])
    const box = normalizeDirectorProject(readFixture()).scenes[0].objects.find((object) => object.id === 'box')!
    expect(box.rig).toBeUndefined()
  })

  it('迁移说明只在内存：数得出近似动作与丢弃骨键；不写进工程', () => {
    const project = normalizeDirectorProject(readFixture())
    // 近似：kneeling_down / kneeling / standing_up / male_sitting_pose 四个片段；丢弃：手指 + 头顶末端 2 个 + 关键帧里拇指 1 个
    // 3 个内置人偶 + 1 个上传角色（只换了动作 id）；上传角色的手指键不动，不算丢弃
    expect(ualMigrationNoteOf(project)).toEqual({ characters: 4, approximatedActions: 4, droppedBoneKeys: 3 })
    expect(JSON.stringify(project)).not.toContain('approximatedActions')
  })

  it('幂等：迁移后的工程再读一遍，结果不变、也不再算近似 / 丢弃', () => {
    const once = normalizeDirectorProject(readFixture())
    const twice = normalizeDirectorProject(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    expect(ualMigrationNoteOf(twice)).toBeNull()
  })

  it('只读：读档不改传进来的原始数据', () => {
    const raw = readFixture()
    const before = JSON.stringify(raw)
    normalizeDirectorProject(raw)
    expect(JSON.stringify(raw)).toBe(before)
  })

  it('旧版 Nomi 读过再存（丢了 rig、留着 UAL 骨名和动作 id）：再迁一遍能认回来', () => {
    const migrated = normalizeDirectorProject(readFixture())
    const oldAppSaved = JSON.parse(JSON.stringify(migrated)) as { scenes: Array<{ objects: Array<Record<string, unknown>> }> }
    for (const object of oldAppSaved.scenes[0].objects) if (object.rig === 'ual') delete object.rig
    const recovered = normalizeDirectorProject(oldAppSaved)
    expect(recovered.scenes[0].objects.find((object) => object.id === 'sitter')).toEqual(migrated.scenes[0].objects.find((object) => object.id === 'sitter'))
  })

  it('导入图层（storeAssetActions 走 normalizeScene）同样迁移', () => {
    const raw = readFixture() as { scenes: unknown[] }
    const scene = normalizeScene(raw.scenes[0], '导入')!
    expect(scene.objects.find((object) => object.id === 'walker')!.rig).toBe('ual')
  })
})
