// 交给画布之前的本机预检（债 a）：卡上出卡前、交接开同意前读同一个判据。每一条码都对一个画布那一侧已有的判据，
// 这里逐条钉住「哪种节点 → 哪个码」，外加同批上下游（上游还没出图）不许被提前拦下的反例。
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { DIRECTOR_NODE_KIND, DIRECTOR_PREVIEW_META_KEY } from '../generationCanvas/nodes/director/model/directorNodeMeta'
import { handOverPrecheck } from './handOverPrecheck'

const SEEDANCE = 'seedance-2-apimart'

function video(id: string, modeId: string, meta: Record<string, unknown> = {}, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id, kind: 'video', title: id, position: { x: 0, y: 0 }, prompt: '纸船顺着水沟漂走',
    meta: { modelVendor: 'apimart', modelKey: 'doubao-seedance-2.0', archetype: { id: SEEDANCE, modeId }, ...meta },
    ...extra,
  } as GenerationCanvasNode
}

function image(id: string, extra: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: '一只纸船',
    meta: { modelVendor: 'apimart', modelKey: 'gpt-image-2', archetype: { id: 'gpt-image-2', modeId: 't2i' } },
    ...extra,
  } as GenerationCanvasNode
}

const edge = (source: string, target: string, mode = 'reference'): GenerationCanvasEdge => ({ id: `${source}->${target}`, source, target, mode } as GenerationCanvasEdge)
const codes = (nodeIds: string[], nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[] = []) =>
  Object.fromEntries([...handOverPrecheck(nodeIds, { nodes, edges })].map(([nodeId, failure]) => [nodeId, `${failure.kind}:${failure.code}`]))

describe('handOverPrecheck：节点自己的那几条', () => {
  it('齐了的镜不报（文生视频有提示词、选了模型）', () => {
    expect(codes(['v1'], [video('v1', 't2v')])).toEqual({})
  })

  it('节点不在了 → 没发出去（canvas_node_missing）', () => {
    expect(codes(['gone'], [])).toEqual({ gone: 'not_sent:canvas_node_missing' })
  })

  it('同节点还有一笔在路上 / 结果没核对 → 没发出去（再交就是重复花钱）', () => {
    expect(codes(['a', 'b', 'c'], [
      video('a', 't2v', {}, { status: 'running' }),
      video('b', 't2v', {}, { status: 'queued' }),
      video('c', 't2v', {}, { status: 'recoverable' }),
    ])).toEqual({ a: 'not_sent:node_generation_in_flight', b: 'not_sent:node_generation_in_flight', c: 'not_sent:node_needs_reconcile' })
  })

  it('没选模型 → 参数被拒（去改镜 N）', () => {
    expect(codes(['v1'], [video('v1', 't2v', { modelVendor: undefined, modelKey: undefined })])).toEqual({ v1: 'parameter_rejected:model_not_selected' })
  })

  it('本机模型（ComfyUI）不进单镜 Run → 卡交不出去', () => {
    expect(codes(['v1'], [video('v1', 't2v', { modelVendor: 'comfyui-local', modelKey: 'h3-t2v', archetype: undefined })])).toEqual({ v1: 'parameter_rejected:local_model_on_card' })
  })

  it('3D-BOX 预演还在渲染 → 参数被拒（与生成钮置灰同一个判据）', () => {
    const director = {
      id: 'd1', kind: DIRECTOR_NODE_KIND, title: 'd', position: { x: 0, y: 0 }, prompt: '',
      meta: { [DIRECTOR_PREVIEW_META_KEY]: { status: 'rendering', revision: 'r1', targetNodeId: 'v1', updatedAt: 1 } },
    } as unknown as GenerationCanvasNode
    expect(codes(['v1'], [video('v1', 't2v'), director])).toEqual({ v1: 'parameter_rejected:director_preview_blocked' })
  })

  // 方式按输入现算（2026-11-12）：存着图生视频、却没放图 → 这次按文字生成，不拦（设计卡 ★9 ②）；
  // 只放一段参考音频，哪种方式都收不下（音频要搭图或视频）→ 照旧拦。
  it('存着图生视频但没放图 → 按文字生成、不拦；只放一段参考音频 → reference_combination_invalid', () => {
    expect(codes(['a', 'b'], [
      video('a', 'i2v'),
      video('b', 'omni', { referenceAudioUrls: ['nomi-local://asset/p/a.mp3'] }),
    ])).toEqual({ b: 'parameter_rejected:reference_combination_invalid' })
  })

  it('提示词空着、这个方式要提示词 → prompt_required', () => {
    expect(codes(['v1'], [video('v1', 't2v', {}, { prompt: '  ' })])).toEqual({ v1: 'parameter_rejected:prompt_required' })
  })
})

describe('handOverPrecheck：依赖波次（画布批量同一份）', () => {
  it('同批上游还没出图：下游不提前拦（轮到它那一波参考才齐）——反例：只按节点自己判会把它报成缺参考', () => {
    const keyframe = image('k1')
    const shot = video('v1', 'i2v')
    expect(codes(['k1', 'v1'], [keyframe, shot], [edge('k1', 'v1')])).toEqual({})
    // 同一张图、上游不在这一批：参考此刻确实不齐，照节点自己判。
    expect(codes(['v1'], [keyframe, shot], [edge('k1', 'v1')])).toEqual({ v1: 'parameter_rejected:upstream_not_ready' })
  })

  it('同批上游自己没过（没选模型）：它的下游按「上游没好」拦，不是缺参考', () => {
    const keyframe = image('k1', { meta: { archetype: { id: 'gpt-image-2', modeId: 't2i' } } })
    expect(codes(['k1', 'v1'], [keyframe, video('v1', 'i2v')], [edge('k1', 'v1')])).toEqual({
      k1: 'parameter_rejected:model_not_selected',
      v1: 'parameter_rejected:upstream_not_ready',
    })
  })

  it('引用了还没定妆的参考卡 → anchor_not_frozen；成环 → reference_cycle', () => {
    const anchor = {
      id: 'c1', kind: 'character', title: '小女孩', position: { x: 0, y: 0 }, prompt: '',
      meta: { referenceSheet: true }, result: { id: 'r', url: 'nomi-local://asset/p/girl.png' },
    } as unknown as GenerationCanvasNode
    expect(codes(['v1'], [anchor, video('v1', 'i2v')], [edge('c1', 'v1')])).toEqual({ v1: 'parameter_rejected:anchor_not_frozen' })
    expect(codes(['a', 'b'], [video('a', 'i2v'), video('b', 'i2v')], [edge('a', 'b'), edge('b', 'a')])).toEqual({
      a: 'parameter_rejected:reference_cycle',
      b: 'parameter_rejected:reference_cycle',
    })
  })

  it('批外上游已经出了图：满足，不拦', () => {
    const keyframe = image('k1', { result: { id: 'r', url: 'nomi-local://asset/p/boat.png' } as GenerationCanvasNode['result'] })
    expect(codes(['v1'], [keyframe, video('v1', 'i2v')], [edge('k1', 'v1')])).toEqual({})
  })
})
