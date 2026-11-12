import { beforeEach, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ModelOption } from '../../../config/models'
import { tagNomiError } from '../../../../electron/shared/nomiErrorCodes'
import { useNodeModelAutoSelect } from './useNodeModelAutoSelect'
import { nodeRecoveryToastId } from './nodeRecoveryNotice'
import { resolveArchetypeForOption } from './nodeModelArchetype'
import { effectiveArchetypeMode } from './controls/archetypeMeta'

const mocks = vi.hoisted(() => ({ effects: [] as Array<() => unknown>, push: vi.fn(), nodes: [] as GenerationCanvasNode[] }))
vi.mock('react', () => ({ default: {
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: () => false,
  useEffect: (effect: () => unknown) => { mocks.effects.push(effect) },
} }))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string, values: unknown) => key + JSON.stringify(values) }),
}))
vi.mock('../store/generationCanvasStore', () => ({
  useGenerationCanvasStore: { getState: () => ({ nodes: mocks.nodes, edges: [] }), subscribe: () => () => {} },
}))
vi.mock('../../../ui/toast', () => ({ useToastStore: { getState: () => ({ push: mocks.push }) } }))
vi.mock('../model/generationModelDefaults', () => ({
  generationModelDefaultsLoaded: () => false, getGenerationModelDefaults: () => ({}),
  loadGenerationModelDefaults: async () => {}, subscribeGenerationModelDefaults: () => () => {},
}))

beforeEach(() => { mocks.effects = []; mocks.push.mockReset() })

const current = { value: 'gpt-image-2', modelKey: 'gpt-image-2', vendor: 'apimart', label: 'GPT Image 2' } as ModelOption
const alternative = { ...current, vendor: 'code-newcli-com', vendorName: '我的中转', label: 'GPT Image 2' } as ModelOption
const ATTEMPT = { vendorKey: 'apimart', modelKey: 'gpt-image-2' }

/** 一张真实的失败卡：失败原文 + 运行记录上的「发给谁」（runGenerationNode 提交那一刻写的）。 */
const failedCard = (overrides: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode => ({
  id: 'image', kind: 'image', title: 'Image', position: { x: 0, y: 0 }, status: 'error', error: '401 Unauthorized — invalid api key',
  meta: { modelKey: 'gpt-image-2', modelAlias: 'gpt-image-2', modelVendor: 'apimart', vendor: 'apimart' },
  runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, attempt: ATTEMPT, error: '401 Unauthorized — invalid api key' }],
  ...overrides,
} as GenerationCanvasNode)

// 测试直接驱动这个 hook（React 原语已被 mock 成同步桩，见文件顶部）。别名不以 use 开头，rules-of-hooks 才不会把
// 「在 mount 这个普通函数里调用」当成组件外调用——基线里各条用例是在 it 回调里直接调它的，这里抽成一个 mount 助手。
const driveHook = useNodeModelAutoSelect

function mount(node: GenerationCanvasNode, options: { selectedModelOption?: ModelOption | null; modelOptions?: ModelOption[] } = {}) {
  mocks.nodes = [node]
  const updateNode = vi.fn()
  driveHook({
    node,
    modelOptions: options.modelOptions ?? [current, alternative],
    selectedModelValue: 'gpt-image-2',
    selectedModelOption: options.selectedModelOption === undefined ? current : options.selectedModelOption,
    archetype: null, isGenerationNode: true, isImageLike: true, isVideoLike: false, updateNode,
  })
  for (const effect of mocks.effects) effect()
  return updateNode
}

it('401 names the vendor that failed and offers a switch that requires a click', () => {
  const node = failedCard()
  const updateNode = mount(node)
  expect(updateNode).not.toHaveBeenCalled()
  expect(node.meta?.modelVendor).toBe('apimart')
  expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ actionLabel: expect.stringContaining('我的中转'), onAction: expect.any(Function) }))
  const pushed = mocks.push.mock.calls[0][0]
  expect(pushed.message).toContain('"vendor":"apimart"') // 点名失败的那一家
  expect(pushed.actionLabel).toContain('GPT Image 2')
  expect(pushed.actionLabel).not.toContain('code-newcli-com')
  pushed.onAction()
  expect(updateNode).toHaveBeenCalledWith('image', expect.objectContaining({ meta: expect.objectContaining({ modelVendor: 'code-newcli-com' }) }))
})

it('one notice per card, identified by the failure it describes — re-running the effects announces the same event', () => {
  const node = failedCard()
  mount(node)
  const second = mount(node)
  void second
  expect(mocks.push.mock.calls.length).toBeGreaterThanOrEqual(2)
  const ids = new Set(mocks.push.mock.calls.map(([input]) => input.id))
  const occurrences = new Set(mocks.push.mock.calls.map(([input]) => input.occurrence))
  expect([...ids]).toEqual([nodeRecoveryToastId('image')])
  expect([...occurrences]).toEqual(['run-1@10'])
})

// 红（旧代码按「现在选着谁」点名）：用户点了「切到另一家」以后旧失败还挂在节点上，
// 提示把这次失败算到新选的那家头上，还劝他切回失败的那家。
it('after the user switched vendors the old failure is not blamed on the new vendor: no notice at all', () => {
  const switched = failedCard({ meta: { modelKey: 'gpt-image-2', modelAlias: 'gpt-image-2', modelVendor: 'code-newcli-com', vendor: 'code-newcli-com' } })
  mount(switched, { selectedModelOption: alternative })
  expect(mocks.push).not.toHaveBeenCalled()
})

it('a failure record that does not say who was dispatched to (legacy run) is not attributed to the current vendor', () => {
  mount(failedCard({ runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, error: 'x' }] }))
  expect(mocks.push).not.toHaveBeenCalled()
})

it('a failure the catalog says is on our side (result arrived but could not be read) does not push the user toward another vendor', () => {
  const error = tagNomiError('output-unreadable', 'Generated media validation failed (decode_failed)')
  mount(failedCard({ error, runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, attempt: ATTEMPT, error }] }))
  expect(mocks.push).not.toHaveBeenCalled()
})

it('a local guard that fired before the request left (the pair was only where it was going) names nobody', () => {
  const error = '请先写点提示词再生成。'
  mount(failedCard({ error, runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, attempt: ATTEMPT, error }] }))
  expect(mocks.push).not.toHaveBeenCalled()
})

it('a vendor-side failure in a shape the catalog has no dedicated class for still names the failed vendor', () => {
  const payload = Buffer.from(JSON.stringify({ vendorKey: 'apimart', httpStatus: 404, category: 'unknown', upstreamMsg: 'Unexpected upstream condition while rendering the frame sequence.' }), 'utf8').toString('base64')
  const error = `NOMI_VENDOR_ERR_B64::${payload}:: Provider request failed (HTTP 404)`
  mount(failedCard({ error, runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, attempt: ATTEMPT, error }] }))
  expect(mocks.push).toHaveBeenCalledTimes(1)
  expect(mocks.push.mock.calls[0][0].message).toContain('"vendor":"apimart"')
})

// 红（旧代码把供应商 key 塞进提示）：真用户看到的是 `apimart` 这样的内部 id，而「模型接入」里他认得的是 APIMart。
it('the failure notice names the vendor by the display name the model options carry, not by its key', () => {
  const named = { ...current, vendorName: 'APIMart' } as ModelOption
  mount(failedCard(), { modelOptions: [named, alternative], selectedModelOption: named })
  expect(mocks.push).toHaveBeenCalledTimes(1)
  const message: string = mocks.push.mock.calls[0][0].message
  const values = JSON.parse(message.slice(message.indexOf('{'))) as { vendor: string }
  expect(values.vendor).toBe('APIMart')
})

it('a vendor whose options carry no display name is named by its key (the only handle the user has)', () => {
  mount(failedCard())
  const message: string = mocks.push.mock.calls[0][0].message
  expect(JSON.parse(message.slice(message.indexOf('{'))).vendor).toBe('apimart')
})

it('the disconnection notice names the pinned vendor by display name too, when the options still know it', () => {
  const pinned = { ...current, vendorName: 'APIMart', value: 'other-model', modelKey: 'other-model' } as ModelOption
  const node = failedCard({ status: 'idle', error: undefined, runs: [] })
  mount(node, { selectedModelOption: null, modelOptions: [pinned, alternative] })
  const message: string = mocks.push.mock.calls[0][0].message
  expect(message).toContain('providerDisconnected')
  expect(JSON.parse(message.slice(message.indexOf('{'))).vendor).toBe('APIMart')
})

// 红（旧代码把原因原样塞进模板）：供应商的话是界面语言、还带着句号时，模板再补一个句号，
// 屏上就是「…the third checkpoint.. Nomi could not…」（2026-09-30 pb07 英文截图）。
it('a vendor sentence that already ends with a full stop is not followed by a second one in the notice', () => {
  const payload = Buffer.from(JSON.stringify({ vendorKey: 'apimart', httpStatus: 418, category: 'unknown', upstreamMsg: '当前模型排队人数过多，请等一会儿再来。' }), 'utf8').toString('base64')
  const error = `NOMI_VENDOR_ERR_B64::${payload}:: Provider request failed (HTTP 418)`
  mount(failedCard({ error, runs: [{ id: 'run-1', status: 'error', startedAt: 1, updatedAt: 10, attempt: ATTEMPT, error }] }))
  expect(mocks.push).toHaveBeenCalledTimes(1)
  const message: string = mocks.push.mock.calls[0][0].message
  const values = JSON.parse(message.slice(message.indexOf('{'))) as { reason: string }
  expect(values.reason).toBe('当前模型排队人数过多，请等一会儿再来')
})

it('the notice carries its own premise: it stops holding as soon as the card leaves this failure', () => {
  const node = failedCard()
  mount(node)
  const { validWhile } = mocks.push.mock.calls[0][0]
  expect(validWhile.isValid()).toBe(true)
  mocks.nodes = [{ ...node, status: 'running', error: undefined } as GenerationCanvasNode]
  expect(validWhile.isValid()).toBe(false)
  mocks.nodes = [{ ...node, status: 'success', error: undefined } as GenerationCanvasNode]
  expect(validWhile.isValid()).toBe(false)
  mocks.nodes = [{ ...node, meta: { ...node.meta, modelVendor: 'code-newcli-com' } } as GenerationCanvasNode]
  expect(validWhile.isValid()).toBe(false)
  mocks.nodes = []
  expect(validWhile.isValid()).toBe(false)
})

it('a pinned model that left the picker (no failure) names the vendor the card is pinned to, and stops holding when it comes back', () => {
  const node = failedCard({ status: 'idle', error: undefined, runs: [] })
  mount(node, { selectedModelOption: null, modelOptions: [alternative] })
  expect(mocks.push).toHaveBeenCalledTimes(1)
  const pushed = mocks.push.mock.calls[0][0]
  expect(pushed.message).toContain('providerDisconnected')
  expect(pushed.message).toContain('"vendor":"apimart"')
  expect(pushed.occurrence).toBe('disconnected:apimart:gpt-image-2')
  expect(pushed.validWhile.isValid()).toBe(true)
})

// 2026-09-10 真机 bug 的类根因回归：agent 草稿落下的节点被「自动选默认模型」这条自愈 effect
// 静默改写 → 用户看到的模型和 agent 说的不是一个。带候选来源戳的节点必须**保留 agent 的意图**，
// 并把缺口明着告诉用户（D4 诚实交付），而不是替他挑一个。
it('候选戳在、候选模型解析不出来 → 不写节点，改成可见提示', () => {
  const node = { id: 'draft-shot', kind: 'image', title: '镜头 1', position: { x: 0, y: 0 },
    meta: {
      productionCandidateId: 'cand-1',
      productionCandidateModelKey: 'gpt-image-2',
      productionCandidateModelVendor: 'apimart',
    },
  } as unknown as GenerationCanvasNode
  mocks.nodes = [node]
  const updateNode = vi.fn()
  const fallback = { value: 'some-other-model', modelKey: 'some-other-model', vendor: 'other', label: 'Other' } as ModelOption
  useNodeModelAutoSelect({ node, modelOptions: [fallback], selectedModelValue: '', selectedModelOption: null,
    archetype: null, isGenerationNode: true, isImageLike: true, isVideoLike: false, updateNode })
  for (const effect of mocks.effects) effect()
  expect(updateNode).not.toHaveBeenCalled()
  expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({
    type: 'warning',
    message: expect.stringContaining('candidateModelUnavailable'),
    id: nodeRecoveryToastId('draft-shot'),
  }))
  // 用户给这张卡选了模型 → 这个缺口不再存在，所有者撤回它。
  const { validWhile } = mocks.push.mock.calls[0][0]
  expect(validWhile.isValid()).toBe(true)
  mocks.nodes = [{ ...node, meta: { ...node.meta, modelKey: 'gpt-image-2', modelVendor: 'apimart' } } as GenerationCanvasNode]
  expect(validWhile.isValid()).toBe(false)
})

it('没有候选戳（用户自己建的卡）→ 自动挑默认的老行为不变', () => {
  const node = { id: 'user-card', kind: 'image', title: '卡', position: { x: 0, y: 0 }, meta: {} } as GenerationCanvasNode
  mocks.nodes = [node]
  const updateNode = vi.fn()
  const fallback = { value: 'some-model', modelKey: 'some-model', vendor: 'other', label: 'Other' } as ModelOption
  useNodeModelAutoSelect({ node, modelOptions: [fallback], selectedModelValue: '', selectedModelOption: null,
    archetype: null, isGenerationNode: true, isImageLike: true, isVideoLike: false, updateNode })
  for (const effect of mocks.effects) effect()
  // 偏好还没装好（mock 的 useSyncExternalStore 恒 false）→ 这一步本来就该什么都不做，
  // 关键是**没有**弹「候选模型不可用」的提示（那条只属于 agent 草稿的卡）。
  expect(mocks.push).not.toHaveBeenCalled()
})

// 方式按输入现算（2026-11-12）：初始化只落档案 + 默认偏好，不替卡挑方式；带着参考出生的卡，参考本身就是输入。
it('a card born with reference images sends in the mode that takes them; a card without references sends as text', () => {
  const archetype = resolveArchetypeForOption(current)
  const sendMode = (meta: Record<string, unknown>) => {
    const node = { id: 'card', kind: 'image', title: 'Image', position: { x: 0, y: 0 }, meta } as GenerationCanvasNode
    mocks.nodes = [node]
    mocks.effects = []
    const updateNode = vi.fn()
    driveHook({ node, modelOptions: [current], selectedModelValue: 'gpt-image-2', selectedModelOption: current,
      archetype, isGenerationNode: true, isImageLike: true, isVideoLike: false, updateNode })
    for (const effect of mocks.effects) effect()
    const written = updateNode.mock.calls.reduce((acc, [, patch]) => ({ ...acc, ...(patch.meta ?? {}) }), meta)
    const after = { ...node, meta: written }
    return effectiveArchetypeMode(archetype!, after, { nodes: [after], edges: [] }).mode.id
  }
  const identity = { modelKey: 'gpt-image-2', modelAlias: 'gpt-image-2', modelVendor: 'apimart', vendor: 'apimart' }
  // 提示词库「放上画布」：卡出生就带着参考图 → 按收图的「改图」发，不是看不见参考的文生图
  expect(sendMode({ ...identity, referenceImageUrls: ['data:image/png;base64,AA'] })).toBe('i2i')
  // 没带参考的新卡按文字生成
  expect(sendMode({ ...identity })).toBe('t2i')
})
