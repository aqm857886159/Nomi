// 视频比例默认的「已经是首选」判断：按 ASPECT_RATIO_META_KEYS 的优先级取第一个读得出比例的键（aspect_ratio 最先），
// 再约分比较。旧模式残留在别的键上的比例（切方式后 image_size 还留着）不能挡住这次该铺的默认值。
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { DynamicModelControl } from './controls/parameterControlModel'
import { ASPECT_EXPLICIT_META_KEY } from './aspectExplicit'
import { applyVideoAspectSeed, videoAspectSeedPatch } from './videoAspectSeed'

const ratioControl = (values: string[], defaultValue?: string): DynamicModelControl => ({
  key: 'aspect_ratio', label: '比例', binding: 'parameter',
  type: 'select', options: values.map((value) => ({ value, label: value })),
  ...(defaultValue !== undefined ? { defaultValue } : {}),
}) as unknown as DynamicModelControl

const portrait: GenerationCanvasNode = { id: 'img', title: 'img', kind: 'image', categoryId: 'shots', position: { x: 0, y: 0 }, meta: { aspect_ratio: '9:16' } }
const edges: GenerationCanvasEdge[] = [{ id: 'e1', source: 'img', target: 'shot', mode: 'first_frame' }]
const shot = (meta: Record<string, unknown>): GenerationCanvasNode => ({ id: 'shot', title: 'shot', kind: 'video', categoryId: 'shots', position: { x: 600, y: 0 }, meta })
const seed = (meta: Record<string, unknown>, values: string[]) =>
  videoAspectSeedPatch({ nodeId: 'shot', nodes: [portrait, shot(meta)], edges, controls: [ratioControl(values)], meta, respectExplicit: true })

describe('videoAspectSeedPatch：「已经是首选」只看优先级最高、读得出比例的那个键', () => {
  it('aspect_ratio 是 16:9、旧模式残留的 image_size 是竖版 → 连竖图仍切到 9:16', () => {
    expect(seed({ aspect_ratio: '16:9', image_size: 'portrait_16_9' }, ['16:9', '9:16']).aspect_ratio).toBe('9:16')
  })

  it('aspect_ratio 已是 720:1280（约分后就是 9:16）→ 不重铺', () => {
    expect(seed({ aspect_ratio: '720:1280' }, ['1280:720', '720:1280'])).toEqual({})
  })
})

describe('videoAspectSeedPatch：视频编辑方式默认跟随原视频（auto），参考/文生维持 16:9/9:16', () => {
  const editControl = ratioControl(['auto', '16:9', '9:16', '1:1', '21:9'], 'auto')
  const videoSrc: GenerationCanvasNode = { id: 'vid', title: 'vid', kind: 'asset', categoryId: 'assets', position: { x: 0, y: 0 }, meta: { aspect_ratio: '1:1' } }
  const videoEdges: GenerationCanvasEdge[] = [{ id: 'e-vid', source: 'vid', target: 'shot', mode: 'reference' }]

  it('视频编辑方式 + 未手动选比例（机器写过 16:9）→ 清掉机器 16:9，让位给档案默认 auto', () => {
    const meta = { aspect_ratio: '16:9' }
    const patch = videoAspectSeedPatch({
      nodeId: 'shot', nodes: [videoSrc, shot(meta)], edges: videoEdges,
      controls: [editControl], meta, mode: { intent: 'edit' }, respectExplicit: true,
    })
    expect(patch).toEqual({ aspect_ratio: undefined })
    expect(applyVideoAspectSeed(meta, patch)).toEqual({})
  })

  it('视频编辑方式 + 已经未设或已是 auto → 幂等空 patch，不写盘', () => {
    for (const meta of [{}, { aspect_ratio: 'auto' }]) {
      expect(videoAspectSeedPatch({
        nodeId: 'shot', nodes: [videoSrc, shot(meta)], edges: videoEdges,
        controls: [editControl], meta, mode: { intent: 'edit' }, respectExplicit: true,
      })).toEqual({})
    }
  })

  it('反例：用户明确选过 16:9 或 9:16 → 切编辑方式 / 连线都不覆盖', () => {
    for (const chosen of ['16:9', '9:16']) {
      const meta = { aspect_ratio: chosen, [ASPECT_EXPLICIT_META_KEY]: true }
      expect(videoAspectSeedPatch({
        nodeId: 'shot', nodes: [videoSrc, shot(meta)], edges: videoEdges,
        controls: [editControl], meta, mode: { intent: 'edit' }, respectExplicit: true,
      })).toEqual({})
    }
  })

  it('反例：参考方式（intent=character，哪怕控件默认也是 auto）仍按 07-17 规则落 16:9 / 9:16', () => {
    expect(videoAspectSeedPatch({
      nodeId: 'shot', nodes: [videoSrc, shot({})], edges: videoEdges,
      controls: [editControl], meta: {}, mode: { intent: 'character' }, respectExplicit: true,
    })).toEqual({ aspect_ratio: '16:9' })
    expect(videoAspectSeedPatch({
      nodeId: 'shot', nodes: [portrait, shot({})], edges: edges.map(edge => ({ ...edge, mode: 'reference' })),
      controls: [editControl], meta: {}, mode: { intent: 'character' }, respectExplicit: true,
    })).toEqual({ aspect_ratio: '9:16' })
  })
})

describe('first-frame handoff', () => {
  it.each([
    ['1:1', ['16:9', '1:1'], '1:1'],
    ['9:16', ['16:9', '9:16'], '9:16'],
    ['1:1', ['adaptive', '1:1'], 'adaptive'],
    ['9:16', ['auto', '9:16'], 'auto'],
  ] as const)('matches %s to supported options %j', (aspect, values, expected) => {
    const source = { ...portrait, meta: { aspect_ratio: aspect } }
    const input = { nodeId: 'shot', nodes: [source, shot({})], edges, controls: [ratioControl([...values])], respectExplicit: true }
    expect(videoAspectSeedPatch({ ...input, meta: {} }).aspect_ratio).toBe(expected)
    expect(videoAspectSeedPatch({ ...input, meta: { aspect_ratio: '16:9', [ASPECT_EXPLICIT_META_KEY]: true } })).toEqual({})
  })
})

it('matches the decoded first frame when source controls have since changed', () => {
  const source = { ...portrait, meta: { imageWidth: 1024, imageHeight: 1024, aspect_ratio: '9:16' },
    result: { id: 'r', type: 'image' as const, url: 'nomi-local://still.png', createdAt: 1 } }
  const input = { nodeId: 'shot', nodes: [source, shot({})], edges, controls: [ratioControl(['1:1', '9:16'])], respectExplicit: true }
  expect(videoAspectSeedPatch({ ...input, meta: {} }).aspect_ratio).toBe('1:1')
})
