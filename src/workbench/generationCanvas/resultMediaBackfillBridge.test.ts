// 项目打开后的结果补全（纯函数直测，不碰 React/IPC）。
// 锁的行为：① 只救 http(s) 的图/视频结果，写回本地 url 时原链保进 providerUrl；② 只给没有封面的本地图/视频补封面；
// 本地 url / 文本结果 / 空结果一律不动（幂等边界）。
import { describe, expect, it } from 'vitest'
import { backfilledPreviewPatch, relocalizedResultPatch, shouldBackfillPreview, shouldRelocalizeResult } from './resultMediaBackfillBridge'
import type { GenerationNodeResult } from './model/generationCanvasTypes'

function result(partial: Partial<GenerationNodeResult>): GenerationNodeResult {
  return { id: 'r1', type: 'video', createdAt: 0, ...partial } as GenerationNodeResult
}

describe('shouldRelocalizeResult', () => {
  it('http(s) 的图/视频结果要救', () => {
    expect(shouldRelocalizeResult(result({ type: 'video', url: 'https://cdn.vendor.com/a.mp4' }))).toBe(true)
    expect(shouldRelocalizeResult(result({ type: 'image', url: 'http://cdn.vendor.com/a.png' }))).toBe(true)
  })

  it('已本地化(nomi-local)/文本/3D/空结果不动', () => {
    expect(shouldRelocalizeResult(result({ url: 'nomi-local://p1/assets/a.mp4' }))).toBe(false)
    expect(shouldRelocalizeResult(result({ type: 'text', url: 'https://x.com/a' }))).toBe(false)
    expect(shouldRelocalizeResult(result({ type: 'model3d', url: 'https://x.com/a.glb' }))).toBe(false)
    expect(shouldRelocalizeResult(result({ url: '' }))).toBe(false)
    expect(shouldRelocalizeResult(undefined)).toBe(false)
  })
})

describe('relocalizedResultPatch', () => {
  it('url 换成本地、原 CDN 链保进 providerUrl、图片没派生预览时 thumbnailUrl 回落到本地源', () => {
    const source = result({ type: 'image', url: 'https://cdn.vendor.com/a.png', thumbnailUrl: 'https://cdn.vendor.com/a.png' })
    const patch = relocalizedResultPatch(source, 'nomi-local://p1/assets/a.png', 'asset-1')
    expect(patch?.url).toBe('nomi-local://p1/assets/a.png')
    expect(patch?.providerUrl).toBe('https://cdn.vendor.com/a.png')
    expect(patch?.thumbnailUrl).toBe('nomi-local://p1/assets/a.png')
    expect(patch?.assetId).toBe('asset-1')
  })

  it('落盘边界派生了预览 → 图片/视频都挂预览', () => {
    const image = result({ type: 'image', url: 'https://cdn.vendor.com/a.png' })
    const patch = relocalizedResultPatch(image, 'nomi-local://p1/assets/a.png', 'asset-1', { thumbnailUrl: 'nomi-local://p1/assets/a.preview.jpg' })
    expect(patch?.thumbnailUrl).toBe('nomi-local://p1/assets/a.preview.jpg')
    const video = result({ type: 'video', url: 'https://cdn.vendor.com/a.mp4', thumbnailUrl: 'https://cdn.vendor.com/poster.jpg' })
    expect(relocalizedResultPatch(video, 'nomi-local://p1/assets/a.mp4', undefined, { thumbnailUrl: 'nomi-local://p1/assets/a.preview.jpg' })?.thumbnailUrl).toBe('nomi-local://p1/assets/a.preview.jpg')
    // 视频没派生出 poster：远端封面链和源一起过期，不能留着一个会 404 的 thumbnailUrl。
    expect(relocalizedResultPatch(video, 'nomi-local://p1/assets/a.mp4', undefined, {})?.thumbnailUrl).toBeUndefined()
  })

  it('已有 providerUrl 不覆盖；本地 url 为空/与原值相同 → null（不产生无谓写）', () => {
    const source = result({ url: 'https://cdn.vendor.com/a.mp4', providerUrl: 'https://origin.vendor.com/a.mp4' })
    expect(relocalizedResultPatch(source, 'nomi-local://p1/assets/a.mp4')?.providerUrl).toBe('https://origin.vendor.com/a.mp4')
    expect(relocalizedResultPatch(source, '')).toBeNull()
    expect(relocalizedResultPatch(source, 'https://cdn.vendor.com/a.mp4')).toBeNull()
  })
})

describe('shouldBackfillPreview / backfilledPreviewPatch', () => {
  it('只给没有封面的本地图/视频补', () => {
    expect(shouldBackfillPreview(result({ url: 'nomi-local://asset/p1/assets/a.mp4' }))).toBe(true)
    expect(shouldBackfillPreview(result({ type: 'image', url: 'nomi-local://asset/p1/assets/a.png' }))).toBe(true)
    expect(shouldBackfillPreview(result({ url: 'nomi-local://asset/p1/assets/a.mp4', thumbnailUrl: 'nomi-local://asset/p1/assets/a.preview.jpg' }))).toBe(false)
    expect(shouldBackfillPreview(result({ url: 'https://cdn.vendor.com/a.mp4' }))).toBe(false)
    expect(shouldBackfillPreview(result({ type: 'text', url: 'nomi-local://asset/p1/a.txt' }))).toBe(false)
    expect(shouldBackfillPreview(undefined)).toBe(false)
  })

  it('派生出封面 → 写上；视频没派生出来 → 不写（下次打开再试）；小图没预览 → 源即预览', () => {
    const video = result({ url: 'nomi-local://asset/p1/assets/a.mp4' })
    expect(backfilledPreviewPatch(video, { thumbnailUrl: 'nomi-local://asset/p1/assets/a.preview.jpg' })?.thumbnailUrl).toBe('nomi-local://asset/p1/assets/a.preview.jpg')
    expect(backfilledPreviewPatch(video, {})).toBeNull()
    expect(backfilledPreviewPatch(video, null)).toBeNull()
    const image = result({ type: 'image', url: 'nomi-local://asset/p1/assets/a.png' })
    expect(backfilledPreviewPatch(image, {})?.thumbnailUrl).toBe('nomi-local://asset/p1/assets/a.png')
  })
})
