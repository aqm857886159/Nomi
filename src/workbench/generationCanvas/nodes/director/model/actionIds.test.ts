/**
 * 动作 id 只存动作库正名：每一扇把动作 id 写进工程的门 × 每一个别名（2026-10-24 走查 ①，第 2 轮补完编译器、套姿态、读档三处）。
 *
 * 姿态采样（scene/character/poseClipLibrary）只按正名查 glb 里的 clip，别名查不到就退回绑定姿态——放下的群众站成 T 字。
 * 别名表（ACTION_ALIASES）一份三用：AI / 自然语言词、旧 Mixamo id、中文，都是正名的同义词，所以写入时换成正名不改含义。
 * 口径：写口认不出就拒（加人抛错、群众 / 套姿态 / 加片段不写）；读档认不出就原样留着（可能是更新版本动作库里的 id，改写了就毁了它）。
 * 新的写口（生产代码里把 posePreset / actionPose 当键写或赋值）不进下面的名单 = 红：进名单要写清它怎么保证只写正名。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDirectorEditorPersistence } from '../directorEditorPersistence'
import { migrateScene3DState } from '../migration/migrateScene3d'
import { ACTION_ALIASES, ACTION_LIBRARY, LEGACY_POSE_TO_ACTION, resolveActionAlias, T_POSE_ACTION_ID } from './actionLibrary'
import { compileDirectorPlan } from './compiler/directorPlanCompiler'
import { defaultCharacterInput, DEFAULT_CROWD_ACTION_ID } from './defaultCharacter'
import { normalizeDirectorProject, ualMigrationNoteOf } from './directorProject'
import { createDirectorStore } from './directorStore'
import type { DirectorObject, DirectorProject } from './directorTypes'
import { fingerprintDirectorProject } from './planOverrides'
import { findPosePreset } from './posePresets'
import { DEFAULT_CHARACTER_MODEL_PATH } from './rigs'

const ALIASES = Object.keys(ACTION_ALIASES)
const CANONICAL_IDS = ACTION_LIBRARY.map((entry) => entry.id)
const canonicalOf = (id: string): string => resolveActionAlias(id)!.id
const IDENTITY = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
const UNKNOWN = 'Dance_Loop_From_A_Newer_Library'

function storeWithCharacter() {
  const store = createDirectorStore({ defaultSceneName: 'S1' })
  const id = store.getState().addObject(defaultCharacterInput('male', 'P', IDENTITY))
  return { store, id }
}

function crowd(actionId: string) {
  const store = createDirectorStore({ defaultSceneName: 'S1' })
  const groupId = store.getState().batchCreateCrowd({ transform: IDENTITY, rows: 1, cols: 2, spacing: 2, actionId, groupName: 'G', memberName: 'M' })
  return { store, groupId, members: () => store.getState().activeScene().objects.filter((item) => item.parentId === groupId) }
}

/** 一份最小工程：一个角色（读档各种人偶的形状由 patch 给）。 */
function projectWith(character: Partial<DirectorObject>): unknown {
  return {
    version: 3,
    activeSceneId: 'scene-1',
    scenes: [{
      id: 'scene-1', name: 'S1', visible: true, cameras: [], lights: [],
      objects: [{ id: 'c', name: 'C', type: 'character', ...IDENTITY, visible: true, locked: false, ...character }],
    }],
  }
}
const readBack = (raw: unknown): DirectorObject => normalizeDirectorProject(raw).scenes[0].objects[0]
const actionClip = (actionPose: string) => ({ id: 'clip', name: actionPose, clipType: 'action' as const, actionPose, startTime: 0, endTime: 2, startFrame: 0, endFrame: 60 })

/** 编译器：一个人、每个别名一段 hold_pose 动作；按时间顺序一一对上。只编一次。 */
const compiledPerson = (() => {
  const step = 0.1
  const compiled = compileDirectorPlan({
    scene: { environment: 'day', template: 'room', tags: ['class'] },
    actors: [{ id: 'hero', kind: 'person', desc: 'hero', placement: { relation: 'at', ref: 's1-room-floor' } }],
    blocking: ALIASES.map((alias, index) => ({ actor: 'hero', verb: 'hold_pose', window: [index * step, (index + 1) * step], action: alias })),
    shots: [{ id: 'wide', window: [0, ALIASES.length * step], transitionIn: 'cut', subject: 'hero', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } }],
  })
  if (!compiled.ok) throw new Error(`class plan did not compile: ${compiled.errors.join('; ')}`)
  const person = compiled.project.scenes[0].objects.find((object) => object.id === 'actor:hero')!
  const clips = [...(person.actionClips ?? [])].sort((a, b) => a.startTime - b.startTime)
  return { project: compiled.project, person, byAlias: new Map(ALIASES.map((alias, index) => [alias, clips[index]?.actionPose])) }
})()

/** 每扇门：吃一个动作 id（正名或别名），返回它最终存进工程的那个 id。 */
const DOORS: ReadonlyArray<readonly [string, (id: string) => string | undefined]> = [
  ['加人 defaultCharacterInput', (id) => defaultCharacterInput('female', 'P', IDENTITY, id).posePreset],
  ['群众 batchCreateCrowd', (id) => crowd(id).members()[0]?.posePreset],
  ['套姿态 applyPosePreset', (id) => {
    const { store, id: objectId } = storeWithCharacter()
    store.getState().applyPosePreset(objectId, id)
    return store.getState().findObject(objectId)!.posePreset
  }],
  ['整组套姿态 applyPosePresetToGroup', (id) => {
    const group = crowd(id === T_POSE_ACTION_ID ? 'walk' : T_POSE_ACTION_ID)
    group.store.getState().applyPosePresetToGroup(group.groupId!, id)
    return group.members()[1]?.posePreset
  }],
  ['加动作片段 addActionClip', (id) => {
    const { store, id: objectId } = storeWithCharacter()
    return store.getState().addActionClip(objectId, { name: id, clipType: 'action', actionPose: id }, 'at_time', 0)?.actionPose
  }],
  ['改动作片段 updateActionClip', (id) => {
    const { store, id: objectId } = storeWithCharacter()
    const clip = store.getState().addActionClip(objectId, { name: 'x', clipType: 'action', actionPose: id === 'Walk_Loop' ? 'Idle_Loop' : 'Walk_Loop' }, 'at_time', 0)!
    store.getState().updateActionClip(objectId, clip.id, { actionPose: id })
    return store.getState().findObject(objectId)!.actionClips!.find((item) => item.id === clip.id)!.actionPose
  }],
  ['编译器 compileDirectorPlan（动作词 → 动作片段）', (id) => compiledPerson.byAlias.get(id) ?? compileHoldPose(id)],
  ['读档：已是 UAL 的内置人偶的静止姿态', (id) => readBack(projectWith({ modelPath: DEFAULT_CHARACTER_MODEL_PATH, rig: 'ual', posePreset: id })).posePreset],
  ['读档：已是 UAL 的内置人偶的动作片段', (id) => readBack(projectWith({ modelPath: DEFAULT_CHARACTER_MODEL_PATH, rig: 'ual', actionClips: [actionClip(id)] })).actionClips?.[0]?.actionPose],
  ['读档：上传的角色', (id) => readBack(projectWith({ modelPath: 'nomi-asset://characters/hero.glb', rig: 'ual', posePreset: id })).posePreset],
  ['读档：旧 Mixamo 内置人偶', (id) => readBack(projectWith({ modelPath: 'builtin:x-bot', rig: 'mixamo', posePreset: id })).posePreset],
  ['读档：编译器 / 旧版没写 rig 的人', (id) => readBack(projectWith({ posePreset: id })).posePreset],
]

/** 正名不在别名表里，编译器那份按别名编的工程查不到：单独编一次。 */
function compileHoldPose(id: string): string | undefined {
  const compiled = compileDirectorPlan({
    scene: { environment: 'day', template: 'room', tags: ['one'] },
    actors: [{ id: 'hero', kind: 'person', desc: 'hero', placement: { relation: 'at', ref: 's1-room-floor' } }],
    blocking: [{ actor: 'hero', verb: 'hold_pose', window: [0, 1], action: id }],
    shots: [{ id: 'wide', window: [0, 1], transitionIn: 'cut', subject: 'hero', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } }],
  })
  if (!compiled.ok) return undefined
  const person = compiled.project.scenes[0].objects.find((object) => object.id === 'actor:hero')!
  return [...(person.actionClips ?? [])].sort((a, b) => a.startTime - b.startTime)[0]?.actionPose
}

describe.each(DOORS)('%s：存进工程的动作 id 是正名', (_name, door) => {
  it.each(ALIASES)('别名 %s', (alias) => {
    expect(door(alias)).toBe(canonicalOf(alias))
  })

  it('正名原样存', () => {
    const changed = CANONICAL_IDS.filter((id) => door(id) !== id)
    expect(changed).toEqual([])
  })
})

describe('认不出的动作 id：写口拒、读档原样留着', () => {
  it('写口不写', () => {
    expect(() => defaultCharacterInput('male', 'P', IDENTITY, UNKNOWN)).toThrow()
    expect(crowd(UNKNOWN).groupId).toBeNull()
    const { store, id } = storeWithCharacter()
    expect(store.getState().applyPosePreset(id, UNKNOWN)).toBe(false)
    expect(store.getState().findObject(id)!.posePreset).toBe(T_POSE_ACTION_ID)
    const group = crowd(DEFAULT_CROWD_ACTION_ID)
    expect(group.store.getState().applyPosePresetToGroup(group.groupId!, UNKNOWN)).toBe(0)
    expect(store.getState().addActionClip(id, { name: 'x', clipType: 'action', actionPose: UNKNOWN }, 'at_time', 0)).toBeNull()
    const clip = store.getState().addActionClip(id, { name: 'walk', clipType: 'action', actionPose: 'Walk_Loop' }, 'at_time', 0)!
    const undoDepth = store.temporal.getState().pastStates.length
    store.getState().updateActionClip(id, clip.id, { actionPose: UNKNOWN, name: 'renamed' })
    expect(store.getState().findObject(id)!.actionClips!.find((item) => item.id === clip.id)).toMatchObject({ actionPose: 'Walk_Loop', name: 'walk' })
    expect(store.temporal.getState().pastStates.length).toBe(undoDepth)
  })

  it('读档不改写（不猜成别的动作，也不改成 T-Pose）', () => {
    const object = readBack(projectWith({ modelPath: DEFAULT_CHARACTER_MODEL_PATH, rig: 'ual', posePreset: UNKNOWN, actionClips: [actionClip(UNKNOWN)] }))
    expect(object.posePreset).toBe(UNKNOWN)
    expect(object.actionClips![0].actionPose).toBe(UNKNOWN)
  })
})

describe('编译器与 V1 迁移的固定写法也落成正名', () => {
  it('编译出来的人：静止姿态是「站立待机」的正名', () => {
    expect(compiledPerson.person.posePreset).toBe(canonicalOf('standing'))
    expect(compiledPerson.person.posePreset).toBe('Idle_Loop')
  })

  it('编译器出口换成正名不产生假手改：旧编译器（静止姿态写别名 standing）的结果算出的指纹和现在一模一样', () => {
    // 手改覆盖层 = 当前工程相对上一次编译指纹的差（planOverrides）。旧工程里存的是旧编译结果的指纹；
    // 编译出来的人没写 rig，读档本来就走内置 Mixamo 那条迁移、把 standing 换成正名，所以两边归一后相同，不会凭空多出一条「手改了姿态」。
    const legacy = JSON.parse(JSON.stringify(compiledPerson.project)) as DirectorProject
    legacy.scenes[0].objects.find((object) => object.id === 'actor:hero')!.posePreset = 'standing'
    expect(fingerprintDirectorProject(legacy)).toEqual(fingerprintDirectorProject(compiledPerson.project))
  })

  it('V1 场景（人偶 + 群众）迁过来、读进来：每个人的静止姿态都是正名或没有', () => {
    const presets = ['t-pose', 'walk', 'run', 'sit', 'squat', 'crouch', 'single-knee', 'double-knee', 'hands-on-hips', 'point', 'wave', 'cheer']
    const legacy = {
      objects: [
        ...presets.map((id, index) => ({ id: `m-${id}`, name: id, type: 'mannequin', position: [index, 0.9, 0], rotation: [0, 0, 0], scale: [1, 1.8, 1], pose: findPosePreset(id)!.pose, visible: true })),
        { id: 'm-standing', name: 'standing', type: 'mannequin', position: [0, 0.9, 2], rotation: [0, 0, 0], scale: [1, 1.8, 1], visible: true },
        { id: 'crowd', name: 'crowd', type: 'mannequinCrowd', position: [0, 0.9, 4], rotation: [0, 0, 0], scale: [1, 1.8, 1], crowdRows: 1, crowdColumns: 2, visible: true },
      ],
    }
    const project = normalizeDirectorProject(migrateScene3DState(legacy, { sceneName: 'V1' }).project)
    const characters = project.scenes[0].objects.filter((object) => object.type === 'character')
    expect(characters.length).toBe(presets.length + 1 + 2)
    for (const character of characters) {
      if (character.posePreset !== undefined) expect(CANONICAL_IDS, character.name).toContain(character.posePreset)
    }
    expect(Object.values(LEGACY_POSE_TO_ACTION).every((id) => CANONICAL_IDS.includes(id))).toBe(true)
    expect(characters.filter((object) => object.parentId === 'crowd').map((object) => object.posePreset)).toEqual(['Idle_Loop', 'Idle_Loop'])
  })
})

describe('存了别名的旧工程：读进来是正名，再存一次盘上也是正名', () => {
  const FIXTURE = path.resolve(__dirname, '__fixtures__/alias-action-ids-project.v3.json')
  const raw = (): unknown => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const ids = (project: DirectorProject) => Object.fromEntries(project.scenes[0].objects.filter((object) => object.type === 'character').map((object) => [
    object.id, [object.posePreset, ...(object.actionClips ?? []).map((clip) => `${clip.actionPose}|${clip.name}`)],
  ]))
  const EXPECTED = {
    'crowd-1': ['Idle_Loop'],
    'crowd-2': ['Idle_Loop'],
    posed: ['Jog_Fwd_Loop', 'Walk_Loop|Walk_Loop', 'Sitting_Enter|动作·坐'],
    'actor:hero': ['Idle_Loop'],
    uploaded: ['Idle_Loop'],
    future: ['Dance_Loop', 'Moonwalk_Loop|Moonwalk_Loop'],
  }

  it('读进来：别名都换成正名（编译器写的片段名跟着换、用户起的名字不动）；认不出的原样；迁移说明不弹「换成相近动作」', () => {
    const project = normalizeDirectorProject(raw())
    expect(ids(project)).toEqual(EXPECTED)
    expect(ualMigrationNoteOf(project)).toEqual({ characters: 5, approximatedActions: 0, droppedBoneKeys: 0 })
    // 已是 UAL 的人偶：骨架与模型不动
    expect(project.scenes[0].objects.find((object) => object.id === 'crowd-1')).toMatchObject({ rig: 'ual', modelPath: 'builtin:ual' })
    expect(project.scenes[0].objects.find((object) => object.id === 'uploaded')).toMatchObject({ rig: 'ual', modelPath: 'nomi-asset://characters/hero.glb' })
  })

  it('幂等：读过的再读一遍不变、也不再算迁移', () => {
    const once = normalizeDirectorProject(raw())
    const twice = normalizeDirectorProject(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    expect(ualMigrationNoteOf(twice)).toBeNull()
  })

  it('在编辑器里打开、改一笔再存：写到节点 meta 的是正名，没有一个别名', () => {
    const store = createDirectorStore({ rawProject: raw(), defaultSceneName: 'S1' })
    const written: DirectorProject[] = []
    const persistence = createDirectorEditorPersistence({ store, defaultSceneName: 'S1', initialRaw: raw(), write: (project) => written.push(project) })
    store.getState().updateObject('posed', { position: { x: -2.5, y: 0, z: 0 } })
    persistence.saveNow()
    expect(written).toHaveLength(1)
    const onDisk = JSON.parse(JSON.stringify(written[0])) as DirectorProject
    expect(ids(onDisk)).toEqual(EXPECTED)
    const stored = onDisk.scenes[0].objects.flatMap((object) => [object.posePreset, ...(object.actionClips ?? []).map((clip) => clip.actionPose)]).filter(Boolean) as string[]
    expect(stored.filter((id) => Object.prototype.hasOwnProperty.call(ACTION_ALIASES, id))).toEqual([])
    expect(ualMigrationNoteOf(normalizeDirectorProject(onDisk))).toBeNull()
  })
})

/**
 * 生产代码里把动作 id 写进工程的地方（posePreset / actionPose 作对象键或被赋值），每一处说清它怎么只写正名。
 * 名单外多出一处 = 红（新写口必须经 resolveActionAlias 解析、认不出就拒，再进名单）。
 */
const ACTION_ID_SITES: Record<string, string> = {
  'workbench/generationCanvas/nodes/director/model/defaultCharacter.ts': '加人 / 群众的写口：resolveActionAlias 解析，认不出就抛',
  'workbench/generationCanvas/nodes/director/model/storeCharacterActions.ts': '套姿态（单人 / 整组）、改动作片段：入口解析成正名，认不出就拒',
  'workbench/generationCanvas/nodes/director/model/storeClipActions.ts': '加动作片段：入口解析成正名，认不出就不加',
  'workbench/generationCanvas/nodes/director/model/compiler/directorPlanCompiler.ts': '编译器：静止姿态取 STANDING_POSE_ID，动作片段取 resolveActionAlias 的结果，解析不了记 missing_asset',
  'workbench/generationCanvas/nodes/director/model/characterRigMigration.ts': '读档迁移：每个角色的动作 id 换成正名，认不出原样留着',
  'workbench/generationCanvas/nodes/director/model/directorProject.ts': '读档归一：先照抄原值，同一个 normalizeObject 末尾交 migrateCharacterToUal 换正名',
  'workbench/generationCanvas/nodes/director/migration/migrateScene3d.ts': 'V1 场景迁移：写 V1 预设对应的正名；群众写 rig mixamo + standing，出口经读档迁移换正名',
  'workbench/generationCanvas/nodes/director/model/directorShotSummaries.ts': '只读投影（镜头摘要），不写工程',
  'workbench/generationCanvas/nodes/director/panels/inspector/ActionClipInspector.tsx': '把动作库条目的正名交给 updateActionClip（写口再解析一次）',
  'workbench/generationCanvas/nodes/director/timeline/DirectorTimeline.tsx': '把动作库条目的正名交给 addActionClip（写口再解析一次）',
}

describe('动作 id 的写口名单', () => {
  const SRC = path.resolve(__dirname, '../../../../..')
  const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const productionSources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' || full === path.join(SRC, 'i18n') ? [] : productionSources(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|bench)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : []
  })
  const WRITE_SHAPE = /\b(posePreset|actionPose)\s*:|\.(posePreset|actionPose)\s*=(?!=)/

  it('生产代码里写动作 id 的文件都在名单里，名单里的都还在写', () => {
    const sites = productionSources(SRC)
      .filter((file) => WRITE_SHAPE.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
      .sort()
    expect(sites).toEqual(Object.keys(ACTION_ID_SITES).sort())
  })
})
