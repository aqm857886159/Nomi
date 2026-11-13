// 付费确认卡上的「预计耗时」走异步通道取（设计卡 docs/plan/2026-11-12-gen-landing-stall-cut1.md ★9 第 5 条）：
// 以前是 sendSync，主进程一忙（生成落地），渲染层就跟着冻住。现在改成异步，但卡出现的那一刻数值必须已经在卡上，
// 不许先出卡、再跳数字；取数失败时卡上写的和以前同步版失败时一模一样（冷启动估计）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAndRunNode } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { describeGenerationCost, useSpendConfirmStore, withGenerationEtaStats } from '../spend/spendConfirm'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { resetModelHealthMemory } from './modelHealthMemory'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

const etaBridge = vi.hoisted(() => ({ generationEtaStats: vi.fn() }))

vi.mock('../../../desktop/bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../desktop/bridge')>()),
  getDesktopBridge: () => ({ events: etaBridge }),
}))
vi.mock('../../api/taskApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/taskApi')>()),
  mintSpendGrant: vi.fn(async () => `grant-${Math.random().toString(36).slice(2)}`),
  canvasOpenRuns: vi.fn(async () => []),
}))

const HISTORY = [{ key: 'relay|eta-image|image', vendorKey: 'relay', modelKey: 'eta-image', kind: 'image', sampleCount: 6, p50Seconds: 300, p90Seconds: 600 }]
/** 冷启动估计（没有历史时卡上写的）：图片 30–180 秒 → 1–3 分钟。 */
const COLD_START = '将生成 1 张画面 · 预计约 1–3 分钟'

let projectSession: ProjectSessionTestHarness
let projectIndex = 0
let confirmMessages: string[]

beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  // 每条用自己的项目号：缓存按项目记 10 秒，换项目就是一次真取数。
  projectIndex += 1
  await projectSession.open(`eta-async-project-${projectIndex}`)
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
  __resetCanvasUndoJournalForTests()
  setCanvasEventSinkForTests(() => {})
  resetModelHealthMemory()
  etaBridge.generationEtaStats.mockReset()
  confirmMessages = []
  useSpendConfirmStore.setState({
    requestConfirm: async (request) => {
      confirmMessages.push(request.message)
      return false
    },
  } as Partial<ReturnType<typeof useSpendConfirmStore.getState>>)
})

afterEach(() => {
  setCanvasEventSinkForTests(null)
  projectSession.dispose()
})

function imageNode() {
  return useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: '灯塔', meta: { modelVendor: 'relay', modelKey: 'eta-image' } })
}

describe('spend card ETA over the async channel', () => {
  it('the card opens with the historical ETA already on it, after the async reply arrives', async () => {
    let answer!: (value: unknown) => void
    etaBridge.generationEtaStats.mockImplementation(() => new Promise((resolve) => { answer = resolve }))
    const node = imageNode()

    const run = confirmAndRunNode(node.id, { initiator: 'agent' })
    await vi.waitFor(() => expect(etaBridge.generationEtaStats).toHaveBeenCalledTimes(1))
    // 回话还没到：卡不许先出来。
    expect(confirmMessages).toEqual([])
    answer({ ok: true, stats: HISTORY })
    await run

    expect(confirmMessages).toEqual(['将生成 1 张画面 · 预计约 5–10 分钟'])
  })

  it('a rejected channel shows exactly what the old synchronous failure showed (cold start)', async () => {
    etaBridge.generationEtaStats.mockRejectedValue(new Error('ipc closed'))
    await confirmAndRunNode(imageNode().id, { initiator: 'agent' })
    expect(confirmMessages).toEqual([COLD_START])
  })

  it('an ok:false reply without stats shows the cold-start estimate, as before', async () => {
    etaBridge.generationEtaStats.mockResolvedValue({ ok: false })
    await confirmAndRunNode(imageNode().id, { initiator: 'agent' })
    expect(confirmMessages).toEqual([COLD_START])
  })

  it('reads the same numbers the old synchronous path read for the same event log', async () => {
    etaBridge.generationEtaStats.mockResolvedValue({ ok: true, stats: HISTORY })
    const context = await withGenerationEtaStats({ vendorKey: 'relay', modelKey: 'eta-image', projectId: 'eta-parity' })
    expect(describeGenerationCost(3, 'image', { ...context, concurrency: 1 })).toBe('将生成 3 张画面 · 预计约 15–30 分钟')
    // 10 秒内同一项目复用，不再问主进程。
    await withGenerationEtaStats({ vendorKey: 'relay', modelKey: 'eta-image', projectId: 'eta-parity' })
    expect(etaBridge.generationEtaStats).toHaveBeenCalledTimes(1)
  })
})
