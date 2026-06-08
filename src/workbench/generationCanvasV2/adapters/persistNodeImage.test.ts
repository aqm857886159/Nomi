import { describe, expect, it, vi } from 'vitest'
import { dataUrlToFile } from './persistNodeImage'

// 1x1 透明 PNG 的 base64 dataURL
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('dataUrlToFile', () => {
  it('解码 base64 dataURL 为 File，保留 contentType 与字节', () => {
    const file = dataUrlToFile(PNG_DATA_URL, 'tile.png')
    expect(file).not.toBeNull()
    expect(file?.type).toBe('image/png')
    expect(file?.name).toBe('tile.png')
    // 1x1 PNG 至少有几十字节
    expect((file?.size ?? 0)).toBeGreaterThan(0)
  })

  it('非法 dataURL 返回 null（不抛错）', () => {
    expect(dataUrlToFile('not-a-data-url', 'x.png')).toBeNull()
    expect(dataUrlToFile('', 'x.png')).toBeNull()
  })

  it('缺省 contentType 回退 image/png', () => {
    const file = dataUrlToFile('data:;base64,QUJD', 'x.png')
    expect(file?.type).toBe('image/png')
  })
})

describe('persistNodeImageFile', () => {
  it('上传成功时返回 data.url（nomi-local URL）', async () => {
    vi.resetModules()
    vi.doMock('../../api/assetUploadApi', () => ({
      importWorkbenchLocalAssetFile: vi.fn(async () => ({ data: { url: 'nomi-local://assets/abc.png' } })),
    }))
    const { persistNodeImageFile: persist } = await import('./persistNodeImage')
    const file = dataUrlToFile(PNG_DATA_URL, 'tile.png')!
    await expect(persist(file, 'node-1')).resolves.toBe('nomi-local://assets/abc.png')
    vi.doUnmock('../../api/assetUploadApi')
  })

  it('上传抛错时返回 null（调用方退回 base64 兜底，不丢图）', async () => {
    vi.resetModules()
    vi.doMock('../../api/assetUploadApi', () => ({
      importWorkbenchLocalAssetFile: vi.fn(async () => {
        throw new Error('disk full')
      }),
    }))
    const { persistNodeImageFile: persist } = await import('./persistNodeImage')
    const file = dataUrlToFile(PNG_DATA_URL, 'tile.png')!
    await expect(persist(file, 'node-1')).resolves.toBeNull()
    vi.doUnmock('../../api/assetUploadApi')
  })
})
