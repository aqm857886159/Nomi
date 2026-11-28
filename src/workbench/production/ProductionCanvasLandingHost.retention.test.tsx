// 落地缓存留多久（D2 第③步走查抓到的那一类）：缓存只留「节点还没结果」的 Run 时，三镜都出结果的那一刻
// 对话流里付费卡的收据（「✓ 已生成 3 段」+ 组指向）整块消失——收据读的就是这份缓存。
// 守的是：画布上有节点的每一份 Run 都在缓存里（出了结果也在，重启后第一拍读回来）；只重读还会变的那几份
// （节点要小标的 / 交接还在路上的 / 没读过的），不会变的不再每一拍读；主进程说没有的那一份不再每一拍问。
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ read: vi.fn(), command: vi.fn() }))
vi.mock('./productionRunApi', () => ({ productionRunApi: api }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererWarn: vi.fn(), logRendererError: vi.fn() }))
// 对话投影（待决出价随它推过来）：测试手里握着推送那一下。
const lane = vi.hoisted(() => {
  const listeners = new Set<(workspace: { spend?: unknown }) => void>()
  let latest: { spend?: unknown } = {}
  return {
    push: (spend: unknown) => {
      latest = { spend }
      listeners.forEach((listener) => listener(latest))
    },
    reset: () => { latest = {}; listeners.clear() },
    client: { workspace: () => latest, subscribe: (listener: (workspace: { spend?: unknown }) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
  }
})
vi.mock('../ai/lane/laneClient', () => ({ laneClient: lane.client }))

import { ProductionCanvasLandingHost } from './ProductionCanvasLandingHost'
import { changedOfferRuns, landingRunsToRefresh, pendingOfferSignatures } from './productionCanvasLandingStore'
import type { PendingSpendConfirm, PendingSpendRead } from '../../desktop/productionRunBridgeTypes'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { receiptShotNodeIds } from '../ai/pointer/generationReceiptFacts'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { GenerationHandOver, ProductionRun } from '../../../electron/shared/contracts/productionRunTypes'
import { IN_APP_AGENT_ORIGIN_HOST } from '../../../electron/shared/productionGenerationPresentation'

const NOW = '2026-10-24T00:00:00.000Z'
const SHOTS = ['shot-1', 'shot-2', 'shot-3']

function node(index: number, done: boolean): GenerationCanvasNode {
  return {
    id: `node-${index}`, kind: 'video', title: `镜 ${index}`, position: { x: index * 300, y: 0 }, prompt: `p${index}`, categoryId: 'shots',
    status: done ? 'success' : 'running',
    ...(done ? { result: { type: 'video', url: `file:///clip-${index}.mp4` } } : {}),
    meta: { productionRunId: 'op-1', productionShotId: SHOTS[index - 1] },
  } as GenerationCanvasNode
}

function run(revision: number, settled = true): ProductionRun {
  const candidate = { candidateId: 'cand-1', revision: 1, moduleId: 'm', providerId: 'apimart', modelId: 'video', mode: 't2v', prompt: '', parameters: {}, references: [] }
  const handOvers: GenerationHandOver[] = SHOTS.map((shotId, index) => ({
    shotId, by: 'gesture', at: NOW, canvasRunId: `canvas-run-${index + 1}`,
    ...(settled ? { settled: { at: NOW, outcome: 'accepted' as const } } : {}),
  }))
  return {
    schemaVersion: 1, runId: 'op-1', projectId: 'project-a', revision, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.multi-shot', version: '1.0.0' }, origin: { host: IN_APP_AGENT_ORIGIN_HOST },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    planVersion: 1, snapshotCursor: 0, stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: {
      operationId: 'op-1', state: 'draft', candidate,
      presentations: [{ shotIds: SHOTS, openedAt: NOW, fromGate: 0, ...(settled ? { closed: { by: 'handed_to_canvas', at: NOW } } : {}), handOvers }],
      shots: SHOTS.map((shotId, index) => ({ shotId, nodeId: `node-${index + 1}`, candidate: { ...candidate, candidateId: shotId }, updatedAt: NOW })),
      updatedAt: NOW,
    },
    createdAt: NOW, updatedAt: NOW,
  } as ProductionRun
}

function browserContainer(): { container: HTMLElement; restore: () => void } {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const document = {
    nodeType: 9, documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    addEventListener: () => undefined, removeEventListener: () => undefined, defaultView: null as unknown, activeElement: null as unknown,
  }
  class FakeHTMLElement {}
  class FakeHTMLIFrameElement extends FakeHTMLElement {}
  const window = {
    document, addEventListener: () => undefined, removeEventListener: () => undefined, localStorage: { getItem: () => null },
    setInterval, clearInterval, HTMLElement: FakeHTMLElement, HTMLIFrameElement: FakeHTMLIFrameElement,
  }
  document.defaultView = window
  const container = {
    nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document,
    addEventListener: () => undefined, removeEventListener: () => undefined, firstChild: null,
  } as unknown as HTMLElement
  document.activeElement = container
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  return { container, restore: () => { vi.stubGlobal('window', previousWindow); vi.stubGlobal('document', previousDocument) } }
}

/** 推进一拍 poll（host 每 1.5 秒一拍）并让读回来的那一份落进 store。 */
async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500)
  })
}

describe('落地缓存：画布上有节点的每一份 Run 都在，只重读还会变的', () => {
  let root: Root | undefined
  let restoreBrowser: (() => void) | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    api.read.mockReset()
    lane.reset()
    useProductionCanvasLandingStore.getState().reset()
    const browser = browserContainer()
    restoreBrowser = browser.restore
    root = createRoot(browser.container)
  })

  afterEach(async () => {
    await act(async () => root?.unmount())
    restoreBrowser?.()
    vi.useRealTimers()
  })

  async function mount(nodes: GenerationCanvasNode[]): Promise<void> {
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [] }, 'project-a')
    await act(async () => {
      root!.render(React.createElement(ProductionCanvasLandingHost, { projectId: 'project-a' }))
      await Promise.resolve()
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  it('三镜都出了结果：Run 还在缓存里（收据照样指着那三个节点），之后不再每一拍重读', async () => {
    const settled = run(7)
    api.read.mockResolvedValue(settled)
    await mount([node(1, true), node(2, true), node(3, true)])
    expect(api.read).toHaveBeenCalledTimes(1)
    expect(useProductionCanvasLandingStore.getState().runs['op-1']).toBe(settled)
    expect(receiptShotNodeIds(useProductionCanvasLandingStore.getState().runs, 'op-1')).toEqual(['node-1', 'node-2', 'node-3'])
    await tick()
    await tick()
    expect(api.read, '不会再变的那一份不每一拍读').toHaveBeenCalledTimes(1)
    expect(useProductionCanvasLandingStore.getState().runs['op-1']).toBe(settled)
  })

  it('生成中每一拍都读；三镜出结果的那一刻之后不丢、也不再读（收据从「已发出」走到「已生成」都有它）', async () => {
    api.read.mockResolvedValueOnce(run(1)).mockResolvedValueOnce(run(2)).mockResolvedValue(run(3))
    await mount([node(1, false), node(2, false), node(3, false)])
    await tick()
    expect(api.read).toHaveBeenCalledTimes(2)
    act(() => {
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node(1, true), node(2, true), node(3, true)], edges: [], groups: [] }, 'project-a')
    })
    await tick()
    await tick()
    const kept = useProductionCanvasLandingStore.getState().runs['op-1']
    expect(kept?.revision, '出结果之后留着最后读到的那一份').toBe(2)
    expect(api.read).toHaveBeenCalledTimes(2)
    expect(receiptShotNodeIds(useProductionCanvasLandingStore.getState().runs, 'op-1')).toEqual(['node-1', 'node-2', 'node-3'])
  })

  it('交接还在路上（节点已经有结果也一样）→ 每一拍重读，直到交接落定', async () => {
    api.read.mockResolvedValueOnce(run(1, false)).mockResolvedValue(run(2, true))
    await mount([node(1, true), node(2, true), node(3, true)])
    await tick()
    expect(api.read).toHaveBeenCalledTimes(2)
    await tick()
    expect(api.read, '落定之后不再读').toHaveBeenCalledTimes(2)
    expect(useProductionCanvasLandingStore.getState().runs['op-1']?.revision).toBe(2)
  })

  it('对话投影推来出价变了（卡出来 / 一镜走了一步 / 卡关了）→ 当场重读那一份，不等下一拍；没变不读', async () => {
    api.read.mockResolvedValueOnce(run(1)).mockResolvedValueOnce(run(2)).mockResolvedValueOnce(run(3)).mockResolvedValue(run(4))
    await mount([node(1, true), node(2, true), node(3, true)])
    expect(api.read).toHaveBeenCalledTimes(1)
    const flush = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
    await act(async () => lane.push(ready([card('op-1', 'q-1', 'undecided')])))
    await flush()
    expect(api.read, '卡出来那一下就读，不等 1.5 秒').toHaveBeenCalledTimes(2)
    expect(useProductionCanvasLandingStore.getState().runs['op-1']?.revision).toBe(2)
    await act(async () => lane.push(ready([card('op-1', 'q-1', 'undecided')])))
    await flush()
    expect(api.read, '同一份推送再来一次：不读').toHaveBeenCalledTimes(2)
    await act(async () => lane.push(ready([card('op-1', 'q-1', 'handing_over')])))
    await flush()
    expect(api.read, '卡上一镜走了一步（身份没变）：读').toHaveBeenCalledTimes(3)
    await act(async () => lane.push(ready([])))
    await flush()
    expect(api.read, '卡关了：读').toHaveBeenCalledTimes(4)
    await act(async () => lane.push(ready([card('op-other', 'q-9', 'undecided')])))
    await flush()
    expect(api.read, '画布上没有节点的那一份：不读').toHaveBeenCalledTimes(4)
    await act(async () => lane.push(ready([{ ...card('op-1', 'q-2', 'undecided'), projectId: 'project-b' }])))
    await flush()
    expect(api.read, '别的项目的出价：不读').toHaveBeenCalledTimes(4)
  })

  it('读还在路上时又来一拍 / 又来一份推送：不叠着读，读完再读一遍', async () => {
    let release: (value: ProductionRun) => void = () => undefined
    api.read.mockImplementationOnce(() => new Promise<ProductionRun>((resolve) => { release = resolve })).mockResolvedValue(run(2))
    await mount([node(1, false)])
    expect(api.read).toHaveBeenCalledTimes(1)
    await act(async () => lane.push(ready([card('op-1', 'q-1', 'undecided')])))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(api.read, '第一次读没回来：推送和下一拍都不叠上去').toHaveBeenCalledTimes(1)
    await act(async () => { release(run(1)); await vi.advanceTimersByTimeAsync(0) })
    expect(api.read, '读完再读一遍（推送说变了）').toHaveBeenCalledTimes(2)
    expect(useProductionCanvasLandingStore.getState().runs['op-1']?.revision).toBe(2)
  })

  it('主进程说没有这一份：节点不要小标就不再每一拍问；节点要小标就照问', async () => {
    api.read.mockResolvedValue(null)
    await mount([node(1, true)])
    await tick()
    await tick()
    expect(api.read).toHaveBeenCalledTimes(1)
    act(() => {
      useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [node(1, false)], edges: [], groups: [] }, 'project-a')
    })
    await tick()
    expect(api.read).toHaveBeenCalledTimes(2)
  })
})

function card(runId: string, quoteId: string, offer: PendingSpendConfirm['shots'][number]['offer']): PendingSpendConfirm {
  return {
    projectId: 'project-a', runId, operationId: runId, planVersion: 1, quoteId, handOverRevision: 0, currency: 'CNY',
    shots: SHOTS.map((shotId, index) => ({ shotId, nodeId: `node-${index + 1}`, index: index + 1, kind: 'video', draftedModel: { providerId: 'apimart', modelId: 'video' }, offer })),
  }
}

function ready(rows: PendingSpendConfirm[]): PendingSpendRead {
  return { surface: 'ready', rows }
}

describe('pendingOfferSignatures / changedOfferRuns（推送里哪几份出价变了）', () => {
  const before = pendingOfferSignatures(ready([card('op-1', 'q-1', 'undecided')]), 'project-a')
  it.each([
    ['同一份', ready([card('op-1', 'q-1', 'undecided')]), []],
    ['换了身份（重新出价）', ready([card('op-1', 'q-2', 'undecided')]), ['op-1']],
    ['身份没变、一镜走了一步', ready([card('op-1', 'q-1', 'handing_over')]), ['op-1']],
    ['卡关了', ready([]), ['op-1']],
    ['面关了（off）', { surface: 'off', phase: 'stopped' } as PendingSpendRead, ['op-1']],
    ['读不到但带着那张卡', { surface: 'unreadable', reason: 'projection-failed', card: card('op-1', 'q-1', 'undecided') } as PendingSpendRead, []],
    ['多出一笔', ready([card('op-1', 'q-1', 'undecided'), card('op-2', 'q-7', 'undecided')]), ['op-2']],
    ['别的项目的那一笔不算', ready([card('op-1', 'q-1', 'undecided'), { ...card('op-3', 'q-8', 'undecided'), projectId: 'project-b' }]), []],
  ] as const)('%s', (_label, spend, expected) => {
    expect(changedOfferRuns(before, pendingOfferSignatures(spend, 'project-a'))).toEqual(expected)
  })
})

describe('landingRunsToRefresh（这一拍重读哪几份）', () => {
  const settled = run(1)
  const inFlight = run(1, false)
  const terminal = { ...run(1), status: 'completed' } as ProductionRun
  it.each([
    ['没读过', {}, new Set<string>(), new Set<string>(), true],
    ['读过、节点都出了结果、交接都落定', { 'op-1': settled }, new Set<string>(), new Set<string>(), false],
    ['读过、节点还要小标', { 'op-1': settled }, new Set(['op-1']), new Set<string>(), true],
    ['读过、交接还在路上', { 'op-1': inFlight }, new Set<string>(), new Set<string>(), true],
    ['已经终结（节点要小标也不再读）', { 'op-1': terminal }, new Set(['op-1']), new Set<string>(), false],
    ['主进程说没有、节点不要小标', {}, new Set<string>(), new Set(['op-1']), false],
    ['主进程说没有、节点要小标', {}, new Set(['op-1']), new Set(['op-1']), true],
  ] as const)('%s', (_label, cached, needBadges, absent, expected) => {
    expect(landingRunsToRefresh(new Set(['op-1']), needBadges, cached as Record<string, ProductionRun>, absent)).toEqual(expected ? ['op-1'] : [])
  })
})
