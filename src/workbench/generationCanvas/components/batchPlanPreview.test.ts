import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_RUN_TOAST_ID, describeBlockedNotice, runPlanWithToasts } from './batchPlanPreview'
import type { DependencyWavePlan } from '../runner/dependencyWaves'
import { runGenerationNodesByPlan } from '../runner/generationRunController'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  toastPush: vi.fn(),
  confirmAndMintGrant: vi.fn(async () => 'retry-grant'),
  nodes: [{ id: 'a', kind: 'image', title: 'A', position: { x: 0, y: 0 } }],
  edges: [],
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
  runGenerationNodesByPlan: vi.fn(async () => ({ totalCount: 1, successes: [], failures: [] })),
  spendCostKindForNodes: vi.fn(() => 'image'),
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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(runGenerationNodesByPlan).mockResolvedValue({ totalCount: 1, successes: [], failures: [] })
    mocks.confirmAndMintGrant.mockResolvedValue('retry-grant')
  })

  it('passes the chosen concurrency to the dependency-wave runner', async () => {
    const dependencyPlan = plan({ waves: [['a']] })

    await runPlanWithToasts(dependencyPlan, { grantId: 'grant-1', concurrency: 4, assetUploadConsent: 'allow' })

    expect(runGenerationNodesByPlan).toHaveBeenCalledWith(dependencyPlan, {
      grantId: 'grant-1',
      concurrency: 4,
      // 托管决定必须原样透传到波次运行器——中途丢了就等于让 runner 自己去问（F16b 第二张卡）。
      assetUploadConsent: 'allow',
    })
  })

  it('updates start and terminal feedback through one stable notification id', async () => {
    vi.mocked(runGenerationNodesByPlan).mockResolvedValueOnce({
      totalCount: 1,
      successes: [{ nodeId: 'a', result: { id: 'result-a', type: 'image', url: 'data:image/png;base64,a', createdAt: 1 } }],
      failures: [],
    })

    await runPlanWithToasts(plan({ waves: [['a']] }), { assetUploadConsent: 'not-needed' })

    expect(mocks.toastPush).toHaveBeenCalledTimes(2)
    expect(mocks.toastPush.mock.calls[0][0]).toMatchObject({ id: BATCH_RUN_TOAST_ID, ttl: false })
    expect(mocks.toastPush.mock.calls[1][0]).toMatchObject({ id: BATCH_RUN_TOAST_ID, type: 'success' })
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

    await runPlanWithToasts(plan({ waves: [['a']] }), { concurrency: 4, assetUploadConsent: 'not-needed' })
    const failedToast = mocks.toastPush.mock.calls[1][0]
    expect(failedToast).toMatchObject({
      id: BATCH_RUN_TOAST_ID,
      type: 'error',
      actionLabel: expect.any(String),
      onAction: expect.any(Function),
    })

    failedToast.onAction()
    await vi.waitFor(() => expect(runGenerationNodesByPlan).toHaveBeenCalledTimes(2))

    expect(runGenerationNodesByPlan).toHaveBeenLastCalledWith(expect.any(Object), {
      grantId: 'retry-grant',
      concurrency: 4,
      // 重试走 confirmAndRunPlan → 重新解析托管（不是把上一轮的决定翻出来复用）。
      // 本用例的节点没有本地素材，所以正确答案是 not-needed：压根不碰公共托管。
      assetUploadConsent: 'not-needed',
    })
    expect(mocks.toastPush.mock.calls.slice(2).every(([input]) => input.id === BATCH_RUN_TOAST_ID)).toBe(true)
  })
})
