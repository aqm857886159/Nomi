import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractClipboardImageFiles,
  extractClipboardImageUrl,
  pasteClipboardImageToGenerationCanvas,
} from './clipboardImagePaste'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'

function imageFile(name = 'clip.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png', lastModified: 1 })
}

function fakeClipboardData(input: {
  files?: File[]
  items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>
  html?: string
  plain?: string
  uriList?: string
}): DataTransfer {
  return {
    files: input.files || [],
    items: input.items || [],
    getData: (type: string) => {
      if (type === 'text/html') return input.html || ''
      if (type === 'text/plain') return input.plain || ''
      if (type === 'text/uri-list') return input.uriList || ''
      return ''
    },
  } as unknown as DataTransfer
}

function uploadResult(url: string) {
  return {
    id: 'asset-1',
    name: 'asset',
    userId: 'local',
    createdAt: '',
    updatedAt: '',
    data: { url },
  }
}

describe('clipboardImagePaste', () => {
  beforeEach(() => {
    __resetGenerationCanvasHistoryForTests()
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
  })

  it('extracts image files from clipboard files and items without duplicates', () => {
    const file = imageFile()
    const data = fakeClipboardData({
      files: [file],
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => file },
        { kind: 'file', type: 'text/plain', getAsFile: () => null },
      ],
    })

    expect(extractClipboardImageFiles(data)).toEqual([file])
  })

  it('extracts image urls from html before falling back to plain text', () => {
    const data = fakeClipboardData({
      html: '<div><img alt="x" src="https://cdn.example.com/render?id=1&amp;w=640"></div>',
      plain: 'https://example.com/page',
    })

    expect(extractClipboardImageUrl(data)).toMatchObject({
      url: 'https://cdn.example.com/render?id=1&w=640',
      trustAsImage: true,
      source: 'html',
    })
  })

  it('ignores relative html image urls that cannot be resolved outside the source page', () => {
    const data = fakeClipboardData({ html: '<img src="/relative/image.png">' })

    expect(extractClipboardImageUrl(data)).toBeNull()
  })

  it('imports a local clipboard image file through the existing local asset pipeline', async () => {
    const uploadFile = vi.fn(async () => uploadResult('nomi-local://asset/project/clip.png'))
    const result = await pasteClipboardImageToGenerationCanvas({
      clipboardData: fakeClipboardData({ files: [imageFile('clip.png')] }),
      basePosition: { x: 80, y: 120 },
      categoryId: 'shots',
      importOptions: {
        createObjectUrl: () => 'blob:preview',
        revokeObjectUrl: vi.fn(),
        readImageDimensions: async () => ({ width: 320, height: 180 }),
        uploadFile,
        recoverFile: async () => null,
      },
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(node.position).toEqual({ x: 80, y: 120 })
    expect(node.result?.url).toBe('nomi-local://asset/project/clip.png')
  })

  it('downloads a pasted web image url and imports it as a local asset when possible', async () => {
    const uploadFile = vi.fn(async () => uploadResult('nomi-local://asset/project/web.webp'))
    const fetchImage = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/webp' }), {
      status: 200,
      headers: { 'content-type': 'image/webp' },
    }))

    const result = await pasteClipboardImageToGenerationCanvas({
      clipboardData: fakeClipboardData({ html: '<img src="https://cdn.example.com/web.webp">' }),
      basePosition: { x: 12, y: 16 },
      categoryId: 'shots',
      fetchImage,
      importOptions: {
        createObjectUrl: () => 'blob:preview',
        revokeObjectUrl: vi.fn(),
        readImageDimensions: async () => ({ width: 512, height: 512 }),
        uploadFile,
        recoverFile: async () => null,
      },
    })

    expect(result.handled).toBe(true)
    expect(result.usedExternalUrl).toBe(false)
    expect(fetchImage).toHaveBeenCalledWith('https://cdn.example.com/web.webp')
    expect(uploadFile.mock.calls[0][0]).toMatchObject({ name: 'web.webp', type: 'image/webp' })
    expect(useGenerationCanvasStore.getState().nodes[0].result?.url).toBe('nomi-local://asset/project/web.webp')
  })

  it('uses the desktop remote asset importer for pasted web image urls before renderer fetch', async () => {
    const fetchImage = vi.fn()
    const importRemoteUrl = vi.fn(async () => uploadResult('nomi-local://asset/project/remote.png'))

    const result = await pasteClipboardImageToGenerationCanvas({
      clipboardData: fakeClipboardData({ plain: 'https://cdn.example.com/remote.png' }),
      basePosition: { x: 20, y: 30 },
      categoryId: 'shots',
      fetchImage,
      importRemoteUrl,
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(result.usedExternalUrl).toBe(false)
    expect(importRemoteUrl).toHaveBeenCalledWith('https://cdn.example.com/remote.png', 'remote.png')
    expect(fetchImage).not.toHaveBeenCalled()
    expect(node.result).toMatchObject({
      type: 'image',
      url: 'nomi-local://asset/project/remote.png',
      providerUrl: 'https://cdn.example.com/remote.png',
    })
  })

  it('falls back to an external image node for trusted web image markup when download is blocked', async () => {
    const result = await pasteClipboardImageToGenerationCanvas({
      clipboardData: fakeClipboardData({ html: '<img src="https://cdn.example.com/protected-image">' }),
      basePosition: { x: 12, y: 16 },
      categoryId: 'shots',
      fetchImage: vi.fn(async () => {
        throw new Error('blocked')
      }),
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(result.usedExternalUrl).toBe(true)
    expect(node.result).toMatchObject({
      type: 'image',
      url: 'https://cdn.example.com/protected-image',
      providerUrl: 'https://cdn.example.com/protected-image',
    })
  })
})
