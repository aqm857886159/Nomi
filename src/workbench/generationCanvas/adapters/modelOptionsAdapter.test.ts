import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useModelOptions: vi.fn(() => []),
  useModelOptionsState: vi.fn(() => ({ options: [], error: null, healthError: null, loading: false, health: null })),
}))

vi.mock('../../../config/useModelOptions', () => ({
  getModelOptionRequestAlias: vi.fn(),
  deriveModelCatalogStatus: vi.fn(),
  findModelOptionByIdentifier: vi.fn(),
  useModelOptions: mocks.useModelOptions,
  useModelOptionsState: mocks.useModelOptionsState,
  MODEL_PICKER_CATALOG_SCOPE: { includeUnconfigured: true },
}))

const { useGenerationModelOptions, useGenerationModelOptionsState } = await import('./modelOptionsAdapter')

describe('generation model option production adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards the current execution mode through both production picker hooks', () => {
    useGenerationModelOptions('image', 'image_edit')
    useGenerationModelOptionsState('video', 'image_to_video')

    // 第三个参数是 catalog 取景（缺省 = 只要能跑的那一份）。它必须**原样透传**：
    // 适配层自己替调用方决定取景，就等于把「谁能看见没配 key 的家」藏进了一个中间层。
    expect(mocks.useModelOptions).toHaveBeenCalledWith('imageEdit', 'image_edit', undefined)
    expect(mocks.useModelOptionsState).toHaveBeenCalledWith('video', 'image_to_video', undefined)
  })

  it('passes an explicit catalog scope straight through, without inventing one', () => {
    const scope = { includeUnconfigured: true }
    useGenerationModelOptionsState('image', 'text_to_image', scope)
    expect(mocks.useModelOptionsState).toHaveBeenCalledWith('image', 'text_to_image', scope)
  })

  it('keeps the live node and batch picker call sites wired to the required mode', () => {
    const configHook = fs.readFileSync(new URL('../../../config/useModelOptions.ts', import.meta.url), 'utf8')
    const nodePicker = fs.readFileSync(new URL('../nodes/NodeParameterControls.tsx', import.meta.url), 'utf8')
    const batchPicker = fs.readFileSync(new URL('../components/CanvasBulkModelSelect.tsx', import.meta.url), 'utf8')

    expect(configHook).toContain('preloadModelOptions(kind, requiredMode, { includeUnconfigured })')
    // 这两处除了 requiredMode，还必须显式声明「连没配 key 的家也要」——它们是把未配置的家
    // 灰显出来、点了跳接入的选择器。漏了声明，未配置分组会静默消失（看起来"没 bug"）；
    // 反过来别处偷偷加上，agent 可用模型清单就会拿到没钥匙的家（见 modelSelectStructure.test.ts）。
    expect(nodePicker).toContain('useGenerationModelOptionsState(node.kind, requiredMode, MODEL_PICKER_CATALOG_SCOPE)')
    expect(batchPicker).toContain('useGenerationModelOptionsState(group.representativeKind, group.requiredMode, MODEL_PICKER_CATALOG_SCOPE)')
  })
})
