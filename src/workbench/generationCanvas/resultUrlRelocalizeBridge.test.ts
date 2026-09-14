// 「视频第二天加载不出来」存量补救的判定与写回（纯函数直测，不碰 React/IPC）。
// 锁的行为：只救 http(s) 的图/视频结果；写回本地 url 时原链保进 providerUrl；
// 本地 url / 文本结果 / 空结果一律不动（幂等边界）。
import { describe, expect, it } from 'vitest'
import { relocalizedResultPatch, shouldRelocalizeResult } from './resultUrlRelocalizeBridge'
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

  it('落盘边界派生了预览 → 图片/视频都挂预览，源尺寸随之写进 result', () => {
    const image = result({ type: 'image', url: 'https://cdn.vendor.com/a.png' })
    const patch = relocalizedResultPatch(image, 'nomi-local://p1/assets/a.png', 'asset-1', { thumbnailUrl: 'nomi-local://p1/assets/a.preview.jpg', width: 4096, height: 2160 })
    expect(patch?.thumbnailUrl).toBe('nomi-local://p1/assets/a.preview.jpg')
    expect(patch?.width).toBe(4096)
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
