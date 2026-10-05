/**
 * 3c：按指令最小改动 + 手改覆盖层，走真实边界——画布 store、提议事务（applyProposalBatch）、补偿撤销（applyCompensationOps）、
 * 编辑器 store（createDirectorStore + 会话登记处）。手改的写法和真编辑器一样：关着时写节点 meta，开着时调 store 动作。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirectorWriteInput } from '../../../../../../electron/shared/agentCapabilities/directorWrite'
import { applyProposalBatch } from '../../../agent/proposalTxn'
import { applyCompensationOps } from '../../../agent/proposalUndo'
import { generationCanvasTools } from '../../../agent/generationCanvasTools'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { registerEmbeddedEditorFlush } from '../../../agent/embeddedEditorFlush'
import { createDirectorNodeSync } from '../directorNodeSync'
import { registerDirectorSession } from '../directorSessionRegistry'
import { DIRECTOR_PLAN_META_KEY, DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { normalizeDirectorProject } from '../model/directorProject'
import { summarizeDirectorShots } from '../model/directorShotSummaries'
import { createDirectorStore } from '../model/directorStore'
import type { DirectorCamera, DirectorProject } from '../model/directorTypes'
import type { DirectorWriteDomainResult } from './applyDirectorWrite'

const compileCalls = vi.hoisted(() => ({ count: 0 }))
vi.mock('../model/compiler/directorPlanCompiler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/compiler/directorPlanCompiler')>()
  return { ...actual, compileDirectorPlan: (input: unknown) => { compileCalls.count += 1; return actual.compileDirectorPlan(input) } }
})

/** 题库外的两镜书房戏（与 applyDirectorWrite.test.ts 同一份形状）。 */
function plan(lastEnd = 6) {
  return {
    scene: { environment: 'day', template: 'room', tags: ['书房'] },
    actors: [
      { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
      { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
    ],
    shots: [
      { id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', subjects: ['reader', 'friend'], size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } },
      { id: 'close', window: [3, lastEnd], transitionIn: 'cut', subject: 'friend', size: '中景', angle: 'three_quarter', height: 'eye', move: { kind: 'push_in', speed: 'slow' } },
    ],
  }
}

async function run(input: DirectorWriteInput) {
  const outcome = await applyProposalBatch([{ toolCallId: `call-${Math.random()}`, toolName: input.operation, effectiveArgs: input as unknown as Record<string, unknown> }])
  if (outcome.status !== 'committed') throw new Error(`aborted: ${outcome.reason}`)
  return { result: outcome.results[0] as DirectorWriteDomainResult, compensation: outcome.compensation }
}

const nodeById = (id: string) => useGenerationCanvasStore.getState().nodes.find((node) => node.id === id)
const projectOf = (id: string) => normalizeDirectorProject(nodeById(id)?.meta?.[DIRECTOR_PROJECT_META_KEY])
const cameraOf = (project: DirectorProject, id: string) => project.scenes[0].cameras.find((camera) => camera.id === id)!
const actorOf = (project: DirectorProject, id: string) => project.scenes[0].objects.find((object) => object.id === id)!

/** 精修里把机位拉窄（每个路标的 fov 换成 18）——和拖检查器 fov 一样，改的是整条轨迹。 */
function narrowed(camera: DirectorCamera): Pick<DirectorCamera, 'fov' | 'motionTrajectory'> {
  return { fov: 18, motionTrajectory: (camera.motionTrajectory ?? []).map((point) => ({ ...point, fov: 18 })) }
}

/** 编辑器关着时的手改：和编辑器退出 / 自动保存一样，整份工程写回节点 meta。 */
function handEditClosed(nodeId: string, edit: (project: DirectorProject) => void) {
  const project = projectOf(nodeId)
  edit(project)
  useGenerationCanvasStore.getState().updateNode(nodeId, { meta: { ...nodeById(nodeId)?.meta, [DIRECTOR_PROJECT_META_KEY]: project } })
}

async function created(lastEnd = 6) {
  const { result } = await run({ operation: 'create_director_plan', plan: plan(lastEnd) } as DirectorWriteInput)
  if (!result.applied) throw new Error('create failed')
  return result
}

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

describe('3c 按指令最小改动 + 手改覆盖层', () => {
  beforeEach(() => { resetCanvas(); compileCalls.count = 0 })
  afterEach(resetCanvas)

  it('补丁后规范化计划不变 → unchanged，不重编译、不写画布', async () => {
    const director = await created()
    handEditClosed(director.directorNodeId, (project) => Object.assign(cameraOf(project, 'shot:wide/camera'), narrowed(cameraOf(project, 'shot:wide/camera'))))
    const before = JSON.stringify(nodeById(director.directorNodeId)?.meta)
    compileCalls.count = 0
    const { result, compensation } = await run({ operation: 'patch_director_plan', directorNodeId: director.directorNodeId, baseRevision: director.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '中景' }] })
    expect(result).toMatchObject({ applied: true, unchanged: true, reorderedOverrides: [], changedEntities: [] })
    expect(compileCalls.count).toBe(0)
    expect(JSON.stringify(nodeById(director.directorNodeId)?.meta)).toBe(before)
    expect(compensation).toEqual([])
  })

  it('直接改到的属性丢弃手改并列出，别处手改原样保留；撤销把丢掉的手改恢复', async () => {
    const director = await created()
    handEditClosed(director.directorNodeId, (project) => {
      Object.assign(cameraOf(project, 'shot:wide/camera'), narrowed(cameraOf(project, 'shot:wide/camera')))
      Object.assign(cameraOf(project, 'shot:close/camera'), narrowed(cameraOf(project, 'shot:close/camera')))
      actorOf(project, 'actor:reader').name = '老读者'
    })
    const handEdited = JSON.stringify(nodeById(director.directorNodeId)?.meta)
    const wideBefore = cameraOf(projectOf(director.directorNodeId), 'shot:wide/camera')

    const { result, compensation } = await run({ operation: 'patch_director_plan', directorNodeId: director.directorNodeId, baseRevision: director.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
    expect(result.applied && result.unchanged).toBe(false)
    if (!result.applied) return
    expect(result.reorderedOverrides).toEqual(expect.arrayContaining(['shot:close/camera.motionTrajectory', 'shot:close/camera.fov']))
    expect(result.reorderedOverrides.some((item) => item.startsWith('shot:wide/') || item.startsWith('actor:'))).toBe(false)
    const after = projectOf(director.directorNodeId)
    expect(cameraOf(after, 'shot:wide/camera').motionTrajectory).toEqual(wideBefore.motionTrajectory)
    expect(actorOf(after, 'actor:reader').name).toBe('老读者')
    expect(cameraOf(after, 'shot:close/camera').motionTrajectory?.every((point) => point.fov === 18)).toBe(false)

    applyCompensationOps(compensation)
    expect(JSON.stringify(nodeById(director.directorNodeId)?.meta)).toBe(handEdited)
  })

  it('连带变化的实体照常重放手改，并列进 changedEntities', async () => {
    const director = await created()
    handEditClosed(director.directorNodeId, (project) => Object.assign(cameraOf(project, 'shot:close/camera'), narrowed(cameraOf(project, 'shot:close/camera'))))
    const closeHand = cameraOf(projectOf(director.directorNodeId), 'shot:close/camera').motionTrajectory
    // 只改朋友的站位：close 机位拍的是朋友，会被连带重算，但补丁没有直接点名它
    const { result } = await run({ operation: 'patch_director_plan', directorNodeId: director.directorNodeId, baseRevision: director.revision, edits: [{ op: 'replace', path: '/actors/friend/placement', value: { relation: 'left_of', ref: 'reader' } }] })
    if (!result.applied) throw new Error(JSON.stringify(result))
    expect(result.touched).toEqual(['actor:friend'])
    expect(result.changedEntities).toContain('shot:close/camera')
    expect(result.reorderedOverrides).toEqual([])
    expect(cameraOf(projectOf(director.directorNodeId), 'shot:close/camera').motionTrajectory).toEqual(closeHand)
  })

  it('测量对「编译 + 覆盖」后的工程测：手改过的镜头回读手改后的实测', async () => {
    const director = await created()
    handEditClosed(director.directorNodeId, (project) => Object.assign(cameraOf(project, 'shot:wide/camera'), narrowed(cameraOf(project, 'shot:wide/camera'))))
    const handMeasured = summarizeDirectorShots(projectOf(director.directorNodeId)).find((cut) => cut.cameraId === 'shot:wide/camera')
    const compiledWide = director.cuts.find((cut) => cut.shot === 'wide')
    expect(handMeasured?.shotSize).not.toBe(compiledWide?.shotSize)
    const { result } = await run({ operation: 'patch_director_plan', directorNodeId: director.directorNodeId, baseRevision: director.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
    if (!result.applied) throw new Error('patch failed')
    expect(result.cuts.find((cut) => cut.shot === 'wide')?.shotSize).toBe(handMeasured?.shotSize)
  })

  it('编辑器开着：从 store 读还没落盘的手改，写回 store；撤销后编辑器当场换回撤销前（含被丢的手改）', async () => {
    const director = await created()
    const raw = nodeById(director.directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY]
    const store = createDirectorStore({ rawProject: raw, defaultSceneName: 'S' })
    // 和 DirectorEditor 同一套接线：同步账 + 外部写口回写 + 事务前落盘
    const sync = createDirectorNodeSync({
      store, defaultSceneName: 'S', initialRaw: raw,
      write: (project) => useGenerationCanvasStore.getState().updateNode(director.directorNodeId, { meta: { ...nodeById(director.directorNodeId)?.meta, [DIRECTOR_PROJECT_META_KEY]: project } }),
    })
    const unregister = registerDirectorSession(director.directorNodeId, { store, defaultSceneName: 'S', onExternalProjectChange: sync.persist })
    const unflush = registerEmbeddedEditorFlush(sync.saveNow)
    const adopt = () => sync.adoptNodeProject(nodeById(director.directorNodeId)?.meta?.[DIRECTOR_PROJECT_META_KEY])
    try {
      const wide = store.getState().findCamera('shot:wide/camera')!
      store.getState().updateCamera(wide.id, narrowed(wide))
      const close = store.getState().findCamera('shot:close/camera')!
      store.getState().updateCamera(close.id, narrowed(close))
      expect(sync.isDirty()).toBe(true) // 2 秒自动保存还没到
      const { result, compensation } = await run({ operation: 'patch_director_plan', directorNodeId: director.directorNodeId, baseRevision: director.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
      if (!result.applied) throw new Error('patch failed')
      expect(result.reorderedOverrides).toContain('shot:close/camera.motionTrajectory')
      expect(adopt()).toBe(false) // 节点上的是编辑器自己刚写出去的那份
      expect(store.getState().findCamera('shot:wide/camera')?.motionTrajectory?.every((point) => point.fov === 18)).toBe(true)
      expect(store.getState().findCamera('shot:close/camera')?.motionTrajectory?.every((point) => point.fov === 18)).toBe(false)

      applyCompensationOps(compensation)
      expect(adopt()).toBe(true)
      expect(store.getState().findCamera('shot:close/camera')?.motionTrajectory?.every((point) => point.fov === 18)).toBe(true)
      expect(sync.isDirty()).toBe(false) // 重载的那份不再被自动保存写回一遍
    } finally {
      unflush()
      unregister()
    }
  })

  it('3b 建的旧节点没有编译基线指纹：按旧计划重编出基线，手改照样认得出', async () => {
    const director = await created()
    const meta = nodeById(director.directorNodeId)!.meta!
    const { compiledBase: _drop, ...legacyPlanMeta } = meta[DIRECTOR_PLAN_META_KEY] as Record<string, unknown>
    useGenerationCanvasStore.getState().updateNode(director.directorNodeId, { meta: { ...meta, [DIRECTOR_PLAN_META_KEY]: legacyPlanMeta } })
    handEditClosed(director.directorNodeId, (project) => Object.assign(cameraOf(project, 'shot:wide/camera'), narrowed(cameraOf(project, 'shot:wide/camera'))))
    const { result } = await run({ operation: 'patch_director_plan', directorNodeId: director.directorNodeId, baseRevision: director.revision, edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] })
    if (!result.applied) throw new Error('patch failed')
    expect(cameraOf(projectOf(director.directorNodeId), 'shot:wide/camera').motionTrajectory?.every((point) => point.fov === 18)).toBe(true)
    expect((nodeById(director.directorNodeId)?.meta?.[DIRECTOR_PLAN_META_KEY] as { compiledBase?: unknown }).compiledBase).toBeTruthy()
  })
})

describe('遗留 ②：预演时长以镜头时长为准', () => {
  beforeEach(resetCanvas)
  afterEach(resetCanvas)

  function videoShot(seconds?: number): string {
    const [node] = generationCanvasTools.create_nodes([{ kind: 'video', title: '镜头 1', prompt: '两个人在书房里说话', position: { x: 0, y: 0 } }])
    if (seconds !== undefined) useGenerationCanvasStore.getState().updateNode(node.id, { meta: { ...nodeById(node.id)?.meta, duration: seconds } })
    return node.id
  }

  it('镜头 6 秒、计划到 8 秒结束 → 拒绝并说出两个数，画布不多一个节点', async () => {
    const shot = videoShot(6)
    const count = useGenerationCanvasStore.getState().nodes.length
    const { result } = await run({ operation: 'create_director_plan', shotNodeId: shot, plan: plan(8) } as DirectorWriteInput)
    expect(result).toMatchObject({ applied: false, rejected: 'compile_failed' })
    if (result.applied) return
    expect(result.messages.join(' ')).toMatch(/6(\.0)?s[\s\S]*8(\.0)?s/)
    expect(useGenerationCanvasStore.getState().nodes).toHaveLength(count)
  })

  it('时长一致照常建；补丁把计划拉到 8 秒 → 拒绝；节点没声明时长不拦', async () => {
    const shot = videoShot(6)
    const { result } = await run({ operation: 'create_director_plan', shotNodeId: shot, plan: plan(6) } as DirectorWriteInput)
    if (!result.applied) throw new Error('create failed')
    const { result: patched } = await run({ operation: 'patch_director_plan', directorNodeId: result.directorNodeId, baseRevision: result.revision, edits: [{ op: 'replace', path: '/shots/close/window', value: [3, 8] }] })
    expect(patched).toMatchObject({ applied: false, rejected: 'compile_failed' })
    const free = videoShot()
    const { result: unconstrained } = await run({ operation: 'create_director_plan', shotNodeId: free, plan: plan(8) } as DirectorWriteInput)
    expect(unconstrained.applied).toBe(true)
  })
})
