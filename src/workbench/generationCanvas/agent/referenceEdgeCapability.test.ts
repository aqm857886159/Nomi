import { describe, expect, it } from 'vitest'
import { referenceAssetKindForNode, validateReferenceEdge, partitionConnectableEdges } from './referenceEdgeCapability'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// archetypeId 显式命中内置档案(resolveArchetypeForModel/getArchetypeById 优先看它):
//   imagen-4   = 纯文生(所有模式 slots:[])——不吃任何参考
//   seedream   = t2i(slots:[]) + edit(image_ref)——union 有图片参考槽
//   seedance-2 = 视频,omni 有 image_ref/video_ref/audio_ref + first/firstlast 帧槽
function node(id: string, kind: string, archetypeId?: string): GenerationCanvasNode {
  return {
    id,
    kind: kind as GenerationCanvasNode['kind'],
    title: id,
    prompt: '',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...(archetypeId ? { meta: { archetype: { id: archetypeId, modeId: '' } } } : {}),
  } as GenerationCanvasNode
}

describe('referenceAssetKindForNode — 源能给哪种可参考资产', () => {
  it('图片类节点(character/scene/image/keyframe/asset)→ image', () => {
    for (const kind of ['character', 'scene', 'image', 'keyframe', 'asset', 'panorama']) {
      expect(referenceAssetKindForNode(node('n', kind))).toBe('image')
    }
  })
  it('视频节点 → video', () => {
    expect(referenceAssetKindForNode(node('n', 'video'))).toBe('video')
  })
  it('文本/镜头/输出节点 → null(无可参考产物)', () => {
    for (const kind of ['text', 'shot', 'output']) {
      expect(referenceAssetKindForNode(node('n', kind))).toBeNull()
    }
  })
})

describe('validateReferenceEdge — 参考边能力校验', () => {
  it('① 文本节点作参考源 → 拒(source_not_referenceable)', () => {
    const verdict = validateReferenceEdge(node('t', 'text'), node('i', 'image', 'seedream'), 'reference')
    expect(verdict).toEqual({ ok: false, reason: 'source_not_referenceable' })
  })

  it('② character_ref → 纯文生模型(imagen-4,无图片参考槽) → 拒(unsupported_reference)', () => {
    const verdict = validateReferenceEdge(node('c', 'character'), node('i', 'image', 'imagen-4'), 'character_ref')
    expect(verdict).toEqual({ ok: false, reason: 'unsupported_reference' })
  })

  it('character_ref → 有图片参考槽的模型(seedream edit) → 放行', () => {
    expect(validateReferenceEdge(node('c', 'character'), node('i', 'image', 'seedream'), 'character_ref')).toEqual({ ok: true })
  })

  it('first_frame(图片源)→ 视频模型(seedance 有首帧槽) → 放行', () => {
    expect(validateReferenceEdge(node('k', 'keyframe'), node('v', 'video', 'seedance-2'), 'first_frame')).toEqual({ ok: true })
  })

  it('first_frame(视频源,尾帧接力)→ 视频模型(seedance 首帧槽收 video) → 放行', () => {
    expect(validateReferenceEdge(node('v0', 'video'), node('v1', 'video', 'seedance-2'), 'first_frame')).toEqual({ ok: true })
  })

  // i2v 首帧槽声明不统一：kling/veo/wan/sora/seedance-apimart 把首帧输入归到通用 image_ref 数组槽
  // （i2v 的输入图＝首帧），hailuo/seedance-2 才标 first_frame。first_frame 边对前者必须放行，否则
  // keyframe→video 边被静默丢弃 → 对账误报「批准已连接/实际未连接」（用户反复撞见的根因）。
  it.each(['kling-3.0', 'veo-3.1', 'wan-2.7', 'sora-2', 'seedance-2-apimart'])(
    'first_frame(图片源)→ 视频模型首帧输入归在通用 image_ref 槽(%s) → 放行',
    (archetypeId) => {
      expect(validateReferenceEdge(node('k', 'keyframe'), node('v', 'video', archetypeId), 'first_frame')).toEqual({ ok: true })
    },
  )

  it('character_ref → 视频 omni(seedance 有 image_ref 角色参考槽) → 放行', () => {
    expect(validateReferenceEdge(node('c', 'character'), node('v', 'video', 'seedance-2'), 'character_ref')).toEqual({ ok: true })
  })

  it('first_frame → 纯文生图模型(imagen-4 无首帧槽) → 拒', () => {
    const verdict = validateReferenceEdge(node('k', 'keyframe'), node('i', 'image', 'imagen-4'), 'first_frame')
    expect(verdict).toEqual({ ok: false, reason: 'unsupported_reference' })
  })

  it('目标未声明档案(未知/未设模型)→ 放行(P4 通用回退,不误伤)', () => {
    expect(validateReferenceEdge(node('c', 'character'), node('i', 'image'), 'character_ref')).toEqual({ ok: true })
  })

  it('通用 reference(图片源)→ 有图片参考槽 → 放行；→ 纯文生 → 拒', () => {
    expect(validateReferenceEdge(node('a', 'image'), node('b', 'image', 'seedream'), undefined)).toEqual({ ok: true })
    expect(validateReferenceEdge(node('a', 'image'), node('b', 'image', 'imagen-4'), undefined)).toEqual({ ok: false, reason: 'unsupported_reference' })
  })
})

describe('partitionConnectableEdges — 批准时剔除连不上的边(批准≡执行)', () => {
  const kf = node('kf', 'keyframe')
  const vid = node('vid', 'video', 'kling-3.0')
  const vid2 = node('vid2', 'video', 'kling-3.0')
  const lookup = (id: string) => (({ kf, vid, vid2 } as Record<string, ReturnType<typeof node>>)[id] ?? null)

  it('keyframe→video 首帧(image_ref 吃图)保留;video→video 接力(image_ref 吃不了视频源)剔除', () => {
    const { connectable, dropped } = partitionConnectableEdges(
      [
        { sourceClientId: 'kf', targetClientId: 'vid', mode: 'first_frame' },
        { sourceClientId: 'vid', targetClientId: 'vid2', mode: 'first_frame' }, // 接力源是视频→kling 不吃
      ],
      lookup,
    )
    expect(connectable).toHaveLength(1)
    expect((connectable[0] as { sourceClientId: string }).sourceClientId).toBe('kf')
    expect(dropped).toHaveLength(1)
    expect(dropped[0].reason).toBe('unsupported_reference')
  })

  it('解析不出节点 → 保守保留(交执行端 dangling 兜底)', () => {
    const { connectable, dropped } = partitionConnectableEdges([{ sourceClientId: 'x', targetClientId: 'y' }], () => null)
    expect(connectable).toHaveLength(1)
    expect(dropped).toHaveLength(0)
  })
})
