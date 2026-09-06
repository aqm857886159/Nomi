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
}))

const { useGenerationModelOptions, useGenerationModelOptionsState } = await import('./modelOptionsAdapter')

describe('generation model option production adapter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards the current execution mode through both production picker hooks', () => {
    useGenerationModelOptions('image', 'image_edit')
    useGenerationModelOptionsState('video', 'image_to_video')

    // 只有 (kind, requiredMode) 两个参数。没有第三个「取景」参数是这条的**要点**：
    // 「哪些家看得见」不是调用方能商量的事，2026-09-06 拍板后它只由 catalog 那一道闸决定。
    expect(mocks.useModelOptions).toHaveBeenCalledWith('imageEdit', 'image_edit')
    expect(mocks.useModelOptionsState).toHaveBeenCalledWith('video', 'image_to_video')
  })

  it('keeps the live node and batch picker call sites wired to the required mode', () => {
    const configHook = fs.readFileSync(new URL('../../../config/useModelOptions.ts', import.meta.url), 'utf8')
    const nodePicker = fs.readFileSync(new URL('../nodes/NodeParameterControls.tsx', import.meta.url), 'utf8')
    const batchPicker = fs.readFileSync(new URL('../components/CanvasBulkModelSelect.tsx', import.meta.url), 'utf8')

    expect(configHook).toContain('preloadModelOptions(kind, requiredMode)')
    expect(nodePicker).toContain('useGenerationModelOptionsState(node.kind, requiredMode)')
    expect(batchPicker).toContain('useGenerationModelOptionsState(group.representativeKind, group.requiredMode)')
  })
})
