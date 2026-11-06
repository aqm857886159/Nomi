import { beforeEach, describe, expect, it } from 'vitest'
import { reconcileNodeModeWithConnectedReferences } from '../store/canvasAutoReference'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

// 提交咽喉的「生成方式 × 活边参考」对账（2026-07-28 群反馈根治）：真实 store + 真实档案。
// 建边 auto-promote 只覆盖建边一刻；这里回归的是它够不到的坏状态（换模型落回默认 / 存量边）。

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

function currentModeId(nodeId: string): string {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  const archetype = (node?.meta as Record<string, unknown> | undefined)?.archetype
  return archetype && typeof archetype === 'object' ? String((archetype as Record<string, unknown>).modeId ?? '') : ''
}

function forceModeId(nodeId: string, archetypeId: string, modeId: string): void {
  const state = useGenerationCanvasStore.getState()
  const meta = (state.nodes.find((candidate) => candidate.id === nodeId)?.meta || {}) as Record<string, unknown>
  state.updateNode(nodeId, { meta: { ...meta, archetype: { id: archetypeId, modeId } } })
}

function addImageReferenceSource(): string {
  const store = useGenerationCanvasStore.getState()
  const source = store.addNode({ kind: 'asset', title: '参考', prompt: '' })
  useGenerationCanvasStore.getState().updateNode(source.id, {
    result: { id: 'r', type: 'image', url: 'https://cdn/ref.png', createdAt: 0 },
  })
  return source.id
}

describe('reconcileNodeModeWithConnectedReferences', () => {
  beforeEach(resetCanvas)

  it('挂着参考边却停在 t2i（换模型/存量坏状态）→ 促到 edit', () => {
    const sourceId = addImageReferenceSource()
    const target = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '镜头',
      prompt: 'p',
      meta: { modelKey: 'seedream', archetype: { id: 'seedream', modeId: 't2i' } },
    })
    useGenerationCanvasStore.getState().connectNodes(sourceId, target.id, 'reference')
    // 建边 auto-promote 会先切到 edit —— 强制拨回 t2i，模拟换模型落回默认/存量边的坏状态。
    forceModeId(target.id, 'seedream', 't2i')
    expect(currentModeId(target.id)).toBe('t2i')

    reconcileNodeModeWithConnectedReferences(target.id)
    expect(currentModeId(target.id)).toBe('edit')
  })

  it('已在 edit → 不动（幂等）；无参考边的 t2i → 不动（纯文生不受打扰）', () => {
    const sourceId = addImageReferenceSource()
    const connected = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '已正确',
      prompt: 'p',
      meta: { modelKey: 'seedream', archetype: { id: 'seedream', modeId: 'edit' } },
    })
    useGenerationCanvasStore.getState().connectNodes(sourceId, connected.id, 'reference')
    reconcileNodeModeWithConnectedReferences(connected.id)
    expect(currentModeId(connected.id)).toBe('edit')

    const lonely = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      title: '纯文生',
      prompt: 'p',
      meta: { modelKey: 'seedream', archetype: { id: 'seedream', modeId: 't2i' } },
    })
    reconcileNodeModeWithConnectedReferences(lonely.id)
    expect(currentModeId(lonely.id)).toBe('t2i')
  })
})
