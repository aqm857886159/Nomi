import { beforeEach, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ModelOption } from '../../../config/models'
import { useNodeModelAutoSelect } from './useNodeModelAutoSelect'

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
vi.mock('../store/generationCanvasStore', () => ({ useGenerationCanvasStore: { getState: () => ({ nodes: mocks.nodes, edges: [] }) } }))
vi.mock('../../../ui/toast', () => ({ useToastStore: { getState: () => ({ push: mocks.push }) } }))
vi.mock('../model/generationModelDefaults', () => ({
  generationModelDefaultsLoaded: () => false, getGenerationModelDefaults: () => ({}),
  loadGenerationModelDefaults: async () => {}, subscribeGenerationModelDefaults: () => () => {},
}))

beforeEach(() => { mocks.effects = []; mocks.push.mockReset() })
it('401 preserves the chosen vendor and offers a switch that requires a click', () => {
  const node = { id: 'image', kind: 'image', title: 'Image', position: { x: 0, y: 0 }, status: 'error', error: '401 Unauthorized — invalid api key',
    meta: { modelKey: 'gpt-image-2', modelAlias: 'gpt-image-2', modelVendor: 'apimart', vendor: 'apimart' },
  } as GenerationCanvasNode
  mocks.nodes = [node]
  const current = { value: 'gpt-image-2', modelKey: 'gpt-image-2', vendor: 'apimart', label: 'GPT Image 2' } as ModelOption
  const alternative = { ...current, vendor: 'code-newcli-com', vendorName: '我的中转', label: 'GPT Image 2' }
  const updateNode = vi.fn()
  useNodeModelAutoSelect({ node, modelOptions: [current, alternative], selectedModelValue: 'gpt-image-2',
    selectedModelOption: current, archetype: null, isGenerationNode: true, isImageLike: true, isVideoLike: false, updateNode })
  for (const effect of mocks.effects) effect()
  expect(updateNode).not.toHaveBeenCalled()
  expect(node.meta?.modelVendor).toBe('apimart')
  expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ actionLabel: expect.stringContaining('我的中转'), onAction: expect.any(Function) }))
  expect(mocks.push.mock.calls[0][0].actionLabel).toContain('GPT Image 2')
  expect(mocks.push.mock.calls[0][0].actionLabel).not.toContain('code-newcli-com')
  mocks.push.mock.calls[0][0].onAction()
  expect(updateNode).toHaveBeenCalledWith('image', expect.objectContaining({ meta: expect.objectContaining({ modelVendor: 'code-newcli-com' }) }))
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
  }))
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
