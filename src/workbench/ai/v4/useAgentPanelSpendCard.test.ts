// 付费卡钩子（D2 第③步，SpendCardQ1 板）的行为测试：真 React（仓库的 react-reconciler 测试渲染器）、真画布 store、真词典；
// 宿主动作通道（productionRunApi）、提示、素材托管解析、本机预检、模型目录换成替身。
//
// 守的是这几件（根因合同 2026-10-08-pending-spend-presentation 与 2026-10-02-generate-remaining-stop，逃逸账本 FB-20261008）：
//   · 卡上每一个动作都带着**此刻卡上那一张**的身份（下面的动作清单矩阵：宿主再推一份新卡之后，动作带的是新卡的身份）；
//   · 「取消」不排队：别的一下还在路上时也立刻送到宿主，那一下随后的失败不弹（结局由取消那一句说）；在路上时第二下不进；
//   · 按下那一刻卡上画着的节点 ≠ 画布此刻的 → 不交，说「卡刚变了」；
//   · 停下那一句只在宿主数了 sent / notSent 时说，说的就是宿主的数；
//   · 卡自己关掉（每一镜都定了）→ 交出去的那几镜在画布上一起闪一下；点「取消」关掉的、换成另一笔的不闪；
//   · 读不到的卡没有卡体、主按钮交不出任何一镜；
//   · 旧卡账本 `nomi:spend-draft:*` 一个都不读。
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  handOverSpend: vi.fn(),
  discardSpend: vi.fn(),
  removeSpendShot: vi.fn(),
  restoreSpendShot: vi.fn(),
  toast: vi.fn(),
  push: vi.fn(),
  warn: vi.fn(),
  reveal: vi.fn(),
  precheck: vi.fn(),
}))
vi.mock('../../production/productionRunApi', () => ({
  productionRunApi: {
    handOverSpend: host.handOverSpend,
    discardSpend: host.discardSpend,
    removeSpendShot: host.removeSpendShot,
    restoreSpendShot: host.restoreSpendShot,
  },
}))
vi.mock('../../../ui/toast', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../ui/toast')>(),
  toast: host.toast,
  useToastStore: { getState: () => ({ push: host.push }) },
}))
vi.mock('../../../desktop/rendererLog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../desktop/rendererLog')>(),
  logRendererWarn: host.warn,
}))
vi.mock('../pointer/revealNodeFromChat', () => ({ revealNodeFromChat: host.reveal, returnToChat: vi.fn() }))
vi.mock('../../production/handOverPrecheck', () => ({ handOverPrecheck: host.precheck }))
// 模型目录是异步读的；这里换成同步桩：节点上选的是 img-model 就认得（显示名「Img Model」，没有价目表 → 价未知）。
vi.mock('../../generation/list/generationListModelLabels', () => {
  const optionOf = (node: { meta?: Record<string, unknown> } | undefined) => (node?.meta?.modelKey === 'img-model'
    ? { value: 'img-model', label: 'Img Model', vendor: 'acme', modelKey: 'img-model' }
    : undefined)
  return { useNodeModelOption: () => optionOf, useModelLabels: () => (node: never) => optionOf(node)?.label ?? '' }
})

import i18n from '../../../i18n'
import type { PendingSpendConfirm, PendingSpendRead, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { ProductionActionResult } from '../../production/productionRunApi'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { useNodeExternalHighlightStore } from '../../generationCanvas/store/nodeExternalHighlightStore'
import { createReactTestRenderer } from './testReactRenderer'
import { spendActionFailureCopy } from './spendCardFailure'
import { pendingSpendOfRead, useAgentPanelSpendCard, type AgentPanelSpendCard } from './useAgentPanelSpendCard'

const PROJECT = 'project-1'

const node = (id: string, meta: Record<string, unknown> = {}): GenerationCanvasNode => ({
  id, kind: 'image', title: `shot-${id}`, prompt: `一只纸船 ${id}`, categoryId: 'shots', position: { x: 0, y: 0 }, status: 'idle',
  meta: { modelKey: 'img-model', modelVendor: 'acme', aspect_ratio: '16:9', ...meta },
} as GenerationCanvasNode)

const shot = (index: number, patch: Partial<PendingSpendShot> = {}): PendingSpendShot => ({
  shotId: `s${index}`, nodeId: `n${index}`, index, kind: 'image', draftedModel: { providerId: 'acme', modelId: 'img-model' }, offer: 'undecided', ...patch,
})

const IDENTITY_A = { quoteId: 'q-1', presentationId: 'op-1:presentation:2', presentationEpoch: 2, planVersion: 3 } as const
const IDENTITY_B = { quoteId: 'q-2', presentationId: 'op-1:presentation:3', presentationEpoch: 3, planVersion: 4 } as const

const offer = (shots: readonly PendingSpendShot[], patch: Partial<PendingSpendConfirm> = {}): PendingSpendConfirm => ({
  projectId: PROJECT, runId: 'op-1', operationId: 'op-1', currency: 'CNY', ...IDENTITY_A, handOverRevision: 0, shots, ...patch,
})
const ready = (...rows: PendingSpendConfirm[]): PendingSpendRead => ({ surface: 'ready', rows })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

const OK = (code: ProductionActionResult['code'], patch: Partial<ProductionActionResult> = {}): ProductionActionResult => ({ ok: true, code, ...patch })

function seedCanvas(nodes: GenerationCanvasNode[], options: { ready?: boolean } = {}): void {
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes, edges: [], groups: [] }, PROJECT)
  useGenerationCanvasStore.setState({ projectId: PROJECT, isReady: options.ready ?? true })
}

/** 改画布上一个节点（换一份 meta，和生成框里改一个参数同一种写法：节点对象与 meta 都换新的）。 */
function editNode(id: string, meta: Record<string, unknown>): void {
  useGenerationCanvasStore.setState((state) => ({
    nodes: state.nodes.map((entry) => (entry.id === id ? { ...entry, meta: { ...entry.meta, ...meta } } : entry)),
  }))
}

let api!: AgentPanelSpendCard
/** 卡（钩子所在的那个组件）一共渲了几次：「只订卡上那几镜的节点」按它判。 */
let renders = 0
function Probe({ read }: { read: PendingSpendRead | undefined }): null {
  renders += 1
  api = useAgentPanelSpendCard(read)
  return null
}

const mounted: Array<() => void> = []
function mount(read: PendingSpendRead | undefined) {
  const renderer = createReactTestRenderer()
  const render = (next: PendingSpendRead | undefined) => {
    renderer.render(React.createElement(Probe, { read: next }))
    renderer.flushPassiveEffects()
  }
  render(read)
  mounted.push(() => renderer.close())
  return {
    render,
    /** 把排着的那几下状态更新（按下即置灰、画布 store 的变化）渲出来。 */
    flush: () => renderer.flushPassiveEffects(),
    /** 宿主那一下的结局（promise）落定之后再渲。 */
    async settle() {
      for (let i = 0; i < 8; i++) await Promise.resolve()
      renderer.flushPassiveEffects()
    },
  }
}

const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), key: vi.fn(() => null), clear: vi.fn(), length: 0 }

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  for (const fn of Object.values(host)) fn.mockReset()
  host.precheck.mockImplementation(() => new Map())
  host.handOverSpend.mockResolvedValue(OK('handed_over'))
  host.discardSpend.mockResolvedValue(OK('discarded'))
  host.removeSpendShot.mockResolvedValue(OK('shot_removed'))
  host.restoreSpendShot.mockResolvedValue(OK('shot_restored'))
  for (const fn of [storage.getItem, storage.setItem, storage.removeItem]) fn.mockClear()
  vi.stubGlobal('localStorage', storage)
  seedCanvas([node('n1'), node('n2'), node('n3')])
})

afterEach(() => {
  while (mounted.length) mounted.pop()!()
  useNodeExternalHighlightStore.getState().flashNodes([])
  vi.unstubAllGlobals()
})

describe('pendingSpendOfRead：off 不是失败', () => {
  const ROW = offer([])
  it('ready 就取第一笔；ready + [] 是真的没有', () => {
    expect(pendingSpendOfRead({ surface: 'ready', rows: [ROW] })).toBe(ROW)
    expect(pendingSpendOfRead({ surface: 'ready', rows: [] })).toBeUndefined()
  })
  it('投影里还没有这一项才是空；读不到时保留带身份的错误卡', () => {
    expect(pendingSpendOfRead(undefined)).toBeUndefined()
    const card = offer([], { error: { code: 'pending_spend_projection_empty', message: 'projection failed' } })
    expect(pendingSpendOfRead({ surface: 'unreadable', reason: 'projection-failed', card })).toBe(card)
  })
  it.each([
    { surface: 'off', phase: 'disabled', reason: 'env' },
    { surface: 'off', phase: 'disabled', reason: 'low-memory' },
    { surface: 'off', phase: 'starting' },
    { surface: 'off', phase: 'stopped' },
  ] as const)('off（%j）→ 没有卡，也不留下任何 console 痕迹', (read) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(pendingSpendOfRead(read)).toBeUndefined()
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})

/**
 * 卡上的动作清单（矩阵的行）：每一行是卡上一个会写宿主的动作、它走的那条通道、从那一下调用里读出它带的身份。
 * 新加一个卡上动作就在这里加一行——它带不带身份由同一条断言判。
 */
const CARD_ACTIONS = [
  {
    action: '生成（主按钮）',
    press: () => api.primary(),
    channel: host.handOverSpend,
    identityOf: (args: unknown[]) => args[0] as Record<string, unknown>,
  },
  {
    action: '不生成 ×',
    press: () => api.body!.onExclude('s2'),
    channel: host.removeSpendShot,
    identityOf: (args: unknown[]) => ({ quoteId: args[2], ...(args[4] as object) }),
  },
  {
    action: '恢复（不生成 × 再点一次）',
    press: () => api.body!.onRestore('s2'),
    channel: host.restoreSpendShot,
    identityOf: (args: unknown[]) => ({ quoteId: args[2], ...(args[4] as object) }),
  },
  {
    action: '取消',
    press: () => api.discard(),
    channel: host.discardSpend,
    identityOf: (args: unknown[]) => ({ quoteId: args[2], ...(args[3] as object) }),
  },
] as const

describe('卡上每一个动作都带着此刻卡上那一张的身份（动作清单矩阵）', () => {
  it.each(CARD_ACTIONS)('$action：带着卡上那一张的出价 / 呈现 / 计划版本', ({ press, channel, identityOf }) => {
    mount(ready(offer([shot(1), shot(2)])))
    press()
    expect(channel).toHaveBeenCalledTimes(1)
    expect(identityOf(channel.mock.calls[0]!)).toMatchObject(IDENTITY_A)
  })

  it.each(CARD_ACTIONS)('$action：宿主再推一份新卡之后，带的是新卡的身份（不是按下前那一张的闭包）', ({ press, channel, identityOf }) => {
    const view = mount(ready(offer([shot(1), shot(2)])))
    view.render(ready(offer([shot(1), shot(2)], IDENTITY_B)))
    press()
    expect(channel).toHaveBeenCalledTimes(1)
    const sent = identityOf(channel.mock.calls[0]!)
    expect(sent).toMatchObject(IDENTITY_B)
    expect(sent.quoteId).not.toBe(IDENTITY_A.quoteId)
  })
})

describe('「取消」不排队，卡上一下在路上时第二下不进', () => {
  it('生成那一下还在路上：卡置灰、第二下与「不生成 ×」都不进；点「取消」立刻送到宿主；那一下随后的失败不弹', async () => {
    const handOver = deferred<ProductionActionResult>()
    host.handOverSpend.mockReturnValue(handOver.promise)
    const view = mount(ready(offer([shot(1), shot(2)])))
    api.primary()
    view.flush()
    expect(host.handOverSpend).toHaveBeenCalledTimes(1)
    expect(api.slot).toMatchObject({ actionsDisabled: true })
    expect(api.body?.busy).toBe(true)

    api.primary()
    api.body!.onExclude('s2')
    expect(host.handOverSpend).toHaveBeenCalledTimes(1)
    expect(host.removeSpendShot).not.toHaveBeenCalled()

    api.discard()
    expect(host.discardSpend).toHaveBeenCalledTimes(1)

    handOver.resolve({ ok: false, code: 'failed', message: 'generation_quote_changed' })
    await view.settle()
    expect(host.toast).not.toHaveBeenCalled()
    // 那一下落定了，卡不再置灰（宿主没收卡时还能再按）。
    expect(api.slot).not.toHaveProperty('actionsDisabled')
    expect(api.body?.busy).toBe(false)
  })

  it('没有别的一下在路上时，生成被宿主拒了：弹那一句（由宿主的事实挑），宿主原话只进日志', async () => {
    const refused: ProductionActionResult = { ok: false, code: 'failed', message: 'generation_quote_changed' }
    host.handOverSpend.mockResolvedValue(refused)
    const view = mount(ready(offer([shot(1), shot(2)])))
    api.primary()
    await view.settle()
    expect(host.toast).toHaveBeenCalledTimes(1)
    expect(host.toast).toHaveBeenCalledWith(i18n.t(spendActionFailureCopy(refused), { field: '' }), 'error')
    expect(host.warn).toHaveBeenCalledWith('spend-confirm-refused', expect.objectContaining({ code: 'generation_quote_changed' }), refused)
  })
})

describe('按下那一刻：卡上画着的 = 交出去的', () => {
  it('节点刚改了、卡还没重渲就按下 → 不交，说「卡刚变了」；重渲之后再按 → 照节点此刻的样子交', () => {
    const view = mount(ready(offer([shot(1), shot(2)])))
    editNode('n2', { aspect_ratio: '9:16' })
    // 画布 store 已经变了，卡上那一下渲染还排着（同一拍里按下）。
    api.primary()
    expect(host.handOverSpend).not.toHaveBeenCalled()
    expect(host.toast).toHaveBeenCalledWith(i18n.t('agentPanelV4.spendActionCardChanged'), 'error')

    view.flush()
    api.primary()
    expect(host.handOverSpend).toHaveBeenCalledTimes(1)
    expect(host.handOverSpend.mock.calls[0]![0]).toMatchObject({ shotIds: ['s1', 's2'] })
  })

  it('确认条的共同参数读节点：节点上改了比例，条上那一行和那一镜那一行跟着变（不等宿主再推一份）', () => {
    const view = mount(ready(offer([shot(1), shot(2)])))
    expect(api.body?.summary).toContain('16:9')
    expect(api.body?.summary).not.toContain('9:16')
    editNode('n2', { aspect_ratio: '9:16' })
    view.flush()
    // 两镜比例不同了：比例不再是共同项，回到各自那一行。
    expect(api.body?.summary).not.toContain('16:9')
    expect(api.body?.pointers.map((pointer) => pointer.note)).toEqual(['16:9', '9:16'])
  })

  it('卡只订卡上那几镜的节点：画布上别的节点改了参数 / 被拖了，卡不重渲；卡上那一镜改了才重渲（200 节点的画布上拖一张卡不带着卡重渲）', () => {
    seedCanvas([node('n1'), node('n2'), node('other-1'), node('other-2')])
    const view = mount(ready(offer([shot(1), shot(2)])))
    const settled = renders
    editNode('other-1', { aspect_ratio: '9:16' })
    useGenerationCanvasStore.setState((state) => ({
      nodes: state.nodes.map((entry) => (entry.id === 'other-2' ? { ...entry, position: { x: 40, y: 40 } } : entry)),
    }))
    view.flush()
    expect(renders).toBe(settled)
    editNode('n2', { aspect_ratio: '9:16' })
    view.flush()
    expect(renders).toBeGreaterThan(settled)
    expect(api.body?.pointers[1]?.note).toContain('9:16')
  })

  it.each([
    { canvas: '画布载入完，镜 2 的节点被删了 → 主按钮不交它', isReady: true, expected: ['s1', 's3'] },
    { canvas: '画布还没载入完 → 不知道就不说已删除（按「在」算，交接那一步再判）', isReady: false, expected: ['s1', 's2', 's3'] },
  ])('$canvas', ({ isReady, expected }) => {
    seedCanvas([node('n1'), node('n3')], { ready: isReady })
    mount(ready(offer([shot(1), shot(2), shot(3)])))
    api.primary()
    expect(host.handOverSpend).toHaveBeenCalledTimes(1)
    expect(host.handOverSpend.mock.calls[0]![0]).toMatchObject({ shotIds: expected })
  })

  it('本机判得出发不出去的那一镜主按钮不数它；一段能发的都没有时主按钮是「去改镜 N」（定位到节点，不交）', async () => {
    const rejected = { kind: 'parameter_rejected', code: 'prompt_required' } as const
    host.precheck.mockImplementation((ids: readonly string[]) => new Map(ids.filter((id) => id === 'n2').map((id) => [id, rejected])))
    const view = mount(ready(offer([shot(1), shot(2)])))
    api.primary()
    expect(host.handOverSpend.mock.calls[0]![0]).toMatchObject({ shotIds: ['s1'] })
    await view.settle()

    host.handOverSpend.mockClear()
    view.render(ready(offer([shot(2)])))
    api.primary()
    expect(host.handOverSpend).not.toHaveBeenCalled()
    expect(host.reveal).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'n2' }))
  })
})

describe('停下那一句只说宿主数的', () => {
  it.each([
    { batchStopped: { sent: 1, notSent: 2 }, key: 'agentPanelV4.spendBatchStoppedImage', values: { sent: 1, count: 2, total: 3 } },
    { batchStopped: { sent: 3, notSent: 0 }, key: 'agentPanelV4.spendBatchAllSentImage', values: { sent: 3, count: 3 } },
    { batchStopped: { sent: 0, notSent: 3 }, key: 'agentPanelV4.spendBatchNoneSentImage', values: { count: 3 } },
    { batchStopped: undefined, key: null, values: {} },
  ] as const)('宿主回 $batchStopped → $key', async ({ batchStopped, key, values }) => {
    host.discardSpend.mockResolvedValue(OK('discarded', batchStopped ? { batchStopped } : {}))
    const view = mount(ready(offer([shot(1, { offer: 'sent' }), shot(2, { offer: 'handing_over' }), shot(3)])))
    api.discard()
    await view.settle()
    if (key) expect(host.push).toHaveBeenCalledWith({ message: i18n.t(key, values), type: 'info', ttl: 8000, reason: 'spend-batch-stopped' })
    else expect(host.push).not.toHaveBeenCalled()
    expect(host.toast).not.toHaveBeenCalled()
  })

  it('点「取消」时卡已经被别处关了（宿主说没有要收回的）：不弹；别的拒绝照实说', async () => {
    host.discardSpend.mockResolvedValue({ ok: false, code: 'failed', message: 'no pending generation to discard' })
    const view = mount(ready(offer([shot(1), shot(2)])))
    api.discard()
    await view.settle()
    expect(host.toast).not.toHaveBeenCalled()

    const stale: ProductionActionResult = { ok: false, code: 'failed', message: 'generation_quote_changed' }
    host.discardSpend.mockResolvedValue(stale)
    api.discard()
    await view.settle()
    expect(host.toast).toHaveBeenCalledWith(i18n.t(spendActionFailureCopy(stale), { field: '' }), 'error')
  })

  it('正在发出时点「取消」：那一行换成「正在停」，宿主不再推「在交」之后回到常态', () => {
    const view = mount(ready(offer([shot(1, { offer: 'sent' }), shot(2, { offer: 'handing_over' }), shot(3)])))
    api.discard()
    view.flush()
    expect(api.slot?.progress?.hint).toBe(i18n.t('agentPanelV4.spendBatchStopping'))
    view.render(ready(offer([shot(1, { offer: 'sent' }), shot(2, { offer: 'sent' }), shot(3, { offer: 'removed' })])))
    view.flush()
    expect(api.slot?.progress?.hint).not.toBe(i18n.t('agentPanelV4.spendBatchStopping'))
  })
})

describe('完成时各亮一下（SpendCardQ1 card.done）', () => {
  const handing = () => ready(offer([shot(1, { offer: 'handing_over' }), shot(2, { offer: 'sent' }), shot(3, { offer: 'removed' })]))
  it.each([
    { how: '每一镜都定了，宿主收卡', before: () => undefined, next: ready(), flash: ['n1', 'n2'] },
    { how: '用户点了「取消」', before: () => api.discard(), next: ready(), flash: [] },
    { how: '卡换成了另一笔', before: () => undefined, next: ready(offer([shot(1)], { operationId: 'op-2', runId: 'op-2' })), flash: [] },
  ])('$how → 闪 $flash', async ({ before, next, flash }) => {
    const view = mount(handing())
    before()
    await view.settle()
    view.render(next)
    expect(useNodeExternalHighlightStore.getState().flashNodeIds).toEqual(flash)
  })

  // 真 App 走查抓到的那一种：宿主交得快，「在交」那一份投影没推到这边——卡从「等你确认」直接没了。
  // 只看投影的话一下都不闪；按下去的那几镜是这张卡自己交的，照样闪。
  it.each([
    { how: '按了「全部生成」，宿主一下就把卡收了（中间那份「在交」没推到）', result: () => OK('handed_over'), flash: ['n1', 'n2', 'n3'] },
    { how: '按了，宿主说不行（一镜都没交出去），卡之后为别的原因关了', result: (): ProductionActionResult => ({ ok: false, code: 'failed', reason: 'generation_handover_refused' }), flash: [] },
  ])('$how → 闪 $flash', async ({ result, flash }) => {
    host.handOverSpend.mockResolvedValue(result())
    const view = mount(ready(offer([shot(1), shot(2), shot(3)])))
    api.primary()
    await view.settle()
    view.render(ready())
    expect(useNodeExternalHighlightStore.getState().flashNodeIds).toEqual(flash)
  })

  it('按下去之后送宿主那一下抛了：不算交出去，卡关掉也不闪', async () => {
    host.handOverSpend.mockRejectedValue(new Error('ipc down'))
    const view = mount(ready(offer([shot(1), shot(2)])))
    api.primary()
    await view.settle()
    view.render(ready())
    expect(useNodeExternalHighlightStore.getState().flashNodeIds).toEqual([])
  })
})

describe('读不到的卡', () => {
  it.each([
    { reason: 'surface-unavailable' as const, card: undefined },
    { reason: 'projection-failed' as const, card: offer([shot(1), shot(2)], { error: { code: 'pending_spend_projection_empty', message: 'boom' } }) },
  ])('$reason：是一张会说话的缺卡，没有卡体，主按钮交不出任何一镜', ({ reason, card }) => {
    mount({ surface: 'unreadable', reason, ...(card ? { card } : {}) })
    expect(api.slot?.kind).toBe('missing-card')
    expect(api.body).toBeUndefined()
    api.primary()
    expect(host.handOverSpend).not.toHaveBeenCalled()
  })

  it('投影抛了（带着那一次出价的身份推过来）：同样只是缺卡', () => {
    mount(ready(offer([shot(1)], { error: { code: 'pending_spend_projection_failed', message: 'boom' } })))
    expect(api.slot?.kind).toBe('missing-card')
    expect(api.body).toBeUndefined()
    api.primary()
    expect(host.handOverSpend).not.toHaveBeenCalled()
  })
})

it('旧卡账本 nomi:spend-draft:* 一个都不读、不写（卡上没有第二份数据）', async () => {
  const view = mount(ready(offer([shot(1), shot(2)])))
  api.body!.onExclude('s2')
  await view.settle()
  api.primary()
  await view.settle()
  api.discard()
  await view.settle()
  view.render(ready())
  const touched = [...storage.getItem.mock.calls, ...storage.setItem.mock.calls, ...storage.removeItem.mock.calls]
    .map((args) => String(args[0]))
    .filter((key) => key.startsWith('nomi:spend-draft:'))
  expect(touched).toEqual([])
})
