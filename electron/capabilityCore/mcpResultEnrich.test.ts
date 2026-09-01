import { describe, it, expect } from 'vitest'
import { enrichArtifactResult, stripInternalEnrichFields } from './mcpResultEnrich'
import type { ThumbnailImageToolkit } from './mcpPreviewImage'

function fakeToolkit(jpegBytes = 2_000): ThumbnailImageToolkit {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 1024, height: 768 }),
    resize() { return image },
    toJPEG: () => Buffer.alloc(jpegBytes, 1),
  }
  return { createFromPath: () => image, createFromBuffer: () => image }
}

describe('enrichArtifactResult（P0-B 缺口 · nomi_get_artifact 有图预览时补同款缩略图块）', () => {
  // 真实 artifact 投影：preview.nomiUrl 恒为 nomi-local://production-preview/…（可解析到磁盘）；
  // preview.url 在 App 里是签名 HTTP 链（解不了）——故映射必须走 nomiUrl。
  const imageArtifact = () => ({
    artifactId: 'a1', kind: 'image', status: 'ready',
    preview: {
      url: 'http://127.0.0.1:5/production-preview?preview=TOK',
      nomiUrl: 'nomi-local://production-preview/p1/r9/a1/assets/thumb.jpg?preview=TOK',
      token: 'TOK', expiresAt: 'later',
    },
  })

  it('图片产物：注入 _nomiThumbnail（base64 ≤ 顶），原字段不动，不铸 _nomiPreviewUrl', () => {
    const out = enrichArtifactResult(imageArtifact(), {
      toolkit: fakeToolkit(2_000),
      readFileBytes: () => Buffer.alloc(10),
      // 只有 nomiUrl 能解析到磁盘；HTTP 的 preview.url 解不了（模拟真实 parseLocalAssetUrl 行为）。
      resolveLocalFile: (u) => (u.startsWith('nomi-local://') ? '/tmp/p1/thumb.jpg' : null),
    }) as Record<string, unknown>
    const thumb = out._nomiThumbnail as { data: string; mimeType: string }
    expect(thumb).toBeTruthy()
    expect(thumb.mimeType).toBe('image/jpeg')
    expect(thumb.data.length).toBeLessThanOrEqual(64 * 1024)
    expect(thumb.data.length).toBeGreaterThan(100)
    // artifact 路不铸签名链（投影自带 preview.url）。
    expect(out._nomiPreviewUrl).toBeUndefined()
    // 原字段完好。
    expect((out.preview as Record<string, unknown>).url).toBe('http://127.0.0.1:5/production-preview?preview=TOK')
    expect(out.artifactId).toBe('a1')
  })

  it('视频产物：不出缩略图块（不抽帧），原样返回（无 _nomiThumbnail）', () => {
    const out = enrichArtifactResult(
      { artifactId: 'v1', kind: 'video', status: 'ready', preview: { url: 'http://127.0.0.1:5/x', nomiUrl: 'nomi-local://production-preview/p1/r9/v1/clip.mp4?preview=T', token: 'T', expiresAt: 'later' } },
      { toolkit: fakeToolkit(2_000), readFileBytes: () => Buffer.alloc(10), resolveLocalFile: () => '/tmp/p1/clip.mp4' },
    ) as Record<string, unknown>
    expect(out._nomiThumbnail).toBeUndefined()
    expect(out.kind).toBe('video')
  })

  it('无 preview（未落本地）/ 解析不到文件：优雅省略，结果其余完好', () => {
    const noPreview = enrichArtifactResult({ artifactId: 'a2', kind: 'image', status: 'candidate' }, {
      toolkit: fakeToolkit(2_000), readFileBytes: () => Buffer.alloc(10), resolveLocalFile: () => '/tmp/x',
    }) as Record<string, unknown>
    expect(noPreview._nomiThumbnail).toBeUndefined()
    expect(noPreview.status).toBe('candidate')
    // 有 preview 但文件解析不到 → 也省略。
    const unresolved = enrichArtifactResult(imageArtifact(), {
      toolkit: fakeToolkit(2_000), readFileBytes: () => Buffer.alloc(10), resolveLocalFile: () => null,
    }) as Record<string, unknown>
    expect(unresolved._nomiThumbnail).toBeUndefined()
  })

  it('超 64KB base64 硬顶：省略（宁缺不塞超大 payload）', () => {
    const out = enrichArtifactResult(imageArtifact(), {
      toolkit: fakeToolkit(60_000), // JPEG 60KB → base64 ≈ 80KB > 顶
      readFileBytes: () => Buffer.alloc(200_000),
      resolveLocalFile: (u) => (u.startsWith('nomi-local://') ? '/tmp/p1/big.jpg' : null),
    }) as Record<string, unknown>
    expect(out._nomiThumbnail).toBeUndefined()
  })

  it('非对象结果：原样返回，不炸', () => {
    const deps = { toolkit: fakeToolkit(2_000), readFileBytes: () => Buffer.alloc(1), resolveLocalFile: () => '/x' }
    expect(enrichArtifactResult(null, deps)).toBeNull()
    expect(enrichArtifactResult('str', deps)).toBe('str')
  })
})

describe('stripInternalEnrichFields（内部富化字段单一真相剥离器）', () => {
  it('剥掉 _nomiThumbnail / _nomiPreviewUrl，保留其余，不改原对象', () => {
    const original = { artifactId: 'a1', kind: 'image', _nomiThumbnail: { data: 'X', mimeType: 'image/jpeg' }, _nomiPreviewUrl: 'http://x' }
    const out = stripInternalEnrichFields(original) as Record<string, unknown>
    expect(out._nomiThumbnail).toBeUndefined()
    expect(out._nomiPreviewUrl).toBeUndefined()
    expect(out.artifactId).toBe('a1')
    expect(out.kind).toBe('image')
    // 原对象不动（浅拷贝）。
    expect((original as Record<string, unknown>)._nomiThumbnail).toBeTruthy()
    expect(out).not.toBe(original)
  })

  it('无内部字段：原样返回同一引用（不做多余拷贝）', () => {
    const clean = { artifactId: 'a1', kind: 'image' }
    expect(stripInternalEnrichFields(clean)).toBe(clean)
    expect(stripInternalEnrichFields(null)).toBeNull()
    expect(stripInternalEnrichFields('str')).toBe('str')
  })
})
