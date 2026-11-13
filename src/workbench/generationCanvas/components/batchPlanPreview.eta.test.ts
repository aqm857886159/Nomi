// 批量付费确认卡的「预计耗时」：和单张卡一样，等异步取数回来才出卡，卡上数字带历史耗时；取数失败给冷启动估计。
// 走真实 confirmAndRunPlan + 真实 spendConfirm，只替换边界（桥、出价 IPC、付费卡的弹出、真正派发）。
// 设计卡 docs/plan/2026-11-12-gen-landing-stall-cut1.md ★9 第 5 条（批量卡那一半）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndRunPlan } from './batchPlanPreview'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

const etaBridge = vi.hoisted(() => ({ generationEtaStats: vi.fn() }))

vi.mock('../../../desktop/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../desktop/bridge')>()),
  getDesktopBridge: () => ({ events: etaBridge }),
}))
vi.mock('../../api/taskApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taskApi')>()),
  canvasOpenRuns: vi.fn(async () => []),
  consentCanvasShots: vi.fn(async (input: { shots: Array<{ runRecordId: string }> }) => input.shots.map((shot) => `canvas-${shot.runRecordId}`)),
  withdrawCanvasShots: vi.fn(),
}))
vi.mock('../runner/generationRunWaves', () => ({
  runGenerationNodesByPlan: vi.fn(async () => ({ totalCount: 0, skipped: [], successes: [], failures: [] })),
}))

const HISTORY = [{ key: 'relay|eta-image|image', vendorKey: 'relay', modelKey: 'eta-image', kind: 'image', sampleCount: 6, p50Seconds: 300, p90Seconds: 600 }]

let harness: ProjectSessionTestHarness
let projectIndex = 0
let confirmMessages: string[]

beforeEach(async () => {
  harness = createProjectSessionTestHarness()
  // 每条用自己的项目号：缓存按项目记 10 秒，换项目就是一次真取数。
  projectIndex += 1
  await harness.open(`batch-eta-project-${projectIndex}`)
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  etaBridge.generationEtaStats.mockReset()
  confirmMessages = []
  useSpendConfirmStore.setState({
    requestConfirm: async (request) => {
      confirmMessages.push(request.message)
      return false
    },
  } as Partial<ReturnType<typeof useSpendConfirmStore.getState>>)
})

afterEach(() => harness.dispose())

function twoImagePlan() {
  const add = () => useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '灯塔', meta: { modelVendor: 'relay', modelKey: 'eta-image' } })
  const ids = [add().id, add().id]
  return { waves: [ids], blocked: [], edgesUsed: [] }
}

describe('batch spend card ETA over the async channel', () => {
  it('the card opens only after the reply arrives, with the historical ETA on it', async () => {
    let answer!: (value: unknown) => void
    etaBridge.generationEtaStats.mockImplementation(() => new Promise((resolve) => { answer = resolve }))

    const run = confirmAndRunPlan(twoImagePlan(), { initiator: 'user' })
    await vi.waitFor(() => expect(etaBridge.generationEtaStats).toHaveBeenCalledTimes(1))
    // 回话还没到：卡不许先出来。
    expect(confirmMessages).toEqual([])
    answer({ ok: true, stats: HISTORY })
    await run

    expect(confirmMessages).toHaveLength(1)
    expect(confirmMessages[0]).toContain('预计约 5–10 分钟')
  })

  it('a rejected channel shows the cold-start estimate', async () => {
    etaBridge.generationEtaStats.mockRejectedValue(new Error('ipc closed'))
    await confirmAndRunPlan(twoImagePlan(), { initiator: 'user' })
    expect(confirmMessages).toHaveLength(1)
    expect(confirmMessages[0]).toContain('预计约 1–3 分钟')
  })
})
