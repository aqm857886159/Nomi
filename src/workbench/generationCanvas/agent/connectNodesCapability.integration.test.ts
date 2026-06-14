import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAgentModelEntries } from './availableModels'
import type { ModelOption } from '../../../config/models'

// 集成测试：走 agent 真实工具链路 applyCanvasToolCall → buildPlannedNodeMeta(真实档案)
// → create_nodes → connect_nodes → validateReferenceEdge(从 node.meta 真实解析 archetype)
// → 真实 store。只把 LLM(本测试不调)和 listAvailableModelsForAgent 的 IPC 换成桩——
// 桩返回的是 buildAgentModelEntries 跑真实 archetype 数据的结果，不是手编假数据。
//
// 这条链路是「参考边盲连」根因所在(T8)，纯函数单测绕过了它，故单独锁。
const REAL_OPTIONS: ModelOption[] = [
  { value: 'imagen-4', label: 'Imagen 4', modelKey: 'imagen-4', meta: { archetypeId: 'imagen-4' } }, // 纯文生，无参考槽
  { value: 'seedream', label: 'Seedream', modelKey: 'seedream', meta: { archetypeId: 'seedream' } }, // t2i(无槽)+edit(image_ref)
  { value: 'seedance-2', label: 'Seedance 2', modelKey: 'seedance-2', meta: { archetypeId: 'seedance-2' } }, // 视频 omni image_ref/video_ref
]

vi.mock('./availableModels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./availableModels')>()
  return {
    ...actual,
    // 桩掉 IPC，返回真实档案 join 出的 entries
    listAvailableModelsForAgent: vi.fn(async () => actual.buildAgentModelEntries(REAL_OPTIONS)),
  }
})

import { applyCanvasToolCall } from './applyCanvasToolCall'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'

// sanity：确认桩数据里真实档案如预期（imagen-4 无槽、seedream 有 image_ref、seedance omni 有 image_ref）
const ENTRIES = buildAgentModelEntries(REAL_OPTIONS)

function resetCanvas() {
  const state = useGenerationCanvasStore.getState()
  for (const node of [...state.nodes]) state.deleteNode(node.id)
}

type CreateResult = {
  createdNodeIds: string[]
  clientIdToNodeId: Record<string, string>
  connectedCount?: number
  skippedEdges?: Array<{ source: string; target: string; reason: string }>
}

describe('T8 集成：connect_nodes 按目标模型能力校验参考边（真实 store + 真实档案）', () => {
  beforeEach(resetCanvas)

  it('夹具自检：真实档案的参考槽如预期', () => {
    const imagen = ENTRIES.find((e) => e.modelKey === 'imagen-4')!
    expect(imagen.modes.every((m) => m.slots.length === 0)).toBe(true)
    const seedream = ENTRIES.find((e) => e.modelKey === 'seedream')!
    expect(seedream.modes.some((m) => m.slots.some((s) => s.kind === 'image_ref'))).toBe(true)
  })

  it('① 文本节点→图片节点：拒(source_not_referenceable)，不入 store', async () => {
    const result = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 't1', kind: 'text', title: '故事稿', prompt: '一个雨夜的故事' },
        { clientId: 'i1', kind: 'image', title: '镜头1', prompt: '雨夜', modelKey: 'seedream' },
      ],
      edges: [{ sourceClientId: 't1', targetClientId: 'i1', mode: 'reference' }],
    })) as CreateResult
    expect(result.connectedCount ?? 0).toBe(0)
    expect(result.skippedEdges?.[0]?.reason).toBe('source_not_referenceable')
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)
  })

  it('② character_ref→纯文生模型(imagen-4)：拒(unsupported_reference)，不入 store', async () => {
    const result = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'c1', kind: 'character', title: '男主', prompt: '黑发少年' },
        { clientId: 'k1', kind: 'image', title: '关键帧', prompt: '少年站在雨中', modelKey: 'imagen-4' },
      ],
      edges: [{ sourceClientId: 'c1', targetClientId: 'k1', mode: 'character_ref' }],
    })) as CreateResult
    expect(result.connectedCount ?? 0).toBe(0)
    expect(result.skippedEdges?.[0]?.reason).toBe('unsupported_reference')
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)
  })

  it('character_ref→有图片参考槽的模型(seedream，默认 t2i 但 union 含 edit 的 image_ref)：放行', async () => {
    const result = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'c2', kind: 'character', title: '女主', prompt: '红衣少女' },
        { clientId: 'k2', kind: 'image', title: '关键帧', prompt: '少女撑伞', modelKey: 'seedream' },
      ],
      edges: [{ sourceClientId: 'c2', targetClientId: 'k2', mode: 'character_ref' }],
    })) as CreateResult
    expect(result.connectedCount).toBe(1)
    expect(result.skippedEdges ?? []).toHaveLength(0)
    expect(useGenerationCanvasStore.getState().edges[0]?.mode).toBe('character_ref')
  })

  it('手动连线(connectToNode)同样按能力校验——文本→图片拒、图片→视频首帧放行(不只补 agent 入口)', () => {
    const store = useGenerationCanvasStore.getState()
    // 文本→图片:源不可参考 → 拒,不落边。
    const text = store.addNode({ kind: 'text', title: '稿', prompt: '雨夜' })
    const img = store.addNode({ kind: 'image', title: '镜头', prompt: '雨', meta: { archetypeId: 'seedream' } })
    store.startConnection(text.id)
    const bad = useGenerationCanvasStore.getState().connectToNode(img.id)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe('source_not_referenceable')
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(0)

    // 图片→视频:seedance 有首帧槽 → 放行,落边。
    const vid = store.addNode({ kind: 'video', title: '视频', prompt: 'p', meta: { archetypeId: 'seedance-2' } })
    store.startConnection(img.id)
    const good = useGenerationCanvasStore.getState().connectToNode(vid.id)
    expect(good.ok).toBe(true)
    expect(useGenerationCanvasStore.getState().edges).toHaveLength(1)
  })

  it('混合一批：好边连、坏边拒——一次 create 里分流正确', async () => {
    const result = (await applyCanvasToolCall('create_canvas_nodes', {
      nodes: [
        { clientId: 'x_char', kind: 'character', title: '角色', prompt: 'p' },
        { clientId: 'x_kf', kind: 'keyframe', title: '关键帧', prompt: 'p', modelKey: 'seedream' },
        { clientId: 'x_vid', kind: 'video', title: '视频', prompt: 'p', modelKey: 'seedance-2' },
        { clientId: 'x_txt', kind: 'text', title: '笔记', prompt: 'p' },
      ],
      edges: [
        { sourceClientId: 'x_char', targetClientId: 'x_kf', mode: 'character_ref' }, // 好：seedream 有 image_ref
        { sourceClientId: 'x_kf', targetClientId: 'x_vid', mode: 'first_frame' }, // 好：seedance 有首帧槽
        { sourceClientId: 'x_txt', targetClientId: 'x_vid', mode: 'reference' }, // 坏：文本源
      ],
    })) as CreateResult
    expect(result.connectedCount).toBe(2)
    expect(result.skippedEdges).toHaveLength(1)
    expect(result.skippedEdges?.[0]?.reason).toBe('source_not_referenceable')
    const modes = useGenerationCanvasStore.getState().edges.map((e) => e.mode).sort()
    expect(modes).toEqual(['character_ref', 'first_frame'])
  })
})
