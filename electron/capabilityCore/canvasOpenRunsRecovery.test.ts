// 验收线复现入库（第3轮新行为）：真仓库、真 Run 服务、真提交出口、真派发闸；只有传输是假供应商。
import { describe, expect, it, vi } from 'vitest'
import { CANVAS_TEST_PROJECT as PROJECT, setupCanvasShots, canvasTestRequest } from './canvasShotTestUtils'
import { canvasRunIdFor, openCanvasRuns } from '../productionRun/canvasShotRunIndex'
import { createProductionRunService } from '../productionRun/productionRunService'
import { observeSingleShotGeneration } from '../productionRun/singleShotGenerationObserver'
import { blockingReason } from './canvasShotResult'
import { hasWorkToWatch } from '../productionRun/productionRunLifecycle'
import type { CanvasTaskResult } from './canvasTransportProvider'

const task = (id: string, status: CanvasTaskResult['status']): CanvasTaskResult => ({ id, kind: 'text_to_image', status, assets: [], raw: {} })
const readOf = (h: ReturnType<typeof setupCanvasShots>, record: string) => h.repository.read(PROJECT, canvasRunIdFor(record))!

describe('I6 强退发生在 POST 途中（要写盘失败才出现？）', () => {
  it('POST 还没回就没了进程：重启、开项目后这一节点还能不能再发', async () => {
    const h = setupCanvasShots()
    h.vendor.answer = () => new Promise<CanvasTaskResult>(() => undefined) // 进程死在这里：这个 POST 永远回不来
    void h.submit('node-a', 'r1').catch(() => undefined)
    await vi.waitFor(() => expect(h.vendor.executes).toHaveLength(1))
    const atCrash = readOf(h, 'r1')
    expect(atCrash.jobs[0].status).toBe('submitting')
    expect(atCrash.jobs[0].providerTaskId).toBeFalsy()

    // 重启：新进程、同一份盘。开项目钩子里跑的两件事都跑。
    const restarted = setupCanvasShots({ root: h.root })
    restarted.runs.recoverOrphans(PROJECT)
    const service = createProductionRunService({ repository: restarted.repository, projectRootResolver: () => h.root })
    await service.resumeUnfinishedRuns(PROJECT)
    const afterRestart = readOf(restarted, 'r1')
    const refused = await restarted.submit('node-a', 'r2').then(() => 'SENT', (error: { code?: string }) => error.code)
    const report = {
      statusAtCrash: atCrash.jobs[0].status,
      statusAfterRestart: afterRestart.jobs[0].status,
      observed: restarted.observed,
      canvasOpenRuns: restarted.runs.canvasOpenRuns({ projectId: PROJECT, nodeId: 'node-a' }),
      listedInTaskCenter: restarted.repository.list(PROJECT).map(run => run.runId),
      secondClick: refused,
      vendorExecutesAfterRestart: restarted.vendor.executes.length,
      openMarkers: openCanvasRuns(h.root, 'node-a'),
      blocking: blockingReason(afterRestart),
    }
    console.log('REPRO I6', JSON.stringify(report))
    // 第二次重启照样
    const again = setupCanvasShots({ root: h.root })
    again.runs.recoverOrphans(PROJECT)
    const service2 = createProductionRunService({ repository: again.repository, projectRootResolver: () => h.root })
    await service2.resumeUnfinishedRuns(PROJECT)
    const refusedAgain = await again.submit('node-a', 'r3').then(() => 'SENT', (error: { code?: string }) => error.code)
    console.log('REPRO I6 second restart', refusedAgain, readOf(again, 'r1').jobs[0].status)
    // 断言写的是「该有的样子」：要么已经变成可放行的结果未知，要么能再发。红 = 没有出路。
    expect(report.statusAfterRestart).toBe('submission_unknown')
    expect(report.canvasOpenRuns).toEqual([expect.objectContaining({ reason: 'needs_reconcile', hasTaskId: false, nodeId: 'node-a' })])
    expect(refusedAgain).toBe('production_shot_claimed')
  })

  it('对照：同一个 POST 中途进程没死、连接断了 → 变结果未知，unknownRuns 拿得到（有出路）', async () => {
    const h = setupCanvasShots()
    h.vendor.answer = async () => { throw new Error('acme create failed: socket hang up') }
    await h.submit('node-a', 'r1').catch(() => undefined)
    expect(readOf(h, 'r1').jobs[0].status).toBe('submission_unknown')
    expect(h.runs.canvasOpenRuns({ projectId: PROJECT, nodeId: 'node-a' })).toHaveLength(1)
  })
})

describe('I10 供应商一直说「还在跑」', () => {
  it('观察窗重踢多轮、重启两次：节点一直被拒，放行拿不到，任务中心没有这一行', async () => {
    const h = setupCanvasShots()
    h.vendor.answer = async () => task('stuck-task', 'queued')
    h.vendor.poll = (taskId) => task(taskId, 'running')
    await h.submit('node-a', 'r1')
    await expect(h.submit('node-a', 'r2')).rejects.toMatchObject({ code: 'node_generation_in_flight' })
    let submissionSeen: unknown
    const restarted = setupCanvasShots({ root: h.root, observe: (submission) => { submissionSeen = submission } })
    restarted.vendor.poll = (taskId) => task(taskId, 'running')
    restarted.runs.recoverOrphans(PROJECT)
    expect(restarted.observed).toHaveLength(1)
    const windows: string[] = []
    for (let window = 0; window < 3; window += 1) {
      const result = await observeSingleShotGeneration({
        submission: submissionSeen as never,
        input: { projectId: PROJECT, operationId: canvasRunIdFor('r1') },
        pollHorizonMs: 1, initialDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined,
      })
      windows.push(result.nextAction)
    }
    const afterWindows = readOf(restarted, 'r1')
    const report = {
      windows,
      jobStatus: afterWindows.jobs[0].status,
      stillWatched: hasWorkToWatch(afterWindows),
      blocking: blockingReason(afterWindows),
      canvasOpenRuns: restarted.runs.canvasOpenRuns({ projectId: PROJECT, nodeId: 'node-a' }),
      listedInTaskCenter: restarted.repository.list(PROJECT).map(run => run.runId),
      thirdClick: await restarted.submit('node-a', 'r3').then(() => 'SENT', (error: { code?: string }) => error.code),
      vendorExecutes: h.vendor.executes.length + restarted.vendor.executes.length,
    }
    console.log('REPRO I10', JSON.stringify(report))
    // 红 = 没有期限也没有出路
    expect(report.windows).toEqual(['observe', 'observe', 'observe'])
    expect(report.canvasOpenRuns).toEqual([expect.objectContaining({ reason: 'in_flight', hasTaskId: true, nodeId: 'node-a' })])
    await restarted.runs.submit({ projectId: PROJECT, nodeId: 'node-a', runRecordId: 'human-confirmed', vendor: 'acme', request: canvasTestRequest('node-a'), gesture: restarted.gesture, senderId: restarted.senderId, acknowledgedOpenRuns: [canvasRunIdFor('r1')] })
    expect(restarted.vendor.executes).toHaveLength(1)
  })

  it('对照：供应商查询报错 → 落 needs_attention，不再占节点（有出路）', async () => {
    const h = setupCanvasShots()
    h.vendor.answer = async () => task('lost-task', 'queued')
    h.vendor.poll = () => { throw new Error('HTTP 404 task not found') }
    await h.submit('node-a', 'r1')
    const error = await h.runs.poll({ projectId: PROJECT, runRecordId: 'r1', senderId: 7 }).then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(h.runs.canvasOpenRuns({ projectId: PROJECT, nodeId: 'node-a' })).toEqual([expect.objectContaining({ reason: 'in_flight', hasTaskId: true })])
    await h.runs.submit({ projectId: PROJECT, nodeId: 'node-a', runRecordId: 'human-after-retrieval-failed', vendor: 'acme', request: canvasTestRequest('node-a'), gesture: h.gesture, senderId: h.senderId, acknowledgedOpenRuns: [canvasRunIdFor('r1')] })
    expect(h.vendor.executes).toHaveLength(2)
  })
})

describe('I3 放手放给了谁', () => {
  it('被拒的 R2 去 release：原来的 R1 租约不动，也没有人接手观察', async () => {
    const h = setupCanvasShots()
    h.vendor.answer = async () => task('t-1', 'queued')
    h.vendor.poll = (taskId) => task(taskId, 'running')
    await h.submit('node-a', 'r1')
    await expect(h.submit('node-a', 'r2')).rejects.toMatchObject({ code: 'node_generation_in_flight' })
    h.runs.release({ projectId: PROJECT, runRecordId: 'r2' })
    const observedAfterWrongRelease = [...h.observed]
    h.runs.release({ projectId: PROJECT, runRecordId: 'r1' })
    const report = { observedAfterWrongRelease, observedAfterRightRelease: [...h.observed] }
    console.log('REPRO I3', JSON.stringify(report))
    expect(h.observed).toEqual([[PROJECT, canvasRunIdFor('r1')]])
    expect(observedAfterWrongRelease).toEqual([]) // 记录事实：放错人时没有观察者
  })
})
