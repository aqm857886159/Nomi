import { describe, expect, it } from 'vitest'
import type { NomiBrowserAsset } from '../assets/browserAssetData'
import {
  browserAssetDisplaySubtitle,
  browserAssetImportErrorMessage,
  isBrowserAssetDraggable,
  readBrowserImageDragPayload,
} from './browserAssetPopoverUtils'

function asset(input: Partial<NomiBrowserAsset> = {}): NomiBrowserAsset {
  return {
    id: 'asset-1',
    type: 'image',
    source: 'my',
    title: '网页图片',
    ...input,
  }
}

describe('browser asset tile status', () => {
  it('shows the concrete failure reason instead of replacing it with 下载失败', () => {
    expect(browserAssetDisplaySubtitle(asset({ status: 'error', subtitle: '被网站拒绝(防盗链)' }))).toBe('被网站拒绝(防盗链)')
    expect(browserAssetDisplaySubtitle(asset({ status: 'error' }))).toBe('下载失败')
  })

  it('keeps loading and failed assets non-draggable while allowing ready assets', () => {
    expect(isBrowserAssetDraggable(asset({ status: 'loading' }), false)).toBe(false)
    expect(isBrowserAssetDraggable(asset({ status: 'error' }), false)).toBe(false)
    expect(isBrowserAssetDraggable(asset({ status: 'ready' }), false)).toBe(true)
    expect(isBrowserAssetDraggable(asset({ status: 'ready' }), true)).toBe(false)
    expect(isBrowserAssetDraggable(asset({ type: 'prompt', status: 'error' }), false)).toBe(false)
  })

  it('preserves the media type supplied by the page drag bridge', () => {
    const payload = JSON.stringify({
      url: 'https://cdn.example.com/clip.webm',
      title: '视频参考',
      mediaType: 'video',
    })
    const dataTransfer = {
      getData: (type: string) => type === 'application/x-nomi-browser-image' ? payload : '',
    } as DataTransfer

    expect(readBrowserImageDragPayload(dataTransfer)).toMatchObject({
      url: 'https://cdn.example.com/clip.webm',
      title: '视频参考',
      mediaType: 'video',
    })
  })

  it('treats a video poster fallback as an image', () => {
    const dataTransfer = {
      getData: (type: string) => type === 'text/html'
        ? '<video poster="https://cdn.example.com/poster.webp" title="封面"></video>'
        : '',
    } as DataTransfer

    expect(readBrowserImageDragPayload(dataTransfer)).toMatchObject({
      url: 'https://cdn.example.com/poster.webp',
      title: '封面',
      mediaType: 'image',
    })
  })

  it('turns download failures into actionable user-facing reasons', () => {
    expect(browserAssetImportErrorMessage('来源页面会话已失效', 'https://cdn.example.com/a.png')).toBe('来源网页已关闭，请重新拖入')
    expect(browserAssetImportErrorMessage('网页素材下载失败（HTTP 403）', 'https://cdn.example.com/a.png')).toBe('网站拒绝下载（可能需要登录）')
    expect(browserAssetImportErrorMessage('网页返回的不是图片或视频（text/html）', 'https://cdn.example.com/a.png')).toBe('网站返回的不是图片或视频')
    expect(browserAssetImportErrorMessage('anything', 'blob:https://example.com/id')).toBe('网页临时资源已失效')
  })
})

// ——— 2026-07-22 审计 P1：结构化错误码 → 文案 + 唯一下一步（通用「请重试」只留给 unknown） ———
import { browserAssetImportErrorMessage } from './browserAssetPopoverUtils'

describe('browserAssetImportErrorMessage 结构化错误码', () => {
  it('IPC 包裹后的 code 前缀仍能解析（不锚行首）', () => {
    const wrapped = "Error invoking remote method 'browser:view:import-media': Error: [nomi-capture:mse-stream] 流媒体视频（MediaSource）没有可下载的原件"
    expect(browserAssetImportErrorMessage(wrapped, 'blob:https://www.bilibili.com/x')).toContain('流媒体视频')
    expect(browserAssetImportErrorMessage(wrapped, 'blob:https://www.bilibili.com/x')).not.toContain('临时资源已失效')
  })

  it('每个 code 都映射到带下一步的具体文案，不再折叠成「请重试」', () => {
    const cases: Array<[string, RegExp]> = [
      ['[nomi-capture:forbidden] HTTP 403', /登录/],
      ['[nomi-capture:not-found] HTTP 404', /失效|重新选/],
      ['[nomi-capture:html-not-media] text/html', /防盗链|人机验证/],
      ['[nomi-capture:too-large] 超限', /200MB/],
      ['[nomi-capture:blocked-by-client] ERR_BLOCKED_BY_CLIENT', /安全策略/],
      ['[nomi-capture:network] ERR_NAME_NOT_RESOLVED', /网络/],
    ]
    for (const [reason, expected] of cases) {
      const message = browserAssetImportErrorMessage(reason, 'https://cdn.example/a.jpg')
      expect(message).toMatch(expected)
      expect(message).not.toBe('下载失败，请重试')
    }
  })

  it('无 code 的旧字符串走原归类（零回归）', () => {
    expect(browserAssetImportErrorMessage('Media download timed out', 'https://x/a.jpg')).toBe('下载超时，请重试')
    expect(browserAssetImportErrorMessage('完全未知的报错', 'https://x/a.jpg')).toBe('下载失败，请重试')
  })
})
