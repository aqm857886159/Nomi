import { describe, expect, it } from 'vitest'
import { archetypeForNode, isTextPromptEdge, referenceAssetKindForNode, validateReferenceEdge, partitionConnectableEdges, resolveTargetModeForEdge } from './referenceEdgeCapability'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { GENERATION_NODE_KINDS, getGenerationNodeExecutionKind } from '../model/generationNodeKinds'

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
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    ...(archetypeId ? { meta: { archetype: { id: archetypeId, modeId: '' } } } : {}),
  }
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
  it('导入的**视频素材**(kind=asset 但 result.type=video)→ video(不是 image)', () => {
    // 用户报的根因:一个 asset 种类同时装图和视频,只按 kind 判会把导入视频当图参考 → 加载失败。
    const videoAsset = { ...node('n', 'asset'), result: { id: 'r', type: 'video', url: 'x.mp4', createdAt: 0 } } as GenerationCanvasNode
    expect(referenceAssetKindForNode(videoAsset)).toBe('video')
    const imageAsset = { ...node('n', 'asset'), result: { id: 'r', type: 'image', url: 'x.png', createdAt: 0 } } as GenerationCanvasNode
    expect(referenceAssetKindForNode(imageAsset)).toBe('image')
  })
  it('导入的**音频素材**(kind=asset 但 result.type=audio)→ audio(不是 image)', () => {
    // 同一类根因的第二种形态：用户拖一段音频文件导进画布当素材(kind=asset)，而不是用专门的
    // 「声音」生成节点(kind=audio)——这条 asset 分支此前只区分 video/image 两种 result.type，
    // 音频素材会被这条 fallback 默默归成 image，同样连不上 audio_ref 槽。
    const audioAsset = { ...node('n', 'asset'), result: { id: 'r', type: 'audio', url: 'x.mp3', createdAt: 0 } } as GenerationCanvasNode
    expect(referenceAssetKindForNode(audioAsset)).toBe('audio')
  })
  it('文本/镜头/输出节点 → null(无可参考产物)', () => {
    for (const kind of ['text', 'shot', 'output']) {
      expect(referenceAssetKindForNode(node('n', kind))).toBeNull()
    }
  })

  it('音频节点 → audio(用户报的根因:声音节点连不上视频节点)', () => {
    expect(referenceAssetKindForNode(node('n', 'audio'))).toBe('audio')
  })

  // 根因回归(R21 class_root)：referenceAssetKindForNode 是「源节点产出哪种可参考资产」的唯一分类器，
  // 只认 image/video/audio 三种(ReferenceAssetKind)。它按 node kind 的 executionKind 派生——
  // 但派生表历史上只写了 image/video 两支,新增第三个执行种类(audio)时没人记得回来加分支,于是
  // 一个执行上明明产出音频的节点被分类成 null(=不可参考),画布的连线校验、@ 提及候选、参考槽解析
  // 全部跟着拒绝它,不管目标模型的参考槽声明写了什么。这条测试不针对 'audio' 这一个 kind 硬编码——
  // 它扫描节点注册表里**所有**已声明 executionKind 且该 executionKind 落在 ReferenceAssetKind 定义域
  // (image/video/audio)内的 kind,断言分类器都认得它,不许再漏一个。
  it('registry 里每个 executionKind ∈ {image,video,audio} 的节点 kind 都被分类器认得(不漏判)', () => {
    const referenceableExecutionKinds = new Set(['image', 'video', 'audio'])
    const covered: string[] = []
    for (const kind of GENERATION_NODE_KINDS) {
      const exec = getGenerationNodeExecutionKind(kind)
      if (!exec || !referenceableExecutionKinds.has(exec)) continue
      covered.push(kind)
      expect(referenceAssetKindForNode(node('n', kind)), `kind=${kind} executionKind=${exec}`).toBe(exec)
    }
    // 防止遍历逻辑本身写错导致假绿(比如 GENERATION_NODE_KINDS 为空数组)。
    expect(covered.length).toBeGreaterThanOrEqual(3)
  })
})

describe('validateReferenceEdge — 参考边能力校验', () => {
  it('文本→图片/视频的通用 reference 边作为 prompt 上下文放行，但不变成参考资产', () => {
    const text = node('t', 'text')
    const image = node('i', 'image', 'imagen-4')
    const video = node('v', 'video', 'seedance-2')
    expect(referenceAssetKindForNode(text)).toBeNull()
    expect(isTextPromptEdge(text, image)).toBe(true)
    expect(isTextPromptEdge(text, video)).toBe(true)
    expect(validateReferenceEdge(text, image, 'reference')).toEqual({ ok: true })
    expect(validateReferenceEdge(text, video, 'reference')).toEqual({ ok: true })
  })

  it('文本→非图片/视频或非 reference 语义仍拒绝(source_not_referenceable)', () => {
    expect(validateReferenceEdge(node('t', 'text'), node('a', 'audio'), 'reference')).toEqual({
      ok: false,
      reason: 'source_not_referenceable',
    })
    const verdict = validateReferenceEdge(node('t', 'text'), node('i', 'image'), 'character_ref')
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

describe('resolveTargetModeForEdge — 连线后目标自动切到能消费这条参考的「生成方式」', () => {
  // 节点(可指定当前 modeId)。imageGen 用 image kind + 有 edit(image_ref) 模式的档案。
  function nodeWithMode(id: string, kind: string, archetypeId: string, modeId: string): GenerationCanvasNode {
    return { id, kind: kind as GenerationCanvasNode['kind'], title: id, prompt: '', position: { x: 0, y: 0 }, size: { width: 100, height: 100 }, meta: { archetype: { id: archetypeId, modeId } } }
  }

  it.each(['seedream', 'nano-banana'])(
    '图 → 图片节点停在默认文生图(无参考槽)的 %s → 切到含 image_ref 的 edit 模式（根因回归）',
    (archetypeId) => {
      // 默认 modeId:'' → currentArchetypeMode 回落 defaultModeId(t2i,slots:[])→ 收不下 → 找到 edit。
      expect(resolveTargetModeForEdge(node('a', 'image'), node('b', 'image', archetypeId), 'reference')).toBe('edit')
    },
  )

  it('图 → 已在 edit(参考图)模式的节点 → null(当前模式已能落，不重复切、尊重用户选择)', () => {
    expect(resolveTargetModeForEdge(node('a', 'image'), nodeWithMode('b', 'image', 'seedream', 'edit'), 'reference')).toBeNull()
  })

  it('图 → 纯文生模型(imagen-4，所有模式都无参考槽) → null(没有能落的模式)', () => {
    expect(resolveTargetModeForEdge(node('a', 'image'), node('b', 'image', 'imagen-4'), 'reference')).toBeNull()
  })

  it('文本源(无可参考产物) → null(不触发切模式)', () => {
    expect(resolveTargetModeForEdge(node('t', 'text'), node('b', 'image', 'seedream'), 'reference')).toBeNull()
  })

  it('目标未声明档案(未知/未设模型) → null(无从派生，P4 通用回退)', () => {
    expect(resolveTargetModeForEdge(node('a', 'image'), node('b', 'image'), 'reference')).toBeNull()
  })
})

import { findVideoRefMode, resolveModeForConnectedReferences } from './referenceEdgeCapability'
import { getArchetypeById } from '../../../config/modelArchetypes'
import type { GenerationCanvasEdge } from '../model/generationCanvasTypes'

describe('resolveModeForConnectedReferences — 按活边对账「生成方式」(提交/换模型兜底)', () => {
  function edge(source: string, target: string, mode?: GenerationCanvasEdge['mode']): GenerationCanvasEdge {
    return { id: `${source}->${target}`, source, target, ...(mode ? { mode } : {}) } as GenerationCanvasEdge
  }
  function imageAsset(id: string): GenerationCanvasNode {
    return { ...node(id, 'asset'), result: { id: 'r', type: 'image', url: 'https://cdn/a.png', createdAt: 0 } } as GenerationCanvasNode
  }
  function videoAsset(id: string): GenerationCanvasNode {
    return { ...node(id, 'asset'), result: { id: 'r', type: 'video', url: 'https://cdn/a.mp4', createdAt: 0 } } as GenerationCanvasNode
  }

  it('t2i(空槽) + 图参考边 → 促到 edit（换模型落回默认/存量边的根因回归）', () => {
    const source = imageAsset('s')
    const target = { ...node('t', 'image', 'seedream'), meta: { archetype: { id: 'seedream', modeId: 't2i' } } } as GenerationCanvasNode
    expect(resolveModeForConnectedReferences(target, [source, target], [edge('s', 't', 'reference')])).toBe('edit')
  })

  it('当前已是 edit（能收）→ null（幂等，尊重现状）', () => {
    const source = imageAsset('s')
    const target = { ...node('t', 'image', 'seedream'), meta: { archetype: { id: 'seedream', modeId: 'edit' } } } as GenerationCanvasNode
    expect(resolveModeForConnectedReferences(target, [source, target], [edge('s', 't', 'reference')])).toBeNull()
  })

  it('无参考边 → null（纯文生不受打扰）；文本 prompt 边不算参考', () => {
    const target = node('t', 'image', 'seedream')
    expect(resolveModeForConnectedReferences(target, [target], [])).toBeNull()
    const text = node('x', 'text')
    expect(resolveModeForConnectedReferences(target, [text, target], [edge('x', 't', 'reference')])).toBeNull()
  })

  it('纯文生模型(imagen-4 无任何参考槽) → null（真不支持，不硬切）', () => {
    const source = imageAsset('s')
    const target = node('t', 'image', 'imagen-4')
    expect(resolveModeForConnectedReferences(target, [source, target], [edge('s', 't', 'reference')])).toBeNull()
  })

  it('t2v + 首帧边 → 促到 first（视频同类修复）', () => {
    const source = imageAsset('s')
    const target = { ...node('t', 'video', 'seedance-2'), meta: { archetype: { id: 'seedance-2', modeId: 't2v' } } } as GenerationCanvasNode
    expect(resolveModeForConnectedReferences(target, [source, target], [edge('s', 't', 'first_frame')])).toBe('first')
  })

  it('异质多需求（角色图边 + 视频参考边）→ 挑能收下最多条的模式（omni）', () => {
    const character = imageAsset('c')
    const clip = videoAsset('v')
    const target = { ...node('t', 'video', 'seedance-2'), meta: { archetype: { id: 'seedance-2', modeId: 't2v' } } } as GenerationCanvasNode
    const edges = [edge('c', 't', 'character_ref'), edge('v', 't', 'reference')]
    expect(resolveModeForConnectedReferences(target, [character, clip, target], edges)).toBe('omni')
  })

  it('目标未声明档案 → null（P4 通用回退）', () => {
    const source = imageAsset('s')
    const target = node('t', 'image')
    expect(resolveModeForConnectedReferences(target, [source, target], [edge('s', 't', 'reference')])).toBeNull()
  })
})

describe('findVideoRefMode — 档案有没有 video_ref 槽', () => {
  it('Seedance 2.0 (omni 有 video_ref) → 返回 omni 模式 + referenceVideoUrls + video_urls', () => {
    const arch = getArchetypeById('seedance-2-apimart')
    expect(arch).toBeTruthy()
    const found = findVideoRefMode(arch)
    expect(found).toEqual({ modeId: 'omni', metaKey: 'referenceVideoUrls', inputKey: 'video_urls' })
  })

  it('纯文生图模型(imagen-4,无任何视频参考槽) → null', () => {
    const arch = getArchetypeById('imagen-4')
    expect(arch).toBeTruthy()
    expect(findVideoRefMode(arch)).toBeNull()
  })

  it('null 档案 → null(降级 prompt 地板)', () => {
    expect(findVideoRefMode(null)).toBeNull()
  })
})

describe('archetypeForNode 与发送路径同源（2026-09-08 Agnes 2.1 根因）', () => {
  // 档案一分为二时（Agnes Image 2.0 / 2.1，后者声明 legacyIds: ['agnes-image']），存量节点的
  // meta 里还钉着旧的共享 id。旧实现在这里走 getArchetypeById 捷径 → 拿到 2.0；发送路径按
  // legacyIds + 模型身份迁移 → 2.1。同一个节点两条路径认到两个不同档案，「按活边自动纠正模式」
  // 的守卫于是按 2.0 算模式、写回 2.0 的 id、把 2.1 的档位参数夹回 2.0 的像素表。
  const legacyNode = {
    id: 'n1',
    kind: 'image',
    title: 'n1',
    prompt: '',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 100 },
    meta: { archetype: { id: 'agnes-image', modeId: 't2i' }, modelKey: 'agnes-image-2.1-flash', modelVendor: 'agnes' },
  } as unknown as GenerationCanvasNode

  it('存量 meta 钉着旧共享 id 时，仍解析到迁移后的 2.1 档案', () => {
    expect(archetypeForNode(legacyNode)).not.toBeNull()
    expect(archetypeForNode(legacyNode)?.id).toBe('agnes-image-2.1')
  })

  it('与发送路径 resolveArchetypeForModel 逐字一致（不是各写一份判断）', () => {
    const viaSend = resolveArchetypeForModel({
      modelKey: 'agnes-image-2.1-flash',
      vendorKey: 'agnes',
      meta: legacyNode.meta as Record<string, unknown>,
    })
    expect(archetypeForNode(legacyNode)?.id).toBe(viaSend?.id)
  })

  it('没有 modelKey 时退化成「只认 meta 里的显式 id」（旧行为不变）', () => {
    const bare = { ...legacyNode, meta: { archetype: { id: 'seedream', modeId: '' } } } as unknown as GenerationCanvasNode
    expect(archetypeForNode(bare)?.id).toBe('seedream')
  })
})
