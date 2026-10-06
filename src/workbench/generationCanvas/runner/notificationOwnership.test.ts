import { notifications, notificationsStore } from '@mantine/notifications'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { QUEUE_BRAKE_THRESHOLD, useGenerationQueueStore } from './generationQueueStore'
import { useBatchPlanPreviewStore } from '../components/batchPlanPreview'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { setCanvasEventSinkForTests } from '../events/canvasEventEmitter'
import { __resetCanvasUndoJournalForTests } from '../events/canvasUndoJournal'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

const mocks = vi.hoisted(() => ({ reveal: vi.fn(async () => true), consent: vi.fn() }))
vi.mock('../../api/taskApi', () => ({ consentCanvasShots: mocks.consent, withdrawCanvasShots: vi.fn(), releaseCanvasShotRun: vi.fn(async () => undefined) }))
vi.mock('../../../ui/notificationPolicy', async (importOriginal) => ({ ...await importOriginal<typeof import('../../../ui/notificationPolicy')>(), revealNotificationTarget: mocks.reveal }))

const allNotices = () => [...notificationsStore.getState().notifications, ...notificationsStore.getState().queue]
function clickNoticeAction() {
  const element = allNotices()[0].message as ReactElement<{ onAction: () => void }>
  element.props.onAction()
}

let projectSession: ProjectSessionTestHarness
beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  await projectSession.open('origin-project')
})
afterEach(() => projectSession.dispose())

describe('background recovery owns the originating project and task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notifications.clean()
    useGenerationQueueStore.setState({ entries: [], batches: {} })
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], selectedNodeIds: [], groups: [] })
    __resetCanvasUndoJournalForTests()
    setCanvasEventSinkForTests(() => {})
    useSpendConfirmStore.setState({ requestConfirm: async () => true })
  })
  afterEach(() => setCanvasEventSinkForTests(null))

  it('brake uses one batch identity and its action targets the original project after a switch', async () => {
    const ids = Array.from({ length: QUEUE_BRAKE_THRESHOLD + 1 }, (_, index) => `node-${index}`)
    const batchId = useGenerationQueueStore.getState().enqueueBatch([ids], 'origin-project')
    await projectSession.open('other-project')
    for (const id of ids) useGenerationQueueStore.getState().markSettled(batchId, id, 'error')
    expect(allNotices()).toHaveLength(1)
    expect(allNotices()[0].id).toBe(`queue:origin-project:${batchId}`)
    expect(allNotices()[0]['data-notification-reason']).toBe('consecutive-failures')
    clickNoticeAction()
    expect(mocks.reveal).toHaveBeenCalledWith({ projectId: 'origin-project', taskCenter: true })
  })

  it.each(['resumeBatch', 'cancelBatchRemaining', 'finishBatch'] as const)('%s removes obsolete brake feedback even after switching projects', async (operation) => {
    const ids = Array.from({ length: QUEUE_BRAKE_THRESHOLD + 1 }, (_, index) => `node-${index}`)
    const batchId = useGenerationQueueStore.getState().enqueueBatch([ids], 'origin-project')
    for (const id of ids.slice(0, QUEUE_BRAKE_THRESHOLD)) useGenerationQueueStore.getState().markSettled(batchId, id, 'error')
    expect(allNotices()).toHaveLength(1)
    await projectSession.open('other-project')
    useGenerationQueueStore.getState()[operation](batchId)
    expect(allNotices()).toHaveLength(0)
    expect(useGenerationQueueStore.getState().batches[batchId].paused).toBe(false)
  })

  // 发动机收敛第一刀之后，单节点 ↑ 没有「授权」这一段异步了（这一下点击就是批准）；还剩的那一段是批量卡点了确认之后
  // 主进程为卡上每一镜开出价。它失败时的反馈同样要合并成一条、记住发起它的项目。
  it('batch consent failures coalesce and retain origin while consenting crosses projects', async () => {
    const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'Draft a shot' })
    mocks.consent.mockImplementation(async () => { await projectSession.open('other-project'); throw new Error('Authorization service unavailable') })
    for (let attempt = 0; attempt < 5; attempt++) {
      await projectSession.open('origin-project')
      useBatchPlanPreviewStore.getState().open({ waves: [[node.id]], blocked: [], edgesUsed: [] })
      await useBatchPlanPreviewStore.getState().confirm()
    }
    expect(allNotices()).toHaveLength(1)
    expect(allNotices()[0].id).toBe(`origin-project:batch-plan:${node.id}`)
    expect(allNotices()[0]['data-notification-count']).toBe(5)
    expect(allNotices()[0]['data-notification-reason']).toBe('authorization')
    clickNoticeAction()
    expect(mocks.reveal).toHaveBeenCalledWith({ projectId: 'origin-project', workspaceMode: 'generation', nodeIds: [node.id], taskCenter: undefined })
    expect(useGenerationQueueStore.getState().entries).toHaveLength(0)
  })
})
