import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractClipboardMediaFiles,
  extractClipboardMediaUrl,
  pasteClipboardMediaToGenerationCanvas,
} from './clipboardImagePaste'
import { useGenerationCanvasStore, __resetGenerationCanvasHistoryForTests } from '../store/generationCanvasStore'

function mediaFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type, lastModified: 1 })
}

function imageFile(name = 'clip.png'): File {
  return mediaFile(name, 'image/png')
}

function videoFile(name = 'clip.mp4'): File {
  return mediaFile(name, 'video/mp4')
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

function uploadResult(url: string, contentType?: string) {
  return {
    id: 'asset-1',
    name: 'asset',
    userId: 'local',
    createdAt: '',
    updatedAt: '',
    data: { url, ...(contentType ? { contentType } : {}) },
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

  it('extracts image and video files from clipboard files and items without duplicates', () => {
    const file = imageFile()
    const video = videoFile()
    const data = fakeClipboardData({
      files: [file, video],
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => file },
        { kind: 'file', type: 'video/mp4', getAsFile: () => video },
        { kind: 'file', type: 'text/plain', getAsFile: () => null },
      ],
    })

    expect(extractClipboardMediaFiles(data)).toEqual([file, video])
  })

  it('extracts image urls from html before falling back to plain text', () => {
    const data = fakeClipboardData({
      html: '<div><img alt="x" src="https://cdn.example.com/render?id=1&amp;w=640"></div>',
      plain: 'https://example.com/page',
    })

    expect(extractClipboardMediaUrl(data)).toMatchObject({
      url: 'https://cdn.example.com/render?id=1&w=640',
      kind: 'image',
      trustAsMedia: true,
      source: 'html',
    })
  })

  it('ignores relative html image urls that cannot be resolved outside the source page', () => {
    const data = fakeClipboardData({ html: '<img src="/relative/image.png">' })

    expect(extractClipboardMediaUrl(data)).toBeNull()
  })

  it('imports a local clipboard image file through the existing local asset pipeline', async () => {
    const uploadFile = vi.fn(async () => uploadResult('nomi-local://asset/project/clip.png'))
    const result = await pasteClipboardMediaToGenerationCanvas({
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

  it('imports a local clipboard video file through the existing local asset pipeline', async () => {
    const uploadFile = vi.fn(async () => uploadResult('nomi-local://asset/project/clip.mp4', 'video/mp4'))
    const result = await pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({ files: [videoFile('clip.mp4')] }),
      basePosition: { x: 96, y: 144 },
      categoryId: 'shots',
      importOptions: {
        uploadFile,
        recoverFile: async () => null,
        readVideoDuration: async () => 4.25,
      },
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(node.position).toEqual({ x: 96, y: 144 })
    expect(node.result).toMatchObject({
      type: 'video',
      url: 'nomi-local://asset/project/clip.mp4',
    })
    expect(node.meta).toMatchObject({ videoDuration: 4.25 })
  })

  it('places multiple pasted media files in a grid starting at the paste position', async () => {
    const uploadFile = vi.fn(async (file: File) => uploadResult(`nomi-local://asset/project/${file.name}`, file.type))
    const result = await pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({
        files: [imageFile('a.png'), imageFile('b.png'), imageFile('c.png')],
      }),
      basePosition: { x: 100, y: 200 },
      categoryId: 'shots',
      importOptions: {
        createObjectUrl: () => 'blob:preview',
        revokeObjectUrl: vi.fn(),
        readImageDimensions: async () => ({ width: 320, height: 180 }),
        uploadFile,
        recoverFile: async () => null,
      },
    })

    const positions = useGenerationCanvasStore.getState().nodes.map((node) => node.position)
    expect(result.importedCount).toBe(3)
    expect(positions[0]).toEqual({ x: 100, y: 200 })
    expect(positions[1]?.x).toBeGreaterThan(positions[0]!.x)
    expect(positions[1]?.y).toBe(positions[0]!.y)
    expect(positions[2]?.x).toBe(positions[0]!.x)
    expect(positions[2]?.y).toBeGreaterThan(positions[0]!.y)
  })

  it('extracts video urls from html video and source tags', () => {
    const videoData = fakeClipboardData({ html: '<video src="https://cdn.example.com/movie.mp4"></video>' })
    const sourceData = fakeClipboardData({
      html: '<video><source src="https://cdn.example.com/movie.webm" type="video/webm"></video>',
    })

    expect(extractClipboardMediaUrl(videoData)).toMatchObject({
      url: 'https://cdn.example.com/movie.mp4',
      kind: 'video',
      trustAsMedia: true,
      source: 'html',
    })
    expect(extractClipboardMediaUrl(sourceData)).toMatchObject({
      url: 'https://cdn.example.com/movie.webm',
      kind: 'video',
      trustAsMedia: true,
      source: 'html',
    })
  })

  it('extracts direct video urls from plain text', () => {
    const data = fakeClipboardData({ plain: 'https://cdn.example.com/movie.mp4' })

    expect(extractClipboardMediaUrl(data)).toMatchObject({
      url: 'https://cdn.example.com/movie.mp4',
      kind: 'video',
      trustAsMedia: true,
      source: 'plain',
    })
  })

  it('downloads a pasted web image url and imports it as a local asset when possible', async () => {
    const uploadFile = vi.fn(async () => uploadResult('nomi-local://asset/project/web.webp'))
    const fetchMedia = vi.fn(async () => new Response(new Blob([new Uint8Array([1])], { type: 'image/webp' }), {
      status: 200,
      headers: { 'content-type': 'image/webp' },
    }))

    const result = await pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({ html: '<img src="https://cdn.example.com/web.webp">' }),
      basePosition: { x: 12, y: 16 },
      categoryId: 'shots',
      fetchMedia,
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
    expect(fetchMedia).toHaveBeenCalledWith('https://cdn.example.com/web.webp')
    expect(uploadFile.mock.calls[0][0]).toMatchObject({ name: 'web.webp', type: 'image/webp' })
    expect(useGenerationCanvasStore.getState().nodes[0].result?.url).toBe('nomi-local://asset/project/web.webp')
  })

  it('uses the desktop remote asset importer for pasted web image urls before renderer fetch', async () => {
    const fetchMedia = vi.fn()
    const importRemoteUrl = vi.fn(async () => uploadResult('nomi-local://asset/project/remote.png'))

    const result = await pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({ plain: 'https://cdn.example.com/remote.png' }),
      basePosition: { x: 20, y: 30 },
      categoryId: 'shots',
      fetchMedia,
      importRemoteUrl,
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(result.usedExternalUrl).toBe(false)
    expect(importRemoteUrl).toHaveBeenCalledWith('https://cdn.example.com/remote.png', 'remote.png')
    expect(fetchMedia).not.toHaveBeenCalled()
    expect(node.result).toMatchObject({
      type: 'image',
      url: 'nomi-local://asset/project/remote.png',
      providerUrl: 'https://cdn.example.com/remote.png',
    })
  })

  it('uses the desktop remote asset importer for pasted web video urls before renderer fetch', async () => {
    const fetchMedia = vi.fn()
    const importRemoteUrl = vi.fn(async () => uploadResult('nomi-local://asset/project/movie.mp4', 'video/mp4'))

    const result = await pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({ html: '<video src="https://cdn.example.com/movie.mp4"></video>' }),
      basePosition: { x: 40, y: 56 },
      categoryId: 'shots',
      fetchMedia,
      importRemoteUrl,
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(result.usedExternalUrl).toBe(false)
    expect(importRemoteUrl).toHaveBeenCalledWith('https://cdn.example.com/movie.mp4', 'movie.mp4')
    expect(fetchMedia).not.toHaveBeenCalled()
    expect(node.result).toMatchObject({
      type: 'video',
      url: 'nomi-local://asset/project/movie.mp4',
      providerUrl: 'https://cdn.example.com/movie.mp4',
    })
  })

  it('keeps a failed image node when trusted web image download is blocked', async () => {
    const result = await pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({ html: '<img src="https://cdn.example.com/protected-image">' }),
      basePosition: { x: 12, y: 16 },
      categoryId: 'shots',
      fetchMedia: vi.fn(async () => {
        throw new Error('blocked')
      }),
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(result.failedCount).toBe(1)
    expect(result.usedExternalUrl).toBe(false)
    expect(node).toMatchObject({
      position: { x: 12, y: 16 },
      status: 'error',
      error: '网页媒体下载失败：该站点可能禁止跨域请求或开启防盗链。请先下载到本地，再复制或拖入画布。',
      meta: {
        source: 'clipboard-url',
        sourceUrl: 'https://cdn.example.com/protected-image',
        uploadStatus: 'failed',
      },
    })
    expect(node.result).toBeUndefined()
  })

  it('keeps a failed video node when trusted web video download is blocked', async () => {
    const result = await pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({ html: '<video src="https://cdn.example.com/protected-video"></video>' }),
      basePosition: { x: 18, y: 24 },
      categoryId: 'shots',
      fetchMedia: vi.fn(async () => {
        throw new Error('blocked')
      }),
    })

    const node = useGenerationCanvasStore.getState().nodes[0]
    expect(result.handled).toBe(true)
    expect(result.failedCount).toBe(1)
    expect(result.usedExternalUrl).toBe(false)
    expect(node).toMatchObject({
      position: { x: 18, y: 24 },
      status: 'error',
      error: '网页媒体下载失败：该站点可能禁止跨域请求或开启防盗链。请先下载到本地，再复制或拖入画布。',
      meta: {
        source: 'clipboard-url',
        sourceUrl: 'https://cdn.example.com/protected-video',
        uploadStatus: 'failed',
      },
    })
    expect(node.result).toBeUndefined()
  })

  it('creates a running placeholder node before a remote image download finishes', async () => {
    let resolveImport: ((asset: ReturnType<typeof uploadResult>) => void) | null = null
    const importRemoteUrl = vi.fn(() => new Promise<ReturnType<typeof uploadResult>>((resolve) => {
      resolveImport = resolve
    }))
    const promise = pasteClipboardMediaToGenerationCanvas({
      clipboardData: fakeClipboardData({ plain: 'https://cdn.example.com/pending.png' }),
      basePosition: { x: 220, y: 260 },
      categoryId: 'shots',
      importRemoteUrl,
    })

    await vi.waitFor(() => {
      expect(useGenerationCanvasStore.getState().nodes).toHaveLength(1)
    })

    const pendingNode = useGenerationCanvasStore.getState().nodes[0]
    expect(pendingNode).toMatchObject({
      position: { x: 220, y: 260 },
      status: 'running',
      progress: {
        phase: 'clipboard-import',
        message: '下载中',
      },
      meta: {
        source: 'clipboard-url',
        sourceUrl: 'https://cdn.example.com/pending.png',
        uploadStatus: 'uploading',
      },
    })
    expect(pendingNode.result).toBeUndefined()

    resolveImport?.(uploadResult('nomi-local://asset/project/pending.png', 'image/png'))
    const result = await promise
    const doneNode = useGenerationCanvasStore.getState().nodes[0]
    expect(result.importedCount).toBe(1)
    expect(doneNode).toMatchObject({
      status: 'success',
      progress: undefined,
      result: {
        type: 'image',
        url: 'nomi-local://asset/project/pending.png',
        providerUrl: 'https://cdn.example.com/pending.png',
      },
    })
  })
})
