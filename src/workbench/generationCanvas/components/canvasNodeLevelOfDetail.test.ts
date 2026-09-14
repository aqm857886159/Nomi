import { describe, expect, it } from 'vitest'
import {
  CONCURRENT_FULL_CHROME_LIMIT,
  FULL_CHROME_MIN_SCREEN_WIDTH_PX,
  isLightweightRenderable,
  retainLargeCanvasLightweightRendering,
  resolveLightweightNodePreview,
  shouldRenderFullNodeContent,
  shouldRenderNodeConnectionHandles,
  shouldRenderNodeResizeAffordance,
  shouldUseLightweightNodeRendering,
  shouldUseLightweightNodeRenderingForSelection,
} from './canvasNodeLevelOfDetail'
import { MIN_NODE_WIDTH } from '../nodes/nodeSizing'

describe('shouldUseLightweightNodeRendering', () => {
  it('判的是屏上宽度，不是画布上一共有几个节点', () => {
    // 阈值 = 卡片被授权布局过的最窄宽度（NodeResizer 的下钳位）。
    expect(FULL_CHROME_MIN_SCREEN_WIDTH_PX).toBe(MIN_NODE_WIDTH)
    expect(shouldUseLightweightNodeRendering({ cardWidth: 340, zoom: 1 })).toBe(false)
    expect(shouldUseLightweightNodeRendering({ cardWidth: FULL_CHROME_MIN_SCREEN_WIDTH_PX, zoom: 1 })).toBe(false)
    // 比 240 窄的**固定宽度卡**（角色/道具卡 200）：它的 chrome 就是按 200 设计的，zoom 1 不许降档；
    // 比自己的设计宽度窄了才降。
    expect(shouldUseLightweightNodeRendering({ cardWidth: FULL_CHROME_MIN_SCREEN_WIDTH_PX - 1, zoom: 1 })).toBe(false)
    expect(shouldUseLightweightNodeRendering({ cardWidth: 200, zoom: 1 })).toBe(false)
    expect(shouldUseLightweightNodeRendering({ cardWidth: 200, zoom: 1.5 })).toBe(false)
    expect(shouldUseLightweightNodeRendering({ cardWidth: 200, zoom: 0.9 })).toBe(true)
    // 用户拉宽到 600 的卡在 0.5 缩放下屏上仍有 300px（设计过的宽度）→ 完整渲染。
    expect(shouldUseLightweightNodeRendering({ cardWidth: 600, zoom: 0.5 })).toBe(false)
  })

  it('创始人那一格：60 张 340 宽的图片卡、适应视图后缩放 0.217 —— 旧判据漏掉，新判据接住', () => {
    // 旧判据是 nodeCount > 80 && zoom < 0.55，60 张图掉进缝里（调研 §1.5）。
    expect(shouldUseLightweightNodeRendering({ cardWidth: 340, zoom: 0.217 })).toBe(true)
  })

  it('既有门岗的低缩放场景（0.45 / 0.55）仍然落在轻量档内', () => {
    expect(shouldUseLightweightNodeRendering({ cardWidth: 340, zoom: 0.45 })).toBe(true)
    expect(shouldUseLightweightNodeRendering({ cardWidth: 340, zoom: 0.54 })).toBe(true)
  })
})

describe('shouldRenderFullNodeContent', () => {
  it('轻量档下只有主选中或聚焦闪烁才回到完整内容', () => {
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: false })).toBe(false)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: true, focusFlash: false })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: true, selected: false, focusFlash: true })).toBe(true)
    expect(shouldRenderFullNodeContent({ lightweightMode: false, selected: false, focusFlash: false })).toBe(true)
  })
})

describe('二级闸：同时在动几张', () => {
  const big = CONCURRENT_FULL_CHROME_LIMIT + 1
  it('选区超过实测平台期时，非主选卡走轻量档（缩放再大也一样）', () => {
    expect(shouldUseLightweightNodeRenderingForSelection({ cardWidth: 340, zoom: 1, selectedCount: big, selected: true, primarySelection: false })).toBe(true)
    expect(shouldUseLightweightNodeRenderingForSelection({ cardWidth: 340, zoom: 1, selectedCount: big, selected: true, primarySelection: true })).toBe(false)
  })
  it('选区在平台期内不动既有观感', () => {
    expect(shouldUseLightweightNodeRenderingForSelection({ cardWidth: 340, zoom: 1, selectedCount: CONCURRENT_FULL_CHROME_LIMIT, selected: true, primarySelection: false })).toBe(false)
    expect(shouldUseLightweightNodeRenderingForSelection({ cardWidth: 340, zoom: 1, selectedCount: 2, selected: true, primarySelection: false })).toBe(false)
  })
  it('保持位：已经进轻量档的卡在选区仍然大时不来回翻', () => {
    expect(retainLargeCanvasLightweightRendering({ retained: false, selectedCount: big, selected: true, primarySelection: false })).toBe(true)
    expect(retainLargeCanvasLightweightRendering({ retained: true, selectedCount: big, selected: false, primarySelection: false })).toBe(true)
    expect(retainLargeCanvasLightweightRendering({ retained: true, selectedCount: big, selected: true, primarySelection: true })).toBe(false)
    expect(retainLargeCanvasLightweightRendering({ retained: true, selectedCount: 2, selected: false, primarySelection: false })).toBe(false)
  })
})

describe('shouldRenderNodeResizeAffordance', () => {
  it('轻量档不挂缩放手柄（手柄 16px，此时屏上点不中）', () => {
    expect(shouldRenderNodeResizeAffordance({ lightweightMode: false, readOnly: false, selected: true })).toBe(true)
    expect(shouldRenderNodeResizeAffordance({ lightweightMode: true, readOnly: false, selected: true })).toBe(false)
    expect(shouldRenderNodeResizeAffordance({ lightweightMode: false, readOnly: true, selected: true })).toBe(false)
    expect(shouldRenderNodeResizeAffordance({ lightweightMode: false, readOnly: false, selected: false })).toBe(false)
  })
})

describe('shouldRenderNodeConnectionHandles', () => {
  it('轻量档默认不挂把手，但只要有连线手势在进行就全部挂回来', () => {
    expect(shouldRenderNodeConnectionHandles({ lightweightMode: false, readOnly: false, connectionInProgress: false })).toBe(true)
    expect(shouldRenderNodeConnectionHandles({ lightweightMode: true, readOnly: false, connectionInProgress: false })).toBe(false)
    expect(shouldRenderNodeConnectionHandles({ lightweightMode: true, readOnly: false, connectionInProgress: true })).toBe(true)
    expect(shouldRenderNodeConnectionHandles({ lightweightMode: false, readOnly: true, connectionInProgress: true })).toBe(false)
  })
})

describe('轻量档准入：有东西可画才降档', () => {
  it('有结果媒体的卡可以降档；没有的维持完整渲染（否则只剩灰盒子）', () => {
    expect(isLightweightRenderable({ result: { type: 'image', url: 'nomi-local://a.png' } })).toBe(true)
    expect(isLightweightRenderable({ result: { type: 'video', url: 'nomi-local://a.mp4' } })).toBe(true)
    expect(isLightweightRenderable({ result: { type: 'text' } })).toBe(false)
    expect(isLightweightRenderable({})).toBe(false)
  })
})

describe('resolveLightweightNodePreview', () => {
  it('prefers thumbnails and falls back to the result url', () => {
    expect(
      resolveLightweightNodePreview({
        result: { type: 'image', url: 'nomi-local://full.png', thumbnailUrl: 'nomi-local://thumb.png' },
      }),
    ).toEqual({ kind: 'image', src: 'nomi-local://thumb.png' })
    expect(
      resolveLightweightNodePreview({
        result: { type: 'image', url: 'nomi-local://full.png' },
      }),
    ).toEqual({ kind: 'image', src: 'nomi-local://full.png' })
    expect(
      resolveLightweightNodePreview({
        result: { type: 'video', url: 'nomi-local://clip.mp4' },
      }),
    ).toEqual({ kind: 'video', src: 'nomi-local://clip.mp4' })
  })
  it('returns null when there is nothing to draw', () => {
    expect(resolveLightweightNodePreview({ result: { type: 'text' } })).toBeNull()
    expect(resolveLightweightNodePreview({ result: { type: 'image', url: '  ' } })).toBeNull()
  })
})
