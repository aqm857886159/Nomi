// 跨层：画布单节点 ↑「再发一次」从渲染入口一路走到假供应商——
// 真控制器（confirmAndRunNode）→ 真 taskApi / productionRunApi → 真预加载桥 → 真 IPC 处理器（任务、制作 Run）→ 真主进程单镜 Run → 进程内假供应商。
// 只有 Electron 的 ipcMain / ipcRenderer 换成同进程转发；钱数以供应商收到的 POST 计。
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>()
  const byContents = new Map<object, object>()
  class FakeBrowserWindow {
    readonly webContents: { id: number; mainFrame: { routingId: number }; isDestroyed(): boolean; getURL(): string; once(): void }
    constructor(id: number) {
      this.webContents = { id, mainFrame: { routingId: 1 }, isDestroyed: () => false, getURL: () => 'file:///app/index.html', once: () => undefined }
      byContents.set(this.webContents, this)
    }
    isDestroyed() { return false }
    static fromWebContents(contents: object) { return byContents.get(contents) ?? null }
  }
  const state: { event: unknown } = { event: undefined }
  return { handlers, FakeBrowserWindow, state }
})

vi.mock('electron', () => ({
  BrowserWindow: ipc.FakeBrowserWindow,
  ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => ipc.handlers.set(channel, handler), on: () => undefined },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = ipc.handlers.get(channel)
      if (!handler) throw new Error(`no IPC handler for ${channel}`)
      return handler(ipc.state.event, args[0])
    },
    on: () => undefined, removeListener: () => undefined, send: () => undefined, sendSync: () => undefined,
  },
}))
// 目录解析不是这里要钉的东西：拿不到目录 = 信任节点上钉的供应商（catalogTaskResolve 的既有退路）。
vi.mock('../../api/modelCatalogApi', async (original) => ({
  ...await original<typeof import('../../api/modelCatalogApi')>(),
  listWorkbenchModelCatalogVendors: async () => { throw new Error('no catalog bridge in tests') },
}))

import { CANVAS_TEST_PROJECT as PROJECT, setupCanvasShots } from '../../../../electron/capabilityCore/canvasShotTestUtils'
import * as canvasCore from '../../../../electron/capabilityCore/canvasShotRunApi'
import { registerTaskIpcHandlers } from '../../../../electron/tasks/taskIpcHandlers'
import { registerProductionRunIpc } from '../../../../electron/productionRun/productionRunIpc'
import { setMainWindow } from '../../../../electron/appWindowRegistry'
import { runtimeBridge } from '../../../../electron/preload/runtimeBridge'
import { canvasRunIdFor } from '../../../../electron/productionRun/canvasShotRunIndex'
import { confirmAndRunNode } from './generationRunController'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useGenerationQueueStore } from './generationQueueStore'
import { useSpendConfirmStore } from '../spend/spendConfirm'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
import i18n from '../../../i18n'

const RESEND_LABEL = () => i18n.t('generationCommon.observability.action.releaseRegenerate.main')
const queued = (id: string) => ({ id, kind: 'text_to_image' as const, status: 'queued' as const, assets: [], raw: {} })

let session: ProjectSessionTestHarness
let h: ReturnType<typeof setupCanvasShots>
let confirm: ReturnType<typeof vi.fn>

beforeEach(async () => {
  ipc.handlers.clear()
  h = setupCanvasShots()
  vi.stubEnv('NOMI_SETTINGS_DIR', h.root)
  canvasCore.installCanvasShotRuns(h.runs)
  const win = new ipc.FakeBrowserWindow(h.senderId)
  setMainWindow(win as never)
  ipc.state.event = { sender: win.webContents, senderFrame: { routingId: 1, url: 'file:///app/index.html', origin: 'file://' } }
  registerTaskIpcHandlers(async () => { throw new Error('no runtime in this test') }, async () => canvasCore as never)
  registerProductionRunIpc(h.service as never)
  vi.stubGlobal('window', { nomiDesktop: runtimeBridge })
  // 进程级网闸：这条链上任何真网络请求（本机回环以外）一律抛——钱只能落在进程内假供应商上。
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`network guard: blocked ${url.hostname}`)
    return realFetch(input, init)
  })
  confirm = vi.fn(async () => true)
  vi.spyOn(useSpendConfirmStore.getState(), 'requestConfirm').mockImplementation(confirm as never)
  session = createProjectSessionTestHarness()
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
  useGenerationQueueStore.setState({ entries: [], batches: {} })
  await session.open(PROJECT)
})
afterEach(() => {
  session?.dispose()
  canvasCore.installCanvasShotRuns(null)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

// 金丝雀：网闸真的装上了（先跑它，再跑别的）。
it('网闸金丝雀：本机回环以外的请求在这条链上发不出去', () => {
  expect(() => fetch('https://api.example.invalid/v1/images/generations')).toThrow(/network guard: blocked api\.example\.invalid/)
})

function addImageNode() {
  const node = useGenerationCanvasStore.getState().addNode({ kind: 'image', prompt: 'a red cube' })
  useGenerationCanvasStore.getState().updateNode(node.id, { meta: { modelKey: 'img-model', modelVendor: 'acme', vendor: 'acme' } })
  return node.id
}
const resendCards = () => confirm.mock.calls.filter(([request]) => (request as { confirmLabel?: string }).confirmLabel === RESEND_LABEL())

it('U2：卡开着时同节点冒出一笔 B，这一次确认只算卡上那一笔；B 被主进程拒、再问一次，供应商不多收', async () => {
  const id = addImageNode()
  // A：这个节点上一笔还在供应商那边跑（窗口重载过，渲染层的节点已经空闲）。
  h.vendor.answer = async call => queued(`accepted-${call}`)
  // B（第 2 笔）一直在跑；别的一查就出片——多发出去的那一笔会落成「成功」，数 POST 就能看出来。
  h.vendor.poll = (taskId) => taskId === 'accepted-2' ? queued(taskId) : ({ ...queued(taskId), status: 'succeeded', assets: [{ type: 'image', url: `nomi-local://asset/${PROJECT}/assets/out.png` }] })
  await h.submit(id, 'run-a')
  expect(h.vendor.executes).toHaveLength(1)
  confirm.mockImplementationOnce(async () => {
    // 卡开着：A 收尾了，排在后面的批次那一镜（人在批量卡上同意过的）轮到这个节点、交出去了——这就是 B。
    await canvasCore.pollCanvasShot({ projectId: PROJECT, runRecordId: 'run-a', senderId: h.senderId })
    h.consent([{ nodeId: id, runRecordId: 'run-b' }])
    await h.submit(id, 'run-b')
    expect(h.vendor.executes).toHaveLength(2)
    return true
  }).mockImplementationOnce(async () => false)

  await confirmAndRunNode(id, { initiator: 'user' })

  // 第一次确认只认卡打开那一刻的 A：B 没被放行，供应商只收过 A、B 两笔。
  expect(h.vendor.executes).toHaveLength(2)
  expect(h.runs.canvasOpenRuns({ projectId: PROJECT, nodeId: id }).map(entry => entry.runId)).toEqual([canvasRunIdFor('run-b')])
  // B 被拒后照现有流程再问一次（第二张卡），人取消就一笔都不发。
  expect(resendCards()).toHaveLength(2)
})

it('确认卡上那一笔还在跑的 A：A 真的被放下、新的一笔真的发出去，供应商只多收这一次', async () => {
  const id = addImageNode()
  h.vendor.answer = async call => call === 1 ? queued('accepted-1') : ({ id: `sync-${call}`, kind: 'text_to_image', status: 'succeeded', assets: [{ type: 'image', url: `nomi-local://asset/${PROJECT}/assets/out.png` }], raw: {} })
  await h.submit(id, 'run-a')

  await expect(confirmAndRunNode(id, { initiator: 'user' })).resolves.toBe('started')

  expect(resendCards()).toHaveLength(1)
  expect(h.vendor.executes).toHaveLength(2)
  expect(useGenerationCanvasStore.getState().nodes.find(node => node.id === id)?.status).toBe('success')
})

it('D1：第一次生成、节点上没有没收尾的 → 不弹重发卡，照常发一笔', async () => {
  const id = addImageNode()

  await expect(confirmAndRunNode(id, { initiator: 'user' })).resolves.toBe('started')

  expect(resendCards()).toHaveLength(0)
  expect(h.vendor.executes).toHaveLength(1)
})

it('D3：不是人发起的遇到还在跑的 → 主进程拒，渲染层自报 user 也换不来放行', async () => {
  const id = addImageNode()
  h.vendor.answer = async call => queued(`accepted-${call}`)
  await h.submit(id, 'run-a')

  await expect(confirmAndRunNode(id, { initiator: 'agent' })).rejects.toMatchObject({ code: 'node_generation_in_flight' })
  // 绕过控制器、直接拿 IPC 报「我是人」：没有决定号的提交照样被拒。
  await expect(runtimeBridge.tasks.canvasSubmit({
    projectId: PROJECT, nodeId: id, runRecordId: 'forged', vendor: 'acme',
    request: { kind: 'text_to_image', prompt: 'x', extras: { projectId: PROJECT, nodeId: id } },
  } as never)).rejects.toThrow(/node_generation_in_flight/)
  expect(resendCards()).toHaveLength(0)
  expect(h.vendor.executes).toHaveLength(1)
})

it('放行只认决定号里列出的那一笔：渲染层多报一笔（别的节点那笔结果不明）、不带号、号用错，主进程都拒', async () => {
  const x = addImageNode()
  const y = addImageNode()
  h.vendor.answer = async () => { throw new Error('acme create failed: socket hang up') }
  await h.submit(x, 'run-x').catch(() => undefined)
  await h.submit(y, 'run-y').catch(() => undefined)
  const jobOf = (runRecordId: string) => h.repository.read(PROJECT, canvasRunIdFor(runRecordId))!.jobs[0]
  expect([jobOf('run-x').status, jobOf('run-y').status]).toEqual(['submission_unknown', 'submission_unknown'])
  const decide = (runtimeBridge.tasks as { canvasResendDecide?: (payload: unknown) => Promise<{ action: string; decisionId?: string; release?: unknown }> }).canvasResendDecide
  const decision = await decide!({ projectId: PROJECT, nodeId: x, resend: true, initiator: 'user' })
  expect(decision).toMatchObject({ action: 'ask', release: [{ runId: canvasRunIdFor('run-x'), jobId: jobOf('run-x').jobId }] })
  const release = (runRecordId: string, resendDecisionId?: string) => runtimeBridge.productionRuns.command(PROJECT, canvasRunIdFor(runRecordId), {
    commandId: `release-${runRecordId}-${resendDecisionId ?? 'none'}`, expectedRevision: h.repository.read(PROJECT, canvasRunIdFor(runRecordId))!.revision,
    type: 'job.reconcile', payload: { jobId: jobOf(runRecordId).jobId, outcome: 'user_checked_abandon', ...(resendDecisionId ? { resendDecisionId } : {}) },
    issuedAt: new Date().toISOString(),
  } as never)

  await expect(release('run-y', decision.decisionId)).rejects.toThrow(/not covered by a resend decision/)
  await expect(release('run-x')).rejects.toThrow(/not covered by a resend decision/)
  await expect(release('run-x', 'made-up')).rejects.toThrow(/not covered by a resend decision/)
  await release('run-x', decision.decisionId)

  expect(jobOf('run-x').status).toBe('needs_attention')
  expect(jobOf('run-y').status).toBe('submission_unknown')
  expect(h.vendor.executes).toHaveLength(2)
})
