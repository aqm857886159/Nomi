import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_RUN_TOAST_ID, describeBlockedNotice, runPlanWithToasts } from './batchPlanPreview'
import type { DependencyWavePlan } from '../runner/dependencyWaves'
import { runGenerationNodesByPlan } from '../runner/generationRunWaves'
import { withProjectAction, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import { createProjectSessionTestHarness, testProjectBinding, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { verifyShotsAndReport } from '../agent/shotVerifyStore'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  toastPush: vi.fn(),
  confirmAndMintGrant: vi.fn(async () => 'retry-grant'),
  nodes: [{ id: 'a', kind: 'image', title: 'A', position: { x: 0, y: 0 } }] as GenerationCanvasNode[],
  edges: [] as GenerationCanvasEdge[],
}))

vi.mock('../../../ui/toast', () => ({
  toast: mocks.toast,
  useToastStore: { getState: () => ({ push: mocks.toastPush }) },
}))

vi.mock('../spend/spendConfirm', () => ({
  confirmAndMintGrant: mocks.confirmAndMintGrant,
  describeGenerationCost: vi.fn(() => '1 image'),
  generationCostContextForNodes: vi.fn(() => ({ vendorKey: 'v', modelKey: 'm', etaStats: [] })),
}))

vi.mock('../store/generationCanvasStore', () => ({
  useGenerationCanvasStore: { getState: () => ({ nodes: mocks.nodes, edges: mocks.edges }) },
}))

vi.mock('../agent/shotVerifyStore', () => ({ verifyShotsAndReport: vi.fn() }))

vi.mock('../runner/generationRunController', () => ({
  spendCostKindForNodes: vi.fn(() => 'image'),
}))

vi.mock('../runner/generationRunWaves', () => ({
  runGenerationNodesByPlan: vi.fn(async () => ({ totalCount: 1, successes: [], failures: [] })),
}))

function plan(over: Partial<DependencyWavePlan>): DependencyWavePlan {
  return { waves: [], blocked: [], edgesUsed: [], ...over }
}

describe('describeBlockedNotice — 批量「缺啥提示啥」', () => {
  it('无 blocked → null（不提示）', () => {
    expect(describeBlockedNotice(plan({ waves: [['a', 'b']] }))).toBeNull()
  })

  it('上游参考未生成被拦 → 提示「在等上游参考」', () => {
    const p = plan({
      waves: [['s1']],
      blocked: [{ nodeId: 's2', reason: 'missing-upstream', detail: '上游「创作工位」还没有生成结果' }],
    })
    const msg = describeBlockedNotice(p)
    expect(msg).toContain('1 个在等上游参考')
    expect(msg).toContain('先把它们生成')
  })

  it('循环引用单独计数', () => {
    const p = plan({
      blocked: [
        { nodeId: 'a', reason: 'cycle', detail: '与其他节点构成循环引用' },
        { nodeId: 'b', reason: 'missing-upstream', detail: 'x' },
      ],
    })
    const msg = describeBlockedNotice(p)!
    expect(msg).toContain('1 个在等上游参考')
    expect(msg).toContain('1 个存在循环引用')
  })
})

describe('runPlanWithToasts concurrency', () => {
  let projectSession: ProjectSessionTestHarness
  // 批量运行属于发起它的项目：测试里用真实签发点拿到 project-a 的上下文。
  const openProject = (): ProjectExecutionContext => withProjectAction((project) => project)!
  afterEach(() => { vi.unstubAllGlobals(); projectSession.dispose() })
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.nodes = [{ id: 'a', kind: 'image', title: 'A', position: { x: 0, y: 0 } }]
    mocks.edges = []
    projectSession = createProjectSessionTestHarness()
    await projectSession.open('project-a')
    vi.mocked(runGenerationNodesByPlan).mockResolvedValue({ totalCount: 1, successes: [], failures: [] })
    mocks.confirmAndMintGrant.mockResolvedValue('retry-grant')
  })

  // 2026-09-26 用户拍板（T-QA-36）：点「生成全部」只花生成的钱，跑完不再自动调文本模型审片。
  // 以前这条钉的是「批量后按镜头身份审片」；现在钉反面：有成功的镜头也不审。
  it('does not run the paid shot review after a user batch, even when shots succeed', async () => {
    mocks.nodes = [
      { id: 'video', kind: 'video', title: 'Video', position: { x: 0, y: 0 }, shotIndex: 5 },
      { id: 'frame', kind: 'image', title: 'Frame', position: { x: 0, y: 0 }, meta: { storyboardKeyframe: true } },
      { id: 'anchor', kind: 'image', title: 'Anchor', position: { x: 0, y: 0 }, shotIndex: 4, meta: { referenceSheet: true } },
    ]
    mocks.edges = [{ id: 'pair', source: 'frame', target: 'video', mode: 'first_frame' }]
    vi.mocked(runGenerationNodesByPlan).mockResolvedValueOnce({
      totalCount: 2,
      successes: ['frame', 'anchor'].map(nodeId => ({ nodeId, result: { id: `${nodeId}-r`, type: 'image', url: `nomi-local://${nodeId}.png`, createdAt: 1 } })),
      failures: [],
    })
    const project = openProject()
    await runPlanWithToasts(plan({ waves: [['frame', 'anchor']] }), { assetUploadConsent: 'not-needed', project })
    // 阳性对照：这一批确实跑了、有成功的镜头；在这个前提下审片一次都没被调。
    expect(runGenerationNodesByPlan).toHaveBeenCalledTimes(1)
    expect(verifyShotsAndReport).not.toHaveBeenCalled()
  })

  it('passes the chosen concurrency to the dependency-wave runner', async () => {
    const dependencyPlan = plan({ waves: [['a']] })

    await runPlanWithToasts(dependencyPlan, { grantId: 'grant-1', concurrency: 4, assetUploadConsent: 'allow', project: openProject() })

    expect(runGenerationNodesByPlan).toHaveBeenCalledWith(dependencyPlan, {
      target: testProjectBinding('project-a'),
      grantId: 'grant-1',
      concurrency: 4,
      // 托管决定必须原样透传到波次运行器——中途丢了就等于让 runner 自己去问（F16b 第二张卡）。
      assetUploadConsent: 'allow',
    })
  })

  it('keeps ordinary progress and success on nodes without toast echoes', async () => {
    vi.mocked(runGenerationNodesByPlan).mockResolvedValueOnce({
      totalCount: 1,
      successes: [{ nodeId: 'a', result: { id: 'result-a', type: 'image', url: 'data:image/png;base64,a', createdAt: 1 } }],
      failures: [],
    })

    await runPlanWithToasts(plan({ waves: [['a']] }), { assetUploadConsent: 'not-needed', project: openProject() })

    expect(mocks.toastPush).not.toHaveBeenCalled()
  })

  it('never retries an old batch against the newly active project', async () => {
    vi.mocked(runGenerationNodesByPlan).mockResolvedValueOnce({
      totalCount: 1, successes: [], failures: [{ nodeId: 'a', error: new Error('failed') }],
    })
    await runPlanWithToasts(plan({ waves: [['a']] }), { assetUploadConsent: 'not-needed', project: openProject() })
    await projectSession.open('project-b')
    const dispatchEvent = vi.fn((_event: Event) => true) // No application navigation handler accepted this request.
    vi.stubGlobal('window', { dispatchEvent })
    await mocks.toastPush.mock.calls[0][0].onAction()
    expect(runGenerationNodesByPlan).toHaveBeenCalledTimes(1)
    expect(mocks.confirmAndMintGrant).not.toHaveBeenCalled()
    expect(dispatchEvent.mock.calls[0][0]).toHaveProperty('detail.projectId', 'project-a')
  })

  it('does not replace another project recovery action when node IDs match and no grant is supplied', async () => {
    vi.mocked(runGenerationNodesByPlan).mockResolvedValue({ totalCount: 1, successes: [], failures: [{ nodeId: 'a', error: new Error('offline') }] })
    await runPlanWithToasts(plan({ waves: [['a']] }), { assetUploadConsent: 'not-needed', project: openProject() })
    await projectSession.open('project-b')
    await runPlanWithToasts(plan({ waves: [['a']] }), { assetUploadConsent: 'not-needed', project: openProject() })
    const [first, second] = mocks.toastPush.mock.calls.map(([notice]) => notice)
    expect(first.id).not.toBe(second.id)
    expect(first.id).toContain('project-a')
    expect(second.id).toContain('project-b')
    const dispatchEvent = vi.fn((_event: Event) => true)
    vi.stubGlobal('window', { dispatchEvent })
    await first.onAction()
    expect(dispatchEvent.mock.calls[0][0]).toHaveProperty('detail.projectId', 'project-a')
    expect(mocks.confirmAndMintGrant).not.toHaveBeenCalled()
  })

  it('keeps the selected concurrency when the explicit retry action reruns failures', async () => {
    vi.mocked(runGenerationNodesByPlan)
      .mockResolvedValueOnce({
        totalCount: 1,
        successes: [],
        failures: [{ nodeId: 'a', error: new Error('mock failure') }],
      })
      .mockResolvedValueOnce({
        totalCount: 1,
        successes: [{ nodeId: 'a', result: { id: 'result-a', type: 'image', url: 'data:image/png;base64,a', createdAt: 1 } }],
        failures: [],
      })

    await runPlanWithToasts(plan({ waves: [['a']] }), { concurrency: 4, assetUploadConsent: 'not-needed', project: openProject() })
    const failedToast = mocks.toastPush.mock.calls[0][0]
    expect(failedToast).toMatchObject({
      id: `${BATCH_RUN_TOAST_ID}:project-a:a`,
      type: 'error',
      actionLabel: expect.any(String),
      onAction: expect.any(Function),
    })

    failedToast.onAction()
    await vi.waitFor(() => expect(runGenerationNodesByPlan).toHaveBeenCalledTimes(2))

    expect(runGenerationNodesByPlan).toHaveBeenLastCalledWith(expect.any(Object), {
      target: testProjectBinding('project-a'),
      grantId: 'retry-grant',
      assertAuthorCurrent: undefined,
      assertApprovedInputs: expect.any(Function),
      concurrency: 4,
      // 重试走 confirmAndRunPlan → 重新解析托管（不是把上一轮的决定翻出来复用）。
      // 本用例的节点没有本地素材，所以正确答案是 not-needed：压根不碰公共托管。
      assetUploadConsent: 'not-needed',
    })
    expect(mocks.toastPush).toHaveBeenCalledTimes(1)
  })
})
