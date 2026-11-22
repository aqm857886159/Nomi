import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ReconcileDeviation } from './reconcile'
import { useShotVerifyStore, buildContentFixMessage, verifyShotsAndReport } from './shotVerifyStore'
import { DEFAULT_LOOP_MAX_ROUNDS } from './storyboardLoopBudget'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

const verifyMocks = vi.hoisted(() => ({
  gather: vi.fn(() => [{ shotNodeId: 'shot-1' }]),
  verify: vi.fn(),
  makeDeps: vi.fn(() => ({ marker: 'deps' })),
}))

vi.mock('./gatherShotVerifyInputs', () => ({ gatherShotVerifyInputs: verifyMocks.gather }))
vi.mock('./shotVerifyRunner', () => ({ verifyGeneratedShots: verifyMocks.verify }))
vi.mock('./shotVerifyJudge', () => ({ makeShotVerifyDeps: verifyMocks.makeDeps }))
vi.mock('../store/generationCanvasStore', () => ({
  useGenerationCanvasStore: { getState: () => ({ nodes: [], edges: [] }) },
}))

const content = (where: string): ReconcileDeviation => ({
  where,
  field: '身份',
  expected: '与设定一致',
  actual: '第 1 档',
  reason: `${where} 脸不对`,
  kind: 'content',
  shotNodeId: where,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let projectSession: ProjectSessionTestHarness
/** 审片由调用方在动作起点签发项目；测试走真实签发点。 */
const issued = (): ProjectExecutionContext => withProjectAction((project) => project)!
afterEach(() => projectSession.dispose())

describe('shotVerifyStore 状态机', () => {
  beforeEach(async () => {
    projectSession = createProjectSessionTestHarness()
    await projectSession.open('project-A')
    verifyMocks.gather.mockClear()
    verifyMocks.verify.mockReset()
    verifyMocks.makeDeps.mockClear()
    useShotVerifyStore.getState().clear()
  })

  it('setDeviations 有偏差 → status ready、不动预算', () => {
    useShotVerifyStore.getState().setDeviations([content('镜5')])
    const s = useShotVerifyStore.getState()
    expect(s.status).toBe('ready')
    expect(s.deviations).toHaveLength(1)
    expect(s.budget.roundsUsed).toBe(0)
    expect(s.exhausted).toBe(false)
  })

  it('generation resident consumes the canonical deviation payload before recovery', () => {
    const deviation = content('镜头-真实校验')
    useShotVerifyStore.getState().setDeviations([deviation])
    expect(useShotVerifyStore.getState().deviations).toEqual([deviation])
    useShotVerifyStore.getState().markFixing()
    expect(useShotVerifyStore.getState().deviations).toEqual([])
    expect(useShotVerifyStore.getState().status).toBe('verifying')
  })

  it('收敛(偏差清零)→ 预算回满 + exhausted 复位', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    st.consumeRound()
    expect(useShotVerifyStore.getState().budget.roundsUsed).toBe(1)
    st.setDeviations([]) // 收敛
    const s = useShotVerifyStore.getState()
    expect(s.deviations).toEqual([])
    expect(s.budget.roundsUsed).toBe(0) // 回满
    expect(s.exhausted).toBe(false)
  })

  it('预算只减不回弹:点修→暂藏(markFixing)→再校验仍有偏差,预算不回弹', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    expect(st.consumeRound()).toBe(true) // 第1轮
    st.markFixing() // 暂藏卡,不动预算
    expect(useShotVerifyStore.getState().budget.roundsUsed).toBe(1)
    expect(useShotVerifyStore.getState().deviations).toEqual([])
    // 重生后再校验仍有偏差
    useShotVerifyStore.getState().setDeviations([content('镜5')])
    expect(useShotVerifyStore.getState().budget.roundsUsed).toBe(1) // 没回弹
  })

  it('预算耗尽 → consumeRound 返回 false + exhausted=true(半自动封顶,绝不无限回灌)', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    for (let i = 0; i < DEFAULT_LOOP_MAX_ROUNDS; i += 1) {
      expect(st.consumeRound()).toBe(true)
      st.markFixing()
      useShotVerifyStore.getState().setDeviations([content('镜5')])
    }
    // 预算用尽:再点修被拒
    expect(useShotVerifyStore.getState().consumeRound()).toBe(false)
    expect(useShotVerifyStore.getState().exhausted).toBe(true)
  })

  it('仍有偏差且预算耗尽时,setDeviations 把 exhausted 置真', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    st.consumeRound()
    st.consumeRound() // 默认 2 轮用尽
    useShotVerifyStore.getState().setDeviations([content('镜5')])
    expect(useShotVerifyStore.getState().exhausted).toBe(true)
  })

  it('clear 全复位', () => {
    const st = useShotVerifyStore.getState()
    st.setDeviations([content('镜5')])
    st.consumeRound()
    st.clear()
    const s = useShotVerifyStore.getState()
    expect(s.status).toBe('idle')
    expect(s.deviations).toEqual([])
    expect(s.budget.roundsUsed).toBe(0)
  })

  it('同项目 persistence 重绑不清审片结果和闭环预算', () => {
    const store = useShotVerifyStore.getState()
    store.activateProject('project-A')
    store.setDeviations([content('镜5')])
    store.consumeRound()

    useShotVerifyStore.getState().activateProject(' project-A ')

    const current = useShotVerifyStore.getState()
    expect(current.deviations).toEqual([content('镜5')])
    expect(current.budget.roundsUsed).toBe(1)
  })

  it('同项目开始新校验时立即撤下旧结果但保留闭环预算', () => {
    const store = useShotVerifyStore.getState()
    store.activateProject('project-A')
    store.setDeviations([content('old-result')])
    store.consumeRound()

    const request = useShotVerifyStore.getState().beginVerify('project-A')

    const verifying = useShotVerifyStore.getState()
    expect(verifying.status).toBe('verifying')
    expect(verifying.deviations).toEqual([])
    expect(verifying.budget.roundsUsed).toBe(1)
    expect(verifying.isVerifyCurrent(request, 'project-A')).toBe(true)
    expect(verifying.completeVerify(request, 'project-A', [content('new-result')])).toBe(true)
    expect(useShotVerifyStore.getState().deviations).toEqual([content('new-result')])
  })

  it('同项目并发校验 latest-wins：旧请求晚到不能覆盖新结果', async () => {
    const older = deferred<{ deviations: ReconcileDeviation[]; shotOutcomes: unknown[]; unverified: unknown[] }>()
    const newer = deferred<{ deviations: ReconcileDeviation[]; shotOutcomes: unknown[]; unverified: unknown[] }>()
    verifyMocks.verify.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)

    const olderRun = verifyShotsAndReport(['shot-old'], issued())
    await vi.waitFor(() => expect(verifyMocks.verify).toHaveBeenCalledTimes(1))
    const newerRun = verifyShotsAndReport(['shot-new'], issued())
    await vi.waitFor(() => expect(verifyMocks.verify).toHaveBeenCalledTimes(2))

    newer.resolve({ deviations: [content('newer')], shotOutcomes: [{ shotNodeId: 'shot-new', shotTitle: 'shot-new', status: 'flagged', deviations: [content('newer')] }], unverified: [] })
    await expect(newerRun).resolves.toMatchObject({ deviations: [content('newer')], unverified: [] })
    older.resolve({ deviations: [content('older')], shotOutcomes: [{ shotNodeId: 'shot-old', shotTitle: 'shot-old', status: 'flagged', deviations: [content('older')] }], unverified: [] })
    // store latest-wins；同时每个调用仍拿到自己那次 judge 的结果，production caller 不再读串全局值。
    await expect(olderRun).resolves.toMatchObject({ deviations: [content('older')], unverified: [] })

    expect(useShotVerifyStore.getState().deviations).toEqual([content('newer')])
  })

  it('切项目会作废旧项目校验，旧结果晚到不能写进新项目', async () => {
    const oldProjectRun = deferred<{ deviations: ReconcileDeviation[]; shotOutcomes: unknown[]; unverified: unknown[] }>()
    const newProjectRun = deferred<{ deviations: ReconcileDeviation[]; shotOutcomes: unknown[]; unverified: unknown[] }>()
    verifyMocks.verify.mockImplementationOnce(() => oldProjectRun.promise).mockImplementationOnce(() => newProjectRun.promise)

    const oldRun = verifyShotsAndReport(['shot-A'], issued())
    await vi.waitFor(() => expect(verifyMocks.verify).toHaveBeenCalledTimes(1))
    await projectSession.open('project-B')
    useShotVerifyStore.getState().activateProject('project-B')
    const newRun = verifyShotsAndReport(['shot-B'], issued())
    await vi.waitFor(() => expect(verifyMocks.verify).toHaveBeenCalledTimes(2))

    newProjectRun.resolve({ deviations: [content('project-B-result')], shotOutcomes: [{ shotNodeId: 'shot-B', shotTitle: 'shot-B', status: 'flagged', deviations: [content('project-B-result')] }], unverified: [] })
    await expect(newRun).resolves.toMatchObject({ deviations: [content('project-B-result')] })
    oldProjectRun.resolve({ deviations: [content('project-A-result')], shotOutcomes: [{ shotNodeId: 'shot-A', shotTitle: 'shot-A', status: 'flagged', deviations: [content('project-A-result')] }], unverified: [] })
    await expect(oldRun).resolves.toMatchObject({ deviations: [content('project-A-result')] })

    const state = useShotVerifyStore.getState()
    expect(state.projectId).toBe('project-B')
    expect(state.deviations).toEqual([content('project-B-result')])
    expect(verifyMocks.makeDeps).toHaveBeenNthCalledWith(1, 'project-A')
    expect(verifyMocks.makeDeps).toHaveBeenNthCalledWith(2, 'project-B')
  })

  it('旧请求失败不能把更新请求已经写入的偏差清空，且返回 unverified 而不冒充通过', async () => {
    const older = deferred<{ deviations: ReconcileDeviation[]; shotOutcomes: unknown[]; unverified: unknown[] }>()
    const newer = deferred<{ deviations: ReconcileDeviation[]; shotOutcomes: unknown[]; unverified: unknown[] }>()
    verifyMocks.verify.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)

    const olderRun = verifyShotsAndReport(['shot-old'], issued())
    await vi.waitFor(() => expect(verifyMocks.verify).toHaveBeenCalledTimes(1))
    const newerRun = verifyShotsAndReport(['shot-new'], issued())
    await vi.waitFor(() => expect(verifyMocks.verify).toHaveBeenCalledTimes(2))
    newer.resolve({ deviations: [content('newer')], shotOutcomes: [{ shotNodeId: 'shot-new', shotTitle: 'shot-new', status: 'flagged', deviations: [content('newer')] }], unverified: [] })
    await newerRun
    older.reject(new Error('late old failure'))
    await expect(olderRun).resolves.toMatchObject({
      deviations: [],
      unverified: [{ shotNodeId: 'shot-old', reason: 'judge_failed' }],
    })

    expect(useShotVerifyStore.getState().deviations).toEqual([content('newer')])
  })

  it('审片返回 unverified 时写入 store.unverified（不再静默当成全部通过）', async () => {
    verifyMocks.verify.mockResolvedValueOnce({
      deviations: [],
      unverified: [{ shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'vision_unavailable' }],
      shotOutcomes: [{ shotNodeId: 'shot-1', shotTitle: '镜头 1', status: 'unverified', reason: 'vision_unavailable' }],
    })
    const report = await verifyShotsAndReport(['shot-1'], issued())
    expect(report.unverified).toEqual([{ shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'vision_unavailable' }])
    expect((useShotVerifyStore.getState() as unknown as { unverified?: unknown[] }).unverified).toEqual([
      { shotNodeId: 'shot-1', shotTitle: '镜头 1', reason: 'vision_unavailable' },
    ])
  })
})

describe('buildContentFixMessage', () => {
  it('列出每条内容偏差 + 让 AI 只改这几镜走确认闸', () => {
    const msg = buildContentFixMessage([content('镜头5'), content('镜头7'), { where: 'x', field: '边', expected: '', actual: '', kind: 'structure' }])
    expect(msg).toContain('镜头5')
    expect(msg).toContain('镜头7')
    expect(msg).toContain('新付费生成提案')
    expect(msg).not.toContain('run_generation_batch')
    expect(msg).toContain('不要动其它已经正常的镜头')
    expect(msg).not.toContain('· x（边）') // 结构偏差不进内容修复消息
  })
})
